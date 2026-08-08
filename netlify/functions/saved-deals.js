// netlify/functions/saved-deals.js
//
// Server-side storage for Deal Analyzer's "Saved Deals" vault — replacing
// the old localStorage-only 'forge-deals' key. Separate from the real CRM
// pipeline (see crm-deals.js): a saved analysis is "I ran the numbers and
// want to remember this," not "I'm actively working this deal." Nothing
// lands in the CRM pipeline unless the member explicitly promotes a saved
// analysis via add_to_pipeline.
//
// Routes:
//   GET  ?action=list                        -> all saved analyses for this member, newest first
//   POST { action: 'create', ...fields }      -> save a new analysis
//   POST { action: 'delete', id }             -> remove a saved analysis
//   POST { action: 'add_to_pipeline', id }    -> creates a real CRM deal from this saved analysis,
//                                                 records the link, returns the new CRM deal

const { verifyMember, AuthError } = require('./_Lib/verify-member');
const { supabase } = require('./_Lib/supabase-client');
const { json, preflight } = require('./_Lib/http');

// Deal Analyzer has more tabs than the CRM's deal_type enum supports —
// the CRM was built around the original 6 core strategies, and the
// analyzer has since grown 5 more specialized commercial tabs. All of
// those map to the CRM's general 'commercial_5plus' bucket.
const TAB_TO_CRM_DEAL_TYPE = {
  wholesale: 'wholesale',
  flip: 'fix_flip',
  rental: 'lt_rental',
  str: 'str_mtr',
  multi: 'units_2_4',
  commercial: 'commercial_5plus',
  storage: 'commercial_5plus',
  mhp: 'commercial_5plus',
  office: 'commercial_5plus',
  mixeduse: 'commercial_5plus',
  hotel: 'commercial_5plus',
};

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
      const action = (event.queryStringParameters || {}).action;

      if (action === 'list') {
        const { data, error } = await supabase
          .from('saved_deal_analyses')
          .select('*')
          .eq('memberstack_id', memberId)
          .order('created_at', { ascending: false });
        if (error) throw error;
        return json(200, { deals: data || [] });
      }

      return json(400, { error: 'Unknown action' });
    }

    if (event.httpMethod === 'POST') {
      const payload = JSON.parse(event.body || '{}');

      if (payload.action === 'create') {
        const {
          displayName, nickname, address, street, city, state, zip,
          tab, verdict, verdictText, dealData, photos, docs,
        } = payload;
        if (!displayName || !tab) return json(400, { error: 'displayName and tab are required' });

        const { data, error } = await supabase
          .from('saved_deal_analyses')
          .insert({
            memberstack_id: memberId,
            display_name: displayName,
            nickname: nickname || null,
            address: address || null,
            street: street || null,
            city: city || null,
            state: state || null,
            zip: zip || null,
            tab,
            verdict: verdict || null,
            verdict_text: verdictText || null,
            deal_data: dealData || null,
            photos: photos || [],
            docs: docs || [],
          })
          .select()
          .single();
        if (error) throw error;
        return json(201, { deal: data });
      }

      if (payload.action === 'delete') {
        const { id } = payload;
        if (!id) return json(400, { error: 'id is required' });
        // Scoped to memberstack_id so a member can only delete their own
        // saved analyses, never guess another member's row id.
        const { error } = await supabase
          .from('saved_deal_analyses')
          .delete()
          .eq('id', id)
          .eq('memberstack_id', memberId);
        if (error) throw error;
        return json(200, { deleted: true });
      }

      if (payload.action === 'add_to_pipeline') {
        const { id } = payload;
        if (!id) return json(400, { error: 'id is required' });

        const { data: saved, error: fetchError } = await supabase
          .from('saved_deal_analyses')
          .select('*')
          .eq('id', id)
          .eq('memberstack_id', memberId)
          .maybeSingle();
        if (fetchError) throw fetchError;
        if (!saved) return json(404, { error: 'Saved deal not found' });

        if (saved.crm_deal_id) {
          return json(400, { error: 'This deal has already been added to the pipeline' });
        }

        const dealType = TAB_TO_CRM_DEAL_TYPE[saved.tab] || 'wholesale';

        const { data: crmDeal, error: crmError } = await supabase
          .from('deals')
          .insert({
            memberstack_id: memberId,
            property_address: saved.address || saved.display_name,
            deal_type: dealType,
            stage: 'New Lead',
          })
          .select()
          .single();
        if (crmError) throw crmError;

        const { error: linkError } = await supabase
          .from('saved_deal_analyses')
          .update({ crm_deal_id: crmDeal.id })
          .eq('id', id)
          .eq('memberstack_id', memberId);
        if (linkError) throw linkError;

        return json(200, { crmDeal });
      }

      return json(400, { error: 'Unknown action' });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('saved-deals error:', err);
    return json(500, { error: 'Server error' });
  }
};
