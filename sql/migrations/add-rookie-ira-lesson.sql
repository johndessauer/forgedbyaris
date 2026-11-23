-- Optional Rookie lesson: Investing in Real Estate with Your IRA.
--
-- The Video Lesson Library reads only the Supabase table video_library.
-- Netlify does not run this file on deploy. Merging the site does not
-- insert the row. Run this in the Supabase SQL editor for the FORGE
-- project. Until it has been applied, the lesson is on the Rookie unlock
-- page and is not listed in the Video Lesson Library.
--
-- Safe to run more than once. An existing row with this YouTube id is left
-- as it is, including a row that was unpublished on purpose.

insert into video_library (title, description, youtube_id, video_type, recorded_date, published)
select
  'Investing in Real Estate with Your IRA, 401(k), or Solo 401(k)',
  'A plain-language FORGE overview of using a self-directed IRA, 401(k), or Solo 401(k) to invest in real estate — including who qualifies for a Solo 401(k), 2026 contribution limits, checkbook control, plan loans, non-recourse debt rules, prohibited transactions, and Form 5500-EZ. Optional. Not tax, legal, or investment advice. Does not affect your lessons or your level.',
  'KXjb95o4oJg',
  'lesson',
  '2026-11-22',
  true
where not exists (
  select 1 from video_library where youtube_id = 'KXjb95o4oJg'
);
