-- Migration 1 — run once in Supabase SQL Editor
-- Adds the full address + structured SSDI intake questionnaire storage.
alter table public.leads add column if not exists address text;
alter table public.leads add column if not exists zip text;
alter table public.leads add column if not exists intake jsonb not null default '{}';
