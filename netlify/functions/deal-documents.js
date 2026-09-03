// netlify/functions/deal-documents.js
//
// Classic Netlify function backing the "Save to Deal" / Documents feature:
// stores PDF reports generated from Deal Analyzer, Market Oracle, and
// Capital Radar (file_data, base64), member-uploaded files (file_data,
// base64), and Document Vault attachments (file_url, a pointer to the
// existing /docs/... template — no bytes duplicated) against a CRM deal.
// Lists/deletes them for the Documents panel on the deal detail view in
// crm.html.
//
// NOTE ON AUTH: this verifies the Memberstack Bearer token directly via
// @memberstack/admin rather than importing a shared helper (e.g.
// _lib/verify-member.js), since I don't have that file's exact export
// signature to match against. Functionally this does the same thing every
// other classic function in this codebase does (validate the token, scope
// every query to the resulting memberstack_id). If you have a shared helper,
// swap the block marked below for your existing import — it's a one-line
// change, everything after it (memberstackId) stays the same.
//
// Requires env vars already present in this project: MEMBERSTACK_SECRET_KEY,
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

const { createClient } = require('@supabase/supabase-js');
const memberstackAdmin = require('@memberstack/admin');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const memberstack = memberstackAdmin.init(process.env.MEMBERSTACK_SECRET_KEY);

const VALID_SOURCE_TOOLS = ['deal_analyzer', 'market_oracle', 'capital_radar', 'manual_upload', 'document_vault'];

async function verifyMemberstackId(event) {
  // ── AUTH BLOCK — swap this for your shared helper if you have one ──
  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  try {
    const { id } = await memberstack.verifyToken({ token });
    return id || null;
  } catch (e) {
    return null;
  }
  // ── end auth block ──
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };

  const memberstackId = await verifyMemberstackId(event);
  if (!memberstackId) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Not authenticated' }) };
  }

  try {
    if (event.httpMethod === 'GET') {
      const dealId = event.queryStringParameters?.deal_id;
      if (!dealId) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'deal_id is required' }) };
      }

      // Confirm the deal belongs to this member before returning anything
      // attached to it.
      const { data: deal, error: dealErr } = await supabase
        .from('deals')
        .select('id')
        .eq('id', dealId)
        .eq('memberstack_id', memberstackId)
        .single();
      if (dealErr || !deal) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Deal not found' }) };
      }

      const { data: documents, error } = await supabase
        .from('deal_documents')
        .select('id, deal_id, source_tool, title, file_data, file_url, created_at')
        .eq('deal_id', dealId)
        .eq('memberstack_id', memberstackId)
        .order('created_at', { ascending: false });
      if (error) throw error;

      return { statusCode: 200, headers, body: JSON.stringify({ documents: documents || [] }) };
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const action = body.action;

      if (action === 'create') {
        const { deal_id, source_tool, title, file_data, file_url } = body;
        if (!deal_id || !source_tool || !title || (!file_data && !file_url)) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: 'deal_id, source_tool, title, and either file_data or file_url are required' }) };
        }
        if (!VALID_SOURCE_TOOLS.includes(source_tool)) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid source_tool' }) };
        }

        // Confirm the deal belongs to this member before attaching anything to it.
        const { data: deal, error: dealErr } = await supabase
          .from('deals')
          .select('id')
          .eq('id', deal_id)
          .eq('memberstack_id', memberstackId)
          .single();
        if (dealErr || !deal) {
          return { statusCode: 404, headers, body: JSON.stringify({ error: 'Deal not found' }) };
        }

        const { data: inserted, error } = await supabase
          .from('deal_documents')
          .insert({
            memberstack_id: memberstackId,
            deal_id,
            source_tool,
            title,
            file_data: file_data || null,
            file_url: file_url || null,
          })
          .select('id, deal_id, source_tool, title, created_at')
          .single();
        if (error) throw error;

        return { statusCode: 200, headers, body: JSON.stringify({ document: inserted }) };
      }

      if (action === 'delete') {
        const { id } = body;
        if (!id) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: 'id is required' }) };
        }
        const { error } = await supabase
          .from('deal_documents')
          .delete()
          .eq('id', id)
          .eq('memberstack_id', memberstackId);
        if (error) throw error;

        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
      }

      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  } catch (err) {
    console.error('deal-documents error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal error' }) };
  }
};
