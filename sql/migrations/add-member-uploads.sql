-- Private bucket for member uploads (25MB).
--
-- Run this in the Supabase SQL editor for the FORGE project BEFORE deploying
-- the signed-upload change. Netlify does not run this file. Safe to run more
-- than once. It does not change plans, billing, prices, or member accounts.
--
-- What John needs to approve:
--   1. This bucket (member-uploads) is private. There is no public read policy
--      and no anon insert policy. The app creates a signed upload URL only
--      after it verifies the member, and the service role reads the file back.
--   2. The existing public "avatars" bucket, if it is already there, gets a
--      25MB file size limit. Profile photos stay on that public bucket so the
--      profile page can show them. This script does not create the avatars
--      bucket and does not make it private.
--   3. deal_documents.storage_path stores the object path for a file that
--      lives in member-uploads. Older rows keep file_data and still download.
--
-- No new environment variables. The functions already use SUPABASE_URL,
-- SUPABASE_SERVICE_ROLE_KEY, and MEMBERSTACK_SECRET_KEY.

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'member-uploads',
  'member-uploads',
  false,
  26214400,
  array[
    'application/pdf',
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif'
  ]::text[]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

update storage.buckets
set file_size_limit = 26214400
where id = 'avatars';

alter table public.deal_documents
  add column if not exists storage_path text;

commit;
