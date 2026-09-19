import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, ArrowRight, Mail, FilePlus2, Trash2, Save, Upload, Play, Copy, Download, Plus,
  CheckCircle2, Circle, FileText, Mic, Send, Clock, Zap, Activity, Loader2, Phone, MessageSquare, NotebookPen,
} from 'lucide-react'
import { api, describeError } from '../api'
import { useAuth } from '../auth'
import { useAction, useDirtyGuard } from '../lib/hooks'
import { validateForm, emailRule, phoneRule, maxLen, sanitizeText } from '../lib/validate'
import { renderTemplate } from '../lib/render'
import { getCallHref } from '../lib/call'
import { useToast, Modal, Spinner, Empty, PageError, DispositionBadge, fmtDateTime, ageFrom } from '../ui'
import { DISPOSITIONS, CRITERIA_REASONS, STATES, DOC_TYPES, SMTP_PURPOSES, TASK_TYPES, INTAKE_SECTIONS } from '../config'

// Only these fields are user-editable in the info form. Dirty detection compares
// exactly this list so server-side metadata (updated_at, disposition changes by
// teammates…) never falsely marks the form dirty.
const EDIT_KEYS = [
  'first_name', 'last_name', 'email', 'phone', 'dob', 'state', 'city',
  'address', 'zip',
  'worked_5_of_10', 'receiving_benefits', 'duration_12m', 'has_attorney',
  'disability', 'notes', 'next_followup_at',
]
const snapshot = (lead) => JSON.stringify(EDIT_KEYS.map((k) => lead?.[k] ?? null))

// datetime-local inputs speak local wall-clock; the API speaks UTC ISO.
// Convert on the way out (and render local on the way in) or follow-ups drift
// by the UTC offset.
const toLocalInputValue = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d)) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const toUtcIso = (localValue) => {
  if (!localValue) return null
  const d = new Date(localValue)
  return isNaN(d) ? null : d.toISOString()
}

export default function LeadDetail() {
  const { id } = useParams()
  const { profile } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const admin = profile?.role === 'admin'

  const [data, setData] = useState(null)
  const [form, setForm] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [agents, setAgents] = useState([])
  const [showEmail, setShowEmail] = useState(false)
  const [emailPrefill, setEmailPrefill] = useState(null)
  const [showDocReq, setShowDocReq] = useState(false)
  const [viewer, setViewer] = useState(null)

  // ── data loading that never clobbers in-progress edits ────────────────
  // Background refreshes (recording poll, post-action reloads) merge into
  // `data` immediately, but `form` is only resynced while the agent hasn't
  // typed anything (previously a 6s poll could wipe half-typed notes).
  const formDirtyRef = useRef(false)
  const load = useCallback(async () => {
    try {
      const d = await api(`/leads/${id}`)
      if (!d?.lead) throw new Error('Lead not found — it may have been deleted.')
      setData(d)
      if (!formDirtyRef.current) setForm({ ...d.lead })
      setLoadError(null)
    } catch (e) {
      setLoadError(describeError(e))
    }
  }, [id])

  useEffect(() => {
    // new lead id → clear stale state so nothing from the previous lead flashes
    setData(null); setForm(null); setLoadError(null); setNeighbors(null)
  }, [id])
  useEffect(() => { load() }, [load])
  useEffect(() => { api('/users/agents').then((d) => setAgents(d.users || [])).catch(() => {}) }, [])

  // ── next / previous lead in the agent's queue (power-workflow) ──
  const [neighbors, setNeighbors] = useState(null)
  useEffect(() => {
    api(`/leads/${id}/neighbors`).then(setNeighbors).catch(() => {})
  }, [id, data])

  // Keep the ref in sync with computed dirty state
  const dirty = useMemo(
    () => !!(form && data?.lead && snapshot(form) !== snapshot(data.lead)),
    [form, data]
  )
  useEffect(() => { formDirtyRef.current = dirty }, [dirty])

  // Warn before refresh/close and before in-app navigation with unsaved edits
  useDirtyGuard(dirty)

  // ── request docs → auto-compose the doc-request email with the link ──
  const openEmailWithDocLink = useCallback((link) => {
    const lead = data?.lead
    if (!lead) return
    const vars = {
      first_name: lead.first_name || '', last_name: lead?.last_name || '', email: lead?.email || '',
      phone: lead?.phone || '', state: lead?.state || '', city: lead?.city || '',
      age: ageFrom(lead?.dob) ?? '', agent_name: profile?.name || '', doc_link: link,
    }
    api('/templates?type=email').then((d) => {
      const tpl = (d.templates || []).find((t) => (t.body || '').includes('{{doc_link}}')) || (d.templates || [])[0]
      setEmailPrefill(tpl
        ? { subject: renderTemplate(tpl.subject || '', vars), body: renderTemplate(tpl.body || '', vars), docLink: link }
        : { subject: 'Documents needed for your claim', body: `<p>Hi ${vars.first_name}, please upload your documents here: ${link}</p>`, docLink: link })
      setShowEmail(true)
    }).catch(() => {
      setEmailPrefill({ subject: 'Documents needed for your claim', body: `<p>Hi ${vars.first_name}, please upload your documents here: ${link}</p>`, docLink: link })
      setShowEmail(true)
    })
  }, [data, profile])

  // While any recording is uploading/processing, poll until it lands in Drive
  const pendingRecording = data?.recordings?.some((r) => r.status === 'uploading' || r.status === 'processing')
  useEffect(() => {
    if (!pendingRecording) return
    const t = setTimeout(load, 6000)
    return () => clearTimeout(t)
  }, [pendingRecording, load])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  // ── actions (all busy-guarded; failures toast with recovery hints) ────

  // Optimistic disposition: the badge flips instantly, rolls back to server
  // truth if the PATCH fails. This is the agent's #1 most-repeated action.
  const { run: applyDisposition, busy: dispositionBusy } = useAction(async (value, reason) => {
    const prev = data.lead
    setData((d) => ({
      ...d,
      lead: { ...d.lead, disposition: value, disposition_reason: value === 'Criteria Not Met' ? (reason ?? d.lead.disposition_reason) : null },
    }))
    try {
      await api(`/leads/${id}`, { method: 'PATCH', body: { disposition: value, disposition_reason: value === 'Criteria Not Met' ? (reason ?? null) : null } })
    } catch (e) {
      setData((d) => ({ ...d, lead: prev })) // rollback to what the server had
      throw e
    }
  }, { toast, onDone: load })

  const { run: saveInfo, busy: saving } = useAction(async () => {
    const errs = validateForm(form, {
      first_name: [maxLen(100)],
      email: [emailRule()],
      phone: [phoneRule()],
      city: [maxLen(120)],
      notes: [maxLen(5000)],
      disability: [maxLen(2000)],
    })
    if (Object.keys(errs).length) throw new Error(Object.values(errs)[0])
    const body = {}
    for (const k of EDIT_KEYS) {
      if (k === 'next_followup_at') body[k] = toUtcIso(form[k])
      else if (typeof form[k] === 'string') body[k] = sanitizeText(form[k], k === 'notes' ? 5000 : k === 'disability' ? 2000 : 200)
      else body[k] = form[k] === '' ? null : form[k]
    }
    await api(`/leads/${id}`, { method: 'PATCH', body })
  }, { toast, successMsg: 'Lead saved', onDone: load })

  const { run: reassign, busy: reassigning } = useAction(async (agentId) => {
    const prev = data.lead.assigned_to
    setData((d) => ({ ...d, lead: { ...d.lead, assigned_to: agentId || null } })) // optimistic
    try {
      await api(`/leads/${id}`, { method: 'PATCH', body: { assigned_to: agentId || null } })
    } catch (e) {
      setData((d) => ({ ...d, lead: { ...d.lead, assigned_to: prev } }))
      throw e
    }
  }, { toast, onDone: load })

  const { run: del, busy: deleting } = useAction(async () => {
    if (!confirm('Delete this lead and all its data? This cannot be undone.')) return
    await api(`/leads/${id}`, { method: 'DELETE' })
    navigate('/leads')
  }, { toast, successMsg: 'Lead deleted' })

  const { run: addTask, busy: addingTask } = useAction(async (title, due_at, type) => {
    await api('/tasks', {
      method: 'POST',
      body: { title, lead_id: id, due_at: toUtcIso(due_at), type: type || 'callback', assigned_to: data.lead.assigned_to || profile.id },
    })
  }, { toast, successMsg: 'Task added', onDone: load })

  const { run: completeTask, busy: completingTask } = useAction(async (t) => {
    await api(`/tasks/${t.id}`, { method: 'PATCH', body: { status: t.status === 'open' ? 'done' : 'open' } })
  }, { toast, onDone: load })

  // ── speed tools: call logging, quick note, text-template copy ──
  const { run: logCall } = useAction(async () => {
    await api(`/leads/${id}/call`, { method: 'POST' })
  }, { toast, successMsg: 'Call logged in the timeline' })

  const [noteText, setNoteText] = useState('')
  const { run: addNote, busy: noting } = useAction(async () => {
    const text = sanitizeText(noteText, 1000)
    if (!text) return
    await api(`/leads/${id}/note`, { method: 'POST', body: { text } })
    setNoteText('')
  }, { toast, successMsg: 'Note added', onDone: load })

  const [textTemplates, setTextTemplates] = useState([])
  useEffect(() => { api('/templates?type=text').then((d) => setTextTemplates(d.templates || [])).catch(() => {}) }, [id])
  const { run: copyTextTemplate } = useAction(async (tid) => {
    const t = textTemplates.find((x) => x.id === tid)
    if (!t) return
    const vars = {
      first_name: lead?.first_name || '', last_name: lead?.last_name || '', email: lead?.email || '',
      phone: lead?.phone || '', state: lead?.state || '', city: lead?.city || '',
      agent_name: profile?.name || '', doc_link: '', age: ageFrom(lead?.dob) ?? '',
    }
    const text = renderTemplate(t.body, vars)
    await navigator.clipboard.writeText(text)
    return t.name
  }, { toast, successMsg: (name) => `“${name}” copied — paste it into your SMS app` })

  if (loadError) {
    return (
      <div className="mx-auto max-w-3xl pt-10">
        <button onClick={() => navigate('/leads')} className="mb-4 flex items-center gap-1 text-xs text-slate-400 hover:text-brand-400"><ArrowLeft size={13} /> Back to leads</button>
        <PageError message={loadError} onRetry={load} />
      </div>
    )
  }
  if (!data || !form) return <div className="flex justify-center py-20"><Spinner className="h-7 w-7" /></div>
  const { lead } = data

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <button onClick={() => navigate('/leads')} className="flex items-center gap-1 text-xs text-slate-400 hover:text-brand-400"><ArrowLeft size={13} /> Back to leads</button>
            {neighbors && neighbors.total > 0 && (
              <span className="flex items-center gap-1 text-xs text-slate-400">
                <button
                  disabled={!neighbors.prev}
                  onClick={() => neighbors.prev && navigate(`/leads/${neighbors.prev}`)}
                  className="rounded p-1 hover:bg-slate-800 hover:text-brand-400 disabled:opacity-30" title="Previous lead (newest → oldest)"
                ><ArrowRight size={12} className="rotate-180" /></button>
                <span className="tabular-nums">{neighbors.position} / {neighbors.total}</span>
                <button
                  disabled={!neighbors.next}
                  onClick={() => neighbors.next && navigate(`/leads/${neighbors.next}`)}
                  className="rounded p-1 hover:bg-slate-800 hover:text-brand-400 disabled:opacity-30" title="Next lead"
                ><ArrowRight size={12} /></button>
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-bold text-slate-100">{lead.first_name} {lead.last_name}</h1>
            <DispositionBadge value={lead.disposition} />
            {lead.disposition_reason ? <span className="text-xs text-slate-400">Reason: {lead.disposition_reason}</span> : null}
          </div>
          <p className="mt-0.5 text-sm text-slate-400">
            {lead.phone || 'no phone'} · {lead.email || 'no email'} · {ageFrom(lead.dob) ?? '?'} yrs · {lead.city || lead.state || '—'} · <span className="capitalize">{lead.source}</span>{lead.form_name ? ` · ${lead.form_name}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {lead.phone && (
            <a
              href={getCallHref(lead.phone) || '#'}
              onClick={() => logCall()}
              className="btn-ghost !border-emerald-500/30 !text-emerald-300 hover:!bg-emerald-500/10"
              title="Opens your dialer / softphone and logs the call in the timeline"
            ><Phone size={15} /> Call</a>
          )}
          <button className="btn-ghost" onClick={() => setShowEmail(true)} disabled={!lead.email} title={lead.email ? '' : 'This lead has no email address'}>
            <Mail size={15} /> Send email
          </button>
          <button className="btn-ghost" onClick={() => setShowDocReq(true)}><FilePlus2 size={15} /> Request documents</button>
          {admin && <button className="btn-danger !px-2.5" onClick={del} disabled={deleting} title="Delete lead"><Loader2 size={15} className={deleting ? 'animate-spin' : 'hidden'} /><Trash2 size={15} className={deleting ? 'hidden' : ''} /></button>}
        </div>
      </div>

      {/* dirty indicator — the agent always knows when there are unsaved edits */}
      {dirty && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-200">
          <span>✏️ You have unsaved changes to this lead.</span>
          <button className="btn-primary !py-1.5" onClick={saveInfo} disabled={saving}>{saving ? 'Saving…' : 'Save now'}</button>
        </div>
      )}

      {/* disposition bar */}
      <div className="card flex flex-wrap items-center gap-3 p-4">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Disposition</span>
        <select
          className="input w-auto"
          value={lead.disposition}
          disabled={dispositionBusy}
          onChange={(e) => applyDisposition(e.target.value, e.target.value === 'Criteria Not Met' ? lead.disposition_reason : null)}
        >
          {DISPOSITIONS.map((d) => <option key={d}>{d}</option>)}
        </select>
        {lead.disposition === 'Criteria Not Met' && (
          <>
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Reason</span>
            <select
              className="input w-auto"
              value={lead.disposition_reason || ''}
              disabled={dispositionBusy}
              onChange={(e) => applyDisposition('Criteria Not Met', e.target.value)}
            >
              <option value="">Select reason…</option>
              {CRITERIA_REASONS.map((r) => <option key={r}>{r}</option>)}
            </select>
          </>
        )}
        {admin && (
          <>
            <span className="ml-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Agent</span>
            <select className="input w-auto" value={lead.assigned_to || ''} disabled={reassigning} onChange={(e) => reassign(e.target.value)}>
              <option value="">Unassigned</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </>
        )}
        {lead.next_followup_at && (
          <span className="ml-auto flex items-center gap-1.5 rounded-lg bg-brand-500/10 px-2.5 py-1.5 text-xs text-brand-300"><Clock size={13} /> Follow-up: {fmtDateTime(lead.next_followup_at)}</span>
        )}
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        {/* left column */}
        <div className="space-y-5 xl:col-span-2">
          <InfoCard form={form} set={set} saveInfo={saveInfo} saving={saving} />

          <IntakeCard key={lead.id} lead={lead} onSaved={load} />

          <RecordingsCard recordings={data.recordings} onOpen={setViewer} onChange={load} leadId={id} />

          <DocumentsCard docs={data.documents} requests={data.docRequests} />

          <div className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
              <h2 className="text-sm font-semibold text-slate-200">Tasks</h2>
              <QuickTask onAdd={addTask} busy={addingTask} />
            </div>
            {data.tasks.length === 0 ? <Empty title="No tasks for this lead" /> : (
              <div className="divide-y divide-slate-800">
                {data.tasks.map((t) => (
                  <div key={t.id} className="flex items-center gap-3 px-5 py-2.5">
                    <button onClick={() => completeTask(t)} disabled={completingTask} className="text-slate-300 hover:text-emerald-500 disabled:opacity-40">
                      {t.status === 'open' ? <Circle size={17} /> : <CheckCircle2 size={17} className="text-emerald-500" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className={`truncate text-sm ${t.status === 'done' ? 'text-slate-400 line-through' : 'text-slate-200'}`}>{t.title}</p>
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
          {/* quick note + text templates — the agent's fastest actions */}
          <div className="card p-4">
            <div className="flex gap-2">
              <input
                className="input"
                placeholder="Quick note… (Enter to save)"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addNote()}
              />
              <button className="btn-primary !px-2.5" onClick={addNote} disabled={noting || !noteText.trim()} title="Add to timeline">
                {noting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              </button>
            </div>
            {textTemplates.length > 0 && (
              <select
                className="input mt-2"
                value=""
                onChange={(e) => { if (e.target.value) { copyTextTemplate(e.target.value); e.target.value = '' } }}
                title="Copies the template with this lead's details filled in — paste into your SMS app"
              >
                <option value="">💬 Copy a text template for this lead…</option>
                {textTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
          </div>
          <EmailHistory emails={data.emails} />
          <Timeline activities={data.activities} />
          {data.metaEvents.length > 0 && (
            <div className="card p-5">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200"><Zap size={15} className="text-amber-500" /> Meta signals</h2>
              <div className="space-y-2">
                {data.metaEvents.map((m) => (
                  <div key={m.id} className="flex items-center justify-between rounded-lg bg-slate-800/70 px-3 py-2 text-sm">
                    <span className="text-slate-200">{m.event_name}</span>
                    <span className={`text-xs font-medium ${m.success ? 'text-emerald-400' : 'text-rose-500'}`}>{m.success ? 'sent ✓' : 'failed'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <EmailModal open={showEmail} onClose={() => { setShowEmail(false); setEmailPrefill(null) }} lead={lead} onSent={load} prefill={emailPrefill} />
      <DocRequestModal open={showDocReq} onClose={() => setShowDocReq(false)} lead={lead} onDone={load} onCreated={openEmailWithDocLink} />
      <RecordingViewer recording={viewer} onClose={() => { setViewer(null); load() }} />
    </div>
  )
}

// ── editable lead info ────────────────────────────────────────
function InfoCard({ form, set, saveInfo, saving }) {
  const boolRow = (k, label) => (
    <label className="flex items-center gap-2.5 rounded-lg border border-slate-700 px-3 py-2.5 text-sm">
      <input
        type="checkbox"
        checked={!!form[k]}
        onChange={(e) => set(k)({ target: { value: e.target.checked } })}
        className="h-4 w-4 rounded border-slate-600"
      />
      <span className="text-slate-300">{label}</span>
    </label>
  )
  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200">Lead details</h2>
        <button className="btn-primary" onClick={saveInfo} disabled={saving}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {saving ? 'Saving…' : 'Save'}
        </button>
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
        <div className="col-span-2"><label className="label">Address (street, apt)</label><input className="input" value={form.address || ''} onChange={set('address')} placeholder="123 Main St, Apt 4" /></div>
        <div><label className="label">ZIP</label><input className="input" value={form.zip || ''} onChange={set('zip')} /></div>
        <div><label className="label">Next follow-up</label>
          <input className="input" type="datetime-local" value={toLocalInputValue(form.next_followup_at)} onChange={(e) => set('next_followup_at')({ target: { value: e.target.value } })} />
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

  const upload = (type) => {
    const input = fileRef.current
    input.value = ''
    input.dataset.type = type
    input.click()
  }
  const onFile = async (e) => {
    const file = e.target.files?.[0]
    const type = e.target.dataset.type
    if (!file || !type || uploadingType) return
    if (file.size > 200 * 1024 * 1024) { toast('Recordings must be under 200 MB.', 'error'); return }
    setUploadingType(type)
    try {
      const { recording, signed_url } = await api(`/leads/${leadId}/recordings`, { method: 'POST', body: { type, file_name: file.name } })
      await uploadToSignedUrlSafe(signed_url, file)
      await api('/recordings/confirm', { method: 'POST', body: { recording_id: recording.id } })
      toast('Recording uploaded — moving to Google Drive…')
      onChange()
    } catch (err) {
      toast(describeError(err), 'error')
    } finally {
      setUploadingType(null)
    }
  }

  const Row = ({ type }) => {
    const rec = recordings.find((r) => r.type === type)
    const label = type === 'frontend' ? 'Front-end recording' : 'Verification recording'
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-800/70/60 px-4 py-3">
        <Mic size={17} className={rec ? 'text-brand-400' : 'text-slate-300'} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-200">{label}</p>
          <p className="text-xs text-slate-400">
            {!rec ? 'Not uploaded yet'
              : rec.status === 'ready' ? rec.file_name
              : rec.status === 'failed' ? `Failed: ${rec.error || 'unknown error — try again'}`
              : `${rec.status}…`}
          </p>
        </div>
        {!rec || rec.status === 'failed' ? (
          <button className="btn-ghost" onClick={() => upload(type)} disabled={!!uploadingType}>
            {uploadingType === type ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Upload
          </button>
        ) : rec.status === 'ready' ? (
          <button className="btn-primary" onClick={() => onOpen(rec)}><Play size={14} /> Open + script</button>
        ) : (
          <span className="flex items-center gap-1.5 text-xs text-amber-400"><Loader2 size={13} className="animate-spin" /> {rec.status}…</span>
        )}
      </div>
    )
  }
  return (
    <div className="card p-5">
      <input ref={fileRef} type="file" accept="audio/*,video/*" className="hidden" onChange={onFile} />
      <h2 className="mb-3 text-sm font-semibold text-slate-200">Call recordings (auto-saved to Google Drive)</h2>
      <div className="space-y-2">
        <Row type="frontend" />
        <Row type="verification" />
      </div>
      <p className="mt-3 text-xs text-slate-400">Opening a recording shows it next to the matching script from your Scripts library.</p>
    </div>
  )
}

// tiny wrapper keeping the upload import local & explicit
async function uploadToSignedUrlSafe(signedUrl, file) {
  const mod = await import('../api')
  return mod.uploadToSignedUrl(signedUrl, file)
}

function RecordingViewer({ recording, onClose }) {
  const [script, setScript] = useState(null)
  const [scriptError, setScriptError] = useState(null)
  useEffect(() => {
    if (!recording) return
    setScript(null)
    setScriptError(null)
    api(`/scripts?type=${recording.type}`)
      .then((d) => setScript((d.scripts || [])[0] || null))
      .catch((e) => setScriptError(describeError(e)))
  }, [recording])
  if (!recording) return null
  const title = recording.type === 'frontend' ? 'Front-End Recording' : 'Verification Recording'
  return (
    <Modal open onClose={onClose} title={title} wide>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <p className="label">Recording (Google Drive)</p>
          {recording.drive_link && recording.drive_file_id ? (
            <iframe
              title="recording"
              src={`https://drive.google.com/file/d/${recording.drive_file_id}/preview`}
              className="aspect-video w-full rounded-lg border border-slate-700"
              allow="autoplay"
            />
          ) : (
            <div className="rounded-lg bg-slate-800/70 p-6 text-center text-sm text-slate-400">
              {recording.status === 'ready'
                ? <a className="text-brand-400 underline" href={recording.drive_link} target="_blank" rel="noreferrer">Open in Drive</a>
                : 'Processing — this panel is live once the upload lands in Drive.'}
            </div>
          )}
          {recording.drive_link && <a className="btn-ghost mt-3 w-full" href={recording.drive_link} target="_blank" rel="noreferrer">Open in Google Drive ↗</a>}
        </div>
        <div>
          <p className="label">{script ? script.title : 'Script'}</p>
          <pre className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-900 p-4 text-[13px] leading-relaxed text-slate-100">
            {scriptError ? scriptError : script ? script.content : 'No script set for this type yet — add one under Scripts.'}
          </pre>
        </div>
      </div>
    </Modal>
  )
}

// ── documents ─────────────────────────────────────────────────
function DocumentsCard({ docs, requests }) {
  const toast = useToast()
  const [downloadingId, setDownloadingId] = useState(null)
  const { run: download } = useAction(async (d) => {
    setDownloadingId(d.id)
    const { url } = await api(`/documents/${d.id}/url`)
    window.open(url, '_blank')
  }, { toast, onDone: () => setDownloadingId(null) })

  const copyLink = (r) => {
    navigator.clipboard.writeText(`${window.location.origin}/upload/${r.token}`)
      .then(() => toast('Secure link copied — send it to the claimant'))
      .catch(() => toast('Couldn’t access the clipboard — copy the URL from the browser bar instead.', 'error'))
  }

  return (
    <div className="card p-5">
      <h2 className="mb-3 text-sm font-semibold text-slate-200">Documents</h2>
      {requests.length > 0 && (
        <div className="mb-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Secure upload requests</p>
          {requests.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-2.5 rounded-lg border border-slate-800 bg-slate-800/70/60 px-3 py-2.5">
              <FileText size={15} className="text-brand-500" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-slate-200">{(r.doc_types || []).join(', ') || 'Any documents'}</p>
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
        <div className="divide-y divide-slate-800">
          {docs.map((d) => (
            <div key={d.id} className="flex items-center gap-3 py-2.5">
              <FileText size={16} className="text-slate-400" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-slate-200">{d.doc_type || 'Document'} — {d.file_name}</p>
                <p className="text-[11px] text-slate-400">{fmtDateTime(d.uploaded_at)}{d.size_bytes ? ` · ${(d.size_bytes / 1024 / 1024).toFixed(1)} MB` : ''}</p>
              </div>
              <button className="btn-ghost !px-2.5 !py-1.5 text-xs" onClick={() => download(d)} disabled={downloadingId === d.id}>
                {downloadingId === d.id ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} View
              </button>
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
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200"><Activity size={15} className="text-brand-400" /> Activity</h2>
      {activities.length === 0 ? <Empty title="No activity yet" /> : (
        <div className="relative space-y-4 border-l border-slate-700 pl-5">
          {activities.map((a) => {
            const Icon = ACT_ICON[a.type] || Activity
            return (
              <div key={a.id} className="relative">
                <div className="absolute -left-[26.5px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-brand-500/20 text-brand-400">
                  <Icon size={10} />
                </div>
                <p className="text-sm text-slate-200">{a.title}</p>
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
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200"><Mail size={15} className="text-brand-400" /> Email history</h2>
      {emails.length === 0 ? <Empty title="No emails sent yet" /> : (
        <div className="space-y-2">
          {emails.map((m) => (
            <div key={m.id} className="rounded-lg border border-slate-800 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-medium text-slate-200">{m.subject}</p>
                <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${m.opens > 0 ? 'bg-emerald-500/10 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
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
function EmailModal({ open, onClose, lead, onSent, prefill }) {
  const toast = useToast()
  const [templates, setTemplates] = useState([])
  const [purpose, setPurpose] = useState('followups')
  const [templateId, setTemplateId] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      api('/templates?type=email').then((d) => setTemplates(d.templates || [])).catch(() => {})
      // prefill (e.g. doc-request flow) — rendered with lead info + secure link
      if (prefill) {
        setSubject(prefill.subject || '')
        setBody(prefill.body || '')
        setPurpose('documentation')
      }
    }
  }, [open, prefill])

  const applyTemplate = (tid) => {
    setTemplateId(tid)
    const t = templates.find((x) => x.id === tid)
    if (t) { setSubject(t.subject || ''); setBody(t.body || '') }
  }
  const send = async () => {
    if (busy) return
    if (!subject.trim() || !body.trim()) { toast('Add a subject and a body before sending.', 'error'); return }
    setBusy(true)
    try {
      await api(`/leads/${lead.id}/email`, { method: 'POST', body: { subject: sanitizeText(subject, 300), body, purpose } })
      toast('Email sent 📬 (opens are tracked automatically)')
      onSent()
      onClose()
    } catch (e) {
      toast(describeError(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open={open} onClose={onClose} title={`Email ${lead.first_name} (${lead.email || 'no email'})`} wide>
      <div className="space-y-3">
        {prefill?.docLink && (
          <div className="break-all rounded-lg bg-emerald-500/10 p-2.5 text-xs text-emerald-300">📎 Secure link attached to this email: {prefill.docLink}</div>
        )}
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
          <button className="btn-primary" onClick={send} disabled={busy || !subject.trim() || !body.trim()}>
            <Send size={14} /> {busy ? 'Sending…' : 'Send & track'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function DocRequestModal({ open, onClose, lead, onDone, onCreated }) {
  const toast = useToast()
  const [types, setTypes] = useState(['Government photo ID'])
  const [message, setMessage] = useState('')
  const [days, setDays] = useState(7)
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState('')

  const toggle = (t) => setTypes((ts) => (ts.includes(t) ? ts.filter((x) => x !== t) : [...ts, t]))
  const create = async () => {
    if (busy) return
    setBusy(true)
    try {
      const d = await api(`/leads/${lead.id}/doc-request`, {
        method: 'POST',
        body: { doc_types: types, message: sanitizeText(message, 1000), expires_days: Math.min(60, Math.max(1, Number(days) || 7)) },
      })
      setLink(d.url)
      onDone()
    } catch (e) {
      toast(describeError(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="Request documents (secure link)">
      {link ? (
        <div className="space-y-3">
          <div className="rounded-lg bg-emerald-500/10 p-4 text-sm text-emerald-300">Secure link created! Send it to {lead.first_name || 'the claimant'} by email or text.</div>
          <div className="break-all rounded-lg bg-slate-900 p-3 font-mono text-xs text-emerald-300">{link}</div>
          {lead.email && onCreated && (
            <button className="btn-primary w-full" onClick={() => onCreated(link)}>
              <Mail size={14} /> Compose email with this link (recommended)
            </button>
          )}
          <button className="btn-ghost w-full" onClick={() => { navigator.clipboard.writeText(link).then(() => toast('Link copied to clipboard')).catch(() => toast("Couldn’t access the clipboard — select the link text and copy manually.", "error")) }}>
            <Copy size={14} /> Just copy the link
          </button>
          <button className="btn-ghost w-full" onClick={() => { onClose(); setLink('') }}>Done</button>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="label">Documents needed</label>
            <div className="grid grid-cols-2 gap-1.5">
              {DOC_TYPES.map((t) => (
                <label key={t} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-sm ${types.includes(t) ? 'border-brand-400 bg-brand-500/10 text-brand-200' : 'border-slate-700 text-slate-300'}`}>
                  <input type="checkbox" checked={types.includes(t)} onChange={() => toggle(t)} className="h-4 w-4 rounded border-slate-600" />
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

function QuickTask({ onAdd, busy }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [type, setType] = useState('callback')
  const submit = () => {
    if (busy || !title.trim()) return
    onAdd(title.trim(), due, type)
    setTitle(''); setDue(''); setOpen(false)
  }
  return (
    <div className="relative">
      <button className="btn-ghost !py-1.5 text-xs" onClick={() => setOpen((o) => !o)}><Plus size={13} /> Add task</button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-72 space-y-2 rounded-xl border border-slate-700 bg-slate-900 p-3 shadow-xl">
          <input className="input" autoFocus placeholder="Task title…" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
          <div className="flex gap-2">
            <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
              {TASK_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <input className="input" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
          <button className="btn-primary w-full !py-1.5 text-xs" onClick={submit} disabled={busy || !title.trim()}>{busy ? 'Adding…' : 'Add task'}</button>
        </div>
      )}
    </div>
  )
}

// ── SSDI intake questionnaire (33 questions, filled on the call) ──
function IntakeCard({ lead, onSaved }) {
  const toast = useToast()
  const [data, setData] = useState(lead.intake || {})
  const [dirty, setDirty] = useState(false)

  const initial = lead.intake || {}
  const setAnswer = (qid, value) => {
    setData((d) => ({ ...d, [qid]: value }))
    setDirty(true)
  }
  const setYesNo = (qid, prefix) => {
    setData((d) => ({ ...d, [qid]: d[qid] && String(d[qid]).startsWith(prefix) ? d[qid] : prefix + ' ' }))
    setDirty(true)
  }
  const { run: save, busy } = useAction(async () => {
    // trim every answer before persisting
    const clean = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, sanitizeText(v, 2000)]))
    await api(`/leads/${lead.id}`, { method: 'PATCH', body: { intake: clean } })
    setDirty(false)
  }, { toast, successMsg: 'Intake saved to the lead file', onSaved })

  const answered = Object.values(data).filter((v) => String(v || '').trim()).length
  const totalQ = INTAKE_SECTIONS.reduce((n, s) => n + s.questions.length, 0)

  return (
    <div className="card p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-200"><NotebookPen size={15} className="text-brand-400" /> SSDI Intake — fill while on the call</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">{answered}/{totalQ} answered</span>
          <button className="btn-primary !py-1.5 text-xs" onClick={save} disabled={busy || !dirty}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} {busy ? 'Saving…' : 'Save intake'}
          </button>
        </div>
      </div>
      {dirty && <p className="mb-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-300">Unsaved intake answers — click Save intake before leaving.</p>}
      <div className="space-y-4">
        {INTAKE_SECTIONS.map((section) => (
          <details key={section.name} open={section === INTAKE_SECTIONS[0]} className="rounded-xl border border-slate-700">
            <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-800/70">{section.name}</summary>
            <div className="space-y-3 border-t border-slate-800 p-4">
              {section.questions.map((q) => (
                <div key={q.id}>
                  <label className="label !mb-1">{q.q}</label>
                  {q.type === 'yesno' && (
                    <div className="mb-1 flex gap-1">
                      {['Yes,', 'No,'].map((p) => (
                        <button key={p} type="button" onClick={() => setYesNo(q.id, p)}
                          className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${String(data[q.id] || '').startsWith(p) ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>{p.replace(',', '')}</button>
                      ))}
                    </div>
                  )}
                  <textarea
                    className="input text-sm"
                    rows={2}
                    value={data[q.id] || ''}
                    onChange={(e) => setAnswer(q.id, e.target.value)}
                    placeholder="Their answer…"
                  />
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>
    </div>
  )
}
