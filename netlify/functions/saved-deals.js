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

const { enforceMembership, requiresEmpireAnalyzer } = require('./_Lib/membership');
const { supabase } = require('./_Lib/supabase-client');
const { json, preflight } = require('./_Lib/http');
const uploads = require('./_Lib/member-uploads');

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
  // Creative finance stays on the rental CRM type until the deal_type
  // enum grows. Residential and commercial sections both use it.
  'lease-option': 'lt_rental',
  'subject-to': 'lt_rental',
  assumption: 'lt_rental',
};

function normalizeAttachments(memberId, items, kind, cap) {
  const list = Array.isArray(items) ? items : [];
  if (list.length > cap) {
    throw new uploads.UploadError(kind === 'photo' ? 'You can attach up to 5 photos.' : 'You can attach up to 3 documents.', 400, 'too_many');
  }
  return list.map((item) => uploads.storedAttachment(memberId, item, kind));
}

async function confirmStored(items) {
  const api = supabase.storage.from(uploads.PRIVATE_BUCKET);
  for (const item of items) {
    if (!item.path) continue;
    let size = NaN;
    let contentType = '';
    if (typeof api.info === 'function') {
      const { data, error } = await api.info(item.path);
      if (!error && data) {
        const meta = data.metadata || {};
        size = Number(data.size != null ? data.size : meta.size);
        contentType = data.contentType || meta.mimetype || '';
      }
    }
    if (!Number.isFinite(size)) {
      const { data, error } = await api.download(item.path);
      if (error || !data) throw new uploads.UploadError('Upload it again. The file did not arrive.', 400, 'missing');
      const buffer = Buffer.from(await data.arrayBuffer());
      size = buffer.length;
      contentType = data.type || contentType;
    }
    if (size > uploads.MAX_BYTES) throw new uploads.UploadError('File is too large — max 25MB.', 400, 'too_large');
    const mime = uploads.normalizeContentType(contentType || item.contentType, item.name);
    if (mime && !uploads.isAllowed('deal-file', mime)) throw new uploads.UploadError('That file type is not supported.', 400, 'bad_type');
  }
}

async function withSignedUrls(items) {
  const out = [];
  for (const item of items || []) {
    if (!item || item.dataUrl || !item.path) {
      out.push(item);
      continue;
    }
    try {
      const signed = await supabase.storage.from(uploads.PRIVATE_BUCKET).createSignedUrl(item.path, 60 * 60);
      const url = signed && signed.data ? (signed.data.signedUrl || signed.data.signedURL || '') : '';
      out.push(url ? Object.assign({}, item, { dataUrl: url }) : item);
    } catch (e) {
      out.push(item);
    }
  }
  return out;
}

async function presentDeal(deal) {
  if (!deal) return deal;
  return Object.assign({}, deal, {
    photos: await withSignedUrls(deal.photos),
    docs: await withSignedUrls(deal.docs),
  });
}

exports.handler = async function (event, context) {
  if (event.httpMethod === 'OPTIONS') return preflight();

  const gate = await enforceMembership(event);
  if (gate.response) return gate.response;
  const memberId = gate.access.memberId;
  const access = gate.access;

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
        const deals = [];
        for (const deal of data || []) deals.push(await presentDeal(deal));
        return json(200, { deals });
      }

      return json(400, { error: 'Unknown action' });
    }

    if (event.httpMethod === 'POST') {
      const payload = JSON.parse(event.body || '{}');

      if (payload.action === 'create') {
        const {
          displayName, nickname, address, street, city, state, zip,
          tab, verdict, verdictText, dealData, photos, docs, chatHistory
        } = payload;
        if (!displayName || !tab) return json(400, { error: 'displayName and tab are required' });
        if (requiresEmpireAnalyzer(tab, dealData) && !access.empire) {
          return json(403, { error: 'Empire membership required' });
        }

        let photosOut = [];
        let docsOut = [];
        try {
          photosOut = normalizeAttachments(memberId, photos, 'photo', 5);
          docsOut = normalizeAttachments(memberId, docs, 'doc', 3);
          await confirmStored(photosOut.concat(docsOut));
        } catch (err) {
          return json(err.statusCode || 400, { error: err.message || 'Could not save those files.' });
        }

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
            photos: photosOut,
            docs: docsOut,
            chat_history: chatHistory || [],
          })
          .select()
          .single();
        if (error) throw error;
        return json(201, { deal: await presentDeal(data) });
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
        if (requiresEmpireAnalyzer(saved.tab, saved.deal_data) && !access.empire) {
          return json(403, { error: 'Empire membership required' });
        }

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
