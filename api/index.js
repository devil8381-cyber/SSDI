// Vercel entry point — adapts the Web-standard router (shared with Netlify)
// to Vercel's Node function signature. Same code runs on both hosts.
import { handle } from '../netlify/functions/api/_router.mjs'
// registering ALL routes (core, leads, emails, docs, recordings, meta, cron)
import '../netlify/functions/api/api.mjs'

// waitUntil shim: queued background work (welcome emails, follow-up rules,
// CAPI signals) is flushed BEFORE the response closes so it reliably
// completes on Vercel. Capped at 25s so a dead SMTP server can never hang it.
const pending = []
const context = {
  waitUntil: (p) => {
    try { pending.push(Promise.resolve(p).catch((e) => console.error('waitUntil task failed:', e?.message || e))) } catch {}
  },
}

function nodeReqToWeb(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https'
  // Vercel's legacy route rewrite replaces req.url with the DESTINATION — the
  // original client path arrives in the x-original-path header, and the query
  // string rides on req.url. Reassemble both.
  const original = req.headers['x-original-path'] || req.url
  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''
  const url = `${proto}://${req.headers.host || 'localhost'}${original}${qs}`
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers || {})) {
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x))
    else if (v !== undefined) headers.set(k, String(v))
  }
  const method = (req.method || 'GET').toUpperCase()
  if (['GET', 'HEAD'].includes(method)) return new Request(url, { method, headers })
  return new Request(url, { method, headers, body: req, duplex: 'half' })
}

export default async function handler(req, res) {
  try {
    const webRes = await handle(nodeReqToWeb(req), context)
    const buf = Buffer.from(await webRes.arrayBuffer())
    if (pending.length) await Promise.race([Promise.allSettled(pending.splice(0)), new Promise((r) => setTimeout(r, 25000))])
    res.statusCode = webRes.status
    webRes.headers.forEach((v, k) => {
      if (k.toLowerCase() !== 'content-encoding') res.setHeader(k, v)
    })
    res.setHeader('content-length', buf.length)
    res.end(buf)
  } catch (e) {
    console.error('api error:', e)
    res.statusCode = 500
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ error: e.message || 'Server error' }))
  }
}
