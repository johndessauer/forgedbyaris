// netlify/functions/crm-contacts.js
//
// CRUD for CRM contacts. Types live in assets/js/contact-types.js
// (seller, buyer, lender, contractor, and the deal-team roles added
// later, plus other). type_label is the custom badge text for other.
// Every request must carry a valid Memberstack Bearer token.
// All queries are scoped to the verified member ID — a client can never
// read or write another member's contacts by supplying a different ID.
//
// Routes (via action field in body, or query string for GET):
//   GET  ?action=list                       -> list all contacts for this member
//   GET  ?action=list&type=lender           -> list contacts filtered by type
//   POST { action: 'create', name, type, type_label, phone, email }
//   POST { action: 'update', id, ...fields to change }

const { enforceMembership } = require('./_Lib/membership');
const { supabase } = require('./_Lib/supabase-client');
const { json, preflight } = require('./_Lib/http');
const { VALID_TYPES, resolveContactType } = require('../../assets/js/contact-types');
const { normalizeExtras } = require('./_Lib/contact-fields');

exports.handler = async function (event, context) {
  if (event.httpMethod === 'OPTIONS') return preflight();

  const gate = await enforceMembership(event);
  if (gate.response) return gate.response;
  const memberId = gate.access.memberId;

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

      // Enrich each contact with last_contact_at / last_contact_method from
      // their most recent note, so the list view can show "Last contact:
      // Phone Call · 3 days ago" without a separate round-trip per contact.
      const contactIds = data.map((c) => c.id);
      let latestNoteByContact = {};
      if (contactIds.length) {
        const { data: notesData, error: notesError } = await supabase
          .from('notes')
          .select('contact_id, created_at, contact_method')
          .in('contact_id', contactIds)
          .order('created_at', { ascending: false });
        if (!notesError && notesData) {
          for (const n of notesData) {
            if (!latestNoteByContact[n.contact_id]) {
              latestNoteByContact[n.contact_id] = { at: n.created_at, method: n.contact_method };
            }
          }
        }
      }

      const enriched = data.map((contact) => {
        const latest = latestNoteByContact[contact.id];
        return {
          ...contact,
          last_contact_at: latest ? latest.at : null,
          last_contact_method: latest ? latest.method : null,
        };
      });

      return json(200, { contacts: enriched });
    }

    if (event.httpMethod === 'POST') {
      const payload = JSON.parse(event.body || '{}');
      const { action } = payload;

      if (action === 'create') {
        const { name, type, phone, email } = payload;
        if (!name || !type) {
          return json(400, { error: 'name and type are required' });
        }
        const resolved = resolveContactType(type, payload.type_label);
        if (resolved.error) return json(400, { error: resolved.error });

        const extras = normalizeExtras(payload);
        if (extras.error) return json(400, { error: extras.error });
        const { data, error } = await supabase
          .from('contacts')
          .insert(Object.assign({
            memberstack_id: memberId,
            name,
            type: resolved.type,
            type_label: resolved.type_label,
            phone: phone || null,
            email: email || null,
          }, extras.fields))
          .select()
          .single();

        if (error) throw error;
        return json(201, { contact: data });
      }

      if (action === 'update') {
        const { id, ...fields } = payload;
        if (!id) return json(400, { error: 'id is required' });

        const allowed = ['name', 'type', 'type_label', 'phone', 'email', 'address', 'phones', 'emails', 'flags', 'outreach_status'];
        const updates = {};
        for (const key of allowed) {
          if (Object.prototype.hasOwnProperty.call(fields, key)) updates[key] = fields[key];
        }
        if (Object.keys(updates).length === 0) {
          return json(400, { error: 'No valid fields to update' });
        }

        const extras = normalizeExtras(updates);
        if (extras.error) return json(400, { error: extras.error });
        Object.assign(updates, extras.fields);
        const typeResult = await normalizeTypeUpdate(updates, id, memberId);
        if (!typeResult.ok) return json(typeResult.status, { error: typeResult.error });

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

// Fill type + type_label together so a partial update can't leave
// other without a label, or leave a custom label on a fixed type.
async function normalizeTypeUpdate(updates, id, memberId) {
  const hasType = Object.prototype.hasOwnProperty.call(updates, 'type');
  const hasLabel = Object.prototype.hasOwnProperty.call(updates, 'type_label');
  if (!hasType && !hasLabel) return { ok: true };

  let type = hasType ? updates.type : undefined;
  let typeLabel = hasLabel ? updates.type_label : undefined;

  if (!hasType || (type === 'other' && !hasLabel)) {
    const { data, error } = await supabase
      .from('contacts')
      .select('type, type_label')
      .eq('id', id)
      .eq('memberstack_id', memberId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { ok: false, status: 404, error: 'Contact not found' };
    if (!hasType) type = data.type;
    if (!hasLabel) typeLabel = data.type_label;
  }

  const resolved = resolveContactType(type, typeLabel);
  if (resolved.error) return { ok: false, status: 400, error: resolved.error };
  updates.type = resolved.type;
  updates.type_label = resolved.type_label;
  return { ok: true };
}
