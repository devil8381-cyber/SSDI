import crypto from 'node:crypto'
import { route } from './_router.mjs'
import {
  service, json, fail, getSession, unauthorized, notify, today, dbConfigured,
  getSetting, setSetting, isoDayStart, DISPOSITIONS, DEFAULT_FOLLOWUP_RULES,
} from './_lib.mjs'

const isAdmin = (p) => p?.role === 'admin'

// ── client crash reporter (public, fire-and-forget) ──
// The browser posts every uncaught error/rejection here with its stack, so a
// user-visible crash arrives in the server log with an exact file+line — no
// back-and-forth needed to diagnose it. Deliberately unauthenticated: crashes
// can happen before login. Payload is size-capped; it only logs.
route('POST', 'client-log', async ({ body }) => {
  const stack = String(body?.stack || '').slice(0, 4000)
  const message = String(body?.message || '').slice(0, 500)
  console.error(`[client ${body?.kind || 'error'}] ${message}\n${stack}\n  at ${String(body?.href || '').slice(0, 200)}`)
  return json({ ok: true })
})

// ── first-run setup (allowed only until the first admin exists) ──
route('GET', 'setup/status', async () => {
  if (!dbConfigured()) return json({ needed: true, dbConfigured: false })
  const { count } = await service.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin')
  return json({ needed: (count || 0) === 0, dbConfigured: true })
})

route('POST', 'setup', async ({ body }) => {
  const { count } = await service.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'admin')
  if ((count || 0) > 0) return fail('Setup already completed — an admin exists', 403)
  const email = String(body.email || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fail('Enter a valid email address')
  if (!body.password || String(body.password).length < 6) return fail('Password must be at least 6 characters')

  // Atomic claim via a unique settings row: two racing requests can't both
  // pass the count check and create two admins — the PK conflict decides.
  const { error: claimErr } = await service.from('settings').insert({ key: 'setup_done', value: { at: new Date().toISOString() } })
  if (claimErr) {
    if (claimErr.code === '23505') return fail('Setup already completed — an admin exists', 403)
    return fail(claimErr.message)
  }
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: String(body.password),
    email_confirm: true,
    user_metadata: { name: String(body.name || email.split('@')[0]).slice(0, 120), role: 'admin' },
  })
  if (error) {
    // Release the claim so a legitimate retry isn't permanently locked out
    await service.from('settings').delete().eq('key', 'setup_done')
    return fail(error.message)
  }
  return json({ ok: true, id: data.user.id })
})

// ── global search (topbar) ────────────────────────────────────
route('GET', 'search', async ({ req, query }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  // PostgREST .or() treats ,() as syntax — strip before matching
  const clean = String(query.get('q') || '').replace(/[%(),*]/g, ' ').trim()
  if (clean.length < 2) return json({ results: [] })
  const like = `%${clean}%`
  let q = service.from('leads')
    .select('id,first_name,last_name,phone,email,disposition')
    .or(`first_name.ilike.${like},last_name.ilike.${like},phone.ilike.${like},email.ilike.${like}`)
    .order('created_at', { ascending: false })
    .limit(8)
  if (!isAdmin(s.profile)) q = q.eq('assigned_to', s.user.id)
  const { data } = await q
  return json({ results: data || [] })
})

// ── automation settings: auto-assign mode ─────────────────────
route('GET', 'settings/auto-assign', async ({ req }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  if (!isAdmin(s.profile)) return fail('Admin only', 403)
  const v = await getSetting('auto_assign')
  return json({ mode: v?.mode === 'round_robin' ? 'round_robin' : 'off' })
})

route('PUT', 'settings/auto-assign', async ({ req, body }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  if (!isAdmin(s.profile)) return fail('Admin only', 403)
  if (!['off', 'round_robin'].includes(body.mode)) return fail('Mode must be "off" or "round_robin"')
  await setSetting('auto_assign', { mode: body.mode, updated_at: new Date().toISOString() })
  return json({ ok: true, mode: body.mode })
})

// ── rebuttals library (agents read; admin edits) ──────────────
route('GET', 'settings/rebuttals', async ({ req }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  return json({ rebuttals: (await getSetting('rebuttals')) || [] })
})

route('PUT', 'settings/rebuttals', async ({ req, body }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  if (!isAdmin(s.profile)) return fail('Admin only', 403)
  const rebuttals = (Array.isArray(body.rebuttals) ? body.rebuttals : [])
    .filter((r) => r && String(r.title || '').trim() && String(r.body || '').trim())
    .slice(0, 50)
    .map((r) => ({ title: String(r.title).trim().slice(0, 200), body: String(r.body).trim().slice(0, 4000) }))
  await setSetting('rebuttals', rebuttals)
  return json({ ok: true, rebuttals })
})

// ── calling app (click-to-call scheme) ────────────────────────
route('GET', 'settings/call', async ({ req }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  const cfg = (await getSetting('call')) || { scheme: 'tel', template: '' }
  return json({ scheme: cfg.scheme || 'tel', template: cfg.template || '' })
})
route('PUT', 'settings/call', async ({ req, body }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  if (!isAdmin(s.profile)) return fail('Admin only', 403)
  if (!['tel', 'phound', 'callto', 'custom'].includes(body.scheme)) return fail('Unknown calling app')
  if (body.scheme === 'custom' && !String(body.template || '').includes('{number}')) {
    return fail('Custom template must contain {number}')
  }
  await setSetting('call', { scheme: body.scheme, template: String(body.template || '').slice(0, 200) })
  return json({ ok: true, scheme: body.scheme, template: body.template || '' })
})

// ── welcome email toggle ──────────────────────────────────────
route('GET', 'settings/welcome-email', async ({ req }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  if (!isAdmin(s.profile)) return fail('Admin only', 403)
  const cfg = await getSetting('welcome_email')
  return json({ enabled: cfg?.enabled !== false })
})
route('PUT', 'settings/welcome-email', async ({ req, body }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  if (!isAdmin(s.profile)) return fail('Admin only', 403)
  await setSetting('welcome_email', { enabled: !!body.enabled })
  return json({ ok: true, enabled: !!body.enabled })
})

// ── Google Sheets auto-import + instant push ──────────────────
// Instant push: the Google Apps Script in the user's sheet POSTs new rows here
// with the secret token. Public endpoint — token is the auth.
route('POST', 'sheets/push', async ({ req, body, query }) => {
  const cfg = (await getSetting('sheets')) || {}
  const token = req.headers.get('x-sheet-token') || query.get('token') || ''
  if (!cfg.push_token || token !== cfg.push_token) return fail('Invalid push token', 403)
  try {
    const result = await import('./_lib.mjs').then((m) => m.importLeadRows(
      [body].filter(Boolean),
      { source: 'sheet', campaign: 'Google Sheet', assignedTo: null, dupPolicy: cfg.dup_policy || 'skip' }
    ))
    return json({ ok: true, ...result })
  } catch (e) {
    return fail(e.message, 400)
  }
})

route('GET', 'settings/sheets', async ({ req }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  if (!isAdmin(s.profile)) return fail('Admin only', 403)
  let cfg = (await getSetting('sheets')) || {}
  if (!cfg.push_token) {
    cfg = { ...cfg, push_token: crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '') }
    await setSetting('sheets', cfg)
  }
  return json({
    sheet_url: cfg.sheet_url || '', gid: cfg.gid || '',
    auto_import: !!cfg.auto_import, dup_policy: cfg.dup_policy || 'skip',
    push_token: cfg.push_token,
  })
})
route('PUT', 'settings/sheets', async ({ req, body }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  if (!isAdmin(s.profile)) return fail('Admin only', 403)
  if (body.sheet_url && !/\/spreadsheets\/d\//.test(String(body.sheet_url))) return fail('That is not a Google Sheets URL')
  const cur = (await getSetting('sheets')) || {}
  await setSetting('sheets', {
    ...cur,
    sheet_url: body.sheet_url || null,
    gid: body.gid || null,
    auto_import: !!body.auto_import,
    dup_policy: body.dup_policy === 'update' ? 'update' : 'skip',
    push_token: cur.push_token || crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, ''),
    updated_at: new Date().toISOString(),
  })
  return json({ ok: true })
})
route('POST', 'sheets/import', async ({ req }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  if (!isAdmin(s.profile)) return fail('Admin only', 403)
  try {
    const result = await import('./_lib.mjs').then((m) => m.syncGoogleSheet())
    if (result.imported > 0) await notify(await adminIds(), `${result.imported} leads imported from Google Sheet`, `${result.duplicates} duplicate(s) skipped`)
    return json(result)
  } catch (e) {
    return fail(e.message, 400)
  }
})

// ── follow-up rules (disposition → auto-task) ─────────────────
route('GET', 'settings/followup-rules', async ({ req }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  if (!isAdmin(s.profile)) return fail('Admin only', 403)
  const rules = (await getSetting('followup_rules')) || DEFAULT_FOLLOWUP_RULES
  return json({ rules })
})

route('PUT', 'settings/followup-rules', async ({ req, body }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  if (!isAdmin(s.profile)) return fail('Admin only', 403)
  const rules = (Array.isArray(body.rules) ? body.rules : [])
    .filter((r) => r && DISPOSITIONS.includes(r.disposition) && String(r.title || '').trim() && Number(r.days) >= 0 && Number(r.days) <= 30)
    .slice(0, 20)
    .map((r) => ({
      disposition: r.disposition,
      title: String(r.title).trim().slice(0, 200),
      days: Number(r.days),
      type: ['callback', 'followup', 'doc_request', 'other'].includes(r.type) ? r.type : 'callback',
    }))
  await setSetting('followup_rules', rules)
  return json({ ok: true, rules })
})

// ── daily targets ─────────────────────────────────────────────
route('GET', 'settings/targets', async ({ req }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  if (!isAdmin(s.profile)) return fail('Admin only', 403)
  return json({ targets: (await getSetting('targets')) || { calls: 40, dispositions: 10 } })
})

route('PUT', 'settings/targets', async ({ req, body }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  if (!isAdmin(s.profile)) return fail('Admin only', 403)
  const targets = {
    calls: Math.max(0, Math.min(500, Number(body.calls) || 0)),
    dispositions: Math.max(0, Math.min(500, Number(body.dispositions) || 0)),
  }
  await setSetting('targets', targets)
  return json({ ok: true, targets })
})

// ── me ────────────────────────────────────────────────────────
route('GET', 'me', async ({ req }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  return json({ profile: s.profile })
})

// ── heartbeat (active-time tracking) ──────────────────────────
route('POST', 'heartbeat', async ({ req, body }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  const seconds = Math.max(0, Math.min(300, Number(body.seconds) || 60))
  await service.rpc('increment_activity', {
    p_user: s.user.id, p_day: today(), p_seconds: seconds, p_pings: 1,
  })
  await service.from('profiles').update({ last_active_at: new Date().toISOString() }).eq('id', s.user.id)
  return json({ ok: true })
})

// ── dashboard ─────────────────────────────────────────────────
route('GET', 'dashboard', async ({ req }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  const admin = isAdmin(s.profile)
  const me = s.user.id

  const leadQ = service.from('leads').select('id,disposition,created_at,assigned_to,next_followup_at,first_name,last_name,phone,email').limit(20000)
  if (!admin) leadQ.eq('assigned_to', me)
  const { data: leads } = await leadQ

  const msgQ = service.from('email_messages').select('id,created_at,sent_by,opens').limit(20000)
  if (!admin) msgQ.eq('sent_by', me)
  const { data: emails } = await msgQ

  const byDisposition = {}
  for (const l of leads || []) byDisposition[l.disposition] = (byDisposition[l.disposition] || 0) + 1
  const total = (leads || []).length
  const signed = (byDisposition.Signed || 0) + (byDisposition.Approved || 0)

  const dayKey = (iso) => (iso || '').slice(0, 10)
  const todayK = today()
  const series = []
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10)
    series.push({
      day: d,
      leads: (leads || []).filter((l) => dayKey(l.created_at) === d).length,
      emails: (emails || []).filter((m) => dayKey(m.created_at) === d).length,
      opens: (emails || []).filter((m) => (m.last_opened_at || '').slice(0, 10) === d).length,
    })
  }

  const endOfDay = todayK + 'T23:59:59'
  const fuTaskQ = service.from('tasks').select('id,title,type,due_at,customer_tz,lead_id,leads(first_name,last_name,phone)').eq('status', 'open').lte('due_at', endOfDay).order('due_at').limit(10)
  if (!admin) fuTaskQ.eq('assigned_to', me)
  const { data: dueTasks } = await fuTaskQ

  const fuLeadQ = service.from('leads').select('id,first_name,last_name,phone,next_followup_at,disposition').not('next_followup_at', 'is', null).lte('next_followup_at', endOfDay).neq('disposition', 'Signed').neq('disposition', 'Approved').neq('disposition', 'Not Interested').order('next_followup_at').limit(10)
  if (!admin) fuLeadQ.eq('assigned_to', me)
  const { data: dueLeads } = await fuLeadQ

  const actQ = service.from('activities').select('id,type,title,created_at,lead_id,leads(first_name,last_name)').order('created_at', { ascending: false }).limit(8)
  if (!admin) actQ.eq('user_id', me)
  const { data: recent } = await actQ

  const out = {
    role: s.profile.role,
    totals: { leads: total, signed, approved: byDisposition.Approved || 0, conversion: total ? Math.round((signed / total) * 1000) / 10 : 0 },
    byDisposition,
    today: {
      newLeads: (leads || []).filter((l) => dayKey(l.created_at) === todayK).length,
      emailsSent: (emails || []).filter((m) => dayKey(m.created_at) === todayK).length,
    },
    series, dueTasks: dueTasks || [], dueLeads: dueLeads || [], recent: recent || [],
  }

  if (admin) {
    const { data: users } = await service.from('profiles').select('id,name,email,role,is_active').eq('is_active', true)
    const { data: actToday } = await service.from('user_activity_days').select('user_id,seconds').eq('day', todayK)
    const team = (users || []).map((u) => {
      const mine = (leads || []).filter((l) => l.assigned_to === u.id)
      const sg = mine.filter((l) => l.disposition === 'Signed' || l.disposition === 'Approved').length
      return {
        id: u.id, name: u.name, email: u.email, role: u.role,
        leads: mine.length, signed: sg,
        conversion: mine.length ? Math.round((sg / mine.length) * 1000) / 10 : 0,
        activeSeconds: (actToday || []).find((a) => a.user_id === u.id)?.seconds || 0,
        emailsSent: (emails || []).filter((m) => m.sent_by === u.id).length,
      }
    })
    out.team = team

    // admin escalation panel: assigned leads nobody touched in 7+ days
    const cutoff7 = new Date(Date.now() - 7 * 86400000).toISOString()
    const { data: att } = await service.from('leads')
      .select('id,first_name,last_name,disposition,last_activity_at,created_at,assigned_to,profiles!leads_assigned_to_fkey(name)')
      .lt('created_at', cutoff7)
      .or(`last_activity_at.is.null,last_activity_at.lt.${cutoff7}`)
      .not('disposition', 'in', '("Signed","Approved")')
      .not('assigned_to', 'is', null)
      .order('last_activity_at', { ascending: true, nullsFirst: true })
      .limit(10)
    out.attention = att || []

    // weekly agent leaderboard (last 7 days of real activity)
    const weekStart = new Date(Date.now() - 7 * 86400000).toISOString()
    const { data: weekActs } = await service.from('activities')
      .select('user_id,type,title,detail').gte('created_at', weekStart).limit(20000)
    const { data: weekEmails } = await service.from('email_messages')
      .select('sent_by').gte('created_at', weekStart).limit(20000)
    out.leaderboard = (out.team || []).filter((u) => u.role === 'agent').map((u) => {
      const mine = (weekActs || []).filter((a) => a.user_id === u.id)
      const calls = mine.filter((a) => a.type === 'note' && (a.title || '').startsWith('📞')).length
      const dispositions = mine.filter((a) => a.type === 'disposition').length
      const signed = mine.filter((a) => a.type === 'disposition' && ['Signed', 'Approved'].includes(a.detail?.to)).length
      const emails = (weekEmails || []).filter((e) => e.sent_by === u.id).length
      return { name: u.name, calls, dispositions, signed, emails, score: calls + emails + dispositions + signed * 5 }
    }).sort((a, b) => b.score - a.score)
  }

  // daily-target progress (agent's own activity today)
  const targets = (await getSetting('targets')) || { calls: 40, dispositions: 10 }
  const { data: actsToday } = await service.from('activities')
    .select('type,title').eq('user_id', me).gte('created_at', isoDayStart()).limit(2000)
  const { count: tasksDoneToday } = await service.from('tasks')
    .select('id', { count: 'exact', head: true }).eq('assigned_to', me).gte('completed_at', isoDayStart())
  out.todayActivity = {
    calls: (actsToday || []).filter((a) => a.type === 'note' && (a.title || '').startsWith('📞')).length,
    dispositions: (actsToday || []).filter((a) => a.type === 'disposition').length,
    tasksDone: tasksDoneToday || 0,
  }
  out.targets = targets

  return json(out)
})

// ── notifications ─────────────────────────────────────────────
route('GET', 'notifications', async ({ req }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  const { data } = await service.from('notifications').select('*').eq('user_id', s.user.id).order('created_at', { ascending: false }).limit(30)
  return json({ notifications: data || [], unread: (data || []).filter((n) => !n.read).length })
})
route('POST', 'notifications/read', async ({ req, body }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  let q = service.from('notifications').update({ read: true }).eq('user_id', s.user.id)
  const ids = Array.isArray(body.ids) ? body.ids.slice(0, 100) : [] // cap payload
  if (ids.length) q = q.in('id', ids)
  else q = q.eq('read', false)
  await q
  return json({ ok: true })
})

// ── tasks ─────────────────────────────────────────────────────
route('GET', 'tasks', async ({ req, query }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  let q = service.from('tasks').select('*, leads(id,first_name,last_name,phone,disposition)').order('created_at', { ascending: false }).limit(300)
  const status = query.get('status')
  if (status && status !== 'all') q = q.eq('status', status)
  if (!isAdmin(s.profile) || query.get('scope') === 'me') q = q.eq('assigned_to', s.user.id)
  const { data } = await q
  return json({ tasks: data || [] })
})
// ── server time (timezone clocks sync against THIS, not the device clock) ──
route('GET', 'time', async () => json({ now: new Date().toISOString() }))
route('POST', 'tasks', async ({ req, body }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  const assigned = isAdmin(s.profile) ? body.assigned_to || s.user.id : s.user.id
  const tz = body.customer_tz || null
  if (tz) {
    try { new Intl.DateTimeFormat('en', { timeZone: tz }) } catch { return fail('Unknown timezone') }
  }
  let dueAt = body.due_at || null
  if (body.type === 'callback') {
    if (!dueAt) return fail('Pick a date and time for the callback')
    // Compare against REAL server UTC time — never a client clock.
    if (new Date(dueAt).getTime() <= Date.now()) return fail('That callback time is already in the past (checked against server time)')
  }
  const { data, error } = await service.from('tasks').insert({
    title: body.title, notes: body.notes || null, type: body.type || 'callback',
    lead_id: body.lead_id || null, assigned_to: assigned, created_by: s.user.id,
    due_at: dueAt, customer_tz: tz,
  }).select('*, leads(id,first_name,last_name,phone,disposition)').single()
  if (error) {
    // Pre-migration DBs lack the customer_tz column — degrade gracefully.
    if (tz && /customer_tz/i.test(error.message || '')) {
      const r2 = await service.from('tasks').insert({
        title: body.title, notes: body.notes || null, type: body.type || 'callback',
        lead_id: body.lead_id || null, assigned_to: assigned, created_by: s.user.id,
        due_at: dueAt,
      }).select('*, leads(id,first_name,last_name,phone,disposition)').single()
      if (r2.error) return fail(r2.error.message)
      return finishTask(r2.data)
    }
    return fail(error.message)
  }
  return finishTask(data)

  async function finishTask(task) {
    if (task.lead_id) await import('./_lib.mjs').then((m) => m.logActivity(task.lead_id, s.user.id, 'task', `✔ Task created: ${task.title}`))
    // Scheduled callback → notify the agent in IST, restating the customer's local time.
    if (task.type === 'callback' && task.due_at) {
      try {
        const m = await import('./_lib.mjs')
        const leadName = task.leads ? [task.leads.first_name, task.leads.last_name].filter(Boolean).join(' ') : task.title
        const text = m.callbackNotifyText(leadName, task.due_at, task.customer_tz)
        await m.notify([task.assigned_to], '📅 Callback scheduled', text, task.lead_id || null)
      } catch {}
    }
    return json({ task })
  }
})
route('PATCH', 'tasks/:id', async ({ req, params, body }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  const { data: existing } = await service.from('tasks').select('id,assigned_to,lead_id').eq('id', params.id).single()
  if (!existing) return fail('Task not found', 404)
  if (!isAdmin(s.profile) && existing.assigned_to !== s.user.id) return unauthorized()
  const patch = {}
  for (const k of ['title', 'notes', 'due_at', 'type']) if (k in body) patch[k] = body[k]
  if ('status' in body) {
    patch.status = body.status
    patch.completed_at = body.status === 'done' ? new Date().toISOString() : null
  }
  const { data, error } = await service.from('tasks').update(patch).eq('id', params.id)
    .select('*, leads(id,first_name,last_name,phone,disposition)').single()
  if (error) return fail(error.message)
  if (data.lead_id && 'status' in body) {
    await import('./_lib.mjs').then((m) => m.logActivity(data.lead_id, s.user.id, 'task', body.status === 'done' ? `✔ Task completed: ${data.title}` : `↩ Task reopened: ${data.title}`))
  }
  return json({ task: data })
})
// ── my scheduled callbacks due within the next 45 minutes (reminder polling) ──
// Pure UTC math against the stored absolute timestamp — never string compares.
route('GET', 'callbacks/upcoming', async ({ req }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  const now = new Date()
  const soon = new Date(now.getTime() + 45 * 60000)
  const { data } = await service.from('tasks')
    .select('id,title,due_at,customer_tz,lead_id,leads(first_name,last_name)')
    .eq('assigned_to', s.user.id).eq('status', 'open').eq('type', 'callback')
    .gte('due_at', now.toISOString()).lte('due_at', soon.toISOString())
    .order('due_at').limit(10)
  return json({ callbacks: data || [] })
})
route('DELETE', 'tasks/:id', async ({ req, params }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  if (!isAdmin(s.profile)) return fail('Admin only', 403)
  await service.from('tasks').delete().eq('id', params.id)
  return json({ ok: true })
})

// ── templates ─────────────────────────────────────────────────
route('GET', 'templates', async ({ req, query }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  let q = service.from('templates').select('*').order('created_at')
  if (query.get('type')) q = q.eq('type', query.get('type'))
  const { data } = await q
  return json({ templates: data || [] })
})
route('POST', 'templates', async ({ req, body }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  if (!isAdmin(s.profile)) return fail('Admin only', 403)
  const { data, error } = await service.from('templates').insert({
    type: body.type, name: body.name, subject: body.subject || null,
    body: body.body || '', updated_by: s.user.id,
  }).select('*').single()
  if (error) return fail(error.message)
  return json({ template: data })
})
route('PATCH', 'templates/:id', async ({ req, params, body }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  if (!isAdmin(s.profile)) return fail('Admin only', 403)
  const { data, error } = await service.from('templates').update({
    name: body.name, subject: body.subject || null, body: body.body || '',
    updated_by: s.user.id, updated_at: new Date().toISOString(),
  }).eq('id', params.id).select('*').single()
  if (error) return fail(error.message)
  return json({ template: data })
})
route('DELETE', 'templates/:id', async ({ req, params }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  if (!isAdmin(s.profile)) return fail('Admin only', 403)
  await service.from('templates').delete().eq('id', params.id)
  return json({ ok: true })
})

// ── scripts ───────────────────────────────────────────────────
route('GET', 'scripts', async ({ req, query }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  let q = service.from('scripts').select('*').order('created_at')
  if (query.get('type')) q = q.eq('type', query.get('type'))
  const { data } = await q
  return json({ scripts: data || [] })
})
route('POST', 'scripts', async ({ req, body }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  if (!isAdmin(s.profile)) return fail('Admin only', 403)
  const { data, error } = await service.from('scripts').insert({
    title: body.title, type: body.type || 'general', content: body.content || '', updated_by: s.user.id,
  }).select('*').single()
  if (error) return fail(error.message)
  return json({ script: data })
})
route('PATCH', 'scripts/:id', async ({ req, params, body }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  if (!isAdmin(s.profile)) return fail('Admin only', 403)
  const { data, error } = await service.from('scripts').update({
    title: body.title, type: body.type, content: body.content,
    updated_by: s.user.id, updated_at: new Date().toISOString(),
  }).eq('id', params.id).select('*').single()
  if (error) return fail(error.message)
  return json({ script: data })
})
route('DELETE', 'scripts/:id', async ({ req, params }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  if (!isAdmin(s.profile)) return fail('Admin only', 403)
  await service.from('scripts').delete().eq('id', params.id)
  return json({ ok: true })
})

// ── users (admin) ─────────────────────────────────────────────
route('GET', 'users', async ({ req }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  if (!isAdmin(s.profile)) return fail('Admin only', 403)
  const { data: users } = await service.from('profiles').select('*').order('created_at')
  const { data: counts } = await service.from('leads').select('assigned_to')
  const { data: act } = await service.from('user_activity_days').select('user_id,day,seconds')
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
  const out = (users || []).map((u) => ({
    ...u,
    leadCount: (counts || []).filter((c) => c.assigned_to === u.id).length,
    activeToday: (act || []).find((a) => a.user_id === u.id && a.day === today())?.seconds || 0,
    activeWeek: (act || []).filter((a) => a.user_id === u.id && a.day >= weekAgo).reduce((x, a) => x + a.seconds, 0),
  }))
  return json({ users: out })
})
route('GET', 'users/agents', async ({ req }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  const { data } = await service.from('profiles').select('id,name,role').eq('is_active', true).order('name')
  return json({ users: data || [] })
})
route('POST', 'users', async ({ req, body }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  if (!isAdmin(s.profile)) return fail('Admin only', 403)
  if (!body.email || !body.password || body.password.length < 6) return fail('Email and a 6+ character password are required')
  const { data, error } = await service.auth.admin.createUser({
    email: body.email, password: body.password, email_confirm: true,
    user_metadata: { name: body.name || body.email.split('@')[0], role: body.role === 'admin' ? 'admin' : 'agent' },
  })
  if (error) return fail(error.message)
  // agent phone (used in welcome emails) + lead capacity (used by round-robin)
  const extra = {}
  if (body.phone) extra.phone = String(body.phone).replace(/[^\d+()\- ]/g, '').slice(0, 30)
  if ('max_leads' in body) extra.max_leads = body.max_leads === null ? null : Math.max(0, Math.min(100000, Number(body.max_leads) || 0))
  if (Object.keys(extra).length) await service.from('profiles').update(extra).eq('id', data.user.id)
  return json({ user: { id: data.user.id, email: data.user.email } })
})
route('PATCH', 'users/:id', async ({ req, params, body }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  if (!isAdmin(s.profile)) return fail('Admin only', 403)
  const patch = {}
  if ('name' in body) patch.name = body.name
  if ('role' in body) patch.role = body.role
  if ('is_active' in body) patch.is_active = !!body.is_active
  if ('phone' in body) patch.phone = body.phone ? String(body.phone).replace(/[^\d+()\- ]/g, '').slice(0, 30) : null
  if ('max_leads' in body) {
    if (body.max_leads !== null && body.max_leads !== '' && !Number.isFinite(Number(body.max_leads))) return fail('Max leads must be a number')
    patch.max_leads = body.max_leads === null || body.max_leads === '' ? null : Math.max(0, Math.min(100000, Math.round(Number(body.max_leads))))
  }
  if (Object.keys(patch).length) await service.from('profiles').update(patch).eq('id', params.id)
  if (body.password) {
    const { error } = await service.auth.admin.updateUserById(params.id, { password: body.password })
    if (error) return fail(error.message)
  }
  return json({ ok: true })
})
