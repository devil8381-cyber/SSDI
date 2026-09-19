// Scheduled: pulls new leads from the configured Google Sheet every 10 minutes
// (when auto-import is enabled) and imports them as unassigned.
import { getSetting, syncGoogleSheet, notify, adminIds } from './api/_lib.mjs'

export default async () => {
  const cfg = (await getSetting('sheets')) || {}
  if (!cfg.auto_import || !cfg.sheet_url) return { skipped: true }
  try {
    const r = await syncGoogleSheet()
    if (r.imported > 0) await notify(await adminIds(), `${r.imported} leads imported from Google Sheet`, `${r.duplicates} duplicate(s) skipped — assign them from the Leads page`)
    return r
  } catch (e) {
    console.error('sheets sync failed:', e.message)
    return { error: e.message }
  }
}

export const config = {
  schedule: '*/10 * * * *',
}
