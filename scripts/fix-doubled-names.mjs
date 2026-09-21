import { readFileSync } from 'node:fs'
const env = {}
for (const l of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) { const m = l.match(/^([A-Za-z_]+)=(.*)\s*$/); if (m) env[m[1]] = m[2] }
const { createClient } = await import('@supabase/supabase-js')
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const cleanName = (first, last) => {
  let f = String(first || '').trim()
  let l = String(last || '').trim()
  if (f && l) {
    const esc = l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    f = f.replace(new RegExp('\\s*' + esc + '\\s*$', 'i'), '').trim()
  }
  const tc = (s) => (s && s === s.toLowerCase()) ? s.replace(/\b\w/g, (c) => c.toUpperCase()) : s
  return { first: tc(f), last: tc(l) }
}
;(async () => {
  const { data: leads } = await sb.from('leads').select('id,first_name,last_name')
  let fixed = 0
  for (const l of leads || []) {
    const n = cleanName(l.first_name, l.last_name)
    if (n.first !== l.first_name || n.last !== l.last_name) {
      await sb.from('leads').update({ first_name: n.first, last_name: n.last }).eq('id', l.id)
      console.log('fixed:', JSON.stringify(l.first_name), '+', JSON.stringify(l.last_name), '→', JSON.stringify(n.first), '+', JSON.stringify(n.last))
      fixed++
    }
  }
  console.log('fixed', fixed, 'lead(s)')
})()
