import { useEffect } from 'react'
import { createBrowserRouter, RouterProvider, Navigate, Outlet, useRouteError } from 'react-router-dom'
import { supabase } from './api'
import { useAuth } from './auth'
import { useToast, Spinner } from './ui'
import Layout from './components/Layout'
import Login from './pages/Login'
import Today from './pages/Today'
import Dashboard from './pages/Dashboard'
import Leads from './pages/Leads'
import LeadDetail from './pages/LeadDetail'
import Tasks from './pages/Tasks'
import Documents from './pages/Documents'
import Scripts from './pages/Scripts'
import Templates from './pages/Templates'
import Users from './pages/Users'
import Smtp from './pages/Smtp'
import Integrations from './pages/Integrations'
import Automation from './pages/Automation'
import ClaimantUpload from './pages/ClaimantUpload'

function Boot() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner className="h-8 w-8" />
    </div>
  )
}

// Per-route error boundary: a crash on one page never blanks the whole app.
// Stale-code crashes (dev server died mid-session, old chunks after a deploy)
// recover perfectly with one clean reload — do that automatically once before
// ever showing the box, so the user usually never sees an error at all.
function RouteError() {
  const error = useRouteError()
  const stamp = `aba_autoreload:${window.location.pathname}`
  const last = Number(sessionStorage.getItem(stamp) || 0)
  if (Date.now() - last > 60000) {
    sessionStorage.setItem(stamp, String(Date.now()))
    window.location.reload()
    return null
  }
  return (
    <Layout>
      <div className="card mx-auto mt-10 max-w-md p-8 text-center">
        <h1 className="text-lg font-bold text-slate-800">This page couldn’t be displayed</h1>
        <p className="mt-2 text-sm text-slate-500">
          {error?.message || 'An unexpected error occurred.'} Try again, or head back to the dashboard.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <button className="btn-primary" onClick={() => window.location.reload()}>Reload</button>
          <a className="btn-ghost" href="/">Go to dashboard</a>
        </div>
      </div>
    </Layout>
  )
}

// Signs the user out cleanly when the API client reports an unrecoverable
// session (token refresh failed). Redirect happens via the auth state change.
function SessionWatcher() {
  const toast = useToast()
  useEffect(() => {
    const onExpired = () => {
      toast('Your session expired — please sign in again.', 'error')
      supabase.auth.signOut()
    }
    window.addEventListener('leaddesk:session-expired', onExpired)
    return () => window.removeEventListener('leaddesk:session-expired', onExpired)
  }, [toast])
  return null
}

function RequireAuth() {
  const { session, profile, profileError, loading } = useAuth()
  // wait for BOTH the session restore and the profile fetch — a full page
  // load must never be mistaken for "signed out"
  if (loading || session === undefined) return <Boot />
  if (!session) return <Navigate to="/login" replace />
  // Signed in but the account record couldn't load (schema missing, DB blip):
  // give the user a way out instead of an endless boot spinner.
  if (!profile && profileError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <div className="card max-w-md p-8 text-center">
          <h1 className="text-lg font-bold text-slate-800">Couldn't load your account</h1>
          <p className="mt-2 text-sm text-slate-500">{profileError}</p>
          <p className="mt-1 text-xs text-slate-400">
            If this keeps happening, the database schema may not be set up — run <code>db/schema.sql</code> in the Supabase SQL editor.
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <button className="btn-primary" onClick={() => window.location.reload()}>Try again</button>
            <button className="btn-ghost" onClick={() => supabase.auth.signOut()}>Sign out</button>
          </div>
        </div>
      </div>
    )
  }
  if (!profile) return <Boot />
  return (
    <>
      <SessionWatcher />
      <Layout>
        <Outlet />
      </Layout>
    </>
  )
}

function RequireAdmin() {
  const { profile } = useAuth()
  if (profile?.role !== 'admin') return <Navigate to="/" replace />
  return <Outlet />
}

// /login bounces signed-in users straight to the dashboard — otherwise a
// successful sign-in would leave them staring at the login form.
function LoginRoute() {
  const { session, profile } = useAuth()
  if (session !== undefined && session && profile) return <Navigate to="/" replace />
  return <Login />
}

const router = createBrowserRouter([
  { path: '/login', element: <LoginRoute /> },
  { path: '/upload/:token', element: <ClaimantUpload />, errorElement: <RouteError /> },
  {
    element: <RequireAuth />,
    errorElement: <RouteError />,
    children: [
      { path: '/', element: <Dashboard /> },
      { path: '/today', element: <Today /> },
      { path: '/leads', element: <Leads /> },
      { path: '/leads/:id', element: <LeadDetail />, errorElement: <RouteError /> },
      { path: '/tasks', element: <Tasks /> },
      { path: '/documents', element: <Documents /> },
      { path: '/scripts', element: <Scripts /> },
      { path: '/templates', element: <Templates /> },
        {
          element: <RequireAdmin />,
          children: [
            { path: '/admin/users', element: <Users /> },
            { path: '/admin/automation', element: <Automation /> },
            { path: '/admin/smtp', element: <Smtp /> },
            { path: '/admin/integrations', element: <Integrations /> },
          ],
        },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])

export default function App() {
  return <RouterProvider router={router} />
}
