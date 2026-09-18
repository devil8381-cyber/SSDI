import { useEffect, useState } from 'react'
import { Plus, KeyRound, UserCog, ShieldCheck } from 'lucide-react'
import { api } from '../api'
import { useAuth } from '../auth'
import { useToast, Modal, Empty, Spinner, fmtDuration, fmtDateTime } from '../ui'

export default function Users() {
  const { profile } = useAuth()
  const toast = useToast()
  const [users, setUsers] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState(null)
  const [pwFor, setPwFor] = useState(null)

  const load = () => api('/users').then((d) => setUsers(d.users || [])).catch((e) => toast(e.message, 'error'))
  useEffect(load, [])

  const toggleActive = async (u) => {
    try {
      await api(`/users/${u.id}`, { method: 'PATCH', body: { is_active: !u.is_active } })
      toast(u.is_active ? `${u.name} deactivated` : `${u.name} activated`)
      load()
    } catch (e) { toast(e.message, 'error') }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">Users</h1>
        <button className="btn-primary" onClick={() => setShowAdd(true)}><Plus size={15} /> Create user</button>
      </div>

      <div className="card overflow-hidden">
        {!users ? <div className="flex justify-center py-16"><Spinner className="h-7 w-7" /></div>
          : users.length === 0 ? <Empty icon={UserCog} title="No users" />
          : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">User</th><th className="th">Role</th><th className="th">Leads</th>
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
                    <td className="td">{u.leadCount}</td>
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
                          <button className={`btn-ghost !px-2 !py-1.5 text-xs ${u.is_active ? 'text-rose-600' : 'text-emerald-600'}`} onClick={() => toggleActive(u)}>
                            {u.is_active ? 'Disable' : 'Enable'}
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
  const [f, setF] = useState({ name: '', email: '', password: '', role: 'agent' })
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try { await api('/users', { method: 'POST', body: f }); toast(`User ${f.name || f.email} created`); setF({ name: '', email: '', password: '', role: 'agent' }); onDone() }
    catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title="Create user">
      <div className="space-y-3">
        <div><label className="label">Full name</label><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div><label className="label">Email *</label><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        <div><label className="label">Password * (share it with them securely)</label><input className="input" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder="min 6 characters" /></div>
        <div><label className="label">Role</label>
          <select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            <option value="agent">Agent</option><option value="admin">Admin</option>
          </select>
        </div>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={busy || !f.email || f.password.length < 6}>{busy ? 'Creating…' : 'Create user'}</button>
        </div>
      </div>
    </Modal>
  )
}

function EditUser({ user, onClose, onDone }) {
  const toast = useToast()
  const [name, setName] = useState(user?.name || '')
  const [role, setRole] = useState(user?.role || 'agent')
  useEffect(() => { setName(user?.name || ''); setRole(user?.role || 'agent') }, [user])
  const save = async () => {
    try { await api(`/users/${user.id}`, { method: 'PATCH', body: { name, role } }); toast('User updated'); onDone() } catch (e) { toast(e.message, 'error') }
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
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save}>Save</button>
        </div>
      </div>
    </Modal>
  )
}

function ResetPassword({ user, onClose }) {
  const toast = useToast()
  const [pw, setPw] = useState('')
  const save = async () => {
    try { await api(`/users/${user.id}`, { method: 'PATCH', body: { password: pw } }); toast(`Password reset for ${user.name}`); setPw(''); onClose() } catch (e) { toast(e.message, 'error') }
  }
  return (
    <Modal open={!!user} onClose={onClose} title={`Reset password — ${user?.name || ''}`}>
      <div className="space-y-3">
        <div><label className="label">New password</label><input className="input" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="min 6 characters" autoFocus /></div>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={pw.length < 6}>Reset</button>
        </div>
      </div>
    </Modal>
  )
}
