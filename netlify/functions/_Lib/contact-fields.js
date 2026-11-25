// Extra CRM contact columns written by owner-contact lookup.
// sql/migrations/add-skip-trace.sql adds these columns. Existing
// name/phone/email behavior is unchanged when the extras are omitted.

const OUTREACH = ['new', 'called', 'texted', 'emailed', 'do_not_contact'];

function text(value, max) {
  const cleaned = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  return cleaned.slice(0, max || 240);
}

function bool(value) {
  return value === true;
}

function normalizePhone(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const digits = String(entry.number || '').replace(/\D/g, '');
  const number = digits.length === 11 && digits.charAt(0) === '1' ? digits.slice(1) : digits;
  if (number.length !== 10) return null;
  return {
    number: number,
    type: text(entry.type, 40) || 'Unknown',
    dnc: bool(entry.dnc),
    tcpa: bool(entry.tcpa),
    litigator: bool(entry.litigator),
    carrier: text(entry.carrier, 80) || '',
  };
}

function normalizeEmail(entry) {
  const raw = typeof entry === 'string' ? entry : (entry && entry.email);
  const email = text(raw, 180);
  if (!email || email.indexOf('@') === -1) return null;
  return email.toLowerCase();
}

function normalizeExtras(input) {
  const src = input || {};
  const fields = {};
  if (Object.prototype.hasOwnProperty.call(src, 'address')) {
    fields.address = text(src.address, 240);
  }
  if (Object.prototype.hasOwnProperty.call(src, 'phones')) {
    if (!Array.isArray(src.phones)) return { error: 'phones must be a list' };
    fields.phones = src.phones.map(normalizePhone).filter(Boolean).slice(0, 12);
  }
  if (Object.prototype.hasOwnProperty.call(src, 'emails')) {
    if (!Array.isArray(src.emails)) return { error: 'emails must be a list' };
    fields.emails = src.emails.map(normalizeEmail).filter(Boolean).slice(0, 12);
  }
  if (Object.prototype.hasOwnProperty.call(src, 'flags')) {
    const flags = src.flags;
    if (!flags || typeof flags !== 'object' || Array.isArray(flags)) return { error: 'flags must be an object' };
    fields.flags = {
      litigator: bool(flags.litigator),
      deceased: bool(flags.deceased),
      dnc: bool(flags.dnc),
      tcpa: bool(flags.tcpa),
      entityLimited: bool(flags.entityLimited),
    };
  }
  if (Object.prototype.hasOwnProperty.call(src, 'outreach_status')) {
    const status = src.outreach_status == null ? '' : String(src.outreach_status).trim();
    if (!status) fields.outreach_status = null;
    else if (OUTREACH.indexOf(status) === -1) return { error: 'outreach_status is not a known value' };
    else fields.outreach_status = status;
  }
  return { fields: fields };
}

module.exports = {
  OUTREACH,
  normalizeExtras,
  normalizePhone,
  normalizeEmail,
};
