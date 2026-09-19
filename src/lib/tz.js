// Timezone engine — built entirely on Intl.DateTimeFormat with IANA zone ids,
// so every conversion is date-aware (DST handled by the tz database, never by
// hardcoded offsets). India is fixed-offset but we still convert via Intl.
export const IST = 'Asia/Kolkata'

export const US_ZONES = [
  { tz: 'America/New_York', label: 'Eastern (ET)' },
  { tz: 'America/Chicago', label: 'Central (CT)' },
  { tz: 'America/Denver', label: 'Mountain (MT)' },
  { tz: 'America/Phoenix', label: 'Arizona (MST — no DST)' },
  { tz: 'America/Los_Angeles', label: 'Pacific (PT)' },
]

export const SCHED_ZONES = [
  ...US_ZONES,
  { tz: 'Asia/Kolkata', label: 'India (IST)' },
  { tz: 'UTC', label: 'UTC' },
]

// Offset (ms) that `tz` was ahead of UTC at the given instant.
export function tzOffsetMs(date, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const map = {}
  for (const p of dtf.formatToParts(date)) map[p.type] = p.value
  const asUTC = Date.UTC(+map.year, +map.month - 1, +map.day, +map.hour % 24, +map.minute, +map.second)
  return asUTC - date.getTime()
}

// Convert a wall-clock time in `tz` ("2026-09-22", "14:30") to an absolute
// UTC Date. Two-pass so the offset is computed AT the target instant —
// this is what makes DST transitions land correctly.
export function zonedToUtc(dateStr, timeStr, tz) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const [hh, mm] = timeStr.split(':').map(Number)
  const naiveAsUtc = Date.UTC(y, m - 1, d, hh || 0, mm || 0)
  const off1 = tzOffsetMs(new Date(naiveAsUtc), tz)
  const off2 = tzOffsetMs(new Date(naiveAsUtc - off1), tz)
  return new Date(naiveAsUtc - off2)
}

// "3:00 PM" / "3:00 PM EDT" — the zone abbreviation at that instant (EDT vs EST).
export function timeInTz(date, tz, { seconds = false } = {}) {
  const t = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true, ...(seconds ? { second: '2-digit' } : {}),
  }).format(date)
  const abbr = tzAbbr(date, tz)
  return abbr ? `${t} ${abbr}` : t
}

export function tzAbbr(date, tz) {
  if (tz === 'Asia/Kolkata') return 'IST' // Node ICU renders GMT+5:30; agents say IST
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(date)
  return parts.find((p) => p.type === 'timeZoneName')?.value || ''
}

// "Sept 22, 3:00 PM EDT" — date + time together (dates can differ across zones).
export function dateInTz(date, tz) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(date) + ' ' + tzAbbr(date, tz)
}

export function dayInTz(date, tz) {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric', weekday: 'short' }).format(date)
}

// The dual display used everywhere a scheduled callback appears:
// "Sept 22, 3:00 PM EDT (their time) · Sept 23, 12:30 AM IST (your time)"
export function dualCallback(dueIso, customerTz) {
  const due = new Date(dueIso)
  const theirs = dateInTz(due, customerTz) + ' (their time)'
  const mine = dateInTz(due, IST) + ' (your time)'
  return customerTz && customerTz !== IST ? `${theirs} · ${mine}` : `${mine} (your time)`
}

// Server-notification text: IST first (our working clock), customer time second.
export function callbackNotifyText(leadName, dueIso, customerTz) {
  const due = new Date(dueIso)
  const mine = `${dateInTz(due, IST)} IST (your time)`
  const theirs = customerTz && customerTz !== IST ? ` — ${timeInTz(due, customerTz)} their time` : ''
  return `Callback with ${leadName} at ${mine}${theirs}`
}

export function isValidTz(tz) {
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true } catch { return false }
}
