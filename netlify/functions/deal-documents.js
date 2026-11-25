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
// Auth: enforceMembership (verified memberstack_id + a live FORGE plan).
// Every query is still scoped to that id.
//
// Requires env vars already present in this project: MEMBERSTACK_SECRET_KEY,
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

const { createClient } = require('@supabase/supabase-js');
const { enforceMembership } = require('./_Lib/membership');
const uploads = require('./_Lib/member-uploads');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const VALID_SOURCE_TOOLS = ['deal_analyzer', 'market_oracle', 'capital_radar', 'manual_upload', 'document_vault', 'comp_report'];

async function objectStat(bucket, path) {
  const api = supabase.storage.from(bucket);
  if (typeof api.info === 'function') {
    const { data, error } = await api.info(path);
    if (!error && data) {
      const meta = data.metadata || {};
      const size = Number(data.size != null ? data.size : meta.size);
      if (Number.isFinite(size)) return { size, contentType: data.contentType || meta.mimetype || meta.contentType || '' };
    }
  }
  const { data, error } = await api.download(path);
  if (error || !data) return null;
  const buffer = Buffer.from(await data.arrayBuffer());
  return { size: buffer.length, contentType: data.type || '' };
}

function fail(statusCode, error, headers) {
  return { statusCode, headers, body: JSON.stringify({ error }) };
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };

  const gate = await enforceMembership(event);
  if (gate.response) {
    return { statusCode: gate.response.statusCode, headers, body: gate.response.body };
  }
  const memberstackId = gate.access.memberId;

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
        .select('id, deal_id, source_tool, title, file_data, file_url, storage_path, created_at')
        .eq('deal_id', dealId)
        .eq('memberstack_id', memberstackId)
        .order('created_at', { ascending: false });
      if (error) throw error;

      const listed = [];
      for (const doc of documents || []) {
        const copy = Object.assign({}, doc);
        if (copy.storage_path) {
          const signed = await supabase.storage.from(uploads.PRIVATE_BUCKET).createSignedUrl(copy.storage_path, 60 * 60);
          copy.download_url = signed && signed.data ? (signed.data.signedUrl || signed.data.signedURL || '') : '';
          copy.file_data = null;
          delete copy.storage_path;
        }
        listed.push(copy);
      }

      return { statusCode: 200, headers, body: JSON.stringify({ documents: listed }) };
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const action = body.action;

      if (action === 'create') {
        const { deal_id, source_tool, title, file_data, file_url, storage_path } = body;
        if (!deal_id || !source_tool || !title || (!file_data && !file_url && !storage_path)) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: 'deal_id, source_tool, title, and either file_data or file_url are required' }) };
        }
        if (!VALID_SOURCE_TOOLS.includes(source_tool)) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid source_tool' }) };
        }
        if (file_data && uploads.dataUrlBytes(file_data) > uploads.LEGACY_INLINE_MAX_BYTES) {
          return fail(400, 'This file is too large to send directly. Refresh the page and upload it again.', headers);
        }
        let storedPath = null;
        if (storage_path) {
          try {
            storedPath = uploads.assertMemberPath(memberstackId, storage_path);
            const info = await objectStat(uploads.PRIVATE_BUCKET, storedPath);
            if (!info) return fail(400, 'Upload it again. The file did not arrive.', headers);
            uploads.assertSize(info.size);
            const mime = uploads.normalizeContentType(info.contentType, storedPath);
            if (!uploads.isAllowed('document', mime)) return fail(400, 'That file type is not supported.', headers);
          } catch (err) {
            return fail(err.statusCode || 400, err.message || 'Could not save that file.', headers);
          }
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
            file_data: storedPath ? null : (file_data || null),
            file_url: storedPath ? null : (file_url || null),
            storage_path: storedPath,
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
        const { data: existing } = await supabase
          .from('deal_documents')
          .select('storage_path')
          .eq('id', id)
          .eq('memberstack_id', memberstackId)
          .maybeSingle();
        const { error } = await supabase
          .from('deal_documents')
          .delete()
          .eq('id', id)
          .eq('memberstack_id', memberstackId);
        if (error) throw error;
        if (existing && existing.storage_path) {
          await supabase.storage.from(uploads.PRIVATE_BUCKET).remove([existing.storage_path]);
        }

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
