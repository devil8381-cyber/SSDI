import { route } from './_router.mjs'
import {
  service, json, fail, getSession, unauthorized, logActivity, notify, adminIds,
  sendCapi, metaSecrets, getSetting, DISPOSITIONS, LEAD_SOURCES, pickAgentRoundRobin,
  applyFollowupRules, buildQueueFor, sendSystemEmail, baseUrl,
} from './_lib.mjs'

const isAdmin = (p) => p?.role === 'admin'

const LEAD_FIELDS = [
  'first_name', 'last_name', 'email', 'phone', 'dob', 'state', 'city',
  'address', 'zip',
  'worked_5_of_10', 'receiving_benefits', 'duration_12m', 'has_attorney', 'disability', 'notes',
]
const TEXT_FIELDS = ['first_name', 'last_name', 'email', 'phone', 'state', 'city', 'address', 'zip', 'disability', 'notes']

// Server-side normalization: trim, strip control chars, cap length.
// Mirrors the client's sanitizeText so malformed payloads from any source
// (API misuse, CSV junk, Meta form fields) can't pollute the database.
const cleanStr = (v, max = 200) => {
  if (v === undefined || v === null) return null
  const s = String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim()
  return s ? s.slice(0, max) : null
}
const cleanLeadPatch = (patch) => {
  for (const f of TEXT_FIELDS) {
    if (f in patch) patch[f] = cleanStr(patch[f], f === 'notes' || f === 'disability' ? 2000 : 200)
  }
  if ('email' in patch && patch.email) patch.email = patch.email.toLowerCase()
  return patch
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const canSee = (profile, lead) => isAdmin(profile) || lead.assigned_to === profile.id

async function getLeadOr404(id) {
  const { data } = await service.from('leads').select('*, profiles!leads_assigned_to_fkey(id,name,email)').eq('id', id).maybeSingle()
  return data
}

async function fireMetaSignal(ctx, lead, disposition, reason) {
  const raw = await getSetting('meta')
  const meta = metaSecrets(raw)
  if (!meta?.pixel_id || !meta?.capi_token) return
  const qualified = ['Signed', 'Approved'].includes(disposition)
  if (!qualified && disposition !== 'Criteria Not Met') return
  const result = await sendCapi(meta, {
    eventName: qualified ? 'Lead_Qualified' : 'Lead_Disqualified',
    lead,
    metaLeadId: lead.meta_lead_id || undefined,
    custom: { disposition, ...(reason ? { rejection_reason: reason } : {}) },
  })
  await service.from('meta_events').insert({
    lead_id: lead.id,
    event_name: qualified ? 'Lead_Qualified' : 'Lead_Disqualified',
    reason: reason || null,
    success: !!result.success,
    response: result.response || result,
  })
}

// ── list ──────────────────────────────────────────────────────
route('GET', 'leads', async ({ req, query }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  const admin = isAdmin(s.profile)
  const limit = Math.min(200, Number(query.get('limit')) || 50)
  const page = Math.max(1, Number(query.get('page')) || 1)

  let q = service.from('leads').select('*, profiles!leads_assigned_to_fkey(name)', { count: 'exact', head: false })
  const disposition = query.get('disposition')
  if (disposition && disposition !== 'all') q = q.eq('disposition', disposition)
  const assigned = query.get('assigned') || (admin ? 'all' : 'me')
  if (!admin) q = q.eq('assigned_to', s.user.id)
  else if (assigned === 'me') q = q.eq('assigned_to', s.user.id)
  else if (assigned === 'unassigned') q = q.is('assigned_to', null)
  else if (assigned !== 'all') q = q.eq('assigned_to', assigned)
  const source = query.get('source')
  if (source && source !== 'all') q = q.eq('source', source)
  const createdAfter = query.get('created_after')
  if (createdAfter) q = q.gte('created_at', createdAfter)
  const qstr = query.get('q')
  if (qstr) {
    // PostgREST .or() treats ,() as syntax — strip them so a pasted value
    // can't break the filter or inject unexpected OR branches.
    const clean = qstr.replace(/[%(),*]/g, ' ').trim()
    if (clean) {
      const like = `%${clean}%`
      q = q.or(`first_name.ilike.${like},last_name.ilike.${like},email.ilike.${like},phone.ilike.${like},city.ilike.${like}`)
    }
  }
  const { data: rows, count, error } = await q
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1)
  if (error) return fail(error.message)
  return json({ rows: rows || [], total: count || 0, page, limit })
})

// ── create ────────────────────────────────────────────────────
route('POST', 'leads', async ({ req, body }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  const patch = { source: LEAD_SOURCES.includes(body.source) ? body.source : 'manual' }
  for (const f of LEAD_FIELDS) if (f in body) patch[f] = body[f] === '' ? null : body[f]
  cleanLeadPatch(patch)
  if (isAdmin(s.profile)) patch.assigned_to = body.assigned_to || (await pickAgentRoundRobin())
  else patch.assigned_to = s.user.id
  const { data, error } = await service.from('leads').insert(patch).select('*').single()
  if (error) return fail(error.message)
  await logActivity(data.id, s.user.id, 'created', 'Lead created')
  return json({ lead: data })
})

// ── stale-lead detection + recycling (admin) ──────────────────
// NOTE: registered BEFORE the `leads/:id` detail route so the static
// "stale" path is never swallowed as an :id parameter.
const TERMINAL = ['Signed', 'Approved']
async function findStaleLeads(days) {
  const cutoff = new Date(Date.now() - Math.max(1, days) * 86400000).toISOString()
  let q = service.from('leads')
    .select('id,disposition,assigned_to')
    .lt('created_at', cutoff)
    .or(`last_activity_at.is.null,last_activity_at.lt.${cutoff}`)
    .not('disposition', 'in', '("Signed","Approved")')
    .limit(5000)
  const { data } = await q
  return data || []
}

route('GET', 'leads/stale', async ({ req, query }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  if (!isAdmin(s.profile)) return fail('Admin only', 403)
  const days = Math.max(1, Math.min(180, Number(query.get('days')) || 14))
  const stale = await findStaleLeads(days)
  const byDisposition = {}
  for (const l of stale) byDisposition[l.disposition] = (byDisposition[l.disposition] || 0) + 1
  return json({ days, total: stale.length, byDisposition })
})

route('POST', 'leads/recycle', async ({ req, body }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  if (!isAdmin(s.profile)) return fail('Admin only', 403)
  const days = Math.max(1, Math.min(180, Number(body.days) || 14))
  const stale = await findStaleLeads(days)
  if (!stale.length) return json({ count: 0 })
  const ids = stale.map((l) => l.id)
  await service.from('leads').update({ assigned_to: null, updated_at: new Date().toISOString() }).in('id', ids)
  for (const id of ids) await logActivity(id, s.user.id, 'assigned', `♻️ Recycled to unassigned pool (no activity for ${days}+ days)`)
  return json({ count: ids.length })
})

// ── detail (everything for the lead page) ─────────────────────
route('GET', 'leads/:id', async ({ req, params }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  const lead = await getLeadOr404(params.id)
  if (!lead) return fail('Lead not found', 404)
  if (!canSee(s.profile, lead)) return unauthorized()

  const [acts, emails, docReqs, docs, recs, tasks, metaEvs] = await Promise.all([
    service.from('activities').select('*, profiles(name)').eq('lead_id', lead.id).order('created_at', { ascending: false }).limit(60),
    service.from('email_messages').select('id,subject,purpose,opens,first_opened_at,last_opened_at,created_at,sent_by,profiles(name)').eq('lead_id', lead.id).order('created_at', { ascending: false }).limit(30),
    service.from('doc_requests').select('*').eq('lead_id', lead.id).order('created_at', { ascending: false }),
    service.from('documents').select('*').eq('lead_id', lead.id).order('uploaded_at', { ascending: false }),
    service.from('recordings').select('*').eq('lead_id', lead.id).order('created_at', { ascending: false }),
    service.from('tasks').select('*, profiles!tasks_assigned_to_fkey(name)').eq('lead_id', lead.id).order('created_at', { ascending: false }),
    service.from('meta_events').select('*').eq('lead_id', lead.id).order('created_at', { ascending: false }).limit(10),
  ])
  return json({
    lead,
    activities: acts.data || [],
    emails: emails.data || [],
    docRequests: docReqs.data || [],
    documents: docs.data || [],
    recordings: recs.data || [],
    tasks: tasks.data || [],
    metaEvents: metaEvs.data || [],
  })
})

// ── update / disposition ──────────────────────────────────────
route('PATCH', 'leads/:id', async ({ req, params, body, context }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  const lead = await getLeadOr404(params.id)
  if (!lead) return fail('Lead not found', 404)
  if (!canSee(s.profile, lead)) return unauthorized()

  const patch = { updated_at: new Date().toISOString() }
  for (const f of LEAD_FIELDS) if (f in body) patch[f] = body[f] === '' ? null : body[f]
  cleanLeadPatch(patch)
  if ('next_followup_at' in body) patch.next_followup_at = body.next_followup_at || null
  // structured SSDI intake questionnaire (jsonb of question-id → answer)
  if ('intake' in body) {
    const v = body.intake
    if (v === null) patch.intake = {}
    else if (typeof v === 'object' && !Array.isArray(v)) {
      patch.intake = Object.fromEntries(
        Object.entries(v).slice(0, 100).map(([k, val]) => [String(k).slice(0, 40), String(val ?? '').slice(0, 2000)])
      )
    }
  }

  let activityType = 'edited'
  let activityTitle = 'Lead details updated'

  if ('disposition' in body && body.disposition && body.disposition !== lead.disposition) {
    // Whitelist: an arbitrary disposition string would break dashboards,
    // filters, and the Meta quality mapping downstream.
    if (!DISPOSITIONS.includes(body.disposition)) return fail('Invalid disposition')
    patch.disposition = body.disposition
    patch.disposition_reason = body.disposition === 'Criteria Not Met' ? (cleanStr(body.disposition_reason, 100) || null) : null
    activityType = 'disposition'
    activityTitle = `Disposition: ${lead.disposition} → ${body.disposition}`
    if (patch.disposition_reason) activityTitle += ` (${patch.disposition_reason})`
  } else if ('disposition_reason' in body && body.disposition === 'Criteria Not Met') {
    patch.disposition_reason = cleanStr(body.disposition_reason, 100) || null
  }

  if ('assigned_to' in body && isAdmin(s.profile) && body.assigned_to !== lead.assigned_to) {
    patch.assigned_to = body.assigned_to || null
    activityType = 'assigned'
    let name = 'Unassigned'
    if (body.assigned_to) {
      const { data: agent } = await service.from('profiles').select('name').eq('id', body.assigned_to).single()
      name = agent?.name || 'agent'
    }
    activityTitle = `Assigned to ${name}`
    if (body.assigned_to) await notify([body.assigned_to], 'New lead assigned', `${lead.first_name || ''} ${lead.last_name || ''}`.trim(), lead.id)
  }

  if ('notes' in body && 'disposition' in body === false) {
    if (body.notes !== lead.notes && body.notes) activityTitle = 'Note updated'
  }

  const { data: updated, error } = await service.from('leads').update(patch).eq('id', lead.id).select('*').single()
  if (error) return fail(error.message)
  await logActivity(lead.id, s.user.id, activityType, activityTitle, { from: lead.disposition, to: patch.disposition })

  if (activityType === 'disposition') {
    context.waitUntil(fireMetaSignal(context, updated, patch.disposition, patch.disposition_reason))
    context.waitUntil(applyFollowupRules(updated, patch.disposition))
  }
  return json({ lead: updated })
})

route('DELETE', 'leads/:id', async ({ req, params }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  if (!isAdmin(s.profile)) return fail('Admin only', 403)
  await service.from('leads').delete().eq('id', params.id)
  return json({ ok: true })
})

// ── bulk assign ───────────────────────────────────────────────
route('POST', 'leads/assign', async ({ req, body }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  if (!isAdmin(s.profile)) return fail('Admin only', 403)
  // Validate + cap: malformed ids would 500 on the Postgres .in() call
  const ids = (Array.isArray(body.ids) ? body.ids : [])
    .filter((x) => UUID_RE.test(String(x)))
    .slice(0, 5000)
  if (!ids.length) return fail('No valid leads selected')
  let agentName = 'Unassigned'
  if (body.agent_id) {
    const { data: agent } = await service.from('profiles').select('name').eq('id', body.agent_id).single()
    agentName = agent?.name || 'agent'
  }
  await service.from('leads').update({ assigned_to: body.agent_id || null, updated_at: new Date().toISOString() }).in('id', ids)
  for (const id of ids) await logActivity(id, s.user.id, 'assigned', `Assigned to ${agentName}`)
  if (body.agent_id) await notify([body.agent_id], `${ids.length} lead(s) assigned to you`, 'Check your Leads page', null)
  return json({ ok: true, count: ids.length })
})

// ── CSV import ────────────────────────────────────────────────
const truthy = (v) => ['true', 'yes', 'y', '1', 'x'].includes(String(v).trim().toLowerCase())
route('POST', 'leads/import', async ({ req, body }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  if (!isAdmin(s.profile)) return fail('Admin only', 403)
  const rows = Array.isArray(body.rows) ? body.rows : []
  if (!rows.length) return fail('No rows to import')
  if (rows.length > 10000) return fail('Maximum 10,000 rows per import — split the file and import in batches.')

  const { data: existing } = await service.from('leads').select('phone,email')
  const seen = new Set((existing || []).map((l) => [l.phone, (l.email || '').toLowerCase()]).flat().filter(Boolean))
  const normalize = (p) => String(p || '').replace(/\D/g, '').slice(-10)

  const toInsert = []
  let duplicates = 0
  for (const r of rows || []) {
    if (!r || typeof r !== 'object') { duplicates++; continue }
    const phoneN = normalize(r.phone)
    const emailL = cleanStr(r.email, 200)?.toLowerCase() || ''
    const key = phoneN || emailL
    if (key && seen.has(key)) { duplicates++; continue }
    if (phoneN) seen.add(phoneN)
    if (emailL) seen.add(emailL)
    toInsert.push({
      first_name: cleanStr(r.first_name, 100) || '', last_name: cleanStr(r.last_name, 100) || '',
      email: emailL || null, phone: phoneN ? cleanStr(r.phone, 30) : cleanStr(r.phone, 30),
      dob: r.dob || null, state: cleanStr(r.state, 10), city: cleanStr(r.city, 120),
      worked_5_of_10: r.worked_5_of_10 != null && r.worked_5_of_10 !== '' ? truthy(r.worked_5_of_10) : null,
      receiving_benefits: r.receiving_benefits != null && r.receiving_benefits !== '' ? truthy(r.receiving_benefits) : null,
      duration_12m: r.duration_12m != null && r.duration_12m !== '' ? truthy(r.duration_12m) : null,
      has_attorney: r.has_attorney != null && r.has_attorney !== '' ? truthy(r.has_attorney) : null,
      disability: cleanStr(r.disability, 2000), notes: cleanStr(r.notes, 2000),
      campaign: cleanStr(r.campaign, 200),
      source: 'import',
      assigned_to: UUID_RE.test(String(body.assign_to || '')) ? body.assign_to : (await pickAgentRoundRobin()),
    })
  }
  let inserted = 0
  for (let i = 0; i < toInsert.length; i += 200) {
    const chunk = toInsert.slice(i, i + 200)
    const { error } = await service.from('leads').insert(chunk)
    if (error) return fail(`Import failed: ${error.message}`)
    inserted += chunk.length
  }
  if (body.assign_to) await notify([body.assign_to], `${inserted} leads imported & assigned to you`, 'Check your Leads page')
  return json({ inserted, duplicates })
})

// ── prev / next for the lead-page work flow ───────────────────
route('GET', 'leads/:id/neighbors', async ({ req, params }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  const lead = await getLeadOr404(params.id)
  if (!lead) return fail('Lead not found', 404)
  if (!canSee(s.profile, lead)) return unauthorized()
  let q = service.from('leads').select('id').order('created_at', { ascending: false }).limit(10000)
  if (!isAdmin(s.profile)) q = q.eq('assigned_to', s.user.id)
  const { data } = await q
  const list = data || []
  const idx = list.findIndex((r) => r.id === lead.id)
  return json({
    prev: idx > 0 ? list[idx - 1].id : null,
    next: idx >= 0 && idx < list.length - 1 ? list[idx + 1].id : null,
    position: idx + 1,
    total: list.length,
  })
})

// ── quick note (timeline, no form save needed) ────────────────
route('POST', 'leads/:id/note', async ({ req, params, body }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  const lead = await getLeadOr404(params.id)
  if (!lead) return fail('Lead not found', 404)
  if (!canSee(s.profile, lead)) return unauthorized()
  const text = cleanStr(body.text, 1000)
  if (!text) return fail('Note is empty')
  await logActivity(lead.id, s.user.id, 'note', `📝 ${text}`)
  return json({ ok: true })
})

// ── call log (click-to-call support) ──────────────────────────
route('POST', 'leads/:id/call', async ({ req, params }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  const lead = await getLeadOr404(params.id)
  if (!lead) return fail('Lead not found', 404)
  if (!canSee(s.profile, lead)) return unauthorized()
  await logActivity(lead.id, s.user.id, 'note', `📞 Call started to ${lead.phone || 'lead'}`)
  return json({ ok: true })
})

// ── bulk disposition ──────────────────────────────────────────
route('POST', 'leads/bulk-disposition', async ({ req, body, context }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  const ids = (Array.isArray(body.ids) ? body.ids : []).filter((x) => UUID_RE.test(String(x))).slice(0, 5000)
  if (!ids.length) return fail('No valid leads selected')
  if (!DISPOSITIONS.includes(body.disposition)) return fail('Invalid disposition')
  const reason = body.disposition === 'Criteria Not Met' ? (cleanStr(body.reason, 100) || null) : null

  // agents may only bulk-disposition their own leads
  let scoped = ids
  if (!isAdmin(s.profile)) {
    const { data: own } = await service.from('leads').select('id').in('id', ids).eq('assigned_to', s.user.id)
    scoped = (own || []).map((r) => r.id)
  }
  if (!scoped.length) return fail('None of the selected leads are assigned to you')

  await service.from('leads').update({
    disposition: body.disposition, disposition_reason: reason, updated_at: new Date().toISOString(),
  }).in('id', scoped)
  for (const id of scoped) {
    await logActivity(id, s.user.id, 'disposition', `Disposition → ${body.disposition}${reason ? ` (${reason})` : ''}`)
  }
  // quality signals for the affected leads, processed in the background
  const { data: targets } = await service.from('leads').select('*').in('id', scoped)
  const firing = (targets || []).filter((l) => ['Signed', 'Approved', 'Criteria Not Met'].includes(l.disposition))
  if (firing.length) {
    context.waitUntil((async () => {
      for (const l of firing) {
        try {
          await fireMetaSignal(context, l, l.disposition, l.disposition_reason)
          await applyFollowupRules(l, l.disposition)
        } catch (e) { console.error('bulk post-processing failed', e) }
      }
    })())
  }
  return json({ ok: true, count: scoped.length })
})

// ── daily queue ("Today" page) ────────────────────────────────
route('GET', 'queue', async ({ req }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  const q = await buildQueueFor(s.profile)
  return json(q)
})

// email myself today's plan
route('POST', 'queue/email', async ({ req, url }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  const q = await buildQueueFor(s.profile)
  if (!q.items.length) return fail('Your queue is empty — nothing to send')
  const rows = q.items.slice(0, 20).map((i) =>
    `<li><b>${i.first_name} ${i.last_name}</b> — ${i.reason}${i.due_at ? ` (due ${new Date(i.due_at).toLocaleString()})` : ''} — ${i.phone || 'no phone'}</li>`
  ).join('')
  const html = `
    <h2>Your ABA plan for today</h2>
    <p><b>${q.counts.total}</b> leads in your queue: ${q.counts.overdue} overdue, ${q.counts.dueToday} due today, ${q.counts.fresh} fresh.</p>
    <ol>${rows}</ol>
    <p><a href="${baseUrl(url)}">Open ABA</a></p>`
  try {
    await sendSystemEmail({ to: s.profile.email || s.user.email, subject: `ABA — ${q.counts.total} leads on today's plan`, html })
  } catch (e) {
    return fail(e.message, 400)
  }
  return json({ ok: true, sent: Math.min(20, q.items.length) })
})

