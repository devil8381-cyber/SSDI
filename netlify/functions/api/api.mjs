import { handle } from './_router.mjs'
import { json } from '../_lib.mjs'
import './core.mjs'
import './leads.mjs'
import './emails.mjs'
import './docs.mjs'
import './recordings.mjs'
import './meta.mjs'

export default async (req, context) => {
  try {
    return await handle(req, context)
  } catch (e) {
    console.error('API error:', e)
    return json({ error: e.message || 'Server error' }, 500)
  }
}
