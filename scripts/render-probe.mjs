// Headless reproduction harness: renders the real React components under
// StrictMode in jsdom (same react/react-dom versions as the browser) and
// reports any "destroy is not a function"-class crash with a stack trace.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// 1. .env → supabase coords
const env = {}
for (const line of readFileSync(ROOT + '.env', 'utf8').split('\n')) {
  const m = line.match(/^([A-Za-z_]+)=(.*)\s*$/)
  if (m) env[m[1]] = m[2]
}
const SUPA_URL = env.VITE_SUPABASE_URL || env.SUPABASE_URL
const ANON = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY
if (!SUPA_URL || !ANON) { console.log('FATAL: missing supabase env'); process.exit(1) }
const ref = new URL(SUPA_URL).hostname.split('.')[0]

// 2. real login → session for the auth gate
const login = await fetch(`${SUPA_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: ANON, 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'admin@americanbenefitsadvocates.org', password: 'Devil$8381' }),
}).then((r) => r.json())
if (!login.access_token) { console.log('FATAL: login failed', JSON.stringify(login).slice(0, 200)); process.exit(1) }
console.log('login ok')

// 3. jsdom globals BEFORE React loads
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:8888/admin/integrations',
  pretendToBeVisual: true,
})
const { window } = dom
window.matchMedia = window.matchMedia || ((q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }))
window.scrollTo = () => {}
globalThis.window = window
globalThis.document = window.document
globalThis.localStorage = window.localStorage
globalThis.sessionStorage = window.sessionStorage
globalThis.history = window.history
globalThis.location = window.location
globalThis.HTMLElement = window.HTMLElement
globalThis.CustomEvent = window.CustomEvent
globalThis.Event = window.Event
globalThis.Node = window.Node
globalThis.Element = window.Element
globalThis.getComputedStyle = window.getComputedStyle
globalThis.requestAnimationFrame = window.requestAnimationFrame
globalThis.cancelAnimationFrame = window.cancelAnimationFrame
globalThis.matchMedia = window.matchMedia
globalThis.scrollTo = window.scrollTo
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true })
// supabase-js v2 default storage key
window.localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(login))

const errors = []
window.addEventListener('error', (e) => errors.push('window.onerror: ' + (e.error?.stack || e.message)))
window.addEventListener('unhandledrejection', (e) => errors.push('unhandledrejection: ' + (e.reason?.stack || e.reason)))
process.on('uncaughtException', (r) => { errors.push('uncaughtException: ' + (r?.stack || r)) })
process.on('unhandledRejection', (r) => { errors.push('unhandledRejection: ' + (r?.stack || r)) })

// 4. relative /api fetches → the live netlify dev server
const realFetch = globalThis.fetch
globalThis.fetch = (input, init) =>
  typeof input === 'string' && input.startsWith('/')
    ? realFetch('http://localhost:8888' + input, init)
    : realFetch(input, init)

// 5. vite module loader (own cacheDir so it can't clash with the dev server)
const { createServer: createViteServer } = await import('vite')
const vite = await createViteServer({
  root: ROOT.replace(/[\\/]+$/, ''),
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
  cacheDir: 'node_modules/.vite-probe',
})
const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { ToastProvider } = await vite.ssrLoadModule('/src/ui.jsx')
const { AuthProvider } = await vite.ssrLoadModule('/src/auth.jsx')
const Int = await vite.ssrLoadModule('/src/pages/Integrations.jsx')

async function probe(name, Comp, url, soak = 1500) {
  if (url) window.history.pushState({}, '', url)
  const el = document.getElementById('root')
  el.innerHTML = ''
  const before = errors.length
  try {
    const root = createRoot(el)
    root.render(React.createElement(React.StrictMode, null,
      React.createElement(ToastProvider, null,
        React.createElement(AuthProvider, null,
          React.createElement(Comp)))))
    await new Promise((r) => setTimeout(r, soak))
    root.unmount()
    // give React's dev-mode error reporting a moment AFTER unmount too
    await new Promise((r) => setTimeout(r, 700))
    const errs = errors.slice(before)
    const text = el.textContent.replace(/\s+/g, ' ').trim().slice(0, 220)
    console.log(`\n### ${name}: ${errs.length ? '💥 CRASH' : '✅ ok'}`)
    for (const e of errs) console.log('    ' + e.split('\n').slice(0, 6).join('\n    '))
    if (errs.length) console.log('    rendered text:', JSON.stringify(text))
    await new Promise((r) => setTimeout(r, 300))
  } catch (e) {
    console.log(`\n### ${name}: 💥 SYNC CRASH\n    ` + e.stack.split('\n').slice(0, 6).join('\n    '))
  }
}

await probe('MetaCard', Int.MetaCard)
await probe('DriveCard', Int.DriveCard)
await probe('SheetsCard', Int.SheetsCard)
await probe('Integrations page (all cards)', Int.default)

// 6. the real app, full tree — sweep EVERY route with real auth + data
const AppMod = await vite.ssrLoadModule('/src/App.jsx')
const App = AppMod.default || AppMod.App

const authz = { authorization: `Bearer ${login.access_token}` }
const leadsRes = await realFetch('http://localhost:8888/api/leads', { headers: authz }).then((r) => r.json()).catch(() => ({}))
const leadId = leadsRes?.leads?.[0]?.id || leadsRes?.[0]?.id || ''
console.log(`\nlead for /leads/:id — ${leadId || 'none found'}`)

const ROUTES = [
  ['/', 2500],
  ['/today', 2500],
  ['/leads', 2500],
  ['/leads/' + leadId, 3000],
  ['/tasks', 2500],
  ['/documents', 2500],
  ['/scripts', 2500],
  ['/templates', 2500],
  ['/admin/users', 2500],
  ['/admin/automation', 2500],
  ['/admin/smtp', 2500],
  ['/admin/integrations', 2500],
  ['/upload/probe-token', 2500],
  // 70s soak on the dashboard covers the 60s heartbeat + notification intervals
  ['/', 70000],
]
let failed = 0
for (const [route, soak] of ROUTES) {
  const before = errors.length
  await probe(`route ${route}`, App, route, soak)
  if (errors.length > before) failed++
}
console.log(`\n${failed ? `💥 ${failed} route(s) crashed` : '✅ ALL ROUTES CLEAN'} · DONE`)
process.exit(failed ? 2 : 0)
