import { useCallback, useEffect, useState } from 'react'
import { Plus, Send, Pencil, Trash2, Plug, PlugZap, Loader2 } from 'lucide-react'
import { api, describeError } from '../api'
import { useAction } from '../lib/hooks'
import { maxLen, minLen, required, sanitizeText, validateForm } from '../lib/validate'
import { useToast, Modal, Empty, Spinner, PageError } from '../ui'
import { SMTP_PURPOSES } from '../config'

const PURPOSE_VALUES = SMTP_PURPOSES.map((p) => p.value)
const blank = { name: '', purpose: 'followups', host: '', port: 587, secure: false, username: '', password: '', from_name: '', from_email: '', daily_limit: 300 }

export default function Smtp() {
  const toast = useToast()
  const [profiles, setProfiles] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [editing, setEditing] = useState(null)
  const [testFor, setTestFor] = useState(null)
  const [confirmDel, setConfirmDel] = useState(null)

  const load = useCallback(() => api('/smtp')
    .then((d) => { setProfiles(d.profiles || []); setLoadError(null) })
    .catch((e) => setLoadError(describeError(e))), [])
  useEffect(() => { load() }, [load])

  const { run: del, busy: deleting } = useAction(async () => {
    await api(`/smtp/${confirmDel}`, { method: 'DELETE' })
    setConfirmDel(null)
    load()
  }, { toast, successMsg: 'Profile deleted' })

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100">SMTP servers</h1>
          <p className="text-sm text-slate-400">Route each task through its own sender: callbacks on one server, document requests on another.</p>
        </div>
        <button className="btn-primary" onClick={() => setEditing({ ...blank })}><Plus size={15} /> Add SMTP server</button>
      </div>

      {!profiles && !loadError ? <div className="flex justify-center py-16"><Spinner className="h-7 w-7" /></div>
        : loadError ? <PageError message={loadError} onRetry={load} />
        : profiles.length === 0 ? (
        <div className="card"><Empty icon={Send} title="No SMTP servers yet" hint="Add one per task type — e.g. 'Callbacks' for follow-up call emails, 'Docs' for document requests" /></div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {profiles.map((p) => {
            const purpose = SMTP_PURPOSES.find((x) => x.value === p.purpose)
            return (
              <div key={p.id} className={`card p-5 ${p.is_active ? '' : 'opacity-60'}`}>
                <div className="mb-3 flex items-start justify-between">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-slate-100">{p.name}</h3>
                    <p className="mt-0.5 text-xs text-slate-400">{p.host}:{p.port}{p.secure ? ' (SSL)' : ' (STARTTLS)'} · {p.from_email}</p>
                  </div>
                  <span className="shrink-0 rounded-md bg-brand-500/20 px-2 py-0.5 text-[11px] font-semibold text-brand-300">{purpose?.label || p.purpose}</span>
                </div>
                <p className="mb-3 text-xs text-slate-400">Daily limit: {p.daily_limit} emails · password {p.has_password ? 'saved ✓' : '⚠ missing'}</p>
                <div className="flex gap-2">
                  <button className="btn-ghost !py-1.5 text-xs" onClick={() => setEditing(p)}><Pencil size={13} /> Edit</button>
                  <button className="btn-ghost !py-1.5 text-xs" onClick={() => setTestFor(p)}><Plug size={13} /> Test</button>
                  <button className="btn-ghost !py-1.5 text-xs text-rose-400" onClick={() => setConfirmDel(p.id)}><Trash2 size={13} /> Delete</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <EditModal profile={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); load() }} />
      <TestModal profile={testFor} onClose={() => setTestFor(null)} />

      <Modal open={!!confirmDel} onClose={() => setConfirmDel(null)} title="Delete SMTP profile?">
        <p className="text-sm text-slate-300">Emails using this profile will fall back to another active one.</p>
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setConfirmDel(null)}>Cancel</button>
          <button className="btn-danger" onClick={del} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete'}</button>
        </div>
      </Modal>
    </div>
  )
}

function EditModal({ profile, onClose, onDone }) {
  const toast = useToast()
  const isNew = !profile?.id
  const [f, setF] = useState(profile || blank)
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [formErr, setFormErr] = useState('')
  useEffect(() => { setF(profile || blank); setErrors({}); setFormErr('') }, [profile])

  const save = async () => {
    if (busy) return
    // Only require a password when creating a profile or replacing one
    const errs = validateForm(f, {
      name: [maxLen(120)],
      host: [required('Host'), maxLen(200)],
      port: [(v) => (Number(v) >= 1 && Number(v) <= 65535 ? null : 'Port must be 1–65535')],
      username: [required('Username'), maxLen(200)],
      password: f.has_password ? [] : [required('Password'), minLen(4)],
      from_email: [required('From email'), maxLen(200)],
      daily_limit: [(v) => (Number(v) >= 1 && Number(v) <= 10000 ? null : 'Daily limit must be 1–10,000')],
    })
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    setFormErr('')
    try {
      const body = {
        name: sanitizeText(f.name, 120) || `${sanitizeText(f.host, 120)} (${f.purpose})`,
        purpose: PURPOSE_VALUES.includes(f.purpose) ? f.purpose : 'general',
        host: sanitizeText(f.host, 200),
        port: Number(f.port) || 587,
        secure: !!f.secure,
        username: sanitizeText(f.username, 200),
        from_name: sanitizeText(f.from_name, 120),
        from_email: sanitizeText(f.from_email, 200),
        daily_limit: Number(f.daily_limit) || 300,
      }
      if (f.password) body.password = f.password // only send when (re)entered — never echo secrets
      if (isNew) await api('/smtp', { method: 'POST', body })
      else await api(`/smtp/${f.id}`, { method: 'PATCH', body })
      toast(isNew ? 'SMTP profile added' : 'SMTP profile saved')
      onDone()
    } catch (e) {
      setFormErr(describeError(e))
    } finally {
      setBusy(false)
    }
  }

  const fieldErr = (k) => errors[k] ? <p className="mt-1 text-xs text-rose-400">{errors[k]}</p> : null

  return (
    <Modal open={!!profile} onClose={onClose} title={isNew ? 'Add SMTP server' : 'Edit SMTP server'} wide>
      {f && (
        <div className="grid grid-cols-2 gap-3">
          {formErr && <p className="col-span-2 rounded-lg bg-rose-500/10 p-3 text-sm text-rose-300">{formErr}</p>}
          <div className="col-span-2">
            <label className="label">Profile name</label>
            <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Docs sender (Brevo)" />
          </div>
          <div>
            <label className="label">Used for</label>
            <select className="input" value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })}>
              {SMTP_PURPOSES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Daily send limit</label>
            <input className={`input ${errors.daily_limit ? '!border-rose-400' : ''}`} type="number" value={f.daily_limit} onChange={(e) => setF({ ...f, daily_limit: e.target.value })} />
            {fieldErr('daily_limit')}
          </div>
          <div>
            <label className="label">Host</label>
            <input className={`input ${errors.host ? '!border-rose-400' : ''}`} value={f.host} onChange={(e) => setF({ ...f, host: e.target.value })} placeholder="smtp-relay.brevo.com" />
            {fieldErr('host')}
          </div>
          <div>
            <label className="label">Port</label>
            <input className={`input ${errors.port ? '!border-rose-400' : ''}`} type="number" value={f.port} onChange={(e) => setF({ ...f, port: e.target.value })} />
            {fieldErr('port')}
          </div>
          <div>
            <label className="label">Username</label>
            <input className={`input ${errors.username ? '!border-rose-400' : ''}`} value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
            {fieldErr('username')}
          </div>
          <div>
            <label className="label">Password {f.has_password ? '(saved — leave blank to keep)' : ''}</label>
            <input className={`input ${errors.password ? '!border-rose-400' : ''}`} type="password" value={f.password || ''} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder={f.has_password ? '••••••••' : ''} />
            {fieldErr('password')}
          </div>
          <div><label className="label">From name</label><input className="input" value={f.from_name} onChange={(e) => setF({ ...f, from_name: e.target.value })} placeholder="Claims Team" /></div>
          <div>
            <label className="label">From email</label>
            <input className={`input ${errors.from_email ? '!border-rose-400' : ''}`} value={f.from_email} onChange={(e) => setF({ ...f, from_email: e.target.value })} placeholder="docs@yourdomain.com" />
            {fieldErr('from_email')}
          </div>
          <label className="col-span-2 flex items-center gap-2.5 text-sm">
            <input type="checkbox" checked={!!f.secure} onChange={(e) => setF({ ...f, secure: e.target.checked })} className="h-4 w-4 rounded border-slate-600" />
            Use SSL/TLS direct (port 465). Leave unchecked for STARTTLS (port 587).
          </label>
          <div className="col-span-2 flex justify-end gap-2">
            <button className="btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      )}
    </Modal>
  )
}

function TestModal({ profile, onClose }) {
  const toast = useToast()
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  if (!profile) return null

  const send = async () => {
    if (busy || !to.trim()) return
    setBusy(true)
    setErr('')
    try {
      await api(`/smtp/${profile.id}/test`, { method: 'POST', body: { to: sanitizeText(to, 200) } })
      toast(`Test email sent to ${to} — check the inbox (and spam folder)`)
      onClose()
    } catch (e) {
      setErr(describeError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Test "${profile.name}"`}>
      <div className="space-y-3">
        {err && <p className="rounded-lg bg-rose-500/10 p-3 text-sm text-rose-300">{err}</p>}
        <div><label className="label">Send test to</label><input className="input" type="email" value={to} onChange={(e) => setTo(e.target.value)} autoFocus /></div>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={send} disabled={!to.trim() || busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <PlugZap size={14} />} {busy ? 'Sending…' : 'Send test'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
