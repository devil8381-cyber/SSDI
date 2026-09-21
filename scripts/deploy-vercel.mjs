import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const env = {}
for (const l of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) { const m = l.match(/^([A-Za-z_]+)=(.*)\s*$/); if (m) env[m[1]] = m[2] }
const TOKEN = env.VERCEL_TOKEN
if (!TOKEN) { console.log('Set VERCEL_TOKEN in .env'); process.exit(1) }
const root = fileURLToPath(new URL('..', import.meta.url))
execSync(`vercel --prod --yes --token ${TOKEN}`, { cwd: root, stdio: 'inherit' })
// re-point the friendly alias at the fresh production deployment
execSync(`node scripts/alias-vercel.mjs`, { cwd: root, stdio: 'inherit' })
