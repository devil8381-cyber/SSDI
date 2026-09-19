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
    `<img src="${baseUrl}/.netlify/functions/track-open?t=${id}" width="1" height="1" alt="" style="display:none" />`
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

export function leadVars(lead, agent) {
  const age = lead.dob ? Math.floor((Date.now() - new Date(lead.dob)) / 31557600000) : ''
  return {
    first_name: lead.first_name || '',
    last_name: lead.last_name || '',
    email: lead.email || '',
    phone: lead.phone || '',
    state: lead.state || '',
    city: lead.city || '',
    age,
    agent_name: agent?.name || '',
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

async function driveAccessToken(clientEmail, privateKey) {
  const cached = driveTokenCache[clientEmail]
  const now = Math.floor(Date.now() / 1000)
  if (cached && cached.exp > now + 60) return cached.token
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/drive',
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
  if (!data.access_token) throw new Error(`Drive auth failed: ${data.error_description || data.error || res.status}`)
  driveTokenCache[clientEmail] = { token: data.access_token, exp: now + (data.expires_in || 3600) }
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

// ── auto-assign (round-robin) ────────────────────────────────
// Respects the admin's Automation setting; returns null when auto-assign is
// off (lead goes to the unassigned pool) or when no active agents exist.
export async function pickAgentRoundRobin() {
  const s = (await getSetting('auto_assign')) || {}
  if (s.mode !== 'round_robin') return null
  const { data: agents } = await service.from('profiles').select('id').eq('role', 'agent').eq('is_active', true)
  if (!agents?.length) return null
  const { data: counts } = await service.from('leads').select('assigned_to')
  const tally = {}
  for (const a of agents) tally[a.id] = (counts || []).filter((c) => c.assigned_to === a.id).length
  return agents.sort((a, b) => tally[a.id] - tally[b.id])[0].id
}

// ── misc ─────────────────────────────────────────────────────
export function baseUrl(url) {
  return process.env.SITE_URL || url.origin
}
export const today = () => new Date().toISOString().slice(0, 10)
export const isoDayStart = () => new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').toISOString()
