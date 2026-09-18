import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Papa from 'papaparse'
import { Search, Plus, Upload, Download, UserPlus, ChevronLeft, ChevronRight, Users2 } from 'lucide-react'
import { api } from '../api'
import { useAuth } from '../auth'
import { useToast, Modal, DispositionBadge, Empty, Spinner, ageFrom, leadName, fmtDate } from '../ui'
import { DISPOSITIONS, STATES } from '../config'

const CANON = [
  ['first_name', 'First name'], ['last_name', 'Last name'], ['email', 'Email'], ['phone', 'Phone'],
  ['dob', 'Date of birth'], ['state', 'State'], ['city', 'City'],
  ['worked_5_of_10', 'Worked 5 of 10 years'], ['receiving_benefits', 'Receiving benefits'],
  ['duration_12m', 'Disability 12+ months'], ['has_attorney', 'Has attorney'], ['disability', 'Disability'],
  ['notes', 'Notes'], ['campaign', 'Campaign'],
]
const norm = (h) => h.toLowerCase().replace(/[^a-z0-9]/g, '')

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

export default function Leads() {
  const { profile } = useAuth()
  const toast = useToast()
  const admin = profile?.role === 'admin'

  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [agents, setAgents] = useState([])
  const [selected, setSelected] = useState(new Set())

  const [q, setQ] = useState('')
  const [qInput, setQInput] = useState('')
  const [disposition, setDisposition] = useState('all')
  const [assigned, setAssigned] = useState('all')
  const [source, setSource] = useState('all')
  const [createdAfter, setCreatedAfter] = useState('')

  // debounce the search box into the actual query
  useEffect(() => {
    const t = setTimeout(() => { setQ(qInput); setPage(1) }, 350)
    return () => clearTimeout(t)
  }, [qInput])
  useEffect(() => { setPage(1) }, [disposition, assigned, source, createdAfter])

  const [showImport, setShowImport] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [assignTo, setAssignTo] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    const p = new URLSearchParams({ page, limit: 50 })
    if (q) p.set('q', q)
    if (disposition !== 'all') p.set('disposition', disposition)
    if (assigned !== 'all') p.set('assigned', assigned)
    if (source !== 'all') p.set('source', source)
    if (createdAfter) p.set('created_after', createdAfter)
    api(`/leads?${p}`)
      .then((d) => { setRows(d.rows); setTotal(d.total); setSelected(new Set()) })
      .catch((e) => toast(e.message, 'error'))
      .finally(() => setLoading(false))
  }, [page, q, disposition, assigned, source, createdAfter])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (admin) api('/users/agents').then((d) => setAgents(d.users || [])).catch(() => {}) }, [admin])

  const pages = Math.max(1, Math.ceil(total / 50))
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id))
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.id)))
  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const bulkAssign = async () => {
    if (!assignTo || !selected.size) return
    try {
      await api('/leads/assign', { method: 'POST', body: { ids: [...selected], agent_id: assignTo === 'unassigned' ? null : assignTo } })
      toast(`${selected.size} lead(s) assigned`)
      setAssignTo('')
      load()
    } catch (e) { toast(e.message, 'error') }
  }

  const exportCsv = async () => {
    try {
      const p = new URLSearchParams({ limit: 200, page: 1 })
      if (q) p.set('q', q)
      if (disposition !== 'all') p.set('disposition', disposition)
      if (assigned !== 'all') p.set('assigned', assigned)
      if (source !== 'all') p.set('source', source)
      let all = []
      const first = await api(`/leads?${p}`)
      all = first.rows
      for (let pg = 2; pg <= Math.ceil(first.total / 200); pg++) {
        const d = await api(`/leads?${p.toString().replace(/page=1/, `page=${pg}`)}`)
        all = all.concat(d.rows)
      }
      const csv = Papa.unparse(all.map((r) => ({
        first_name: r.first_name, last_name: r.last_name, email: r.email, phone: r.phone,
        dob: r.dob || '', age: ageFrom(r.dob) || '', state: r.state || '', city: r.city || '',
        disposition: r.disposition, reason: r.disposition_reason || '', source: r.source,
        agent: r.profiles?.name || '', created: r.created_at, notes: r.notes || '',
      })))
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
      const a = document.createElement('a')
      a.href = url; a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`; a.click()
      URL.revokeObjectURL(url)
    } catch (e) { toast(e.message, 'error') }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-800">Leads <span className="text-sm font-medium text-slate-400">({total})</span></h1>
        <div className="flex flex-wrap gap-2">
          {admin && <button className="btn-ghost" onClick={() => setShowImport(true)}><Upload size={15} /> Import CSV</button>}
          <button className="btn-ghost" onClick={exportCsv}><Download size={15} /> Export</button>
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

      {admin && selected.size > 0 && (
        <div className="card flex flex-wrap items-center gap-3 border-brand-200 bg-brand-50/60 p-3">
          <span className="text-sm font-medium text-brand-800">{selected.size} selected</span>
          <UserPlus size={15} className="text-brand-600" />
          <select className="input w-auto" value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
            <option value="">Assign to…</option>
            <option value="unassigned">Unassigned (back to pool)</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <button className="btn-primary" onClick={bulkAssign} disabled={!assignTo}>Apply</button>
        </div>
      )}

      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16"><Spinner className="h-7 w-7" /></div>
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
                    <tr key={r.id} className="cursor-pointer hover:bg-brand-50/40" onClick={() => window.open(`/leads/${r.id}`, '_self')}>
                      {admin && (
                        <td className="td" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} className="h-4 w-4 rounded border-slate-300" />
                        </td>
                      )}
                      <td className="td">
                        <p className="font-medium text-slate-800">{leadName(r)}</p>
                        <p className="text-xs text-slate-400">{[r.city, r.state].filter(Boolean).join(', ') || r.email || '—'}</p>
                      </td>
                      <td className="td text-slate-600">{r.phone || '—'}</td>
                      <td className="td text-slate-600">{age ?? '—'}</td>
                      <td className="td">
                        <DispositionBadge value={r.disposition} />
                        {r.disposition_reason && <p className="mt-0.5 text-[11px] text-slate-400">{r.disposition_reason}</p>}
                      </td>
                      <td className="td capitalize text-slate-500">{r.source}</td>
                      {admin && <td className="td text-slate-600">{r.profiles?.name || <span className="text-amber-600">Unassigned</span>}</td>}
                      <td className="td text-slate-500">{fmtDate(r.created_at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
            <p className="text-xs text-slate-500">Page {page} of {pages}</p>
            <div className="flex gap-2">
              <button className="btn-ghost !px-2.5 !py-1.5" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft size={15} /></button>
              <button className="btn-ghost !px-2.5 !py-1.5" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}><ChevronRight size={15} /></button>
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
  const [busy, setBusy] = useState(false)

  const onFile = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: (res) => {
        const hs = res.meta.fields || []
        setHeaders(hs)
        setRows(res.data)
        setMap(guessMap(hs))
        setStep('map')
      },
      error: () => toast('Could not parse that CSV', 'error'),
    })
  }

  const doImport = async () => {
    setBusy(true)
    try {
      const mapped = rows.map((r) => {
        const out = {}
        for (const [field, header] of Object.entries(map)) if (header) out[field] = String(r[header] ?? '').trim()
        return out
      }).filter((r) => r.phone || r.email || r.first_name)
      const d = await api('/leads/import', { method: 'POST', body: { rows: mapped, assign_to: assignTo || null } })
      toast(`Imported ${d.inserted} leads${d.duplicates ? ` — ${d.duplicates} duplicate(s) skipped` : ''}`)
      onDone()
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="Import leads from CSV" wide>
      {step === 'file' ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 p-10 text-center">
          <Upload className="mx-auto mb-3 text-slate-300" size={32} />
          <p className="text-sm text-slate-500">Choose a CSV file with your Meta leads export</p>
          <input type="file" accept=".csv" onChange={onFile} className="mx-auto mt-4 block text-sm" />
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">{rows.length} rows found. Map the columns to lead fields:</p>
          <div className="grid max-h-72 grid-cols-2 gap-3 overflow-y-auto rounded-xl bg-slate-50 p-4">
            {CANON.map(([field, label]) => (
              <div key={field}>
                <label className="label">{label}</label>
                <select className="input" value={map[field] || ''} onChange={(e) => setMap((m) => ({ ...m, [field]: e.target.value }))}>
                  <option value="">— skip —</option>
                  {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div>
            <label className="label">Assign imported leads to</label>
            <select className="input" value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
              <option value="">Leave unassigned</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setStep('file')}>Back</button>
            <button className="btn-primary" onClick={doImport} disabled={busy}>{busy ? 'Importing…' : `Import ${rows.length} leads`}</button>
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
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const save = async () => {
    try {
      await api('/leads', { method: 'POST', body: { ...f, assigned_to: profile.role === 'admin' ? f.assigned_to : undefined } })
      toast('Lead created')
      setF({})
      onDone()
    } catch (e) { toast(e.message, 'error') }
  }
  return (
    <Modal open={open} onClose={onClose} title="Add lead">
      <div className="grid grid-cols-2 gap-3">
        <div><label className="label">First name *</label><input className="input" value={f.first_name || ''} onChange={set('first_name')} /></div>
        <div><label className="label">Last name</label><input className="input" value={f.last_name || ''} onChange={set('last_name')} /></div>
        <div><label className="label">Phone</label><input className="input" value={f.phone || ''} onChange={set('phone')} /></div>
        <div><label className="label">Email</label><input className="input" type="email" value={f.email || ''} onChange={set('email')} /></div>
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
        <button className="btn-primary" onClick={save}>Create lead</button>
      </div>
    </Modal>
  )
}
