// Full CRM smoke test — exercises every endpoint against a running instance.
//   node scripts/smoke-test.mjs   (BASE/EMAIL/PASS env optional)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = process.env.BASE || 'http://localhost:8888'
const EMAIL = process.env.EMAIL || 'admin@demo.com'
const PASS = process.env.PASS || 'admin123'
const env = Object.fromEntries(
  fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env'), 'utf8')
    .split(/\r?\n/).filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
)
const SURL = process.env.SUPABASE_URL || env.SUPABASE_URL
const SKEY = process.env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY

let token, pass = 0, fail = 0, failures = []
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  OK  ${name}`) }
  else { fail++; failures.push(name); console.log(`  XX  ${name} ${extra}`) }
}
const req = async (method, p, body) => {
  const r = await fetch(`${BASE}/api${p}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}

console.log(`Smoke-testing ${BASE} as ${EMAIL}`)

{ const r = await fetch(`${SURL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: SKEY, 'content-type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASS }) })
  const j = await r.json(); token = j.access_token
  ok('auth: sign in', !!token, j.error_description || '') }
{ const { status, data } = await req('GET', '/me')
  ok('auth: /me returns admin profile', status === 200 && data.profile?.role === 'admin') }
{ const { status, data } = await req('GET', '/dashboard')
  ok('dashboard: stats + targets + activity', status === 200 && data.totals && data.targets && data.todayActivity) }
{ const { status, data } = await req('GET', '/queue')
  ok('queue: prioritized items', status === 200 && Array.isArray(data.items)) }
{ const { status, data } = await req('GET', '/search?q=a')
  ok('search: results', status === 200 && Array.isArray(data.results)) }
{ const { status, data } = await req('GET', '/notifications')
  ok('notifications: list', status === 200 && Array.isArray(data.notifications)) }

let leadId
{ const { status, data } = await req('POST', '/leads', { first_name: 'Smoke', last_name: 'Test', phone: '5550101', email: 'smoke@test.com', state: 'TX', address: '1 Test St', zip: '73301' })
  leadId = data.lead?.id
  ok('leads: create (address/zip — needs migration)', status === 200 && !!leadId, data.error || '') }
{ const { status, data } = await req('GET', '/leads?limit=5')
  ok('leads: list', status === 200 && (data.rows?.length || 0) > 0) }
{ const { status, data } = await req('PATCH', `/leads/${leadId}`, { disposition: 'VM', intake: { q1: 'No', q3: 'No, not since 2020', q7: 'Chronic back pain' }, notes: 'smoke note' })
  ok('leads: update disposition + intake', status === 200 && data.lead?.disposition === 'VM', data.error || '') }
{ const { status, data } = await req('GET', `/leads/${leadId}`)
  ok('rules: VM auto-created follow-up task', status === 200 && (data.tasks || []).some((t) => t.title.includes('VM follow-up')))
  ok('leads: detail has intake answers', (data.lead?.intake?.q7 || '') === 'Chronic back pain') }
{ const { status } = await req('GET', `/leads/${leadId}/neighbors`)
  ok('leads: neighbors', status === 200) }
{ const { status } = await req('POST', `/leads/${leadId}/note`, { text: 'smoke note' })
  ok('leads: quick note', status === 200) }
{ const { status } = await req('POST', `/leads/${leadId}/call`)
  ok('leads: call log', status === 200) }
{ const { status, data } = await req('POST', '/leads/bulk-disposition', { ids: [leadId], disposition: 'Callback' })
  ok('leads: bulk disposition', status === 200 && data.count === 1, data.error || '') }
{ const { status, data } = await req('POST', '/leads/import', { rows: [{ first_name: 'Imp', last_name: 'One', phone: '5550202' }, { first_name: 'Imp', last_name: 'Two', phone: '5550203' }] })
  ok('leads: CSV import', status === 200 && data.inserted === 2, data.error || '') }
{ const { status, data } = await req('GET', '/leads/stale?days=1')
  ok('leads: stale detection', status === 200 && typeof data.total === 'number') }
{ const { status } = await req('POST', '/leads/assign', { ids: [leadId], agent_id: null })
  ok('leads: bulk assign', status === 200) }

let taskId
{ const { status, data } = await req('POST', '/tasks', { title: 'Smoke task', type: 'callback' })
  taskId = data.task?.id
  ok('tasks: create', status === 200 && !!taskId) }
{ const { status } = await req('PATCH', `/tasks/${taskId}`, { status: 'done' })
  ok('tasks: complete', status === 200) }
{ const { status, data } = await req('GET', '/templates?type=text')
  ok('templates: 5-day cadence seeded', status === 200 && (data.templates || []).some((t) => t.name.includes('Day 1 — Voicemail (1st attempt)'))) }
{ const { status, data } = await req('GET', '/scripts?type=intake')
  ok('scripts: intake script seeded', status === 200 && (data.scripts || []).some((s) => s.title.includes('33 Questions'))) }
{ const { status, data } = await req('GET', '/settings/rebuttals')
  ok('rebuttals: library loaded', status === 200 && (data.rebuttals || []).length >= 8) }
for (const [key, body] of [['auto-assign', { mode: 'round_robin' }], ['followup-rules', { rules: [{ disposition: 'VM', title: 'Call again — VM follow-up', days: 2, type: 'callback' }] }], ['targets', { calls: 40, dispositions: 10 }]]) {
  const { status } = await req('PUT', `/settings/${key}`, body)
  ok(`settings: PUT ${key}`, status === 200)
}

let docToken
{ const { status, data: dr } = await req('POST', `/leads/${leadId}/doc-request`, { doc_types: ['Government photo ID'], message: 'smoke' })
  docToken = dr.request?.token
  ok('docs: create secure request', status === 200 && !!docToken, dr.error || '')
  if (docToken) {
    const pub = await fetch(`${BASE}/api/doc/${docToken}`)
    ok('docs: public claimant view', pub.status === 200)
    const ur = await req('POST', `/doc/${docToken}/upload-url`, { file_name: 'smoke.pdf', doc_type: 'Government photo ID' })
    if (ur.status === 200) {
      const put = await fetch(ur.data.signed_url, { method: 'PUT', body: Buffer.from('%PDF-1.4 smoke') })
      const c = put.ok ? await req('POST', `/doc/${docToken}/confirm`, { path: ur.data.path, doc_type: 'Government photo ID', file_name: 'smoke.pdf', size: 14 }) : { status: put.status }
      ok('docs: claimant upload + confirm', c.status === 200, `status ${c.status}`)
    } else ok('docs: upload-url', false, `status ${ur.status}`)
  } }

{ const { status, data: rec } = await req('POST', `/leads/${leadId}/recordings`, { type: 'frontend', file_name: 'smoke.mp3' })
  const recorded = status === 200 && !!rec.recording
  ok('recordings: signed upload slot', recorded, rec.error || '')
  if (recorded) {
    await fetch(rec.signed_url, { method: 'PUT', body: Buffer.from('smoke-audio') })
    const c = await req('POST', '/recordings/confirm', { recording_id: rec.recording.id })
    ok('recordings: confirm (Drive unconfigured handled gracefully)', c.status === 200)
    await req('DELETE', `/recordings/${rec.recording.id}`)
  } }

{ const { status, data } = await req('GET', '/meta/settings')
  ok('meta: settings read', status === 200 && 'webhook_url' in data)
  const wv = await fetch(`${BASE}/api/meta/webhook?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(env.META_VERIFY_TOKEN || 'x')}&hub.challenge=42`)
  ok('meta: webhook verify', wv.status === 200 && (await wv.text()).includes('42')) }

let smtpId
{ const { status, data } = await req('POST', '/smtp', { name: 'Smoke SMTP', purpose: 'general', host: 'smtp.test.local', port: 587, username: 'u', password: 'p', from_email: 't@t.com' })
  smtpId = data.profile?.id
  ok('smtp: create profile', status === 200 && !!smtpId, data.error || '')
  const l = await req('GET', '/smtp'); ok('smtp: list', l.status === 200) }

{ const { status, data } = await req('GET', '/users')
  ok('users: list', status === 200 && (data.users || []).length > 0)
  const email = `smoke${Date.now()}@test.com`
  const nu = await req('POST', '/users', { name: 'Smoke Agent', email, password: 'smoke123', role: 'agent' })
  ok('users: create', nu.status === 200 && !!nu.data.user?.id, nu.data.error || '')
  if (nu.data.user?.id) { const p = await req('PATCH', `/users/${nu.data.user.id}`, { is_active: false }); ok('users: deactivate', p.status === 200) } }

{ const { status } = await req('POST', '/heartbeat', { seconds: 60 })
  ok('system: heartbeat', status === 200) }
{ const r = await fetch(`${BASE}/.netlify/functions/track-open?t=x`)
  ok('system: open-tracking pixel', r.status === 200 && (r.headers.get('content-type') || '').includes('gif')) }
{ const { status, data } = await req('POST', '/leads/import', { rows: [] })
  ok('validation: empty import rejected cleanly', status === 400 && !!data.error) }

// cleanup
await req('DELETE', `/leads/${leadId}`)
if (smtpId) await req('DELETE', `/smtp/${smtpId}`)
{ const { data } = await req('GET', '/tasks?status=all&scope=all')
  for (const t of (data.tasks || []).filter((x) => x.title === 'Smoke task')) await req('DELETE', `/tasks/${t.id}`) }
{ const { data } = await req('GET', '/leads?limit=200')
  for (const row of (data.rows || []).filter((r) => ['5550202', '5550203'].includes(String(r.phone).slice(-7)))) await req('DELETE', `/leads/${row.id}`) }
console.log('  (test data cleaned up)')

console.log('==============================')
console.log(`  RESULT: ${pass} passed, ${fail} failed`)
if (fail) { console.log('  FAILED: ' + failures.join(' | ')); process.exit(1) }
console.log('  ALL SYSTEMS GO')
