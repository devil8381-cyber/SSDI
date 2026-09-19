// Scheduled function: emails every active user their daily queue summary.
// Runs at 13:00 UTC (8 AM US Eastern) once deployed to Netlify.
// Locally it can be triggered manually: netlify functions:invoke daily-digest
import { service, buildQueueFor, sendSystemEmail } from './api/_lib.mjs'

export default async () => {
  const { data: users } = await service.from('profiles')
    .select('id,name,email,role').eq('is_active', true)
  let sent = 0, skipped = 0, failed = 0
  for (const u of users || []) {
    if (!u.email) continue
    try {
      const q = await buildQueueFor(u)
      if (!q.counts.total) { skipped++; continue }
      const rows = q.items.slice(0, 15).map((i) =>
        `<li><b>${i.first_name} ${i.last_name}</b> — ${i.reason}${i.due_at ? ` (due ${new Date(i.due_at).toLocaleString()})` : ''} — ${i.phone || 'no phone'}</li>`
      ).join('')
      await sendSystemEmail({
        to: u.email,
        subject: `ABA — ${q.counts.total} leads on today's plan`,
        html: `<h2>Good morning, ${u.name || 'there'} 👋</h2>
          <p><b>${q.counts.total}</b> leads in your queue today: ${q.counts.overdue} overdue, ${q.counts.dueToday} due today, ${q.counts.fresh} fresh.</p>
          <ol>${rows}</ol>
          <p>Work it top to bottom — overdue first. ☕</p>`,
      })
      sent++
    } catch (e) {
      // No SMTP configured yet → skip quietly; other failures are logged
      if (String(e.message).includes('No SMTP profile')) { skipped++; continue }
      console.error('digest failed for', u.email, e.message)
      failed++
    }
  }
  return { sent, skipped, failed }
}

export const config = {
  schedule: '0 13 * * *',
}
