// Seeds the assignment welcome-email template.  node scripts/seed-welcome.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const env = Object.fromEntries(
  fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
)
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const tpl = {
  type: 'email',
  name: 'Agent Assigned — Welcome (ABA)',
  subject: 'Your specialist has been assigned — American Benefits Advocates',
  body: `<p>Hi <strong>{{first_name}}</strong>,</p>
<p>Great news — your SSDI file is moving forward. Your assigned specialist is <strong>{{agent_name}}</strong>{{agent_phone}} and will be calling you to review your case, answer your questions, and walk you through next steps.</p>
<p>Please keep your phone nearby — and reply to this email if you have any questions in the meantime.</p>
<p>American Benefits Advocates</p>`,
}

const { data: existing } = await sb.from('templates').select('id').eq('name', tpl.name).maybeSingle()
const { error } = existing
  ? await sb.from('templates').update(tpl).eq('id', existing.id)
  : await sb.from('templates').insert(tpl)
if (error) { console.error('✖', error.message); process.exit(1) }
console.log('✅ Welcome template seeded (Agent Assigned — Welcome (ABA))')
