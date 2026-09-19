import { useEffect, useRef, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Users2, ClipboardList, FileText, MessageSquareText, ScrollText,
  UserCog, Plug, Send, Bell, LogOut, Menu, X, Headphones, WifiOff, Search, Zap, Phone, Sunrise,
} from 'lucide-react'
import { api } from '../api'
import { useAuth } from '../auth'
import { useOnline, useDebounced } from '../lib/hooks'
import { fmtDateTime, leadName, DispositionBadge } from '../ui'

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/today', label: 'Today', icon: Sunrise },
  { to: '/leads', label: 'Leads', icon: Users2 },
  { to: '/tasks', label: 'Tasks', icon: ClipboardList },
  { to: '/documents', label: 'Documents', icon: FileText },
  { to: '/scripts', label: 'Scripts', icon: ScrollText },
  { to: '/templates', label: 'Templates', icon: MessageSquareText },
]
const ADMIN_NAV = [
  { to: '/admin/users', label: 'Users', icon: UserCog },
  { to: '/admin/automation', label: 'Automation', icon: Zap },
  { to: '/admin/smtp', label: 'SMTP Servers', icon: Send },
  { to: '/admin/integrations', label: 'Integrations', icon: Plug },
]

export default function Layout({ children }) {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const online = useOnline()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [notifs, setNotifs] = useState([])
  const [notifOpen, setNotifOpen] = useState(false)
  const bellRef = useRef(null)

  // Active-time heartbeat: only counts while the tab is visible AND we're
  // online, so offline time never inflates "active" metrics.
  useEffect(() => {
    let visible = !document.hidden
    const onVis = () => { visible = !document.hidden }
    document.addEventListener('visibilitychange', onVis)
    const iv = setInterval(() => {
      if (visible && online) api('/heartbeat', { method: 'POST', body: { seconds: 60 } }).catch(() => {})
    }, 60000)
    return () => { document.removeEventListener('visibilitychange', onVis); clearInterval(iv) }
  }, [online])

  // Notifications poll pauses while the tab is hidden or offline — no wasted
  // requests, and it self-heals the moment connectivity returns.
  useEffect(() => {
    const load = () => {
      if (document.hidden || !online) return
      api('/notifications').then((d) => setNotifs(d.notifications || [])).catch(() => {})
    }
    load()
    const iv = setInterval(load, 45000)
    const onVis = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVis) }
  }, [online])

  useEffect(() => {
    const close = (e) => { if (bellRef.current && !bellRef.current.contains(e.target)) setNotifOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])
  const unread = notifs.filter((n) => !n.read).length

  // ── global lead search (topbar, Ctrl+K) ─────────────────────
  const navigate2 = navigate
  const [searchQ, setSearchQ] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [results, setResults] = useState([])
  const searchRef = useRef(null)
  const searchInputRef = useRef(null)
  const dq = useDebounced(searchQ, 250)
  useEffect(() => {
    if (dq.trim().length < 2) { setResults([]); return }
    api(`/search?q=${encodeURIComponent(dq.trim())}`)
      .then((d) => setResults(d.results || []))
      .catch(() => {})
  }, [dq])
  useEffect(() => {
    const close = (e) => { if (searchRef.current && !searchRef.current.contains(e.target)) setSearchOpen(false) }
    document.addEventListener('mousedown', close)
    const keys = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchInputRef.current?.focus()
        setSearchOpen(true)
      }
    }
    document.addEventListener('keydown', keys)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', keys) }
  }, [])
  const goToLead = (id) => {
    setSearchOpen(false); setSearchQ(''); setResults([]); navigate2(`/leads/${id}`)
  }

  const markRead = async () => {
    const ids = notifs.filter((n) => !n.read).map((n) => n.id).slice(0, 100) // cap payload size
    if (ids.length) await api('/notifications/read', { method: 'POST', body: { ids } }).catch(() => {})
    setNotifs((ns) => ns.map((n) => ({ ...n, read: true })))
  }

  const NavItem = ({ item }) => (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      onClick={() => setSidebarOpen(false)}
      className={({ isActive }) =>
        `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
          isActive ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-300 hover:bg-slate-800 hover:text-white'
        }`}
    >
      <item.icon size={17} />
      {item.label}
    </NavLink>
  )

  return (
    <div className="flex min-h-screen">
      {/* offline banner — never block the UI, just inform */}
      {!online && (
        <div className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 bg-amber-500 px-4 py-1.5 text-sm font-medium text-white">
          <WifiOff size={15} /> You're offline — changes can't be saved right now. Reconnecting automatically…
        </div>
      )}

      {/* sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col bg-slate-900 transition-transform lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white"><Headphones size={19} /></div>
          <div>
            <p className="text-[15px] font-bold leading-tight text-white">LeadDesk</p>
            <p className="text-[10px] font-medium uppercase tracking-widest text-slate-400">SSDI CRM</p>
          </div>
          <button className="ml-auto text-slate-400 lg:hidden" onClick={() => setSidebarOpen(false)}><X size={18} /></button>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
          {NAV.map((item) => <NavItem key={item.to} item={item} />)}
          {profile?.role === 'admin' && (
            <>
              <p className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Administration</p>
              {ADMIN_NAV.map((item) => <NavItem key={item.to} item={item} />)}
            </>
          )}
        </nav>
        <div className="border-t border-slate-800 p-3">
          <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-500/20 text-sm font-semibold text-brand-300">
              {(profile?.name || '?').slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">{profile?.name}</p>
              <p className="truncate text-[11px] capitalize text-slate-400">{profile?.role}</p>
            </div>
            <button
              onClick={async () => { await signOut(); navigate('/login') }}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-rose-400" title="Sign out"
            ><LogOut size={16} /></button>
          </div>
        </div>
      </aside>
      {sidebarOpen && <div className="fixed inset-0 z-30 bg-slate-900/50 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      {/* main */}
      <div className="flex min-h-screen w-full flex-col lg:pl-60">
        <header className={`sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur lg:px-8 ${!online ? 'mt-8' : ''}`}>
          <button className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button>
          {/* global search — jump to any lead instantly */}
          <div className="relative w-full max-w-xs lg:max-w-sm" ref={searchRef}>
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              ref={searchInputRef}
              className="input pl-9"
              placeholder="Search leads…  Ctrl+K"
              value={searchQ}
              onChange={(e) => { setSearchQ(e.target.value); setSearchOpen(true) }}
              onFocus={() => setSearchOpen(true)}
              onKeyDown={(e) => e.key === 'Escape' && setSearchOpen(false)}
            />
            {searchOpen && results.length > 0 && (
              <div className="absolute left-0 right-0 z-30 mt-2 max-h-80 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
                {results.map((r) => (
                  <button key={r.id} onClick={() => goToLead(r.id)} className="flex w-full items-center justify-between gap-2 border-b border-slate-50 px-3 py-2.5 text-left hover:bg-brand-50/60">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-700">{leadName(r)}</p>
                      <p className="text-[11px] text-slate-400">{r.phone || r.email || '—'}</p>
                    </div>
                    <DispositionBadge value={r.disposition} />
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex-1" />
          <div className="relative" ref={bellRef}>
            <button
              onClick={() => { setNotifOpen((o) => !o); if (unread) markRead() }}
              className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100"
            >
              <Bell size={19} />
              {unread > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">{unread}</span>}
            </button>
            {notifOpen && (
              <div className="absolute right-0 mt-2 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
                <p className="border-b border-slate-100 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Notifications</p>
                <div className="max-h-80 overflow-y-auto">
                  {notifs.length === 0 && <p className="px-4 py-6 text-center text-sm text-slate-400">Nothing yet</p>}
                  {notifs.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => { if (n.lead_id) { setNotifOpen(false); navigate(`/leads/${n.lead_id}`) } }}
                      className="block w-full border-b border-slate-50 px-4 py-3 text-left hover:bg-slate-50"
                    >
                      <p className="text-sm font-medium text-slate-700">{n.title}</p>
                      {n.body && <p className="mt-0.5 text-xs text-slate-500">{n.body}</p>}
                      <p className="mt-1 text-[10px] text-slate-400">{fmtDateTime(n.created_at)}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </header>
        <main className="flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  )
}
