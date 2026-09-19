import { useEffect, useState } from 'react'
import { Zap, HardDrive, Copy, RefreshCw, CheckCircle2, XCircle, Loader2, Table2 } from 'lucide-react'
import { api, describeError } from '../api'
import { useAction } from '../lib/hooks'
import { useToast, Spinner } from '../ui'

export default function Integrations() {
  const toast = useToast()
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <h1 className="text-xl font-bold text-slate-800">Integrations</h1>
      <MetaCard />
      <DriveCard />
      <SheetsCard />
    </div>
  )
}

// ── Google Sheets auto-import ─────────────────────────────────
export function SheetsCard() {
  const toast = useToast()
  const [f, setF] = useState(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const { run: importNow, busy: importing } = useAction(async () => {
    setResult(null)
    const r = await api('/sheets/import', { method: 'POST' })
    setResult(r)
    return `Imported ${r.imported} lead(s) — ${r.duplicates} duplicate(s) skipped`
  }, { toast })

  useEffect(() => { api('/settings/sheets').then((d) => setF(d)).catch((e) => toast(describeError(e), 'error')) }, [])

  const save = async () => {
    setBusy(true)
    try {
      await api('/settings/sheets', { method: 'PUT', body: { sheet_url: f.sheet_url, gid: f.gid, auto_import: !!f.auto_import } })
      toast('Google Sheet settings saved')
    } catch (e) { toast(describeError(e), 'error') } finally { setBusy(false) }
  }

  return (
    <div className="card p-6">
      <div className="mb-4 flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-green-700 text-white"><Table2 size={18} /></div>
        <div>
          <h2 className="text-sm font-bold text-slate-800">Google Sheets — auto-import leads</h2>
          <p className="text-xs text-slate-500">Pulls new rows from your sheet into the CRM as unassigned leads.</p>
        </div>
      </div>
      {!f ? <Spinner className="h-5 w-5" /> : (
        <>
          <div className="mb-4 space-y-2 rounded-xl bg-slate-50 p-4 text-xs leading-relaxed text-slate-600">
            <p>1. Finish the <b>Google Drive</b> setup below first — this reuses the same service account.</p>
            <p>2. In Google Sheets → <b>Share</b> your lead sheet with the service account email (Viewer is enough).</p>
            <p>3. First row must be headers — columns auto-map: First name, Last name, Email, Phone, DOB, State, City, Address, ZIP, Disability, Notes. Duplicates (by phone/email) are skipped automatically.</p>
          </div>
          <div className="space-y-3">
            <div><label className="label">Sheet URL (copy from the browser address bar)</label>
              <input className="input" value={f.sheet_url || ''} onChange={(e) => setF({ ...f, sheet_url: e.target.value })} placeholder="https://docs.google.com/spreadsheets/d/…" />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div><label className="label">Tab gid (optional — from the URL after #gid=)</label>
                <input className="input" value={f.gid || ''} onChange={(e) => setF({ ...f, gid: e.target.value })} placeholder="0" />
              </div>
              <div><label className="label">If a lead already exists</label>
                <select className="input" value={f.dup_policy || 'skip'} onChange={(e) => setF({ ...f, dup_policy: e.target.value })}>
                  <option value="skip">Skip it</option>
                  <option value="update">Update it with the new info</option>
                </select>
              </div>
            </div>
            <label className="flex items-center gap-2.5 text-sm">
              <input type="checkbox" checked={!!f.auto_import} onChange={(e) => setF({ ...f, auto_import: e.target.checked })} className="h-4 w-4 rounded border-slate-300" />
              Auto-import every 10 minutes
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn-primary" onClick={save} disabled={busy}>Save settings</button>
              <button className="btn-ghost" onClick={importNow} disabled={importing}>{importing ? 'Importing…' : 'Import now'}</button>
            </div>
            {result && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">✅ {result.imported} imported · {result.updated} updated · {result.duplicates} duplicate(s)</p>}
            {f.push_token && (
              <div className="space-y-2 rounded-xl border border-brand-200 bg-brand-50/60 p-4 text-xs leading-relaxed text-slate-700">
                <p className="text-sm font-bold text-slate-800">⚡ Instant push — leads arrive in seconds</p>
                <p>1. In your Google Sheet: <b>Extensions → Apps Script</b> → paste the code below (the CRM URL and token are already filled).</p>
                <p>2. Click <b>Triggers → Add Trigger</b> → function <code>onFormSubmit</code> → event source <b>From spreadsheet</b> → event type <b>On form submit</b> → Save. Approve the permissions once.</p>
                <div className="relative">
                  <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 pr-10 text-[11px] text-emerald-200">{`function onFormSubmit(e) {
  var row = {};
  if (e.namedValues) { for (var k in e.namedValues) row[k] = e.namedValues[k][0]; }
  else { (e.values || []).forEach(function (v, i) { row['col' + i] = v; }); }
  UrlFetchApp.fetch('${window.location.origin}/api/sheets/push?token=${f.push_token}', { method: 'post', contentType: 'application/json', payload: JSON.stringify(row) });
}`}</pre>
                  <button
                    className="absolute right-2 top-2 rounded-md bg-white/10 p-1.5 text-white hover:bg-white/20"
                    title="Copy Apps Script"
                    onClick={() => navigator.clipboard.writeText(`function onFormSubmit(e) {\n  var row = {};\n  if (e.namedValues) { for (var k in e.namedValues) row[k] = e.namedValues[k][0]; }\n  else { (e.values || []).forEach(function (v, i) { row['col' + i] = v; }); }\n  UrlFetchApp.fetch('${window.location.origin}/api/sheets/push?token=${f.push_token}', { method: 'post', contentType: 'application/json', payload: JSON.stringify(row) });\n}`).then(() => toast('Apps Script copied — paste it in your sheet')).catch(() => {})}
                  ><Copy size={13} /></button>
                </div>
                <p>If your sheet is filled manually (not via Google Forms), run the function once from the editor with a quick trigger setup: Apps Script → add the same code in a function named <code>importAll</code> reading rows — or just use the 10-minute auto-import.</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export function MetaCard() {
  const toast = useToast()
  const [s, setS] = useState(null)
  const [form, setForm] = useState({})
  const [busy, setBusy] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [syncResult, setSyncResult] = useState(null)

  const load = () => api('/meta/settings').then((d) => { setS(d); setForm({ pixel_id: d.pixel_id, page_id: d.page_id, test_event_code: d.test_event_code, capi_token: '', page_token: '', app_secret: '' }) }).catch((e) => toast(e.message, 'error'))
  useEffect(() => { load() }, [])

  if (!s) return <div className="card flex justify-center py-16"><Spinner className="h-7 w-7" /></div>

  const save = async () => {
    setBusy(true)
    try {
      const body = { pixel_id: form.pixel_id, page_id: form.page_id, test_event_code: form.test_event_code }
      if (form.capi_token) body.capi_token = form.capi_token
      if (form.page_token) body.page_token = form.page_token
      if (form.app_secret) body.app_secret = form.app_secret
      await api('/meta/settings', { method: 'PUT', body })
      toast('Meta settings saved')
      load()
    } catch (e) { toast(describeError(e), 'error') } finally { setBusy(false) }
  }
  // CAPI test event + manual backfill — both single-flight with busy feedback
  const { run: test, busy: testing } = useAction(async () => {
    const r = await api('/meta/test', { method: 'POST' })
    setTestResult(r)
    if (r?.success) return 'Test event delivered — check Events Manager.'
    if (r?.skipped) throw new Error('Meta isn’t configured yet — save a Pixel ID and CAPI token first.')
    throw new Error('Meta rejected the test event — double-check the Pixel ID and token. See the response below.')
  }, { toast })

  const { run: sync, busy: syncing } = useAction(async () => {
    setSyncResult('syncing')
    try {
      const r = await api('/meta/sync', { method: 'POST' })
      setSyncResult(r)
      return `Sync done — ${r.processed} imported, ${r.skipped} already in CRM`
    } catch (e) {
      setSyncResult({ error: e.message })
      throw e
    }
  }, { toast })
  const Dot = ({ ok, label }) => (
    <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
      {ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />} {label}
    </span>
  )

  return (
    <div className="card p-6">
      <div className="mb-4 flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-white"><Zap size={18} /></div>
        <div>
          <h2 className="text-sm font-bold text-slate-800">Meta (Facebook) Ads</h2>
          <p className="text-xs text-slate-500">Receive instant-form leads + send lead-quality signals back so Meta optimizes.</p>
        </div>
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <Dot ok={s.has_capi_token} label="Conversions API token" />
        <Dot ok={s.has_page_token} label="Page access token" />
        <Dot ok={!!s.pixel_id} label="Pixel ID" />
        <Dot ok={!!s.verify_token} label="Webhook verify token (env)" />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div><label className="label">Pixel ID</label><input className="input" value={form.pixel_id || ''} onChange={(e) => setForm({ ...form, pixel_id: e.target.value })} /></div>
        <div><label className="label">Page ID</label><input className="input" value={form.page_id || ''} onChange={(e) => setForm({ ...form, page_id: e.target.value })} /></div>
        <div><label className="label">CAPI access token {s.has_capi_token && '(saved — blank = keep)'}</label><input className="input" type="password" value={form.capi_token} onChange={(e) => setForm({ ...form, capi_token: e.target.value })} /></div>
        <div><label className="label">Page access token {s.has_page_token && '(saved — blank = keep)'}</label><input className="input" type="password" value={form.page_token} onChange={(e) => setForm({ ...form, page_token: e.target.value })} /></div>
        <div><label className="label">App secret {s.has_app_secret && '(saved — blank = keep)'}</label><input className="input" type="password" value={form.app_secret} onChange={(e) => setForm({ ...form, app_secret: e.target.value })} /></div>
        <div><label className="label">Test event code (optional, from Events Manager)</label><input className="input" value={form.test_event_code || ''} onChange={(e) => setForm({ ...form, test_event_code: e.target.value })} /></div>
      </div>

      <div className="mt-4 rounded-xl bg-slate-50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Webhook URL (paste into Meta → Webhooks → Page → Leadgen)</p>
        <div className="mt-1.5 flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg bg-white px-3 py-2 text-xs text-slate-700 ring-1 ring-slate-200">{s.webhook_url}</code>
          <button className="btn-ghost !px-2.5 !py-1.5" onClick={() => { navigator.clipboard.writeText(s.webhook_url); toast('Webhook URL copied') }}><Copy size={13} /></button>
        </div>
        {s.verify_token && <p className="mt-1.5 text-[11px] text-slate-400">Verify token: <code>{s.verify_token}</code> (set in Netlify env as META_VERIFY_TOKEN)</p>}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button>
        <button className="btn-ghost" onClick={test} disabled={testing}>{testing ? <Loader2 size={14} className="animate-spin" /> : null} Send CAPI test event</button>
        <button className="btn-ghost" onClick={sync} disabled={syncing}>{syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Sync existing form leads</button>
      </div>
      {testResult && (
        <pre className="mt-3 max-h-32 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] text-slate-200">{JSON.stringify(testResult, null, 2)}</pre>
      )}
      {syncResult && syncResult !== 'syncing' && (
        <p className="mt-2 text-xs text-slate-500">{syncResult.error ? `Sync failed: ${syncResult.error}` : `Sync done — ${syncResult.processed} imported, ${syncResult.skipped} already in CRM`}</p>
      )}
      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-relaxed text-amber-800">
        <b>How quality signals work:</b> when an agent sets a disposition, ABA sends <code>Lead_Qualified</code> to Meta for <b>Signed/Approved</b>, and <code>Lead_Disqualified</code> with the reason for <b>Criteria Not Met</b> (age, work history, already receiving benefits…). Events Manager → Events → your pixel shows them as custom events. Tip: also switch your instant forms to "Higher intent" and add a Date of Birth question — that alone filters a big share of bad age leads.
      </div>
    </div>
  )
}

export function DriveCard() {
  const toast = useToast()
  const [s, setS] = useState(null)
  const [form, setForm] = useState({ service_account_json: '', root_folder_id: '' })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api('/drive/settings').then((d) => {
      setS(d)
      setForm({ service_account_json: '', root_folder_id: d.root_folder_id || '' })
    }).catch((e) => toast(e.message, 'error'))
  }, [])

  if (!s) return <div className="card flex justify-center py-16"><Spinner className="h-7 w-7" /></div>

  const save = async () => {
    setBusy(true)
    try {
      const body = { root_folder_id: form.root_folder_id }
      if (form.service_account_json.trim()) body.service_account_json = form.service_account_json
      await api('/drive/settings', { method: 'PUT', body })
      toast('Google Drive settings saved')
      const d = await api('/drive/settings')
      setS(d)
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }

  return (
    <div className="card p-6">
      <div className="mb-4 flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600 text-white"><HardDrive size={18} /></div>
        <div>
          <h2 className="text-sm font-bold text-slate-800">Google Drive — recordings storage</h2>
          <p className="text-xs text-slate-500">Front-end & verification recordings upload straight into organized Drive folders.</p>
        </div>
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${s.configured ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
          {s.configured ? <CheckCircle2 size={13} /> : <XCircle size={13} />} {s.configured ? 'Connected' : 'Not configured'}
        </span>
        {s.configured && s.service_account_email && <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600">Service account: {s.service_account_email}</span>}
      </div>
      <div className="mb-4 space-y-2 rounded-xl bg-slate-50 p-4 text-xs leading-relaxed text-slate-600">
        <p className="font-semibold text-slate-700">One-time setup (~10 min):</p>
        <p>1. Go to <b>console.cloud.google.com</b> → create a project → enable the <b>Google Drive API</b>.</p>
        <p>2. IAM &amp; Admin → Service Accounts → <b>Create service account</b> (no special roles needed) → Keys → <b>Add key → JSON</b>. Download the JSON.</p>
        <p>3. In Google Drive, create a folder like <b>"CRM Recordings"</b> → Share it with the service account's email (found in the JSON) as <b>Editor</b>.</p>
        <p>4. Paste the folder ID (the part after <code>/folders/</code> in its URL) and the JSON below.</p>
        <p>Recordings will be filed as: <i>CRM Recordings → Agent name → Lead name → Front-End – Lead – date.mp3</i></p>
      </div>
      <div className="space-y-3">
        <div><label className="label">Root folder ID</label><input className="input" value={form.root_folder_id} onChange={(e) => setForm({ ...form, root_folder_id: e.target.value })} placeholder="1AbC..." /></div>
        <div>
          <label className="label">Service account JSON {s.configured && '(saved — paste to replace)'}</label>
          <textarea className="input font-mono text-xs" rows={5} value={form.service_account_json} onChange={(e) => setForm({ ...form, service_account_json: e.target.value })} placeholder='{"type": "service_account", "project_id": "...", ...}' />
        </div>
        <button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save Drive settings'}</button>
      </div>
    </div>
  )
}
