import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'
import nodemailer from 'nodemailer'

export const service = createClient(
  process.env.SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-service-role-key',
  { auth: { persistSession: false } }
)

export function dbConfigured() {
  return !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY
}

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } })
export const fail = (error, status = 400) => json({ error }, status)

// ── auth ─────────────────────────────────────────────────────
export async function getSession(req) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return null
  const { data } = await service.auth.getUser(token).catch(() => ({ data: null }))
  if (!data?.user) return null
  const { data: profile } = await service.from('profiles').select('*').eq('id', data.user.id).single()
  if (!profile || !profile.is_active) return null
  return { user: data.user, profile }
}

export const unauthorized = () => fail('Unauthorized', 401)

// ── encryption (SMTP passwords, Drive SA, Meta tokens) ───────
const encKey = () => Buffer.from(process.env.APP_ENCRYPTION_KEY || '', 'hex')
export function encrypt(text) {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', encKey(), iv)
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()])
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.')
}
export function decrypt(payload) {
  try {
    const [iv, tag, enc] = String(payload).split('.').map((s) => Buffer.from(s, 'base64'))
    const d = crypto.createDecipheriv('aes-256-gcm', encKey(), iv)
    d.setAuthTag(tag)
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8')
  } catch {
    return null
  }
}

// ── settings ─────────────────────────────────────────────────
export async function getSetting(key) {
  const { data } = await service.from('settings').select('value').eq('key', key).maybeSingle()
  return data?.value || null
}
export async function setSetting(key, value) {
  await service.from('settings').upsert({ key, value, updated_at: new Date().toISOString() })
}

// ── activity + notifications ─────────────────────────────────
export async function logActivity(lead_id, user_id, type, title, detail = {}) {
  await service.from('activities').insert({ lead_id, user_id, type, title, detail })
  await service.from('leads').update({ last_activity_at: new Date().toISOString() }).eq('id', lead_id)
}
export async function notify(userIds, title, body, lead_id = null) {
  const ids = (userIds || []).filter(Boolean).slice(0, 50) // cap: notifications are fan-out, never huge
  if (!ids.length) return
  await service.from('notifications').insert(ids.map((user_id) => ({ user_id, title, body, lead_id })))
}
export async function adminIds() {
  const { data } = await service.from('profiles').select('id').eq('role', 'admin').eq('is_active', true)
  return (data || []).map((r) => r.id)
}

// ── templates ────────────────────────────────────────────────
export function render(tpl, vars) {
  return String(tpl || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (vars[k] ?? ''))
}

// ── email engine ─────────────────────────────────────────────
export const DISPOSITIONS = ['New', 'Working', 'VM', 'Callback', 'NIS', 'Not Interested', 'Signed', 'Approved', 'Criteria Not Met']
export const LEAD_SOURCES = ['manual', 'import', 'meta']

export async function sendLeadEmail({ lead, agent, subject, html, purpose, baseUrl }) {
  const { data: profiles } = await service.from('smtp_profiles').select('*').eq('is_active', true)
  const prof =
    (profiles || []).find((p) => p.purpose === purpose) ||
    (profiles || []).find((p) => p.purpose === 'general') ||
    (profiles || [])[0]
  if (!prof) throw new Error('No active SMTP profile configured. Ask the admin to add one under Admin → SMTP.')
  const pass = decrypt(prof.password_enc)
  if (!pass) throw new Error('SMTP password could not be decrypted — check APP_ENCRYPTION_KEY')

  // Daily-limit guard: protects sender reputation before the email is handed
  // to the SMTP provider (better than a bounce/storm after the fact).
  const dayStart = new Date().toISOString().slice(0, 10)
  const { count } = await service
    .from('email_messages')
    .select('id', { count: 'exact', head: true })
    .eq('smtp_profile_id', prof.id)
    .gte('created_at', dayStart)
  if ((count || 0) >= (prof.daily_limit || 300)) {
    throw new Error(`Daily send limit reached for "${prof.name}" (${prof.daily_limit}/day). Use a different SMTP profile or wait until tomorrow.`)
  }

  const transport = nodemailer.createTransport({
    host: prof.host,
    port: prof.port,
    secure: !!prof.secure,
    auth: { user: prof.username, pass },
    // Hard timeouts so a dead SMTP server can never hang the request forever
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  })
  const id = crypto.randomUUID()
  const vars = leadVars(lead, agent)
  const finalSubject = render(subject, vars)
  const finalHtml = render(html, vars) +
    `<img src="${baseUrl}/api/track-open?t=${id}" width="1" height="1" alt="" style="display:none" />`
  const info = await transport.sendMail({
    from: prof.from_name ? `"${prof.from_name}" <${prof.from_email}>` : prof.from_email,
    to: lead.email,
    subject: finalSubject,
    html: finalHtml,
  })
  await service.from('email_messages').insert({
    id,
    lead_id: lead.id,
    sent_by: agent?.id || null,
    smtp_profile_id: prof.id,
    purpose,
    to_email: lead.email,
    subject: finalSubject,
    html: finalHtml,
  })
  return { id, messageId: info.messageId, profile: prof.name }
}

// ── timezone helpers (server twin of src/lib/tz.js — Intl-based, DST-aware) ──
export const IST_TZ = 'Asia/Kolkata'
// US phone display format — "8381083616" → "(838) 108-3616". Non-US numbers
// pass through untouched. Server twin of src/lib/validate.js fmtPhone.
export function fmtPhone(p) {
  const d = String(p || '').replace(/\D/g, '')
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  if (d.length === 11 && d.startsWith('1')) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  return String(p || '')
}
export function tzAbbrAt(date, tz) {
  if (tz === 'Asia/Kolkata') return 'IST'
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(date)
  return parts.find((p) => p.type === 'timeZoneName')?.value || ''
}
export function dateInTz(date, tz) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(date) + ' ' + tzAbbrAt(date, tz)
}
export function callbackNotifyText(leadName, dueIso, customerTz) {
  const due = new Date(dueIso)
  const mine = `${dateInTz(due, IST_TZ)} (your time)`
  const theirs = customerTz && customerTz !== IST_TZ ? ` — ${dateInTz(due, customerTz)} their time` : ''
  return `Callback with ${leadName} at ${mine}${theirs}`
}

export function leadVars(lead, agent) {
  const age = lead.dob ? Math.floor((Date.now() - new Date(lead.dob)) / 31557600000) : ''
  return {
    first_name: lead.first_name || '',
    last_name: lead.last_name || '',
    email: lead.email || '',
    phone: fmtPhone(lead.phone),
    state: lead.state || '',
    city: lead.city || '',
    age,
    agent_name: agent?.name || '',
    agent_phone: fmtPhone(agent?.phone),
    doc_link: '',
  }
}

// ── Meta Conversions API ─────────────────────────────────────
export async function sendCapi(meta, { eventName, lead, custom = {}, metaLeadId }) {
  if (!meta?.pixel_id || !meta?.capi_token) return { skipped: true, reason: 'Meta not configured' }
  const h = (v) =>
    v ? crypto.createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex') : undefined
  const phone = lead.phone ? String(lead.phone).replace(/\D/g, '') : undefined
  const body = {
    data: [
      {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: `crm_${lead.id}_${eventName}`,
        action_source: 'system_generated',
        user_data: { em: h(lead.email), ph: h(phone) },
        custom_data: custom,
        ...(metaLeadId ? { lead_id: metaLeadId } : {}),
      },
    ],
    ...(meta.test_event_code ? { test_event_code: meta.test_event_code } : {}),
  }
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${meta.pixel_id}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    return { success: res.ok, response: data }
  } catch (e) {
    return { success: false, response: { error: String(e.message || e) } }
  }
}

export function metaSecrets(meta) {
  // tokens are stored encrypted inside the settings json
  const out = { ...meta }
  for (const k of ['capi_token', 'page_token', 'app_secret']) out[k] = meta?.[k] ? decrypt(meta[k]) : null
  return out
}

// ── Google Drive via REST (service account; no SDK — Windows-safe) ──
const driveTokenCache = {}

async function driveAccessToken(clientEmail, privateKey, scope = 'https://www.googleapis.com/auth/drive') {
  const cached = driveTokenCache[clientEmail + scope]
  const now = Math.floor(Date.now() / 1000)
  if (cached && cached.exp > now + 60) return cached.token
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: clientEmail,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })}`
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(privateKey, 'base64url')
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(`Google auth failed: ${data.error_description || data.error || res.status}`)
  driveTokenCache[clientEmail + scope] = { token: data.access_token, exp: now + (data.expires_in || 3600) }
  return data.access_token
}

export async function driveFor(driveSettings) {
  if (!driveSettings?.service_account_enc) return null
  const sa = decrypt(driveSettings.service_account_enc)
  if (!sa) return null
  const creds = JSON.parse(sa)
  const token = await driveAccessToken(creds.client_email, creds.private_key)
  const base = 'https://www.googleapis.com/drive/v3'
  const call = async (path, opts = {}) => {
    const res = await fetch(`${base}${path}`, {
      ...opts,
      headers: { authorization: `Bearer ${token}`, ...(opts.headers || {}) },
    })
    if (!res.ok) throw new Error(`Drive API ${res.status}: ${(await res.text()).slice(0, 300)}`)
    return (res.headers.get('content-type') || '').includes('json') ? res.json() : null
  }
  return {
    async findFolder(name, parentId) {
      const q = `name='${String(name).replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false${
        parentId ? ` and '${parentId}' in parents` : ''
      }`
      const data = await call(`/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`)
      return data.files?.[0]?.id || null
    },
    async createFolder(name, parentId) {
      const data = await call('/files?fields=id', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', ...(parentId ? { parents: [parentId] } : {}) }),
      })
      return data.id
    },
    async uploadFile(name, parentId, mimeType, buffer) {
      const boundary = 'leaddesk' + Date.now()
      const meta = JSON.stringify({ name, ...(parentId ? { parents: [parentId] } : {}) })
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\ncontent-type: ${mimeType}\r\n\r\n`),
        buffer,
        Buffer.from(`\r\n--${boundary}--`),
      ])
      return call('/files?uploadType=multipart&fields=id,webViewLink', {
        method: 'POST',
        headers: { 'content-type': `multipart/related; boundary=${boundary}` },
        body,
      })
    },
    async setPermissionAnyoneReader(fileId) {
      return call(`/files/${fileId}/permissions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'reader', type: 'anyone' }),
      })
    },
    async deleteFile(fileId) {
      return call(`/files/${fileId}`, { method: 'DELETE' })
    },
  }
}

export async function ensureFolder(drive, name, parentId) {
  const found = await drive.findFolder(name, parentId)
  if (found) return found
  return drive.createFolder(name, parentId)
}

// ── capacity-aware round-robin lives near the end of this file ──

// ── misc ─────────────────────────────────────────────────────
export function baseUrl(url) {
  return process.env.SITE_URL || url.origin
}
export const today = () => new Date().toISOString().slice(0, 10)
export const isoDayStart = () => new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').toISOString()

// ── follow-up rules engine ───────────────────────────────────
// When an agent sets a disposition, these rules auto-create the NEXT task so
// no lead ever goes silent. Admin-editable (settings.followup_rules).
export const DEFAULT_FOLLOWUP_RULES = [
  { disposition: 'VM', title: 'Call again — VM follow-up', days: 2, type: 'callback' },
  { disposition: 'Callback', title: 'Callback as promised', days: 1, type: 'callback' },
  { disposition: 'NIS', title: 'Retry call (NIS)', days: 1, type: 'callback' },
  { disposition: 'Signed', title: 'Verification call', days: 1, type: 'callback' },
]

export async function applyFollowupRules(lead, disposition) {
  try {
    const rules = (await getSetting('followup_rules')) || DEFAULT_FOLLOWUP_RULES
    const rule = (rules || []).find((r) => r && r.disposition === disposition && r.title && r.days != null)
    if (!rule) return
    const { data: existing } = await service.from('tasks')
      .select('id').eq('lead_id', lead.id).eq('title', rule.title).eq('status', 'open').maybeSingle()
    if (existing) return // don't stack duplicates of the same open auto-task
    await service.from('tasks').insert({
      title: rule.title, type: rule.type || 'callback', lead_id: lead.id,
      assigned_to: lead.assigned_to || null,
      due_at: new Date(Date.now() + Number(rule.days) * 86400000).toISOString(),
    })
    await logActivity(lead.id, null, 'task', `🗓 Auto-task created: ${rule.title} (due in ${rule.days} day${rule.days == 1 ? '' : 's'})`)
  } catch (e) {
    console.error('followup rule failed:', e)
  }
}

// ── daily queue builder ──────────────────────────────────────
// One prioritized work list per user: overdue follow-ups → callbacks due
// today → open tasks due → fresh leads (oldest first, capped).
export async function buildQueueFor(profile) {
  const admin = profile.role === 'admin'
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(); dayEnd.setHours(23, 59, 59, 999)

  const { data: leads } = await service.from('leads')
    .select('id,first_name,last_name,phone,disposition,disposition_reason,next_followup_at,last_activity_at,created_at,assigned_to,profiles!leads_assigned_to_fkey(name)')
    .neq('disposition', 'Signed').neq('disposition', 'Approved')
    .order('created_at', { ascending: false })
    .limit(5000)
  const visible = (leads || []).filter((l) => admin || l.assigned_to === profile.id)

  const items = []
  const seen = new Set()
  const push = (l, reason, due_at, extra = {}) => {
    if (seen.has(l.id)) return
    seen.add(l.id)
    items.push({ id: l.id, first_name: l.first_name, last_name: l.last_name, phone: l.phone, disposition: l.disposition, assigned_name: l.profiles?.name || null, reason, due_at, customer_tz: extra.customer_tz || null })
  }

  let overdue = 0, dueToday = 0
  for (const l of visible) {
    if (l.next_followup_at && new Date(l.next_followup_at) < dayStart) { push(l, 'Overdue follow-up', l.next_followup_at); overdue++ }
  }
  for (const l of visible) {
    if (seen.has(l.id) || !l.next_followup_at) continue
    const d = new Date(l.next_followup_at)
    if (d >= dayStart && d <= dayEnd) { push(l, 'Callback due today', l.next_followup_at); dueToday++ }
  }

  let tq = service.from('tasks').select('id,title,due_at,customer_tz,lead_id').eq('status', 'open').lte('due_at', dayEnd.toISOString()).order('due_at').limit(200)
  if (!admin) tq = tq.eq('assigned_to', profile.id)
  const { data: tasks } = await tq
  const byId = new Map(visible.map((l) => [l.id, l]))
  for (const t of tasks || []) {
    const l = t.lead_id ? byId.get(t.lead_id) : null
    if (l) push(l, `Task: ${t.title}`, t.due_at, { customer_tz: t.customer_tz })
  }

  // fresh leads: oldest untouched first (admin also sees the unassigned pool)
  const fresh = visible
    .filter((l) => !seen.has(l.id) && l.disposition === 'New')
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
    .slice(0, 15)
  for (const l of fresh) push(l, 'Fresh lead', null)

  return {
    items,
    counts: {
      total: items.length,
      overdue,
      dueToday,
      fresh: fresh.length,
    },
  }
}

// ── system email (digests/notifications, not lead follow-ups) ─
export async function sendSystemEmail({ to, subject, html }) {
  const { data: profiles } = await service.from('smtp_profiles').select('*').eq('is_active', true)
  const prof = (profiles || []).find((p) => p.purpose === 'notifications')
    || (profiles || []).find((p) => p.purpose === 'general')
    || (profiles || [])[0]
  if (!prof) throw new Error('No SMTP profile configured — add one under Admin → SMTP (purpose: System notifications)')
  const pass = decrypt(prof.password_enc)
  if (!pass) throw new Error('SMTP password could not be decrypted — re-enter it')
  const transport = nodemailer.createTransport({
    host: prof.host, port: prof.port, secure: !!prof.secure,
    auth: { user: prof.username, pass },
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
  })
  await transport.sendMail({
    from: prof.from_name ? `"${prof.from_name}" <${prof.from_email}>` : prof.from_email,
    to, subject, html,
  })
  return prof.name
}

// ── capacity-aware round-robin ───────────────────────────────
// Skips agents who hit their max_leads cap (null cap = unlimited).
export async function pickAgentRoundRobin() {
  const s = (await getSetting('auto_assign')) || {}
  if (s.mode !== 'round_robin') return null
  const { data: agents } = await service.from('profiles').select('*').eq('role', 'agent').eq('is_active', true)
  if (!agents?.length) return null
  const { data: counts } = await service.from('leads').select('assigned_to')
  const tally = {}
  for (const a of agents) tally[a.id] = (counts || []).filter((c) => c.assigned_to === a.id).length
  const pool = agents.filter((a) => !a.max_leads || tally[a.id] < a.max_leads)
  if (!pool.length) return null // every agent at capacity → unassigned pool
  return pool.sort((a, b) => tally[a.id] - tally[b.id])[0].id
}

// ── welcome email on assignment ──────────────────────────────
// Fires once per lead+agent pair, only when the admin hasn't disabled it.
export async function maybeSendWelcomeEmail(lead, agentId) {
  try {
    const cfg = (await getSetting('welcome_email')) || { enabled: true }
    if (!cfg.enabled || !agentId || !lead?.email) return
    const { data: agent } = await service.from('profiles').select('*').eq('id', agentId).single()
    if (!agent) return
    const { data: prior } = await service.from('activities')
      .select('detail').eq('lead_id', lead.id).eq('type', 'welcome').limit(50)
    if ((prior || []).some((p) => p.detail?.agent_id === agentId)) return // already welcomed by this agent
    const { data: tpl } = await service.from('templates')
      .select('subject,body').eq('name', 'Agent Assigned — Welcome (ABA)').maybeSingle()
    const vars = { ...leadVars(lead, { name: agent.name }), agent_name: agent.name || '', agent_phone: fmtPhone(agent.phone) || '', agent_email: agent.email || '' }
    const subject = tpl?.subject ? render(tpl.subject, vars) : 'Your specialist has been assigned — American Benefits Advocates'
    const body = tpl?.body ? render(tpl.body, vars)
      : `<p>Hi <strong>${vars.first_name}</strong>,</p><p>Great news — your SSDI file is moving forward. Your assigned specialist is <strong>${vars.agent_name}</strong>${vars.agent_phone ? ` and they'll be calling you from <strong>${vars.agent_phone}</strong>` : ''}.</p><p>Please keep your phone nearby — and reply to this email if you have any questions in the meantime.</p><p>American Benefits Advocates</p>`
    await sendSystemEmail({ to: lead.email, subject, html: body })
    await service.from('activities').insert({ lead_id: lead.id, user_id: null, type: 'welcome', title: `✉️ Welcome email sent (agent: ${vars.agent_name})`, detail: { agent_id: agentId } })
  } catch (e) {
    // Never silent: the admin/agents must see WHY no email went out.
    console.error('welcome email failed:', e.message)
    try {
      await service.from('activities').insert({ lead_id: lead.id, user_id: null, type: 'welcome', title: `⚠️ Welcome email FAILED: ${String(e.message).slice(0, 200)}`, detail: { agent_id: agentId, error: String(e.message).slice(0, 500) } })
      await notify(await adminIds(), 'Welcome email failed', String(e.message).slice(0, 200))
    } catch {}
  }
}

// ── Google Sheets sync ───────────────────────────────────────
// Pulls the sheet as CSV using the Drive service account (share the sheet
// with the service account email), auto-maps columns, dedupes, imports as
// unassigned leads.
export function parseSheetId(u) {
  const m = String(u || '').match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
  if (!m) return null
  const gidMatch = String(u).match(/[#&?]gid=([0-9]+)/)
  return { sheetId: m[1], gid: gidMatch ? gidMatch[1] : null }
}

export function parseCsv(text) {
  const rows = []
  let row = [], cell = '', inQ = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') inQ = false
      else cell += c
    } else if (c === '"') inQ = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some((x) => x.trim() !== '')) rows.push(row)
      row = []
    } else cell += c
  }
  row.push(cell)
  if (row.some((x) => x.trim() !== '')) rows.push(row)
  return rows
}

const HEADER_MATCHERS = [
  ['first_name', /first|^name$|fullname|fullname/i], ['last_name', /last|surname/i],
  ['email', /email|mail/i], ['phone', /phone|mobile|cell/i],
  ['dob', /dob|birth/i], ['state', /state/i], ['city', /city|town/i],
  ['address', /address|street/i], ['zip', /zip|postal/i],
  ['disability', /disability|condition|impair/i], ['notes', /notes|comment/i],
]
export async function syncGoogleSheet() {
  const cfg = (await getSetting('sheets')) || {}
  if (!cfg.sheet_url) throw new Error('No Google Sheet configured yet')
  const parsed = parseSheetId(cfg.sheet_url)
  if (!parsed) throw new Error('That URL is not a Google Sheets link')
  const driveSettings = await getSetting('drive')
  if (!driveSettings?.service_account_enc) throw new Error('Add the Google service account JSON first (Drive section), then share the sheet with that service account email')
  const creds = JSON.parse(decrypt(driveSettings.service_account_enc))
  const token = await driveAccessToken(creds.client_email, creds.private_key)
  const exportUrl = `https://docs.google.com/spreadsheets/d/${parsed.sheetId}/export?format=csv${parsed.gid ? `&gid=${parsed.gid}` : ''}`
  const res = await fetch(exportUrl, { headers: { authorization: `Bearer ${token}` }, redirect: 'follow' })
  if (!res.ok) throw new Error(`Google returned ${res.status} — share the sheet with the service account email (Viewer is enough)`)
  const rows = parseCsv(await res.text())
  if (rows.length < 2) return { imported: 0, updated: 0, duplicates: 0 }
  const [headers, ...body] = rows
  const mapped = body.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]])))
  return importLeadRows(mapped, { source: 'sheet', campaign: 'Google Sheet', assignedTo: null, dupPolicy: cfg.dup_policy || 'skip' })
}

// ── shared lead import engine (CSV, sheet sync, instant push) ──
const IMPORT_FIELDS = new Set(['first_name','last_name','email','phone','dob','state','city','address','zip','disability','notes','campaign','worked_5_of_10','receiving_benefits','duration_12m','has_attorney'])
const truthyVal = (v) => ['true', 'yes', 'y', '1', 'x'].includes(String(v).trim().toLowerCase())

function mapRow(r) {
  const out = {}
  for (const k of Object.keys(r)) if (IMPORT_FIELDS.has(k)) out[k] = r[k]
  for (const k of Object.keys(r)) {
    if (IMPORT_FIELDS.has(k)) continue
    for (const [field, re] of HEADER_MATCHERS) {
      if (re.test(k) && out[field] === undefined) { out[field] = r[k]; break }
    }
  }
  return out
}

export async function importLeadRows(rows, { source = 'import', campaign = null, assignedTo = null, dupPolicy = 'skip' } = {}) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && typeof r === 'object').slice(0, 10000)
  if (!list.length) return { inserted: 0, updated: 0, duplicates: 0 }
  const clean = (v, max = 500) => {
    if (v === undefined || v === null) return null
    const s = String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim()
    return s ? s.slice(0, max) : null
  }
  const { data: existing } = await service.from('leads').select('id,phone,email')
  const index = new Map()
  for (const l of existing || []) {
    const p = String(l.phone || '').replace(/\D/g, '').slice(-10)
    const e = (l.email || '').toLowerCase()
    if (p) index.set('p' + p, l.id)
    if (e) index.set('e' + e, l.id)
  }
  const toInsert = [], updates = []
  let duplicates = 0
  for (const raw of list) {
    const r = mapRow(raw)
    const phoneKey = clean(r.phone, 30) ? 'p' + String(r.phone).replace(/\D/g, '').slice(-10) : null
    const emailL = (clean(r.email, 200) || '').toLowerCase()
    const emailKey = emailL ? 'e' + emailL : null
    const hitId = (phoneKey && index.get(phoneKey)) || (emailKey && index.get(emailKey)) || null
    if (hitId) {
      if (dupPolicy === 'update' && hitId !== 'new') {
        const values = {}
        for (const f of ['first_name', 'last_name', 'dob', 'state', 'city', 'address', 'zip', 'disability', 'notes']) {
          const v = clean(r[f], f === 'notes' || f === 'disability' ? 2000 : 300)
          if (v) values[f] = f === 'email' ? v.toLowerCase() : v
        }
        if (Object.keys(values).length) updates.push({ id: hitId, values })
      }
      duplicates++
      continue
    }
    if (phoneKey) index.set(phoneKey, 'new')
    if (emailKey) index.set(emailKey, 'new')
    toInsert.push({
      first_name: clean(r.first_name, 100) || '', last_name: clean(r.last_name, 100) || '',
      email: emailL || null, phone: fmtPhone(clean(r.phone, 30)) || null,
      dob: clean(r.dob, 20) || null, state: clean(r.state, 10), city: clean(r.city, 120),
      address: clean(r.address, 300), zip: clean(r.zip, 20),
      worked_5_of_10: r.worked_5_of_10 != null && r.worked_5_of_10 !== '' ? truthyVal(r.worked_5_of_10) : null,
      receiving_benefits: r.receiving_benefits != null && r.receiving_benefits !== '' ? truthyVal(r.receiving_benefits) : null,
      duration_12m: r.duration_12m != null && r.duration_12m !== '' ? truthyVal(r.duration_12m) : null,
      has_attorney: r.has_attorney != null && r.has_attorney !== '' ? truthyVal(r.has_attorney) : null,
      disability: clean(r.disability, 2000), notes: clean(r.notes, 2000),
      campaign: campaign || clean(r.campaign, 200),
      source, assigned_to: assignedTo,
    })
  }
  let inserted = 0
  for (let i = 0; i < toInsert.length; i += 200) {
    const chunk = toInsert.slice(i, i + 200)
    const { error } = await service.from('leads').insert(chunk)
    if (error) throw new Error(`Import failed: ${error.message}`)
    inserted += chunk.length
  }
  let updated = 0
  for (const u of updates) {
    const { error } = await service.from('leads').update({ ...u.values, updated_at: new Date().toISOString() }).eq('id', u.id)
    if (!error) updated++
    await logActivity(u.id, null, 'edited', 'Lead updated from import')
  }
  return { inserted, updated, duplicates }
}
