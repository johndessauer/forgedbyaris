// netlify/functions/crm-deals.js
//
// CRUD for CRM deals, including pipeline stage moves.
// Every request must carry a valid Memberstack Bearer token.
// All queries are scoped to the verified member ID.
//
// Routes:
//   GET  ?action=list                       -> list all deals for this member
//   GET  ?action=list&stage=Under+Contract  -> list deals filtered by stage
//   GET  ?action=summary                    -> counts per stage (for ARIS / dashboard)
//   POST { action: 'create', property_address, deal_type }
//   POST { action: 'update', id, ...fields to change (incl. stage) }
//   POST { action: 'link_contact', deal_id, contact_id, role }

const { verifyMember, AuthError } = require('./_lib/verify-member');
const { supabase } = require('./_lib/supabase-client');
const { json, preflight } = require('./_lib/http');

const VALID_STAGES = ['New Lead', 'Contacted', 'Qualified', 'Making Offer', 'Under Contract', 'Closed', 'Dead'];
const VALID_DEAL_TYPES = ['wholesale', 'fix_flip', 'lt_rental', 'str_mtr', 'units_2_4', 'commercial_5plus'];

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

      if (params.action === 'summary') {
        const { data, error } = await supabase
          .from('deals')
          .select('stage')
          .eq('memberstack_id', memberId);
        if (error) throw error;

        const counts = Object.fromEntries(VALID_STAGES.map((s) => [s, 0]));
        for (const row of data) {
          if (counts[row.stage] !== undefined) counts[row.stage] += 1;
        }
        return json(200, { summary: counts, total: data.length });
      }

      let query = supabase
        .from('deals')
        .select('*')
        .eq('memberstack_id', memberId)
        .order('updated_at', { ascending: false });

      if (params.stage) {
        if (!VALID_STAGES.includes(params.stage)) {
          return json(400, { error: `Invalid stage. Must be one of: ${VALID_STAGES.join(', ')}` });
        }
        query = query.eq('stage', params.stage);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Enrich each deal with a last_activity_at (latest note, or the deal's
      // own updated_at if it has no notes) and a stale flag -- 30+ days
      // since that activity, meaning no note or stage change has happened.
      // This powers both the "Needs Follow-up" badge in the CRM UI and
      // ARIS's find_stale_deals tool, computed once here so neither has to
      // guess from raw timestamps.
      const dealIds = data.map((d) => d.id);
      let latestNoteByDeal = {};
      if (dealIds.length) {
        const { data: notesData, error: notesError } = await supabase
          .from('notes')
          .select('deal_id, created_at')
          .in('deal_id', dealIds)
          .order('created_at', { ascending: false });
        if (!notesError && notesData) {
          for (const n of notesData) {
            if (!latestNoteByDeal[n.deal_id]) latestNoteByDeal[n.deal_id] = n.created_at;
          }
        }
      }

      const STALE_DAYS = 30;
      const now = Date.now();
      const enriched = data.map((deal) => {
        const lastNote = latestNoteByDeal[deal.id];
        const lastActivityAt = lastNote && new Date(lastNote) > new Date(deal.updated_at) ? lastNote : deal.updated_at;
        const daysSinceActivity = Math.floor((now - new Date(lastActivityAt).getTime()) / (1000 * 60 * 60 * 24));
        const stale = deal.stage !== 'Closed' && deal.stage !== 'Dead' && daysSinceActivity >= STALE_DAYS;
        return { ...deal, last_activity_at: lastActivityAt, days_since_activity: daysSinceActivity, stale };
      });

      return json(200, { deals: enriched });
    }

    if (event.httpMethod === 'POST') {
      const payload = JSON.parse(event.body || '{}');
      const { action } = payload;

      if (action === 'create') {
        const { property_address, deal_type, stage } = payload;
        if (!deal_type || !VALID_DEAL_TYPES.includes(deal_type)) {
          return json(400, { error: `deal_type is required and must be one of: ${VALID_DEAL_TYPES.join(', ')}` });
        }
        if (stage && !VALID_STAGES.includes(stage)) {
          return json(400, { error: `Invalid stage. Must be one of: ${VALID_STAGES.join(', ')}` });
        }

        const { data, error } = await supabase
          .from('deals')
          .insert({
            memberstack_id: memberId,
            property_address: property_address || null,
            deal_type,
            stage: stage || 'New Lead',
          })
          .select()
          .single();

        if (error) throw error;
        return json(201, { deal: data });
      }

      if (action === 'update') {
        const { id, ...fields } = payload;
        if (!id) return json(400, { error: 'id is required' });

        const allowed = ['property_address', 'deal_type', 'stage'];
        const updates = {};
        for (const key of allowed) {
          if (key in fields) updates[key] = fields[key];
        }
        if (updates.stage && !VALID_STAGES.includes(updates.stage)) {
          return json(400, { error: `Invalid stage. Must be one of: ${VALID_STAGES.join(', ')}` });
        }
        if (updates.deal_type && !VALID_DEAL_TYPES.includes(updates.deal_type)) {
          return json(400, { error: `Invalid deal_type. Must be one of: ${VALID_DEAL_TYPES.join(', ')}` });
        }
        if (Object.keys(updates).length === 0) {
          return json(400, { error: 'No valid fields to update' });
        }

        const { data, error } = await supabase
          .from('deals')
          .update(updates)
          .eq('id', id)
          .eq('memberstack_id', memberId)
          .select()
          .single();

        if (error) throw error;
        if (!data) return json(404, { error: 'Deal not found' });
        return json(200, { deal: data });
      }

      if (action === 'link_contact') {
        const { deal_id, contact_id, role } = payload;
        if (!deal_id || !contact_id) {
          return json(400, { error: 'deal_id and contact_id are required' });
        }

        // Verify both the deal and the contact actually belong to this member
        // before linking them — prevents cross-member linkage via guessed IDs.
        const [{ data: deal }, { data: contact }] = await Promise.all([
          supabase.from('deals').select('id').eq('id', deal_id).eq('memberstack_id', memberId).single(),
          supabase.from('contacts').select('id').eq('id', contact_id).eq('memberstack_id', memberId).single(),
        ]);
        if (!deal) return json(404, { error: 'Deal not found' });
        if (!contact) return json(404, { error: 'Contact not found' });

        const { data, error } = await supabase
          .from('deal_contacts')
          .insert({ deal_id, contact_id, role: role || null })
          .select()
          .single();

        if (error) throw error;
        return json(201, { deal_contact: data });
      }

      return json(400, { error: 'Unknown action' });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('crm-deals error:', err);
    return json(500, { error: 'Internal server error' });
  }
};
