-- FORGE CRM — expand contact types and store a custom label for Other.
--
-- Run this in the Supabase SQL editor for the FORGE project BEFORE
-- merging or deploying the contact-type change. Do not rely on
-- schema.sql for an existing project: that file creates the contacts
-- table only when it is missing, so it will not replace the original
-- check (type in ('seller', 'buyer', 'lender', 'contractor')).
--
-- Until this script has been applied:
--   * saving Attorney, Accountant/CPA, Title/Escrow, or any other new
--     type fails the old check
--   * saving Other fails because the type_label column does not exist
-- Seller, buyer, lender, and contractor rows already in the table are
-- not updated and are not deleted. They keep working: the new check
-- still allows those four types, and type_label stays null on them.
--
-- Safe to run more than once. If any existing row has a type outside
-- the list below, the new check aborts the transaction and nothing is
-- changed.

begin;

alter table contacts add column if not exists type_label text;

-- The original column check was created inline, so Postgres named it
-- contacts_type_check. Drop that and any earlier copy of this script's
-- check (both mention seller and contractor) before adding the new one.
do $$
declare
  r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'contacts'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%seller%'
      and pg_get_constraintdef(con.oid) ilike '%contractor%'
  loop
    execute format('alter table public.contacts drop constraint %I', r.conname);
  end loop;
end $$;

alter table contacts drop constraint if exists contacts_type_check;
alter table contacts add constraint contacts_type_check
  check (type in (
    'seller',
    'buyer',
    'lender',
    'contractor',
    'attorney',
    'accountant',
    'title_escrow',
    'inspector',
    'appraiser',
    'surveyor',
    'engineer',
    'property_manager',
    'insurance_agent',
    'agent_broker',
    'wholesaler',
    'other'
  ));

alter table contacts drop constraint if exists contacts_type_label_check;
alter table contacts add constraint contacts_type_label_check
  check (
    (
      type = 'other'
      and type_label is not null
      and char_length(btrim(type_label)) between 1 and 60
    )
    or (
      type <> 'other'
      and type_label is null
    )
  );

commit;
