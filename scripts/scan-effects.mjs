// Scans src/**/*.{jsx,js} for useEffect/useLayoutEffect calls whose
// effect callback can return a non-function (Promise, interval id, etc.)
// — the class of bug that crashes React StrictMode with
// "destroy is not a function".
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(process.cwd(), 'src')
const files = []
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.(jsx|js)$/.test(f)) files.push(p)
  }
}
walk(SRC)

function balanced(src, start) {
  // start = index of '(' — returns content up to matching ')' and the end index
  let depth = 0, i = start, inStr = null
  for (; i < src.length; i++) {
    const c = src[i], prev = src[i - 1]
    if (inStr) {
      if (c === inStr && prev !== '\\') inStr = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue }
    if (c === '(') depth++
    else if (c === ')') { depth--; if (depth === 0) return { body: src.slice(start + 1, i), end: i } }
  }
  return { body: src.slice(start + 1), end: i }
}

// split top-level commas (respecting nesting, strings, and arrow params)
function splitTop(s) {
  const parts = []
  let depth = 0, inStr = null, cur = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i], prev = s[i - 1]
    if (inStr) { cur += c; if (c === inStr && prev !== '\\') inStr = null; continue }
    if (c === '"' || c === "'" || c === '`') { inStr = c; cur += c; continue }
    if (c === '(' || c === '[' || c === '{') depth++
    if (c === ')' || c === ']' || c === '}') depth--
    if (c === ',' && depth === 0) { parts.push(cur); cur = '' } else cur += c
  }
  if (cur.trim()) parts.push(cur)
  return parts
}

const findings = []
for (const file of files) {
  const src = readFileSync(file, 'utf8')
  for (const hook of ['useEffect', 'useLayoutEffect']) {
    let idx = 0
    while ((idx = src.indexOf(hook + '(', idx)) !== -1) {
      const before = src.slice(Math.max(0, idx - 1), idx)
      if (/\w/.test(before)) { idx += 9; continue } // skip e.g. React.useEffect? keep simple
      const { body, end } = balanced(src, idx + hook.length)
      idx = end
      const args = splitTop(body)
      const eff = (args[0] || '').trim()
      const line = src.slice(0, idx).split('\n').length
      const tag = `${file.replace(/\\/g, '/')}:${line}`
      // plain identifier: useEffect(load, ...)
      if (/^[A-Za-z_$][\w$]*$/.test(eff)) { findings.push({ tag, hook, kind: 'identifier', eff }); continue }
      const m = eff.match(/^\(([^)]*)\)\s*=>\s*([\s\S]*)$/) || eff.match(/^([A-Za-z_$][\w$]*)\s*=>\s*([\s\S]*)$/)
      if (!m) continue
      const body2 = m[2].trim()
      if (body2.startsWith('{')) {
        // block body — flag only if it contains a `return` keyword
        if (/\breturn\b/.test(body2)) findings.push({ tag, hook, kind: 'block-with-return', eff: body2.slice(0, 120) })
      } else {
        findings.push({ tag, hook, kind: 'expression', eff: body2.slice(0, 120) })
      }
    }
  }
}
for (const f of findings) console.log(`${f.kind.toUpperCase().padEnd(18)} ${f.tag}  ::  ${f.eff.replace(/\s+/g, ' ')}`)
console.log(`\n${findings.length} finding(s)`)
