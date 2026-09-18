import { route } from './_router.mjs'
import {
  service, json, fail, getSession, unauthorized, logActivity, notify, adminIds,
  getSetting, setSetting, encrypt, decrypt, driveFor, ensureFolder,
} from './_lib.mjs'

const isAdmin = (p) => p?.role === 'admin'
const clean = (n) => String(n || 'recording').replace(/[^\w.\- ]+/g, '_').slice(0, 120)
const typeLabel = (t) => (t === 'frontend' ? 'Front-End' : 'Verification')

// ── request a signed upload slot, then the file lands in Supabase Storage
// and gets transferred to the agent's Google Drive folder ──────────────
route('POST', 'leads/:id/recordings', async ({ req, params, body }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  const { data: lead } = await service.from('leads').select('*').eq('id', params.id).single()
  if (!lead) return fail('Lead not found', 404)
  if (!isAdmin(s.profile) && lead.assigned_to !== s.user.id) return unauthorized()
  const type = body.type === 'verification' ? 'verification' : 'frontend'

  const path = `recordings/${lead.id}/${type}_${Date.now()}_${clean(body.file_name)}`
  const { data: up, error: upErr } = await service.storage.from('recordings').createSignedUploadUrl(path)
  if (upErr || !up?.signedUrl) return fail('Could not start upload', 500)

  const { data: row, error } = await service.from('recordings').insert({
    lead_id: lead.id, type, file_name: clean(body.file_name),
    storage_path: path, status: 'uploading', uploaded_by: s.user.id,
  }).select('*').single()
  if (error) return fail(error.message)
  return json({ recording: row, signed_url: up.signedUrl, path: up.path })
})

route('POST', 'recordings/confirm', async ({ req, body, context }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  const { data: row } = await service.from('recordings').select('*').eq('id', body.recording_id).single()
  if (!row) return fail('Recording not found', 404)
  // Ownership: only the uploader or the lead's assigned agent (or an admin)
  // may trigger the Drive transfer.
  if (!isAdmin(s.profile)) {
    const { data: lead } = await service.from('leads').select('assigned_to').eq('id', row.lead_id).single()
    if (row.uploaded_by !== s.user.id && lead?.assigned_to !== s.user.id) return unauthorized()
  }
  await service.from('recordings').update({ status: 'processing' }).eq('id', row.id)
  context.waitUntil(transferToDrive(row))
  return json({ ok: true, status: 'processing' })
})

async function transferToDrive(row) {
  try {
    const leadRes = await service.from('leads').select('*, profiles!leads_assigned_to_fkey(name)').eq('id', row.lead_id).single()
    const lead = leadRes.data
    const driveSettings = await getSetting('drive')
    const drive = driveFor(driveSettings)
    if (!drive || !driveSettings?.root_folder_id) throw new Error('Google Drive is not configured (Admin → Integrations)')

    const agentFolder = await ensureFolder(drive, lead?.profiles?.name || 'Unassigned', driveSettings.root_folder_id)
    const leadName = `${lead?.first_name || ''} ${lead?.last_name || ''}`.trim() || 'Lead'
    const leadFolder = await ensureFolder(drive, leadName, agentFolder)

    const { data: blob } = await service.storage.from('recordings').download(row.storage_path)
    if (!blob) throw new Error('Could not read uploaded file from storage')
    const buf = Buffer.from(await blob.arrayBuffer())

    const ext = (row.file_name.split('.').pop() || 'mp4').toLowerCase()
    const date = new Date().toISOString().slice(0, 16).replace('T', ' ')
    const file = await drive.uploadFile(
      `${typeLabel(row.type)} – ${leadName} – ${date}.${ext}`,
      leadFolder,
      blob.type || 'application/octet-stream',
      buf
    )
    await drive.setPermissionAnyoneReader(file.id)

    await service.from('recordings').update({
      drive_file_id: file.id, drive_link: file.webViewLink, status: 'ready',
    }).eq('id', row.id)
    await logActivity(row.lead_id, row.uploaded_by, 'recording', `🎙️ ${typeLabel(row.type)} recording uploaded to Drive`)
    await notify([...(await adminIds()), lead?.assigned_to].filter(Boolean), `🎙️ ${typeLabel(row.type)} recording ready`, `${leadName} — now viewable with its script`, row.lead_id)
  } catch (e) {
    console.error('drive transfer failed:', e)
    await service.from('recordings').update({ status: 'failed', error: String(e.message || e).slice(0, 400) }).eq('id', row.id)
  }
}

// ── Drive settings (admin) ────────────────────────────────────
route('GET', 'drive/settings', async ({ req }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  if (!isAdmin(s.profile)) return fail('Admin only', 403)
  const d = (await getSetting('drive')) || {}
  let email = null
  try { email = d.service_account_enc ? JSON.parse(decrypt(d.service_account_enc)).client_email : null } catch {}
  return json({ configured: !!d.service_account_enc && !!d.root_folder_id, service_account_email: email, root_folder_id: d.root_folder_id || '' })
})

route('PUT', 'drive/settings', async ({ req, body }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  if (!isAdmin(s.profile)) return fail('Admin only', 403)
  const cur = (await getSetting('drive')) || {}
  const next = { ...cur, root_folder_id: body.root_folder_id || null }
  if (body.service_account_json) {
    let creds
    try { creds = JSON.parse(body.service_account_json) } catch { return fail('That is not valid service-account JSON') }
    if (!creds.client_email || !creds.private_key) return fail('JSON is missing client_email or private_key')
    const { encrypt } = await import('./_lib.mjs')
    next.service_account_enc = encrypt(body.service_account_json)
  }
  await setSetting('drive', next)
  return json({ ok: true })
})

route('DELETE', 'recordings/:id', async ({ req, params }) => {
  const s = await getSession(req)
  if (!s) return unauthorized()
  if (!isAdmin(s.profile)) return fail('Admin only', 403)
  const { data: row } = await service.from('recordings').select('*').eq('id', params.id).single()
  if (row?.storage_path) await service.storage.from('recordings').remove([row.storage_path]).catch(() => {})
  if (row?.drive_file_id && row.drive_file_id.length > 10) {
    const drive = driveFor(await getSetting('drive')).catch(() => null)
    await drive?.deleteFile(row.drive_file_id).catch(() => {})
  }
  await service.from('recordings').delete().eq('id', params.id)
  return json({ ok: true })
})
