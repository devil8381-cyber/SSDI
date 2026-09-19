// API QA suite: auth gates, role enforcement, validation, CRUD integrity.
// Run: node scripts/api-qa.mjs  (against localhost:8888)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const env = {}
for (const line of readFileSync(ROOT + '.env', 'utf8').split('\n')) {
  const m = line.match(/^([A-Za-z_]+)=(.*)\s*$/)
  if (m) env[m[1]] = m[2]
}
const BASE = 'http://localhost:8888/api'
let pass = 0, fail = 0
const failures = []
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; failures.push(name + (extra ? ` — ${extra}` : '')); console.log(`  ❌ ${name} ${extra}`) }
}

async function login(email, password) {
  const r = await fetch(`https://uiluziqncdfsxyungyta.supabase.co/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: env.VITE_SUPABASE_ANON_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }).then((r) => r.json())
  if (!r.access_token) throw new Error(`login failed for ${email}`)
  return r.access_token
}
const admin = await login('admin@demo.com', 'admin123')
const agent = await login('sarah@demo.com', 'agent123')
const RUN = Date.now().toString(36).slice(-4) // unique suffix per run — no cross-run collisions

async function call(path, { method = 'GET', token = admin, body } = {}) {
  const r = await fetch(`${BASE}/${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await r.text()
  let data
  try { data = JSON.parse(text) } catch { data = text }
  return { status: r.status, data }
}

console.log('\n━ 0. PRE-CLEAN (remove leftovers from previous runs) ─')
{
  const all = await call('leads?limit=200')
  let cleaned = 0
  for (const l of (all.data?.rows || [])) {
    if (l.first_name === 'QA' || l.phone === '999' || (!l.first_name && !l.last_name)) {
      await call(`leads/${l.id}`, { method: 'DELETE' })
      cleaned++
    }
  }
  console.log(`  removed ${cleaned} leftover QA lead(s)`)
}

console.log('\n━ 1. AUTH GATES ─')
for (const ep of ['leads', 'tasks', 'dashboard', 'users', 'smtp', 'queue', 'me']) {
  const r = await call(ep, { token: null })
  ok(`GET ${ep} unauthed → 401`, r.status === 401, `got ${r.status}`)
}
ok('client-log public', (await call('client-log', { method: 'POST', token: null, body: { kind: 'qa', message: 'qa' } })).status === 200)
ok('setup/status public', (await call('setup/status', { token: null })).status === 200)

console.log('\n━ 2. ROLE ENFORCEMENT (agent hitting admin-only writes) ─')
const adminOnly = [
  ['POST', 'users', { email: 'qa-hack@demo.com', password: 'x', name: 'Hacker', role: 'admin' }],
  ['POST', 'smtp', { name: 'qa-hack', host: 'x', port: 587, user: 'x', pass: 'x' }],
  ['PUT', 'settings/targets', { weekly_signed: 5 }],
  ['PUT', 'settings/rebuttals', { rebuttals: [] }],
  ['PUT', 'drive/settings', { root_folder_id: 'hack' }],
  ['PUT', 'meta/settings', { pixel_id: 'hack' }],
  ['PUT', 'settings/call', { scheme: 'tel' }],
  ['PUT', 'settings/welcome-email', { enabled: false }],
  ['PUT', 'settings/sheets', { sheet_url: 'https://x' }],
  ['PUT', 'settings/followup-rules', { rules: [] }],
  ['PUT', 'settings/auto-assign', { mode: 'off' }],
]
for (const [method, ep, body] of adminOnly) {
  const r = await call(ep, { method, token: agent, body })
  ok(`${method} ${ep} as agent → 403`, r.status === 403, `got ${r.status} ${JSON.stringify(r.data).slice(0, 80)}`)
}
ok('GET templates as agent → 200 (readable)', (await call('templates', { token: agent })).status === 200)
ok('GET scripts as agent → 200', (await call('scripts', { token: agent })).status === 200)
ok('GET users/agents as agent → 200', (await call('users/agents', { token: agent })).status === 200)

console.log('\n━ 3. LEADS — validation + CRUD ─')
ok('POST leads completely empty → 400', (await call('leads', { method: 'POST', body: {} })).status === 400)
const mk = await call('leads', { method: 'POST', body: { first_name: 'QA', last_name: 'DeleteMe', phone: '5550001111', email: `qa.delete-${RUN}@example.com`, state: 'TX', dob: '1980-01-01' } })
ok('POST leads valid → 201/200', [200, 201].includes(mk.status), `got ${mk.status} ${JSON.stringify(mk.data).slice(0, 100)}`)
const leadId = mk.data?.lead?.id || mk.data?.id
ok('created lead has id', !!leadId)
const dup = await call('leads', { method: 'POST', body: { first_name: 'QA', last_name: 'Dup', phone: '5550001111', email: `qa.delete-${RUN}@example.com` } })
ok('POST duplicate phone/email → rejected (400/409)', [400, 409].includes(dup.status), `got ${dup.status}`)
ok('bad disposition PATCH → 400', (await call(`leads/${leadId}`, { method: 'PATCH', body: { disposition: 'Hacked' } })).status === 400)
ok('PATCH lead names → 200', (await call(`leads/${leadId}`, { method: 'PATCH', body: { first_name: 'QA2' } })).status === 200)
const detail = await call(`leads/${leadId}`)
ok('GET lead detail aggregates activities/emails', detail.status === 200 && Array.isArray(detail.data?.activities), `status ${detail.status}`)
ok('intake sanitize: 101 keys → still 200', (await call(`leads/${leadId}`, { method: 'PATCH', body: { intake: Object.fromEntries(Array.from({ length: 101 }, (_, i) => ['k' + i, 'v'])) } })).status === 200)
ok('huge intake value truncated not 500', (await call(`leads/${leadId}`, { method: 'PATCH', body: { intake: { big: 'x'.repeat(3000) } } })).status === 200)
ok('note POST → 200', (await call(`leads/${leadId}/note`, { method: 'POST', body: { text: 'qa note' } })).status === 200)
ok('call log POST → 200', (await call(`leads/${leadId}/call`, { method: 'POST', body: { outcome: 'vm' } })).status === 200)
ok('neighbors → 200', (await call(`leads/${leadId}/neighbors`)).status === 200)
ok('GET leads/404 → 404', (await call('leads/00000000-0000-0000-0000-000000000000')).status === 404)
ok('DELETE lead → 200', (await call(`leads/${leadId}`, { method: 'DELETE' })).status === 200)
ok('deleted lead GET → 404', (await call(`leads/${leadId}`)).status === 404)

console.log('\n━ 4. TASKS — CRUD ─')
const badTask = await call('tasks', { method: 'POST', body: {} })
ok('POST tasks empty → 400', badTask.status === 400, `got ${badTask.status}`)
const t = await call('tasks', { method: 'POST', body: { title: 'QA task', type: 'callback', due_at: new Date(Date.now() + 864e5).toISOString() } })
ok('POST tasks → 200/201', [200, 201].includes(t.status), `got ${t.status} ${JSON.stringify(t.data).slice(0, 100)}`)
const taskId = t.data?.task?.id || t.data?.id
ok('PATCH task done → 200', taskId ? (await call(`tasks/${taskId}`, { method: 'PATCH', body: { status: 'done' } })).status === 200 : false)
ok('PATCH task bogus status → 400', taskId ? (await call(`tasks/${taskId}`, { method: 'PATCH', body: { status: 'zzz' } })).status === 400 : false)
ok('DELETE task → 200', taskId ? (await call(`tasks/${taskId}`, { method: 'DELETE' })).status === 200 : false)

console.log('\n━ 5. TEMPLATES & SCRIPTS — admin-gated CRUD ─')
ok('POST template as agent → 403', (await call('templates', { method: 'POST', token: agent, body: { name: 'x', body: 'x' } })).status === 403)
const tpl = await call('templates', { method: 'POST', body: { name: 'QA tpl', type: 'email', subject: 'QA', body: 'hi {{first_name}}' } })
ok('POST template → 200/201', [200, 201].includes(tpl.status), `got ${tpl.status}`)
const tplId = tpl.data?.template?.id || tpl.data?.id
ok('PATCH template → 200', tplId ? (await call(`templates/${tplId}`, { method: 'PATCH', body: { name: 'QA tpl2' } })).status === 200 : false)
ok('DELETE template → 200', tplId ? (await call(`templates/${tplId}`, { method: 'DELETE' })).status === 200 : false)
const scr = await call('scripts', { method: 'POST', body: { title: 'QA script', type: 'general', body: 'script' } })
ok('POST script → 200/201', [200, 201].includes(scr.status), `got ${scr.status}`)
const scrId = scr.data?.script?.id || scr.data?.id
ok('DELETE script → 200', scrId ? (await call(`scripts/${scrId}`, { method: 'DELETE' })).status === 200 : false)

console.log('\n━ 6. USERS ─')
ok('POST users missing email → 400', (await call('users', { method: 'POST', body: { name: 'x' } })).status === 400)
const u = await call('users', { method: 'POST', body: { name: 'QA User', email: `qa-user-${RUN}@demo.com`, password: 'QaPass123!', role: 'agent', phone: '5551230000', max_leads: 10 } })
ok('POST users valid → 200/201', [200, 201].includes(u.status), `got ${u.status} ${JSON.stringify(u.data).slice(0, 120)}`)
const uid = u.data?.user?.id || u.data?.id
if (uid) {
  ok('PATCH user max_leads → 200', (await call(`users/${uid}`, { method: 'PATCH', body: { max_leads: 25 } })).status === 200)
  ok('PATCH user max_leads string "abc" → 400', (await call(`users/${uid}`, { method: 'PATCH', body: { max_leads: 'abc' } })).status === 400)
  ok('DELETE/PATCH cleanup → 2xx', [200, 204].includes((await call(`users/${uid}`, { method: 'PATCH', body: { is_active: false } })).status))
} else ok('user created with id', false)

console.log('\n━ 7. SMTP ─')
const smtpList = await call('smtp')
ok('GET smtp masks passwords', smtpList.status === 200 && JSON.stringify(smtpList.data).toLowerCase().includes('devil') === false)
const smtpQa = await call('smtp', { method: 'POST', body: { name: 'QA smtp', host: 'smtp.invalid', port: 587, username: 'qa@invalid', password: 'x', purpose: 'general', from_email: 'qa@invalid' } })
ok('POST smtp → 200/201', [200, 201].includes(smtpQa.status), `got ${smtpQa.status}`)
const smtpId = smtpQa.data?.profile?.id || smtpQa.data?.id
if (smtpId) {
  const st = await call(`smtp/${smtpId}/test`, { method: 'POST', body: { to_email: 'qa@invalid' } })
  ok('smtp test with fake host → graceful error (not 500)', st.status < 500, `got ${st.status} ${JSON.stringify(st.data).slice(0, 100)}`)
  ok('DELETE smtp → 200', (await call(`smtp/${smtpId}`, { method: 'DELETE' })).status === 200)
}

console.log('\n━ 8. DOCS — public flow security ─')
const lead2 = await call('leads', { method: 'POST', body: { first_name: 'QA', last_name: 'Docs', phone: '5550002222', email: 'qa.docs@example.com' } })
const lead2Id = lead2.data?.lead?.id || lead2.data?.id
const dr = await call(`leads/${lead2Id}/doc-request`, { method: 'POST', body: { doc_types: ['id'] } })
ok('doc-request created with token', dr.status === 200 && !!dr.data?.request?.token, `got ${dr.status}`)
const token = dr.data?.request?.token
ok('GET doc/:token unauthed → 200 (public)', (await call(`doc/${token}`, { token: null })).status === 200)
ok('GET doc/badtoken → 404', (await call('doc/not-a-real-token', { token: null })).status === 404)
const upBad = await call(`doc/${token}/upload-url`, { method: 'POST', token: null, body: { filename: '../../evil.exe', size: 100, type: 'application/octet-stream' } })
ok('upload-url sanitizes traversal filename (no ../ in path)', upBad.status === 200 && !String(upBad.data?.path || '').includes('..'), `got ${upBad.status} ${JSON.stringify(upBad.data?.path)}`)
const upBig = await call(`doc/${token}/upload-url`, { method: 'POST', token: null, body: { filename: 'a.pdf', size: 30 * 1024 * 1024, type: 'application/pdf' } })
ok('upload-url 30MB rejected → 400', upBig.status === 400, `got ${upBig.status}`)
const upOk = await call(`doc/${token}/upload-url`, { method: 'POST', token: null, body: { filename: 'id.pdf', size: 1000, type: 'application/pdf' } })
ok('upload-url valid → 200 + signed url', upOk.status === 200 && !!upOk.data?.signed_url, `got ${upOk.status}`)
await call(`leads/${lead2Id}`, { method: 'DELETE' })

console.log('\n━ 9. META WEBHOOK ─')
const challenge = await call('meta/webhook?hub.mode=subscribe&hub.challenge=QA123&hub.verify_token=wrong', { token: null })
ok('webhook verify wrong token → rejected', !(challenge.data === 'QA123' || challenge.data?.hub?.challenge === 'QA123'), JSON.stringify(challenge.data).slice(0, 60))
const challenge2 = await call('meta/webhook?hub.mode=subscribe&hub.challenge=QA123&hub.verify_token=cd997aea272c29137a04d73bff0f304d', { token: null })
ok('webhook verify correct token → echoes challenge', String(challenge2.data ?? JSON.stringify(challenge2.data)).includes('QA123'), JSON.stringify(challenge2.data).slice(0, 60))
const sig = await call('meta/webhook', { method: 'POST', token: null, body: { object: 'page', entry: [] }, headers2: {} })
ok('webhook POST unsigned → rejected (403/503)', [403, 503].includes(sig.status), `got ${sig.status}`)

console.log('\n━ 10. SHEETS PUSH + IMPORT ─')
ok('sheets/push bad token → 401', [401,403].includes((await call('sheets/push?token=wrong', { method: 'POST', token: null, body: { first_name: 'X' } })).status))
const push = await call(`sheets/push?token=${'f56ad8427237431ba8834715c7456f4183e10e0e3153450d93083d56d882333a'}`, { method: 'POST', token: null, body: { 'First Name': 'QA', 'Last Name': 'Push', 'Phone': '5550003333', 'Email': 'qa.push@example.com' } })
ok('sheets/push valid → 200 imported:1', push.status === 200 && (push.data?.inserted === 1 || push.data?.duplicates === 1), `got ${push.status} ${JSON.stringify(push.data).slice(0, 100)}`)
ok('sheets/push dedupe on repeat → duplicates:1', (await call(`sheets/push?token=${'f56ad8427237431ba8834715c7456f4183e10e0e3153450d93083d56d882333a'}`, { method: 'POST', token: null, body: { 'First Name': 'QA', 'Last Name': 'Push', 'Phone': '5550003333' } })).data?.duplicates === 1)
ok('import empty rows → 400', (await call('leads/import', { method: 'POST', body: { rows: [] } })).status === 400)
const imp = await call('leads/import', { method: 'POST', body: { rows: [{ 'First Name': 'QA', 'Last Name': 'Imp1', 'Phone': '5550004444', 'Email': 'qa.imp1@example.com' }, { 'First Name': 'QA', 'Last Name': 'Imp2', 'Phone': '5550005555' }] } })
ok('import 2 rows → imported:2', imp.status === 200 && imp.data?.inserted === 2, `got ${imp.status} ${JSON.stringify(imp.data).slice(0, 100)}`)

console.log('\n━ 11. MISC — search, queue, dashboard, settings ─')
ok('search?q= → 200', (await call('search?q=QA')).status === 200)
ok('queue → 200', (await call('queue', { token: agent })).status === 200)
const dash = await call('dashboard')
ok('dashboard shape (team/attention/leaderboard)', dash.status === 200 && !!dash.data?.team, `got ${dash.status}`)
ok('settings/call PUT bogus scheme → 400', (await call('settings/call', { method: 'PUT', body: { scheme: 'hack' } })).status === 400)
ok('settings/call PUT phound → 200', (await call('settings/call', { method: 'PUT', body: { scheme: 'phound' } })).status === 200)
ok('heartbeat → 200', (await call('heartbeat', { method: 'POST' })).status === 200)
ok('notifications GET → 200', (await call('notifications', { token: agent })).status === 200)

// cleanup QA data
console.log('\n━ CLEANUP ─')
const all = await call('leads?limit=200')
let cleaned = 0
for (const l of (all.data?.rows || [])) {
  if (l.first_name === 'QA' || l.phone === '999' || (!l.first_name && !l.last_name)) { await call(`leads/${l.id}`, { method: 'DELETE' }); cleaned++ }
}
console.log(`  cleaned ${cleaned} QA lead(s)`)

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n${pass} passed, ${fail} failed`)
if (failures.length) { console.log('\nFAILURES:'); failures.forEach((f) => console.log('  - ' + f)) }
process.exit(fail ? 1 : 0)
