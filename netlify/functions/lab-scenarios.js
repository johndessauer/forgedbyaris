// netlify/functions/lab-scenarios.js
//
// Member-facing list of published Real Estate Lab scenarios. Deliberately
// only selects id/title/description/category — never role_prompt or
// objective, which are the scenario's real "answer key" and are only
// read server-side by the lab-stream.js and lab-debrief.js edge
// functions. This mirrors education-data.js never sending correct_index
// to the client before a quiz is submitted.

const { enforceMembership, EMPIRE_SCENARIO_TITLE } = require('./_Lib/membership');
const { supabase } = require('./_Lib/supabase-client');
const { json, preflight } = require('./_Lib/http');

exports.handler = async function (event, context) {
  if (event.httpMethod === 'OPTIONS') return preflight();

  const gate = await enforceMembership(event);
  if (gate.response) return gate.response;
  const access = gate.access;

  try {
    if (event.httpMethod === 'GET') {
      const action = (event.queryStringParameters || {}).action;

      if (action === 'list') {
        const { data, error } = await supabase
          .from('lab_scenarios')
          .select('id, title, description, student_briefing, category, counterparty_role, counterparty_gender, order_index')
          .eq('published', true)
          .order('order_index', { ascending: true });
        if (error) throw error;
        const scenarios = (data || []).map((s) => {
          if (s.title === EMPIRE_SCENARIO_TITLE && !access.empire) {
            return {
              id: s.id,
              title: s.title,
              description: s.description,
              category: s.category,
              counterparty_role: s.counterparty_role,
              counterparty_gender: s.counterparty_gender,
              order_index: s.order_index,
              locked: true,
            };
          }
          return s;
        });
        return json(200, { scenarios });
      }

      return json(400, { error: 'Unknown action' });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('lab-scenarios error:', err);
    return json(500, { error: 'Server error' });
  }
};
