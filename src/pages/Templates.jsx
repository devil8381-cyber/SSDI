import { useEffect, useState } from 'react'
import { Plus, Save, Trash2, MessageSquareText } from 'lucide-react'
import { api } from '../api'
import { useAuth } from '../auth'
import { useToast, Modal, Empty, Spinner, fmtDate } from '../ui'

export default function Templates() {
  const { profile } = useAuth()
  const toast = useToast()
  const admin = profile?.role === 'admin'
  const [type, setType] = useState('email')
  const [templates, setTemplates] = useState(null)
  const [editing, setEditing] = useState(null)
  const [confirmDel, setConfirmDel] = useState(null)

  const load = () => api(`/templates?type=${type}`).then((d) => setTemplates(d.templates || [])).catch((e) => toast(e.message, 'error'))
  useEffect(load, [type])

  const save = async () => {
    try {
      const body = { name: editing.name, subject: editing.subject, body: editing.body, type: editing.type }
      if (editing.id) await api(`/templates/${editing.id}`, { method: 'PATCH', body })
      else await api('/templates', { method: 'POST', body })
      toast('Template saved')
      setEditing(null)
      load()
    } catch (e) { toast(e.message, 'error') }
  }
  const del = async () => {
    try { await api(`/templates/${confirmDel}`, { method: 'DELETE' }); toast('Template deleted'); setConfirmDel(null); load() } catch (e) { toast(e.message, 'error') }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-800">Templates</h1>
        {admin && (
          <button className="btn-primary" onClick={() => setEditing({ name: '', type, subject: '', body: '' })}>
            <Plus size={15} /> New template
          </button>
        )}
      </div>
      <div className="flex gap-2">
        <button className={`btn !py-1.5 text-sm ${type === 'email' ? 'bg-brand-600 text-white' : 'card text-slate-600'}`} onClick={() => setType('email')}>📧 Email templates</button>
        <button className={`btn !py-1.5 text-sm ${type === 'text' ? 'bg-brand-600 text-white' : 'card text-slate-600'}`} onClick={() => setType('text')}>💬 Text (SMS) snippets</button>
      </div>
      <p className="text-sm text-slate-500">
        Variables: <code className="rounded bg-slate-200 px-1.5 py-0.5 text-xs">{'{{first_name}}'}</code> <code className="rounded bg-slate-200 px-1.5 py-0.5 text-xs">{'{{last_name}}'}</code> <code className="rounded bg-slate-200 px-1.5 py-0.5 text-xs">{'{{phone}}'}</code> <code className="rounded bg-slate-200 px-1.5 py-0.5 text-xs">{'{{agent_name}}'}</code> <code className="rounded bg-slate-200 px-1.5 py-0.5 text-xs">{'{{doc_link}}'}</code>
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        {!templates ? <div className="col-span-2 flex justify-center py-16"><Spinner className="h-7 w-7" /></div>
          : templates.length === 0 ? <div className="col-span-2 card"><Empty icon={MessageSquareText} title="No templates yet" /></div>
          : templates.map((t) => (
          <div key={t.id} className="card p-5">
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-slate-800">{t.name}</h3>
                {t.subject && <p className="truncate text-xs text-slate-400">Subject: {t.subject}</p>}
                <p className="text-[11px] text-slate-400">updated {fmtDate(t.updated_at)}</p>
              </div>
              {admin && (
                <div className="flex shrink-0 gap-1">
                  <button className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand-600" onClick={() => setEditing(t)}><Save size={15} /></button>
                  <button className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-500" onClick={() => setConfirmDel(t.id)}><Trash2 size={15} /></button>
                </div>
              )}
            </div>
            <div className="max-h-40 overflow-y-auto rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600 whitespace-pre-wrap">{t.body}</div>
          </div>
        ))}
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit template' : 'New template'} wide>
        {editing && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Name</label><input className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
              <div><label className="label">Type</label>
                <select className="input" value={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value })}>
                  <option value="email">Email</option><option value="text">Text (SMS snippet)</option>
                </select>
              </div>
            </div>
            {editing.type === 'email' && (
              <div><label className="label">Subject</label><input className="input" value={editing.subject || ''} onChange={(e) => setEditing({ ...editing, subject: e.target.value })} /></div>
            )}
            <div>
              <label className="label">{editing.type === 'email' ? 'HTML body' : 'Message text'}</label>
              <textarea className="input font-mono text-xs" rows={10} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn-primary" onClick={save} disabled={!editing.name.trim()}><Save size={14} /> Save template</button>
            </div>
          </div>
        )}
      </Modal>
      <Modal open={!!confirmDel} onClose={() => setConfirmDel(null)} title="Delete template?">
        <p className="text-sm text-slate-600">This template will be permanently removed.</p>
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setConfirmDel(null)}>Cancel</button>
          <button className="btn-danger" onClick={del}>Delete</button>
        </div>
      </Modal>
    </div>
  )
}
