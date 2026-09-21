import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const env = {}
for (const line of readFileSync(ROOT + '.env', 'utf8').split('\n')) { const m = line.match(/^([A-Za-z_]+)=(.*)\s*$/); if (m) env[m[1]] = m[2] }
const BASE = process.env.PROBE_BASE || 'https://ssdi-crm.vercel.app'
const login = await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: env.VITE_SUPABASE_ANON_KEY, 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'admin@americanbenefitsadvocates.org', password: 'Devil$8381' }),
}).then((r) => r.json())
const ref = new URL(env.VITE_SUPABASE_URL).hostname.split('.')[0]

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: BASE + '/', pretendToBeVisual: true })
const { window } = dom
window.matchMedia = window.matchMedia || ((q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }))
window.scrollTo = () => {}
for (const k of ['window', 'document', 'localStorage', 'sessionStorage', 'history', 'location', 'HTMLElement', 'CustomEvent', 'Event', 'Node', 'Element', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia', 'scrollTo']) { try { globalThis[k] = window[k] } catch {} }
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true })
window.localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(login))

const errors = []
window.addEventListener('error', (e) => errors.push(String(e.error?.message || e.message).slice(0, 200)))

const realFetch = globalThis.fetch
globalThis.fetch = (input, init) =>
  typeof input === 'string' && input.startsWith('/') ? realFetch(BASE + input, init) : realFetch(input, init)

const { createServer: createViteServer } = await import('vite')
const vite = await createViteServer({ root: ROOT.replace(/[\\/]+$/, ''), server: { middlewareMode: true }, appType: 'custom', logLevel: 'error', cacheDir: 'node_modules/.vite-probe' })
const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { ToastProvider } = await vite.ssrLoadModule('/src/ui.jsx')
const { AuthProvider } = await vite.ssrLoadModule('/src/auth.jsx')
const AppMod = await vite.ssrLoadModule('/src/App.jsx')
const App = AppMod.default || AppMod.App

// every real lead in production
const authz = { authorization: `Bearer ${login.access_token}` }
const leads = await realFetch(BASE + '/api/leads?limit=200', { headers: authz }).then((r) => r.json())
const ids = (leads.rows || []).map((l) => l.id)
console.log(`probing ${ids.length} real lead detail page(s)…`)

async function probe(url) {
  window.history.pushState({}, '', url)
  const el = window.document.getElementById('root')
  el.innerHTML = ''
  const before = errors.length
  const root = createRoot(el)
  try {
    root.render(React.createElement(React.StrictMode, null,
      React.createElement(ToastProvider, null,
        React.createElement(AuthProvider, null, React.createElement(App)))))
    await new Promise((r) => setTimeout(r, 2500))
    root.unmount()
    await new Promise((r) => setTimeout(r, 500))
  } catch (e) { errors.push('sync: ' + e.message) }
  const errs = errors.slice(before)
  if (errs.length) console.log(`💥 ${url}: ${errs[0]}`)
  else console.log(`✅ ${url}`)
  return errs.length
}

let bad = 0
for (const id of ids) bad += await probe(`/leads/${id}`)
console.log(bad ? `\n${bad} crashing lead page(s)` : '\n✅ all lead pages render')
process.exit(bad ? 1 : 0)
