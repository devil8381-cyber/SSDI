import { useEffect, useState } from 'react'
import { Repeat, Zap, Loader2 } from 'lucide-react'
import { api, describeError } from '../api'
import { useAction } from '../lib/hooks'
import { useToast, PageError } from '../ui'
import { DISPOSITIONS } from '../config'

// Admin → Automation: lead distribution and pool-hygiene tools.
export default function Automation() {
  const toast = useToast()
  const [mode, setMode] = useState(null)
  const [days, setDays] = useState(14)
  const [preview, setPreview] = useState(null)

  useEffect(() => {
    api('/settings/auto-assign').then((d) => setMode(d.mode)).catch((e) => toast(describeError(e), 'error'))
  }, [])

  const { run: saveMode, busy: savingMode } = useAction(async (m) => {
    const prev = mode
    setMode(m) // optimistic
    try {
      await api('/settings/auto-assign', { method: 'PUT', body: { mode: m } })
    } catch (e) {
      setMode(prev)
      throw e
    }
  }, { toast, successMsg: (m) => (m === 'round_robin' ? 'Auto-assign ON — new leads rotate across agents' : 'Auto-assign OFF — new leads wait in the unassigned pool') })

  const { run: loadPreview, busy: previewing } = useAction(async () => {
    const d = await api(`/leads/stale?days=${days}`)
    setPreview(d)
    if (!d.total) return 'No stale leads — the pool is clean 🎉'
    return undefined
  }, { toast })

  const { run: recycle, busy: recycling } = useAction(async () => {
    if (!confirm(`Send ${preview?.total ?? 0} stale lead(s) back to the unassigned pool? Their agent assignments will be cleared (history is kept).`)) return
    const d = await api('/leads/recycle', { method: 'POST', body: { days } })
    setPreview(null)
    return d.count
  }, { toast, successMsg: (n) => `♻️ ${n} lead(s) recycled to the pool` })

  if (mode === null) return <div className="mx-auto max-w-4xl pt-10"><PageError message="Loading automation settings…" /></div>

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Automation</h1>
        <p className="text-sm text-slate-500">Lead distribution and pool hygiene — set it and forget it.</p>
      </div>

      <div className="card p-6">
        <div className="mb-4 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white"><Zap size={18} /></div>
          <div>
            <h2 className="text-sm font-bold text-slate-800">Auto-assign new leads</h2>
            <p className="text-xs text-slate-500">Applies to Meta leads, CSV imports, and manual adds that arrive without an agent.</p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <button
            onClick={() => saveMode('off')}
            disabled={savingMode}
            className={`rounded-xl border p-4 text-left transition ${mode === 'off' ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-100' : 'border-slate-200 hover:border-brand-300'}`}
          >
            <p className="text-sm font-semibold text-slate-800">⏸ Off — manual distribution</p>
            <p className="mt-1 text-xs text-slate-500">New leads land in the unassigned pool. You assign them from the Leads page (individually or in bulk).</p>
          </button>
          <button
            onClick={() => saveMode('round_robin')}
            disabled={savingMode}
            className={`rounded-xl border p-4 text-left transition ${mode === 'round_robin' ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-100' : 'border-slate-200 hover:border-brand-300'}`}
          >
            <p className="text-sm font-semibold text-slate-800">⚡ Round-robin</p>
            <p className="mt-1 text-xs text-slate-500">Every new lead is auto-assigned to the active agent with the fewest leads. No babysitting required.</p>
          </button>
        </div>
      </div>

      <div className="card p-6">
        <div className="mb-4 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500 text-white"><Repeat size={18} /></div>
          <div>
            <h2 className="text-sm font-bold text-slate-800">Lead recycling</h2>
            <p className="text-xs text-slate-500">Finds leads nobody has touched in a while (excluding Signed/Approved) and returns them to the unassigned pool so someone fresh can work them.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-slate-600">No activity for</label>
          <input className="input w-24" type="number" min="1" max="180" value={days} onChange={(e) => { setDays(e.target.value); setPreview(null) }} />
          <span className="text-sm text-slate-600">+ days</span>
          <button className="btn-ghost" onClick={loadPreview} disabled={previewing}>
            {previewing ? <Loader2 size={14} className="animate-spin" /> : null} Check
          </button>
        </div>
        {preview && (
          <div className="mt-4 rounded-xl bg-slate-50 p-4">
            <p className="text-sm text-slate-700">
              <b>{preview.total}</b> stale lead(s) found with no activity in {preview.days}+ days:
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {DISPOSITIONS.filter((d) => preview.byDisposition[d]).map((d) => (
                <span key={d} className="rounded-md bg-white px-2 py-0.5 text-xs text-slate-600 ring-1 ring-slate-200">
                  {d}: {preview.byDisposition[d]}
                </span>
              ))}
            </div>
            {preview.total > 0 && (
              <button className="btn-primary mt-3" onClick={recycle} disabled={recycling}>
                {recycling ? <Loader2 size={14} className="animate-spin" /> : null} Recycle {preview.total} lead(s) to the pool
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
