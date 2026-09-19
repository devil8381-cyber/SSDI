// Meta token diagnostic: decrypts the stored CAPI token, asks the Graph API
// what identity the token has and whether it can see the dataset.
// Never prints the full token — only a masked prefix.
import { readFileSync } from 'node:fs'
import crypto from 'node:crypto'

const env = {}
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Za-z_]+)=(.*)\s*$/)
  if (m) env[m[1]] = m[2]
}
const key = Buffer.from(env.APP_ENCRYPTION_KEY || '', 'hex')
const decrypt = (payload) => {
  try {
    const [iv, tag, enc] = String(payload).split('.').map((s) => Buffer.from(s, 'base64'))
    const d = crypto.createDecipheriv('aes-256-gcm', key, iv)
    d.setAuthTag(tag)
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8')
  } catch (e) { return `DECRYPT_FAIL: ${e.message}` }
}

const sbRes = await fetch(`${env.SUPABASE_URL}/rest/v1/settings?select=value&key=eq.meta`, {
  headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
}).then((r) => r.json())
const meta = Array.isArray(sbRes) ? (sbRes[0]?.value || {}) : {}
if (!Array.isArray(sbRes)) console.log('supabase query issue:', JSON.stringify(sbRes).slice(0, 200))
const token = meta.capi_token ? decrypt(meta.capi_token) : ''
const mask = token.startsWith('EAA') ? token.slice(0, 10) + '…(' + token.length + ' chars)' : token.slice(0, 30)
console.log('token present:', !!meta.capi_token, '| looks like:', mask)
if (!token.startsWith('EAA')) { console.log('cannot diagnose further'); process.exit(1) }

const g = async (path) => {
  const r = await fetch(`https://graph.facebook.com/v21.0/${path}${path.includes('?') ? '&' : '?'}access_token=${token}`)
  return { status: r.status, body: await r.json() }
}

console.log('\n— WHO is this token? /me?metadata=1')
const me = await g('me?metadata=1')
console.log(JSON.stringify(me.body, null, 1).slice(0, 700))

console.log('\n— Can it see dataset 1857851432256517?')
const ds = await g('1857851432256517?metadata=1&fields=id,name,category')
console.log(JSON.stringify(ds.body, null, 1).slice(0, 500))

console.log('\n— Businesses the token belongs to:')
const biz = await g('me/businesses?fields=id,name')
console.log(JSON.stringify(biz.body, null, 1).slice(0, 400))

console.log('\n— Pages the token can reach:')
const pages = await g('me/accounts?fields=id,name')
console.log(JSON.stringify(pages.body, null, 1).slice(0, 500))
