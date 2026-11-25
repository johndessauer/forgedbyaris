// Shared owner-contact helpers used by the browser and the Netlify functions.
// Lookup pricing, address keys, and the compliance sentence live here so the
// confirm modal and the server quote cannot drift.
//
// LEGAL REVIEW: complianceNote is placeholder copy. Replace it after counsel
// reviews the outreach language before this is treated as final policy.
(function (root) {
  var LOOKUP_CENTS = 20;
  var CACHE_DAYS = 90;
  var PACKS = [
    { id: '10', amountCents: 1000, lookups: 50, label: '$10 · 50 lookups' },
    { id: '25', amountCents: 2500, lookups: 125, label: '$25 · 125 lookups' },
    { id: '50', amountCents: 5000, lookups: 250, label: '$50 · 250 lookups' },
  ];
  // LEGAL REVIEW: placeholder. Data is not consent.
  var COMPLIANCE_NOTE = 'Data is not consent. A phone number or email is not permission to call or text. Do-not-call, TCPA, and litigator marks are warnings, not legal advice. This notice is placeholder copy pending legal review.';

  var ENTITY_RE = /\b(l\.?l\.?c\.?|inc\.?|corp\.?|corporation|trust|estate|reo|bank|holdings|l\.?l\.?p\.?|\blp\b|partners|properties|company|ltd\.?|associates|investments|realty|homes)\b/i;

  function text(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function looksLikeEntity(name) {
    var value = text(name);
    if (!value) return false;
    if (/^estate of\b/i.test(value)) return true;
    if (/(?:&\s*co\.?|\bco\.)$/i.test(value)) return true;
    return ENTITY_RE.test(value);
  }

  function entityNote(name) {
    if (!looksLikeEntity(name)) return '';
    return 'This owner looks like a company, trust, estate, or bank-owned property. Contact results may be limited.';
  }

  function money(cents) {
    var n = Math.round(Number(cents) || 0);
    var sign = n < 0 ? '-' : '';
    var abs = Math.abs(n);
    return sign + '$' + Math.floor(abs / 100) + '.' + String(abs % 100).padStart(2, '0');
  }

  function formatPhone(value) {
    var digits = String(value || '').replace(/\D/g, '');
    if (digits.length === 11 && digits.charAt(0) === '1') digits = digits.slice(1);
    if (digits.length !== 10) return text(value);
    return '(' + digits.slice(0, 3) + ') ' + digits.slice(3, 6) + '-' + digits.slice(6);
  }

  function parseAddress(input) {
    var src = input || {};
    var street = text(src.address || src.street);
    var city = text(src.city);
    var state = text(src.state).toUpperCase();
    var zip = text(src.zip || src.zipCode).replace(/\s+/g, '');
    if (street.indexOf(',') !== -1 && (!city || !/^[A-Z]{2}$/.test(state))) {
      var parts = street.split(',').map(function (part) { return part.trim(); }).filter(Boolean);
      if (parts.length >= 3) {
        var region = parts[parts.length - 1].match(/^([A-Za-z]{2})\s+(\d{5})(?:-\d{4})?$/);
        if (region) {
          street = parts.slice(0, -2).join(', ');
          if (!city) city = parts[parts.length - 2];
          if (!/^[A-Z]{2}$/.test(state)) state = region[1].toUpperCase();
          if (!zip) zip = region[2];
        }
      }
    }
    if (zip.length > 5 && /^\d{5}/.test(zip)) zip = zip.slice(0, 5);
    if (!street) return { error: 'A street address is required.' };
    if (!city) return { error: 'A city is required.' };
    if (!/^[A-Z]{2}$/.test(state)) return { error: 'A two-letter state is required.' };
    if (zip && !/^\d{5}$/.test(zip)) return { error: 'ZIP must be 5 digits.' };
    return { street: street, city: city, state: state, zip: zip };
  }

  function addressKey(parts) {
    function fold(value) {
      return text(value).toLowerCase().replace(/[^a-z0-9]/g, '');
    }
    var zip = String((parts && parts.zip) || '').replace(/\D/g, '').slice(0, 5);
    return [fold(parts && parts.street), fold(parts && parts.city), fold(parts && parts.state).slice(0, 2), zip].join('|');
  }

  function addressLabel(parts) {
    var cityLine = [parts.state, parts.zip].filter(Boolean).join(' ');
    return [parts.street, [parts.city, cityLine].filter(Boolean).join(', ')].filter(Boolean).join(', ');
  }

  function ownerNames(input) {
    var src = input || {};
    var first = text(src.ownerFirstName || src.owner_first_name || src.firstName || src.first_name);
    var last = text(src.ownerLastName || src.owner_last_name || src.lastName || src.last_name);
    var full = text(src.owner || src.ownerName || src.owner_name);
    if (full && looksLikeEntity(full)) return { first: first, last: last, full: full };
    if ((!first || !last) && full && !/\band\b|&/i.test(full)) {
      var bits = full.split(' ').filter(Boolean);
      if (bits.length >= 2 && bits.length <= 4) {
        if (!first) first = bits[0];
        if (!last) last = bits[bits.length - 1];
      }
    }
    return { first: first, last: last, full: full || [first, last].filter(Boolean).join(' ') };
  }

  function scriptsFor(person, parts) {
    var who = (person && (person.firstName || person.fullName)) || 'there';
    var place = (parts && parts.street) || 'the property';
    return {
      call: 'Hi ' + who + ', this is [your name]. I am a local investor calling about ' + place + '. If selling is something you have thought about, I would like to make a fair offer. Is now a bad time?',
      text: 'Hi ' + who + ', this is [your name], a local real estate investor. I noticed ' + place + ' and wanted to see if you would consider an offer. No pressure. Reply STOP if you would rather not hear from me.',
    };
  }

  function packById(id) {
    for (var i = 0; i < PACKS.length; i++) {
      if (PACKS[i].id === String(id)) return PACKS[i];
    }
    return null;
  }

  function packByAmount(cents) {
    var amount = Math.floor(Number(cents) || 0);
    for (var i = 0; i < PACKS.length; i++) {
      if (PACKS[i].amountCents === amount) return PACKS[i];
    }
    return null;
  }

  var api = {
    LOOKUP_CENTS: LOOKUP_CENTS,
    CACHE_DAYS: CACHE_DAYS,
    PACKS: PACKS,
    COMPLIANCE_NOTE: COMPLIANCE_NOTE,
    text: text,
    looksLikeEntity: looksLikeEntity,
    entityNote: entityNote,
    money: money,
    formatPhone: formatPhone,
    parseAddress: parseAddress,
    addressKey: addressKey,
    addressLabel: addressLabel,
    ownerNames: ownerNames,
    scriptsFor: scriptsFor,
    packById: packById,
    packByAmount: packByAmount,
  };
  root.ForgeSkipTraceShared = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
