// Lightweight form validation + sanitization utilities.
// Custom (dependency-free) so the whole team's forms behave identically and
// validation mirrors the server-side normalization in the Netlify functions.

// Each validator returns an error string or null. Compose per field:
//   validateForm(values, { email: [required('Email'), emailRule()] })

export const required = (label) => (v) =>
  v === undefined || v === null || String(v).trim() === '' ? `${label} is required` : null

export const emailRule = () => (v) => {
  if (!v || !String(v).trim()) return null // emptiness is `required`'s job
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v).trim())
    ? null
    : 'Enter a valid email address (e.g. name@company.com)'
}

export const phoneRule = () => (v) => {
  if (!v || !String(v).trim()) return null
  const digits = String(v).replace(/\D/g, '')
  return digits.length >= 7 && digits.length <= 15 ? null : 'Enter a valid phone number (7–15 digits)'
}

export const minLen = (n) => (v) =>
  !v || String(v).length >= n ? null : `Must be at least ${n} characters`

export const maxLen = (n) => (v) =>
  !v || String(v).length <= n ? null : `Must be ${n} characters or fewer`

export const oneOf = (list) => (v) =>
  !v || list.includes(v) ? null : 'Choose a value from the list'

// Runs the schema and returns { field: firstErrorMessage } — empty object = valid.
export function validateForm(values, schema) {
  const errors = {}
  for (const [field, rules] of Object.entries(schema)) {
    for (const rule of rules || []) {
      const err = rule(values[field])
      if (err) {
        errors[field] = err
        break
      }
    }
  }
  return errors
}

// Outgoing text normalization: trim, strip control characters, cap length.
// Mirrors the server so what you type is exactly what gets stored.
export function sanitizeText(v, max = 500) {
  if (v === undefined || v === null) return ''
  return String(v)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trim()
    .slice(0, max)
}
