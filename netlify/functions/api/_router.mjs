export const routes = []

export function route(method, pattern, handler) {
  routes.push({ method, parts: pattern.split('/').filter(Boolean), handler })
}

function match(parts, segs) {
  if (parts.length !== segs.length) return null
  const params = {}
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(segs[i])
    else if (p !== segs[i]) return null
  }
  return params
}

export async function handle(req, context) {
  const url = new URL(req.url)
  let path = url.pathname
  path = path.replace(/^\/\.netlify\/functions\/api\/?/, '')
  path = path.replace(/^\/api\/?/, '')
  const segs = path.split('/').filter(Boolean)

  let raw = null
  let body
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    raw = await req.text()
    try {
      body = JSON.parse(raw)
    } catch {
      body = {}
    }
  }

  for (const r of routes) {
    if (r.method !== req.method) continue
    const params = match(r.parts, segs)
    if (params) return r.handler({ req, url, params, context, body, raw, query: url.searchParams })
  }
  const { fail } = await import('../_lib.mjs')
  return fail('Not found', 404)
}
