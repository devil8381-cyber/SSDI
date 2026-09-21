// Production readiness: wipe ALL demo data, create the real admin, and load
// the ABA Operations & Scripts Manual content as templates/scripts/rebuttals.
// Idempotent. Uses the service-role key — run: node scripts/seed-production.mjs
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = {}
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Za-z_]+)=(.*)\s*$/)
  if (m) env[m[1]] = m[2]
}
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const NEW_ADMIN = { email: 'admin@americanbenefitsadvocates.org', password: process.env.SEED_ADMIN_PASSWORD || '', name: 'Administrator' }
if (!NEW_ADMIN.password) { console.log('Set SEED_ADMIN_PASSWORD env var to run this script.'); process.exit(1) }
const DEMO_EMAILS = ['admin@demo.com', 'sarah@demo.com', 'mike@demo.com', 'rachel@demo.com']

const ADDR = 'American Benefits Advocates | 1250 H Street NW, Suite 605, Washington, DC 20005'
const FOOTER = `<p style="color:#64748b;font-size:11px">${ADDR}<br/>You are receiving this email because you submitted a request for help with a Social Security Disability claim. American Benefits Advocates is not the Social Security Administration and is not affiliated with, endorsed by, or acting on behalf of any U.S. government agency.</p>`

console.log('━ 1. Wiping demo data ─')
// bigint-id tables use gt(id,0); user_activity_days keys on (user_id, day); rest are uuid
for (const table of ['activities', 'meta_events', 'notifications']) {
  const { error, count } = await sb.from(table).delete({ count: 'exact' }).gt('id', 0)
  console.log(`  ${table}: ${error ? 'ERR ' + error.message : count + ' rows deleted'}`)
}
{
  const { error, count } = await sb.from('user_activity_days').delete({ count: 'exact' }).gte('day', '2000-01-01')
  console.log(`  user_activity_days: ${error ? 'ERR ' + error.message : count + ' rows deleted'}`)
}
for (const table of ['email_messages', 'documents', 'recordings', 'doc_requests', 'tasks', 'leads']) {
  const { error, count } = await sb.from(table).delete({ count: 'exact' }).neq('id', '00000000-0000-0000-0000-000000000000')
  console.log(`  ${table}: ${error ? 'ERR ' + error.message : count + ' rows deleted'}`)
}

console.log('━ 2. Removing demo users ─')
const { data: profs } = await sb.from('profiles').select('id,email')
for (const p of profs || []) {
  if (DEMO_EMAILS.includes(p.email) || /qa-user-|@demo\.com$|smoke.*@test\.com$/.test(p.email || '')) {
    const { error } = await sb.auth.admin.deleteUser(p.id)
    console.log(`  ${p.email}: ${error ? 'ERR ' + error.message : 'deleted'}`)
  }
}

console.log('━ 3. Creating the real admin ─')
{
  const { data: existing } = await sb.from('profiles').select('id').eq('email', NEW_ADMIN.email).maybeSingle()
  if (existing) {
    await sb.auth.admin.updateUserById(existing.id, { password: NEW_ADMIN.password, email_confirm: true })
    await sb.from('profiles').update({ role: 'admin', name: NEW_ADMIN.name, is_active: true }).eq('id', existing.id)
    console.log(`  ${NEW_ADMIN.email}: password reset, role admin`)
  } else {
    const { data: created, error } = await sb.auth.admin.createUser({
      email: NEW_ADMIN.email, password: NEW_ADMIN.password, email_confirm: true,
      user_metadata: { name: NEW_ADMIN.name },
    })
    if (error) { console.log('  ERR ' + error.message); process.exit(1) }
    await sb.from('profiles').upsert({ id: created.user.id, email: NEW_ADMIN.email, name: NEW_ADMIN.name, role: 'admin', is_active: true })
    console.log(`  ${NEW_ADMIN.email}: created`)
  }
}

console.log('━ 4. Loading manual content — templates ─')
await sb.from('templates').delete().neq('id', '00000000-0000-0000-0000-000000000000')
const templates = [
  {
    name: 'Agent Assigned — Welcome (ABA)', type: 'email',
    subject: 'Your SSDI File Has Been Assigned to a Claim Specialist',
    body: `<p>Hi {{first_name}},</p>
<p>Thank you for reaching out to American Benefits Advocates regarding your Social Security Disability (SSDI) claim. We know this process can feel overwhelming, and we're glad you took the first step.</p>
<p>Your file has been assigned to Claim Specialist {{agent_name}}, who will be calling you today from {{agent_phone}} to go over your case, answer your questions, and walk you through next steps. Please keep an eye out for his call.</p>
<p>Before he calls, please take two minutes to confirm your information and give us consent to review your file — this is required before we can begin:</p>
<p><a href="{{doc_link}}" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:10px 18px;border-radius:8px;font-weight:600;text-decoration:none">CONFIRM MY INFORMATION &amp; GET STARTED</a></p>
<p><b>What happens next:</b></p>
<ol><li>You complete the short form above (about 2 minutes)</li><li>{{agent_name}} calls to review your case with you</li><li>We identify what's needed to strengthen your file</li><li>If you're ready to move forward, we connect you with an experienced advocate partner — at no upfront cost to you</li></ol>
<p>If you have questions before {{agent_name}} calls, you can reach our office directly and we'll help.</p>
<p>We're glad you reached out, and we're here to help.</p>
<p>Warm regards,<br/>The American Benefits Advocates Team</p>
<p style="color:#64748b;font-size:11px">${ADDR}</p>${FOOTER}`,
  },
  {
    name: 'Document Request — Secure Upload', type: 'email',
    subject: "Action Needed: Upload Your Documents for {{first_name}}'s SSDI File",
    body: `<p>Hi {{first_name}},</p>
<p>Thanks for speaking with {{agent_name}} today. To keep your file moving, we need copies of a few supporting documents. Please use the secure link below — it's encrypted and only accessible to your assigned case team.</p>
<p><a href="{{doc_link}}" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:10px 18px;border-radius:8px;font-weight:600;text-decoration:none">UPLOAD MY DOCUMENTS SECURELY</a></p>
<p><b>Documents that help us build the strongest file for you:</b></p>
<ul><li>Photo ID (driver's license or state ID)</li><li>Most recent SSA denial letter or Notice of Decision (if applicable)</li><li>Medical records, or a list of the doctors and providers you've seen</li><li>Proof of work history (W-2s, pay stubs, or past employers)</li><li>Any correspondence you've received from the SSA</li></ul>
<p>If you don't have all of these on hand, that's okay — upload what you have, and we'll help you track down the rest. If you run into any trouble with the upload link, just reply to this email or call us.</p>
<p>Thank you for trusting us with your case.</p>
<p>{{agent_name}}, Claim Specialist</p>${FOOTER}`,
  },
  {
    name: 'Callback Scheduled', type: 'email',
    subject: 'Confirmed: Your Callback Is Scheduled for [Date] at [Time]',
    body: `<p>Hi {{first_name}},</p>
<p>This confirms your callback is scheduled for:</p>
<p><b>Date:</b> [Day, Date]<br/><b>Time:</b> [Time] ([Time Zone])<br/><b>Agent:</b> {{agent_name}}, calling from {{agent_phone}}</p>
<p>Please keep your phone nearby — this call is an important step in your case, and we don't want you to miss it. Need to reschedule? Just reply to this email or call us.</p>${FOOTER}`,
  },
  {
    name: 'Missed Call — We Missed You', type: 'email',
    subject: 'We Missed You – Regarding Your SSDI Claim',
    body: `<p>Hi {{first_name}},</p>
<p>We tried to reach you earlier today regarding your Social Security Disability claim. Your assigned specialist {{agent_name}} is holding your file open and will try you again shortly from {{agent_phone}}.</p>
<p>If you'd like to talk sooner, just call us back at {{agent_phone}} or reply to this email with a good time to reach you.</p>
<p>We're here to help you move your claim forward.</p>
<p>Warm regards,<br/>{{agent_name}}, Claim Specialist</p>${FOOTER}`,
  },
  // ── Five-day outreach cadence (type: text) ──
  { name: 'Day 1 — VM 1', type: 'text', subject: null, body: `Hi {{first_name}}, this is {{agent_name}} calling from American Benefits Advocates. You recently reached out to us about your Social Security Disability claim, and I wanted to personally give you a call to go over your file. There's a specific window of time that matters with these cases, and I don't want yours to lose momentum. Please call me back at {{agent_phone}}. I'll try you again shortly. Talk soon.` },
  { name: 'Day 1 — VM 2', type: 'text', subject: null, body: `Hi {{first_name}}, it's {{agent_name}} again. I know life gets busy, so I wanted to try you one more time today. When you get a chance, please call me back at {{agent_phone}} so we can go over your file together — it'll only take a few minutes.` },
  { name: 'Day 1 — Text', type: 'text', subject: null, body: `Hi {{first_name}}, this is {{agent_name}} with American Benefits Advocates. I tried reaching you about your SSDI case — when you have a few minutes today, please call me back at {{agent_phone}}. Reply STOP to opt out.` },
  { name: 'Day 2 — AM VM', type: 'text', subject: null, body: `Hi {{first_name}}, this is {{agent_name}}. I tried reaching you yesterday about your claim. I still have your file open and ready to review — I just need a few minutes of your time. Please call me back at {{agent_phone}} this morning.` },
  { name: 'Day 2 — PM VM', type: 'text', subject: null, body: `Hi {{first_name}}, it's {{agent_name}} again following up. I know mornings can be hectic, so I wanted to try you this evening. If a different time is easier, just call me back and let me know — I'm glad to work around your schedule.` },
  { name: 'Day 2 — Text', type: 'text', subject: null, body: `Hi {{first_name}}, {{agent_name}} here. Still holding your SSDI file open — call me back at {{agent_phone}} whenever's convenient today. Happy to work around your schedule.` },
  { name: 'Day 3 — AM VM', type: 'text', subject: null, body: `Hi {{first_name}}, this is {{agent_name}} with American Benefits Advocates. Checking in mid-week — your file is still open and ready to review. A quick call to {{agent_phone}} is all it takes to get started. I'll try you again later today.` },
  { name: 'Day 3 — PM VM', type: 'text', subject: null, body: `Hi {{first_name}}, it's {{agent_name}} again. Still hoping to connect about your SSDI claim. Whenever you get a few free minutes, call me back at {{agent_phone}} — early or late, I'm glad to work around your day.` },
  { name: 'Day 3 — Text', type: 'text', subject: null, body: `Hi {{first_name}}, {{agent_name}} here with American Benefits Advocates. Your SSDI file is waiting — a quick call to {{agent_phone}} today keeps it moving. Reply STOP to opt out.` },
  { name: 'Day 4 — AM VM', type: 'text', subject: null, body: `Hi {{first_name}}, this is {{agent_name}}. I've reached out a few times and haven't connected with you yet. I want to make sure your file gets the attention it deserves. Please call me back at {{agent_phone}} today if you're still interested in moving forward.` },
  { name: 'Day 4 — PM VM', type: 'text', subject: null, body: `Hi {{first_name}}, it's {{agent_name}} again. I'll keep this short — I still have your file open. Call me back anytime at {{agent_phone}}. If I don't hear back soon, I'll follow up one final time tomorrow.` },
  { name: 'Day 4 — Text', type: 'text', subject: null, body: `Hi {{first_name}}, {{agent_name}} here. I haven't been able to connect with you yet — if you're still interested, please call {{agent_phone}} today.` },
  { name: 'Day 5 — Final AM VM', type: 'text', subject: null, body: `Hi {{first_name}}, this is {{agent_name}}, following up one last time. I completely understand if now isn't the right time. If you'd still like help, please call me back at {{agent_phone}} — I'm happy to pick back up whenever you're ready. If I don't hear from you, I'll close out this round of outreach.` },
  { name: 'Day 5 — Final PM VM', type: 'text', subject: null, body: `Hi {{first_name}}, it's {{agent_name}}, one more time. This will be my last call for now — I don't want to keep bothering you. If you'd like to talk, my direct line is {{agent_phone}}. Wishing you all the best.` },
]
const { error: tplErr } = await sb.from('templates').insert(templates)
console.log(`  ${templates.length} templates: ${tplErr ? 'ERR ' + tplErr.message : 'inserted'}`)

console.log('━ 5. Loading manual content — scripts ─')
await sb.from('scripts').delete().neq('id', '00000000-0000-0000-0000-000000000000')
const scripts = [
  {
    title: 'Main Live-Call Script', type: 'general',
    content: `MAIN LIVE-CALL SCRIPT — SSDI
(No script can promise a claim will be approved — SSA alone decides outcomes. Never use guarantee language.)

A. OPENING & INTRODUCTION
"Hi, is this {{first_name}}? ... Hi {{first_name}}, this is {{agent_name}} calling from American Benefits Advocates — you reached out to us about help with your Social Security Disability claim. Do you have a couple of minutes to talk?" [If yes, continue.]
"Great. Just so you know a bit about us — American Benefits Advocates has spent more than 15 years helping people navigate SSDI claims and appeals, and there's no upfront cost to you for our help. Before we get into anything, can I ask — are you applying for SSDI for the first time, or have you already been denied?"

B. DISCOVERY — UNDERSTAND THEIR SITUATION
Listen and take notes. Let them describe their situation in their own words before moving on.

C. REFLECT BACK THE GAP — HONESTLY, NOT AS A BLAME GAME
"Thank you for sharing that with me, {{first_name}}. Here's something a lot of people don't realize: SSDI decisions very often come down to how complete the medical and vocational evidence is — not whether someone is truly struggling. A lot of claims get denied simply because the file didn't fully show SSA the full picture."
→ Reflect back one or two specific, likely gaps (e.g., missing treatment records or poor description of limitations). Keep this factual and supportive, never shaming.

D. PRESENT AMERICAN BENEFITS ADVOCATES
"Here's what we do: we take a fresh look at your file from the ground up, at no cost to you. We help make sure your medical records, work history, and functional limitations are documented clearly and completely — because in our experience, that's what separates a strong file from a weak one. If you decide to move forward, we connect you with an experienced SSDI advocate or attorney partner who represents you going forward, at no upfront cost — they're only paid if your case is approved, and their fee is limited by Social Security's own rules."
"I want to be upfront with you: nobody can guarantee the outcome of a case — that decision belongs to SSA, not us. What we can promise is that we'll help make sure your file is as strong and complete as possible."

E. CONSENT & NEXT STEPS
"If that sounds like something you'd like to move forward with, I'm going to send you a secure link by text and email. It confirms your information and gives us permission to review your file. Do you have your phone or email handy to open it while we're on the call?" [Wait for completion]
"Perfect. Because we'll be working on your case together, we're also required to get your consent to record this next part of the call for verification. Is it alright if I read you a short consent statement and record your response?" [Wait for 'yes', then proceed to the Front-End Consent Recording Script.]

F. TRANSITION & TRANSFER TO ADVISOR
"Now that we have that on file, I'm going to transfer you to one of our advisors. They'll ask you more detailed questions. If you decide to move forward, they'll walk you through a retainer agreement, which gives our partner firm permission to formally start working on your case."
"Once you sign, you may get a follow-up call from the firm — that's completely normal verification, please pick it up. Once you're finished with the advisor, please call me back at this same number. Sound good?"

G. CLOSING (AFTER CLAIMANT CALLS BACK POST-RETAINER)
Confirm the retainer is signed, answer any final questions, and set expectations for the next steps in the process.`,
  },
  {
    title: 'Front-End Consent Recording', type: 'frontend',
    content: `FRONT-END CONSENT RECORDING SCRIPT
(Read verbatim once the claimant has agreed to be recorded. Keep pacing slow and clear.)

"This call may be recorded for quality and compliance purposes. {{first_name}}, thank you for reaching out to American Benefits Advocates regarding your Social Security Disability benefits. Before we continue, I just want to confirm a couple of things with you on this recorded line."

"Can you confirm your full name for me?" [Wait for response]

"And can you confirm that you're reaching out today because you're looking for help with a Social Security Disability claim — either applying for the first time or appealing a denial?" [Wait for a clear 'yes']

"Thank you, {{first_name}} — that's exactly what we're here to help with."`,
  },
  {
    title: 'Verification / Intake Recording', type: 'verification',
    content: `VERIFICATION / INTAKE RECORDING SCRIPT
(This section collects factual eligibility information only. Do not use this step to tell claimants what to say about their condition — the answers must be their own.)

"Now I just need to verify a few more details for your file, if that's alright."

1. "How many years total would you say you've worked over your lifetime?"
2. "Are you currently working with an attorney or representative on this claim?"
3. "Can you tell me, in your own words, what condition or conditions are affecting you?"
4. "Would you say your condition currently prevents you from being able to work?"

"Thank you for confirming that, {{first_name}}. That's everything I need on this part — I'm going to go ahead and get you connected with our advisor now."`,
  },
]
const { error: scrErr } = await sb.from('scripts').insert(scripts)
console.log(`  ${scripts.length} scripts: ${scrErr ? 'ERR ' + scrErr.message : 'inserted'}`)

console.log('━ 6. Loading manual content — rebuttals ─')
const rebuttals = [
  { title: '"How did you get my information?"', body: `"Great question — you filled out a request for help with your Social Security Disability claim through one of our online ads or landing pages. That's how we have your information, and it's why I'm reaching out."` },
  { title: '"Is this a scam? How do I know you\'re legit?"', body: `"Totally fair to ask. American Benefits Advocates has been helping people with SSDI claims for over 15 years. We're not part of the government, and we're not charging you anything upfront — our role is to help strengthen your file and connect you with an experienced advocate who only gets paid if your case is approved, at a rate capped by Social Security's own rules."` },
  { title: '"I already applied and got denied — why would this be different?"', body: `"That's actually really common, and I'm sorry you went through that. A lot of denials happen because the file was missing medical evidence or didn't fully capture how the condition affects daily functioning — not necessarily because the claim wasn't valid. We take a fresh look at the whole file and help make sure everything SSA needs to see is actually in there."` },
  { title: '"I already have an attorney or representative."', body: `"That's great that you already have someone helping you — I don't want to get in the way of that. If you'd ever like a second opinion, we're happy to help, but it's completely your call. Would you like me to close out your file with us, or keep the option open?"\n\nCOMPLIANCE: Always respond honestly. Never instruct a claimant to conceal or deny existing representation — this creates real legal and ethical exposure.` },
  { title: '"Can you guarantee I\'ll be approved?"', body: `"I wish I could promise that, but honestly no one can — SSA makes that call, not us. What I can tell you is we'll do everything we can to make sure your file is as complete and strong as possible going into your hearing."` },
]
const { error: rebErr } = await sb.from('settings').upsert({ key: 'rebuttals', value: rebuttals, updated_at: new Date().toISOString() })
console.log(`  ${rebuttals.length} rebuttals: ${rebErr ? 'ERR ' + rebErr.message : 'saved'}`)

console.log('━ 7. Verify ─')
const { count: lc } = await sb.from('leads').select('id', { count: 'exact', head: true })
const { count: tc } = await sb.from('templates').select('id', { count: 'exact', head: true })
const { count: sc } = await sb.from('scripts').select('id', { count: 'exact', head: true })
const { data: ul } = await sb.from('profiles').select('email,role,is_active')
console.log(`  leads: ${lc} (should be 0) · templates: ${tc} · scripts: ${sc}`)
console.log('  users:', (ul || []).map((u) => `${u.email} (${u.role}${u.is_active ? '' : ', inactive'})`).join(', '))
console.log('\nDONE')
