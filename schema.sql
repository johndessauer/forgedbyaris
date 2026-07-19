-- FORGE Native CRM — v1 schema
-- Run this in the Supabase SQL editor for the FORGE project.
--
-- No Row Level Security policies are defined here. This is deliberate:
-- all access to these tables goes through Netlify functions using the
-- Supabase service-role key, never from client-side Supabase calls.
-- The Netlify functions are the enforcement point for per-member scoping
-- (see netlify/functions/_lib/verify-member.js). If a client-side Supabase
-- key is ever introduced later, RLS policies scoped on memberstack_id
-- must be added at that time.

create extension if not exists "pgcrypto"; -- for gen_random_uuid()

-- ---------------------------------------------------------------------
-- contacts
-- ---------------------------------------------------------------------
create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  memberstack_id text not null,
  name text not null,
  type text not null check (type in ('seller', 'buyer', 'lender', 'contractor')),
  phone text,
  email text,
  created_at timestamptz not null default now()
);

create index if not exists idx_contacts_memberstack_id on contacts (memberstack_id);
create index if not exists idx_contacts_type on contacts (type);

-- ---------------------------------------------------------------------
-- deals
-- ---------------------------------------------------------------------
create table if not exists deals (
  id uuid primary key default gen_random_uuid(),
  memberstack_id text not null,
  property_address text,
  deal_type text not null check (deal_type in ('residential', 'commercial')),
  stage text not null default 'New Lead'
    check (stage in ('New Lead', 'Contacted', 'Under Contract', 'Closed', 'Dead')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_deals_memberstack_id on deals (memberstack_id);
create index if not exists idx_deals_stage on deals (stage);

-- keep updated_at current on any change, including stage moves
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_deals_updated_at on deals;
create trigger trg_deals_updated_at
  before update on deals
  for each row
  execute function set_updated_at();

-- ---------------------------------------------------------------------
-- deal_contacts (join table)
-- ---------------------------------------------------------------------
create table if not exists deal_contacts (
  deal_id uuid not null references deals (id) on delete cascade,
  contact_id uuid not null references contacts (id) on delete cascade,
  role text,
  primary key (deal_id, contact_id)
);

create index if not exists idx_deal_contacts_deal_id on deal_contacts (deal_id);
create index if not exists idx_deal_contacts_contact_id on deal_contacts (contact_id);

-- ---------------------------------------------------------------------
-- notes
-- ---------------------------------------------------------------------
create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  memberstack_id text not null,
  deal_id uuid references deals (id) on delete cascade,
  contact_id uuid references contacts (id) on delete cascade,
  body text not null,
  created_by text not null check (created_by in ('student', 'aris')),
  created_at timestamptz not null default now(),
  constraint notes_target_check check (deal_id is not null or contact_id is not null)
);

create index if not exists idx_notes_memberstack_id on notes (memberstack_id);
create index if not exists idx_notes_deal_id on notes (deal_id);
create index if not exists idx_notes_contact_id on notes (contact_id);
