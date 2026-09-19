// ─────────────────────────────────────────────────────────────
// LeadDesk demo seeder — fills a connected Supabase project with
// realistic SSDI demo data so the whole CRM is testable end-to-end.
//
//   node scripts/seed-demo.mjs           (skips if already seeded)
//   node scripts/seed-demo.mjs --force   (wipes previous demo data first)
//
// Reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from .env
// ─────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const force = process.argv.includes('--force')

// tiny .env parser (no dependency)
let env = {}
try {
  env = Object.fromEntries(
    fs.readFileSync(path.join(root, '.env'), 'utf8')
      .split(/\r?\n/)
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=')
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
      })
  )
} catch { /* .env missing — reported below */ }

const URL_ = process.env.SUPABASE_URL || env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY
if (!URL_ || !KEY || URL_.includes('placeholder')) {
  console.error('\n✖ Database keys are missing. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env first (see README step 1), then re-run.\n')
  process.exit(1)
}
const sb = createClient(URL_, KEY, { auth: { persistSession: false } })

const DEMO_TAG = 'DEMO'
const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)]
const rndInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min
const daysAgo = (d, hourShift = 0) => new Date(Date.now() - d * 86400000 + hourShift * 3600000).toISOString()

const FIRST = ['James','Mary','Robert','Patricia','John','Jennifer','Michael','Linda','David','Elizabeth','William','Barbara','Richard','Susan','Joseph','Jessica','Thomas','Sarah','Charles','Karen','Christopher','Lisa','Daniel','Nancy','Matthew','Betty','Anthony','Margaret','Mark','Sandra','Donald','Ashley','Steven','Kimberly','Paul','Emily','Andrew','Donna','Joshua','Michelle','Kenneth','Carol','Kevin','Amanda','Brian','Dorothy','George','Melissa','Timothy','Deborah','Ronald','Stephanie','Jason','Rebecca','Edward','Sharon','Jeffrey','Laura','Ryan','Cynthia','Jacob','Amy','Gary','Kathleen','Nicholas','Angela','Eric','Shirley','Jonathan','Brenda','Stephen','Emma','Larry','Anna','Justin','Pamela','Scott','Nicole','Brandon','Samantha','Benjamin','Katherine','Samuel','Christine','Gregory','Helen','Alexander','Debra','Patrick','Rachel','Frank','Carolyn','Raymond','Janet','Jack','Maria','Dennis','Heather','Jerry','Diane','Tyler','Virginia']
const LAST = ['Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Rodriguez','Martinez','Hernandez','Lopez','Gonzalez','Wilson','Anderson','Thomas','Taylor','Moore','Jackson','Martin','Lee','Perez','Thompson','White','Harris','Sanchez','Clark','Ramirez','Lewis','Robinson','Walker','Young','Allen','King','Wright','Scott','Torres','Nguyen','Hill','Flores','Green','Adams','Nelson','Baker','Hall','Rivera','Campbell','Mitchell','Carter','Roberts','Gomez','Phillips','Evans','Turner','Diaz','Parker','Cruz','Edwards','Collins','Reyes','Stewart','Morris','Morales','Murphy','Cook','Rogers','Gutierrez','Ortiz','Morgan','Cooper','Peterson','Bailey','Reed','Kelly','Howard','Ramos','Kim','Cox','Ward','Richardson','Watson','Brooks','Chavez','Wood','James','Bennett','Gray','Mendoza','Ruiz','Hughes','Price','Alvarez','Castillo','Sanders','Patel','Myers','Long','Ross','Foster','Jimenez']
const STATES = ['AL','AZ','AR','CA','FL','GA','IL','IN','KY','LA','MI','MS','MO','NC','OH','OK','PA','SC','TN','TX','VA','WV']
const DISABILITIES = [
  'Chronic lower back pain with herniated discs — unable to stand or sit for long periods',
  'Severe anxiety disorder and depression — under psychiatric care',
  'Diabetic neuropathy in both feet — worsening despite treatment',
  'COPD with frequent hospitalizations — on oxygen part-time',
  'Post-surgical complications from spinal fusion — chronic pain',
  'Bipolar disorder — episodes prevent consistent employment',
  'Rheumatoid arthritis — hands and knees severely affected',
  'Heart failure (EF 30%) — fatigued with minimal exertion',
  'Fibromyalgia — widespread pain and brain fog',
  'Kidney disease stage 4 — on dialysis schedule pending',
  'Stroke recovery — left-side weakness and speech issues',
  'Severe sleep apnea plus degenerative disc disease',
]
const DISPOSITIONS_PLAN = [
  ['New', 15], ['Working', 8], ['VM', 8], ['Callback', 6], ['NIS', 4],
  ['Not Interested', 6], ['Signed', 7], ['Approved', 3], ['Criteria Not Met', 3],
]
const CRITERIA_REASONS = ['Age', 'Work history', 'Already receiving benefits']
const DEMO_USERS = [
  { name: 'Demo Admin', email: 'admin@demo.com', password: 'admin123', role: 'admin' },
  { name: 'Sarah Mitchell', email: 'sarah@demo.com', password: 'agent123', role: 'agent' },
  { name: 'Mike Torres', email: 'mike@demo.com', password: 'agent123', role: 'agent' },
  { name: 'Rachel Owens', email: 'rachel@demo.com', password: 'agent123', role: 'agent' },
]

const log = (m) => console.log(m)

async function main() {
  log('\nLeadDesk demo seeder')

  // ── wipe previous demo data when --force ──
  if (force) {
    log('· --force: removing previous demo leads…')
    await sb.from('leads').delete().eq('campaign', DEMO_TAG)
    for (const u of DEMO_USERS) {
      const { data: existing } = await sb.from('profiles').select('id').eq('email', u.email).maybeSingle()
      if (existing) { await sb.auth.admin.deleteUser(existing.id).catch(() => {}) }
    }
    log('· removed.')
  } else {
    const { data: dupe } = await sb.from('profiles').select('id').eq('email', 'admin@demo.com').maybeSingle()
    if (dupe) {
      log('✖ Demo data already exists. Re-run with --force to wipe and reseed:\n   node scripts/seed-demo.mjs --force\n')
      process.exit(1)
    }
  }

  // ── users ──
  log('· creating demo users…')
  const userIds = {}
  for (const u of DEMO_USERS) {
    const { data, error } = await sb.auth.admin.createUser({
      email: u.email, password: u.password, email_confirm: true,
      user_metadata: { name: u.name, role: u.role },
    })
    if (error) { console.error(`✖ Could not create ${u.email}: ${error.message}`); process.exit(1) }
    userIds[u.email] = data.user.id
  }
  const agents = ['sarah@demo.com', 'mike@demo.com', 'rachel@demo.com'].map((e) => userIds[e])
  const adminId = userIds['admin@demo.com']

  // ── leads ──
  log('· generating 60 demo leads…')
  const plan = DISPOSITIONS_PLAN.flatMap(([d, n]) => Array(n).fill(d))
  const leads = []
  const used = new Set()
  for (let i = 0; i < plan.length; i++) {
    let first, last, key
    do { first = rnd(FIRST); last = rnd(LAST); key = first + last } while (used.has(key))
    used.add(key)
    const disposition = plan[i]
    const createdDays = rndInt(0, 13)
    const age = rndInt(29, 66)
    const dob = new Date(Date.now() - age * 31557600000 - rndInt(0, 360) * 86400000).toISOString().slice(0, 10)
    const agentId = agents[i % agents.length]
    const criteriaNotMet = disposition === 'Criteria Not Met'
    const terminal = ['Signed', 'Approved', 'Not Interested'].includes(disposition)
    leads.push({
      first_name: first, last_name: last,
      email: `${first.toLowerCase()}.${last.toLowerCase()}${rndInt(1, 99)}@example.com`,
      phone: `(${rndInt(201, 989)}) 555-${String(rndInt(1, 199)).padStart(4, '0')}`,
      dob,
      state: rnd(STATES), city: null,
      worked_5_of_10: criteriaNotMet ? (rnd([true, false])) : true,
      receiving_benefits: rnd([false, false, false, true]),
      duration_12m: true,
      has_attorney: rnd([true, false, false]),
      disability: rnd(DISABILITIES),
      disposition,
      disposition_reason: criteriaNotMet ? rnd(CRITERIA_REASONS) : null,
      notes: disposition === 'New' ? null : rnd([
        'Left VM twice — best time to reach is after 5pm.',
        'Wants to think about it, call back next week.',
        'Spoke briefly, asked us to call back on their day off.',
        'Confirmed all details over the phone — moving forward.',
        'Says they never filled out a form (possible wrong number).',
      ]),
      next_followup_at: disposition === 'Callback' || disposition === 'Working'
        ? daysAgo(-rndInt(0, 3), rndInt(9, 17))
        : null,
      assigned_to: terminal && rnd([true, true, false]) ? null : agentId,
      source: rnd(['meta', 'meta', 'meta', 'import', 'manual']),
      campaign: DEMO_TAG,
      form_name: rnd(['SSDI Inquiry — Spring', 'Disability Help Form', 'Benefits Check']),
      meta_lead_id: null,
      created_at: daysAgo(createdDays, -rndInt(0, 20)),
      updated_at: daysAgo(createdDays),
      last_activity_at: daysAgo(Math.min(createdDays, rndInt(0, 2))),
    })
  }
  const { data: insertedLeads, error: leadErr } = await sb.from('leads').insert(leads).select('id,first_name,last_name,disposition,assigned_to,created_at,disposition_reason')
  if (leadErr) { console.error('✖ Lead insert failed:', leadErr.message); process.exit(1) }
  log(`  → ${insertedLeads.length} leads`)

  // ── activity timeline ──
  log('· writing activity timelines…')
  const acts = []
  for (const l of insertedLeads) {
    acts.push({ lead_id: l.id, user_id: l.assigned_to, type: 'created', title: 'Lead created (demo data)', created_at: l.created_at })
    if (!['New'].includes(l.disposition)) {
      acts.push({ lead_id: l.id, user_id: l.assigned_to, type: 'disposition', title: `Disposition: New → ${l.disposition}${l.disposition_reason ? ` (${l.disposition_reason})` : ''}`, created_at: daysAgo(rndInt(0, 5)) })
      acts.push({ lead_id: l.id, user_id: l.assigned_to, type: 'note', title: '📞 Called — updated notes', created_at: daysAgo(rndInt(0, 3)) })
    }
  }
  await sb.from('activities').insert(acts)

  // ── email history with tracked opens ──
  log('· creating email history (with opens)…')
  const emailTargets = insertedLeads.filter((l) => ['Callback', 'Working', 'Signed', 'VM'].includes(l.disposition)).slice(0, 14)
  const msgs = emailTargets.map((l, i) => {
    const opened = i % 3 !== 2 // ~2/3 opened
    return {
      lead_id: l.id, sent_by: l.assigned_to, purpose: i % 2 ? 'documentation' : 'followups',
      to_email: `${l.first_name.toLowerCase()}@example.com`,
      subject: i % 2 ? 'Action needed: documents for your disability claim' : 'Confirming our call',
      html: '<p>Demo email content</p>', opens: opened ? rndInt(1, 4) : 0,
      first_opened_at: opened ? daysAgo(rndInt(0, 4)) : null,
      last_opened_at: opened ? daysAgo(rndInt(0, 1)) : null,
      created_at: daysAgo(rndInt(1, 7)),
    }
  })
  if (msgs.length) {
    const { data: sentMsgs } = await sb.from('email_messages').insert(msgs).select('id,lead_id,subject,opens,created_at')
    await sb.from('activities').insert(sentMsgs.map((m) => ({
      lead_id: m.lead_id, user_id: null, type: 'email_sent', title: `✉️ Email sent: ${m.subject}`, created_at: m.created_at,
    })))
    await sb.from('activities').insert(sentMsgs.filter((m) => m.opens > 0).map((m) => ({
      lead_id: m.lead_id, user_id: null, type: 'email_opened', title: '📧 Email opened', created_at: daysAgo(rndInt(0, 2)),
    })))
  }

  // ── tasks ──
  log('· creating tasks…')
  const taskLeads = insertedLeads.filter((l) => l.assigned_to).slice(0, 8)
  await sb.from('tasks').insert([
    ...taskLeads.slice(0, 3).map((l, i) => ({ title: `Call ${l.first_name} ${l.last_name} — verification follow-up`, type: 'callback', lead_id: l.id, assigned_to: l.assigned_to, created_by: adminId, due_at: daysAgo(0, rndInt(10, 17)), status: 'open' })),
    ...taskLeads.slice(3, 5).map((l) => ({ title: `Chase documents — ${l.first_name} ${l.last_name}`, type: 'doc_request', lead_id: l.id, assigned_to: l.assigned_to, created_by: adminId, due_at: daysAgo(rndInt(1, 2)), status: 'open' })),
    ...taskLeads.slice(5, 6).map((l) => ({ title: `Reminder email to ${l.first_name} ${l.last_name}`, type: 'followup', lead_id: l.id, assigned_to: l.assigned_to, created_by: adminId, due_at: daysAgo(-2), status: 'open' })),
    ...taskLeads.slice(6, 8).map((l) => ({ title: `Intro call done — ${l.first_name} ${l.last_name}`, type: 'callback', lead_id: l.id, assigned_to: l.assigned_to, created_by: adminId, due_at: daysAgo(rndInt(3, 6)), status: 'done', completed_at: daysAgo(rndInt(3, 5)) })),
  ])

  // ── document request + one uploaded demo document ──
  log('· creating a document request with an uploaded PDF…')
  const docLead = insertedLeads.find((l) => l.assigned_to === agents[0])
  if (docLead) {
    const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
    const { data: req } = await sb.from('doc_requests').insert({
      lead_id: docLead.id, token, doc_types: ['Government photo ID', 'Work history / W-2'],
      message: 'Please upload these so we can move your claim forward.',
      status: 'uploaded', created_by: agents[0], expires_at: daysAgo(-7), uploaded_at: daysAgo(1),
    }).select('id,token').single()
    // tiny valid PDF so the "View" flow works
    const pdf = Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R>>endobj\n4 0 obj<</Length 60>>stream\nBT /F1 18 Tf 72 720 Td (Demo document - ${docLead.first_name} ${docLead.last_name}) Tj ET\nendstream\nendobj\ntrailer<</Root 1 0 R>>\n%%EOF`, 'utf8')
    const storagePath = `claims/${req.token}/demo_id_document.pdf`
    await sb.storage.from('documents').upload(storagePath, pdf, { contentType: 'application/pdf', upsert: true })
    await sb.from('documents').insert({ lead_id: docLead.id, request_id: req.id, doc_type: 'Government photo ID', file_name: 'demo_id_document.pdf', storage_path: storagePath, size_bytes: pdf.length })
    await sb.from('activities').insert({ lead_id: docLead.id, user_id: null, type: 'doc_uploaded', title: '📎 Claimant uploaded: Government photo ID (demo_id_document.pdf)', created_at: daysAgo(1) })
  }
  // one pending request on another lead
  const pendingLead = insertedLeads.find((l) => l.assigned_to === agents[1])
  if (pendingLead) {
    await sb.from('doc_requests').insert({
      lead_id: pendingLead.id, doc_types: ['Medical records'], status: 'pending',
      message: 'Demo pending request.', created_by: agents[1], expires_at: daysAgo(-5),
    })
  }

  // ── Meta quality signals for Signed / Approved / Criteria Not Met ──
  const metaRows = insertedLeads
    .filter((l) => ['Signed', 'Approved', 'Criteria Not Met'].includes(l.disposition))
    .map((l) => ({
      lead_id: l.id,
      event_name: ['Signed', 'Approved'].includes(l.disposition) ? 'Lead_Qualified' : 'Lead_Disqualified',
      reason: l.disposition_reason || null, success: true,
      response: { demo: true, events_received: 1 }, created_at: daysAgo(rndInt(0, 4)),
    }))
  if (metaRows.length) await sb.from('meta_events').insert(metaRows)

  // ── active-time history so the team table has numbers ──
  const activityDays = []
  for (const uid of [...agents, adminId]) {
    activityDays.push({ user_id: uid, day: new Date().toISOString().slice(0, 10), seconds: uid === adminId ? rndInt(1800, 5400) : rndInt(7200, 14400), pings: rndInt(30, 240) })
    for (let d = 1; d <= 6; d++) activityDays.push({ user_id: uid, day: new Date(Date.now() - d * 86400000).toISOString().slice(0, 10), seconds: rndInt(3600, 18000), pings: rndInt(60, 300) })
  }
  await sb.from('user_activity_days').upsert(activityDays, { onConflict: 'user_id,day' })

  // ── a few notifications ──
  await sb.from('notifications').insert([
    { user_id: agents[0], lead_id: docLead?.id, title: '📄 Documents received', body: 'A claimant uploaded Government photo ID', read: false },
    { user_id: agents[1], title: '⚡ 20 leads imported & assigned to you', body: 'Check your Leads page', read: false },
    { user_id: adminId, title: 'Welcome to LeadDesk 👋', body: 'Demo data loaded — explore dashboards, dispositions, documents and more.', read: false },
  ])

  log(`
✅ Demo data loaded!

Logins (try each one — the dashboards differ by role):
  ┌──────────────────────┬────────────────────┬───────────┐
  │ Role                 │ Email              │ Password  │
  ├──────────────────────┼────────────────────┼───────────┤
  │ Admin                │ admin@demo.com     │ admin123  │
  │ Agent (Sarah)        │ sarah@demo.com     │ agent123  │
  │ Agent (Mike)         │ mike@demo.com      │ agent123  │
  │ Agent (Rachel)       │ rachel@demo.com    │ agent123  │
  └──────────────────────┴────────────────────┴───────────┘
Seeded: 60 leads · activity timelines · email history with opens · 8 tasks
        · 1 uploaded demo PDF + pending doc request · Meta signals · active-time stats

Wipe it anytime:  node scripts/seed-demo.mjs --force
`)
}

main().catch((e) => { console.error('✖', e.message); process.exit(1) })
