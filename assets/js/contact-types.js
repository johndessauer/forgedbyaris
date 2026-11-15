// Shared CRM contact types.
// Loaded by crm.html and aris-coach.html, and required by
// netlify/functions/crm-contacts.js. One list so the filter chips, the
// form, CSV import, and the server accept the same values.
//
// type_label is only stored for type "other" (the custom badge text,
// for example "Architect"). The original seller / buyer / lender /
// contractor rows leave it empty.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ForgeContactTypes = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const LABEL_MAX = 60;

  const CONTACT_TYPES = Object.freeze([
    { value: 'seller', label: 'Seller', chip: 'Sellers' },
    { value: 'buyer', label: 'Buyer', chip: 'Buyers' },
    { value: 'lender', label: 'Lender', chip: 'Lenders' },
    { value: 'contractor', label: 'Contractor', chip: 'Contractors' },
    { value: 'attorney', label: 'Attorney', chip: 'Attorneys' },
    { value: 'accountant', label: 'Accountant/CPA', chip: 'Accountants/CPAs' },
    { value: 'title_escrow', label: 'Title/Escrow', chip: 'Title/Escrow' },
    { value: 'inspector', label: 'Inspector', chip: 'Inspectors' },
    { value: 'appraiser', label: 'Appraiser', chip: 'Appraisers' },
    { value: 'surveyor', label: 'Surveyor', chip: 'Surveyors' },
    { value: 'engineer', label: 'Engineer', chip: 'Engineers' },
    { value: 'property_manager', label: 'Property Manager', chip: 'Property Managers' },
    { value: 'insurance_agent', label: 'Insurance Agent', chip: 'Insurance Agents' },
    { value: 'agent_broker', label: 'Agent/Broker', chip: 'Agents/Brokers' },
    { value: 'wholesaler', label: 'Wholesaler', chip: 'Wholesalers' },
    { value: 'other', label: 'Other', chip: 'Other' },
  ].map((row) => Object.freeze(row)));

  const VALID_TYPES = Object.freeze(CONTACT_TYPES.map((row) => row.value));

  function canon(value) {
    return String(value || '').trim().toLowerCase().replace(/[_/]+/g, ' ').replace(/\s+/g, ' ');
  }

  const IMPORT_ALIASES = Object.create(null);
  CONTACT_TYPES.forEach((row) => {
    IMPORT_ALIASES[canon(row.value)] = row.value;
    IMPORT_ALIASES[canon(row.label)] = row.value;
    IMPORT_ALIASES[canon(row.chip)] = row.value;
  });
  // The chip and the label don't share a key for this one ("cpa" vs
  // "accountant cpa"), and spreadsheets often say just CPA.
  IMPORT_ALIASES.cpa = 'accountant';

  function cleanTypeLabel(value) {
    const raw = String(value == null ? '' : value);
    if (/[\r\n\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(raw)) {
      return { ok: false, error: 'Custom label cannot include line breaks' };
    }
    const label = raw.trim().replace(/\s+/g, ' ');
    if (!label) return { ok: false, error: 'A custom label is required when type is other' };
    if (label.length > LABEL_MAX) {
      return { ok: false, error: 'Custom label must be ' + LABEL_MAX + ' characters or fewer' };
    }
    return { ok: true, value: label };
  }

  // Server create/update. Unknown types are rejected. A custom label is
  // kept only for other; any label sent with a fixed type is dropped so
  // older clients that omit type_label still save seller/buyer/lender/contractor.
  function resolveContactType(type, typeLabel) {
    if (!VALID_TYPES.includes(type)) {
      return { error: 'Invalid type. Must be one of: ' + VALID_TYPES.join(', ') };
    }
    if (type === 'other') {
      const cleaned = cleanTypeLabel(typeLabel);
      if (!cleaned.ok) return { error: cleaned.error };
      return { type: 'other', type_label: cleaned.value };
    }
    return { type: type, type_label: null };
  }

  // CSV import. An empty or unrecognized type still becomes buyer, which
  // is what the Contacts tab did before these types existed. "other"
  // without a label is not rewritten to buyer — the review row stays
  // unchecked until a type_label is present.
  function normalizeImportedType(rawType, rawLabel) {
    const key = canon(rawType);
    if (!key) return { type: 'buyer', type_label: null, invalidLabel: false };
    const alias = IMPORT_ALIASES[key];
    if (!alias) return { type: 'buyer', type_label: null, invalidLabel: false };
    if (alias === 'other') {
      const cleaned = cleanTypeLabel(rawLabel);
      if (!cleaned.ok) return { type: 'other', type_label: null, invalidLabel: true };
      return { type: 'other', type_label: cleaned.value, invalidLabel: false };
    }
    return { type: alias, type_label: null, invalidLabel: false };
  }

  function badgeLabel(contact) {
    if (!contact) return '';
    if (contact.type === 'other') {
      const cleaned = cleanTypeLabel(contact.type_label);
      return cleaned.ok ? cleaned.value : 'Other';
    }
    const match = CONTACT_TYPES.find((row) => row.value === contact.type);
    return match ? match.label : (contact.type || '');
  }

  return {
    LABEL_MAX: LABEL_MAX,
    CONTACT_TYPES: CONTACT_TYPES,
    VALID_TYPES: VALID_TYPES,
    cleanTypeLabel: cleanTypeLabel,
    resolveContactType: resolveContactType,
    normalizeImportedType: normalizeImportedType,
    badgeLabel: badgeLabel,
  };
});
