// Scheduled-task routes — work as Vercel crons (/api/cron/*) AND stay
// reachable on Netlify through the /api/* redirect. Protected by
// CRON_SECRET when the env var is set (Vercel sends it as a Bearer header).
import { route } from './_router.mjs'
import { json, fail, getSetting } from './_lib.mjs'

const cronGuard = ({ req }) => {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  const auth = req.headers.get('authorization') || ''
  return auth === `Bearer ${secret}`
}

route('GET', 'cron/daily-digest', async ({ req, context }) => {
  if (!cronGuard({ req })) return fail('Unauthorized', 401)
  const m = await import('../daily-digest.mjs')
  const result = await m.default()
  return json({ ok: true, result: result || null })
})

route('GET', 'cron/sheets-sync', async ({ req }) => {
  if (!cronGuard({ req })) return fail('Unauthorized', 401)
  const m = await import('../sheets-sync.mjs')
  const result = await m.default()
  return json({ ok: true, result: result || null })
})

route('GET', 'track-open', async ({ req }) => {
  const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const t = new URL(req.url).searchParams.get('t')
  if (t && UUID_RE.test(t)) {
    try {
      const { leadId, error } = await (await import('./_lib.mjs')).service.rpc('increment_email_open', { p_id: t })
      if (!error && leadId) {
        await (await import('./_lib.mjs')).service.from('activities').insert({
          lead_id: leadId, user_id: null, type: 'email_opened',
          title: '📧 Email opened', detail: { message_id: t },
        })
      }
    } catch {}
  }
  return new Response(GIF, { headers: { 'content-type': 'image/gif', 'cache-control': 'no-store, max-age=0' } })
})
