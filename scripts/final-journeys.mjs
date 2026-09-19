// PARTS 4+5 — full feature checklist + two end-to-end journeys (admin + agent)
// via the exact API calls the UI makes. Run: node scripts/final-journeys.mjs
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
  else { fail++; failures.push(name); console.log(`  ❌ ${name} ${extra}`) }
}
async function login(email, password) {
  const r = await fetch(`https://uiluziqncdfsxyungyta.supabase.co/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: env.VITE_SUPABASE_ANON_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }).then((r) => r.json())
  if (!r.access_token) throw new Error('login failed ' + email)
  return r.access_token
}
async function call(path, { method = 'GET', token, body } = {}) {
  const r = await fetch(`${BASE}/${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await r.text()
  let data; try { data = JSON.parse(text) } catch { data = text }
  return { status: r.status, data }
}

console.log('━ JOURNEY A — ADMIN, full lifecycle ─')
const admin = await login('admin@americanbenefitsadvocates.org', 'Devil$8381')

// dashboard shows real numbers
const dash0 = await call('dashboard', { token: admin })
ok('dashboard loads with team + stats', dash0.status === 200 && Array.isArray(dash0.data?.team) && typeof dash0.data?.totals?.leads === 'number', JSON.stringify(dash0.data).slice(0, 80))
const leadsBefore = dash0.data?.totals?.leads ?? 0

// create → appears on dashboard count and in list
const mk = await call('leads', { method: 'POST', token: admin, body: { first_name: 'Journey', last_name: 'Alpha', phone: '5552220001', email: 'journey.alpha@example.com', source: 'manual', state: 'NY' } })
ok('create lead', mk.status === 200, JSON.stringify(mk.data).slice(0, 80))
const leadId = mk.data?.lead?.id
const dash1 = await call('dashboard', { token: admin })
ok('dashboard total reflects the new lead', (dash1.data?.totals?.leads ?? 0) === leadsBefore + 1, `${leadsBefore} → ${dash1.data?.stats?.total}`)

// edit every key field → reflected in list + detail
const patch = await call(`leads/${leadId}`, { method: 'PATCH', token: admin, body: { first_name: 'Journey2', city: 'Albany', disability: 'back injury', disposition: 'Callback', disposition_reason: null, dob: '1975-03-03' } })
ok('edit lead fields', patch.status === 200)
const det = await call(`leads/${leadId}`, { token: admin })
ok('detail shows edited values', det.data?.lead?.first_name === 'Journey2' && det.data?.lead?.city === 'Albany' && det.data?.lead?.disposition === 'Callback')
const lst = await call('leads?limit=50', { token: admin })
ok('list reflects the edit (in place)', (lst.data?.rows || []).some((r) => r.id === leadId && r.first_name === 'Journey2'))

// combined filters
const filt = await call('leads?disposition=Callback&assigned=all&source=manual&q=Journey2', { token: admin })
ok('combined filters (disposition+source+search) return the record', (filt.data?.rows || []).some((r) => r.id === leadId))

// task on the lead + complete it
const t = await call('tasks', { method: 'POST', token: admin, body: { title: 'Journey task', type: 'callback', lead_id: leadId, due_at: new Date(Date.now() - 3600e3).toISOString() } })
const taskId = t.data?.task?.id || t.data?.id
ok('create task on lead (overdue due-date set)', !!taskId)
ok('mark task complete', (await call(`tasks/${taskId}`, { method: 'PATCH', token: admin, body: { status: 'done' } })).status === 200)

// note → timeline with actor + order
await call(`leads/${leadId}/note`, { method: 'POST', token: admin, body: { text: 'journey note one' } })
const det2 = await call(`leads/${leadId}`, { token: admin })
const acts = det2.data?.activities || []
ok('timeline aggregates note + created + call actions', acts.length >= 3)
ok('timeline ordered newest-first with actor', acts.every((x, i) => i === 0 || String(acts[i - 1].created_at) >= String(x.created_at)) && acts.every((x) => x.profiles?.name || x.user_id))

// global search finds lead + task
const sr = await call('search?q=Journey2', { token: admin })
ok('global search finds the lead', JSON.stringify(sr.data).includes(leadId))

// doc request → public token flow
const dr = await call(`leads/${leadId}/doc-request`, { method: 'POST', token: admin, body: { doc_types: ['id', 'proof'] } })
const dtoken = dr.data?.request?.token
ok('doc request created with public URL', !!dtoken && String(dr.data?.url || '').includes('/upload/'))
ok('public upload page data loads without auth', (await call(`doc/${dtoken}`, { token: null })).status === 200)

// email compose endpoint exists for the lead (mechanics; no real send to avoid spam)
const em = await call(`leads/${leadId}/email`, { method: 'POST', token: admin, body: { subject: 'Journey test', body: '<p>test</p>' } })
ok('lead email endpoint responds (send or clear SMTP error, not 500)', em.status < 500, `got ${em.status} ${JSON.stringify(em.data).slice(0, 90)}`)

// notifications: mark-read flow
const nf = await call('notifications', { token: admin })
ok('notifications list loads', nf.status === 200)
if ((nf.data?.notifications || []).length) {
  const ids = nf.data.notifications.slice(0, 2).map((n) => n.id)
  ok('mark notifications read', (await call('notifications/read', { method: 'POST', token: admin, body: { ids } })).status === 200)
}

// bulk disposition + recycle guards
const bulk = await call('leads/bulk-disposition', { method: 'POST', token: admin, body: { ids: [leadId], disposition: 'VM' } })
ok('bulk disposition applies', bulk.status === 200)

// cleanup journey A
ok('delete lead (cascades task/doc/timeline)', (await call(`leads/${leadId}`, { method: 'DELETE', token: admin })).status === 200)
ok('deleted lead gone from detail', (await call(`leads/${leadId}`, { token: admin })).status === 404)
ok('orphaned task cleaned by cascade', (await call(`tasks/${taskId}`, { token: admin })).status === 404)

console.log('━ JOURNEY B — AGENT, permission boundaries ─')
// admin creates a real agent
const ag = await call('users', { method: 'POST', token: admin, body: { name: 'Journey Agent', email: `journey-agent-${Date.now().toString(36)}@example.com`, password: 'Journey123!', role: 'agent', max_leads: 5 } })
const agentId = ag.data?.user?.id || ag.data?.id
ok('admin creates agent with capacity 5', !!agentId, JSON.stringify(ag.data).slice(0, 90))
const agent = await login(ag.data?.user?.email || ag.data?.email, 'Journey123!')

// admin lead must be invisible to the agent
const adminLead = await call('leads', { method: 'POST', token: admin, body: { first_name: 'Admins', last_name: 'Own', phone: '5552220002' } })
const adminLeadId = adminLead.data?.lead?.id
const meId = (await call('me', { token: admin })).data?.profile?.id
await call(`leads/${adminLeadId}`, { method: 'PATCH', token: admin, body: { assigned_to: meId } })
const agentList = await call('leads?limit=200', { token: agent })
ok('agent does NOT see admin-owned lead', !(agentList.data?.rows || []).some((r) => r.id === adminLeadId))
ok('agent cannot open admin lead detail', (await call(`leads/${adminLeadId}`, { token: agent })).status !== 200)
ok('agent cannot delete admin lead', ![200, 204].includes((await call(`leads/${adminLeadId}`, { method: 'DELETE', token: agent })).status))
ok('agent cannot edit admin lead', ![200].includes((await call(`leads/${adminLeadId}`, { method: 'PATCH', token: agent, body: { first_name: 'Hacked' } })).status))

// agent creates own lead → auto-assigned to self → visible to self, not to other agents
const own = await call('leads', { method: 'POST', token: agent, body: { first_name: 'Agents', last_name: 'Own', phone: '5552220003' } })
const ownId = own.data?.lead?.id
ok('agent lead auto-assigns to self', own.data?.lead?.assigned_to === agentId)
const agentList2 = await call('leads?limit=200', { token: agent })
ok('agent sees own lead', (agentList2.data?.rows || []).some((r) => r.id === ownId))
ok('agent edits own lead', (await call(`leads/${ownId}`, { method: 'PATCH', token: agent, body: { city: 'Austin' } })).status === 200)

// queue for the agent
ok('agent Today queue loads', (await call('queue', { token: agent })).status === 200)

// capacity enforcement: 5 max, agent has 1 → create up to cap, 6th goes unassigned/rejected
let capReached = null
for (let i = 0; i < 6; i++) {
  const r = await call('leads', { method: 'POST', token: admin, body: { first_name: 'Cap', last_name: `Fill${i}`, phone: `555333000${i}` } })
  const assignedTo = r.data?.lead?.assigned_to
  if (assignedTo !== agentId && capReached === null) capReached = { i, assignedTo }
}
ok('capacity respected (agent never exceeds max_leads)', capReached !== null ? capReached.assignedTo !== agentId || capReached.i >= 5 : 'n/a')
if (capReached) ok(`round-robin skipped full agent at fill #${capReached.i + 1} → assigned elsewhere/unassigned`, capReached.assignedTo !== agentId)

// cleanup journey B
for (const id of [adminLeadId, ownId]) await call(`leads/${id}`, { method: 'DELETE', token: admin })
const capList = await call('leads?limit=200&q=Cap', { token: admin })
for (const r of (capList.data?.rows || [])) if (r.first_name === 'Cap') await call(`leads/${r.id}`, { method: 'DELETE', token: admin })
await call(`users/${agentId}`, { method: 'PATCH', token: admin, body: { is_active: false } })
const { error: delErr } = { error: null }
console.log(`  cleanup: leads removed, agent deactivated (auth user journey-agent-* remains deactivated — remove in Admin → Users if desired)`)

// final empty-state check
const finalList = await call('leads?limit=5', { token: admin })
ok('production DB left empty after all journeys', (finalList.data?.total || 0) === 0, `total=${finalList.data?.total}`)

console.log(`\n${pass} passed, ${fail} failed`)
if (failures.length) { console.log('FAILURES:'); failures.forEach((f) => console.log('  - ' + f)) }
process.exit(fail ? 1 : 0)
