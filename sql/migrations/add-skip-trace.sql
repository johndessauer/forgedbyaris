-- Skip-trace credits, 90-day cache, and CRM contact fields.
--
-- Run this in the Supabase SQL editor for the FORGE project BEFORE
-- deploying the owner-contact lookup. Do not run it from the app.
-- Safe to run more than once.
--
-- Credits are integer cents. A successful lookup costs 20 cents and is
-- held before the lookup, then kept on a hit or returned on a miss.
-- The Stripe session id is unique, so a checkout event credits once.
-- A crashed request can leave held_cents on the wallet. The balance was
-- already reduced for that hold; support can release it by calling
-- skip_trace_finish_lookup with outcome 'release' for the hold id.

begin;

create table if not exists public.skip_trace_wallets (
  memberstack_id text primary key,
  balance_cents integer not null default 0,
  held_cents integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint skip_trace_wallets_balance_nonneg check (balance_cents >= 0),
  constraint skip_trace_wallets_held_nonneg check (held_cents >= 0)
);

create table if not exists public.skip_trace_ledger (
  id uuid primary key default gen_random_uuid(),
  memberstack_id text not null,
  entry_type text not null check (entry_type in ('credit', 'hold', 'debit', 'release')),
  amount_cents integer not null check (amount_cents > 0),
  balance_after_cents integer,
  stripe_session_id text,
  address_key text,
  hold_id uuid,
  note text,
  created_at timestamptz not null default now()
);

create unique index if not exists skip_trace_ledger_session_uidx
  on public.skip_trace_ledger (stripe_session_id)
  where stripe_session_id is not null;

create index if not exists skip_trace_ledger_member_idx
  on public.skip_trace_ledger (memberstack_id, created_at desc);

create table if not exists public.skip_trace_cache (
  id uuid primary key default gen_random_uuid(),
  memberstack_id text not null,
  address_key text not null,
  address_label text,
  hit boolean not null,
  charged_cents integer not null default 0,
  result jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (memberstack_id, address_key)
);

create index if not exists skip_trace_cache_member_idx
  on public.skip_trace_cache (memberstack_id, created_at desc);

create table if not exists public.skip_trace_usage (
  scope text not null,
  bucket text not null,
  lookups integer not null default 0 check (lookups >= 0),
  updated_at timestamptz not null default now(),
  primary key (scope, bucket)
);

create or replace function public.skip_trace_credit(
  p_member text,
  p_amount integer,
  p_session text,
  p_note text
) returns jsonb
language plpgsql
as $$
declare
  existing uuid;
  next_balance integer;
begin
  if p_member is null or length(btrim(p_member)) = 0 or p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  insert into public.skip_trace_wallets (memberstack_id)
  values (p_member)
  on conflict (memberstack_id) do nothing;

  perform 1 from public.skip_trace_wallets where memberstack_id = p_member for update;

  if p_session is not null and length(btrim(p_session)) > 0 then
    select id into existing from public.skip_trace_ledger
      where stripe_session_id = p_session
      limit 1;
    if existing is not null then
      select balance_cents into next_balance from public.skip_trace_wallets where memberstack_id = p_member;
      return jsonb_build_object('ok', true, 'credited', false, 'duplicate', true, 'balanceCents', next_balance);
    end if;
  end if;

  update public.skip_trace_wallets
    set balance_cents = balance_cents + p_amount,
        updated_at = now()
    where memberstack_id = p_member
    returning balance_cents into next_balance;

  insert into public.skip_trace_ledger (
    memberstack_id, entry_type, amount_cents, balance_after_cents, stripe_session_id, note
  ) values (
    p_member, 'credit', p_amount, next_balance, nullif(btrim(p_session), ''), left(coalesce(p_note, 'Credit pack'), 160)
  );

  return jsonb_build_object('ok', true, 'credited', true, 'duplicate', false, 'balanceCents', next_balance);
end;
$$;

create or replace function public.skip_trace_begin_lookup(
  p_member text,
  p_amount integer,
  p_address_key text,
  p_daily_cap integer,
  p_monthly_cap integer,
  p_day_bucket text,
  p_month_bucket text
) returns jsonb
language plpgsql
as $$
declare
  bal integer;
  daily_used integer;
  month_used integer;
  new_hold uuid;
begin
  insert into public.skip_trace_wallets (memberstack_id)
  values (p_member)
  on conflict (memberstack_id) do nothing;

  perform 1 from public.skip_trace_wallets where memberstack_id = p_member for update;

  select balance_cents into bal from public.skip_trace_wallets where memberstack_id = p_member;
  if bal < p_amount then
    return jsonb_build_object('ok', false, 'code', 'insufficient', 'balanceCents', bal);
  end if;

  insert into public.skip_trace_usage (scope, bucket, lookups)
  values ('member_day', p_day_bucket, 0)
  on conflict (scope, bucket) do nothing;

  insert into public.skip_trace_usage (scope, bucket, lookups)
  values ('vendor_month', p_month_bucket, 0)
  on conflict (scope, bucket) do nothing;

  perform 1 from public.skip_trace_usage
    where (scope = 'member_day' and bucket = p_day_bucket)
       or (scope = 'vendor_month' and bucket = p_month_bucket)
    order by scope, bucket
    for update;

  select lookups into daily_used from public.skip_trace_usage
    where scope = 'member_day' and bucket = p_day_bucket;
  select lookups into month_used from public.skip_trace_usage
    where scope = 'vendor_month' and bucket = p_month_bucket;

  if daily_used >= p_daily_cap then
    return jsonb_build_object('ok', false, 'code', 'daily_cap', 'balanceCents', bal);
  end if;
  if month_used >= p_monthly_cap then
    return jsonb_build_object('ok', false, 'code', 'monthly_cap', 'balanceCents', bal);
  end if;

  update public.skip_trace_wallets
    set balance_cents = balance_cents - p_amount,
        held_cents = held_cents + p_amount,
        updated_at = now()
    where memberstack_id = p_member
    returning balance_cents into bal;

  update public.skip_trace_usage
    set lookups = lookups + 1, updated_at = now()
    where scope = 'member_day' and bucket = p_day_bucket;
  update public.skip_trace_usage
    set lookups = lookups + 1, updated_at = now()
    where scope = 'vendor_month' and bucket = p_month_bucket;

  insert into public.skip_trace_ledger (
    memberstack_id, entry_type, amount_cents, balance_after_cents, address_key, note
  ) values (
    p_member, 'hold', p_amount, bal, p_address_key, 'Lookup hold'
  ) returning id into new_hold;

  return jsonb_build_object('ok', true, 'holdId', new_hold, 'balanceCents', bal);
end;
$$;

create or replace function public.skip_trace_finish_lookup(
  p_member text,
  p_hold_id uuid,
  p_outcome text,
  p_month_bucket text,
  p_day_bucket text,
  p_release_daily boolean
) returns jsonb
language plpgsql
as $$
declare
  hold_row public.skip_trace_ledger%rowtype;
  bal integer;
begin
  perform 1 from public.skip_trace_wallets where memberstack_id = p_member for update;

  select * into hold_row from public.skip_trace_ledger
    where id = p_hold_id and memberstack_id = p_member and entry_type = 'hold';
  if not found then
    return jsonb_build_object('ok', false, 'error', 'hold_missing');
  end if;

  if exists (
    select 1 from public.skip_trace_ledger
    where hold_id = p_hold_id and entry_type in ('debit', 'release')
  ) then
    select balance_cents into bal from public.skip_trace_wallets where memberstack_id = p_member;
    return jsonb_build_object('ok', true, 'duplicate', true, 'balanceCents', bal);
  end if;

  if p_outcome = 'debit' then
    update public.skip_trace_wallets
      set held_cents = greatest(held_cents - hold_row.amount_cents, 0),
          updated_at = now()
      where memberstack_id = p_member
      returning balance_cents into bal;
    insert into public.skip_trace_ledger (
      memberstack_id, entry_type, amount_cents, balance_after_cents, address_key, hold_id, note
    ) values (
      p_member, 'debit', hold_row.amount_cents, bal, hold_row.address_key, p_hold_id, 'Owner contact lookup'
    );
  else
    update public.skip_trace_wallets
      set balance_cents = balance_cents + hold_row.amount_cents,
          held_cents = greatest(held_cents - hold_row.amount_cents, 0),
          updated_at = now()
      where memberstack_id = p_member
      returning balance_cents into bal;
    update public.skip_trace_usage
      set lookups = greatest(lookups - 1, 0), updated_at = now()
      where scope = 'vendor_month' and bucket = p_month_bucket;
    if p_release_daily then
      update public.skip_trace_usage
        set lookups = greatest(lookups - 1, 0), updated_at = now()
        where scope = 'member_day' and bucket = p_day_bucket;
    end if;
    insert into public.skip_trace_ledger (
      memberstack_id, entry_type, amount_cents, balance_after_cents, address_key, hold_id, note
    ) values (
      p_member, 'release', hold_row.amount_cents, bal, hold_row.address_key, p_hold_id, 'Lookup released'
    );
  end if;

  return jsonb_build_object('ok', true, 'balanceCents', bal);
end;
$$;

alter table public.contacts add column if not exists address text;
alter table public.contacts add column if not exists phones jsonb not null default '[]'::jsonb;
alter table public.contacts add column if not exists emails jsonb not null default '[]'::jsonb;
alter table public.contacts add column if not exists flags jsonb not null default '{}'::jsonb;
alter table public.contacts add column if not exists outreach_status text;

alter table public.contacts drop constraint if exists contacts_outreach_status_check;
alter table public.contacts add constraint contacts_outreach_status_check
  check (
    outreach_status is null
    or outreach_status in ('new', 'called', 'texted', 'emailed', 'do_not_contact')
  );

commit;
