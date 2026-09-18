import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co',
  import.meta.env.VITE_SUPABASE_ANON_KEY || 'public-anon-key'
)

// Typed error so callers/UI can branch on status without string-matching.
export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message)
    this.status = status
  }
}

const DEFAULT_TIMEOUT = 30000

// Maps raw failures to clear, non-technical messages with recovery steps.
export function describeError(e) {
  if (e instanceof ApiError) return e.message
  if (e?.name === 'AbortError') return 'The request timed out. Check your connection and try again.'
  if (e instanceof TypeError) return 'You appear to be offline. Reconnect and try again — your data is safe.'
  return e?.message || 'Something went wrong. Please try again.'
}

// Fired when the session can't be recovered → App signs the user out gracefully.
function sessionExpired() {
  window.dispatchEvent(new CustomEvent('leaddesk:session-expired'))
}

async function rawRequest(path, opts) {
  // getSession auto-refreshes expired tokens before we read them
  const { data: { session } } = await supabase.auth.getSession()
  // Every request gets a hard timeout so a hung connection can never leave
  // a button stuck in "loading" forever.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeout || DEFAULT_TIMEOUT)
  try {
    return await fetch(`/api${path}`, {
      method: opts.method || 'GET',
      headers: {
        'content-type': 'application/json',
        ...(session ? { authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

export async function api(path, opts = {}) {
  let res
  try {
    res = await rawRequest(path, opts)
  } catch (e) {
    if (e.name === 'AbortError') throw new ApiError('The server took too long to respond. Check your connection and try again.', 0)
    throw new ApiError('You appear to be offline. Reconnect and try again — nothing was lost.', 0)
  }

  // 401 → the access token expired mid-session (they happen after ~1h).
  // Try one silent token refresh + retry before giving up; only if that
  // fails do we surface "session expired" and sign the user out cleanly.
  if (res.status === 401) {
    if (!opts._retried) {
      const { error } = await supabase.auth.refreshSession().catch(() => ({ error: { message: 'refresh failed' } }))
      if (!error) return api(path, { ...opts, _retried: true })
    }
    sessionExpired()
    throw new ApiError('Your session expired. Please sign in again.', 401)
  }

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new ApiError(
      data.error || `Something went wrong on our side (${res.status}). Please try again in a moment.`,
      res.status
    )
  }
  return data
}

// Upload a File to a Supabase Storage signed-upload URL.
// No timeout here on purpose — large recordings can legitimately take minutes.
export async function uploadToSignedUrl(signedUrl, file) {
  let res
  try {
    res = await fetch(signedUrl, {
      method: 'PUT',
      headers: { 'content-type': file.type || 'application/octet-stream', 'x-upsert': 'true' },
      body: file,
    })
  } catch {
    throw new ApiError('Upload failed — check your connection and try again.', 0)
  }
  if (!res.ok) throw new ApiError(`The file couldn't be uploaded (server said ${res.status}). Try again, or use a smaller file.`, res.status)
}
