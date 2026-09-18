import { route } from './_router.mjs'
import {
  service, json, fail, getSession, unauthorized, logActivity, notify, adminIds, baseUrl,
} from './_lib.mjs'

const isAdmin = (p) => p?.role === 'admin'
const clean = (n) => String(n || 'file').replace(/[^\w.\- ]+/g, '_').slice(0, 120)

// ── create a secure upload link for a claimant ────────────────
route('POST', 'leads/:id/doc-request', async ({ req, params, body, url }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  const { data: lead } = await service.from('leads').select('*').eq('id', params.id).single()
  if (!lead) return fail('Lead not found', 404)
  if (!isAdmin(s.profile) && lead.assigned_to !== s.user.id) return unauthorized()

  const expiresDays = Math.min(60, Math.max(1, Number(body.expires_days) || 7))
  const { data: row, error } = await service.from('doc_requests').insert({
    lead_id: lead.id,
    doc_types: body.doc_types || [],
    message: body.message || null,
    created_by: s.user.id,
    expires_at: new Date(Date.now() + expiresDays * 86400000).toISOString(),
  }).select('*').single()
  if (error) return fail(error.message)

  await logActivity(lead.id, s.user.id, 'doc_requested', `📂 Document request sent (${(body.doc_types || []).join(', ')})`)
  return json({ request: row, url: `${baseUrl(url)}/upload/${row.token}` })
})

// ── list requests ─────────────────────────────────────────────
route('GET', 'doc-requests', async ({ req }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  let q = service.from('doc_requests').select('*, leads(id,first_name,last_name,phone,assigned_to)').order('created_at', { ascending: false }).limit(200)
  const { data } = await q
  const rows = (isAdmin(s.profile) ? data || [] : (data || []).filter((r) => r.leads?.assigned_to === s.user.id))
  return json({ requests: rows })
})

// ── signed download URL for an uploaded document ──────────────
route('GET', 'documents/:id/url', async ({ req, params, url }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  const { data: doc } = await service.from('documents').select('*, leads(assigned_to)').eq('id', params.id).single()
  if (!doc) return fail('Not found', 404)
  if (!isAdmin(s.profile) && doc.leads?.assigned_to !== s.user.id) return unauthorized()
  const { data } = await service.storage.from('documents').createSignedUrl(doc.storage_path, 3600, { download: doc.file_name || true })
  if (data?.signedUrl) return json({ url: data.signedUrl })
  return fail('Could not create download link', 500)
})

// ══════════════ PUBLIC (claimant, token-based — no login) ══════════════
async function validRequest(token) {
  const { data: row } = await service.from('doc_requests').select('*, leads(first_name,last_name)').eq('token', token).maybeSingle()
  if (!row) return { error: 'Invalid or expired link', status: 404 }
  if (new Date(row.expires_at) < new Date()) return { error: 'This secure link has expired. Please contact your agent for a new one.', status: 410 }
  return { row }
}

route('GET', 'doc/:token', async ({ params }) => {
  const { row, error, status } = await validRequest(params.token)
  if (error) return fail(error, status)
  const { data: docs } = await service.from('documents').select('doc_type,file_name,uploaded_at').eq('request_id', row.id)
  return json({
    claimant: `${row.leads?.first_name || ''} ${row.leads?.last_name || ''}`.trim(),
    docTypes: row.doc_types || [],
    message: row.message,
    status: row.status,
    expires_at: row.expires_at,
    uploaded: docs || [],
  })
})

route('POST', 'doc/:token/upload-url', async ({ params, body }) => {
  const { row, error, status } = await validRequest(params.token)
  if (error) return fail(error, status)
  const path = `claims/${row.token}/${Date.now()}_${clean(body.file_name)}`
  const { data, error: upErr } = await service.storage.from('documents').createSignedUploadUrl(path)
  if (upErr || !data?.signedUrl) return fail('Could not start upload', 500)
  return json({ signed_url: data.signedUrl, path: data.path, token: data.token })
})

route('POST', 'doc/:token/confirm', async ({ params, body }) => {
  const { row, error, status } = await validRequest(params.token)
  if (error) return fail(error, status)
  if (!body.path) return fail('Missing upload path')
  const { data: doc, error: insErr } = await service.from('documents').insert({
    lead_id: row.lead_id, request_id: row.id,
    doc_type: body.doc_type || 'Document', file_name: clean(body.file_name),
    storage_path: body.path, size_bytes: body.size || null,
  }).select('*').single()
  if (insErr) return fail(insErr.message)
  await service.from('doc_requests').update({ status: 'uploaded', uploaded_at: new Date().toISOString() }).eq('id', row.id)
  await logActivity(row.lead_id, null, 'doc_uploaded', `📎 Claimant uploaded: ${doc.doc_type} (${doc.file_name})`)
  await notify([row.created_by, ...(await adminIds())], '📄 Documents received', `A claimant uploaded ${doc.doc_type}`, row.lead_id)
  return json({ ok: true, doc: { doc_type: doc.doc_type, file_name: doc.file_name } })
})
