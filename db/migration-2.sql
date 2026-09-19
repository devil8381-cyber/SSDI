-- Migration 2 — run once in Supabase SQL Editor
-- Adds agent phone (used in welcome emails) + per-agent lead capacity.
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists max_leads int;
