// Client-side {{variable}} rendering — same syntax as the server-side email
// templates, used for copying text/SMS templates to the clipboard.
export function renderTemplate(tpl, vars) {
  return String(tpl || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (vars[k] ?? ''))
}
