import { readFileSync } from 'node:fs'
const env = {}
for (const l of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) { const m = l.match(/^([A-Za-z_]+)=(.*)\s*$/); if (m) env[m[1]] = m[2] }
const VERCEL = 'https://ssdi-crm.vercel.app'
const LOCAL = 'http://localhost:8888'
const login = await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: env.VITE_SUPABASE_ANON_KEY, 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'admin@americanbenefitsadvocates.org', password: 'Devil$8381' }),
}).then((r) => r.json())
const H = { authorization: `Bearer ${login.access_token}` }

// what a value is, recursively (arrays show element type)
const shape = (v, depth = 0) => {
  if (v === null) return 'null'
  if (Array.isArray(v)) return depth > 3 ? 'array' : `[${(v[0] === undefined ? 'empty' : shape(v[0], depth + 1))} × ${v.length}]`
  if (typeof v === 'object') {
    const keys = Object.keys(v)
    return depth > 3 ? 'object' : '{' + keys.slice(0, 12).map((k) => `${k}: ${shape(v[k], depth + 1)}`).join(', ') + '}'
  }
  return typeof v
}

const ENDPOINTS = ['dashboard', 'notifications', 'scripts?type=email', 'scripts?type=frontend', 'settings/rebuttals', 'queue', 'callbacks/upcoming', 'leads?limit=5', 'tasks', 'doc-requests', 'users', 'templates?type=email', 'me', 'settings/call', 'settings/followup-rules', 'settings/targets', 'smtp', 'settings/auto-assign', 'settings/welcome-email', 'settings/sheets', 'search?q=a']

for (const ep of ENDPOINTS) {
  let a = 'FETCH FAIL', b = 'FETCH FAIL'
  try { a = shape(await (await fetch(`${LOCAL}/api/${ep}`, { headers: H })).json()) } catch (e) { a = 'ERR ' + e.message.slice(0, 40) }
  try { b = shape(await (await fetch(`${VERCEL}/api/${ep}`, { headers: H })).json()) } catch (e) { b = 'ERR ' + e.message.slice(0, 40) }
  const same = a === b
  console.log(`${same ? '  same ' : '⚠ DIFF '} /${ep}`)
  if (!same) { console.log(`      local : ${a.slice(0, 220)}`); console.log(`      vercel: ${b.slice(0, 220)}`) }
}
