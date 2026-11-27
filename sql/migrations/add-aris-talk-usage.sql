-- ARIS Talk Mode usage.
--
-- Run this in the Supabase SQL editor for the FORGE project BEFORE
-- anyone on the Talk Mode allowlist uses it. Netlify does not run this
-- file on deploy. The owner runs it by hand. Safe to run more than once.
--
-- No Row Level Security policies are defined here, matching
-- sql/migrations/add-aris-memory.sql. All access goes through the
-- aris-talk Netlify function with the service-role key. That function
-- verifies the Memberstack member and only reads or writes that
-- member's rows. Audio is not stored. These tables hold seconds and
-- request ids only.
--
-- add_aris_talk_seconds stays in lockstep with applyUsage in
-- assets/js/aris-talk.js: idempotent request ids, a per-call chunk cap,
-- and a hard stop at the member's monthly cap. Listening seconds are
-- accepted before speaking seconds when only part of a chunk fits.
--
-- aris_talk_alert_log is the alert hook. The function inserts one row
-- per UTC month per threshold and logs ARIS_TALK_ALERT. It does not send email.
-- See docs/ARIS-TALK-MODE.md for wiring mail to John and Simon.

begin;

create table if not exists public.aris_talk_usage (
  memberstack_id text not null,
  month_key text not null,
  listen_seconds integer not null default 0,
  speak_seconds integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (memberstack_id, month_key),
  constraint aris_talk_usage_listen_nonneg check (listen_seconds >= 0),
  constraint aris_talk_usage_speak_nonneg check (speak_seconds >= 0),
  constraint aris_talk_usage_month_key check (month_key ~ '^[0-9]{4}-[0-9]{2}$')
);

create index if not exists aris_talk_usage_month_idx
  on public.aris_talk_usage (month_key);

create table if not exists public.aris_talk_usage_requests (
  memberstack_id text not null,
  request_id text not null,
  month_key text not null,
  created_at timestamptz not null default now(),
  primary key (memberstack_id, request_id)
);

create table if not exists public.aris_talk_alert_log (
  month_key text not null,
  threshold_minutes integer not null,
  total_seconds integer not null,
  flagged_at timestamptz not null default now(),
  primary key (month_key, threshold_minutes)
);

create or replace view public.aris_talk_usage_totals as
select month_key,
       count(*)::integer as members,
       coalesce(sum(listen_seconds), 0)::bigint as listen_seconds,
       coalesce(sum(speak_seconds), 0)::bigint as speak_seconds,
       coalesce(sum(listen_seconds + speak_seconds), 0)::bigint as total_seconds
from public.aris_talk_usage
group by month_key;

create or replace function public.add_aris_talk_seconds(
  p_member text,
  p_month text,
  p_listen integer,
  p_speak integer,
  p_cap integer,
  p_request text,
  p_max_chunk integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listen integer := 0;
  v_speak integer := 0;
  v_used integer := 0;
  v_room integer := 0;
  v_accept_listen integer := 0;
  v_accept_speak integer := 0;
  v_req_listen integer := 0;
  v_req_speak integer := 0;
  v_chunk integer := 0;
begin
  if p_member is null or length(trim(p_member)) = 0 then
    raise exception 'member required';
  end if;
  if p_month is null or p_month !~ '^[0-9]{4}-[0-9]{2}$' then
    raise exception 'bad month';
  end if;
  if p_listen is null or p_listen < 0 or p_speak is null or p_speak < 0 or p_cap is null or p_cap < 0 then
    raise exception 'bad usage';
  end if;
  if p_request is null or length(trim(p_request)) = 0 then
    raise exception 'request id required';
  end if;

  if exists (
    select 1 from public.aris_talk_usage_requests
    where memberstack_id = p_member and request_id = p_request
  ) then
    select listen_seconds, speak_seconds into v_listen, v_speak
    from public.aris_talk_usage
    where memberstack_id = p_member and month_key = p_month;
    v_listen := coalesce(v_listen, 0);
    v_speak := coalesce(v_speak, 0);
    return jsonb_build_object(
      'usedSeconds', v_listen + v_speak,
      'listenSeconds', v_listen,
      'speakSeconds', v_speak,
      'acceptedListen', 0,
      'acceptedSpeak', 0,
      'capped', (v_listen + v_speak) >= p_cap,
      'replayed', true
    );
  end if;

  v_chunk := greatest(coalesce(p_max_chunk, 180), 0);
  v_req_listen := least(p_listen, v_chunk);
  v_req_speak := least(p_speak, greatest(v_chunk - v_req_listen, 0));

  insert into public.aris_talk_usage (memberstack_id, month_key, listen_seconds, speak_seconds)
  values (p_member, p_month, 0, 0)
  on conflict (memberstack_id, month_key) do nothing;

  select listen_seconds, speak_seconds into v_listen, v_speak
  from public.aris_talk_usage
  where memberstack_id = p_member and month_key = p_month
  for update;

  v_used := v_listen + v_speak;
  v_room := greatest(p_cap - v_used, 0);
  v_accept_listen := least(v_req_listen, v_room);
  v_accept_speak := least(v_req_speak, greatest(v_room - v_accept_listen, 0));

  update public.aris_talk_usage
     set listen_seconds = listen_seconds + v_accept_listen,
         speak_seconds = speak_seconds + v_accept_speak,
         updated_at = now()
   where memberstack_id = p_member and month_key = p_month;

  insert into public.aris_talk_usage_requests (memberstack_id, request_id, month_key)
  values (p_member, p_request, p_month);

  v_used := v_used + v_accept_listen + v_accept_speak;
  return jsonb_build_object(
    'usedSeconds', v_used,
    'listenSeconds', v_listen + v_accept_listen,
    'speakSeconds', v_speak + v_accept_speak,
    'acceptedListen', v_accept_listen,
    'acceptedSpeak', v_accept_speak,
    'capped', v_used >= p_cap,
    'replayed', false
  );
end;
$$;

revoke all on function public.add_aris_talk_seconds(text, text, integer, integer, integer, text, integer) from public;
revoke all on function public.add_aris_talk_seconds(text, text, integer, integer, integer, text, integer) from anon, authenticated;
grant execute on function public.add_aris_talk_seconds(text, text, integer, integer, integer, text, integer) to service_role;

commit;
