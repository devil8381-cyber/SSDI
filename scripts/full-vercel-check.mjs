import { readFileSync } from 'node:fs'
const env = {}
for (const l of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) { const m = l.match(/^([A-Za-z_]+)=(.*)\s*$/); if (m) env[m[1]] = m[2] }
const BASE = process.argv[2] || 'https://ssdi-mariaquissaque-9632s-projects.vercel.app'
const login = await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: env.VITE_SUPABASE_ANON_KEY, 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'admin@americanbenefitsadvocates.org', password: 'Devil$8381' }),
}).then((r) => r.json())
if (!login.access_token) { console.log('LOGIN FAIL'); process.exit(1) }
const call = (p, opts = {}) => fetch(`${BASE}/api/${p}`, { ...opts, headers: { authorization: `Bearer ${login.access_token}`, 'content-type': 'application/json', ...(opts.headers || {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined }).then(async (r) => ({ status: r.status, body: await r.text() }))

let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✅ ${n}`) } else { fail++; console.log(`  ❌ ${n} ${e}`) } }

console.log('━ SMTP from Vercel runtime ─')
const profiles = await call('smtp')
const plist = JSON.parse(profiles.body).profiles || []
const gen = plist.find((p) => p.purpose === 'general' && p.host === 'smtp.resend.com')
const doc = plist.find((p) => p.purpose === 'documentation')
ok('Resend profile present & active', !!gen && gen.is_active, JSON.stringify(plist.map((p) => [p.purpose, p.host, p.is_active])))
const genTest = await call(`smtp/${gen.id}/test`, { method: 'POST', body: { to: 'waghmareapurva123@gmail.com' } })
ok('Resend send from Vercel → Gmail (SMTP level)', genTest.status === 200, genTest.body.slice(0, 140))
const docTest = await call(`smtp/${doc.id}/test`, { method: 'POST', body: { to: 'info@americanbenefitsadvocates.org' } })
ok('consent@ (Hostinger) send from Vercel', docTest.status === 200, docTest.body.slice(0, 140))

console.log('━ Core endpoints ─')
ok('leads list', (await call('leads?limit=3')).status === 200)
ok('dashboard', (await call('dashboard')).status === 200)
ok('queue', (await call('queue')).status === 200)
ok('callbacks/upcoming', (await call('callbacks/upcoming')).status === 200)
ok('time (clock sync)', (await call('time')).status === 200)
ok('templates (18 expected)', (await call('templates')).body.match(/"id"/g)?.length >= 18)
ok('scripts (3 expected)', (await call('scripts')).body.match(/"id"/g)?.length >= 3)
ok('rebuttals present', (await call('settings/rebuttals')).body.includes('scam') || (await call('settings/rebuttals')).body.includes('title'))
ok('users list', (await call('users')).status === 200)
ok('doc-requests', (await call('doc-requests')).status === 200)
ok('notifications', (await call('notifications')).status === 200)
ok('settings/call = phound', (await call('settings/call')).body.includes('phound'))
ok('track-open pixel', (await call('track-open?t=x')).status === 200)
ok('cron/sheets-sync', JSON.parse((await call('cron/sheets-sync')).body).ok === true)

console.log('━ full CRUD roundtrip on Vercel ─')
const mk = await call('leads', { method: 'POST', body: { first_name: 'Vercel', last_name: 'Check', phone: '5554443333', email: 'vercel.check@example.com' } })
const mkObj = JSON.parse(mk.body)
const id = mkObj?.lead?.id
ok('create lead (US phone format stored)', mk.status === 200 && JSON.parse(mk.body)?.lead?.phone === '(555) 444-3333', JSON.parse(mk.body)?.lead?.phone)
ok('edit lead', (await call(`leads/${id}`, { method: 'PATCH', body: { city: 'Austin' } })).status === 200)
const dcheck = await call(`leads/${id}`)
ok('detail reflects edit', JSON.parse(dcheck.body)?.lead?.city === 'Austin')
ok('delete lead', (await call(`leads/${id}`, { method: 'DELETE' })).status === 200)
ok('deleted lead 404', (await call(`leads/${id}`)).status === 404)

console.log('━ callback scheduling on Vercel ─')
const lead2 = await call('leads', { method: 'POST', body: { first_name: 'VercelCB', last_name: 'Probe', phone: '5555556666' } })
const l2 = lead2.data?.lead?.id
const due = new Date(Date.now() + 30 * 60000).toISOString()
const cb = await call('tasks', { method: 'POST', body: { title: 'Vercel callback probe', type: 'callback', lead_id: l2, due_at: due, customer_tz: 'America/New_York' } })
ok('schedule callback with customer_tz', cb.status === 200 && JSON.parse(cb.body)?.task?.customer_tz === 'America/New_York', cb.body.slice(0, 120))
const up = await call('callbacks/upcoming')
ok('upcoming callbacks includes it (due within 45min)', JSON.parse(up.body).callbacks?.some((c) => c.title === 'Vercel callback probe'), up.body.slice(0, 120))
await call(`leads/${l2}`, { method: 'DELETE' })

console.log('━ dark mode css baked ─')
const cssAsset = JSON.stringify(await fetch(`${BASE}/`).then((r) => r.text()))
const cssFile = cssAsset.match(/assets\/index-[^"]+\.css/)?.[0]
const css = await fetch(`${BASE}/${cssFile}`).then((r) => r.text())
ok('dark body (slate-950)', css.includes('2 6 23') || css.includes('#020617'), cssFile)
ok('light bg-white absent from css', !css.includes('.bg-white{'), '')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
