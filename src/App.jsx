import { Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { useAuth } from './auth'
import { Spinner } from './ui'
import Layout from './components/Layout'
import Login from './pages/Login'
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
import ClaimantUpload from './pages/ClaimantUpload'

function Boot() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner className="h-8 w-8" />
    </div>
  )
}

function RequireAuth() {
  const { session, profile, loading } = useAuth()
  if (loading) return <Boot />
  if (!session) return <Navigate to="/login" replace />
  if (!profile) return <Boot />
  return <Layout><Outlet /></Layout>
}

function RequireAdmin() {
  const { profile } = useAuth()
  if (profile?.role !== 'admin') return <Navigate to="/" replace />
  return <Outlet />
}

export default function App() {
  const { session } = useAuth()
  return (
    <Routes>
      <Route path="/login" element={session ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/upload/:token" element={<ClaimantUpload />} />
      <Route element={<RequireAuth />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/leads" element={<Leads />} />
        <Route path="/leads/:id" element={<LeadDetail />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="/documents" element={<Documents />} />
        <Route path="/scripts" element={<Scripts />} />
        <Route path="/templates" element={<Templates />} />
        <Route element={<RequireAdmin />}>
          <Route path="/admin/users" element={<Users />} />
          <Route path="/admin/smtp" element={<Smtp />} />
          <Route path="/admin/integrations" element={<Integrations />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
