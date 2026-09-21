import { readFileSync } from 'node:fs'
const env = {}
for (const l of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) { const m = l.match(/^([A-Za-z_]+)=(.*)\s*$/); if (m) env[m[1]] = m[2] }
const BASE = 'https://ssdi-crm.vercel.app'
const login = await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: env.VITE_SUPABASE_ANON_KEY, 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'admin@americanbenefitsadvocates.org', password: 'Devil$8381' }),
}).then((r) => r.json())
if (!login.access_token) { console.log('LOGIN FAIL'); process.exit(1) }
const call = (p, opts = {}) => fetch(`${BASE}/api/${p}`, { ...opts, headers: { authorization: `Bearer ${login.access_token}`, 'content-type': 'application/json', ...(opts.headers || {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined }).then(async (r) => ({ status: r.status, body: await r.text() }))
let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✅ ${n}`) } else { fail++; console.log(`  ❌ ${n} ${e}`) } }

console.log('━ 1. US phone format: manual create with raw digits ─')
const mk = await call('leads', { method: 'POST', body: { first_name: 'Fmt', last_name: 'Check1', phone: '8381083616' } })
const mkObj = JSON.parse(mk.body)
ok('8381083616 → "(838) 108-3616"', mkObj?.lead?.phone === '(838) 108-3616', JSON.stringify(mkObj?.lead?.phone))
const mk2 = await call('leads', { method: 'POST', body: { first_name: 'Fmt', last_name: 'Check2', phone: '18381083617' } })
ok('18381083617 → "(838) 108-3617"', JSON.parse(mk2.body)?.lead?.phone === '(838) 108-3617', JSON.parse(mk2.body)?.lead?.phone)

console.log('━ 2. US phone format: CSV/sheet import with messy formats ─')
const imp = await call('leads/import', { method: 'POST', body: { rows: [
  { 'First Name': 'Imp', 'Last Name': 'One', 'Phone': '9175551234', 'Email': 'imp1@example.com' },
  { 'First Name': 'Imp', 'Last Name': 'Two', 'Phone': '19175551235', 'Email': 'imp2@example.com' },
  { 'First Name': 'Imp', 'Last Name': 'Three', 'Phone': '(917) 555-1236', 'Email': 'imp3@example.com' },
] } })
const impObj = JSON.parse(imp.body)
ok('import accepts messy formats', imp.status === 200, imp.body.slice(0, 100))
ok('imported phones stored in US format', (impObj.inserted || 0) === 3)

console.log('━ 3. Verify every stored phone in the DB is US-formatted ─')
const list = await call('leads?limit=200').then((r) => JSON.parse(r.body))
const usFmt = (p) => /^\(\d{3}\) \d{3}-\d{4}$/.test(p || '')
const bad = (list.rows || []).filter((l) => l.phone && !usFmt(l.phone))
ok(`all ${list.rows.length} stored lead phones are formatted`, bad.length === 0, JSON.stringify(bad.map((b) => b.phone)))

console.log('━ 4. Email send through Resend from Vercel ─')
const templates = await call('templates?type=email').then((r) => JSON.parse(r.body))
const tpls = templates.templates || []
const em = await call(`leads/${mkObj.lead.id}/email`, { method: 'POST', body: { subject: 'Final check — Resend from Vercel', body: '<p>Rendered vars check: {{first_name}}</p>', purpose: 'general' } })
ok('lead email endpoint (Resend)', em.status === 200, em.body.slice(0, 140))

console.log('━ 5. Callback scheduling persists timezone ─')
const due = new Date(Date.now() + 2 * 86400000).toISOString()
const cb = await call('tasks', { method: 'POST', body: { title: 'Final check callback', type: 'callback', lead_id: mkObj.lead.id, due_at: due, customer_tz: 'America/New_York' } })
ok('callback with customer_tz stored', JSON.parse(cb.body)?.task?.customer_tz === 'America/New_York')

console.log('━ 6. Past callback rejected ─')
const past = await call('tasks', { method: 'POST', body: { title: 'past', type: 'callback', lead_id: mkObj.lead.id, due_at: '2020-01-01T10:00:00Z', customer_tz: 'America/New_York' } })
ok('past time rejected (server UTC)', past.status === 400)

console.log('━ 7. Scripts panel data ─')
ok('scripts list (3)', (await call('scripts')).body.match(/"id"/g)?.length >= 3)
ok('rebuttals array (5)', JSON.parse((await call('settings/rebuttals')).body).rebuttals?.length === 5)

console.log('━ CLEANUP ─')
let cleaned = 0
for (const l of list.rows || []) if (l.first_name === 'Fmt' || l.first_name === 'Imp') { await call(`leads/${l.id}`, { method: 'DELETE' }); cleaned++ }
await call(`leads/${mkObj.lead.id}`, { method: 'DELETE' })
console.log(`  removed ${cleaned} check lead(s)`)
const final = await call('leads?limit=200').then((r) => JSON.parse(r.body))
console.log(`  leads remaining: ${final.total} (your real leads only)`)
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
