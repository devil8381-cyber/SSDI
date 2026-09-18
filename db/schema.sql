-- ============================================================
-- LeadDesk CRM — Supabase schema
-- Run this whole file in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

create extension if not exists "pgcrypto";

-- ─────────────────────────── PROFILES ───────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null default '',
  email text not null default '',
  role text not null default 'agent' check (role in ('admin','agent')),
  is_active boolean not null default true,
  last_login_at timestamptz,
  last_active_at timestamptz,
  created_at timestamptz not null default now()
);

-- Auto-create a profile whenever a user is created (admin sets name/role in user_metadata)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, email, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
          new.email, coalesce(new.raw_user_meta_data->>'role','agent'))
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- ─────────────────────────── LEADS ───────────────────────────
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  first_name text not null default '',
  last_name text not null default '',
  email text,
  phone text,
  dob date,
  state text,
  city text,
  -- SSDI qualification
  worked_5_of_10 boolean,
  receiving_benefits boolean,
  duration_12m boolean,
  has_attorney boolean,
  disability text,
  -- pipeline
  disposition text not null default 'New',
  disposition_reason text,
  notes text,
  next_followup_at timestamptz,
  assigned_to uuid references public.profiles on delete set null,
  -- meta / source
  source text not null default 'manual',          -- manual | import | meta
  campaign text,
  form_name text,
  meta_lead_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_activity_at timestamptz
);
create index if not exists leads_assigned_idx on public.leads (assigned_to);
create index if not exists leads_disposition_idx on public.leads (disposition);
create index if not exists leads_created_idx on public.leads (created_at desc);
create index if not exists leads_phone_idx on public.leads (phone);

-- ─────────────────────────── ACTIVITY TIMELINE ───────────────────────────
create table if not exists public.activities (
  id bigint generated always as identity primary key,
  lead_id uuid references public.leads on delete cascade,
  user_id uuid references public.profiles on delete set null,
  type text not null,                             -- created|assigned|disposition|note|edited|email_sent|email_opened|doc_requested|doc_uploaded|recording|meta|task
  title text not null default '',
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists activities_lead_idx on public.activities (lead_id, created_at desc);

-- ─────────────────────────── TEMPLATES & SCRIPTS ───────────────────────────
create table if not exists public.templates (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('email','text')),
  name text not null,
  subject text,
  body text not null default '',
  updated_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.scripts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  type text not null default 'general',           -- frontend | verification | general
  content text not null default '',
  updated_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ─────────────────────────── TASKS ───────────────────────────
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  notes text,
  type text not null default 'callback',          -- callback | followup | doc_request | other
  lead_id uuid references public.leads on delete cascade,
  assigned_to uuid references public.profiles on delete cascade,
  created_by uuid references public.profiles on delete set null,
  due_at timestamptz,
  status text not null default 'open' check (status in ('open','done','cancelled')),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists tasks_assigned_idx on public.tasks (assigned_to, status);

-- ─────────────────────────── SMTP PROFILES ───────────────────────────
create table if not exists public.smtp_profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  purpose text not null default 'general',        -- callbacks | documentation | followups | notifications | general
  host text not null,
  port int not null default 587,
  secure boolean not null default false,
  username text not null,
  password_enc text not null,
  from_name text not null default '',
  from_email text not null,
  daily_limit int not null default 300,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ─────────────────────────── EMAILS + OPEN TRACKING ───────────────────────────
create table if not exists public.email_messages (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads on delete cascade,
  sent_by uuid references public.profiles on delete set null,
  smtp_profile_id uuid references public.smtp_profiles on delete set null,
  purpose text,
  to_email text,
  subject text,
  html text,
  opens int not null default 0,
  first_opened_at timestamptz,
  last_opened_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists emails_lead_idx on public.email_messages (lead_id, created_at desc);

-- ─────────────────────────── SECURE DOCUMENT REQUESTS ───────────────────────────
create table if not exists public.doc_requests (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads on delete cascade,
  token text not null unique default encode(gen_random_bytes(18),'hex'),
  doc_types jsonb not null default '[]',
  message text,
  status text not null default 'pending' check (status in ('pending','uploaded')),
  expires_at timestamptz not null default now() + interval '7 days',
  created_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now(),
  uploaded_at timestamptz
);
create index if not exists docreq_lead_idx on public.doc_requests (lead_id);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads on delete cascade,
  request_id uuid references public.doc_requests on delete set null,
  doc_type text,
  file_name text,
  storage_path text not null,
  size_bytes bigint,
  uploaded_at timestamptz not null default now()
);

-- ─────────────────────────── RECORDINGS (Google Drive) ───────────────────────────
create table if not exists public.recordings (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads on delete cascade,
  type text not null check (type in ('frontend','verification')),
  file_name text,
  storage_path text,
  status text not null default 'uploading' check (status in ('uploading','processing','ready','failed')),
  error text,
  drive_file_id text,
  drive_link text,
  uploaded_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now()
);

-- ─────────────────────────── SETTINGS (Meta / Drive) ───────────────────────────
create table if not exists public.settings (
  key text primary key,
  value jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

-- ─────────────────────────── META QUALITY EVENTS ───────────────────────────
create table if not exists public.meta_events (
  id bigint generated always as identity primary key,
  lead_id uuid references public.leads on delete cascade,
  event_name text not null,
  reason text,
  success boolean,
  response jsonb,
  created_at timestamptz not null default now()
);

-- ─────────────────────────── NOTIFICATIONS ───────────────────────────
create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles on delete cascade,
  lead_id uuid references public.leads on delete cascade,
  title text not null,
  body text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notif_user_idx on public.notifications (user_id, read, created_at desc);

-- ─────────────────────────── ACTIVE TIME ───────────────────────────
create table if not exists public.user_activity_days (
  user_id uuid references public.profiles on delete cascade,
  day date not null,
  seconds int not null default 0,
  pings int not null default 0,
  primary key (user_id, day)
);

-- ─────────────────────────── STORAGE BUCKETS ───────────────────────────
insert into storage.buckets (id, name, public)
values ('documents','documents',false), ('recordings','recordings',false)
on conflict (id) do nothing;

-- ─────────────────────────── SQL HELPERS (called by functions) ───────────────────────────
create or replace function public.increment_email_open(p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_lead uuid;
begin
  update public.email_messages
     set opens = opens + 1,
         first_opened_at = coalesce(first_opened_at, now()),
         last_opened_at = now()
   where id = p_id
  returning lead_id into v_lead;
  return v_lead;
end; $$;

create or replace function public.increment_activity(p_user uuid, p_day date, p_seconds int, p_pings int)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_activity_days (user_id, day, seconds, pings)
  values (p_user, p_day, p_seconds, p_pings)
  on conflict (user_id, day) do update
    set seconds = user_activity_days.seconds + excluded.seconds,
        pings = user_activity_days.pings + excluded.pings;
end; $$;

-- ─────────────────────────── LOCKDOWN (all data flows through the API function,
-- which uses the service-role key; direct client access is denied) ───────────────────────────
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- ============================================================
-- SEED DATA
-- ============================================================

insert into public.scripts (title, type, content) values
('Front-End Qualification Script', 'frontend', E'FRONT-END QUALIFICATION — SSDI\n\nHi, may I speak with {{first_name}}? My name is {{agent_name}}, calling on a recorded line.\n\nI''m following up on your request about Social Security Disability benefits. I just need about 3–4 minutes to see if you qualify, is that okay?\n\n[QUALIFY]\n1. Can you confirm your date of birth?\n2. And what state do you live in?\n3. Are you currently working at all?\n4. Have you worked at least 5 out of the last 10 years?\n5. Are you currently receiving SSI or SSDI benefits?\n6. What is the disability that''s preventing you from working?\n7. Has that condition (or will it) last at least 12 months?\n8. Do you currently have an attorney representing you?\n\n[IF QUALIFIED]\nGreat news — based on what you told me, you appear to meet the initial criteria.\n\nHere''s what happens next: one of our specialists will call you back for a short verification call, and we''ll email you a secure link to upload a few documents (your ID and work history). Make sure to keep your phone nearby.\n\nDo you have any questions for me? Thank you for your time, {{first_name}}. Have a great day!\n\n[IF NOT QUALIFIED]\nThank you for your time — unfortunately based on the information you provided, you don''t meet the current program criteria. We''ll note your file accordingly.'),
('Verification Script', 'verification', E'VERIFICATION CALL — SSDI\n\nHi {{first_name}}, this is {{agent_name}} again — we spoke earlier about your disability benefits application. This is the verification step and the call is recorded. Do you consent to continue?\n\n[VERIFY]\n1. Please confirm your full legal name.\n2. Your date of birth is {{dob}}, correct?\n3. And your mailing address / city and state?\n4. Confirming again: you are NOT currently receiving SSI or SSDI?\n5. You worked 5 of the last 10 years — can you tell me where you last worked and roughly when?\n6. Let''s go over your disability once more — when did you stop working because of it?\n\n[DOCS]\nI''ve just sent a secure link to your email {{email}}. You''ll upload:\n • Government-issued photo ID\n • Proof of work history (any paystub, W-2, or work numbers)\n\n[DISPOSITION]\nIf everything checks out: “You''re all verified — our specialist will be in touch within 24–48 hours. Congratulations on taking this step.”\nIf something fails: document the reason and set the proper disposition in the CRM.')
on conflict do nothing;

insert into public.templates (type, name, subject, body) values
('email', 'Follow-up — Documents Needed', 'Action needed: documents for your disability claim', E'<p>Hi <strong>{{first_name}}</strong>,</p>\n<p>Thank you for speaking with us about your Social Security Disability benefits. To move your file forward we need a couple of documents.</p>\n<p><strong>Please upload them here (secure link):</strong> {{doc_link}}</p>\n<p>It takes less than 2 minutes — a photo of the document from your phone works fine.</p>\n<p>Questions? Just reply to this email or call us.</p>\n<p>Best regards,<br/>{{agent_name}}<br/>Claims Team</p>'),
('email', 'Follow-up — Callback Confirmation', 'Confirming our call — {{first_name}}', E'<p>Hi <strong>{{first_name}}</strong>,</p>\n<p>Great speaking with you today about your disability benefits options.</p>\n<p>As promised, here''s a quick summary of what happens next:</p>\n<ul>\n<li>We''ll call you back at {{phone}} for a short verification call</li>\n<li>You''ll receive a secure link to upload your documents</li>\n<li>A specialist reviews your file and contacts you within 24–48 hours</li>\n</ul>\n<p>Talk soon!</p>\n<p>{{agent_name}}<br/>Claims Team</p>'),
('email', 'General Follow-up', 'Checking in, {{first_name}}', E'<p>Hi <strong>{{first_name}}</strong>,</p>\n<p>I wanted to check back in regarding your disability benefits inquiry. Would you like to continue with your application?</p>\n<p>Reply <strong>YES</strong> and I''ll get everything started for you right away.</p>\n<p>{{agent_name}}<br/>Claims Team</p>'),
('text', 'Callback — VM follow-up', NULL, E'Hi {{first_name}}, this is {{agent_name}} following up on your disability benefits request. Call me back at your convenience — thanks!'),
('text', 'Document link (SMS)', NULL, E'Hi {{first_name}} — please upload your documents here (secure): {{doc_link}} — Takes 2 minutes. {{agent_name}}'),
('text', 'Callback reminder', NULL, E'Hi {{first_name}}, reminder of our call today about your benefits application. If you need a different time, just reply. — {{agent_name}}')
on conflict do nothing;
