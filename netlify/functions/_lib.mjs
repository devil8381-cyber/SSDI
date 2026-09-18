import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'
import nodemailer from 'nodemailer'
import { google } from 'googleapis'

export const service = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

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
  const ids = (userIds || []).filter(Boolean)
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
export async function sendLeadEmail({ lead, agent, subject, html, purpose, baseUrl }) {
  const { data: profiles } = await service.from('smtp_profiles').select('*').eq('is_active', true)
  const prof =
    (profiles || []).find((p) => p.purpose === purpose) ||
    (profiles || []).find((p) => p.purpose === 'general') ||
    (profiles || [])[0]
  if (!prof) throw new Error('No active SMTP profile configured. Ask the admin to add one under Admin → SMTP.')
  const pass = decrypt(prof.password_enc)
  if (!pass) throw new Error('SMTP password could not be decrypted — check APP_ENCRYPTION_KEY')
  const transport = nodemailer.createTransport({
    host: prof.host,
    port: prof.port,
    secure: !!prof.secure,
    auth: { user: prof.username, pass },
  })
  const id = crypto.randomUUID()
  const pixel = `<img src="${baseUrl}/.netlify/functions/track-open?t=${id}" width="1" height="1" alt="" style="display:none" />`
  const vars = leadVars(lead, agent)
  const info = await transport.sendMail({
    from: prof.from_name ? `"${prof.from_name}" <${prof.from_email}>` : prof.from_email,
    to: lead.email,
    subject: render(subject, vars),
    html: render(html, vars) + pixel,
  })
  await service.from('email_messages').insert({
    id,
    lead_id: lead.id,
    sent_by: agent?.id || null,
    smtp_profile_id: prof.id,
    purpose,
    to_email: lead.email,
    subject: render(subject, vars),
    html: render(html, vars) + pixel,
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

// ── Google Drive (service account) ───────────────────────────
export function driveFor(driveSettings) {
  const sa = driveSettings?.service_account_enc ? decrypt(driveSettings.service_account_enc) : null
  if (!sa) return null
  const creds = JSON.parse(sa)
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/drive'],
  })
  return google.drive({ version: 'v3', auth })
}

export async function ensureFolder(drive, name, parentId) {
  const q = `name='${String(name).replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false${
    parentId ? ` and '${parentId}' in parents` : ''
  }`
  const { data: found } = await drive.files.list({ q, fields: 'files(id)', pageSize: 1 })
  if (found.files?.length) return found.files[0].id
  const { data: created } = await drive.files.create({
    requestBody: { name, mimeType: 'application/vnd.google-apps.folder', ...(parentId ? { parents: [parentId] } : {}) },
    fields: 'id',
  })
  return created.id
}

// ── misc ─────────────────────────────────────────────────────
export function baseUrl(url) {
  return process.env.SITE_URL || url.origin
}
export const today = () => new Date().toISOString().slice(0, 10)
export const isoDayStart = () => new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').toISOString()
