// Re-points ssdi-crm.vercel.app to the latest production deployment.
// Manual Vercel aliases are pinned to one deployment — this must run after
// every `vercel --prod` or the domain keeps serving stale code.
import { readFileSync } from 'node:fs'
const env = {}
for (const l of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) { const m = l.match(/^([A-Za-z_]+)=(.*)\s*$/); if (m) env[m[1]] = m[2] }
const TOKEN = env.VERCEL_TOKEN
if (!TOKEN) { console.log('Set VERCEL_TOKEN in .env'); process.exit(1) }
;(async () => {
  const list = await fetch('https://api.vercel.com/v6/deployments?teamId=team_DoPRFweb7AgZUzK8iGYbU0t1&projectId=prj_Rlbu0sePUip3RaBX7UVia6eAECNp&limit=1&target=production', { headers: { authorization: 'Bearer ' + TOKEN } }).then((r) => r.json())
  const latest = list.deployments[0]
  const r = await fetch('https://api.vercel.com/v2/deployments/' + latest.uid + '/aliases?teamId=team_DoPRFweb7AgZUzK8iGYbU0t1', {
    method: 'POST', headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify({ alias: 'ssdi-crm.vercel.app' }),
  }).then((r) => r.json())
  console.log(r.error ? 'alias FAILED: ' + JSON.stringify(r.error) : 'ssdi-crm.vercel.app → ' + latest.url)
})()
