import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co',
  import.meta.env.VITE_SUPABASE_ANON_KEY || 'public-anon-key'
)

export async function api(path, opts = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`/api${path}`, {
    method: opts.method || 'GET',
    headers: {
      'content-type': 'application/json',
      ...(session ? { authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

// Upload a File to a Supabase signed-upload URL
export async function uploadToSignedUrl(signedUrl, file) {
  const res = await fetch(signedUrl, {
    method: 'PUT',
    headers: { 'content-type': file.type || 'application/octet-stream', 'x-upsert': 'true' },
    body: file,
  })
  if (!res.ok) throw new Error(`Upload failed (${res.status})`)
}
