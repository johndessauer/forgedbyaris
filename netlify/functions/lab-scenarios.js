// netlify/functions/lab-scenarios.js
//
// Member-facing list of published Real Estate Lab scenarios. Deliberately
// only selects id/title/description/category — never role_prompt or
// objective, which are the scenario's real "answer key" and are only
// read server-side by the lab-stream.js and lab-debrief.js edge
// functions. This mirrors education-data.js never sending correct_index
// to the client before a quiz is submitted.

const { verifyMember, AuthError } = require('./_Lib/verify-member');
const { supabase } = require('./_Lib/supabase-client');
const { json, preflight } = require('./_Lib/http');

exports.handler = async function (event, context) {
  if (event.httpMethod === 'OPTIONS') return preflight();

  try {
    await verifyMember(event);
  } catch (err) {
    if (err instanceof AuthError) return json(err.statusCode, { error: err.message });
    return json(401, { error: 'Authentication failed' });
  }

  try {
    if (event.httpMethod === 'GET') {
      const action = (event.queryStringParameters || {}).action;

      if (action === 'list') {
        const { data, error } = await supabase
          .from('lab_scenarios')
          .select('id, title, description, category, order_index')
          .eq('published', true)
          .order('order_index', { ascending: true });
        if (error) throw error;
        return json(200, { scenarios: data || [] });
      }

      return json(400, { error: 'Unknown action' });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('lab-scenarios error:', err);
    return json(500, { error: 'Server error' });
  }
};
