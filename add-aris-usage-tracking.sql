-- ARIS usage tracking + 14-day inactive list.
-- John: run once in the Supabase SQL editor (production). Safe to re-run.
-- member_stats already exists (memberstack_id, aris_sessions); this only adds a column and a view.

create table if not exists member_stats (
  memberstack_id text primary key,
  aris_sessions integer not null default 0
);

alter table member_stats add column if not exists last_aris_at timestamptz;

create index if not exists member_stats_last_aris_at_idx on member_stats (last_aris_at);

-- Members who have used ARIS before but not in the last 14 days, quietest first.
-- Members who have never opened ARIS have no last_aris_at and are not listed here.
create or replace view aris_inactive_14d as
select memberstack_id,
       last_aris_at,
       floor(extract(epoch from (now() - last_aris_at)) / 86400)::int as days_inactive,
       aris_sessions
from member_stats
where last_aris_at is not null
  and last_aris_at < now() - interval '14 days'
order by last_aris_at asc;
