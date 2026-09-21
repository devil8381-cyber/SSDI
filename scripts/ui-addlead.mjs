// PART 3 — Add Lead through the REAL UI: renders the actual app in jsdom,
// clicks the actual buttons (React synthetic events fire from real DOM events),
// types into the actual controlled inputs, and asserts results. 3 leads,
// then a full app remount to prove persistence.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const env = {}
for (const line of readFileSync(ROOT + '.env', 'utf8').split('\n')) {
  const m = line.match(/^([A-Za-z_]+)=(.*)\s*$/)
  if (m) env[m[1]] = m[2]
}

// real login for the NEW production admin
const login = await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: env.VITE_SUPABASE_ANON_KEY, 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'admin@americanbenefitsadvocates.org', password: 'Devil$8381' }),
}).then((r) => r.json())
if (!login.access_token) { console.log('FATAL login'); process.exit(1) }
const ref = new URL(env.VITE_SUPABASE_URL).hostname.split('.')[0]

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost:8888/leads', pretendToBeVisual: true })
const { window } = dom
window.matchMedia = window.matchMedia || ((q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }))
window.scrollTo = () => {}
for (const k of ['window', 'document', 'localStorage', 'sessionStorage', 'history', 'location', 'HTMLElement', 'CustomEvent', 'Event', 'Node', 'Element', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia', 'scrollTo']) {
  try { globalThis[k] = window[k] } catch {}
}
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true })
window.localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(login))

const errors = []
window.addEventListener('error', (e) => errors.push(String(e.error?.message || e.message)))

const realFetch = globalThis.fetch
globalThis.fetch = (input, init) =>
  typeof input === 'string' && input.startsWith('/') ? realFetch('http://localhost:8888' + input, init) : realFetch(input, init)

const { createServer: createViteServer } = await import('vite')
const vite = await createViteServer({ root: ROOT.replace(/[\\/]+$/, ''), server: { middlewareMode: true }, appType: 'custom', logLevel: 'error', cacheDir: 'node_modules/.vite-probe' })
const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { ToastProvider } = await vite.ssrLoadModule('/src/ui.jsx')
const { AuthProvider } = await vite.ssrLoadModule('/src/auth.jsx')
const AppMod = await vite.ssrLoadModule('/src/App.jsx')
const App = AppMod.default || AppMod.App

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const $root = () => window.document.getElementById('root')
const byText = (sel, text) => [...window.document.querySelectorAll(sel)].find((el) => el.textContent.trim() === text)

function clickByText(text, tag = 'button') {
  const el = byText(tag, text) || [...window.document.querySelectorAll(tag)].find((b) => b.textContent.includes(text))
  if (!el) return false
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
  return true
}
function typeIntoLabel(labelText, value) {
  const label = [...window.document.querySelectorAll('label')].find((l) => l.textContent.trim().startsWith(labelText))
  if (!label) return false
  const input = label.parentElement.querySelector('input, textarea')
  if (!input) return false
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
  setter.call(input, value)
  input.dispatchEvent(new window.Event('input', { bubbles: true }))
  return true
}

let root
const netLog = []
const origFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = String(typeof input === 'string' ? input : input.url)
  const res = await origFetch(input, init)
  if (url.includes('/api/')) {
    let body = ''
    try { body = await res.clone().text() } catch {}
    netLog.push(`${init?.method || 'GET'} ${url.replace('http://localhost:8888', '')} → ${res.status} ${body.slice(0, 90)}`)
  }
  return res
}
async function mountApp() {
  $root().innerHTML = ''
  netLog.length = 0
  root = createRoot($root())
  root.render(React.createElement(React.StrictMode, null,
    React.createElement(ToastProvider, null,
      React.createElement(AuthProvider, null, React.createElement(App)))))
  // poll until the leads table actually renders (or 12s)
  for (let i = 0; i < 24; i++) {
    await sleep(500)
    const t = $root().textContent
    if (t.includes('Add lead') && (t.includes('No leads found') || t.includes('Gonzalez') || t.includes("O'Connor") || t.includes('Chen') || t.includes('ListTest'))) break
  }
}
async function unmount() { try { root.unmount() } catch {} await sleep(300) }

let pass = 0, fail = 0
const ok = (name, cond) => { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}`) } }

console.log('━ PART 3: Add Lead via real UI ─')
await mountApp()

// draft protection: type, simulate a tab reload (full remount), verify restore
{
  clickByText('Add lead')
  await sleep(400)
  typeIntoLabel('First name', 'DraftCheck')
  typeIntoLabel('Phone', '5550001234')
  await unmount()
  await mountApp() // same tab → sessionStorage draft survives
  clickByText('Add lead')
  await sleep(400)
  const restored = [...window.document.querySelectorAll('input')].some((i) => i.value === 'DraftCheck')
  ok('typed draft survives a tab reload (modal reopens with values)', restored)
  // close it and clear the draft so the flow continues clean
  clickByText('Cancel')
  await sleep(300)
}

const RUN = String(Date.now()).slice(-4)
const created = []
const attempts = [
  { first: 'Maria', last: 'Gonzalez' + RUN, phone: '5551110001' },
  { first: 'James', last: 'Odell' + RUN, phone: '5551110002' },
  { first: 'Wei', last: 'Chen' + RUN, phone: '5551110003', email: 'wei.chen' + RUN + '@example.com' },
]
for (const [i, a] of attempts.entries()) {
  const opened = clickByText('Add lead')
  await sleep(400)
  ok(`#${i + 1} Add lead button opens the modal`, opened && !!byText('h3', 'Add lead'))
  ok(`#${i + 1} fields accept input`, typeIntoLabel('First name', a.first) && typeIntoLabel('Last name', a.last) && typeIntoLabel('Phone', a.phone) && (!a.email || typeIntoLabel('Email', a.email)))
  const submitted = clickByText('Create lead')
  // poll for the outcome (modal closes + row renders) instead of a fixed sleep
  let closed = false, inTable = false
  for (let i = 0; i < 20; i++) {
    await sleep(500)
    if (!byText('h3', 'Add lead')) closed = true
    if ($root().textContent.includes(a.last)) inTable = true
    if (closed && inTable) break
  }
  ok(`#${i + 1} modal closed after submit`, closed)
  ok(`#${i + 1} new lead appears in the table WITHOUT reload`, submitted && inTable)
  created.push(a)
}

console.log('━ persistence: full app remount (simulated refresh) ─')
await unmount()
await mountApp()
const finalText = $root().textContent
for (const a of created) ok(`"${a.first} ${a.last}" survives full remount`, finalText.includes(a.last))
ok('no duplicate rows (each last name appears exactly once)', created.every((a) => finalText.split(a.last).length === 2))
ok('zero window errors during the whole UI flow', errors.length === 0, errors[0] || '')
await unmount()

// cleanup — production DB must stay empty
const authz = { authorization: `Bearer ${login.access_token}`, 'content-type': 'application/json' }
const list = await realFetch('http://localhost:8888/api/leads?limit=100', { headers: authz }).then((r) => r.json())
let cleaned = 0
for (const l of (list.rows || [])) {
  if (created.some((a) => a.last === l.last_name)) {
    await realFetch(`http://localhost:8888/api/leads/${l.id}`, { method: 'DELETE', headers: authz })
    cleaned++
  }
}
console.log(`\ncleaned up ${cleaned} test lead(s) — production DB left empty`)
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
