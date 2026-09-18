import { useEffect, useState } from 'react'
import { Headphones, AlertCircle, ShieldCheck } from 'lucide-react'
import { useAuth } from '../auth'
import { api } from '../api'

export default function Login() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [err, setErr] = useState('')
  const [okMsg, setOkMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [firstRun, setFirstRun] = useState(false)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    api('/setup/status').then((d) => setFirstRun(!!d.needed)).catch(() => {})
      .finally(() => setChecked(true))
  }, [])

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      if (firstRun) {
        await api('/setup', { method: 'POST', body: { name, email, password } })
        setFirstRun(false)
        setOkMsg('Admin account created — sign in below.')
      } else {
        await signIn(email, password)
      }
    } catch (ex) {
      setErr(ex.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-lg shadow-brand-600/30">
            <Headphones size={28} />
          </div>
          <h1 className="mt-4 text-2xl font-bold text-white">LeadDesk</h1>
          <p className="mt-1 text-sm text-slate-400">Sales &amp; lead management for SSDI teams</p>
        </div>
        {checked && firstRun && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-300/40 bg-amber-400/10 p-3 text-xs text-amber-300">
            <ShieldCheck size={16} className="mt-0.5 shrink-0" />
            <span>Welcome! No admin exists yet. Create the first admin account — this screen disappears afterwards.</span>
          </div>
        )}
        <form onSubmit={submit} className="card space-y-4 rounded-2xl p-6">
          {err && (
            <div className="flex items-start gap-2 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
              <AlertCircle size={16} className="mt-0.5 shrink-0" /> {err}
            </div>
          )}
          {okMsg && <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{okMsg}</div>}
          {firstRun && (
            <div>
              <label className="label">Your name</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Alex Morgan" />
            </div>
          )}
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoFocus />
          </div>
          <div>
            <label className="label">Password</label>
            <input className="input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder={firstRun ? 'min 6 characters' : '••••••••'} />
          </div>
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? 'Please wait…' : firstRun ? 'Create admin account' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
