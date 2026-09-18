import { service } from './_lib.mjs'

const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async (req) => {
  const t = new URL(req.url).searchParams.get('t')
  if (t && UUID_RE.test(t)) {
    try {
      const { data: leadId, error } = await service.rpc('increment_email_open', { p_id: t })
      if (!error && leadId) {
        await service.from('activities').insert({
          lead_id: leadId,
          user_id: null,
          type: 'email_opened',
          title: '📧 Email opened',
          detail: { message_id: t },
        })
      }
    } catch (e) {
      console.error('track-open', e)
    }
  }
  return new Response(GIF, {
    headers: {
      'content-type': 'image/gif',
      'cache-control': 'no-store, no-cache, must-revalidate, private',
    },
  })
}
