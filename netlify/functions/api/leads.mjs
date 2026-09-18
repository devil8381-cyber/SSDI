import { route } from './_router.mjs'
import {
  service, json, fail, getSession, unauthorized, logActivity, notify, adminIds,
  sendCapi, metaSecrets, getSetting,
} from './_lib.mjs'

const isAdmin = (p) => p?.role === 'admin'

const LEAD_FIELDS = [
  'first_name', 'last_name', 'email', 'phone', 'dob', 'state', 'city',
  'worked_5_of_10', 'receiving_benefits', 'duration_12m', 'has_attorney', 'disability', 'notes',
]

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
    const like = `%${qstr.replace(/[%,()]/g, '')}%`
    q = q.or(`first_name.ilike.${like},last_name.ilike.${like},email.ilike.${like},phone.ilike.${like},city.ilike.${like}`)
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
  const patch = { source: body.source || 'manual' }
  for (const f of LEAD_FIELDS) if (f in body) patch[f] = body[f] === '' ? null : body[f]
  if (isAdmin(s.profile)) patch.assigned_to = body.assigned_to || null
  else patch.assigned_to = s.user.id
  const { data, error } = await service.from('leads').insert(patch).select('*').single()
  if (error) return fail(error.message)
  await logActivity(data.id, s.user.id, 'created', 'Lead created')
  return json({ lead: data })
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
  if ('next_followup_at' in body) patch.next_followup_at = body.next_followup_at || null

  let activityType = 'edited'
  let activityTitle = 'Lead details updated'

  if ('disposition' in body && body.disposition && body.disposition !== lead.disposition) {
    patch.disposition = body.disposition
    patch.disposition_reason = body.disposition === 'Criteria Not Met' ? (body.disposition_reason || null) : null
    activityType = 'disposition'
    activityTitle = `Disposition: ${lead.disposition} → ${body.disposition}`
    if (patch.disposition_reason) activityTitle += ` (${patch.disposition_reason})`
  } else if ('disposition_reason' in body && body.disposition === 'Criteria Not Met') {
    patch.disposition_reason = body.disposition_reason || null
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

  if (activityType === 'disposition') context.waitUntil(fireMetaSignal(context, updated, patch.disposition, patch.disposition_reason))
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
  const ids = body.ids || []
  if (!ids.length) return fail('No leads selected')
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
  const rows = body.rows || []
  if (!rows.length) return fail('No rows to import')

  const { data: existing } = await service.from('leads').select('phone,email')
  const seen = new Set((existing || []).map((l) => [l.phone, l.email.toLowerCase()]).flat().filter(Boolean))
  const normalize = (p) => String(p || '').replace(/\D/g, '').slice(-10)

  const toInsert = []
  let duplicates = 0
  for (const r of rows) {
    const phoneN = normalize(r.phone)
    const emailL = String(r.email || '').trim().toLowerCase()
    const key = phoneN || emailL
    if (key && seen.has(key)) { duplicates++; continue }
    if (phoneN) seen.add(phoneN)
    if (emailL) seen.add(emailL)
    toInsert.push({
      first_name: r.first_name || '', last_name: r.last_name || '',
      email: emailL || null, phone: phoneN ? r.phone : (r.phone || null),
      dob: r.dob || null, state: r.state || null, city: r.city || null,
      worked_5_of_10: r.worked_5_of_10 ? truthy(r.worked_5_of_10) : null,
      receiving_benefits: r.receiving_benefits ? truthy(r.receiving_benefits) : null,
      duration_12m: r.duration_12m ? truthy(r.duration_12m) : null,
      has_attorney: r.has_attorney ? truthy(r.has_attorney) : null,
      disability: r.disability || null, notes: r.notes || null,
      campaign: r.campaign || null,
      source: 'import',
      assigned_to: body.assign_to || null,
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
