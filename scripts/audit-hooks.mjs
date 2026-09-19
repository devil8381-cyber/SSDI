// AST audit: flags any React hook called at a component's top level AFTER a
// `return` statement in the same function body — the "Rendered more hooks /
// destroy is not a function" bug class (Rules of Hooks violation).
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import * as acornNS from 'acorn'
import jsx from 'acorn-jsx'

const acorn = acornNS.default ?? acornNS
const Parser = acorn.Parser.extend(jsx())
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

const HOOK_RE = /^use[A-Z]/
const findings = []

function fnName(node, src) {
  if (node.id?.name) return node.id.name
  if (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') {
    // walk up handled by caller — approximate with a text slice
    return src.slice(node.start, node.start + 40).replace(/\s+/g, ' ')
  }
  return '<anon>'
}

function audit(fn, src, file, owner) {
  if (fn.body?.type !== 'BlockStatement') return
  const isHookOwner = false
  // direct-level statements only
  let lastReturn = -1
  for (const st of fn.body.body) {
    if (st.type === 'ReturnStatement') {
      lastReturn = st.start
      continue
    }
    // early-return guards: `if (cond) return <jsx/>` or `if (cond) { return ... }`
    if (st.type === 'IfStatement' && !st.alternate) {
      const c = st.consequent
      if (c.type === 'ReturnStatement') { lastReturn = c.start; continue }
      if (c.type === 'BlockStatement' && c.body.some((s2) => s2.type === 'ReturnStatement')) {
        lastReturn = c.start
        continue
      }
    }
    // hook calls directly in this statement (not inside nested functions)
    const check = (n) => {
      if (!n || typeof n !== 'object') return
      if (Array.isArray(n)) { n.forEach(check); return }
      if (n.type === 'ArrowFunctionExpression' || n.type === 'FunctionExpression' || n.type === 'FunctionDeclaration') return
      if (n.type === 'CallExpression' && HOOK_RE.test(src.slice(n.callee.start, n.callee.end)) && lastReturn !== -1) {
        findings.push({ file, line: src.slice(0, n.start).split('\n').length, owner, hook: src.slice(n.callee.start, n.callee.end), afterLine: src.slice(0, lastReturn).split('\n').length })
      }
      for (const k of Object.keys(n)) if (k !== 'start' && k !== 'end') check(n[k])
    }
    check(st)
  }
  // recurse into nested functions
  const recur = (n) => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) { n.forEach(recur); return }
    if (n.type === 'ArrowFunctionExpression' || n.type === 'FunctionExpression' || n.type === 'FunctionDeclaration') {
      const name = n.id?.name || owner
      audit(n, src, file, name)
    }
    for (const k of Object.keys(n)) if (k !== 'start' && k !== 'end') recur(n[k])
  }
  fn.body.body.forEach(recur)
}

for (const file of files) {
  const src = readFileSync(file, 'utf8')
  let ast
  try {
    ast = Parser.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: false })
  } catch (e) {
    console.log(`PARSE FAIL ${file}: ${e.message}`)
    continue
  }
  ;(function visit(n, owner) {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) { n.forEach((x) => visit(x, owner)); return }
    if ((n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression')) {
      const name = n.id?.name || owner || fnName(n, src)
      audit(n, src, file, name)
    }
    for (const k of Object.keys(n)) if (k !== 'start' && k !== 'end') visit(n[k], owner)
  })(ast, null)
}

for (const f of findings) {
  console.log(`${f.file.replace(/\\/g, '/').split('leaddesk/')[1]}:${f.line} — ${f.hook} called after a return (line ${f.afterLine}) in <${f.owner}>`)
}
console.log(`\n${findings.length} hook-order violation(s)`)
