// netlify/functions/crm-contacts.js
//
// CRUD for CRM contacts (sellers, buyers, lenders, contractors).
// Every request must carry a valid Memberstack Bearer token.
// All queries are scoped to the verified member ID — a client can never
// read or write another member's contacts by supplying a different ID.
//
// Routes (via action field in body, or query string for GET):
//   GET  ?action=list                       -> list all contacts for this member
//   GET  ?action=list&type=lender           -> list contacts filtered by type
//   POST { action: 'create', name, type, phone, email }
//   POST { action: 'update', id, ...fields to change }

const { verifyMember, AuthError } = require('./_Lib/verify-member');
const { supabase } = require('./_Lib/supabase-client');
const { json, preflight } = require('./_Lib/http');

const VALID_TYPES = ['seller', 'buyer', 'lender', 'contractor'];

exports.handler = async function (event, context) {
  if (event.httpMethod === 'OPTIONS') return preflight();

  let memberId;
  try {
    memberId = await verifyMember(event);
  } catch (err) {
    if (err instanceof AuthError) return json(err.statusCode, { error: err.message });
    return json(401, { error: 'Authentication failed' });
  }

  try {
    if (event.httpMethod === 'GET') {
      const params = event.queryStringParameters || {};
      let query = supabase
        .from('contacts')
        .select('*')
        .eq('memberstack_id', memberId)
        .order('created_at', { ascending: false });

      if (params.type) {
        if (!VALID_TYPES.includes(params.type)) {
          return json(400, { error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` });
        }
        query = query.eq('type', params.type);
      }

      const { data, error } = await query;
      if (error) throw error;
      return json(200, { contacts: data });
    }

    if (event.httpMethod === 'POST') {
      const payload = JSON.parse(event.body || '{}');
      const { action } = payload;

      if (action === 'create') {
        const { name, type, phone, email } = payload;
        if (!name || !type) {
          return json(400, { error: 'name and type are required' });
        }
        if (!VALID_TYPES.includes(type)) {
          return json(400, { error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` });
        }

        const { data, error } = await supabase
          .from('contacts')
          .insert({ memberstack_id: memberId, name, type, phone: phone || null, email: email || null })
          .select()
          .single();

        if (error) throw error;
        return json(201, { contact: data });
      }

      if (action === 'update') {
        const { id, ...fields } = payload;
        if (!id) return json(400, { error: 'id is required' });

        const allowed = ['name', 'type', 'phone', 'email'];
        const updates = {};
        for (const key of allowed) {
          if (key in fields) updates[key] = fields[key];
        }
        if (updates.type && !VALID_TYPES.includes(updates.type)) {
          return json(400, { error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` });
        }
        if (Object.keys(updates).length === 0) {
          return json(400, { error: 'No valid fields to update' });
        }

        // memberstack_id filter here is what prevents editing another
        // member's contact even if they somehow guessed a valid id.
        const { data, error } = await supabase
          .from('contacts')
          .update(updates)
          .eq('id', id)
          .eq('memberstack_id', memberId)
          .select()
          .single();

        if (error) throw error;
        if (!data) return json(404, { error: 'Contact not found' });
        return json(200, { contact: data });
      }

      return json(400, { error: 'Unknown action' });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('crm-contacts error:', err);
    return json(500, { error: 'Internal server error' });
  }
};
