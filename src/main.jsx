import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { AuthProvider } from './auth'
import { ToastProvider } from './ui'
import ErrorBoundary from './ErrorBoundary'
import './styles.css'

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
