// Final template polish: professional signature blocks (agent name + number
// highlighted), start.html confirm link, urgent missed-call email, inbox-safe
// inline-styled HTML (no spam-trigger patterns, no images, single CTA each).
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = {}
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Za-z_]+)=(.*)\s*$/)
  if (m) env[m[1]] = m[2]
}
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

// Email-safe signature block: solid colors only (Gmail strips CSS gradients),
// inline styles, agent number as a big tappable tel: link.
const signature = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:22px;border-collapse:collapse">
  <tr>
    <td style="background-color:#eef2ff;border-left:4px solid #4f46e5;border-radius:8px;padding:16px 18px">
      <p style="margin:0 0 2px;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#6366f1;font-weight:700">Your Claim Specialist</p>
      <p style="margin:0 0 8px;font-size:16px;font-weight:800;color:#1e293b">{{agent_name}} <span style="font-weight:400;color:#475569">— American Benefits Advocates</span></p>
      <p style="margin:0;font-size:18px">
        <a href="tel:{{agent_phone}}" style="text-decoration:none">
          <span style="display:inline-block;background-color:#4f46e5;color:#ffffff;font-weight:800;padding:10px 18px;border-radius:8px">&#128222; {{agent_phone}}</span>
        </a>
      </p>
      <p style="margin:8px 0 0;font-size:12px;color:#475569">Direct line — call or text anytime with questions about your claim.</p>
    </td>
  </tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;border-collapse:collapse">
  <tr><td style="border-top:1px solid #e2e8f0;padding-top:12px">
    <p style="margin:0;font-size:11px;line-height:1.5;color:#94a3b8">American Benefits Advocates | 1250 H Street NW, Suite 605, Washington, DC 20005<br/>
    You are receiving this email because you submitted a request for help with a Social Security Disability claim. American Benefits Advocates is not the Social Security Administration and is not affiliated with, endorsed by, or acting on behalf of any U.S. government agency.</p>
  </td></tr>
</table>`

const btn = (href, label) => `
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px auto;border-collapse:collapse">
  <tr><td style="background-color:#4f46e5;border-radius:10px">
    <a href="${href}" style="display:inline-block;padding:14px 30px;font-family:Arial,sans-serif;font-size:16px;font-weight:800;color:#ffffff;text-decoration:none">${label}</a>
  </td></tr>
</table>`

const templates = [
  {
    name: 'Agent Assigned — Welcome (ABA)',
    subject: 'Your SSDI File Has Been Assigned to a Claim Specialist',
    body: `<p style="margin:0 0 14px;font-size:15px;color:#334155">Hi {{first_name}},</p>
<p style="margin:0 0 12px;font-size:15px;color:#334155">Thank you for reaching out to <b>American Benefits Advocates</b> regarding your Social Security Disability (SSDI) claim. We know this process can feel overwhelming — and we're glad you took the first step.</p>
<p style="margin:0 0 12px;font-size:15px;color:#334155">Your file has been assigned to Claim Specialist <b style="color:#4f46e5">{{agent_name}}</b>, who will call you today from <b style="color:#4f46e5">{{agent_phone}}</b> to review your case and walk you through next steps. Please keep an eye out for the call.</p>
<p style="margin:0 0 6px;font-size:15px;color:#334155">Before the call, please take two minutes to confirm your information — this is required before we can begin:</p>
${btn('https://americanbenefitsadvocates.org/start.html', 'CONFIRM MY INFORMATION &amp; GET STARTED')}
<p style="margin:0 0 4px;font-size:13px;color:#64748b;text-align:center">(tap the button above — it takes about 2 minutes)</p>
<p style="margin:14px 0 4px;font-size:15px;color:#334155"><b>What happens next:</b></p>
<ol style="margin:0 0 14px;padding-left:20px;font-size:14px;color:#475569"><li style="margin-bottom:4px">You complete the short form above</li><li style="margin-bottom:4px">{{agent_name}} calls to review your case with you</li><li style="margin-bottom:4px">We identify what's needed to strengthen your file</li><li>If you're ready to move forward, we connect you with an experienced advocate partner — at no upfront cost to you</li></ol>
${signature}`,
  },
  {
    name: 'Document Request — Secure Upload',
    subject: "Action Needed: Upload Your Documents for {{first_name}}'s SSDI File",
    body: `<p style="margin:0 0 14px;font-size:15px;color:#334155">Hi {{first_name}},</p>
<p style="margin:0 0 12px;font-size:15px;color:#334155">Thanks for speaking with <b style="color:#4f46e5">{{agent_name}}</b> today. To keep your file moving, we need copies of a few supporting documents. Please use the secure link below — it's encrypted and only accessible to your assigned case team.</p>
${btn('{{doc_link}}', 'UPLOAD MY DOCUMENTS SECURELY')}
<p style="margin:0 0 4px;font-size:15px;color:#334155"><b>Documents that strengthen your file:</b></p>
<ul style="margin:0 0 14px;padding-left:20px;font-size:14px;color:#475569"><li style="margin-bottom:4px">Photo ID (driver's license or state ID)</li><li style="margin-bottom:4px">Most recent SSA denial letter or Notice of Decision (if applicable)</li><li style="margin-bottom:4px">Medical records, or a list of the doctors you've seen</li><li style="margin-bottom:4px">Proof of work history (W-2s, pay stubs, or past employers)</li><li style="margin-bottom:4px">Any correspondence from the SSA</li></ul>
<p style="margin:0 0 14px;font-size:14px;color:#475569">Don't have everything? Upload what you have — we'll help you track down the rest.</p>
${signature}`,
  },
  {
    name: 'Callback Scheduled',
    subject: 'Confirmed: Your Callback Is Scheduled for [Date] at [Time]',
    body: `<p style="margin:0 0 14px;font-size:15px;color:#334155">Hi {{first_name}},</p>
<p style="margin:0 0 12px;font-size:15px;color:#334155">This confirms your callback is scheduled. Please keep your phone nearby — this call is an important step in your case.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;border-collapse:collapse">
  <tr><td style="background-color:#eef2ff;border:1px solid #c7d2fe;border-radius:8px;padding:14px 18px;font-size:16px;color:#1e293b">
    <b>Date:</b> [Date]<br/><b>Time:</b> [Time]<br/><b>Agent:</b> <b style="color:#4f46e5">{{agent_name}}</b> — calling from <b style="color:#4f46e5">{{agent_phone}}</b>
  </td></tr>
</table>
<p style="margin:0 0 14px;font-size:14px;color:#475569">Need to reschedule? Just reply to this email or call us — we're glad to work around your schedule.</p>
${signature}`,
  },
  {
    name: 'Missed Call — We Missed You',
    subject: 'We Called You About Your SSDI Claim — Please Call Us Back Today',
    body: `<p style="margin:0 0 14px;font-size:15px;color:#334155">Hi {{first_name}},</p>
<p style="margin:0 0 12px;font-size:15px;color:#334155">We tried reaching you today about your <b>Social Security Disability claim</b> — and we don't want your file to lose momentum.</p>
<p style="margin:0 0 12px;font-size:15px;color:#334155">Your assigned specialist <b style="color:#4f46e5">{{agent_name}}</b> is holding your file open and ready to review. There is a specific window of time that matters with these cases — <b>please call back today</b>:</p>
${btn('tel:{{agent_phone}}', '&#128222; CALL {{agent_phone}} NOW')}
<p style="margin:0 0 14px;font-size:14px;color:#475569">Busy right now? Reply to this email with a time that works — {{agent_name}} will call you exactly when you say.</p>
${signature}`,
  },
]

for (const t of templates) {
  const { error } = await sb.from('templates').update({ subject: t.subject, body: t.body }).eq('name', t.name)
  console.log(`${t.name}: ${error ? 'ERR ' + error.message : 'updated'}`)
}
console.log('done')
