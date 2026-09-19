import crypto from 'node:crypto'
import { route } from './_router.mjs'
import {
  service, json, fail, getSession, unauthorized, logActivity, notify,
  getSetting, setSetting, encrypt, metaSecrets, sendCapi, pickAgentRoundRobin, maybeSendWelcomeEmail,
} from './_lib.mjs'

const isAdmin = (p) => p?.role === 'admin'

// ── settings (admin UI) ───────────────────────────────────────
route('GET', 'meta/settings', async ({ req, url }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  if (!isAdmin(s.profile)) return fail('Admin only', 403)
  const raw = await getSetting('meta')
  const meta = raw || {}
  return json({
    pixel_id: meta.pixel_id || '',
    test_event_code: meta.test_event_code || '',
    page_id: meta.page_id || '',
    has_capi_token: !!meta.capi_token,
    has_page_token: !!meta.page_token,
    has_app_secret: !!meta.app_secret,
    verify_token: process.env.META_VERIFY_TOKEN || '',
    webhook_url: `${url.origin}/api/meta/webhook`,
  })
})

route('PUT', 'meta/settings', async ({ req, body }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  if (!isAdmin(s.profile)) return fail('Admin only', 403)
  const cur = (await getSetting('meta')) || {}
  const next = { ...cur }
  for (const k of ['pixel_id', 'test_event_code', 'page_id']) if (k in body) next[k] = body[k] || null
  // tokens: only overwrite when a new (non-blank) value arrives; stored encrypted
  for (const k of ['capi_token', 'page_token', 'app_secret']) {
    if (body[k]) next[k] = encrypt(body[k])
  }
  await setSetting('meta', next)
  return json({ ok: true })
})

route('POST', 'meta/test', async ({ req }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  if (!isAdmin(s.profile)) return fail('Admin only', 403)
  const meta = metaSecrets(await getSetting('meta'))
  const result = await sendCapi(meta, {
    eventName: 'ABA_Test',
    lead: { id: crypto.randomUUID(), email: 'test@example.com', phone: '+15550000000' },
    custom: { note: 'CRM connectivity test' },
  })
  return json(result)
})

// ── webhook: receives new Meta instant-form leads ─────────────
route('GET', 'meta/webhook', async ({ query }) => {
  if (query.get('hub.mode') === 'subscribe' && query.get('hub.verify_token') === process.env.META_VERIFY_TOKEN) {
    return new Response(query.get('hub.challenge'), { status: 200 })
  }
  return fail('Verification failed', 403)
})

route('POST', 'meta/webhook', async ({ req, raw, context }) => {
  const meta = metaSecrets(await getSetting('meta'))
  // Fail closed: without an app secret there is no way to prove a payload
  // came from Meta, and this endpoint is publicly reachable — accepting
  // unsigned payloads would let anyone inject fake leads.
  if (!meta?.app_secret) return fail('Webhook is not configured yet — save the App secret in Admin → Integrations first', 503)
  const sig = (req.headers.get('x-hub-signature-256') || '')
  const expected = 'sha256=' + crypto.createHmac('sha256', meta.app_secret).update(raw || '').digest('hex')
  if (sig !== expected) return fail('Invalid signature', 403)
  let payload
  try {
    payload = JSON.parse(raw || '{}')
  } catch {
    payload = {}
  }
  const leadgens = []
  for (const entry of payload.entry || []) {
    for (const ch of entry.changes || []) {
      const v = ch.value || {}
      if (v.leadgen_id) leadgens.push({ leadgen_id: v.leadgen_id, form_id: v.form_id })
    }
  }
  if (leadgens.length) context.waitUntil((async () => {
    for (const lg of leadgens) {
      try { await processMetaLead(lg.leadgen_id, lg.form_id) } catch (e) { console.error('meta lead failed', e) }
    }
  })())
  return json({ success: true })
})

// ── manual backfill pull (admin) ──────────────────────────────
route('POST', 'meta/sync', async ({ req }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  if (!isAdmin(s.profile)) return fail('Admin only', 403)
  const meta = metaSecrets(await getSetting('meta'))
  if (!meta?.page_token || !meta?.page_id) return fail('Set the Page ID and Page Access Token first')
  const formsRes = await fetch(`https://graph.facebook.com/v21.0/${meta.page_id}/leadgen_forms?fields=id,name&limit=25&access_token=${encodeURIComponent(meta.page_token)}`)
  const forms = await formsRes.json()
  if (forms.error) return fail(forms.error.message)
  let processed = 0, skipped = 0, errors = 0
  for (const f of forms.data || []) {
    const leadsRes = await fetch(`https://graph.facebook.com/v21.0/${f.id}/leads?limit=100&access_token=${encodeURIComponent(meta.page_token)}`)
    const leadsJson = await leadsRes.json()
    for (const l of leadsJson.data || []) {
      try {
        const r = await processMetaLead(l.id, f.id, f.name)
        if (r?.skipped) skipped++; else processed++
      } catch { errors++ }
    }
  }
  return json({ processed, skipped, errors })
})

// ── shared: turn a Meta leadgen_id into a CRM lead ────────────
async function processMetaLead(leadgenId, formId, formNameHint) {
  const { data: dup } = await service.from('leads').select('id').eq('meta_lead_id', leadgenId).maybeSingle()
  if (dup) return { skipped: true }

  const meta = metaSecrets(await getSetting('meta'))
  if (!meta?.page_token) throw new Error('Meta page token missing')
  const res = await fetch(`https://graph.facebook.com/v21.0/${leadgenId}?access_token=${encodeURIComponent(meta.page_token)}`)
  const data = await res.json()
  if (data.error) throw new Error(data.error.message)
  const f = {}
  for (const item of data.field_data || []) f[(item.name || '').toLowerCase().trim()] = (item.values || []).join(' ')

  const full = f['full_name'] || ''
  const first = f['first_name'] || (full ? full.split(' ')[0] : 'Meta Lead')
  const last = f['last_name'] || (full ? full.slice(first.length).trim() : '')

  let dob = null
  const dobRaw = f['date_of_birth'] || f['dob'] || ''
  const m1 = dobRaw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const m2 = dobRaw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m1) dob = `${m1[1]}-${m1[2]}-${m1[3]}`
  else if (m2) dob = `${m2[3]}-${m2[1].padStart(2, '0')}-${m2[2].padStart(2, '0')}`

  const yesNo = (v) => (['yes', 'y', 'true', '1'].includes(String(v).trim().toLowerCase()) ? true
    : ['no', 'n', 'false', '0'].includes(String(v).trim().toLowerCase()) ? false : null)
  const findField = (...keys) => {
    for (const k of Object.keys(f)) if (keys.some((x) => k.includes(x))) return f[k]
    return null
  }

  // respect the admin's Automation setting (off → unassigned pool)
  const assigned = await pickAgentRoundRobin()

  let formName = formNameHint || null
  if (!formName && formId) {
    const fr = await fetch(`https://graph.facebook.com/v21.0/${formId}?fields=name&access_token=${encodeURIComponent(meta.page_token)}`)
    const fj = await fr.json()
    formName = fj.name || null
  }

  const { data: lead, error } = await service.from('leads').insert({
    first_name: first, last_name: last,
    email: (f['email'] || '').toLowerCase() || null,
    phone: f['phone_number'] || f['phone'] || null,
    dob, state: f['state'] || findField('state'), city: f['city'] || null,
    worked_5_of_10: yesNo(findField('work', 'worked')),
    receiving_benefits: yesNo(findField('receiving', 'benefits', 'ssi', 'ssdi')),
    duration_12m: yesNo(findField('12', 'duration', 'lasting')),
    has_attorney: yesNo(findField('attorney', 'lawyer')),
    disability: findField('disability', 'condition', 'impairment'),
    source: 'meta', campaign: f['campaign_name'] || null, form_name: formName,
    meta_lead_id: leadgenId, assigned_to: assigned,
  }).select('*').single()
  if (error) throw new Error(error.message)
  await logActivity(lead.id, null, 'created', `⚡ Lead arrived from Meta${formName ? ` (${formName})` : ''}`)
  if (assigned) {
    await notify([assigned], '⚡ New Meta lead assigned to you', `${first} ${last}`.trim(), lead.id)
    await maybeSendWelcomeEmail(lead, assigned)
  }
  return { created: true }
}
