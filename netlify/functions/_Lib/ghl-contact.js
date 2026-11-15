// GoHighLevel contact writes that must not replace a contact's tag list.
//
// POST /contacts/upsert with a tags array replaces every tag on the contact.
// A later purchase was wiping rs-5050, fortiva-7525, and earlier plan tags.
// Callers upsert the contact with no tags field, then add only the new tags
// with POST /contacts/{id}/tags. Removing a tag is a separate
// DELETE /contacts/{id}/tags call (dunning and comp alerts already do that)
// and is never implied by leaving a tag off the upsert body.

function contactIdFrom(data) {
  let parsed = data;
  if (typeof data === 'string') {
    try { parsed = data ? JSON.parse(data) : {}; } catch (e) { return ''; }
  }
  if (!parsed || typeof parsed !== 'object') return '';
  const id = (parsed.contact && parsed.contact.id) || parsed.id || '';
  return id ? String(id) : '';
}

function responseOk(res) {
  return !!(res && !res.error && !res.skipped && res.statusCode >= 200 && res.statusCode < 300);
}

// request({ method, path, payload }) resolves { statusCode, data } or { error } or { skipped }.
async function upsertThenAddTags(request, payload, tags) {
  const body = Object.assign({}, payload || {});
  delete body.tags;
  let upsert;
  try {
    upsert = await request({ method: 'POST', path: '/contacts/upsert', payload: body });
  } catch (err) {
    return { ok: false, contactId: '', upsert: { error: err && err.message }, tags: null };
  }
  if (!responseOk(upsert)) return { ok: false, contactId: '', upsert: upsert, tags: null };

  const list = (Array.isArray(tags) ? tags : []).filter(Boolean);
  const contactId = contactIdFrom(upsert.data);
  if (!list.length) return { ok: true, contactId: contactId, upsert: upsert, tags: null };
  if (!contactId) return { ok: false, contactId: '', upsert: upsert, tags: { error: 'no contact id' } };

  let tagged;
  try {
    tagged = await request({
      method: 'POST',
      path: '/contacts/' + encodeURIComponent(contactId) + '/tags',
      payload: { tags: list },
    });
  } catch (err) {
    return { ok: false, contactId: contactId, upsert: upsert, tags: { error: err && err.message } };
  }
  return { ok: responseOk(tagged), contactId: contactId, upsert: upsert, tags: tagged };
}

function payingMemberTags({ planName, extraTags, salesRep, planTagOverrides }) {
  const tags = ['member', 'paying-member'];
  if (planName) {
    tags.push(planName);
    const friendly = planTagOverrides && planTagOverrides[planName];
    if (friendly) tags.push(friendly);
  }
  (extraTags || []).forEach((tag) => {
    if (tag && !tags.includes(tag)) tags.push(tag);
  });
  if (salesRep) {
    const tag = 'rep-' + salesRep;
    if (!tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

function payingMemberBody({
  email, firstName, lastName, locationId, referralSource, salesRep, referralFieldId, salesRepFieldId,
}) {
  const customFields = [];
  if (referralSource && referralFieldId) {
    customFields.push({ id: referralFieldId, field_value: referralSource });
  }
  if (salesRep && salesRepFieldId) {
    customFields.push({ id: salesRepFieldId, field_value: salesRep });
  }
  const body = {
    email: email,
    firstName: firstName || undefined,
    lastName: lastName || undefined,
    locationId: locationId,
  };
  if (customFields.length) body.customFields = customFields;
  return body;
}

function syncPayingMember(input, request) {
  const tags = payingMemberTags(input || {});
  const payload = payingMemberBody(input || {});
  return upsertThenAddTags(request, payload, tags);
}

module.exports = {
  contactIdFrom,
  responseOk,
  upsertThenAddTags,
  payingMemberTags,
  payingMemberBody,
  syncPayingMember,
};
