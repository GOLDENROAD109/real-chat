-- ─────────────────────────────────────────────────────────────────────
-- Join Us — Supabase schema
-- Run this once in your Supabase project: SQL Editor → New query → paste → Run
-- ─────────────────────────────────────────────────────────────────────

create extension if not exists pgcrypto;

-- User accounts (authentication is handled server-side by the Join Us API,
-- which talks to Supabase with the service_role key)
create table if not exists public.profiles (
  id            uuid primary key default gen_random_uuid(),
  username      text unique not null check (char_length(username) between 3 and 20),
  password_hash text not null,
  display_name  text not null default '',
  avatar_color  text not null default '#3b82f6',
  role          text not null default 'member' check (role in ('admin', 'member')),
  banned        boolean not null default false,
  created_at    timestamptz not null default now()
);

-- Chat messages
create table if not exists public.messages (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  username     text not null,
  display_name text not null default '',
  avatar_color text not null default '#3b82f6',
  role         text not null default 'member',
  content      text not null check (char_length(content) between 1 and 500),
  created_at   timestamptz not null default now()
);

create index if not exists messages_created_at_idx on public.messages (created_at desc);
create index if not exists profiles_username_idx on public.profiles (username);

-- Row Level Security: lock tables down for anon/authenticated clients.
-- The Join Us server uses the service_role key, which bypasses RLS.
-- Never expose the service_role key to the browser.
alter table public.profiles enable row level security;
alter table public.messages enable row level security;
