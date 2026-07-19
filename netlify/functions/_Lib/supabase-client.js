// netlify/functions/_lib/supabase-client.js
//
// Single shared Supabase client using the service-role key.
// This key must NEVER be exposed to the client — it is only read here,
// server-side, from a Netlify environment variable. All CRM functions
// import this client rather than creating their own.

const { createClient } = require('@supabase/supabase-js');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  // Fail loudly at cold-start rather than on first request.
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

module.exports = { supabase };
