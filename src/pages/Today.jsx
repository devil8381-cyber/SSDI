import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Mail, Phone, Sunrise, Loader2 } from 'lucide-react'
import { api, describeError } from '../api'
import { getCallHref } from '../lib/call'
import { useAction } from '../lib/hooks'
import { useToast, Empty, PageError, Spinner, DispositionBadge, fmtDateTime } from '../ui'

const REASON_ORDER = ['Overdue follow-up', 'Callback due today', 'Fresh lead']
const REASON_STYLES = {
  'Overdue follow-up': 'bg-rose-100 text-rose-700',
  'Callback due today': 'bg-cyan-100 text-cyan-700',
  'Fresh lead': 'bg-blue-100 text-blue-700',
}

export default function Today() {
  const toast = useToast()
  const [q, setQ] = useState(null)
  const [loadError, setLoadError] = useState(null)

  const load = useCallback(() => api('/queue')
    .then((d) => { setQ(d); setLoadError(null) })
    .catch((e) => setLoadError(describeError(e))), [])
  useEffect(() => { load() }, [load])

  const { run: emailPlan, busy: emailing } = useAction(async () => {
    await api('/queue/email', { method: 'POST' })
  }, { toast, successMsg: 'Today\'s plan emailed to you 📬' })

  const grouped = useMemo(() => {
    if (!q?.items) return []
    const tasks = q.items.filter((i) => i.reason.startsWith('Task:'))
    const byReason = REASON_ORDER.map((r) => ({ reason: r, items: q.items.filter((i) => i.reason === r) })).filter((g) => g.items.length)
    if (tasks.length) byReason.splice(2, 0, { reason: 'Tasks due today', items: tasks })
    return byReason
  }, [q])

  if (loadError) return <div className="mx-auto max-w-4xl pt-10"><PageError message={loadError} onRetry={load} /></div>
  if (!q) return <div className="flex justify-center py-20"><Spinner className="h-7 w-7" /></div>

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-slate-800"><Sunrise size={20} className="text-amber-500" /> Today</h1>
          <p className="text-sm text-slate-500">Your queue, in priority order. Work it top to bottom — overdue first.</p>
        </div>
        <button className="btn-ghost" onClick={emailPlan} disabled={emailing || !q.counts.total} title="Emails this plan to your own address (needs SMTP configured)">
          {emailing ? <Loader2 size={15} className="animate-spin" /> : <Mail size={15} />} Email me this plan
        </button>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <div className="card p-3 text-center"><p className="text-xl font-bold text-slate-800">{q.counts.total}</p><p className="text-[11px] text-slate-500">In queue</p></div>
        <div className="card p-3 text-center"><p className="text-xl font-bold text-rose-600">{q.counts.overdue}</p><p className="text-[11px] text-slate-500">Overdue</p></div>
        <div className="card p-3 text-center"><p className="text-xl font-bold text-cyan-600">{q.counts.dueToday}</p><p className="text-[11px] text-slate-500">Due today</p></div>
        <div className="card p-3 text-center"><p className="text-xl font-bold text-blue-600">{q.counts.fresh}</p><p className="text-[11px] text-slate-500">Fresh</p></div>
      </div>

      {q.items.length === 0 && <div className="card"><Empty icon={Sunrise} title="Queue is empty 🎉" hint="Every lead is touched. Fresh assignments will appear here automatically." /></div>}

      {grouped.map((g) => (
        <div key={g.reason}>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
            {g.reason}
            <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${REASON_STYLES[g.reason] || 'bg-slate-100 text-slate-600'}`}>{g.items.length}</span>
          </h2>
          <div className="card divide-y divide-slate-100 overflow-hidden">
            {g.items.map((i) => (
              <div key={i.id + i.reason} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-slate-50/60">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-800">
                    <Link className="hover:text-brand-600 hover:underline" to={`/leads/${i.id}`}>{i.first_name} {i.last_name}</Link>
                    {'  '}
                    {!g.reason.startsWith('Task:') && <DispositionBadge value={i.disposition} />}
                    {g.reason.startsWith('Task:') && <span className="text-xs text-slate-400">{g.reason.slice(6)}</span>}
                  </p>
                  <p className="text-xs text-slate-400">
                    {i.due_at ? <>due {fmtDateTime(i.due_at)} · </> : null}
                    {i.assigned_name ? `agent: ${i.assigned_name}` : 'unassigned'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${REASON_STYLES[g.reason] || 'bg-slate-100 text-slate-600'}`}>{g.reason}</span>
                  {i.phone && (
                    <a
                      href={getCallHref(i.phone) || '#'}
                      className="btn-ghost !px-2 !py-1.5 text-xs !text-emerald-700"
                      onClick={async () => { try { await api(`/leads/${i.id}/call`, { method: 'POST' }) } catch { /* logging is best-effort */ } }}
                      title="Click to call (logged in timeline)"
                    ><Phone size={13} /> Call</a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
