-- FORGE Comping Engine — cache, call log, monthly budget, comp reports
-- Run this in the Supabase SQL editor for the FORGE project (once).
-- Safe to re-run: every statement is "if not exists" / "or replace".
--
-- Access pattern: like every other FORGE table, all reads and writes go
-- through Netlify functions with the service-role key
-- (netlify/functions/rentcast-comps.js). Unlike the older tables, RLS is
-- ENABLED here with no policies. The service role bypasses RLS, so the
-- functions work unchanged, while the anon/public key can read nothing.
-- That is stricter than the existing tables and changes no current behavior.

create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- ---------------------------------------------------------------------
-- rentcast_cache — one row per RentCast response, shared across members
-- ---------------------------------------------------------------------
-- key = sha256(endpoint + normalized address + sorted params), computed in
-- netlify/functions/_Lib/comps-core.js. Property data is not member-
-- specific, so a cache hit serves any member at $0.
create table if not exists rentcast_cache (
  key text primary key,
  endpoint text not null,
  norm_address text,
  params jsonb,
  response jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists idx_rentcast_cache_expires_at on rentcast_cache (expires_at);
alter table rentcast_cache enable row level security;

-- ---------------------------------------------------------------------
-- rentcast_calls — every lookup, cache hit or live, per member
-- ---------------------------------------------------------------------
create table if not exists rentcast_calls (
  id bigint generated always as identity primary key,
  memberstack_id text,
  endpoint text not null,
  cache_hit boolean not null default false,
  cost_usd numeric(10,4) not null default 0,
  http_status integer,
  key text,
  address_hash text,
  created_at timestamptz not null default now()
);
create index if not exists idx_rentcast_calls_created_at on rentcast_calls (created_at);
create index if not exists idx_rentcast_calls_member_created on rentcast_calls (memberstack_id, created_at);
alter table rentcast_calls enable row level security;

-- ---------------------------------------------------------------------
-- rentcast_budget — one row per month ('YYYY-MM', UTC)
-- ---------------------------------------------------------------------
-- spend_usd starts at the plan's base fee on the first call of the month,
-- so the cap is "all-in" (brief §5.2.2).
create table if not exists rentcast_budget (
  month text primary key,
  calls integer not null default 0,
  spend_usd numeric(10,4) not null default 0,
  cap_usd numeric(10,2) not null,
  alert_80_sent boolean not null default false,
  alert_100_sent boolean not null default false,
  alert_1000_sent boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table rentcast_budget enable row level security;

-- ---------------------------------------------------------------------
-- reserve_rentcast_call — atomic check-and-reserve before every live call
-- ---------------------------------------------------------------------
-- The cost of the next call is computed HERE, under the row lock, from the
-- plan parameters, because it depends on how many calls already happened
-- this month (free until `included`, then `overage`). Computing it in the
-- function first and passing it in would race between concurrent requests.
-- (The brief sketched reserve_rentcast_call(month, est_cost, cap); this is
-- the same contract with the cost calculation moved inside the lock.)
--
-- Returns allowed=false (and reserves nothing) when spend + cost > cap.
-- Alert flags come back true exactly once per month each, because the flag
-- is flipped in the same locked transaction that detects the crossing.
create or replace function reserve_rentcast_call(
  p_month text,
  p_cap numeric,
  p_base_fee numeric,
  p_included integer,
  p_overage numeric
)
returns table (
  allowed boolean,
  cost numeric,
  calls integer,
  spend numeric,
  cap numeric,
  alert_80 boolean,
  alert_100 boolean,
  alert_1000 boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  b rentcast_budget%rowtype;
  v_cost numeric;
  v_a80 boolean := false;
  v_a100 boolean := false;
  v_a1000 boolean := false;
begin
  insert into rentcast_budget (month, calls, spend_usd, cap_usd)
    values (p_month, 0, p_base_fee, p_cap)
    on conflict (month) do nothing;

  select * into b from rentcast_budget where month = p_month for update;

  -- The cap can be changed via env var mid-month; the latest value wins.
  if b.cap_usd <> p_cap then
    update rentcast_budget set cap_usd = p_cap where month = p_month;
    b.cap_usd := p_cap;
  end if;

  v_cost := case when b.calls >= p_included then p_overage else 0 end;

  if b.spend_usd + v_cost > b.cap_usd then
    -- Refused. The 100% alert fires on the first refusal if not sent yet.
    if not b.alert_100_sent then
      update rentcast_budget set alert_100_sent = true, updated_at = now() where month = p_month;
      v_a100 := true;
    end if;
    return query select false, v_cost, b.calls, b.spend_usd, b.cap_usd, false, v_a100, false;
    return;
  end if;

  b.calls := b.calls + 1;
  b.spend_usd := b.spend_usd + v_cost;

  if not b.alert_80_sent and b.spend_usd >= 0.8 * b.cap_usd then v_a80 := true; end if;
  if not b.alert_100_sent and b.spend_usd >= b.cap_usd then v_a100 := true; end if;
  if not b.alert_1000_sent and b.calls >= 1000 then v_a1000 := true; end if;

  update rentcast_budget
     set calls = b.calls,
         spend_usd = b.spend_usd,
         alert_80_sent = alert_80_sent or v_a80,
         alert_100_sent = alert_100_sent or v_a100,
         alert_1000_sent = alert_1000_sent or v_a1000,
         updated_at = now()
   where month = p_month;

  return query select true, v_cost, b.calls, b.spend_usd, b.cap_usd, v_a80, v_a100, v_a1000;
end;
$$;

-- ---------------------------------------------------------------------
-- release_rentcast_call — undo a reservation when RentCast returns an
-- error (RentCast does not bill errors). The call itself is still logged
-- in rentcast_calls with its http_status.
-- ---------------------------------------------------------------------
create or replace function release_rentcast_call(p_month text, p_cost numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update rentcast_budget
     set calls = greatest(calls - 1, 0),
         spend_usd = greatest(spend_usd - p_cost, 0),
         updated_at = now()
   where month = p_month;
end;
$$;

revoke all on function reserve_rentcast_call(text, numeric, numeric, integer, numeric) from public, anon, authenticated;
revoke all on function release_rentcast_call(text, numeric) from public, anon, authenticated;
grant execute on function reserve_rentcast_call(text, numeric, numeric, integer, numeric) to service_role;
grant execute on function release_rentcast_call(text, numeric) to service_role;

-- ---------------------------------------------------------------------
-- comp_reports — a member's saved comp result (and share link)
-- ---------------------------------------------------------------------
create table if not exists comp_reports (
  id uuid primary key default gen_random_uuid(),
  memberstack_id text not null,
  norm_address text not null,
  subject jsonb,
  selection jsonb,          -- included comp ids, filters, ladder steps, adjustments
  sources jsonb,            -- rentcast_cache keys this report was built from
  arv numeric(14,2),
  arv_low numeric(14,2),
  arv_high numeric(14,2),
  avm numeric(14,2),
  rent numeric(10,2),
  comp_count integer,
  confidence text check (confidence in ('High', 'Medium', 'Low')),
  best_use jsonb,           -- cached ARIS best-use result (Phase 3)
  snapshot jsonb,           -- frozen copy for share links; owner/tax data stripped
  share_token text unique,
  crm_deal_id uuid,         -- native CRM deal (Phase 4)
  ghl_contact_id text,      -- GHL push (Phase 4)
  ghl_opportunity_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_comp_reports_member on comp_reports (memberstack_id, created_at desc);
create index if not exists idx_comp_reports_member_addr on comp_reports (memberstack_id, norm_address);
alter table comp_reports enable row level security;

drop trigger if exists trg_comp_reports_updated_at on comp_reports;
create trigger trg_comp_reports_updated_at
  before update on comp_reports
  for each row
  execute function set_updated_at();  -- defined in schema.sql
