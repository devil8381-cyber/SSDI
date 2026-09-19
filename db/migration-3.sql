-- migration-3: timezone-aware callbacks
-- Run in Supabase dashboard → SQL editor → paste → Run.
alter table tasks add column if not exists customer_tz text;
