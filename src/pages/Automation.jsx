import { useEffect, useState } from 'react'
import { Repeat, Zap, Loader2, CalendarClock, Target, Plus, Trash2, MailCheck, Phone } from 'lucide-react'
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
  const [rules, setRules] = useState(null)
  const [targets, setTargets] = useState(null)

  useEffect(() => {
    api('/settings/auto-assign').then((d) => setMode(d.mode)).catch((e) => toast(describeError(e), 'error'))
    api('/settings/followup-rules').then((d) => setRules(d.rules || [])).catch((e) => toast(describeError(e), 'error'))
    api('/settings/targets').then((d) => setTargets(d.targets)).catch((e) => toast(describeError(e), 'error'))
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

      <RulesCard rules={rules} setRules={setRules} />
      <TargetsCard targets={targets} setTargets={setTargets} />
      <WelcomeCard />
      <CallingAppCard />

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

// ── follow-up rules editor ────────────────────────────────────
function RulesCard({ rules, setRules }) {
  const toast = useToast()
  const { run: save, busy } = useAction(async () => {
    if (rules.some((r) => !r.title.trim())) throw new Error('Every rule needs a task title.')
    await api('/settings/followup-rules', { method: 'PUT', body: { rules } })
  }, { toast, successMsg: 'Follow-up rules saved — they apply from the next disposition' })

  const update = (i, patch) => setRules((rs) => rs.map((r, x) => (x === i ? { ...r, ...patch } : r)))

  return (
    <div className="card p-6">
      <div className="mb-4 flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white"><CalendarClock size={18} /></div>
        <div>
          <h2 className="text-sm font-bold text-slate-800">Follow-up rules</h2>
          <p className="text-xs text-slate-500">When an agent sets one of these dispositions, ABA automatically creates the next task — so no lead is ever forgotten.</p>
        </div>
      </div>
      {!rules ? <p className="py-4 text-center text-sm text-slate-400">Loading…</p> : (
        <div className="space-y-2">
          {rules.map((r, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-2.5">
              <select className="input w-auto !py-1.5 text-xs" value={r.disposition} onChange={(e) => update(i, { disposition: e.target.value })}>
                {DISPOSITIONS.map((d) => <option key={d}>{d}</option>)}
              </select>
              <span className="text-xs text-slate-400">→</span>
              <input className="input flex-1 !py-1.5 text-xs" placeholder="Auto-task title" value={r.title} onChange={(e) => update(i, { title: e.target.value })} />
              <span className="text-xs text-slate-400">due in</span>
              <input className="input w-16 !py-1.5 text-xs" type="number" min="0" max="30" value={r.days} onChange={(e) => update(i, { days: Number(e.target.value) })} />
              <span className="text-xs text-slate-400">days</span>
              <button className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-rose-500" onClick={() => setRules((rs) => rs.filter((_, x) => x !== i))} title="Remove rule"><Trash2 size={14} /></button>
            </div>
          ))}
          <div className="flex justify-between pt-1">
            <button className="btn-ghost !py-1.5 text-xs" onClick={() => setRules((rs) => [...rs, { disposition: 'VM', title: '', days: 2, type: 'callback' }])}><Plus size={13} /> Add rule</button>
            <button className="btn-primary !py-1.5 text-xs" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save rules'}</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── daily targets editor ──────────────────────────────────────
function TargetsCard({ targets, setTargets }) {
  const toast = useToast()
  const { run: save, busy } = useAction(async () => {
    await api('/settings/targets', { method: 'PUT', body: targets })
  }, { toast, successMsg: 'Daily targets saved' })

  return (
    <div className="card p-6">
      <div className="mb-4 flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600 text-white"><Target size={18} /></div>
        <div>
          <h2 className="text-sm font-bold text-slate-800">Daily targets (per agent)</h2>
          <p className="text-xs text-slate-500">Agents see progress bars on their dashboard. Set 0 to hide a metric.</p>
        </div>
      </div>
      {!targets ? <p className="py-4 text-center text-sm text-slate-400">Loading…</p> : (
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label">Calls logged / day</label>
            <input className="input w-28" type="number" min="0" max="500" value={targets.calls} onChange={(e) => setTargets({ ...targets, calls: Number(e.target.value) })} />
          </div>
          <div>
            <label className="label">Dispositions set / day</label>
            <input className="input w-28" type="number" min="0" max="500" value={targets.dispositions} onChange={(e) => setTargets({ ...targets, dispositions: Number(e.target.value) })} />
          </div>
          <button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save targets'}</button>
        </div>
      )}
    </div>
  )
}

// ── welcome email on assignment toggle ────────────────────────
function WelcomeCard() {
  const toast = useToast()
  const [enabled, setEnabled] = useState(null)
  useEffect(() => { api('/settings/welcome-email').then((d) => setEnabled(d.enabled)).catch((e) => toast(describeError(e), 'error')) }, [])
  const { run: toggle, busy } = useAction(async () => {
    const next = !enabled
    setEnabled(next)
    await api('/settings/welcome-email', { method: 'PUT', body: { enabled: next } })
    return next
  }, { toast, successMsg: (r) => (r ? 'Welcome emails ON — sent when a lead gets assigned' : 'Welcome emails OFF') })
  if (enabled === null) return null
  return (
    <div className="card p-6">
      <div className="mb-3 flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-600 text-white"><MailCheck size={18} /></div>
        <div>
          <h2 className="text-sm font-bold text-slate-800">Welcome email on assignment</h2>
          <p className="text-xs text-slate-500">When a lead is assigned to an agent, the claimant automatically gets a welcome email with the agent's name and phone number (once per lead + agent).</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button className={enabled ? 'btn-danger' : 'btn-primary'} onClick={toggle} disabled={busy}>
          {busy ? 'Saving…' : enabled ? 'Turn OFF' : 'Turn ON'}
        </button>
        <span className={`text-sm font-medium ${enabled ? 'text-emerald-600' : 'text-slate-500'}`}>{enabled ? 'ON' : 'OFF'}</span>
        <span className="text-xs text-slate-400">Edit the wording under Templates → "Agent Assigned — Welcome (ABA)". Requires SMTP configured.</span>
      </div>
    </div>
  )
}

// ── calling app (click-to-call) ───────────────────────────────
function CallingAppCard() {
  const toast = useToast()
  const [cfg, setCfg] = useState(null)
  useEffect(() => { api('/settings/call').then((d) => setCfg(d)).catch((e) => toast(describeError(e), 'error')) }, [])
  const { run: save, busy } = useAction(async () => {
    await api('/settings/call', { method: 'PUT', body: cfg })
    window.location.reload() // reload so every phone link picks up the new app
  }, { toast, successMsg: 'Calling app saved' })
  const radios = [
    { v: 'tel', label: 'Default calling app (tel:)', hint: 'Best with Phound: set Phound as the Windows default for "tel:" links (Windows Settings → Apps → Default apps → choose defaults by link type → TEL → Phound).' },
    { v: 'phound', label: 'Phound (phound:)', hint: 'Opens the Phound desktop app directly. Only works if Phound registered its phound: protocol on this PC.' },
    { v: 'callto', label: 'callto:', hint: 'For softphones that register "callto:" (Skype-style).' },
    { v: 'custom', label: 'Custom template', hint: 'Any link format — use {number} where the phone number goes, e.g. phound://dial/{number}' },
  ]
  if (!cfg) return null
  return (
    <div className="card p-6">
      <div className="mb-3 flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-800 text-white"><Phone size={18} /></div>
        <div>
          <h2 className="text-sm font-bold text-slate-800">Calling app (click-to-call)</h2>
          <p className="text-xs text-slate-500">Which app opens when an agent clicks a phone number anywhere in the CRM.</p>
        </div>
      </div>
      <div className="space-y-2">
        {radios.map((r) => (
          <label key={r.v} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${cfg.scheme === r.v ? 'border-brand-500 bg-brand-50' : 'border-slate-200'}`}>
            <input type="radio" name="callapp" checked={cfg.scheme === r.v} onChange={() => setCfg({ ...cfg, scheme: r.v })} className="mt-0.5 h-4 w-4" />
            <span>
              <span className="block text-sm font-medium text-slate-800">{r.label}</span>
              <span className="block text-xs text-slate-500">{r.hint}</span>
              {r.v === 'custom' && cfg.scheme === 'custom' && (
                <input className="input mt-2 font-mono text-xs" value={cfg.template || ''} onChange={(e) => setCfg({ ...cfg, template: e.target.value })} placeholder="phound://dial/{number}" />
              )}
            </span>
          </label>
        ))}
      </div>
      <button className="btn-primary mt-3" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save calling app'}</button>
    </div>
  )
}
