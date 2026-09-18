import { useEffect, useState } from 'react'
import { Plus, Send, Pencil, Trash2, Plug, PlugZap } from 'lucide-react'
import { api } from '../api'
import { useToast, Modal, Empty, Spinner } from '../ui'
import { SMTP_PURPOSES } from '../config'

const blank = { name: '', purpose: 'followups', host: '', port: 587, secure: false, username: '', password: '', from_name: '', from_email: '', daily_limit: 300 }

export default function Smtp() {
  const toast = useToast()
  const [profiles, setProfiles] = useState(null)
  const [editing, setEditing] = useState(null)
  const [testFor, setTestFor] = useState(null)
  const [confirmDel, setConfirmDel] = useState(null)

  const load = () => api('/smtp').then((d) => setProfiles(d.profiles || [])).catch((e) => toast(e.message, 'error'))
  useEffect(load, [])

  const save = async () => {
    const body = { ...editing }
    if (!body.password && body.has_password) delete body.password
    try {
      if (editing.id) await api(`/smtp/${editing.id}`, { method: 'PATCH', body })
      else await api('/smtp', { method: 'POST', body })
      toast('SMTP profile saved')
      setEditing(null)
      load()
    } catch (e) { toast(e.message, 'error') }
  }
  const del = async () => {
    try { await api(`/smtp/${confirmDel}`, { method: 'DELETE' }); toast('Profile deleted'); setConfirmDel(null); load() } catch (e) { toast(e.message, 'error') }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">SMTP servers</h1>
          <p className="text-sm text-slate-500">Route each task through its own sender: callbacks on one server, document requests on another.</p>
        </div>
        <button className="btn-primary" onClick={() => setEditing({ ...blank })}><Plus size={15} /> Add SMTP server</button>
      </div>

      {!profiles ? <div className="flex justify-center py-16"><Spinner className="h-7 w-7" /></div>
        : profiles.length === 0 ? (
        <div className="card"><Empty icon={Send} title="No SMTP servers yet" hint="Add one per task type — e.g. 'Callbacks' for follow-up call emails, 'Docs' for document requests" /></div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {profiles.map((p) => {
            const purpose = SMTP_PURPOSES.find((x) => x.value === p.purpose)
            return (
              <div key={p.id} className={`card p-5 ${p.is_active ? '' : 'opacity-60'}`}>
                <div className="mb-3 flex items-start justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-800">{p.name}</h3>
                    <p className="mt-0.5 text-xs text-slate-400">{p.host}:{p.port}{p.secure ? ' (SSL)' : ' (STARTTLS)'} · {p.from_email}</p>
                  </div>
                  <span className="rounded-md bg-brand-100 px-2 py-0.5 text-[11px] font-semibold text-brand-700">{purpose?.label || p.purpose}</span>
                </div>
                <p className="mb-3 text-xs text-slate-400">Daily limit: {p.daily_limit} emails · password {p.has_password ? 'saved ✓' : '⚠ missing'}</p>
                <div className="flex gap-2">
                  <button className="btn-ghost !py-1.5 text-xs" onClick={() => setEditing(p)}><Pencil size={13} /> Edit</button>
                  <button className="btn-ghost !py-1.5 text-xs" onClick={() => setTestFor(p)}><Plug size={13} /> Test</button>
                  <button className="btn-ghost !py-1.5 text-xs text-rose-600" onClick={() => setConfirmDel(p.id)}><Trash2 size={13} /> Delete</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit SMTP server' : 'Add SMTP server'} wide>
        {editing && (
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><label className="label">Profile name</label><input className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. Docs sender (Brevo)" /></div>
            <div><label className="label">Used for</label>
              <select className="input" value={editing.purpose} onChange={(e) => setEditing({ ...editing, purpose: e.target.value })}>
                {SMTP_PURPOSES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            <div><label className="label">Daily send limit</label><input className="input" type="number" value={editing.daily_limit} onChange={(e) => setEditing({ ...editing, daily_limit: e.target.value })} /></div>
            <div><label className="label">Host</label><input className="input" value={editing.host} onChange={(e) => setEditing({ ...editing, host: e.target.value })} placeholder="smtp-relay.brevo.com" /></div>
            <div><label className="label">Port</label><input className="input" type="number" value={editing.port} onChange={(e) => setEditing({ ...editing, port: e.target.value })} /></div>
            <div><label className="label">Username</label><input className="input" value={editing.username} onChange={(e) => setEditing({ ...editing, username: e.target.value })} /></div>
            <div><label className="label">Password {editing.has_password ? '(saved — leave blank to keep)' : ''}</label><input className="input" type="password" value={editing.password || ''} onChange={(e) => setEditing({ ...editing, password: e.target.value })} placeholder={editing.has_password ? '••••••••' : ''} /></div>
            <div><label className="label">From name</label><input className="input" value={editing.from_name} onChange={(e) => setEditing({ ...editing, from_name: e.target.value })} placeholder="Claims Team" /></div>
            <div><label className="label">From email</label><input className="input" value={editing.from_email} onChange={(e) => setEditing({ ...editing, from_email: e.target.value })} placeholder="docs@yourdomain.com" /></div>
            <label className="col-span-2 flex items-center gap-2.5 text-sm">
              <input type="checkbox" checked={!!editing.secure} onChange={(e) => setEditing({ ...editing, secure: e.target.checked })} className="h-4 w-4 rounded border-slate-300" />
              Use SSL/TLS direct (port 465). Leave unchecked for STARTTLS (port 587).
            </label>
            <div className="col-span-2 flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn-primary" onClick={save} disabled={!editing.host || !editing.username || (!editing.has_password && !editing.password)}>Save</button>
            </div>
          </div>
        )}
      </Modal>

      <TestModal profile={testFor} onClose={() => setTestFor(null)} />

      <Modal open={!!confirmDel} onClose={() => setConfirmDel(null)} title="Delete SMTP profile?">
        <p className="text-sm text-slate-600">Emails using this profile will fall back to another active one.</p>
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setConfirmDel(null)}>Cancel</button>
          <button className="btn-danger" onClick={del}>Delete</button>
        </div>
      </Modal>
    </div>
  )
}

function TestModal({ profile, onClose }) {
  const toast = useToast()
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState(false)
  if (!profile) return null
  const send = async () => {
    setBusy(true)
    try {
      await api(`/smtp/${profile.id}/test`, { method: 'POST', body: { to } })
      toast(`Test email sent to ${to} — check the inbox (and spam folder)`)
      onClose()
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title={`Test "${profile.name}"`}>
      <div className="space-y-3">
        <div><label className="label">Send test to</label><input className="input" type="email" value={to} onChange={(e) => setTo(e.target.value)} autoFocus /></div>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={send} disabled={!to || busy}><PlugZap size={14} /> {busy ? 'Sending…' : 'Send test'}</button>
        </div>
      </div>
    </Modal>
  )
}
