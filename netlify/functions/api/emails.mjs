import { route } from './_router.mjs'
import {
  service, json, fail, getSession, unauthorized, logActivity,
  sendLeadEmail, baseUrl, encrypt, decrypt,
} from './_lib.mjs'
import nodemailer from 'nodemailer'

const isAdmin = (p) => p?.role === 'admin'

// ── send a follow-up email to a lead ──────────────────────────
route('POST', 'leads/:id/email', async ({ req, params, body, url }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  const { data: lead } = await service.from('leads').select('*').eq('id', params.id).single()
  if (!lead) return fail('Lead not found', 404)
  if (s.profile.role !== 'admin' && lead.assigned_to !== s.user.id) return unauthorized()
  if (!lead.email) return fail('This lead has no email address')
  if (!body.subject || !body.body) return fail('Subject and body are required')

  try {
    const info = await sendLeadEmail({
      lead, agent: s.profile,
      subject: body.subject, html: body.body,
      purpose: body.purpose || 'followups',
      baseUrl: baseUrl(url),
    })
    await logActivity(lead.id, s.user.id, 'email_sent', `✉️ Email sent: ${body.subject}`, { purpose: body.purpose })
    return json({ ok: true, id: info.id, smtp: info.profile })
  } catch (e) {
    // Config/SMTP errors are the sender's to fix — 400, not a server fault.
    return fail(e.message, 400)
  }
})

// ── SMTP profiles CRUD ────────────────────────────────────────
route('GET', 'smtp', async ({ req }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  if (!isAdmin(s.profile)) return fail('Admin only', 403)
  const { data } = await service.from('smtp_profiles').select('*').order('created_at')
  return json({ profiles: (data || []).map(({ password_enc, ...p }) => ({ ...p, has_password: !!password_enc })) })
})

route('POST', 'smtp', async ({ req, body }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  if (!isAdmin(s.profile)) return fail('Admin only', 403)
  if (!body.host || !body.username || !body.password) return fail('Host, username and password are required')
  const { data, error } = await service.from('smtp_profiles').insert({
    name: body.name || `${body.host} (${body.purpose})`,
    purpose: body.purpose || 'general',
    host: body.host, port: Number(body.port) || 587, secure: !!body.secure,
    username: body.username, password_enc: encrypt(body.password),
    from_name: body.from_name || '', from_email: body.from_email || body.username,
    daily_limit: Number(body.daily_limit) || 300,
  }).select('*').single()
  if (error) return fail(error.message)
  return json({ profile: { ...data, password_enc: undefined, has_password: true } })
})

route('PATCH', 'smtp/:id', async ({ req, params, body }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  if (!isAdmin(s.profile)) return fail('Admin only', 403)
  const patch = {
    name: body.name, purpose: body.purpose, host: body.host,
    port: Number(body.port) || 587, secure: !!body.secure,
    username: body.username, from_name: body.from_name || '',
    from_email: body.from_email, daily_limit: Number(body.daily_limit) || 300,
    is_active: 'is_active' in body ? !!body.is_active : true,
  }
  if (body.password) patch.password_enc = encrypt(body.password)
  const { data, error } = await service.from('smtp_profiles').update(patch).eq('id', params.id).select('*').single()
  if (error) return fail(error.message)
  return json({ profile: { ...data, password_enc: undefined, has_password: true } })
})

route('DELETE', 'smtp/:id', async ({ req, params }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  if (!isAdmin(s.profile)) return fail('Admin only', 403)
  await service.from('smtp_profiles').delete().eq('id', params.id)
  return json({ ok: true })
})

route('POST', 'smtp/:id/test', async ({ req, params, body }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  if (!isAdmin(s.profile)) return fail('Admin only', 403)
  const { data: prof } = await service.from('smtp_profiles').select('*').eq('id', params.id).single()
  if (!prof) return fail('Profile not found', 404)
  const pass = decrypt(prof.password_enc)
  if (!pass) return fail('Stored password could not be decrypted — re-enter it')
  try {
    const tr = nodemailer.createTransport({
      host: prof.host, port: prof.port, secure: !!prof.secure,
      auth: { user: prof.username, pass },
    })
    await tr.sendMail({
      from: prof.from_name ? `"${prof.from_name}" <${prof.from_email}>` : prof.from_email,
      to: body.to, subject: 'ABA SMTP test — ' + prof.name,
      html: `<p>This is a test email from your ABA SMTP profile <b>${prof.name}</b> (${prof.purpose}).</p><p>If you received this, deliverability works. ✅</p>`,
    })
    return json({ ok: true })
  } catch (e) {
    // A failed test = wrong host/credentials — the admin's config, not the
    // server's fault. 400 keeps it a recoverable error in logs/monitoring.
    return fail(`SMTP test failed: ${e.message}`, 400)
  }
})
