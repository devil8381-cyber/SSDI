import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FileText, Copy, Download } from 'lucide-react'
import { api } from '../api'
import { useAuth } from '../auth'
import { useToast, Empty, Spinner, fmtDateTime, leadName } from '../ui'

export default function Documents() {
  const { profile } = useAuth()
  const toast = useToast()
  const admin = profile?.role === 'admin'
  const [requests, setRequests] = useState(null)
  const [docs, setDocs] = useState([])

  const load = () => api('/doc-requests').then((d) => setRequests(d.requests || [])).catch((e) => toast(e.message, 'error'))
  useEffect(load, [])

  // uploaded documents come embedded via lead detail; here we derive from requests
  useEffect(() => {
    if (!requests) return
    const leads = [...new Set(requests.map((r) => r.lead_id))]
    Promise.all(leads.slice(0, 30).map((id) => api(`/leads/${id}`).catch(() => null))).then((res) => {
      const all = res.filter(Boolean).flatMap((d) => d.documents.map((doc) => ({ ...doc, lead: d.lead })))
      setDocs(all.sort((a, b) => (b.uploaded_at || '').localeCompare(a.uploaded_at || '')))
    })
  }, [requests])

  const copy = (r) => {
    navigator.clipboard.writeText(`${window.location.origin}/upload/${r.token}`)
    toast('Secure link copied')
  }
  const download = async (d) => {
    try { const { url } = await api(`/documents/${d.id}/url`); window.open(url, '_blank') } catch (e) { toast(e.message, 'error') }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <h1 className="text-xl font-bold text-slate-800">Documents</h1>

      <div className="card overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-3"><h2 className="text-sm font-semibold text-slate-700">Secure upload requests</h2></div>
        {!requests ? <div className="flex justify-center py-16"><Spinner className="h-7 w-7" /></div>
          : requests.length === 0 ? <Empty icon={FileText} title="No document requests yet" hint="Create one from any lead page — Request documents" />
          : (
          <div className="divide-y divide-slate-100">
            {requests.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${r.status === 'uploaded' ? 'bg-emerald-100 text-emerald-700' : new Date(r.expires_at) < new Date() ? 'bg-rose-100 text-rose-600' : 'bg-amber-100 text-amber-700'}`}>
                  {r.status === 'uploaded' ? 'Received' : new Date(r.expires_at) < new Date() ? 'Expired' : 'Pending'}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-800">
                    {r.leads ? <Link className="hover:text-brand-600 hover:underline" to={`/leads/${r.leads.id}`}>{leadName(r.leads)}</Link> : '—'}
                    <span className="ml-2 font-normal text-slate-500">{(r.doc_types || []).join(', ') || 'Any documents'}</span>
                  </p>
                  <p className="text-xs text-slate-400">requested {fmtDateTime(r.created_at)} · expires {fmtDateTime(r.expires_at)}</p>
                </div>
                <button className="btn-ghost !py-1.5 text-xs" onClick={() => copy(r)}><Copy size={13} /> Copy link</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-3"><h2 className="text-sm font-semibold text-slate-700">Uploaded documents</h2></div>
        {docs.length === 0 ? <Empty title="No documents uploaded yet" /> : (
          <div className="divide-y divide-slate-100">
            {docs.map((d) => (
              <div key={d.id} className="flex items-center gap-3 px-5 py-3">
                <FileText size={16} className="text-slate-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{d.doc_type} — {d.file_name}</p>
                  <p className="text-xs text-slate-400">
                    from {d.lead ? <Link className="text-brand-600 hover:underline" to={`/leads/${d.lead.id}`}>{leadName(d.lead)}</Link> : '—'} · {fmtDateTime(d.uploaded_at)}
                  </p>
                </div>
                <button className="btn-ghost !py-1.5 text-xs" onClick={() => download(d)}><Download size={13} /> View</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
