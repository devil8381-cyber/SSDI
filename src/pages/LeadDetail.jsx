import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, Mail, FilePlus2, Trash2, Save, Upload, Play, Copy, Download, Plus,
  CheckCircle2, Circle, FileText, Mic, Send, Clock, Zap, Activity, Loader2,
} from 'lucide-react'
import { api, uploadToSignedUrl } from '../api'
import { useAuth } from '../auth'
import { useToast, Modal, Spinner, Empty, DispositionBadge, fmtDateTime, ageFrom } from '../ui'
import { DISPOSITIONS, CRITERIA_REASONS, STATES, DOC_TYPES, SMTP_PURPOSES, TASK_TYPES } from '../config'

export default function LeadDetail() {
  const { id } = useParams()
  const { profile } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const admin = profile?.role === 'admin'

  const [data, setData] = useState(null)
  const [agents, setAgents] = useState([])
  const [form, setForm] = useState(null)
  const [showEmail, setShowEmail] = useState(false)
  const [showDocReq, setShowDocReq] = useState(false)
  const [viewer, setViewer] = useState(null) // recording row being viewed

  const load = useCallback(() => {
    api(`/leads/${id}`).then((d) => {
      setData(d)
      setForm({ ...d.lead })
    }).catch((e) => toast(e.message, 'error'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])
  useEffect(() => { load() }, [load])
  useEffect(() => { api('/users/agents').then((d) => setAgents(d.users || [])).catch(() => {}) }, [])

  // poll while a recording is uploading/processing so it flips to "ready"
  useEffect(() => {
    const pending = data?.recordings?.some((r) => r.status === 'uploading' || r.status === 'processing')
    if (!pending) return
    const t = setTimeout(load, 6000)
    return () => clearTimeout(t)
  }, [data, load])

  if (!data || !form) return <div className="flex justify-center py-20"><Spinner className="h-7 w-7" /></div>
  const { lead } = data
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const setDisposition = async (value, reason) => {
    try {
      await api(`/leads/${id}`, { method: 'PATCH', body: { disposition: value, disposition_reason: reason || null } })
      toast(`Disposition set to ${value}`)
      load()
    } catch (e) { toast(e.message, 'error') }
  }
  const saveInfo = async () => {
    const body = {}
    for (const k of ['first_name', 'last_name', 'email', 'phone', 'dob', 'state', 'city', 'disability', 'notes', 'worked_5_of_10', 'receiving_benefits', 'duration_12m', 'has_attorney']) {
      body[k] = form[k] === '' ? null : form[k]
    }
    body.next_followup_at = form.next_followup_at || null
    try {
      await api(`/leads/${id}`, { method: 'PATCH', body })
      toast('Lead saved')
      load()
    } catch (e) { toast(e.message, 'error') }
  }
  const reassign = async (agentId) => {
    try {
      await api(`/leads/${id}`, { method: 'PATCH', body: { assigned_to: agentId || null } })
      toast('Assignment updated')
      load()
    } catch (e) { toast(e.message, 'error') }
  }
  const del = async () => {
    if (!confirm('Delete this lead and all its data? This cannot be undone.')) return
    try { await api(`/leads/${id}`, { method: 'DELETE' }); toast('Lead deleted'); navigate('/leads') } catch (e) { toast(e.message, 'error') }
  }

  const upsertTask = async (title, due_at, type) => {
    try {
      await api('/tasks', { method: 'POST', body: { title, lead_id: id, due_at: due_at || null, type: type || 'callback', assigned_to: lead.assigned_to || profile.id } })
      toast('Task added')
      load()
    } catch (e) { toast(e.message, 'error') }
  }
  const completeTask = async (t, status) => {
    try { await api(`/tasks/${t.id}`, { method: 'PATCH', body: { status } }); load() } catch (e) { toast(e.message, 'error') }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button onClick={() => navigate('/leads')} className="mb-1 flex items-center gap-1 text-xs text-slate-400 hover:text-brand-600"><ArrowLeft size={13} /> Back to leads</button>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-bold text-slate-800">{lead.first_name} {lead.last_name}</h1>
            <DispositionBadge value={lead.disposition} />
            {lead.disposition_reason && <span className="text-xs text-slate-400">Reason: {lead.disposition_reason}</span>}
          </div>
          <p className="mt-0.5 text-sm text-slate-500">
            {lead.phone || 'no phone'} · {lead.email || 'no email'} · {ageFrom(lead.dob) ?? '?'} yrs · {lead.city || lead.state || '—'} · <span className="capitalize">{lead.source}</span>{lead.form_name ? ` · ${lead.form_name}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost" onClick={() => setShowEmail(true)}><Mail size={15} /> Send email</button>
          <button className="btn-ghost" onClick={() => setShowDocReq(true)}><FilePlus2 size={15} /> Request documents</button>
          {admin && <button className="btn-danger !px-2.5" onClick={del} title="Delete lead"><Trash2 size={15} /></button>}
        </div>
      </div>

      {/* disposition bar */}
      <div className="card flex flex-wrap items-center gap-3 p-4">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Disposition</span>
        <select className="input w-auto" value={lead.disposition} onChange={(e) => setDisposition(e.target.value, e.target.value === 'Criteria Not Met' ? lead.disposition_reason : null)}>
          {DISPOSITIONS.map((d) => <option key={d}>{d}</option>)}
        </select>
        {lead.disposition === 'Criteria Not Met' && (
          <>
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Reason</span>
            <select className="input w-auto" value={lead.disposition_reason || ''} onChange={(e) => setDisposition('Criteria Not Met', e.target.value)}>
              <option value="">Select reason…</option>
              {CRITERIA_REASONS.map((r) => <option key={r}>{r}</option>)}
            </select>
          </>
        )}
        {admin && (
          <>
            <span className="ml-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Agent</span>
            <select className="input w-auto" value={lead.assigned_to || ''} onChange={(e) => reassign(e.target.value)}>
              <option value="">Unassigned</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </>
        )}
        {lead.next_followup_at && <span className="ml-auto flex items-center gap-1.5 text-xs text-brand-700 bg-brand-50 rounded-lg px-2.5 py-1.5"><Clock size={13} /> Follow-up: {fmtDateTime(lead.next_followup_at)}</span>}
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        {/* left column */}
        <div className="space-y-5 xl:col-span-2">
          <InfoCard form={form} set={set} saveInfo={saveInfo} />

          <RecordingsCard recordings={data.recordings} onOpen={setViewer} onChange={load} leadId={id} />

          <DocumentsCard docs={data.documents} requests={data.docRequests} />

          <div className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <h2 className="text-sm font-semibold text-slate-700">Tasks</h2>
              <QuickTask onAdd={upsertTask} />
            </div>
            {data.tasks.length === 0 ? <Empty title="No tasks for this lead" /> : (
              <div className="divide-y divide-slate-100">
                {data.tasks.map((t) => (
                  <div key={t.id} className="flex items-center gap-3 px-5 py-2.5">
                    <button onClick={() => completeTask(t, t.status === 'open' ? 'done' : 'open')} className="text-slate-300 hover:text-emerald-500">
                      {t.status === 'open' ? <Circle size={17} /> : <CheckCircle2 size={17} className="text-emerald-500" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className={`truncate text-sm ${t.status === 'done' ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{t.title}</p>
                      <p className="text-[11px] text-slate-400">{t.type}{t.due_at ? ` · due ${fmtDateTime(t.due_at)}` : ''} · {t.profiles?.name || 'unassigned'}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* right column */}
        <div className="space-y-5">
          <EmailHistory emails={data.emails} />
          <Timeline activities={data.activities} />
          {data.metaEvents.length > 0 && (
            <div className="card p-5">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700"><Zap size={15} className="text-amber-500" /> Meta signals</h2>
              <div className="space-y-2">
                {data.metaEvents.map((m) => (
                  <div key={m.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                    <span className="text-slate-700">{m.event_name}</span>
                    <span className={`text-xs font-medium ${m.success ? 'text-emerald-600' : 'text-rose-500'}`}>{m.success ? 'sent ✓' : 'failed'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <EmailModal open={showEmail} onClose={() => setShowEmail(false)} lead={lead} onSent={load} />
      <DocRequestModal open={showDocReq} onClose={() => setShowDocReq(false)} lead={lead} onDone={load} />
      <RecordingViewer recording={viewer} onClose={() => { setViewer(null); load() }} />
    </div>
  )
}

// ── editable lead info ────────────────────────────────────────
function InfoCard({ form, set, saveInfo }) {
  const boolRow = (k, label) => (
    <label className="flex items-center gap-2.5 rounded-lg border border-slate-200 px-3 py-2.5 text-sm">
      <input type="checkbox" checked={!!form[k]} onChange={(e) => set(k)({ target: { value: e.target.checked } })} className="h-4 w-4 rounded border-slate-300" />
      <span className="text-slate-600">{label}</span>
    </label>
  )
  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">Lead details</h2>
        <button className="btn-primary" onClick={saveInfo}><Save size={14} /> Save</button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="label">First name</label><input className="input" value={form.first_name || ''} onChange={set('first_name')} /></div>
        <div><label className="label">Last name</label><input className="input" value={form.last_name || ''} onChange={set('last_name')} /></div>
        <div><label className="label">Phone</label><input className="input" value={form.phone || ''} onChange={set('phone')} /></div>
        <div><label className="label">Email</label><input className="input" value={form.email || ''} onChange={set('email')} /></div>
        <div><label className="label">Date of birth</label><input className="input" type="date" value={form.dob || ''} onChange={set('dob')} /></div>
        <div><label className="label">State</label>
          <select className="input" value={form.state || ''} onChange={set('state')}><option value="">—</option>{STATES.map((s) => <option key={s}>{s}</option>)}</select>
        </div>
        <div><label className="label">City</label><input className="input" value={form.city || ''} onChange={set('city')} /></div>
        <div><label className="label">Next follow-up</label>
          <input className="input" type="datetime-local" value={form.next_followup_at ? form.next_followup_at.slice(0, 16) : ''} onChange={set('next_followup_at')} />
        </div>
        <div className="col-span-2"><label className="label">Disability</label><textarea className="input" rows={2} value={form.disability || ''} onChange={set('disability')} /></div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {boolRow('worked_5_of_10', 'Worked 5 of last 10 years')}
        {boolRow('receiving_benefits', 'Currently receiving SSI/SSDI')}
        {boolRow('duration_12m', 'Condition lasts 12+ months')}
        {boolRow('has_attorney', 'Has an attorney')}
      </div>
      <div className="mt-3">
        <label className="label">Notes</label>
        <textarea className="input" rows={3} value={form.notes || ''} onChange={set('notes')} placeholder="Call notes, important details…" />
      </div>
    </div>
  )
}

// ── recordings + script viewer ────────────────────────────────
function RecordingsCard({ recordings, onOpen, onChange, leadId }) {
  const toast = useToast()
  const fileRef = useRef(null)
  const [uploadingType, setUploadingType] = useState(null)

  const upload = async (type) => {
    const input = fileRef.current
    input.value = ''
    input.dataset.type = type
    input.click()
  }
  const onFile = async (e) => {
    const file = e.target.files?.[0]
    const type = e.target.dataset.type
    if (!file || !type) return
    setUploadingType(type)
    try {
      const { recording, signed_url } = await api(`/leads/${leadId}/recordings`, { method: 'POST', body: { type, file_name: file.name } })
      await uploadToSignedUrl(signed_url, file)
      await api('/recordings/confirm', { method: 'POST', body: { recording_id: recording.id } })
      toast(`${type === 'frontend' ? 'Front-end' : 'Verification'} recording uploading — moving to Google Drive…`)
      onChange()
    } catch (err) { toast(err.message, 'error') } finally { setUploadingType(null) }
  }

  const Row = ({ type }) => {
    const rec = recordings.find((r) => r.type === type)
    const label = type === 'frontend' ? 'Front-end recording' : 'Verification recording'
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3">
        <Mic size={17} className={rec ? 'text-brand-600' : 'text-slate-300'} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-700">{label}</p>
          <p className="text-xs text-slate-400">
            {!rec ? 'Not uploaded yet' : rec.status === 'ready' ? rec.file_name : rec.status === 'failed' ? `Failed: ${rec.error || 'unknown'}` : `${rec.status}…`}
          </p>
        </div>
        {!rec || rec.status === 'failed' ? (
          <button className="btn-ghost" onClick={() => upload(type)} disabled={!!uploadingType}>
            {uploadingType === type ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Upload
          </button>
        ) : rec.status === 'ready' ? (
          <button className="btn-primary" onClick={() => onOpen(rec)}><Play size={14} /> Open + script</button>
        ) : (
          <span className="flex items-center gap-1.5 text-xs text-amber-600"><Loader2 size={13} className="animate-spin" /> {rec.status}…</span>
        )}
      </div>
    )
  }
  return (
    <div className="card p-5">
      <input ref={fileRef} type="file" accept="audio/*,video/*" className="hidden" onChange={onFile} />
      <h2 className="mb-3 text-sm font-semibold text-slate-700">Call recordings (auto-saved to Google Drive)</h2>
      <div className="space-y-2">
        <Row type="frontend" />
        <Row type="verification" />
      </div>
      <p className="mt-3 text-xs text-slate-400">Opening a recording shows it next to the matching script from your Scripts library.</p>
    </div>
  )
}

function RecordingViewer({ recording, onClose }) {
  const [script, setScript] = useState(null)
  useEffect(() => {
    if (!recording) return
    api(`/scripts?type=${recording.type}`)
      .then((d) => setScript((d.scripts || [])[0] || null))
      .catch(() => setScript(null))
  }, [recording])
  if (!recording) return null
  const title = recording.type === 'frontend' ? 'Front-End Recording' : 'Verification Recording'
  return (
    <Modal open onClose={onClose} title={title} wide>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <p className="label">Recording (Google Drive)</p>
          {recording.drive_link ? (
            <iframe
              title="recording"
              src={`https://drive.google.com/file/d/${recording.drive_file_id}/preview`}
              className="aspect-video w-full rounded-lg border border-slate-200"
              allow="autoplay"
            />
          ) : (
            <div className="rounded-lg bg-slate-50 p-6 text-center text-sm text-slate-400">
              {recording.status === 'ready' ? <a className="text-brand-600 underline" href={recording.drive_link} target="_blank" rel="noreferrer">Open in Drive</a> : 'Processing…'}
            </div>
          )}
          <a className="btn-ghost mt-3 w-full" href={recording.drive_link} target="_blank" rel="noreferrer">Open in Google Drive ↗</a>
        </div>
        <div>
          <p className="label">{script ? script.title : 'Script'}</p>
          <pre className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-900 p-4 text-[13px] leading-relaxed text-slate-100">
            {script ? script.content : 'No script set for this type yet — add one under Scripts.'}
          </pre>
        </div>
      </div>
    </Modal>
  )
}

// ── documents ─────────────────────────────────────────────────
function DocumentsCard({ docs, requests }) {
  const toast = useToast()
  const download = async (d) => {
    try { const { url } = await api(`/documents/${d.id}/url`); window.open(url, '_blank') } catch (e) { toast(e.message, 'error') }
  }
  const copyLink = (r) => {
    navigator.clipboard.writeText(`${window.location.origin}/upload/${r.token}`)
    toast('Secure link copied — send it to the claimant')
  }
  return (
    <div className="card p-5">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">Documents</h2>
      {requests.length > 0 && (
        <div className="mb-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Secure upload requests</p>
          {requests.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-2.5 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2.5">
              <FileText size={15} className="text-brand-500" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-slate-700">{(r.doc_types || []).join(', ') || 'Any documents'}</p>
                <p className="text-[11px] text-slate-400">
                  {r.status === 'uploaded' ? '✅ Uploaded' : `Pending — expires ${fmtDateTime(r.expires_at)}`}
                </p>
              </div>
              <button className="btn-ghost !px-2.5 !py-1.5 text-xs" onClick={() => copyLink(r)}><Copy size={13} /> Copy link</button>
            </div>
          ))}
        </div>
      )}
      {docs.length === 0 ? (
        <p className="py-2 text-center text-sm text-slate-400">No documents uploaded yet</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {docs.map((d) => (
            <div key={d.id} className="flex items-center gap-3 py-2.5">
              <FileText size={16} className="text-slate-400" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-slate-700">{d.doc_type} — {d.file_name}</p>
                <p className="text-[11px] text-slate-400">{fmtDateTime(d.uploaded_at)}{d.size_bytes ? ` · ${(d.size_bytes / 1024 / 1024).toFixed(1)} MB` : ''}</p>
              </div>
              <button className="btn-ghost !px-2.5 !py-1.5 text-xs" onClick={() => download(d)}><Download size={13} /> View</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── timeline ──────────────────────────────────────────────────
const ACT_ICON = { email_sent: Send, email_opened: Mail, doc_requested: FileText, doc_uploaded: FileText, recording: Mic, disposition: Activity, created: Zap, assigned: Activity, task: CheckCircle2 }
function Timeline({ activities }) {
  return (
    <div className="card p-5">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700"><Activity size={15} className="text-brand-600" /> Activity</h2>
      {activities.length === 0 ? <Empty title="No activity yet" /> : (
        <div className="relative space-y-4 border-l border-slate-200 pl-5">
          {activities.map((a) => {
            const Icon = ACT_ICON[a.type] || Activity
            return (
              <div key={a.id} className="relative">
                <div className="absolute -left-[26.5px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-brand-100 text-brand-600">
                  <Icon size={10} />
                </div>
                <p className="text-sm text-slate-700">{a.title}</p>
                <p className="text-[11px] text-slate-400">{a.profiles?.name || 'System'} · {fmtDateTime(a.created_at)}</p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── email history ─────────────────────────────────────────────
function EmailHistory({ emails }) {
  return (
    <div className="card p-5">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700"><Mail size={15} className="text-brand-600" /> Email history</h2>
      {emails.length === 0 ? <Empty title="No emails sent yet" /> : (
        <div className="space-y-2">
          {emails.map((m) => (
            <div key={m.id} className="rounded-lg border border-slate-100 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-medium text-slate-700">{m.subject}</p>
                <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${m.opens > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  {m.opens > 0 ? `👁 ${m.opens} open${m.opens > 1 ? 's' : ''}` : 'unopened'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">{m.profiles?.name || '—'} · {fmtDateTime(m.created_at)}{m.last_opened_at ? ` · last open ${fmtDateTime(m.last_opened_at)}` : ''}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── modals ────────────────────────────────────────────────────
function EmailModal({ open, onClose, lead, onSent }) {
  const toast = useToast()
  const [templates, setTemplates] = useState([])
  const [purpose, setPurpose] = useState('followups')
  const [templateId, setTemplateId] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) api('/templates?type=email').then((d) => setTemplates(d.templates || [])).catch(() => {})
  }, [open])

  const applyTemplate = (tid) => {
    setTemplateId(tid)
    const t = templates.find((x) => x.id === tid)
    if (t) { setSubject(t.subject || ''); setBody(t.body || '') }
  }
  const send = async () => {
    setBusy(true)
    try {
      await api(`/leads/${lead.id}/email`, { method: 'POST', body: { subject, body, purpose } })
      toast('Email sent 📬 (opens are tracked automatically)')
      onSent(); onClose()
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title={`Email ${lead.first_name} (${lead.email || 'no email'})`} wide>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Use template</label>
            <select className="input" value={templateId} onChange={(e) => applyTemplate(e.target.value)}>
              <option value="">— blank —</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Send via SMTP for</label>
            <select className="input" value={purpose} onChange={(e) => setPurpose(e.target.value)}>
              {SMTP_PURPOSES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
        </div>
        <div><label className="label">Subject</label><input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
        <div>
          <label className="label">Body (HTML, supports {'{{first_name}}'} variables)</label>
          <textarea className="input font-mono text-xs" rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={send} disabled={busy || !subject || !body}><Send size={14} /> {busy ? 'Sending…' : 'Send & track'}</button>
        </div>
      </div>
    </Modal>
  )
}

function DocRequestModal({ open, onClose, lead, onDone }) {
  const toast = useToast()
  const [types, setTypes] = useState(['Government photo ID'])
  const [message, setMessage] = useState('')
  const [days, setDays] = useState(7)
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState('')

  const toggle = (t) => setTypes((ts) => (ts.includes(t) ? ts.filter((x) => x !== t) : [...ts, t]))
  const create = async () => {
    setBusy(true)
    try {
      const d = await api(`/leads/${lead.id}/doc-request`, { method: 'POST', body: { doc_types: types, message, expires_days: days } })
      setLink(d.url)
      onDone()
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title="Request documents (secure link)">
      {link ? (
        <div className="space-y-4">
          <div className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-700">Secure link created! Send it to {lead.first_name} by email or text.</div>
          <div className="break-all rounded-lg bg-slate-900 p-3 font-mono text-xs text-emerald-300">{link}</div>
          <button className="btn-primary w-full" onClick={() => { navigator.clipboard.writeText(link); toast('Link copied to clipboard') }}><Copy size={14} /> Copy secure link</button>
          <button className="btn-ghost w-full" onClick={() => { onClose(); setLink('') }}>Done</button>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="label">Documents needed</label>
            <div className="grid grid-cols-2 gap-1.5">
              {DOC_TYPES.map((t) => (
                <label key={t} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-sm ${types.includes(t) ? 'border-brand-400 bg-brand-50 text-brand-800' : 'border-slate-200 text-slate-600'}`}>
                  <input type="checkbox" checked={types.includes(t)} onChange={() => toggle(t)} className="h-4 w-4 rounded border-slate-300" />
                  {t}
                </label>
              ))}
            </div>
          </div>
          <div><label className="label">Message to claimant (optional)</label><textarea className="input" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Please upload these so we can move your claim forward…" /></div>
          <div><label className="label">Link expires in (days)</label><input className="input w-28" type="number" min="1" max="60" value={days} onChange={(e) => setDays(e.target.value)} /></div>
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={create} disabled={busy || !types.length}>{busy ? 'Creating…' : 'Create secure link'}</button>
          </div>
        </div>
      )}
    </Modal>
  )
}

function QuickTask({ onAdd }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [type, setType] = useState('callback')
  const submit = () => {
    if (!title.trim()) return
    onAdd(title.trim(), due ? new Date(due).toISOString() : null, type)
    setTitle(''); setDue(''); setOpen(false)
  }
  return (
    <div className="relative">
      <button className="btn-ghost !py-1.5 text-xs" onClick={() => setOpen((o) => !o)}><Plus size={13} /> Add task</button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-72 space-y-2 rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
          <input className="input" autoFocus placeholder="Task title…" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
          <div className="flex gap-2">
            <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
              {TASK_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <input className="input" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
          <button className="btn-primary w-full !py-1.5 text-xs" onClick={submit}>Add task</button>
        </div>
      )}
    </div>
  )
}
