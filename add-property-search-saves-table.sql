-- FORGE Property Search — saved leads table
-- Run this in the Supabase SQL editor for the FORGE project.
--
-- Same access pattern as every other FORGE table: no Row Level Security
-- policies here, because all access goes through Netlify functions using
-- the Supabase service-role key (see netlify/functions/property-search.js
-- and netlify/functions/_Lib/verify-member.js), never client-side. If a
-- client-side Supabase key is ever introduced later, RLS policies scoped
-- on memberstack_id must be added at that time — matching the note already
-- in schema.sql for the CRM tables.

create extension if not exists "pgcrypto"; -- for gen_random_uuid(), if not already enabled

-- ---------------------------------------------------------------------
-- property_search_saves
-- ---------------------------------------------------------------------
-- A member's saved leads from Property Search. Deliberately separate from
-- the CRM's `deals` table (see schema.sql) — saving a lead here means
-- "I want to keep this," not "I'm actively working this deal." Nothing
-- lands in the CRM pipeline unless the member explicitly sends it there
-- (Stage 2 fast-follow: a `send_to_crm` action on this table, mirroring
-- the pattern already used by saved-deals.js's add_to_pipeline).
create table if not exists property_search_saves (
  id uuid primary key default gen_random_uuid(),
  memberstack_id text not null,
  lead_id text not null,          -- PropertyRadar's RadarID once live, or the demo id in fallback mode
  address text,
  play_id text,                   -- which lead-type play(s) this came from (prefore, absentee, etc.)
                                   -- a lead can match more than one play — stored as a comma-joined
                                   -- list (e.g. "prefore,highequity"), not a single value. The index
                                   -- below is exact-match on that joined string, not per-tag lookup.
  lat double precision,
  lng double precision,
  owner text,
  equity integer,                 -- estimated equity in $K
  crm_deal_id uuid references deals (id) on delete set null, -- set once Stage 2's send_to_crm links this to a real CRM deal
  created_at timestamptz not null default now()
);

create index if not exists idx_property_search_saves_memberstack_id on property_search_saves (memberstack_id);
create index if not exists idx_property_search_saves_play_id on property_search_saves (play_id);
