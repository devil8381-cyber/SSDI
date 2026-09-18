import { createContext, useContext, useEffect, useState } from 'react'
import { supabase, api } from './api'

const AuthCtx = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    let stop = false
    if (!session) { setProfile(null); setLoading(false); return }
    api('/me')
      .then((d) => { if (!stop) setProfile(d.profile) })
      .catch(() => { if (!stop) setProfile(null) })
      .finally(() => { if (!stop) setLoading(false) })
    return () => { stop = true }
  }, [session])

  const signIn = async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw new Error(error.message)
  }
  const signOut = () => supabase.auth.signOut()

  return (
    <AuthCtx.Provider value={{ session, profile, loading, signIn, signOut }}>
      {children}
    </AuthCtx.Provider>
  )
}

export const useAuth = () => useContext(AuthCtx)
