import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Users2, Trophy, BadgeCheck, Percent, PhoneCall, Mail, Clock, ArrowRight } from 'lucide-react'
import { api } from '../api'
import { useAuth } from '../auth'
import { StatCard, Empty, Bars, fmtDateTime, fmtDuration, leadName, DispositionBadge, Spinner } from '../ui'
import { DISPOSITIONS } from '../config'

export default function Dashboard() {
  const { profile } = useAuth()
  const [data, setData] = useState(null)

  useEffect(() => { api('/dashboard').then(setData).catch(() => {}) }, [])

  if (!data) return <div className="flex justify-center py-20"><Spinner className="h-7 w-7" /></div>

  const d = data
  const dispRows = DISPOSITIONS
    .map((k) => ({ name: k, count: d.byDisposition[k] || 0 }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count)
  const maxDisp = Math.max(1, ...dispRows.map((r) => r.count))

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-800">
          {data.role === 'admin' ? 'Company Overview' : `Welcome back, ${profile?.name?.split(' ')[0]}`}
        </h1>
        <p className="text-sm text-slate-500">
          {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} — here's your pipeline at a glance.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total leads" value={d.totals.leads} sub={`${d.today.newLeads} new today`} icon={<Users2 size={16} />} />
        <StatCard label="Signed" value={d.totals.signed} accent="text-emerald-600" sub="Signed + Approved" />
        <StatCard label="Approved" value={d.totals.approved} accent="text-emerald-700" />
        <StatCard label="Conversion rate" value={`${d.totals.conversion}%`} accent="text-brand-600" sub="Signed & Approved ÷ all leads" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">Last 14 days</h2>
            <div className="flex items-center gap-4 text-xs text-slate-500">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-brand-500" /> New leads</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-400" /> Emails sent</span>
            </div>
          </div>
          <Bars data={d.series} />
          <div className="mt-2 flex justify-between text-[10px] text-slate-400">
            <span>{d.series[0]?.day.slice(5)}</span><span>{d.series[d.series.length - 1]?.day.slice(5)}</span>
          </div>
        </div>

        <div className="card p-5">
          <h2 className="mb-4 text-sm font-semibold text-slate-700">Dispositions</h2>
          {dispRows.length === 0 && <p className="py-6 text-center text-sm text-slate-400">No leads yet</p>}
          <div className="space-y-2.5">
            {dispRows.map((r) => (
              <div key={r.name}>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="text-slate-600">{r.name}</span>
                  <span className="font-semibold text-slate-700">{r.count}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-brand-500" style={{ width: `${(r.count / maxDisp) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700"><PhoneCall size={15} className="text-brand-600" /> Follow-ups due today</h2>
          {d.dueLeads.length === 0 && d.dueTasks.length === 0 && <p className="py-4 text-center text-sm text-slate-400">Nothing due — nice work 🎉</p>}
          <div className="space-y-2">
            {d.dueLeads.map((l) => (
              <Link key={l.id} to={`/leads/${l.id}`} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 hover:border-brand-200 hover:bg-brand-50/40">
                <div>
                  <p className="text-sm font-medium text-slate-700">{leadName(l)}</p>
                  <p className="text-xs text-slate-400">{fmtDateTime(l.next_followup_at)}</p>
                </div>
                <ArrowRight size={14} className="text-slate-300" />
              </Link>
            ))}
            {d.dueTasks.map((t) => (
              <Link key={'t' + t.id} to={t.lead_id ? `/leads/${t.lead_id}` : '/tasks'} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 hover:border-brand-200 hover:bg-brand-50/40">
                <div>
                  <p className="text-sm font-medium text-slate-700">{t.title}</p>
                  <p className="text-xs text-slate-400">{t.type} · {t.leads ? leadName(t.leads) : 'no lead'}</p>
                </div>
                <ArrowRight size={14} className="text-slate-300" />
              </Link>
            ))}
          </div>
        </div>

        <div className="card p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700"><Clock size={15} className="text-brand-600" /> Recent activity</h2>
          {d.recent.length === 0 && <Empty title="No activity yet" />}
          <div className="space-y-2.5">
            {d.recent.map((a) => (
              <Link key={a.id} to={`/leads/${a.lead_id}`} className="block rounded-lg px-2 py-1.5 hover:bg-slate-50">
                <p className="text-sm text-slate-700">{a.title}</p>
                <p className="text-[11px] text-slate-400">{a.leads ? leadName(a.leads) : ''} · {fmtDateTime(a.created_at)}</p>
              </Link>
            ))}
          </div>
        </div>

        <div className="card p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700"><Mail size={15} className="text-brand-600" /> Today</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-slate-50 p-3 text-center">
              <p className="text-2xl font-bold text-slate-800">{d.today.newLeads}</p>
              <p className="text-xs text-slate-500">New leads</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3 text-center">
              <p className="text-2xl font-bold text-slate-800">{d.today.emailsSent}</p>
              <p className="text-xs text-slate-500">Emails sent</p>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-400">Keep calling — every disposition trains Meta to send you better leads.</p>
        </div>
      </div>

      {d.team && (
        <div className="card overflow-hidden">
          <div className="border-b border-slate-100 px-5 py-3.5">
            <h2 className="text-sm font-semibold text-slate-700">Team performance</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Agent</th><th className="th">Role</th><th className="th">Leads</th>
                  <th className="th">Signed + Approved</th><th className="th">Conversion</th>
                  <th className="th">Emails sent</th><th className="th">Active today</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {d.team.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50/60">
                    <td className="td font-medium text-slate-800">{u.name}</td>
                    <td className="td capitalize text-slate-500">{u.role}</td>
                    <td className="td">{u.leads}</td>
                    <td className="td text-emerald-600 font-medium">{u.signed}</td>
                    <td className="td">{u.conversion}%</td>
                    <td className="td">{u.emailsSent}</td>
                    <td className="td"><span className="inline-flex items-center gap-1.5"><span className={`h-1.5 w-1.5 rounded-full ${u.activeSeconds > 0 ? 'bg-emerald-500' : 'bg-slate-300'}`} />{fmtDuration(u.activeSeconds)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
