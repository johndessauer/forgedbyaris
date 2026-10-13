-- Exercises add-comping-engine-tables.sql against a scratch database.
-- Run by scripts/test-sql.sh. Every check RAISEs on failure.

-- schema.sql's set_updated_at() must exist; create a stand-in if this is a
-- bare scratch database.
create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end; $$ language plpgsql;

\i add-comping-engine-tables.sql
\i add-comping-engine-tables.sql

do $$
declare r record; i int; allowed_count int := 0; a80 int := 0; a100 int := 0; a1000 int := 0;
begin
  -- Developer plan: 50 free calls, then $0.20, cap $1.
  for i in 1..60 loop
    select * into r from reserve_rentcast_call('2026-10', 1, 0, 50, 0.20);
    if r.allowed then allowed_count := allowed_count + 1; end if;
    if r.alert_80 then a80 := a80 + 1; end if;
    if r.alert_100 then a100 := a100 + 1; end if;
  end loop;
  if allowed_count <> 55 then raise exception 'expected 55 allowed calls, got %', allowed_count; end if;
  if a80 <> 1 then raise exception '80%% alert fired % times', a80; end if;
  if a100 <> 1 then raise exception '100%% alert fired % times', a100; end if;
  select * into r from rentcast_budget where month = '2026-10';
  if r.calls <> 55 or r.spend_usd <> 1.0 then raise exception 'bad budget row: calls % spend %', r.calls, r.spend_usd; end if;

  -- Foundation plan: base fee counts toward the cap.
  select * into r from reserve_rentcast_call('2026-11', 50, 74, 1000, 0.06);
  if r.allowed then raise exception 'foundation base fee should exceed a $50 cap'; end if;
  if not r.alert_100 then raise exception '100%% alert should fire on first refusal'; end if;
  select * into r from rentcast_budget where month = '2026-11';
  if r.calls <> 0 then raise exception 'refused call must not be counted'; end if;

  -- 1,000-call flag fires once.
  for i in 1..1003 loop
    select * into r from reserve_rentcast_call('2026-12', 1000, 74, 1000, 0.06);
    if r.alert_1000 then a1000 := a1000 + 1; end if;
  end loop;
  if a1000 <> 1 then raise exception '1000-call flag fired % times', a1000; end if;

  -- Release gives a failed call back.
  perform release_rentcast_call('2026-12', 0.06);
  select * into r from rentcast_budget where month = '2026-12';
  if r.calls <> 1002 then raise exception 'release did not decrement calls: %', r.calls; end if;

  -- Cap can be raised mid-month and the new value wins.
  select * into r from reserve_rentcast_call('2026-10', 5, 0, 50, 0.20);
  if not r.allowed or r.cap <> 5 then raise exception 'raised cap not applied'; end if;

  raise notice 'ALL SQL CHECKS PASSED';
end $$;

-- RLS is on and the anon role can neither read the tables nor call the functions.
do $$
begin
  if not (select relrowsecurity from pg_class where relname = 'rentcast_budget') then raise exception 'RLS off on rentcast_budget'; end if;
  if not (select relrowsecurity from pg_class where relname = 'comp_reports') then raise exception 'RLS off on comp_reports'; end if;
  if has_function_privilege('anon', 'reserve_rentcast_call(text, numeric, numeric, integer, numeric)', 'execute') then raise exception 'anon can execute reserve_rentcast_call'; end if;
  raise notice 'RLS / privilege checks passed';
end $$;
