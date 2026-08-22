// netlify/functions/crm-notes.js
//
// Create and list notes, tied to a deal and/or a contact.
// Every request must carry a valid Memberstack Bearer token.
// All queries are scoped to the verified member ID.
//
// created_by distinguishes student-written notes from notes ARIS logs
// on the member's behalf after a confirmed write (see aris-stream.js
// integration, added separately).
//
// Routes:
//   GET  ?deal_id=...                       -> notes for a deal
//   GET  ?contact_id=...                    -> notes for a contact
//   POST { deal_id?, contact_id?, body, created_by }

const { verifyMember, AuthError } = require('./_Lib/verify-member');
const { supabase } = require('./_Lib/supabase-client');
const { json, preflight } = require('./_Lib/http');

const VALID_CREATED_BY = ['student', 'aris'];
const VALID_CONTACT_METHODS = ['text', 'call', 'meeting', 'email', 'other'];

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
      if (!params.deal_id && !params.contact_id) {
        return json(400, { error: 'deal_id or contact_id is required' });
      }

      let query = supabase
        .from('notes')
        .select('*')
        .eq('memberstack_id', memberId)
        .order('created_at', { ascending: false });

      if (params.deal_id) query = query.eq('deal_id', params.deal_id);
      if (params.contact_id) query = query.eq('contact_id', params.contact_id);

      const { data, error } = await query;
      if (error) throw error;
      return json(200, { notes: data });
    }

    if (event.httpMethod === 'POST') {
      const payload = JSON.parse(event.body || '{}');
      const { deal_id, contact_id, body, created_by, contact_method } = payload;

      if (!body) return json(400, { error: 'body is required' });
      if (!deal_id && !contact_id) {
        return json(400, { error: 'deal_id or contact_id is required' });
      }
      if (!created_by || !VALID_CREATED_BY.includes(created_by)) {
        return json(400, { error: `created_by is required and must be one of: ${VALID_CREATED_BY.join(', ')}` });
      }
      if (contact_method && !VALID_CONTACT_METHODS.includes(contact_method)) {
        return json(400, { error: `contact_method must be one of: ${VALID_CONTACT_METHODS.join(', ')}` });
      }

      // Verify ownership of whatever this note is being attached to,
      // so a note can't be attached to another member's deal/contact.
      if (deal_id) {
        const { data: deal } = await supabase
          .from('deals')
          .select('id')
          .eq('id', deal_id)
          .eq('memberstack_id', memberId)
          .single();
        if (!deal) return json(404, { error: 'Deal not found' });
      }
      if (contact_id) {
        const { data: contact } = await supabase
          .from('contacts')
          .select('id')
          .eq('id', contact_id)
          .eq('memberstack_id', memberId)
          .single();
        if (!contact) return json(404, { error: 'Contact not found' });
      }

      const { data, error } = await supabase
        .from('notes')
        .insert({
          memberstack_id: memberId,
          deal_id: deal_id || null,
          contact_id: contact_id || null,
          body,
          created_by,
          contact_method: contact_method || null,
        })
        .select()
        .single();

      if (error) throw error;
      return json(201, { note: data });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('crm-notes error:', err);
    return json(500, { error: 'Internal server error' });
  }
};
