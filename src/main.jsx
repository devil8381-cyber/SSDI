import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { AuthProvider } from './auth'
import { ToastProvider } from './ui'
import ErrorBoundary from './ErrorBoundary'
import './styles.css'

// Crash reporter: every uncaught error/rejection in the browser is posted to
// the server with its exact stack, so crashes arrive in the server log with
// file+line — the error screen the user sees is never the only evidence.
function reportCrash(kind, err) {
  try {
    fetch('/api/client-log', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        kind,
        message: String(err?.message || err),
        stack: String(err?.stack || ''),
        href: window.location.href,
      }),
    }).catch(() => {})
  } catch {}
}
window.addEventListener('error', (e) => reportCrash('error', e.error || { message: e.message }))
window.addEventListener('unhandledrejection', (e) => reportCrash('rejection', e.reason))

// Background-reload detector. The CRM itself never reloads (audited: zero
// automatic reload paths, navigation is client-side) — but Chrome "discards"
// background tabs under memory pressure and reloads them on return. Detect
// that exact case, explain it to the user, and report it so support sees it.
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') sessionStorage.setItem('aba_was_hidden', String(Date.now()))
})
window.addEventListener('load', () => {
  try {
    const nav = performance.getEntriesByType('navigation')[0]
    if (nav?.type === 'reload' && sessionStorage.getItem('aba_was_hidden')) {
      sessionStorage.removeItem('aba_was_hidden')
      const n = Number(sessionStorage.getItem('aba_bg_reloads') || 0) + 1
      sessionStorage.setItem('aba_bg_reloads', String(n))
      reportCrash('background-reload', { message: `Browser discarded & reloaded the background tab (occurrence #${n})` })
      window.dispatchEvent(new CustomEvent('aba:browser-reload', { detail: n }))
    }
  } catch {}
})

// Dev-server watchdog: when the dev server dies mid-session, HMR stops
// updating the page silently and the tab keeps running outdated code —
// which surfaces later as confusing crashes. Make that state visible.
if (import.meta.hot) {
  const show = () => {
    let b = document.getElementById('aba-stale-banner')
    if (!b) {
      b = document.createElement('div')
      b.id = 'aba-stale-banner'
      b.textContent = 'Dev server stopped — this page is running outdated code. Restart the server, then refresh this tab.'
      b.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:9999;background:#b91c1c;color:#fff;padding:6px 12px;font:600 12px/1.4 sans-serif;text-align:center'
      document.body?.appendChild(b)
    }
  }
  const clear = () => document.getElementById('aba-stale-banner')?.remove()
  import.meta.hot.on('vite:ws:disconnect', show)
  import.meta.hot.on('vite:ws:connect', clear)
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </ErrorBoundary>
  </React.StrictMode>
)
