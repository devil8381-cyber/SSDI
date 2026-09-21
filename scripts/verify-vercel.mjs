import { readFileSync } from 'node:fs'
const env = {}
for (const l of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) { const m = l.match(/^([A-Za-z_]+)=(.*)\s*$/); if (m) env[m[1]] = m[2] }
const BASE = process.argv[2] || 'https://ssdi-mariaquissaque-9632s-projects.vercel.app'
const login = await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: env.VITE_SUPABASE_ANON_KEY, 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'admin@americanbenefitsadvocates.org', password: 'Devil$8381' }),
}).then((r) => r.json())
if (!login.access_token) { console.log('LOGIN FAIL'); process.exit(1) }
const call = (p) => fetch(`${BASE}/api/${p}`, { headers: { authorization: `Bearer ${login.access_token}` } }).then(async (r) => ({ status: r.status, body: await r.text() }))
console.log('me:            ', (await call('me')).status, JSON.parse((await call('me')).body).profile?.email)
console.log('leads:         ', JSON.stringify(await call('leads?limit=3')).slice(0, 80))
console.log('dashboard:     ', (await call('dashboard')).status)
console.log('queue:         ', (await call('queue')).status)
console.log('settings/call: ', (await call('settings/call')).body.slice(0, 60))
console.log('cron sheets:   ', JSON.stringify(await call('cron/sheets-sync')).slice(0, 60))
console.log('pixel:         ', (await call('track-open?t=x')).status)
