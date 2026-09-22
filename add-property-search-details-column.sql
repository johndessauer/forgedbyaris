-- FORGE Property Search — add property characteristics + "pics" links column
-- Run this in the Supabase SQL editor for the FORGE project.
--
-- Adds one jsonb column to hold everything Property Search now pulls beyond
-- address/owner/equity: property characteristics (beds, baths, sqft, year
-- built, etc. — field names sourced from PropertyRadar and NOT yet verified
-- against a live payload, see netlify/functions/property-search.js) plus
-- the two no-credential "pics" link-outs (mapUrl, zillowUrl). Stored as one
-- jsonb blob rather than one column per field since the exact field set is
-- still unverified and likely to change as PropertyRadar's response is
-- confirmed against real data.
--
-- Same access pattern as the rest of this table (see
-- add-property-search-saves-table.sql): no RLS policy needed — all access
-- goes through Netlify functions using the Supabase service-role key.

alter table property_search_saves
  add column if not exists details jsonb;
