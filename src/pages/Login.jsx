import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Headphones, AlertCircle, ShieldCheck } from 'lucide-react'
import { useAuth } from '../auth'
import { api, describeError } from '../api'

export default function Login() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [err, setErr] = useState('')
  const [okMsg, setOkMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [busyRef] = useState({ current: false }) // re-entrancy gate surviving re-renders
  const [firstRun, setFirstRun] = useState(false)
  const [checked, setChecked] = useState(false)
  const [dbReady, setDbReady] = useState(true)

  useEffect(() => {
    // If the DB isn't reachable/configured yet, tell the user plainly instead
    // of letting sign-in fail with a confusing network error.
    api('/setup/status')
      .then((d) => { setFirstRun(!!d.needed); setDbReady(d.dbConfigured !== false) })
      .catch(() => {})
      .finally(() => setChecked(true))
  }, [])

  const submit = async (e) => {
    e.preventDefault()
    if (busyRef.current) return // Enter-key spam defense
    busyRef.current = true
    setErr('')
    setOkMsg('')
    setBusy(true)
    try {
      if (firstRun) {
        await api('/setup', { method: 'POST', body: { name, email, password } })
        // Straight into the app — no forced re-typing of the same credentials
        await signIn(email, password)
      } else {
        await signIn(email, password)
      }
      // Explicit entry into the app (belt-and-braces with the /login guard)
      navigate('/', { replace: true })
    } catch (ex) {
      setErr(describeError(ex))
      busyRef.current = false
    } finally {
      setBusy(false)
      busyRef.current = false
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-lg shadow-brand-600/30">
            <Headphones size={28} />
          </div>
          <h1 className="mt-4 text-center text-xl font-bold leading-tight text-white">American Benefits<br/>Advocates</h1>
          <p className="mt-1 text-sm text-slate-400">Social Security Disability case management</p>
        </div>
        {checked && !dbReady && (
          <div className="mb-4 rounded-xl border border-rose-400/40 bg-rose-500/100/10 p-3 text-xs leading-relaxed text-rose-200">
            <b>Database not connected.</b> Sign-in is disabled because the server has no Supabase keys yet.
            <br />Local dev: paste <code>SUPABASE_URL</code>, <code>SUPABASE_ANON_KEY</code>, <code>SUPABASE_SERVICE_ROLE_KEY</code> + the two <code>VITE_</code> keys into <code>.env</code>, then restart the dev server.
            <br />Production: set the same keys under Netlify → Site settings → Environment variables and redeploy.
          </div>
        )}
        {checked && dbReady && firstRun && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-300/40 bg-amber-400/10 p-3 text-xs text-amber-300">
            <ShieldCheck size={16} className="mt-0.5 shrink-0" />
            <span>Welcome! No admin exists yet. Create the first admin account — this screen disappears afterwards.</span>
          </div>
        )}
        <form onSubmit={submit} className="card space-y-4 rounded-2xl p-6">
          {err && (
            <div className="flex items-start gap-2 rounded-lg bg-rose-500/10 p-3 text-sm text-rose-300">
              <AlertCircle size={16} className="mt-0.5 shrink-0" /> {err}
            </div>
          )}
          {okMsg && <div className="rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-300">{okMsg}</div>}
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
            <input className="input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder={firstRun ? 'min 6 characters' : '••••••••'} minLength={firstRun ? 6 : undefined} />
          </div>
          <button className="btn-primary w-full" disabled={busy}>
            {busy ? 'Please wait…' : firstRun ? 'Create admin account' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
