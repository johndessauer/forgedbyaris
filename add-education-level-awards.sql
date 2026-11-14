-- FORGE Education — keep Rookie, Investor, and Mogul once they are earned.
--
-- How to run (John): open the FORGE Supabase project, SQL editor, paste this
-- whole file, and run it once. Do that BEFORE publishing any new Education
-- topic. Safe to run again: the table is created only if missing, and the
-- backfill inserts nothing that is already stored (earned_at stays on the
-- first row). This script only writes award rows. It does not send email.
--
-- What the backfill records: a member who has already passed EVERY currently
-- published module at that tier. Plans live in Memberstack, not in this
-- database, so this script cannot see who is Foundation vs Empire. Foundation
-- members who have passed every topic they are allowed to take, but not the
-- Empire topics, are recorded by the app the next time they open Education
-- or a book download. That first app save is what adds the contact tag once.
--
-- The column check below reads the live catalog. It aborts, without writing
-- awards, if education_modules / education_progress do not have the columns
-- the Netlify functions already use.

create table if not exists education_level_awards (
  memberstack_id text not null,
  level text not null check (level in ('rookie', 'investor', 'mogul')),
  earned_at timestamptz not null default now(),
  primary key (memberstack_id, level)
);

create index if not exists idx_education_level_awards_member
  on education_level_awards (memberstack_id);

-- Same access rule as the other FORGE tables: Netlify functions use the
-- service role. RLS with no policies keeps the anon key from reading awards.
alter table education_level_awards enable row level security;
grant select, insert, update, delete on table education_level_awards to service_role;

do $$
declare
  missing text;
begin
  select string_agg(req.tbl || '.' || req.col, ', ' order by req.tbl, req.col)
    into missing
  from (values
    ('education_modules', 'id'),
    ('education_modules', 'category'),
    ('education_modules', 'published'),
    ('education_progress', 'memberstack_id'),
    ('education_progress', 'module_id'),
    ('education_progress', 'tier'),
    ('education_progress', 'passed')
  ) as req(tbl, col)
  where not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = req.tbl
      and c.column_name = req.col
  );
  if missing is not null then
    raise exception 'education level backfill aborted, live columns missing: %', missing;
  end if;
end $$;

-- Members who currently meet a level against every published topic.
-- ON CONFLICT DO NOTHING keeps the original earned_at and does not re-tag.
insert into education_level_awards (memberstack_id, level)
select earned.memberstack_id, earned.level
from (
  select members.memberstack_id, tiers.level
  from (values ('rookie'), ('investor'), ('mogul')) as tiers(level)
  cross join (
    select distinct memberstack_id from education_progress
  ) as members
  where (select count(*) from education_modules where published is true) > 0
    and (
      select count(*)
      from education_modules em
      where em.published is true
        and exists (
          select 1
          from education_progress ep
          where ep.memberstack_id = members.memberstack_id
            and ep.module_id = em.id
            and ep.tier = tiers.level
            and ep.passed is true
        )
    ) = (select count(*) from education_modules where published is true)
) as earned
on conflict (memberstack_id, level) do nothing;
