import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { X, CheckCircle2, AlertTriangle, Info } from 'lucide-react'
import { DISPOSITION_STYLES } from './config'

export function fmtDateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}
export function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
export function fmtDuration(sec) {
  if (!sec) return '0m'
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return h ? `${h}h ${m}m` : `${m}m`
}
export function ageFrom(dob) {
  if (!dob) return null
  const d = new Date(dob)
  if (isNaN(d)) return null
  const diff = Date.now() - d.getTime()
  return Math.floor(diff / 31557600000)
}
export const leadName = (l) => `${l?.first_name || ''} ${l?.last_name || ''}`.trim() || 'Unnamed lead'

export function DispositionBadge({ value }) {
  if (!value) return <span className="text-slate-400">—</span>
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${DISPOSITION_STYLES[value] || 'bg-slate-800 text-slate-300 ring-slate-500/20'}`}>
      {value}
    </span>
  )
}

export function Modal({ open, onClose, title, children, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.()
    if (open) {
      document.addEventListener('keydown', onKey)
      document.body.style.overflow = 'hidden' // stop background scroll bleed-through
    }
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[90vh] overflow-y-auto rounded-2xl bg-slate-900 shadow-2xl`}>
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-800 bg-slate-900 px-5 py-3.5 rounded-t-2xl">
          <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-300">
            <X size={18} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

export function Spinner({ className = 'h-5 w-5' }) {
  return (
    <svg className={`animate-spin text-brand-400 ${className}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  )
}

// Shared "failed to load this page" panel — every list/detail page uses it
// so a failed fetch is always recoverable with one click, never an eternal spinner.
export function PageError({ message, onRetry }) {
  return (
    <div className="card flex flex-col items-center justify-center py-12 text-center">
      <div className="mb-3 rounded-full bg-rose-500/10 p-3 text-rose-400"><AlertTriangle size={22} /></div>
      <p className="max-w-sm text-sm text-slate-300">{message || 'This page couldn’t be loaded.'}</p>
      {onRetry && <button className="btn-primary mt-4" onClick={onRetry}>Try again</button>}
    </div>
  )
}

// Small busy-button: keeps every actionable element visually honest while
// its request is in flight.
export function BusyButton({ busy, children, className = 'btn-primary', ...rest }) {
  return (
    <button className={className} disabled={busy || rest.disabled} {...rest}>
      {busy ? <Spinner className="h-4 w-4" /> : null}
      {children}
    </button>
  )
}

export function Empty({ icon: Icon, title, hint }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      {Icon && <div className="mb-3 rounded-full bg-slate-800 p-3 text-slate-400"><Icon size={24} /></div>}
      <p className="text-sm font-medium text-slate-300">{title}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  )
}

export function StatCard({ label, value, sub, accent = 'text-slate-100' }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold tracking-tight ${accent}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
    </div>
  )
}

// ── toasts ────────────────────────────────────────────────────
const ToastCtx = createContext(null)
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const push = useCallback((msg, type = 'success') => {
    const id = Math.random().toString(36).slice(2)
    setToasts((t) => [...t, { id, msg, type }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-5 right-5 z-[60] flex w-80 flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className="flex items-start gap-2.5 rounded-xl border border-slate-700 bg-slate-900 p-3.5 shadow-lg">
            {t.type === 'success' ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-500" />
              : t.type === 'error' ? <AlertTriangle size={18} className="mt-0.5 shrink-0 text-rose-500" />
              : <Info size={18} className="mt-0.5 shrink-0 text-brand-500" />}
            <p className="flex-1 text-sm text-slate-200">{t.msg}</p>
            <button onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} className="text-slate-300 hover:text-slate-400"><X size={15} /></button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
export const useToast = () => useContext(ToastCtx)

export function Bars({ data }) {
  const max = Math.max(1, ...data.map((d) => Math.max(d.leads, d.emails)))
  return (
    <div className="flex h-36 items-end gap-1.5">
      {data.map((d) => (
        <div key={d.day} className="group relative flex h-full flex-1 items-end justify-center gap-0.5" title={`${d.day.slice(5)} — ${d.leads} leads, ${d.emails} emails`}>
          <div className="w-1/2 rounded-t bg-brand-500/100/80" style={{ height: `${(d.leads / max) * 100}%`, minHeight: d.leads ? 3 : 0 }} />
          <div className="w-1/2 rounded-t bg-emerald-400/80" style={{ height: `${(d.emails / max) * 100}%`, minHeight: d.emails ? 3 : 0 }} />
        </div>
      ))}
    </div>
  )
}
