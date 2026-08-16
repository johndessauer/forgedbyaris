// netlify/functions/lab-admin.js
//
// Admin-only authoring API for Real Estate Lab scenarios. Every route is
// gated by a server-side email allowlist check — never trust a client
// claim of "I'm an admin." The allowlist is checked against the member's
// real email on file with Memberstack, looked up server-side from the
// verified token, not from anything the client sends. Mirrors
// education-admin.js's auth pattern exactly.
//
// This is the ONLY route that ever returns role_prompt or objective —
// a scenario's hidden "answer key." The member-facing lab-scenarios.js
// deliberately never selects these columns. lab-stream.js and
// lab-debrief.js read them server-side directly from Supabase, not
// through this function.
//
// To add another admin later, add their email to ADMIN_EMAILS below and
// redeploy — there's no UI for managing this list, intentionally, since
// it should change rarely and a code change is an easy audit trail.
//
// Routes:
//   GET  ?action=list_all                            -> every scenario (published + draft), all columns
//   GET  ?action=get&id=<uuid>                        -> one scenario, all columns (including role_prompt/objective, for editing)
//   POST { action: 'create_scenario', ...fields }     -> insert a new scenario
//   POST { action: 'update_scenario', id, ...fields } -> update a scenario's fields
//   POST { action: 'delete_scenario', id }            -> delete a scenario (cascades to its lab_sessions rows)
//   POST { action: 'toggle_publish', id, published }  -> publish/unpublish

const memberstackAdmin = require('@memberstack/admin');
const { verifyMember, AuthError } = require('./_Lib/verify-member');
const { supabase } = require('./_Lib/supabase-client');
const { json, preflight } = require('./_Lib/http');

const memberstack = memberstackAdmin.init(process.env.MEMBERSTACK_SECRET_KEY);

// John's known FORGE-admin emails. Kept identical to education-admin.js —
// if the admin roster changes, update both files together.
const ADMIN_EMAILS = ['john@thedessauergroup.com', 'jdessauer@antonagency.com'];

async function requireAdmin(memberId) {
  const { data: member } = await memberstack.members.retrieve({ id: memberId });
  const email = (member?.auth?.email || '').toLowerCase();
  if (!ADMIN_EMAILS.includes(email)) {
    throw new AuthError('Not authorized for Lab admin', 403);
  }
  return email;
}

exports.handler = async function (event, context) {
  if (event.httpMethod === 'OPTIONS') return preflight();

  let memberId;
  try {
    memberId = await verifyMember(event);
    await requireAdmin(memberId);
  } catch (err) {
    if (err instanceof AuthError) return json(err.statusCode, { error: err.message });
    return json(401, { error: 'Authentication failed' });
  }

  try {
    if (event.httpMethod === 'GET') {
      const action = (event.queryStringParameters || {}).action;

      if (action === 'list_all') {
        const { data, error } = await supabase
          .from('lab_scenarios')
          .select('id, title, description, category, counterparty_role, counterparty_gender, order_index, published')
          .order('category', { ascending: true })
          .order('order_index', { ascending: true });
        if (error) throw error;
        return json(200, { scenarios: data || [] });
      }

      if (action === 'get') {
        const id = (event.queryStringParameters || {}).id;
        if (!id) return json(400, { error: 'id is required' });

        const { data, error } = await supabase
          .from('lab_scenarios')
          .select('*')
          .eq('id', id)
          .maybeSingle();
        if (error) throw error;
        if (!data) return json(404, { error: 'Scenario not found' });

        return json(200, { scenario: data });
      }

      return json(400, { error: 'Unknown action' });
    }

    if (event.httpMethod === 'POST') {
      const payload = JSON.parse(event.body || '{}');

      if (payload.action === 'create_scenario') {
        const { title, category, counterpartyRole, counterpartyGender, description, rolePrompt, objective, orderIndex } = payload;
        if (!title || !category) return json(400, { error: 'title and category are required' });
        if (!rolePrompt || !objective) return json(400, { error: 'rolePrompt and objective are required' });
        if (counterpartyGender && !['M', 'F'].includes(counterpartyGender)) {
          return json(400, { error: "counterpartyGender must be 'M' or 'F'" });
        }

        const { data, error } = await supabase
          .from('lab_scenarios')
          .insert({
            title,
            category,
            counterparty_role: counterpartyRole || null,
            counterparty_gender: counterpartyGender || null,
            description: description || null,
            role_prompt: rolePrompt,
            objective,
            order_index: orderIndex || 0,
            published: false, // always created as a draft; publish is a separate explicit step
          })
          .select()
          .single();
        if (error) throw error;
        return json(200, { scenario: data });
      }

      if (payload.action === 'update_scenario') {
        const { id, title, category, counterpartyRole, counterpartyGender, description, rolePrompt, objective, orderIndex } = payload;
        if (!id) return json(400, { error: 'id is required' });
        if (counterpartyGender && !['M', 'F'].includes(counterpartyGender)) {
          return json(400, { error: "counterpartyGender must be 'M' or 'F'" });
        }

        const updates = {};
        if (title !== undefined) updates.title = title;
        if (category !== undefined) updates.category = category;
        if (counterpartyRole !== undefined) updates.counterparty_role = counterpartyRole;
        if (counterpartyGender !== undefined) updates.counterparty_gender = counterpartyGender;
        if (description !== undefined) updates.description = description;
        if (rolePrompt !== undefined) updates.role_prompt = rolePrompt;
        if (objective !== undefined) updates.objective = objective;
        if (orderIndex !== undefined) updates.order_index = orderIndex;

        const { data, error } = await supabase.from('lab_scenarios').update(updates).eq('id', id).select().single();
        if (error) throw error;
        return json(200, { scenario: data });
      }

      if (payload.action === 'delete_scenario') {
        const { id } = payload;
        if (!id) return json(400, { error: 'id is required' });
        const { error } = await supabase.from('lab_scenarios').delete().eq('id', id);
        if (error) throw error;
        return json(200, { deleted: true });
      }

      if (payload.action === 'toggle_publish') {
        const { id, published } = payload;
        if (!id || typeof published !== 'boolean') return json(400, { error: 'id and published (boolean) are required' });
        const { data, error } = await supabase
          .from('lab_scenarios')
          .update({ published })
          .eq('id', id)
          .select()
          .single();
        if (error) throw error;
        return json(200, { scenario: data });
      }

      return json(400, { error: 'Unknown action' });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('lab-admin error:', err);
    return json(500, { error: 'Server error' });
  }
};
