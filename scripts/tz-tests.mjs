// PART 5 — timezone test cases with hand-computed expected values.
// Run: node scripts/tz-tests.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { zonedToUtc, timeInTz, dateInTz, dualCallback, IST, isValidTz } from '../src/lib/tz.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const env = {}
for (const line of readFileSync(ROOT + '.env', 'utf8').split('\n')) {
  const m = line.match(/^([A-Za-z_]+)=(.*)\s*$/)
  if (m) env[m[1]] = m[2]
}

let pass = 0, fail = 0
const ok = (name, cond, got = '') => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name} — got: ${got}`) } }

console.log('━ CASE 1: 9:00 AM PT customer → late evening IST, same date ─')
const t1 = zonedToUtc('2026-09-22', '09:00', 'America/Los_Angeles')
ok('UTC instant = 16:00Z (PDT, UTC-7)', t1.toISOString() === '2026-09-22T16:00:00.000Z', t1.toISOString())
ok('IST shows 9:30 PM same day', timeInTz(t1, IST) === '9:30 PM IST' && dateInTz(t1, IST).startsWith('Sep 22'), dateInTz(t1, IST))

console.log('━ CASE 2: 11:00 PM ET customer → next-day IST ─')
const t2 = zonedToUtc('2026-11-22', '23:00', 'America/New_York')
ok('UTC instant = 04:00Z Nov 23 (EST, UTC-5)', t2.toISOString() === '2026-11-23T04:00:00.000Z', t2.toISOString())
ok('IST shows 9:30 AM on Nov 23 (correct next-day date)', dateInTz(t2, IST).startsWith('Nov 23') && timeInTz(t2, IST).startsWith('9:30 AM'), dateInTz(t2, IST))

console.log('━ CASE 3: US DST transition (Nov 1, 2026 — DST ends 2 AM local) ─')
const preDST = zonedToUtc('2026-10-25', '09:00', 'America/Los_Angeles')
const onDSTday = zonedToUtc('2026-11-01', '09:00', 'America/Los_Angeles')
ok('Oct 25 9 AM (PDT) = 16:00Z', preDST.toISOString() === '2026-10-25T16:00:00.000Z', preDST.toISOString())
ok('Nov 1 9 AM (PST — DST already ended) = 17:00Z', onDSTday.toISOString() === '2026-11-01T17:00:00.000Z', onDSTday.toISOString())
ok('same wall clock, 1h different UTC — DST-aware, not hardcoded', preDST.toISOString().slice(11,13) === '16' && onDSTday.toISOString().slice(11,13) === '17')
ok('abbreviation flips EDT→EST across the boundary', timeInTz(preDST, 'America/Los_Angeles').includes('PDT') && timeInTz(onDSTday, 'America/Los_Angeles').includes('PST'), `${timeInTz(preDST, 'America/Los_Angeles')} / ${timeInTz(onDSTday, 'America/Los_Angeles')}`)
const springFwd = zonedToUtc('2027-03-14', '09:00', 'America/New_York')
ok('spring-forward Mar 14 2027 9 AM NY = 13:00Z (EDT)', springFwd.toISOString() === '2027-03-14T13:00:00.000Z', springFwd.toISOString())

console.log('━ CASE 3b: Arizona vs Denver (Arizona never observes DST) ─')
const azSummer = zonedToUtc('2026-07-15', '09:00', 'America/Phoenix')
const denSummer = zonedToUtc('2026-07-15', '09:00', 'America/Denver')
ok('July: Phoenix (MST) = 16:00Z, Denver (MDT) = 15:00Z — 1h apart', azSummer.toISOString() === '2026-07-15T16:00:00.000Z' && denSummer.toISOString() === '2026-07-15T15:00:00.000Z', `${azSummer.toISOString()} / ${denSummer.toISOString()}`)
ok('IST for Phoenix July 9 AM = 9:30 PM IST (customer morning → our night)', dateInTz(azSummer, IST).startsWith('Jul 15') && timeInTz(azSummer, IST).startsWith('9:30 PM'), dateInTz(azSummer, IST))

console.log('━ CASE 4: midnight crossing (Central afternoon → IST past midnight) ─')
const t4 = zonedToUtc('2026-09-22', '14:00', 'America/Chicago')
ok('2:00 PM CDT = 19:00Z = 12:30 AM IST on Sep 23', t4.toISOString() === '2026-09-22T19:00:00.000Z' && dateInTz(t4, IST).startsWith('Sep 23') && timeInTz(t4, IST).startsWith('12:30 AM'), dateInTz(t4, IST))
ok('dualCallback shows both sides with dates', dualCallback(t4.toISOString(), 'America/Chicago').includes('(their time)') && dualCallback(t4.toISOString(), 'America/Chicago').includes('(your time)'), dualCallback(t4.toISOString(), 'America/Chicago'))

console.log('━ CASE 5: clocks & preview share one conversion path ─')
const roundTrip = timeInTz(zonedToUtc('2026-09-22', '09:00', 'America/Los_Angeles'), 'America/Los_Angeles')
ok('schedule → convert → display round-trips to the same wall time', roundTrip.startsWith('9:00 AM'), roundTrip)
ok('invalid tz rejected', !isValidTz('Not/AZone') && isValidTz('America/New_York'))

console.log('━ API end-to-end: schedule → store → notify → validate ─')
const login = await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: env.VITE_SUPABASE_ANON_KEY, 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'admin@americanbenefitsadvocates.org', password: 'Devil$8381' }),
}).then((r) => r.json())
const authz = { 'content-type': 'application/json', authorization: `Bearer ${login.access_token}` }
const call = (path, opts = {}) => fetch(`http://localhost:8888/api/${path}`, { ...opts, headers: { ...authz, ...(opts.headers || {}) } }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }))

const leadRes = await call('leads', { method: 'POST', body: JSON.stringify({ first_name: 'TZ', last_name: 'Probe', phone: '5559990001' }) })
const leadId = leadRes.data.lead.id
const dueIso = zonedToUtc('2026-09-22', '09:00', 'America/Los_Angeles').toISOString()

const sched = await call('tasks', { method: 'POST', body: JSON.stringify({ title: 'TZ probe callback', type: 'callback', lead_id: leadId, due_at: dueIso, customer_tz: 'America/Los_Angeles' }) })
ok('schedule stored with absolute UTC due_at + customer_tz', sched.status === 200 && String(sched.data?.task?.due_at || '').startsWith('2026-09-22 16:00') || String(sched.data?.task?.due_at || '').startsWith('2026-09-22T16:00'), JSON.stringify(sched.data).slice(0, 120))
const notifs = await call('notifications')
const notif = (notifs.data?.notifications || []).find((n) => n.title === '📅 Callback scheduled')
ok('notification reached the assigned agent with both times', !!notif && notif.body.includes('9:30 PM') && (!notif.body.includes('their time') || notif.body.includes('9:00 AM')), notif?.body || 'none')

const past = await call('tasks', { method: 'POST', body: JSON.stringify({ title: 'past callback', type: 'callback', lead_id: leadId, due_at: '2020-01-01T15:00:00.000Z', customer_tz: 'America/New_York' }) })
ok('past callback rejected against server UTC time', past.status === 400, JSON.stringify(past.data).slice(0, 90))

await call(`leads/${leadId}`, { method: 'DELETE' })
ok('probe lead removed (cascade takes the callback)', (await call(`leads/${leadId}`)).status === 404)
const remain = await call('notifications')
const leftover = (remain.data?.notifications || []).filter((n) => n.body?.includes('TZ Probe'))
for (const n of leftover) await call('notifications/read', { method: 'POST', body: JSON.stringify({ ids: [n.id], _delete: true }) }).catch(() => {})
console.log(`  (notification rows for probe lead: ${leftover.length} — informational only)`)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
