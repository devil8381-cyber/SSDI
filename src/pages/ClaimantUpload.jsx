import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Headphones, FileText, UploadCloud, CheckCircle2, ShieldCheck, Loader2 } from 'lucide-react'
import { api, uploadToSignedUrl } from '../api'
import { fmtDateTime } from '../ui'

export default function ClaimantUpload() {
  const { token } = useParams()
  const [info, setInfo] = useState(null)
  const [error, setError] = useState(null)
  const [uploads, setUploads] = useState({}) // docType -> {status: 'uploading'|'done', name}
  const [busy, setBusy] = useState(false)

  const load = () => api(`/doc/${token}`).then(setInfo).catch((e) => setError(e.message))
  useEffect(() => { load() }, [token])

  const upload = async (docType, file) => {
    setUploads((u) => ({ ...u, [docType]: { status: 'uploading', name: file.name } }))
    try {
      const { signed_url, path } = await api(`/doc/${token}/upload-url`, { method: 'POST', body: { file_name: file.name, doc_type: docType } })
      await uploadToSignedUrl(signed_url, file)
      await api(`/doc/${token}/confirm`, { method: 'POST', body: { path, doc_type: docType, file_name: file.name, size: file.size } })
      setUploads((u) => ({ ...u, [docType]: { status: 'done', name: file.name } }))
      load()
    } catch (e) {
      setUploads((u) => ({ ...u, [docType]: { status: 'error', name: file.name, error: e.message } }))
    }
  }

  if (error) {
    return (
      <Shell>
        <div className="rounded-xl bg-rose-50 p-4 text-center text-sm text-rose-700">{error}</div>
      </Shell>
    )
  }
  if (!info) return <Shell><div className="py-10 text-center text-slate-400">Loading…</div></Shell>

  const done = Object.values(uploads).filter((u) => u.status === 'done').length

  return (
    <Shell>
      <h1 className="text-xl font-bold text-slate-800">
        {info.claimant ? `Hello, ${info.claimant.split(' ')[0]}!` : 'Secure document upload'}
      </h1>
      <p className="mt-1 text-sm text-slate-500">Please upload the documents below. Your files go directly to your claims agent — encrypted in transit and only visible to your claims team.</p>

      {info.message && <div className="mt-3 rounded-xl bg-brand-50 p-3 text-sm text-brand-800">{info.message}</div>}

      <div className="mt-4 space-y-2">
        {(info.docTypes || []).map((t) => {
          const st = uploads[t]
          const already = (info.uploaded || []).some((d) => d.doc_type === t)
          return (
            <label key={t} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-4 transition ${st?.status === 'done' || already ? 'border-emerald-300 bg-emerald-50/60' : 'border-slate-200 hover:border-brand-400 hover:bg-brand-50/40'}`}>
              <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.heic" disabled={st?.status === 'uploading'} onChange={(e) => e.target.files?.[0] && upload(t, e.target.files[0])} />
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${st?.status === 'done' || already ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
                {st?.status === 'uploading' ? <Loader2 size={18} className="animate-spin" /> : st?.status === 'done' || already ? <CheckCircle2 size={18} /> : <UploadCloud size={18} />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800">{t}</p>
                <p className="text-xs text-slate-400">
                  {st?.status === 'uploading' ? 'Uploading…'
                    : st?.status === 'done' ? `✅ ${st.name} — received!`
                    : st?.status === 'error' ? `Failed: ${st.error} — tap to retry`
                    : already ? 'Already uploaded — tap to replace'
                    : 'Tap to choose file (PDF, photo, or document)'}
                </p>
              </div>
              <FileText size={16} className="text-slate-300" />
            </label>
          )
        })}
        {(info.docTypes || []).length === 0 && (
          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 p-4 hover:border-brand-400">
            <input type="file" className="hidden" onChange={(e) => e.target.files?.[0] && upload('Document', e.target.files[0])} />
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-500"><UploadCloud size={18} /></div>
            <div><p className="text-sm font-medium text-slate-800">Upload your document</p><p className="text-xs text-slate-400">PDF, photo, or any document</p></div>
          </label>
        )}
      </div>

      {done > 0 && (
        <div className="mt-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700">
          🎉 {done} document{done > 1 ? 's' : ''} received! Your agent has been notified. You can close this page or upload more files.
        </div>
      )}

      <div className="mt-5 flex items-center gap-2 text-[11px] text-slate-400">
        <ShieldCheck size={14} className="text-emerald-500" />
        Secure link{info.expires_at ? ` · expires ${fmtDateTime(info.expires_at)}` : ''} · files visible to your claims team only
      </div>
    </Shell>
  )
}

function Shell({ children }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-5 flex items-center justify-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-white"><Headphones size={20} /></div>
          <div>
            <p className="text-base font-bold text-white">LeadDesk</p>
            <p className="text-[10px] font-medium uppercase tracking-widest text-slate-400">Secure document portal</p>
          </div>
        </div>
        <div className="card space-y-1 rounded-2xl p-6">{children}</div>
      </div>
    </div>
  )
}
