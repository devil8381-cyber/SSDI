import { useEffect, useState } from 'react'
import { Plus, Save, Trash2, MessageSquareText, Loader2 } from 'lucide-react'
import { api, describeError } from '../api'
import { useAuth } from '../auth'
import { useAction } from '../lib/hooks'
import { maxLen, required, sanitizeText } from '../lib/validate'
import { useToast, Modal, Empty, Spinner, PageError, fmtDate } from '../ui'

export default function Templates() {
  const { profile } = useAuth()
  const toast = useToast()
  const admin = profile?.role === 'admin'
  const [type, setType] = useState('email')
  const [templates, setTemplates] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [editing, setEditing] = useState(null)
  const [confirmDel, setConfirmDel] = useState(null)

  const load = () => api(`/templates?type=${type}`)
    .then((d) => { setTemplates(d.templates || []); setLoadError(null) })
    .catch((e) => setLoadError(describeError(e)))
  useEffect(() => { load() }, [type]) // eslint-disable-line react-hooks/exhaustive-deps

  const { run: save, busy: saving } = useAction(async () => {
    const name = sanitizeText(editing.name, 200)
    if (!name) throw new Error('Give the template a name.')
    const body = { name, subject: sanitizeText(editing.subject || '', 300), body: editing.body, type: editing.type }
    if (editing.id) await api(`/templates/${editing.id}`, { method: 'PATCH', body })
    else await api('/templates', { method: 'POST', body })
    setEditing(null)
    load()
  }, { toast, successMsg: 'Template saved' })

  const { run: del, busy: deleting } = useAction(async () => {
    await api(`/templates/${confirmDel}`, { method: 'DELETE' })
    setConfirmDel(null)
    load()
  }, { toast, successMsg: 'Template deleted' })

  const cancelEdit = () => {
    if (editing && (editing.name || editing.body) && !window.confirm('Discard this template\'s unsaved changes?')) return
    setEditing(null)
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-100">Templates</h1>
        {admin && (
          <button className="btn-primary" onClick={() => setEditing({ name: '', type, subject: '', body: '' })}>
            <Plus size={15} /> New template
          </button>
        )}
      </div>
      <div className="flex gap-2">
        <button className={`btn !py-1.5 text-sm ${type === 'email' ? 'bg-brand-600 text-white' : 'card text-slate-300'}`} onClick={() => setType('email')}>📧 Email templates</button>
        <button className={`btn !py-1.5 text-sm ${type === 'text' ? 'bg-brand-600 text-white' : 'card text-slate-300'}`} onClick={() => setType('text')}>💬 Text (SMS) snippets</button>
      </div>
      <p className="text-sm text-slate-400">
        Variables: <code className="rounded bg-slate-700 px-1.5 py-0.5 text-xs">{'{{first_name}}'}</code> <code className="rounded bg-slate-700 px-1.5 py-0.5 text-xs">{'{{last_name}}'}</code> <code className="rounded bg-slate-700 px-1.5 py-0.5 text-xs">{'{{phone}}'}</code> <code className="rounded bg-slate-700 px-1.5 py-0.5 text-xs">{'{{agent_name}}'}</code> <code className="rounded bg-slate-700 px-1.5 py-0.5 text-xs">{'{{doc_link}}'}</code>
      </p>

      {!templates && !loadError ? <div className="col-span-2 flex justify-center py-16"><Spinner className="h-7 w-7" /></div>
        : loadError ? <PageError message={loadError} onRetry={load} />
        : templates.length === 0 ? <div className="card"><Empty icon={MessageSquareText} title="No templates yet" /></div>
        : (
        <div className="grid gap-4 md:grid-cols-2">
          {templates.map((t) => (
            <div key={t.id} className="card p-5">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-slate-100">{t.name}</h3>
                  {t.subject ? <p className="truncate text-xs text-slate-400">Subject: {t.subject}</p> : null}
                  <p className="text-[11px] text-slate-400">updated {fmtDate(t.updated_at)}</p>
                </div>
                {admin && (
                  <div className="flex shrink-0 gap-1">
                    <button className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-brand-400" onClick={() => setEditing(t)} title="Edit"><Save size={15} /></button>
                    <button className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-rose-500" onClick={() => setConfirmDel(t.id)} title="Delete"><Trash2 size={15} /></button>
                  </div>
                )}
              </div>
              <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-800/70 p-3 text-xs leading-relaxed text-slate-300">{t.body}</div>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!editing} onClose={cancelEdit} title={editing?.id ? 'Edit template' : 'New template'} wide>
        {editing && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Name *</label><input className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
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
              <button className="btn-ghost" onClick={cancelEdit}>Cancel</button>
              <button className="btn-primary" onClick={save} disabled={saving || !editing.name.trim()}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {saving ? 'Saving…' : 'Save template'}
              </button>
            </div>
          </div>
        )}
      </Modal>
      <Modal open={!!confirmDel} onClose={() => setConfirmDel(null)} title="Delete template?">
        <p className="text-sm text-slate-300">This template will be permanently removed.</p>
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setConfirmDel(null)}>Cancel</button>
          <button className="btn-danger" onClick={del} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete'}</button>
        </div>
      </Modal>
    </div>
  )
}
