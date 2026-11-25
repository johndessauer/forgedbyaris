// Turns an upstream lookup payload into the member-facing shape.
// Unknown keys are dropped. Any string that names the upstream vendor is
// replaced before it can reach the browser or ARIS.
const shared = require('../../../assets/js/skip-trace-shared');

const VENDOR_RE = /tracerfy/i;

function clip(value, max) {
  const text = shared.text(value);
  if (!text) return '';
  return text.slice(0, max || 160);
}

function scrubString(value) {
  const text = String(value == null ? '' : value);
  if (VENDOR_RE.test(text)) return '';
  return text;
}

function scrub(value) {
  if (typeof value === 'string') return scrubString(value);
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') {
    const out = {};
    Object.keys(value).forEach(function (key) {
      if (VENDOR_RE.test(key)) return;
      out[key] = scrub(value[key]);
    });
    return out;
  }
  return value;
}

function phone(entry, personLitigator) {
  if (!entry || typeof entry !== 'object') return null;
  const digits = String(entry.number || '').replace(/\D/g, '');
  const number = digits.length === 11 && digits.charAt(0) === '1' ? digits.slice(1) : digits;
  if (number.length < 10) return null;
  return {
    number: number.slice(-10),
    type: clip(entry.type, 40) || 'Unknown',
    dnc: entry.dnc === true,
    tcpa: entry.tcpa === true,
    litigator: entry.litigator === true || personLitigator === true,
    carrier: clip(entry.carrier, 80),
  };
}

function person(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const litigator = entry.litigator === true;
  const mail = entry.mailing_address && typeof entry.mailing_address === 'object' ? entry.mailing_address : {};
  const phones = (Array.isArray(entry.phones) ? entry.phones : []).map(function (item) {
    return phone(item, litigator);
  }).filter(Boolean);
  const emails = (Array.isArray(entry.emails) ? entry.emails : []).map(function (item) {
    const raw = typeof item === 'string' ? item : (item && item.email);
    const email = clip(raw, 180);
    return email && email.indexOf('@') !== -1 ? { email: email } : null;
  }).filter(Boolean);
  const firstName = clip(entry.first_name, 80);
  const lastName = clip(entry.last_name, 80);
  return {
    firstName: firstName,
    lastName: lastName,
    fullName: clip(entry.full_name, 160) || [firstName, lastName].filter(Boolean).join(' '),
    deceased: entry.deceased === true,
    propertyOwner: entry.property_owner === true,
    litigator: litigator,
    mailingAddress: {
      street: clip(mail.street, 160),
      city: clip(mail.city, 80),
      state: clip(mail.state, 2).toUpperCase(),
      zip: clip(mail.zip, 10),
    },
    phones: phones,
    emails: emails,
  };
}

function presentLookup(raw, parts, ownerName) {
  const body = raw && typeof raw === 'object' ? raw : {};
  const persons = (Array.isArray(body.persons) ? body.persons : []).map(person).filter(Boolean);
  const hit = body.hit === true && persons.length > 0;
  const primary = persons[0] || null;
  return scrub({
    hit: hit,
    entityNote: shared.entityNote(ownerName),
    address: {
      street: parts.street,
      city: parts.city,
      state: parts.state,
      zip: parts.zip || '',
    },
    persons: persons,
    scripts: shared.scriptsFor(primary, parts),
    complianceNote: shared.COMPLIANCE_NOTE,
  });
}

function containsVendorName(value) {
  return VENDOR_RE.test(JSON.stringify(value || {}));
}

module.exports = {
  presentLookup,
  scrub,
  containsVendorName,
};
