// Click-to-call configuration: which app opens when an agent clicks a phone
// number. Admin sets it under Admin → Automation → Calling app.
//   tel:     → Windows default calling app (set Phound as the default for "tel:" links)
//   phound:  → opens the Phound desktop app directly
//   callto:  → for softphones that register "callto:"
//   custom   → any template containing {number}, e.g. phound://dial/{number}
let config = { scheme: 'tel', template: '' }

export function setCallConfig(cfg) {
  if (cfg && cfg.scheme) config = { scheme: cfg.scheme, template: cfg.template || '' }
}

export function getCallHref(phone) {
  const digits = String(phone || '').replace(/[^\d+]/g, '')
  if (!digits) return null
  if (config.scheme === 'custom' && config.template) return config.template.replace('{number}', digits)
  return `${config.scheme}:${digits}`
}
