-- ARIS conversation memory.
--
-- Run this in the Supabase SQL editor for the FORGE project BEFORE
-- relying on saved chats. Netlify does not run this file on deploy.
-- The owner runs it by hand. Safe to run more than once.
--
-- No Row Level Security policies are defined here, matching schema.sql.
-- All access goes through the aris-memory Netlify function with the
-- service-role key. That function verifies the Memberstack member and
-- only reads or writes rows for that memberstack_id. If a client-side
-- Supabase key is ever introduced, add RLS scoped on memberstack_id
-- before exposing these tables.
--
-- aris_messages.content is jsonb because a turn can be plain text or a
-- list of blocks (tool calls, tool results, an upload note).
-- summary_message_count is how many leading messages are already folded
-- into rolling_summary. facts_extracted stops fact extraction after one
-- pass per conversation. last_append_key makes a retried save a no-op.

begin;

create table if not exists public.aris_conversations (
  id uuid primary key default gen_random_uuid(),
  memberstack_id text not null,
  title text,
  rolling_summary text,
  summary_message_count integer not null default 0,
  facts_extracted boolean not null default false,
  last_append_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.aris_conversations add column if not exists title text;
alter table public.aris_conversations add column if not exists rolling_summary text;
alter table public.aris_conversations add column if not exists summary_message_count integer not null default 0;
alter table public.aris_conversations add column if not exists facts_extracted boolean not null default false;
alter table public.aris_conversations add column if not exists last_append_key text;
alter table public.aris_conversations add column if not exists created_at timestamptz not null default now();
alter table public.aris_conversations add column if not exists updated_at timestamptz not null default now();

create index if not exists aris_conversations_member_updated_idx
  on public.aris_conversations (memberstack_id, updated_at desc);

create index if not exists aris_conversations_append_key_idx
  on public.aris_conversations (memberstack_id, last_append_key);

create table if not exists public.aris_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.aris_conversations (id) on delete cascade,
  role text not null,
  content jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.aris_messages drop constraint if exists aris_messages_role_check;
alter table public.aris_messages add constraint aris_messages_role_check
  check (role in ('user', 'assistant'));

create index if not exists aris_messages_conversation_idx
  on public.aris_messages (conversation_id, created_at asc);

create table if not exists public.aris_member_facts (
  memberstack_id text primary key,
  facts jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.aris_member_facts add column if not exists facts jsonb not null default '{}'::jsonb;
alter table public.aris_member_facts add column if not exists updated_at timestamptz not null default now();

commit;
