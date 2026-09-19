// Seeds the ABA playbook content: scripts, email templates, rebuttals.
// Safe to re-run — updates by title, never duplicates.
//   node scripts/seed-content.mjs
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

const SCRIPTS = [
  {
    title: 'Front-End Qualification & Consent Script', type: 'frontend',
    content: `FRONT-END CALL — AMERICAN BENEFITS ADVOCATES (recorded line)

A. OPENING
Hi, is this {{first_name}}? This is {{agent_name}} from American Benefits Advocates — you reached out about help with your Social Security Disability claim. Do you have a couple of minutes?
[If no → schedule a callback using the Callback Scheduled template.]
Great. We've spent 15+ years helping people with SSDI claims and appeals, and there's no upfront cost. Quick one — is this your first time applying, or have you already been denied?

B. DISCOVERY
[If denied] I'm sorry to hear that. Walk me through it — when did you apply, and what did the denial letter say?
[If first time] Tell me about your condition and how it affects your ability to work.
→ NOTE: condition/diagnosis, treatment, work history, prior application details.

C. REFLECT BACK THE GAP
Here's something most people don't realize: SSDI decisions usually come down to how COMPLETE the medical and vocational evidence is — not whether someone is truly struggling. Many claims are denied simply because the file didn't show SSA the full picture.
→ Reflect back 1-2 specific gaps they mentioned (missing recent records, first application that didn't describe daily limitations).

D. PRESENT ABA
We take a fresh look at your file from the ground up, at no cost — medical records, work history, functional limitations, documented clearly. If you move forward, we connect you with an experienced advocate/attorney partner: no upfront cost, paid only if approved, fee capped by Social Security's own rules.
I'll be upfront: nobody can guarantee an outcome — SSA decides that. What we promise is your file will be as strong and complete as possible.

E. CONSENT & NEXT STEPS
I'll send a secure link by text and email — it confirms your info and gives us permission to review your file (required before we continue). Have your phone handy?
[Wait for completion.]
Because we'll work your case together, we need your consent to record this next part for verification and compliance. Alright if I read a short consent statement and record your answer?
[Wait for clear YES → read the consent statement below.]

RECORDING CONSENT STATEMENT (read verbatim, slow and clear):
This call may be recorded for quality and compliance purposes. {{first_name}}, thank you for reaching out about your Social Security Disability benefits. Before we continue, can you confirm your full name for me?
[Wait.]
And can you confirm you're reaching out today because you're looking for help with a Social Security Disability claim — first application or appealing a denial?
[Wait for clear YES.]
Thank you — that's exactly what we help with.

F. TRANSFER TO ADVISOR
I'm transferring you to one of our advisors — they'll ask detailed questions about your condition (that's what strengthens your file) and walk you through a retainer if you decide to move forward. Heads-up: you may get a follow-up verification call from the firm afterward — please pick up.
Once you're done, call me back at this number so I can tell you what happens next. Sound good? [Transfer.]

G. CLOSING (after claimant calls back post-retainer)
Thanks for calling back — I see you finished with our advisor. Our team starts reviewing your file in detail now. If the firm calls to verify details, please pick up. Nothing else needed from you right now — we'll be in touch. Take care!`,
  },
  {
    title: 'Verification & Intake Script', type: 'verification',
    content: `VERIFICATION / INTAKE CALL (recorded line)

This step collects FACTUAL ELIGIBILITY information only — never tell claimants what to say; answers must be their own.

OPENING
Now I just need to verify a few details for your file, if that's alright.

CORE VERIFICATION (record answers exactly)
1. How many years total would you say you've worked over your lifetime?
2. Are you currently working with an attorney or representative on this claim?
3. In your own words, what condition or conditions are affecting you?
4. Would you say your condition currently prevents you from being able to work?

FULL INTAKE — open the Intake section on the lead's page and fill in ALL 33 questions
while you have them on the phone, in this order:

PART 1 — SSDI STATUS
 • Are you currently receiving SSDI?
 • Have you applied before?
 • Are you currently working? (since when?)
 • Out of the last 10 years, how many years did you work?
 • What was your last full-time job? (why did you stop?)
 • Has your doctor said you can't work for at least 12 months?

PART 2 — MEDICAL CONDITION
 • Primary condition(s)? • Tests done (CT/MRI/X-ray)? • When?
 • Date of diagnosis? • Diagnosed by (doctor, MD)? • Hospital name?
 • Treatments receiving? • Treatment start date?

PART 3 — FUNCTIONAL LIMITATIONS
 • Current limitations? (sit/stand/lift/bend/walk)
 • Daily activities — what do you need help with? (cane, chores, groceries)

PART 4 — MENTAL HEALTH (if applicable)
 • Any mental health conditions? • Treatment/therapist/medications?
 • How does it affect work or social life?

PART 5 — ADDITIONAL INFO
 • Dependents under 18? • Other disability coverage or workers' comp?
 • Attorney or advocate? • Ever spoken to an attorney / signed documents?
 • Where are your medical records? • Can you send them?
 • Permission to retrieve records? • Anyone coach you for this claim?
 • Where did you hear about us?

PART 6 — SUPPORTING (recommended)
 • Surgeries related to the condition? • Daily prescribed medications?
 • Condition worsened over time? • Assistive devices (cane, brace)?
 • Doctor's written statement that you can't return to work?

CLOSING
Thank you, {{first_name}} — that's everything for this part. Next I'll send your secure document link (photo ID + work history). Watch for the email, and keep your phone nearby — a specialist may call to verify details.`,
  },
  {
    title: 'SSDI Intake Questionnaire — Full 33 Questions', type: 'intake',
    content: `SSDI INTAKE QUESTIONNAIRE — ask step by step, fill the Intake form on the lead page as you go.

SSDI STATUS
1. Are you currently receiving SSDI?
2. Have you applied before?
3. Are you currently working? (if no — since when?)
4. Out of the last 10 years, how many years did you work?
5. What was your last full-time job? Why did you stop?
6. Has your doctor told you that you can't work for at least 12 months due to your disability?

MEDICAL CONDITION
7. What are your current primary condition(s)?
8. What tests have you had? (CT scan, MRI, X-ray…)
9. When did you have these tests done?
10. What is the date of diagnosis?
11. Diagnosed by (name, MD)?
12. What hospital/clinic where you received treatment?
13. What type of treatments are you receiving?
14. When did you start your treatment?

FUNCTIONAL LIMITATIONS
15. What limitations or problems are you currently facing? (sit/stand/lift/bend/walk)
16. What are your daily activities like? (help needed, devices, indoor/outdoor)

MENTAL HEALTH (if applicable)
17. Do you face any mental health issues?
18. What treatment are you receiving? (therapist, medications)
19. Has your mental health affected your ability to work or socialize?

ADDITIONAL INFORMATION
20. Do you have dependents under 18?
21. Did you ever have other disability coverage or workers' compensation?
22. Are you working with an attorney or advocate?
23. Did you ever speak to any attorney or sign legal documents about this claim?
24. Where are your medical records?
25. Can you send us your medical records?
26. Do you give us permission to retrieve your medical records?
27. Did someone coach or train you for this claim?
28. Where did you learn about this claim process?

ADDITIONAL SUPPORTING (recommended)
29. Have you had any surgeries related to your condition?
30. Do you take prescribed medications daily? Which?
31. Has your condition worsened over time?
32. Do you use any assistive devices? (cane, brace)
33. Have any doctors given a written statement that you are unable to work?

TIP: answers go straight into the Intake card on the lead — that becomes the master file used to build their claim.`,
  },
  {
    title: 'Main Live-Call Script', type: 'general',
    content: `MAIN LIVE-CALL SCRIPT — American Benefits Advocates
NOTE: never promise approval — SSA decides outcomes. Guarantee language = legal exposure.

A. OPENING — see Front-End script section A.
B. DISCOVERY — condition, treatment, work history, prior applications.
C. REFLECT BACK THE GAP — honestly, supportively; cite likely evidence gaps.
D. PRESENT ABA — free file review; advocate paid only if approved (SSA-capped fee); no outcome guarantees.
E. CONSENT — secure info/consent link, then recorded verbal consent (Front-End script section E).
F. TRANSFER to advisor; warn about the firm's follow-up verification call.
G. CLOSING after post-retainer callback.`,
  },
  {
    title: '5-Day Outreach Cadence (VM + Text)', type: 'general',
    content: `FIVE-DAY OUTREACH CADENCE — use the assigned specialist's name + direct number consistently so the lead recognizes caller ID and voice. Warm and supportive, never pressured.

DAY 1 — Call AM (intro: callback on their SSDI inquiry, timing matters) → VM1: "Hi {{first_name}}, this is {{agent_name}} from American Benefits Advocates. You recently reached out about your Social Security Disability claim — there's a specific window of time that matters with these cases and I don't want yours to lose momentum. Please call me back at [direct number]." → Call PM (short, low pressure) → Text: "Hi {{first_name}}, this is {{agent_name}} with American Benefits Advocates. I tried reaching you about your SSDI case — please call me back at [number]. Reply STOP to opt out."
DAY 2 — Call AM (file still open, waiting on them) → Call PM (offer scheduling flexibility) → Text.
DAY 3 — Call AM (gently note deadlines matter, not alarmist) → Call PM (file still active, talk through options) → Text.
DAY 4 — Call AM (outreach nearing its end — factual, not threatening) → Call PM (brief; flag final attempt tomorrow) → Text.
DAY 5 — Call AM (final attempt; leave door open warmly) → Call PM if needed (respectful sign-off) → Final text.
After day 5: close the round of outreach; lead remains welcome to reach out directly.`,
  },
]

const TEMPLATES = [
  {
    type: 'email', name: 'Welcome — File Assigned (ABA)',
    subject: 'Your SSDI File Has Been Assigned to a Claim Specialist',
    body: `<p>Hi <strong>{{first_name}}</strong>,</p>
<p>Thank you for reaching out to American Benefits Advocates regarding your Social Security Disability (SSDI) claim. We know this process can feel overwhelming — and we're glad you took the first step.</p>
<p>Your file has been assigned to Claim Specialist <strong>{{agent_name}}</strong>, who will be calling you today to go over your case, answer your questions, and walk you through next steps. Please keep an eye out for the call.</p>
<p>What happens next:</p>
<ol><li>You confirm your information and give consent to review your file (about 2 minutes — required before we begin)</li><li>{{agent_name}} calls to review your case with you</li><li>We identify what's needed to strengthen your file</li><li>If you're ready to move forward, we connect you with an experienced advocate partner — at no upfront cost to you</li></ol>
<p>If you have questions before the call, reply to this email or call our office directly.</p>
<p>Warm regards,<br/>The American Benefits Advocates Team</p>
<p style="font-size:11px;color:#888;">You are receiving this email because you submitted a request for help with a Social Security Disability claim through one of our online forms. American Benefits Advocates is not the Social Security Administration and is not affiliated with, endorsed by, or acting on behalf of any U.S. government agency. <a href="{{unsubscribe}}">Unsubscribe</a></p>`,
  },
  {
    type: 'email', name: 'Callback Scheduled (ABA)',
    subject: 'Confirmed: Your Callback Is Scheduled',
    body: `<p>Hi <strong>{{first_name}}</strong>,</p>
<p>This confirms your callback is scheduled with <strong>{{agent_name}}</strong>. Please keep your phone nearby — this call is an important step in your case, and we don't want you to miss it. If {{agent_name}} isn't able to reach you, they'll leave a voicemail and try again shortly after.</p>
<p>Need to reschedule? Just reply to this email or call our office and we'll find a time that works better for you.</p>
<p>Talk soon,<br/>The American Benefits Advocates Team</p>
<p style="font-size:11px;color:#888;">Not affiliated with, endorsed by, or acting on behalf of the Social Security Administration. <a href="{{unsubscribe}}">Unsubscribe</a></p>`,
  },
]

const REBUTTALS = [
  { title: '"How did you get my information?"', body: "Great question — you filled out a request for help with your Social Security Disability claim through one of our online ads or landing pages. That's how we have your information, and it's why I'm reaching out." },
  { title: '"Is this a scam? How do I know you\'re legit?"', body: "Totally fair to ask. American Benefits Advocates has been helping people with SSDI claims for over 15 years. We're not part of the government, and we're not charging you anything upfront — our role is to help strengthen your file and connect you with an experienced advocate who only gets paid if your case is approved, at a rate capped by Social Security's own rules." },
  { title: '"How much does this cost?"', body: "There's no upfront cost to you at all. If you move forward, the fee follows Social Security's own rules — the advocate or attorney working your case only gets paid a portion of your back pay, and only if your case is approved." },
  { title: '"I already applied and got denied — why would this be different?"', body: "That's actually really common, and I'm sorry you went through that. A lot of denials happen because the file was missing medical evidence or didn't fully capture how the condition affects daily functioning — not necessarily because the claim wasn't valid. We take a fresh look at the whole file and help make sure everything SSA needs to see is actually in there." },
  { title: '"I don\'t have time right now."', body: "Totally understand — this doesn't need to happen all at once. Would it help if I called you back at a specific time that works better for you? [Schedule a callback using the Callback Scheduled email.]" },
  { title: '"I already have an attorney or representative."', body: "That's great that you already have someone helping you — I don't want to get in the way of that. If you'd ever like a second opinion, we're happy to help, but it's completely your call. Would you like me to close out your file with us, or keep the option open? NOTE: always respond honestly — never instruct a claimant to conceal existing representation." },
  { title: '"I need to think about it."', body: "Of course, no pressure at all. Can I follow up with you in a couple of days to see where your head's at?" },
  { title: '"Can you guarantee I\'ll be approved?"', body: "I wish I could promise that, but honestly no one can — SSA makes that call, not us. What I can tell you is we'll do everything we can to make sure your file is as complete and strong as possible going into your hearing." },
]

async function upsertScript(s) {
  const { data: existing } = await sb.from('scripts').select('id').eq('title', s.title).maybeSingle()
  if (existing) { await sb.from('scripts').update({ type: s.type, content: s.content, updated_at: new Date().toISOString() }).eq('id', existing.id) }
  else await sb.from('scripts').insert(s)
}
async function upsertTemplate(t) {
  const { data: existing } = await sb.from('templates').select('id').eq('name', t.name).maybeSingle()
  if (existing) { await sb.from('templates').update(t).eq('id', existing.id) }
  else await sb.from('templates').insert(t)
}

async function main() {
  for (const s of SCRIPTS) { await upsertScript(s); console.log('script:', s.title) }
  for (const t of TEMPLATES) { await upsertTemplate(t); console.log('template:', t.name) }
  const { error } = await sb.from('settings').upsert({ key: 'rebuttals', value: REBUTTALS, updated_at: new Date().toISOString() })
  if (error) throw error
  console.log('rebuttals:', REBUTTALS.length)
  console.log('\n✅ ABA playbook content loaded')
}
main().catch((e) => { console.error('✖', e.message); process.exit(1) })
