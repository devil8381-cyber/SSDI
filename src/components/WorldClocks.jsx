// Live world clocks for the home page: the four US customer zones + our IST.
// Time source = OUR SERVER (GET /api/time), synced on load and every 5 min;
// between syncs the clocks tick client-side from that baseline, so a wrong
// device clock can never show a wrong time. Fully isolated component state —
// ticking never re-renders anything else on the page.
import { useEffect, useState } from 'react'
import { api } from '../api'
import { IST, US_ZONES, timeInTz, dayInTz } from '../lib/tz'

const ZONES = [...US_ZONES.map((z) => ({ ...z, short: z.label.split(' ')[0] })), { tz: IST, label: 'India (IST) — you', short: 'IST' }]

export default function WorldClocks() {
  const [skew, setSkew] = useState(null) // serverNow - Date.now() at sync moment
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    let alive = true
    const sync = async () => {
      try {
        const t0 = Date.now()
        const d = await api('/time')
        if (!alive) return
        const rtt = (Date.now() - t0) / 2
        setSkew(new Date(d.now).getTime() + rtt - Date.now())
      } catch { /* clocks keep ticking on the last good baseline */ }
    }
    sync()
    const syncIv = setInterval(sync, 5 * 60000)
    const tick = setInterval(() => setNow(new Date()), 1000)
    return () => { alive = false; clearInterval(syncIv); clearInterval(tick) }
  }, [])

  const serverNow = new Date(Date.now() + (skew || 0))

  return (
    <div className="card p-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {ZONES.map((z) => (
          <div key={z.tz} className={`rounded-xl border p-3 ${z.tz === IST ? 'border-brand-500/40 bg-brand-500/10' : 'border-slate-800 bg-slate-800/40'}`}>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{z.label}</p>
            <p className={`mt-0.5 font-mono text-lg font-semibold tabular-nums ${z.tz === IST ? 'text-brand-300' : 'text-slate-100'}`}>
              {timeInTz(serverNow, z.tz, { seconds: true })}
            </p>
            <p className="text-[11px] text-slate-500">{dayInTz(serverNow, z.tz)}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
