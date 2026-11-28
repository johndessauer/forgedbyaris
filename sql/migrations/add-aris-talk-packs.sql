-- Extra Talk Mode minutes for the current UTC month.
--
-- Run this in the Supabase SQL editor for the FORGE project AFTER
-- sql/migrations/add-aris-talk-usage.sql. Netlify does not run this file
-- on deploy. Safe to run more than once.
--
-- pack_seconds is the extra time bought this month. It does not roll
-- over. credit_aris_talk_pack adds 3600 seconds (60 minutes) for $19.97
-- and ignores a Stripe session id it has already credited. Those two
-- numbers match PACK_SECONDS and PACK_AMOUNT_CENTS in assets/js/aris-talk.js.
-- Change them together if the pack changes.
--
-- No Row Level Security policies are defined here, matching
-- add-aris-talk-usage.sql. The aris-talk-pack-webhook function uses the
-- service-role key. This file does not send email.

begin;

do $$
begin
  if to_regclass('public.aris_talk_usage') is null then
    raise exception 'run add-aris-talk-usage.sql first';
  end if;
end $$;

alter table public.aris_talk_usage
  add column if not exists pack_seconds integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'aris_talk_usage_pack_nonneg'
  ) then
    alter table public.aris_talk_usage
      add constraint aris_talk_usage_pack_nonneg check (pack_seconds >= 0);
  end if;
end $$;

create table if not exists public.aris_talk_pack_credits (
  id uuid primary key default gen_random_uuid(),
  memberstack_id text not null,
  month_key text not null,
  seconds integer not null check (seconds > 0),
  amount_cents integer not null check (amount_cents > 0),
  stripe_session_id text not null,
  created_at timestamptz not null default now(),
  constraint aris_talk_pack_credits_month_key check (month_key ~ '^[0-9]{4}-[0-9]{2}$'),
  unique (stripe_session_id)
);

create index if not exists aris_talk_pack_credits_member_idx
  on public.aris_talk_pack_credits (memberstack_id, month_key, created_at desc);

create or replace view public.aris_talk_usage_totals as
select month_key,
       count(*)::integer as members,
       coalesce(sum(listen_seconds), 0)::bigint as listen_seconds,
       coalesce(sum(speak_seconds), 0)::bigint as speak_seconds,
       coalesce(sum(listen_seconds + speak_seconds), 0)::bigint as total_seconds,
       coalesce(sum(pack_seconds), 0)::bigint as pack_seconds
from public.aris_talk_usage
group by month_key;

create or replace function public.credit_aris_talk_pack(
  p_member text,
  p_month text,
  p_seconds integer,
  p_session text,
  p_amount integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pack integer := 0;
  v_id uuid;
begin
  if p_member is null or length(btrim(p_member)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'member required');
  end if;
  if p_month is null or p_month !~ '^[0-9]{4}-[0-9]{2}$' then
    return jsonb_build_object('ok', false, 'error', 'bad month');
  end if;
  if p_session is null or length(btrim(p_session)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'session required');
  end if;
  if p_seconds is distinct from 3600 or p_amount is distinct from 1997 then
    return jsonb_build_object('ok', false, 'error', 'bad pack');
  end if;

  insert into public.aris_talk_usage (memberstack_id, month_key, listen_seconds, speak_seconds, pack_seconds)
  values (p_member, p_month, 0, 0, 0)
  on conflict (memberstack_id, month_key) do nothing;

  perform 1 from public.aris_talk_usage
    where memberstack_id = p_member and month_key = p_month
    for update;

  if exists (
    select 1 from public.aris_talk_pack_credits where stripe_session_id = p_session
  ) then
    select pack_seconds into v_pack
      from public.aris_talk_usage
      where memberstack_id = p_member and month_key = p_month;
    return jsonb_build_object(
      'ok', true,
      'credited', false,
      'duplicate', true,
      'packSeconds', coalesce(v_pack, 0)
    );
  end if;

  update public.aris_talk_usage
     set pack_seconds = pack_seconds + p_seconds,
         updated_at = now()
   where memberstack_id = p_member and month_key = p_month
   returning pack_seconds into v_pack;

  insert into public.aris_talk_pack_credits (
    memberstack_id, month_key, seconds, amount_cents, stripe_session_id
  ) values (
    p_member, p_month, p_seconds, p_amount, p_session
  ) returning id into v_id;

  return jsonb_build_object(
    'ok', true,
    'credited', true,
    'duplicate', false,
    'packSeconds', v_pack
  );
exception
  when unique_violation then
    select pack_seconds into v_pack
      from public.aris_talk_usage
      where memberstack_id = p_member and month_key = p_month;
    return jsonb_build_object(
      'ok', true,
      'credited', false,
      'duplicate', true,
      'packSeconds', coalesce(v_pack, 0)
    );
end;
$$;

revoke all on function public.credit_aris_talk_pack(text, text, integer, text, integer) from public;
revoke all on function public.credit_aris_talk_pack(text, text, integer, text, integer) from anon, authenticated;
grant execute on function public.credit_aris_talk_pack(text, text, integer, text, integer) to service_role;

commit;
