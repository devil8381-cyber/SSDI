import { useCallback, useEffect, useState } from 'react'
import { Plus, KeyRound, UserCog, ShieldCheck, Loader2 } from 'lucide-react'
import { api, describeError } from '../api'
import { useAuth } from '../auth'
import { useAction } from '../lib/hooks'
import { emailRule, maxLen, minLen, phoneRule, required, sanitizeText, validateForm } from '../lib/validate'
import { useToast, Modal, Empty, Spinner, PageError, fmtDuration, fmtDateTime } from '../ui'

export default function Users() {
  const { profile } = useAuth()
  const toast = useToast()
  const [users, setUsers] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState(null)
  const [pwFor, setPwFor] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(() => api('/users')
    .then((d) => { setUsers(d.users || []); setLoadError(null) })
    .catch((e) => setLoadError(describeError(e))), [])
  useEffect(() => { load() }, [load])

  // Optimistic toggle: the status pill flips immediately; rolls back on failure
  const { run: toggleActive, busy: toggling } = useAction(async (u) => {
    setBusyId(u.id)
    const next = !u.is_active
    setUsers((us) => us.map((x) => (x.id === u.id ? { ...x, is_active: next } : x)))
    try {
      await api(`/users/${u.id}`, { method: 'PATCH', body: { is_active: next } })
      return { name: u.name, next }
    } catch (e) {
      setUsers((us) => us.map((x) => (x.id === u.id ? { ...x, is_active: !next } : x)))
      throw e
    }
  }, {
    toast,
    successMsg: (r) => (r?.next ? `${r.name} activated` : `${r?.name || 'User'} deactivated`),
    onDone: () => { setBusyId(null); load() },
  })

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">Users</h1>
        <button className="btn-primary" onClick={() => setShowAdd(true)}><Plus size={15} /> Create user</button>
      </div>

      <div className="card overflow-hidden">
        {!users && !loadError ? <div className="flex justify-center py-16"><Spinner className="h-7 w-7" /></div>
          : loadError ? <PageError message={loadError} onRetry={load} />
          : users.length === 0 ? <Empty icon={UserCog} title="No users" />
          : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">User</th><th className="th">Role</th><th className="th">Leads / Capacity</th>
                  <th className="th">Active today</th><th className="th">Last seen</th><th className="th">Status</th><th className="th"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50/60">
                    <td className="td">
                      <p className="font-medium text-slate-800">{u.name} {u.id === profile.id && <span className="text-xs text-slate-400">(you)</span>}</p>
                      <p className="text-xs text-slate-400">{u.email}</p>
                    </td>
                    <td className="td">
                      <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${u.role === 'admin' ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-600'}`}>
                        {u.role === 'admin' && <ShieldCheck size={12} />} {u.role}
                      </span>
                    </td>
                    <td className="td">{u.leadCount ?? 0}{u.max_leads ? ` / ${u.max_leads}` : ''}{u.phone ? <p className="text-xs text-slate-400">{u.phone}</p> : null}</td>
                    <td className="td">{fmtDuration(u.activeToday)}</td>
                    <td className="td text-slate-500">{u.last_active_at ? fmtDateTime(u.last_active_at) : 'never'}</td>
                    <td className="td">
                      <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${u.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-600'}`}>
                        {u.is_active ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                    <td className="td">
                      <div className="flex justify-end gap-1">
                        <button className="btn-ghost !px-2 !py-1.5 text-xs" onClick={() => setEditing(u)}>Edit</button>
                        <button className="btn-ghost !px-2 !py-1.5 text-xs" onClick={() => setPwFor(u)} title="Reset password"><KeyRound size={13} /></button>
                        {u.id !== profile.id && (
                          <button
                            className={`btn-ghost !px-2 !py-1.5 text-xs ${u.is_active ? 'text-rose-600' : 'text-emerald-600'}`}
                            onClick={() => toggleActive(u)}
                            disabled={(toggling && busyId === u.id) || u.id === profile.id}
                          >
                            {(toggling && busyId === u.id) ? <Loader2 size={13} className="animate-spin" /> : u.is_active ? 'Disable' : 'Enable'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AddUser open={showAdd} onClose={() => setShowAdd(false)} onDone={() => { setShowAdd(false); load() }} />
      <EditUser user={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); load() }} />
      <ResetPassword user={pwFor} onClose={() => setPwFor(null)} />
    </div>
  )
}

function AddUser({ open, onClose, onDone }) {
  const toast = useToast()
  const [f, setF] = useState({ name: '', email: '', password: '', role: 'agent', phone: '', max_leads: '' })
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [formErr, setFormErr] = useState('')

  const save = async () => {
    if (busy) return
    const errs = validateForm(f, {
      name: [maxLen(120)],
      email: [required('Email'), emailRule()],
      password: [required('Password'), minLen(6)],
      phone: [phoneRule()],
    })
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    setFormErr('')
    try {
      await api('/users', {
        method: 'POST',
        body: {
          name: sanitizeText(f.name, 120), email: sanitizeText(f.email, 200).toLowerCase(),
          password: f.password, role: f.role, phone: sanitizeText(f.phone, 30),
          max_leads: f.max_leads === '' ? null : Number(f.max_leads),
        },
      })
      toast(`User ${f.name || f.email} created — share the password with them securely`)
      setF({ name: '', email: '', password: '', role: 'agent', phone: '', max_leads: '' })
      onDone()
    } catch (e) {
      setFormErr(describeError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Create user">
      <div className="space-y-3">
        {formErr && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{formErr}</p>}
        <div><label className="label">Full name</label><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div>
          <label className="label">Email *</label>
          <input className={`input ${errors.email ? '!border-rose-400' : ''}`} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          {errors.email && <p className="mt-1 text-xs text-rose-600">{errors.email}</p>}
        </div>
        <div>
          <label className="label">Password * (share it with them securely)</label>
          <input className={`input ${errors.password ? '!border-rose-400' : ''}`} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder="min 6 characters" />
          {errors.password && <p className="mt-1 text-xs text-rose-600">{errors.password}</p>}
        </div>
        <div><label className="label">Role</label>
          <select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            <option value="agent">Agent</option><option value="admin">Admin</option>
          </select>
        </div>
        <div>
          <label className="label">Phone (shown in welcome emails)</label>
          <input className={`input ${errors.phone ? '!border-rose-400' : ''}`} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="(555) 555-0100" />
          {errors.phone && <p className="mt-1 text-xs text-rose-600">{errors.phone}</p>}
        </div>
        <div><label className="label">Lead capacity (blank = unlimited)</label>
          <input className="input w-40" type="number" min="0" value={f.max_leads} onChange={(e) => setF({ ...f, max_leads: e.target.value })} placeholder="e.g. 150" />
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Creating…' : 'Create user'}</button>
        </div>
      </div>
    </Modal>
  )
}

function EditUser({ user, onClose, onDone }) {
  const toast = useToast()
  const [name, setName] = useState(user?.name || '')
  const [role, setRole] = useState(user?.role || 'agent')
  const [phone, setPhone] = useState(user?.phone || '')
  const [maxLeads, setMaxLeads] = useState(user?.max_leads ?? '')
  const [busy, setBusy] = useState(false)
  useEffect(() => { setName(user?.name || ''); setRole(user?.role || 'agent'); setPhone(user?.phone || ''); setMaxLeads(user?.max_leads ?? '') }, [user])

  const save = async () => {
    if (busy) return
    setBusy(true)
    try {
      await api(`/users/${user.id}`, {
        method: 'PATCH',
        body: { name: sanitizeText(name, 120), role, phone: sanitizeText(phone, 30), max_leads: maxLeads === '' ? null : Number(maxLeads) },
      })
      toast('User updated')
      onDone()
    } catch (e) {
      toast(describeError(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={!!user} onClose={onClose} title={`Edit ${user?.name || ''}`}>
      <div className="space-y-3">
        <div><label className="label">Full name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><label className="label">Role</label>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="agent">Agent</option><option value="admin">Admin</option>
          </select>
        </div>
        <div><label className="label">Phone (shown in welcome emails)</label><input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 555-0100" /></div>
        <div><label className="label">Lead capacity (blank = unlimited)</label><input className="input w-40" type="number" min="0" value={maxLeads} onChange={(e) => setMaxLeads(e.target.value)} /></div>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </Modal>
  )
}

function ResetPassword({ user, onClose }) {
  const toast = useToast()
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const save = async () => {
    if (busy) return
    setBusy(true)
    setErr('')
    try {
      await api(`/users/${user.id}`, { method: 'PATCH', body: { password: pw } })
      toast(`Password reset for ${user.name} — share it securely`)
      setPw('')
      onClose()
    } catch (e) {
      setErr(describeError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={!!user} onClose={onClose} title={`Reset password — ${user?.name || ''}`}>
      <div className="space-y-3">
        {err && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{err}</p>}
        <div><label className="label">New password</label><input className="input" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="min 6 characters" autoFocus /></div>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={busy || pw.length < 6}>{busy ? 'Resetting…' : 'Reset'}</button>
        </div>
      </div>
    </Modal>
  )
}
