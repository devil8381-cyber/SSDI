import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Papa from 'papaparse'
import { Search, Plus, Upload, Download, UserPlus, ChevronLeft, ChevronRight, Users2 } from 'lucide-react'
import { api, describeError } from '../api'
import { useAuth } from '../auth'
import { getCallHref } from '../lib/call'
import { useDebounced, useLatestRequest, useAction } from '../lib/hooks'
import { validateForm, required, emailRule, phoneRule, sanitizeText } from '../lib/validate'
import { useToast, Modal, DispositionBadge, Empty, Spinner, PageError, ageFrom, leadName, fmtDate } from '../ui'
import { DISPOSITIONS, CRITERIA_REASONS, STATES } from '../config'

const CANON = [
  ['first_name', 'First name'], ['last_name', 'Last name'], ['email', 'Email'], ['phone', 'Phone'],
  ['dob', 'Date of birth'], ['state', 'State'], ['city', 'City'],
  ['worked_5_of_10', 'Worked 5 of 10 years'], ['receiving_benefits', 'Receiving benefits'],
  ['duration_12m', 'Disability 12+ months'], ['has_attorney', 'Has attorney'], ['disability', 'Disability'],
  ['notes', 'Notes'], ['campaign', 'Campaign'],
]
const norm = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '')

function guessMap(headers) {
  const map = {}
  for (const [field, label] of CANON) {
    const target = norm(label)
    const found = headers.find((h) => norm(h) === target || norm(h).includes(target.replace(/[^a-z0-9]/g, '').slice(0, 6)))
    if (found) map[field] = found
  }
  if (!map.first_name && headers.includes('name')) map.first_name = 'name'
  if (!map.phone) { const h = headers.find((x) => /phone|mobile|cell/i.test(x)); if (h) map.phone = h }
  if (!map.email) { const h = headers.find((x) => /email|mail/i.test(x)); if (h) map.email = h }
  return map
}

const PAGE_SIZE = 50
const MAX_IMPORT_ROWS = 10000

export default function Leads() {
  const { profile } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const admin = profile?.role === 'admin'

  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [agents, setAgents] = useState([])
  const [selected, setSelected] = useState(new Set())

  const [qInput, setQInput] = useState('')
  const q = useDebounced(qInput, 350) // debounced so typing never spams the API
  const [disposition, setDisposition] = useState('all')
  const [assigned, setAssigned] = useState('all')
  const [source, setSource] = useState('all')
  const [createdAfter, setCreatedAfter] = useState('')

  const [showImport, setShowImport] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [assignTo, setAssignTo] = useState('')

  const req = useLatestRequest()

  const queryFor = useCallback((pg, limit) => {
    const p = new URLSearchParams({ page: String(pg), limit: String(limit) })
    if (q) p.set('q', q)
    if (disposition !== 'all') p.set('disposition', disposition)
    if (assigned !== 'all') p.set('assigned', assigned)
    if (source !== 'all') p.set('source', source)
    if (createdAfter) p.set('created_after', createdAfter)
    return p
  }, [q, disposition, assigned, source, createdAfter])

  const load = useCallback(async () => {
    const reqId = req.next() // tag this request; stale responses get discarded below
    setLoading(true)
    setLoadError(null)
    try {
      const d = await api(`/leads?${queryFor(page, PAGE_SIZE)}`)
      if (!req.isCurrent(reqId)) return
      setRows(d.rows || [])
      setTotal(d.total || 0)
      setSelected(new Set())
    } catch (e) {
      if (!req.isCurrent(reqId)) return
      setLoadError(describeError(e))
    } finally {
      if (req.isCurrent(reqId)) setLoading(false)
    }
  }, [queryFor, page, req])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (admin) api('/users/agents').then((d) => setAgents(d.users || [])).catch(() => {}) }, [admin])
  useEffect(() => { setPage(1) }, [q, disposition, assigned, source, createdAfter])

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id))
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.id)))
  const toggle = (id) => setSelected((s) => {
    const n = new Set(s)
    if (n.has(id)) n.delete(id); else n.add(id)
    return n
  })

  // Bulk assign — busy-guarded so double-clicks can't fire duplicate calls
  const { run: bulkAssign, busy: assigning } = useAction(async () => {
    if (!assignTo || !selected.size) return
    await api('/leads/assign', { method: 'POST', body: { ids: [...selected], agent_id: assignTo === 'unassigned' ? null : assignTo } })
  }, { toast, successMsg: (r) => `${r?.count ?? selected.size} lead(s) assigned`, onDone: load })

  // Bulk disposition — the floor manager's fastest lever
  const [bulkDisp, setBulkDisp] = useState('')
  const [bulkReason, setBulkReason] = useState('')
  const { run: bulkDisposition, busy: dispositioning } = useAction(async () => {
    if (!bulkDisp || !selected.size) return
    await api('/leads/bulk-disposition', { method: 'POST', body: { ids: [...selected], disposition: bulkDisp, reason: bulkReason || null } })
  }, { toast, successMsg: (r) => `${r?.count ?? 0} lead(s) → ${bulkDisp}`, onDone: () => { setBulkDisp(''); setBulkReason('') } })

  // Inline quick-disposition straight from the table row
  const [quickId, setQuickId] = useState(null)
  const { run: quickDisposition } = useAction(async (lead, value) => {
    setRows((rs) => rs.map((x) => (x.id === lead.id ? { ...x, disposition: value, disposition_reason: value === 'Criteria Not Met' ? lead.disposition_reason : null } : x))) // optimistic
    try {
      await api(`/leads/${lead.id}`, { method: 'PATCH', body: { disposition: value, disposition_reason: value === 'Criteria Not Met' ? (lead.disposition_reason || null) : null } })
    } catch (e) {
      load() // rollback to server truth
      throw e
    }
  }, { toast, successMsg: 'Disposition updated' })

  // CSV export walks every page of the current filter; busy state + single flight
  const { run: exportCsv, busy: exporting } = useAction(async () => {
    const first = await api(`/leads?${queryFor(1, 200)}`)
    let all = first.rows || []
    const totalPages = Math.ceil((first.total || 0) / 200)
    for (let pg = 2; pg <= totalPages; pg++) {
      const d = await api(`/leads?${queryFor(pg, 200)}`)
      all = all.concat(d.rows || [])
    }
    if (!all.length) throw new Error('No leads match the current filters — nothing to export.')
    const csv = Papa.unparse(all.map((r) => ({
      first_name: r.first_name, last_name: r.last_name, email: r.email || '', phone: r.phone || '',
      dob: r.dob || '', age: ageFrom(r.dob) ?? '', state: r.state || '', city: r.city || '',
      disposition: r.disposition, reason: r.disposition_reason || '', source: r.source,
      agent: r.profiles?.name || '', created: r.created_at, notes: r.notes || '',
    })))
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    return all.length
  }, { toast, successMsg: (n) => `Exported ${n} leads to CSV` })

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-800">Leads <span className="text-sm font-medium text-slate-400">({total})</span></h1>
        <div className="flex flex-wrap gap-2">
          {admin && <button className="btn-ghost" onClick={() => setShowImport(true)}><Upload size={15} /> Import CSV</button>}
          <button className="btn-ghost" onClick={exportCsv} disabled={exporting}>
            {exporting ? <Spinner className="h-4 w-4" /> : <Download size={15} />} Export
          </button>
          <button className="btn-primary" onClick={() => setShowAdd(true)}><Plus size={15} /> Add lead</button>
        </div>
      </div>

      <div className="card flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-[180px] flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Search name, phone, email, city…" value={qInput} onChange={(e) => setQInput(e.target.value)} />
        </div>
        <select className="input w-auto" value={disposition} onChange={(e) => setDisposition(e.target.value)}>
          <option value="all">All dispositions</option>
          {DISPOSITIONS.map((d) => <option key={d}>{d}</option>)}
        </select>
        <select className="input w-auto" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="all">All sources</option>
          <option value="meta">Meta</option><option value="import">Import</option><option value="manual">Manual</option>
        </select>
        {admin && (
          <select className="input w-auto" value={assigned} onChange={(e) => setAssigned(e.target.value)}>
            <option value="all">All agents</option>
            <option value="unassigned">Unassigned</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
        <select className="input w-auto" value={createdAfter} onChange={(e) => setCreatedAfter(e.target.value)}>
          <option value="">All time</option>
          <option value={new Date(Date.now() - 86400000).toISOString()}>Last 24h</option>
          <option value={new Date(Date.now() - 7 * 86400000).toISOString()}>Last 7 days</option>
          <option value={new Date(Date.now() - 30 * 86400000).toISOString()}>Last 30 days</option>
        </select>
      </div>

      {selected.size > 0 && (
        <div className="card flex flex-wrap items-center gap-3 border-brand-200 bg-brand-50/60 p-3">
          <span className="text-sm font-medium text-brand-800">{selected.size} selected</span>
          {admin && (
            <>
              <UserPlus size={15} className="text-brand-600" />
              <select className="input w-auto" value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
                <option value="">Assign to…</option>
                <option value="unassigned">Unassigned (back to pool)</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <button className="btn-primary" onClick={bulkAssign} disabled={!assignTo || assigning}>{assigning ? 'Assigning…' : 'Assign'}</button>
              <span className="h-5 w-px bg-brand-200" />
            </>
          )}
          <select className="input w-auto" value={bulkDisp} onChange={(e) => setBulkDisp(e.target.value)}>
            <option value="">Set disposition…</option>
            {DISPOSITIONS.map((d) => <option key={d}>{d}</option>)}
          </select>
          {bulkDisp === 'Criteria Not Met' && (
            <select className="input w-auto" value={bulkReason} onChange={(e) => setBulkReason(e.target.value)}>
              <option value="">Reason…</option>
              {CRITERIA_REASONS.map((r) => <option key={r}>{r}</option>)}
            </select>
          )}
          <button className="btn-primary" onClick={bulkDisposition} disabled={!bulkDisp || dispositioning}>{dispositioning ? 'Updating…' : 'Apply disposition'}</button>
        </div>
      )}

      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16"><Spinner className="h-7 w-7" /></div>
        ) : loadError ? (
          <PageError message={loadError} onRetry={load} />
        ) : rows.length === 0 ? (
          <Empty icon={Users2} title="No leads found" hint={admin ? 'Import a CSV or add leads manually' : 'Your admin will assign you leads soon'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  {admin && <th className="th w-8"><input type="checkbox" checked={allChecked} onChange={toggleAll} className="h-4 w-4 rounded border-slate-300" /></th>}
                  <th className="th">Lead</th><th className="th">Phone</th><th className="th">Age</th>
                  <th className="th">Disposition</th><th className="th">Source</th>
                  {admin && <th className="th">Agent</th>}
                  <th className="th">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const age = ageFrom(r.dob)
                  return (
                    <tr key={r.id} className="cursor-pointer hover:bg-brand-50/40" onClick={() => navigate(`/leads/${r.id}`)}>
                      {admin && (
                        <td className="td" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} className="h-4 w-4 rounded border-slate-300" />
                        </td>
                      )}
                      <td className="td">
                        <p className="font-medium text-slate-800">
                          <span
                            className={`mr-1.5 inline-block h-2 w-2 rounded-full align-middle ${
                              (() => {
                                // aging dot: how long since anyone touched this lead
                                const days = Math.floor((Date.now() - new Date(r.last_activity_at || r.created_at).getTime()) / 86400000)
                                return days <= 3 ? 'bg-emerald-500' : days <= 7 ? 'bg-amber-400' : 'bg-rose-500'
                              })()
                            }`}
                            title={`Last touched ${Math.floor((Date.now() - new Date(r.last_activity_at || r.created_at).getTime()) / 86400000)} day(s) ago`}
                          />
                          {leadName(r)}
                        </p>
                        <p className="text-xs text-slate-400">{[r.city, r.state].filter(Boolean).join(', ') || r.email || '—'}</p>
                      </td>
                      <td className="td text-slate-600" onClick={(e) => e.stopPropagation()}>
                        {r.phone
                          ? <a href={getCallHref(r.phone) || '#'} className="hover:text-brand-600 hover:underline" title="Click to call">{r.phone}</a>
                          : '—'}
                      </td>
                      <td className="td text-slate-600">{age ?? '—'}</td>
                      <td className="td" onClick={(e) => e.stopPropagation()}>
                        {quickId === r.id ? (
                          <select
                            autoFocus
                            className="input !py-1 !text-xs"
                            value={r.disposition}
                            onChange={(e) => { quickDisposition(r, e.target.value); setQuickId(null) }}
                            onBlur={() => setQuickId(null)}
                          >
                            {DISPOSITIONS.map((d) => <option key={d}>{d}</option>)}
                          </select>
                        ) : (
                          <button className="cursor-pointer" onClick={() => setQuickId(r.id)} title="Click to set disposition without opening the lead">
                            <DispositionBadge value={r.disposition} />
                          </button>
                        )}
                        {r.disposition_reason && quickId !== r.id ? <p className="mt-0.5 text-[11px] text-slate-400">{r.disposition_reason}</p> : null}
                      </td>
                      <td className="td capitalize text-slate-500">{r.source || '—'}</td>
                      {admin && <td className="td text-slate-600">{r.profiles?.name || <span className="text-amber-600">Unassigned</span>}</td>}
                      <td className="td text-slate-500">{fmtDate(r.created_at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && !loading && !loadError && (
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
            <p className="text-xs text-slate-500">Page {page} of {pages}</p>
            <div className="flex gap-2">
              <button className="btn-ghost !px-2.5 !py-1.5" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}><ChevronLeft size={15} /></button>
              <button className="btn-ghost !px-2.5 !py-1.5" disabled={page >= pages || loading} onClick={() => setPage((p) => Math.min(pages, p + 1))}><ChevronRight size={15} /></button>
            </div>
          </div>
        )}
      </div>

      <ImportModal open={showImport} onClose={() => setShowImport(false)} agents={agents} onDone={() => { setShowImport(false); load() }} />
      <AddModal open={showAdd} onClose={() => setShowAdd(false)} agents={agents} onDone={() => { setShowAdd(false); load() }} />
    </div>
  )
}

function ImportModal({ open, onClose, agents, onDone }) {
  const toast = useToast()
  const [step, setStep] = useState('file')
  const [headers, setHeaders] = useState([])
  const [rows, setRows] = useState([])
  const [map, setMap] = useState({})
  const [assignTo, setAssignTo] = useState('')
  const [dupPolicy, setDupPolicy] = useState('skip')
  const [mapError, setMapError] = useState('')

  const onFile = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 15 * 1024 * 1024) { toast('That file is over 15 MB — split it into smaller CSVs.', 'error'); return }
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const hs = res.meta.fields || []
        const data = (res.data || []).slice(0, MAX_IMPORT_ROWS)
        if (!data.length) { toast('That CSV has no data rows.', 'error'); return }
        setHeaders(hs)
        setRows(data)
        setMap(guessMap(hs))
        setMapError('')
        setStep('map')
      },
      error: () => toast('Could not read that file — make sure it’s a valid CSV.', 'error'),
    })
  }

  // Live preview of how many rows will actually import with the current mapping
  const mappableCount = useMemo(() => rows.filter((r) => {
    const phone = map.phone ? String(r[map.phone] ?? '').trim() : ''
    const email = map.email ? String(r[map.email] ?? '').trim() : ''
    const name = map.first_name ? String(r[map.first_name] ?? '').trim() : ''
    return !!(phone || email || name)
  }).length, [rows, map])

  const doImport = async () => {
    const mapped = rows.map((r) => {
      const out = {}
      for (const [field, header] of Object.entries(map)) if (header) out[field] = sanitizeText(r[header] ?? '', 500)
      return out
    }).filter((r) => r.phone || r.email || r.first_name)
    if (!mapped.length) {
      setMapError('No rows can be imported with this mapping — map at least Phone, Email, or First name.')
      return
    }
    try {
      const d = await api('/leads/import', { method: 'POST', body: { rows: mapped, assign_to: assignTo || null, dup_policy: dupPolicy } })
      toast(`Imported ${d.inserted} lead(s)${d.updated ? `, ${d.updated} updated` : ''}${d.duplicates ? ` — ${d.duplicates} duplicate(s) skipped` : ''}`)
      onDone()
    } catch (e) {
      toast(describeError(e), 'error')
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Import leads from CSV" wide>
      {step === 'file' ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 p-10 text-center">
          <Upload className="mx-auto mb-3 text-slate-300" size={32} />
          <p className="text-sm text-slate-500">Choose a CSV file with your Meta leads export (up to {MAX_IMPORT_ROWS.toLocaleString()} rows)</p>
          <input type="file" accept=".csv" onChange={onFile} className="mx-auto mt-4 block text-sm" />
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">{rows.length.toLocaleString()} rows found. Map the columns to lead fields:</p>
          <div className="grid max-h-72 grid-cols-2 gap-3 overflow-y-auto rounded-xl bg-slate-50 p-4">
            {CANON.map(([field, label]) => (
              <div key={field}>
                <label className="label">{label}</label>
                <select className="input" value={map[field] || ''} onChange={(e) => { setMap((m) => ({ ...m, [field]: e.target.value })); setMapError('') }}>
                  <option value="">— skip —</option>
                  {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            ))}
          </div>
          {mapError && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{mapError}</p>}
          <div>
            <label className="label">Assign imported leads to</label>
            <select className="input" value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
              <option value="">Leave unassigned</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">If a lead already exists</label>
            <select className="input" value={dupPolicy} onChange={(e) => setDupPolicy(e.target.value)}>
              <option value="skip">Skip it</option>
              <option value="update">Update it with the new info</option>
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setStep('file')}>Back</button>
            <button className="btn-primary" onClick={doImport} disabled={mappableCount === 0}>
              Import {mappableCount.toLocaleString()} lead(s)
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}

function AddModal({ open, onClose, agents, onDone }) {
  const toast = useToast()
  const { profile } = useAuth()
  const [f, setF] = useState({})
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))

  const save = async () => {
    // Client-side validation before any network call — instant feedback
    const errs = validateForm(f, {
      first_name: [required('First name'), maxLen(100)],
      email: [emailRule()],
      phone: [phoneRule()],
      city: [maxLen(120)],
      disability: [maxLen(2000)],
    })
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    try {
      await api('/leads', {
        method: 'POST',
        body: {
          ...f,
          first_name: sanitizeText(f.first_name, 100),
          last_name: sanitizeText(f.last_name, 100),
          email: sanitizeText(f.email, 200),
          phone: sanitizeText(f.phone, 30),
          assigned_to: profile.role === 'admin' ? f.assigned_to : undefined,
        },
      })
      toast('Lead created')
      setF({})
      setErrors({})
      onDone()
    } catch (e) {
      toast(describeError(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const fieldErr = (k) => errors[k] ? <p className="mt-1 text-xs text-rose-600">{errors[k]}</p> : null

  return (
    <Modal open={open} onClose={onClose} title="Add lead">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">First name *</label>
          <input className={`input ${errors.first_name ? '!border-rose-400' : ''}`} value={f.first_name || ''} onChange={set('first_name')} />
          {fieldErr('first_name')}
        </div>
        <div><label className="label">Last name</label><input className="input" value={f.last_name || ''} onChange={set('last_name')} /></div>
        <div>
          <label className="label">Phone</label>
          <input className={`input ${errors.phone ? '!border-rose-400' : ''}`} value={f.phone || ''} onChange={set('phone')} />
          {fieldErr('phone')}
        </div>
        <div>
          <label className="label">Email</label>
          <input className={`input ${errors.email ? '!border-rose-400' : ''}`} type="email" value={f.email || ''} onChange={set('email')} />
          {fieldErr('email')}
        </div>
        <div><label className="label">Date of birth</label><input className="input" type="date" value={f.dob || ''} onChange={set('dob')} /></div>
        <div><label className="label">State</label>
          <select className="input" value={f.state || ''} onChange={set('state')}><option value="">—</option>{STATES.map((s) => <option key={s}>{s}</option>)}</select>
        </div>
        <div><label className="label">City</label><input className="input" value={f.city || ''} onChange={set('city')} /></div>
        {profile.role === 'admin' && (
          <div><label className="label">Assign to</label>
            <select className="input" value={f.assigned_to || ''} onChange={set('assigned_to')}>
              <option value="">Unassigned</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        )}
        <div className="col-span-2"><label className="label">Disability (what prevents work?)</label><textarea className="input" rows={2} value={f.disability || ''} onChange={set('disability')} /></div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Creating…' : 'Create lead'}</button>
      </div>
    </Modal>
  )
}
