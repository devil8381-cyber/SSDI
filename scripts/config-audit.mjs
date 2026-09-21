import { readFileSync } from 'node:fs'
const env = {}
for (const l of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) { const m = l.match(/^([A-Za-z_]+)=(.*)\s*$/); if (m) env[m[1]] = m[2] }
const BASE = 'https://ssdi-crm.vercel.app'
const login = await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: env.VITE_SUPABASE_ANON_KEY, 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'admin@americanbenefitsadvocates.org', password: 'Devil$8381' }),
}).then((r) => r.json())
const call = (p) => fetch(`${BASE}/api/${p}`, { headers: { authorization: `Bearer ${login.access_token}` } }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }))

console.log('━ CONFIGURATION AUDIT ─')
for (const ep of ['settings/auto-assign', 'settings/welcome-email', 'settings/targets', 'settings/followup-rules', 'settings/sheets', 'settings/call', 'meta/settings']) {
  const r = await call(ep)
  console.log(`\n· /${ep} [${r.status}]`)
  console.log(' ', JSON.stringify(r.body).slice(0, 260))
}
const users = await call('users')
const ulist = users.body.users || []
console.log(`\n· users (${ulist.length}):`, ulist.map((u) => `${u.name}(${u.role}${u.is_active ? '' : ',INACTIVE'},cap:${u.max_leads ?? '∞'},phone:${u.phone || 'none'})`).join(', '))
const smtp = await call('smtp')
console.log('· smtp:', (smtp.body.profiles || []).map((p) => `${p.purpose}@${p.host.split('.')[0]}(limit:${p.daily_limit}${p.is_active ? '' : ',off'})`).join(', '))
