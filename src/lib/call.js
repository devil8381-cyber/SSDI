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

// WhatsApp click-to-chat (WhatsApp's official wa.me feature — no API, no ban
// risk). Opens WhatsApp on the customer's chat with an optional pre-typed
// message. US leads: 10 digits → prepend the 1 country code.
export function getWhatsAppHref(phone, message) {
  const d = String(phone || '').replace(/\D/g, '')
  if (d.length < 10) return null
  const digits = d.length === 10 ? '1' + d : d
  return message
    ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
    : `https://wa.me/${digits}`
}
