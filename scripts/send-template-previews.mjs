// Send every EMAIL template to waghmareapurva123@gmail.com from the ssdi@ profile,
// rendered with realistic sample data + a genuine secure-upload link.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const env = {}
for (const line of readFileSync(ROOT + '.env', 'utf8').split('\n')) {
  const m = line.match(/^([A-Za-z_]+)=(.*)\s*$/)
  if (m) env[m[1]] = m[2]
}
const login = await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: env.VITE_SUPABASE_ANON_KEY, 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'admin@americanbenefitsadvocates.org', password: 'Devil$8381' }),
}).then((r) => r.json())
const H = { 'content-type': 'application/json', authorization: `Bearer ${login.access_token}` }
const call = (path, opts = {}) => fetch(`http://localhost:8888/api/${path}`, { ...opts, headers: { ...H, ...(opts.headers || {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }))

// reuse the preview lead if a previous run created it (duplicate guard rejects re-creates)
let leadId
const existing = await call('leads?limit=200').then((r) => (r.data?.rows || []).find((l) => l.email === 'waghmareapurva123@gmail.com' && l.last_name === 'TemplatePreview'))
if (existing) {
  leadId = existing.id
  console.log('reusing existing preview lead:', leadId)
} else {
  const mk = await call('leads', { method: 'POST', body: { first_name: 'Apurva', last_name: 'TemplatePreview', phone: '5550009999', email: 'waghmareapurva123@gmail.com' } })
  leadId = mk.data.lead.id
  console.log('preview lead created:', leadId)
}

// genuine secure-upload link so the doc-request email's button actually works
const dr = await call(`leads/${leadId}/doc-request`, { method: 'POST', body: { doc_types: ['id', 'medical', 'work'] } })
const docLink = dr.data.url
console.log('secure link:', docLink)

const vars = {
  first_name: 'Apurva', last_name: 'TemplatePreview', email: 'waghmareapurva123@gmail.com',
  phone: '5550009999', state: 'NY', city: 'New York', age: 41,
  agent_name: 'Mark', agent_phone: '(845) 121-0152', agent_email: 'ssdi@americanbenefitsadvocates.org',
  doc_link: docLink,
}
const render = (s) => String(s || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? '')

const { data: tpl } = await call('templates')
const emailTemplates = (tpl.templates || []).filter((t) => t.type === 'email')
console.log(`sending ${emailTemplates.length} email template(s) from ssdi@…\n`)

for (const t of emailTemplates) {
  const res = await call(`leads/${leadId}/email`, {
    method: 'POST',
    body: { subject: render(t.subject), body: render(t.body), purpose: 'followups' }, // followups → ssdi@ per your rule
  })
  console.log(`${res.status === 200 ? '✅' : '❌'} ${t.name} → ${res.status === 200 ? 'sent via ' + res.data.smtp : 'FAILED: ' + JSON.stringify(res.data).slice(0, 120)}`)
}
console.log(`\nAll emails are addressed to waghmareapurva123@gmail.com from ssdi@americanbenefitsadvocates.org.`)
console.log(`The preview lead "Apurva TemplatePreview" stays in the CRM so the secure-upload link works — delete it whenever you're done checking.`)
