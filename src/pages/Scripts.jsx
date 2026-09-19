import { useEffect, useState } from 'react'
import { Plus, Save, Trash2, ScrollText, Loader2 } from 'lucide-react'
import { api, describeError } from '../api'
import { useAuth } from '../auth'
import { useAction } from '../lib/hooks'
import { maxLen, required, sanitizeText } from '../lib/validate'
import { useToast, Modal, Empty, Spinner, PageError, fmtDate } from '../ui'

const TYPES = [
  { value: 'frontend', label: 'Front-End script' },
  { value: 'verification', label: 'Verification script' },
  { value: 'intake', label: 'Intake script' },
  { value: 'general', label: 'General script' },
]

export default function Scripts() {
  const { profile } = useAuth()
  const toast = useToast()
  const admin = profile?.role === 'admin'
  const [scripts, setScripts] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [editing, setEditing] = useState(null)
  const [confirmDel, setConfirmDel] = useState(null)

  const load = () => api('/scripts')
    .then((d) => { setScripts(d.scripts || []); setLoadError(null) })
    .catch((e) => setLoadError(describeError(e)))
  useEffect(() => { load() }, [])

  const { run: save, busy: saving } = useAction(async () => {
    const title = sanitizeText(editing.title, 200)
    if (!title) throw new Error('Give the script a title.')
    const body = { title, type: editing.type, content: editing.content }
    if (editing.id) await api(`/scripts/${editing.id}`, { method: 'PATCH', body })
    else await api('/scripts', { method: 'POST', body })
    setEditing(null)
    load()
  }, { toast, successMsg: 'Script saved' })

  const { run: del, busy: deleting } = useAction(async () => {
    await api(`/scripts/${confirmDel}`, { method: 'DELETE' })
    setConfirmDel(null)
    load()
  }, { toast, successMsg: 'Script deleted' })

  // Cancel warns when the editor holds unsaved edits
  const cancelEdit = () => {
    if (editing && (editing.title || editing.content) && !window.confirm('Discard this script\'s unsaved changes?')) return
    setEditing(null)
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-100">Call scripts</h1>
        {admin && (
          <button className="btn-primary" onClick={() => setEditing({ title: '', type: 'frontend', content: '' })}>
            <Plus size={15} /> New script
          </button>
        )}
      </div>
      <p className="text-sm text-slate-400">The <b>Front-End</b> and <b>Verification</b> scripts appear automatically when an agent opens a matching recording.</p>

      {!scripts && !loadError ? <div className="flex justify-center py-16"><Spinner className="h-7 w-7" /></div>
        : loadError ? <PageError message={loadError} onRetry={load} />
        : scripts.length === 0 ? <div className="card"><Empty icon={ScrollText} title="No scripts yet" /></div>
        : (
        <div className="grid gap-4 md:grid-cols-2">
          {scripts.map((s) => (
            <div key={s.id} className="card flex flex-col p-5">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-100">{s.title}</h3>
                  <p className="text-[11px] text-slate-400">{TYPES.find((t) => t.value === s.type)?.label || s.type} · updated {fmtDate(s.updated_at)}</p>
                </div>
                {admin && (
                  <div className="flex gap-1">
                    <button className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-brand-400" onClick={() => setEditing(s)} title="Edit"><Save size={15} /></button>
                    <button className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-rose-500" onClick={() => setConfirmDel(s.id)} title="Delete"><Trash2 size={15} /></button>
                  </div>
                )}
              </div>
              <pre className="max-h-56 flex-1 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-800/70 p-3 text-xs leading-relaxed text-slate-300">{s.content}</pre>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!editing} onClose={cancelEdit} title={editing?.id ? 'Edit script' : 'New script'} wide>
        {editing && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Title *</label><input className="input" value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></div>
              <div><label className="label">Type</label>
                <select className="input" value={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value })}>
                  {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="label">Script content</label>
              <textarea className="input font-mono text-xs" rows={16} value={editing.content} onChange={(e) => setEditing({ ...editing, content: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={cancelEdit}>Cancel</button>
              <button className="btn-primary" onClick={save} disabled={saving || !editing.title.trim()}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {saving ? 'Saving…' : 'Save script'}
              </button>
            </div>
          </div>
        )}
      </Modal>
      <Modal open={!!confirmDel} onClose={() => setConfirmDel(null)} title="Delete script?">
        <p className="text-sm text-slate-300">This script will be permanently removed.</p>
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setConfirmDel(null)}>Cancel</button>
          <button className="btn-danger" onClick={del} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete'}</button>
        </div>
      </Modal>

      {admin && <RebuttalsManager />}
    </div>
  )
}

// ── rebuttals library (admin-managed, shown in the sticky panel) ──
export function RebuttalsManager() {
  const toast = useToast()
  const [items, setItems] = useState(null)
  const { run: save, busy } = useAction(async () => {
    await api('/settings/rebuttals', { method: 'PUT', body: { rebuttals: items } })
  }, { toast, successMsg: 'Rebuttals saved — live in the sticky panel instantly' })

  useEffect(() => { api('/settings/rebuttals').then((d) => setItems(d.rebuttals || [])).catch((e) => toast(describeError(e), 'error')) }, [])

  return (
    <div className="card p-5 mt-8">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">Rebuttals library</h2>
          <p className="text-xs text-slate-400">Shows in the sticky scripts panel on every page — one glance, objection answered.</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost !py-1.5 text-xs" onClick={() => setItems((x) => [...x, { title: '', body: '' }])}><Plus size={13} /> Add rebuttal</button>
          <button className="btn-primary !py-1.5 text-xs" onClick={save} disabled={busy || !items}>{busy ? 'Saving…' : 'Save rebuttals'}</button>
        </div>
      </div>
      {!items ? <Spinner className="h-5 w-5" /> : (
        <div className="space-y-3">
          {items.map((r, i) => (
            <div key={i} className="rounded-xl bg-slate-800/70 p-3">
              <div className="flex items-center gap-2">
                <input className="input !py-1.5 text-sm font-semibold" value={r.title} onChange={(e) => setItems((x) => x.map((y, j) => (j === i ? { ...y, title: e.target.value } : y)))} placeholder='Objection — e.g. "How much does this cost?"' />
                <button className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-700 hover:text-rose-500" onClick={() => setItems((x) => x.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
              </div>
              <textarea className="input mt-2 text-xs" rows={3} value={r.body} onChange={(e) => setItems((x) => x.map((y, j) => (j === i ? { ...y, body: e.target.value } : y)))} placeholder="The rebuttal response…" />
            </div>
          ))}
          {items.length === 0 && <p className="text-center text-sm text-slate-400">No rebuttals — add the first one.</p>}
        </div>
      )}
    </div>
  )
}
