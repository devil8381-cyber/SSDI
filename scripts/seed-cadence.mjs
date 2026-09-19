// Seeds the 5-day outreach cadence as copy-paste text templates (VM + SMS per day).
//   node scripts/seed-cadence.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const env = Object.fromEntries(
  fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
)
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const D = '[Direct Number]'
const N = '{{agent_name}}'
const T = (name, body) => ({ type: 'text', name, subject: null, body })

// Exact VM + text scripts from the ABA playbook, one template per touchpoint.
const CADENCE = [
  T('Day 1 — Voicemail (1st attempt)', `Day 1 — Voicemail (1st attempt)\n\nHi {{first_name}}, this is ${N} calling from American Benefits Advocates. You recently reached out to us about your Social Security Disability claim, and I wanted to personally give you a call to go over your file. There's a specific window of time that matters with these cases, and I don't want yours to lose momentum. Please call me back as soon as you can at ${D} — again, that's ${N} at ${D}. I'll try you again shortly, but please don't hesitate to reach out first. Talk soon.`),
  T('Day 1 — Voicemail (2nd attempt)', `Day 1 — Voicemail (2nd attempt)\n\nHi {{first_name}}, it's ${N} again from American Benefits Advocates. I know life gets busy, so I wanted to try you one more time today. When you get a chance, please call me back at ${D} so we can go over your Social Security Disability file together — it'll only take a few minutes. Talk soon.`),
  T('Day 1 — Text', `Day 1 — Text\n\nHi {{first_name}}, this is ${N} with American Benefits Advocates. I tried reaching you about your SSDI case — when you have a few minutes today, please call me back at ${D}. Reply STOP to opt out.`),
  T('Day 2 — Voicemail (1st attempt)', `Day 2 — Voicemail (1st attempt)\n\nHi {{first_name}}, this is ${N} from American Benefits Advocates. I tried reaching you yesterday about your Social Security Disability claim. I still have your file open and ready to review — I just need a few minutes of your time. Please call me back at ${D} whenever works for you this morning. Thank you.`),
  T('Day 2 — Voicemail (2nd attempt)', `Day 2 — Voicemail (2nd attempt)\n\nHi {{first_name}}, it's ${N} again from American Benefits Advocates, following up on your Social Security Disability case. I know mornings can be hectic, so I wanted to try you again this evening. If a different time is easier, just call me back at ${D} and let me know — I'm glad to work around your schedule. Take care.`),
  T('Day 2 — Text', `Day 2 — Text\n\nHi {{first_name}}, ${N} here from American Benefits Advocates. Still holding your SSDI file open — call me back at ${D} whenever's convenient today. Happy to work around your schedule. Reply STOP to opt out.`),
  T('Day 3 — Voicemail (1st attempt)', `Day 3 — Voicemail (1st attempt)\n\nHi {{first_name}}, this is ${N} calling again from American Benefits Advocates about your disability claim. I want to make sure we don't miss any important deadlines on your case. When you get a moment, please call me back at ${D} — I'd really like to help you get this moving.`),
  T('Day 3 — Voicemail (2nd attempt)', `Day 3 — Voicemail (2nd attempt)\n\nHi {{first_name}}, it's ${N} following up one more time today. Your Social Security Disability file is still open on my end, and I'd hate for you to lose time on this. Please call me back at ${D} so we can talk through your options.`),
  T('Day 3 — Text', `Day 3 — Text\n\nHi {{first_name}}, it's ${N} with American Benefits Advocates — checking in again on your SSDI claim. Give me a call at ${D} when you can, I want to make sure you don't lose time on this. Reply STOP to opt out.`),
  T('Day 4 — Voicemail (1st attempt)', `Day 4 — Voicemail (1st attempt)\n\nHi {{first_name}}, this is ${N} from American Benefits Advocates. I've reached out a few times about your Social Security Disability claim and haven't connected with you yet. I want to make sure your file gets the attention it deserves. Please call me back at ${D} today if you're still interested in moving forward.`),
  T('Day 4 — Voicemail (2nd attempt)', `Day 4 — Voicemail (2nd attempt)\n\nHi {{first_name}}, it's ${N} again. I'll keep this short — I still have your Social Security Disability file open, and I want to help if you're still looking to move forward. Call me back anytime at ${D}. If I don't hear back soon, I'll follow up one final time tomorrow.`),
  T('Day 4 — Text', `Day 4 — Text\n\nHi {{first_name}}, ${N} here from American Benefits Advocates. I haven't been able to connect with you yet about your SSDI claim — if you're still interested, please call ${D} today. Reply STOP to opt out.`),
  T('Day 5 — Voicemail (final attempt)', `Day 5 — Voicemail (final attempt)\n\nHi {{first_name}}, this is ${N} from American Benefits Advocates, following up one last time about your Social Security Disability claim. I completely understand if now isn't the right time. If you'd still like help with your case, please call me back at ${D} — I'm happy to pick back up whenever you're ready. If I don't hear from you, I'll close out this round of outreach, but you're always welcome to reach us directly.`),
  T('Day 5 — Voicemail (evening, if needed)', `Day 5 — Voicemail (evening, if needed)\n\nHi {{first_name}}, it's ${N}, one more time from American Benefits Advocates. This will be my last call for now — I don't want to keep bothering you. If you'd like to talk about your Social Security Disability claim, my direct line is ${D}, and our office is always open too. Wishing you all the best.`),
  T('Day 5 — Text (final attempt)', `Day 5 — Text (final attempt)\n\nHi {{first_name}}, this is ${N} with American Benefits Advocates — this is my last check-in on your SSDI claim for now. If you'd like to talk, call ${D} anytime, we're happy to help whenever you're ready. Reply STOP to opt out.`),
]

async function main() {
  let added = 0, updated = 0
  for (const t of CADENCE) {
    const { data: existing } = await sb.from('templates').select('id').eq('name', t.name).eq('type', 'text').maybeSingle()
    if (existing) { const { error } = await sb.from('templates').update({ body: t.body }).eq('id', existing.id); if (error) throw error; updated++ }
    else { const { error } = await sb.from('templates').insert(t); if (error) throw error; added++ }
  }
  console.log(`✅ Cadence templates: ${added} added, ${updated} updated (${CADENCE.length} total)`)
}
main().catch((e) => { console.error('✖', e.message); process.exit(1) })
