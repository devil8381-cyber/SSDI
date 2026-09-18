import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Circle, Plus, ClipboardList } from 'lucide-react'
import { api } from '../api'
import { useAuth } from '../auth'
import { useToast, Modal, Empty, Spinner, fmtDateTime, leadName } from '../ui'
import { TASK_TYPES } from '../config'

export default function Tasks() {
  const { profile } = useAuth()
  const toast = useToast()
  const admin = profile?.role === 'admin'
  const [tasks, setTasks] = useState(null)
  const [status, setStatus] = useState('open')
  const [scope, setScope] = useState('me')
  const [showAdd, setShowAdd] = useState(false)

  const load = () => {
    const p = new URLSearchParams({ status })
    if (scope === 'me') p.set('scope', 'me')
    api(`/tasks?${p}`).then((d) => setTasks(d.tasks || [])).catch((e) => toast(e.message, 'error'))
  }
  useEffect(load, [status, scope])

  const toggle = async (t) => {
    try { await api(`/tasks/${t.id}`, { method: 'PATCH', body: { status: t.status === 'open' ? 'done' : 'open' } }); load() } catch (e) { toast(e.message, 'error') }
  }

  const todayStr = new Date().toISOString().slice(0, 10)
  const isOverdue = (t) => t.status === 'open' && t.due_at && t.due_at.slice(0, 10) < todayStr

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-800">Tasks</h1>
        <button className="btn-primary" onClick={() => setShowAdd(true)}><Plus size={15} /> New task</button>
      </div>
      <div className="card flex flex-wrap gap-2 p-3">
        <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="open">Open</option><option value="done">Completed</option><option value="all">All</option>
        </select>
        {admin && (
          <select className="input w-auto" value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="me">My tasks</option><option value="all">Whole team</option>
          </select>
        )}
      </div>
      <div className="card overflow-hidden">
        {!tasks ? <div className="flex justify-center py-16"><Spinner className="h-7 w-7" /></div>
          : tasks.length === 0 ? <Empty icon={ClipboardList} title="No tasks here" hint="Create callbacks and follow-ups so nothing slips" />
          : (
          <div className="divide-y divide-slate-100">
            {tasks.map((t) => (
              <div key={t.id} className="flex items-center gap-3 px-5 py-3">
                <button onClick={() => toggle(t)} className="text-slate-300 hover:text-emerald-500">
                  {t.status === 'open' ? <Circle size={18} /> : <CheckCircle2 size={18} className="text-emerald-500" />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium ${t.status === 'done' ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{t.title}</p>
                  <p className="text-xs text-slate-400">
                    {t.leads ? <>Lead: <Link className="text-brand-600 hover:underline" to={`/leads/${t.leads.id}`}>{leadName(t.leads)}</Link> · </> : null}
                    {t.profiles ? <>for {t.profiles?.name} · </> : null}
                    <span className={isOverdue(t) ? 'font-semibold text-rose-500' : ''}>{t.due_at ? `due ${fmtDateTime(t.due_at)}` : 'no due date'}</span>
                  </p>
                </div>
                <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-500">{t.type.replace('_', ' ')}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <AddTask open={showAdd} onClose={() => setShowAdd(false)} onDone={() => { setShowAdd(false); load() }} />
    </div>
  )
}

function AddTask({ open, onClose, onDone }) {
  const toast = useToast()
  const { profile } = useAuth()
  const [agents, setAgents] = useState([])
  const [f, setF] = useState({ title: '', type: 'callback', due_at: '', assigned_to: profile?.id || '' })
  useEffect(() => { api('/users/agents').then((d) => setAgents(d.users || [])).catch(() => {}) }, [])
  const save = async () => {
    try {
      await api('/tasks', {
        method: 'POST',
        body: { ...f, due_at: f.due_at ? new Date(f.due_at).toISOString() : null, assigned_to: profile.role === 'admin' ? f.assigned_to : profile.id },
      })
      toast('Task created')
      onDone()
    } catch (e) { toast(e.message, 'error') }
  }
  return (
    <Modal open={open} onClose={onClose} title="New task">
      <div className="space-y-3">
        <div><label className="label">Title *</label><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} autoFocus /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Type</label>
            <select className="input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
              {TASK_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div><label className="label">Due</label><input className="input" type="datetime-local" value={f.due_at} onChange={(e) => setF({ ...f, due_at: e.target.value })} /></div>
        </div>
        {profile?.role === 'admin' && (
          <div><label className="label">Assign to</label>
            <select className="input" value={f.assigned_to} onChange={(e) => setF({ ...f, assigned_to: e.target.value })}>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={!f.title.trim()}>Create</button>
        </div>
      </div>
    </Modal>
  )
}
