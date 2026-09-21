import { readFileSync } from 'node:fs'
const env = {}
for (const l of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) { const m = l.match(/^([A-Za-z_]+)=(.*)\s*$/); if (m) env[m[1]] = m[2] }
const { createClient } = await import('@supabase/supabase-js')
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const BACKSLASH = String.fromCharCode(92)
;(async () => {
  const { data: leads } = await sb.from('leads').select('id,first_name,last_name,phone')
  let removed = 0
  for (const l of leads || []) {
    if (String(l.first_name).includes(BACKSLASH)) { await sb.from('leads').delete().eq('id', l.id); removed++; console.log('removed junk lead:', JSON.stringify(l.first_name), l.phone) }
  }
  const { count } = await sb.from('leads').select('id', { count: 'exact', head: true })
  console.log('leads remaining:', count)
})()
