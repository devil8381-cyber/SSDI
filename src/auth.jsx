import { createContext, useContext, useEffect, useState } from 'react'
import { supabase, api, describeError } from './api'

const AuthCtx = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [profileError, setProfileError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    let stop = false
    if (!session) { setProfile(null); setProfileError(null); setLoading(false); return }
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
