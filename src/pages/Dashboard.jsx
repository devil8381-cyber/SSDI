import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Users2, Trophy, BadgeCheck, Percent, PhoneCall, Mail, Clock, ArrowRight, Target, AlertTriangle } from 'lucide-react'
import { api, describeError } from '../api'
import { useAuth } from '../auth'
import { useAction } from '../lib/hooks'
import { StatCard, Empty, Bars, PageError, fmtDateTime, fmtDuration, leadName, DispositionBadge, Spinner, useToast } from '../ui'
import { DISPOSITIONS } from '../config'
import WorldClocks from '../components/WorldClocks'
import { dualCallback } from '../lib/tz'

export default function Dashboard() {
  const { profile } = useAuth()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  // Failed loads are recoverable — the user gets a retry, never an eternal spinner
  const load = useCallback(() => {
    setError(null)
    api('/dashboard').then(setData).catch((e) => setError(describeError(e)))
  }, [])
  useEffect(() => { load() }, [load])

  if (error) return <div className="mx-auto max-w-2xl pt-10"><PageError message={error} onRetry={load} /></div>
  if (!data) return <div className="flex justify-center py-20"><Spinner className="h-7 w-7" /></div>

  const d = data
  const dispRows = DISPOSITIONS
    .map((k) => ({ name: k, count: d.byDisposition[k] || 0 }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count)
  const maxDisp = Math.max(1, ...dispRows.map((r) => r.count))

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <WorldClocks />
      <div>
        <h1 className="text-xl font-bold text-slate-100">
          {data.role === 'admin' ? 'Company Overview' : `Welcome back, ${profile?.name?.split(' ')[0]}`}
        </h1>
        <p className="text-sm text-slate-400">
          {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} — here's your pipeline at a glance.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total leads" value={d.totals.leads} sub={`${d.today.newLeads} new today`} icon={<Users2 size={16} />} />
        <StatCard label="Signed" value={d.totals.signed} accent="text-emerald-400" sub="Signed + Approved" />
        <StatCard label="Approved" value={d.totals.approved} accent="text-emerald-300" />
        <StatCard label="Conversion rate" value={`${d.totals.conversion}%`} accent="text-brand-400" sub="Signed & Approved ÷ all leads" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-200">Last 14 days</h2>
            <div className="flex items-center gap-4 text-xs text-slate-400">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-brand-500/100" /> New leads</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-400" /> Emails sent</span>
            </div>
          </div>
          <Bars data={d.series} />
          <div className="mt-2 flex justify-between text-[10px] text-slate-400">
            <span>{d.series[0]?.day.slice(5)}</span><span>{d.series[d.series.length - 1]?.day.slice(5)}</span>
          </div>
        </div>

        <div className="card p-5">
          <h2 className="mb-4 text-sm font-semibold text-slate-200">Dispositions</h2>
          {dispRows.length === 0 && <p className="py-6 text-center text-sm text-slate-400">No leads yet</p>}
          <div className="space-y-2.5">
            {dispRows.map((r) => (
              <div key={r.name}>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="text-slate-300">{r.name}</span>
                  <span className="font-semibold text-slate-200">{r.count}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
                  <div className="h-full rounded-full bg-brand-500/100" style={{ width: `${(r.count / maxDisp) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200"><PhoneCall size={15} className="text-brand-400" /> Follow-ups due today</h2>
          {d.dueLeads.length === 0 && d.dueTasks.length === 0 && <p className="py-4 text-center text-sm text-slate-400">Nothing due — nice work 🎉</p>}
          <div className="space-y-2">
            {d.dueLeads.map((l) => (
              <Link key={l.id} to={`/leads/${l.id}`} className="flex items-center justify-between rounded-lg border border-slate-800 px-3 py-2 hover:border-brand-500/30 hover:bg-brand-500/10">
                <div>
                  <p className="text-sm font-medium text-slate-200">{leadName(l)}</p>
                  <p className="text-xs text-slate-400">{fmtDateTime(l.next_followup_at)}</p>
                </div>
                <ArrowRight size={14} className="text-slate-300" />
              </Link>
            ))}
            {d.dueTasks.map((t) => (
              <Link key={'t' + t.id} to={t.lead_id ? `/leads/${t.lead_id}` : '/tasks'} className="flex items-center justify-between rounded-lg border border-slate-800 px-3 py-2 hover:border-brand-500/30 hover:bg-brand-500/10">
                <div>
                  <p className="text-sm font-medium text-slate-200">{t.title}</p>
                  <p className="text-xs text-slate-400">{t.type} · {t.leads ? leadName(t.leads) : 'no lead'}{t.due_at ? <span className="block text-[11px]">{t.customer_tz ? dualCallback(t.due_at, t.customer_tz) : fmtDateTime(t.due_at)}</span> : null}</p>
                </div>
                <ArrowRight size={14} className="text-slate-300" />
              </Link>
            ))}
          </div>
        </div>

        <div className="card p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200"><Clock size={15} className="text-brand-400" /> Recent activity</h2>
          {d.recent.length === 0 && <Empty title="No activity yet" />}
          <div className="space-y-2.5">
            {d.recent.map((a) => (
              <Link key={a.id} to={`/leads/${a.lead_id}`} className="block rounded-lg px-2 py-1.5 hover:bg-slate-800/70">
                <p className="text-sm text-slate-200">{a.title}</p>
                <p className="text-[11px] text-slate-400">{a.leads ? leadName(a.leads) : ''} · {fmtDateTime(a.created_at)}</p>
              </Link>
            ))}
          </div>
        </div>

        <div className="card p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200"><Mail size={15} className="text-brand-400" /> Today</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-slate-800/70 p-3 text-center">
              <p className="text-2xl font-bold text-slate-100">{d.today.newLeads}</p>
              <p className="text-xs text-slate-400">New leads</p>
            </div>
            <div className="rounded-lg bg-slate-800/70 p-3 text-center">
              <p className="text-2xl font-bold text-slate-100">{d.today.emailsSent}</p>
              <p className="text-xs text-slate-400">Emails sent</p>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-400">Keep calling — every disposition trains Meta to send you better leads.</p>
        </div>
      </div>

      {d.leaderboard && d.leaderboard.some((r) => r.score > 0) && <Leaderboard rows={d.leaderboard} />}

      {d.team && (
        <div className="card overflow-hidden">
          <div className="border-b border-slate-800 px-5 py-3.5">
            <h2 className="text-sm font-semibold text-slate-200">Team performance</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-800/70">
                <tr>
                  <th className="th">Agent</th><th className="th">Role</th><th className="th">Leads</th>
                  <th className="th">Signed + Approved</th><th className="th">Conversion</th>
                  <th className="th">Emails sent</th><th className="th">Active today</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {d.team.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-800/70/60">
                    <td className="td font-medium text-slate-100">{u.name}</td>
                    <td className="td capitalize text-slate-400">{u.role}</td>
                    <td className="td">{u.leads}</td>
                    <td className="td text-emerald-400 font-medium">{u.signed}</td>
                    <td className="td">{u.conversion}%</td>
                    <td className="td">{u.emailsSent}</td>
                    <td className="td"><span className="inline-flex items-center gap-1.5"><span className={`h-1.5 w-1.5 rounded-full ${u.activeSeconds > 0 ? 'bg-emerald-500/100' : 'bg-slate-300'}`} />{fmtDuration(u.activeSeconds)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {d.attention && d.attention.length > 0 && <AttentionPanel items={d.attention} onDone={load} />}
      {d.targets && (d.targets.calls > 0 || d.targets.dispositions > 0) && <TargetsPanel activity={d.todayActivity} targets={d.targets} />}
    </div>
  )
}

// ── admin: leads going cold — reassign in one click ───────────
function AttentionPanel({ items, onDone }) {
  const toast = useToast()
  const [agents, setAgents] = useState([])
  const [picked, setPicked] = useState({})
  useEffect(() => { api('/users/agents').then((d) => setAgents((d.users || []).filter((u) => u.role === 'agent'))).catch(() => {}) }, [])
  const { run: reassign, busy } = useAction(async (leadId) => {
    if (!picked[leadId]) throw new Error('Pick an agent first')
    await api(`/leads/${leadId}`, { method: 'PATCH', body: { assigned_to: picked[leadId] } })
  }, { toast, successMsg: 'Lead reassigned', onDone })
  const untouched = (l) => Math.floor((Date.now() - new Date(l.last_activity_at || l.created_at).getTime()) / 86400000)
  return (
    <div className="card overflow-hidden border-amber-500/30">
      <div className="flex items-center gap-2 border-b border-amber-100 bg-amber-500/10 px-5 py-3">
        <AlertTriangle size={15} className="text-amber-400" />
        <h2 className="text-sm font-semibold text-amber-200">Needs attention — untouched for 7+ days</h2>
      </div>
      <div className="divide-y divide-slate-800">
        {items.map((l) => (
          <div key={l.id} className="flex flex-wrap items-center gap-2 px-5 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-100">
                <Link className="hover:text-brand-400 hover:underline" to={`/leads/${l.id}`}>{leadName(l)}</Link>
                {'  '}<DispositionBadge value={l.disposition} />
              </p>
              <p className="text-[11px] text-slate-400">{l.profiles?.name || 'unassigned'} · last touched {untouched(l)} days ago</p>
            </div>
            <select className="input w-auto !py-1.5 text-xs" value={picked[l.id] || ''} onChange={(e) => setPicked((p) => ({ ...p, [l.id]: e.target.value }))}>
              <option value="">Reassign to…</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <button className="btn-ghost !py-1.5 text-xs" disabled={busy || !picked[l.id]} onClick={() => reassign(l.id)}>Apply</button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── agent: daily target progress ──────────────────────────────
function TargetsPanel({ activity, targets }) {
  const rows = [
    { label: 'Calls logged today', value: activity?.calls || 0, target: targets.calls },
    { label: 'Dispositions set today', value: activity?.dispositions || 0, target: targets.dispositions },
  ]
  return (
    <div className="card p-5">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200"><Target size={15} className="text-brand-400" /> Daily targets</h2>
      <div className="space-y-3">
        {rows.map((r) => {
          const pct = r.target ? Math.min(100, Math.round((r.value / r.target) * 100)) : 0
          return (
            <div key={r.label}>
              <div className="mb-1 flex justify-between text-xs">
                <span className="text-slate-300">{r.label}</span>
                <span className="font-semibold text-slate-200">{r.value} / {r.target}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                <div className={`h-full rounded-full ${pct >= 100 ? 'bg-emerald-500/100' : 'bg-brand-500/100'}`} style={{ width: `${pct}%` }} />
              </div>
            </div>
          )
        })}
      </div>
      <p className="mt-3 text-xs text-slate-400">{activity?.calls || 0} calls · {activity?.dispositions || 0} dispositions · {activity?.tasksDone || 0} tasks done today. Targets are set by your admin under Automation.</p>
    </div>
  )
}

// ── admin: weekly leaderboard ─────────────────────────────────
function Leaderboard({ rows }) {
  const medal = (i) => (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`)
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-slate-800 px-5 py-3.5">
        <h2 className="text-sm font-semibold text-slate-200">🏆 Weekly leaderboard <span className="ml-1 text-xs font-normal text-slate-400">last 7 days · score = calls + emails + dispositions + 5×signed</span></h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-800/70">
            <tr>
              <th className="th">#</th><th className="th">Agent</th><th className="th">Calls logged</th>
              <th className="th">Dispositions set</th><th className="th">Signed/Approved</th><th className="th">Emails</th><th className="th">Score</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {rows.map((r, i) => (
              <tr key={r.name} className={i === 0 ? 'bg-amber-500/10/60' : ''}>
                <td className="td text-lg">{medal(i)}</td>
                <td className="td font-medium text-slate-100">{r.name}</td>
                <td className="td">{r.calls}</td>
                <td className="td">{r.dispositions}</td>
                <td className="td text-emerald-400 font-medium">{r.signed}</td>
                <td className="td">{r.emails}</td>
                <td className="td font-bold text-brand-300">{r.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
