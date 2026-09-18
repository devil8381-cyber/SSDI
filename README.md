# LeadDesk CRM

A sales & lead-management CRM for SSDI teams — hosted on **Netlify**, deployed from **GitHub**, powered by **Supabase**, **Google Drive**, **SMTP**, and **Meta (Facebook) Ads**.

## What's inside

| Area | Features |
|---|---|
| Admin | Create/manage users & passwords, CSV lead import with column mapping + duplicate skip, bulk assign / auto round-robin (Meta leads), active-time tracking per user, scripts editor, email & text template editor, SMTP server manager, Meta & Drive integration settings, team performance table |
| Agents | Daily leads, editable lead details, follow-up emails with **open tracking**, tasks & callbacks, secure document requests, front-end / verification recordings with **side-by-side script**, personal conversion dashboard |
| Pipeline | Dispositions: `New · Working · VM · Callback · NIS · Not Interested · Signed · Approved · Criteria Not Met` (with reason codes: age, work history, already receiving benefits, <12 months) |
| Documents | Tokenized, expiring, no-login upload page per claimant → files land in secure storage, agent + admin get notified |
| Meta | Lead-ads webhook → CRM (auto-assigned round-robin), manual backfill sync, Conversions API events: `Lead_Qualified` (Signed/Approved) & `Lead_Disqualified` (Criteria Not Met + reason) so Meta improves lead quality |
| Drive | Recordings auto-filed as `Root → Agent → Lead → Front-End – Lead – date.mp3` via a service account |

## Tech stack

React + Vite + Tailwind (frontend) · Netlify Functions (API) · Supabase (Postgres, auth, storage) · nodemailer (SMTP) · googleapis (Drive) · Meta Graph API (webhook + CAPI)

---

## Setup guide

### 1. Supabase (database + auth + file storage) — ~5 min

1. Go to [supabase.com](https://supabase.com) → **New project** (free tier is fine). Pick a region close to you.
2. When it's ready, open **SQL Editor** → New query → paste the entire contents of [`db/schema.sql`](db/schema.sql) → **Run**. This creates all tables, triggers, storage buckets, and seeds 2 SSDI scripts + 5 templates.
3. Collect keys from **Project Settings → API**:
   - `Project URL` → `SUPABASE_URL` and `VITE_SUPABASE_URL`
   - `anon public` key → `SUPABASE_ANON_KEY` and `VITE_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (secret — server only)

### 2. Encryption key + webhook token

Generate locally:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # → APP_ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"   # → META_VERIFY_TOKEN (any string)
```

### 3. First admin account

User creation inside the CRM requires an admin, so bootstrap the first one manually:

1. Supabase Dashboard → **Authentication → Users → Add user** → enter email + password → Create.
2. **Table Editor → profiles** → find that user → set `role` = `admin`.
3. Log into the CRM with that email/password. All further users are created from **Admin → Users** (their passwords are included — share them securely).

### 4. Push to GitHub + Netlify — ~5 min

1. Create a new **empty** repo on GitHub, then:
   ```bash
   git remote add origin https://github.com/YOURUSER/leaddesk.git
   git push -u origin main
   ```
2. On [app.netlify.com](https://app.netlify.com) → **Add new site → Import an existing project** → pick the repo.
3. Build settings are auto-read from `netlify.toml` (build `npm run build`, publish `dist`).
4. **Site settings → Environment variables** — add all of these:

   | Key | Where it comes from |
   |---|---|
   | `SUPABASE_URL` | Supabase settings → API |
   | `SUPABASE_ANON_KEY` | Supabase settings → API |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase settings → API (secret) |
   | `APP_ENCRYPTION_KEY` | step 2 |
   | `META_VERIFY_TOKEN` | step 2 |
   | `VITE_SUPABASE_URL` | same as SUPABASE_URL |
   | `VITE_SUPABASE_ANON_KEY` | same as SUPABASE_ANON_KEY |

5. **Deploy**. Every push to `main` now auto-deploys.

### 5. SMTP servers (Admin → SMTP)

Add one profile per task type — e.g. `Callbacks` (sender A), `Documentation requests` (sender B), `General follow-ups` (sender C). Grab SMTP credentials from your provider (Brevo, SendGrid, SMTP2GO, Gmail app-password, etc.), then use **Test** on each profile to verify deliverability before going live.

Deliverability tips: set up SPF + DKIM + DMARC on the sending domain, keep daily limits modest while warming up, and send real content (templates are already personalized).

### 6. Google Drive recordings (Admin → Integrations → Drive)

1. [console.cloud.google.com](https://console.cloud.google.com) → new project → **Enable Google Drive API**.
2. **IAM & Admin → Service Accounts → Create** (no roles needed) → **Keys → Add key → JSON** → download.
3. Google Drive: create folder `CRM Recordings` → **Share** with the service account's email (in the JSON) as **Editor**.
4. In the CRM paste the **folder ID** (URL part after `/folders/`) and the **JSON** → Save.

Agents now use "Upload" on a lead → the file lands in `CRM Recordings → Agent → Lead →`. Clicking **Open + script** shows the recording beside the matching front-end / verification script.

### 7. Meta integration (Admin → Integrations → Meta)

1. **Conversions API**: [business.facebook.com/events_manager](https://business.facebook.com/events_manager) → your pixel → Settings → **Generate access token** (via Conversions API / System User) → paste as `CAPI access token` + your Pixel ID. Optionally add a **test event code** to watch events live.
2. **Webhook** (new leads flow straight in): [developers.facebook.com](https://developers.facebook.com) → your app → Webhooks → **Page** → subscribe to `leadgen` → Callback URL = the **Webhook URL** shown on the Integrations page, Verify token = your `META_VERIFY_TOKEN` env value.
3. **Page access token**: from Graph API Explorer or your System User — paste it so the webhook can fetch lead details, and use **Sync existing form leads** to backfill.
4. Quality signals fire automatically on disposition changes:
   - `Signed` / `Approved` → `Lead_Qualified` event
   - `Criteria Not Met` → `Lead_Disqualified` + reason (`age`, `work history`, …)
5. **Also in Meta**: switch instant forms to **Higher intent**, add a **Date of Birth** qualifying question, and set form questions to match your criteria — this plus the CAPI signals is what teaches Meta to send age-appropriate, better leads.

### Local development

```bash
npm install
cp .env.example .env      # fill in the values
npx netlify-cli dev       # runs vite + functions together on :8888
```

---

## Notes & gotchas

- **Open tracking** uses an invisible pixel. Apple Mail Privacy Protection can inflate opens — treat them as directional, not gospel.
- The service-role key lives only in Netlify env vars; every CRM API call verifies the caller's JWT + role server-side, and RLS blocks direct client access to all tables.
- SMTP passwords, Drive keys, and Meta tokens are encrypted at rest with `APP_ENCRYPTION_KEY`. **Don't lose this key** — encrypted values can't be recovered without it (just re-enter them).
- Claimant upload links are tokenized, expire (default 7 days), and require no login.
- Meta webhook events are processed async; new leads auto-assign round-robin across active agents.
