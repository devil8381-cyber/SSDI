import { createContext, useContext, useEffect, useState } from 'react'
import { supabase, api, describeError } from './api'

const AuthCtx = createContext(null)

export function AuthProvider({ children }) {
  // `undefined` = still restoring the session from storage (boot),
  // `null` = definitely signed out, object = signed in.
  // Without this distinction, a full page load briefly looks "signed out"
  // and deep links get kicked to /login before the session restores.
  const [session, setSession] = useState(undefined)
  const [profile, setProfile] = useState(null)
  const [profileError, setProfileError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s ?? null))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (session === undefined) return // boot in progress — don't decide anything yet
    let stop = false
    if (!session) { setProfile(null); setProfileError(null); setLoading(false); return }
    setLoading(true)
    api('/me')
      .then((d) => {
        if (stop) return
        setProfile(d.profile)
        setProfileError(null)
      })
      .catch((e) => {
        // Session exists but the account record couldn't be loaded (e.g. the
        // schema SQL wasn't run, or the DB blipped). Surface it instead of
        // spinning forever on the boot screen.
        if (!stop) { setProfile(null); setProfileError(describeError(e)) }
      })
      .finally(() => { if (!stop) setLoading(false) })
    return () => { stop = true }
  }, [session])

  const signIn = async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw new Error(error.message)
  }
  const signOut = () => supabase.auth.signOut()

  return (
    <AuthCtx.Provider value={{ session, profile, profileError, loading, signIn, signOut }}>
      {children}
    </AuthCtx.Provider>
  )
}

export const useAuth = () => useContext(AuthCtx)
