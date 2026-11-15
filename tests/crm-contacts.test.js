// CRM contact types: the Contacts tab, crm-contacts, and the Supabase
// check all accept the same roles. Other stores a custom label. The
// original seller/buyer/lender/contractor rows stay valid with no label.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const types = require('../assets/js/contact-types');
const ROOT = path.join(__dirname, '..');

const EXPECTED = [
  'seller', 'buyer', 'lender', 'contractor',
  'attorney', 'accountant', 'title_escrow', 'inspector',
  'appraiser', 'surveyor', 'engineer', 'property_manager',
  'insurance_agent', 'agent_broker', 'wholesaler', 'other',
];

test('contact types match the Contacts tab list, including the original four', () => {
  assert.deepEqual(types.VALID_TYPES, EXPECTED);
  assert.deepEqual(types.CONTACT_TYPES.map((row) => row.value), EXPECTED);
  assert.equal(types.CONTACT_TYPES.find((row) => row.value === 'accountant').label, 'Accountant/CPA');
  assert.equal(types.CONTACT_TYPES.find((row) => row.value === 'title_escrow').label, 'Title/Escrow');
  assert.equal(types.CONTACT_TYPES.find((row) => row.value === 'agent_broker').label, 'Agent/Broker');
  assert.equal(types.CONTACT_TYPES.find((row) => row.value === 'other').chip, 'Other');
  for (const value of ['seller', 'buyer', 'lender', 'contractor']) {
    const resolved = types.resolveContactType(value, 'ignored');
    assert.equal(resolved.type, value);
    assert.equal(resolved.type_label, null);
    assert.equal(types.badgeLabel({ type: value }), types.CONTACT_TYPES.find((row) => row.value === value).label);
  }
});

test('other requires a custom label and fixed types do not keep one', () => {
  const architect = types.resolveContactType('other', '  Architect  ');
  assert.deepEqual(architect, { type: 'other', type_label: 'Architect' });
  assert.equal(types.badgeLabel({ type: 'other', type_label: 'Architect' }), 'Architect');
  assert.equal(types.badgeLabel({ type: 'other', type_label: '   ' }), 'Other');
  assert.equal(types.badgeLabel({ type: 'contractor' }), 'Contractor');

  assert.match(types.resolveContactType('other', '').error, /custom label is required/i);
  assert.match(types.resolveContactType('other', '   ').error, /custom label is required/i);
  assert.match(types.resolveContactType('other', 'A'.repeat(61)).error, /60 characters/);
  assert.equal(types.resolveContactType('other', 'A'.repeat(60)).type_label, 'A'.repeat(60));
  assert.match(types.resolveContactType('other', 'Line\nbreak').error, /line breaks/);
  assert.match(types.resolveContactType('neighbor', 'Architect').error, /Invalid type/);
});

test('CSV import keeps the buyer fallback and accepts the new type names', () => {
  assert.deepEqual(types.normalizeImportedType('', ''), { type: 'buyer', type_label: null, invalidLabel: false });
  assert.deepEqual(types.normalizeImportedType('architect', ''), { type: 'buyer', type_label: null, invalidLabel: false });
  assert.equal(types.normalizeImportedType('Attorney', '').type, 'attorney');
  assert.equal(types.normalizeImportedType('Accountant/CPA', '').type, 'accountant');
  assert.equal(types.normalizeImportedType('CPA', '').type, 'accountant');
  assert.equal(types.normalizeImportedType('Title/Escrow', '').type, 'title_escrow');
  assert.equal(types.normalizeImportedType('property manager', '').type, 'property_manager');
  assert.equal(types.normalizeImportedType('Agents/Brokers', '').type, 'agent_broker');
  assert.equal(types.normalizeImportedType('SELLER', '').type, 'seller');
  const custom = types.normalizeImportedType('other', ' Architect ');
  assert.deepEqual(custom, { type: 'other', type_label: 'Architect', invalidLabel: false });
  const missing = types.normalizeImportedType('other', '');
  assert.equal(missing.type, 'other');
  assert.equal(missing.invalidLabel, true);
  assert.equal(missing.type_label, null);
});

test('schema and the unapplied migration allow the same types and do not rewrite rows', () => {
  const schema = fs.readFileSync(path.join(ROOT, 'schema.sql'), 'utf8');
  const migration = fs.readFileSync(path.join(ROOT, 'sql/migrations/add-crm-contact-types.sql'), 'utf8');
  assert.deepEqual(typeList(schema), EXPECTED);
  assert.deepEqual(typeList(migration), EXPECTED);
  for (const sql of [schema, migration]) {
    assert.match(sql, /type_label is null/);
    assert.match(sql, /type <> 'other'/);
    assert.match(sql, /between 1 and 60/);
    assert.match(sql, /contacts_type_label_check/);
  }
  assert.match(migration, /add column if not exists type_label/i);
  assert.match(migration, /drop constraint if exists contacts_type_check/i);
  assert.match(migration, /begin;/i);
  assert.match(migration, /commit;/i);
  assert.equal(/delete\s+from/i.test(migration), false);
  assert.equal(/truncate\s+/i.test(migration), false);
  assert.equal(/drop\s+table/i.test(migration), false);
  assert.equal(/update\s+contacts/i.test(migration), false);
});

test('Contacts tab chips, form, empty state, and import use the shared types', () => {
  const html = fs.readFileSync(path.join(ROOT, 'crm.html'), 'utf8');
  assert.match(html, /\/assets\/js\/contact-types\.js/);
  assert.match(html, /Add sellers, buyers, lenders, contractors, and the rest of your deal team\./);
  assert.match(html, /id="contact-type-label"/);
  assert.match(html, /placeholder="e\.g\. Architect"/);
  assert.match(html, /maxlength="60"/);
  assert.match(html, /syncContactTypeLabelField/);
  assert.match(html, /ForgeContactTypes\.badgeLabel/);
  assert.match(html, /normalizeImportedType/);
  assert.match(html, /type_label/);
  assert.match(html, /\.filter-chips \{[^}]*flex-wrap:\s*wrap;/);
  assert.match(html, /@media \(max-width: 768px\) \{[\s\S]*?\.filter-chips \{[^}]*flex:\s*none;[^}]*flex-wrap:\s*nowrap;[^}]*overflow-x:\s*auto/);
  assert.equal(html.includes('Add sellers, buyers, lenders, or contractors'), false);

  const chips = [...html.matchAll(/<button class="filter-chip(?: active)?" data-type="([^"]*)"[^>]*>([^<]*)<\/button>/g)];
  assert.deepEqual(chips.map((match) => match[1]), ['', ...EXPECTED]);
  assert.deepEqual(chips.slice(1).map((match) => match[2]), types.CONTACT_TYPES.map((row) => row.chip));

  const select = html.slice(html.indexOf('id="contact-type"'), html.indexOf('id="contact-type-label"'));
  const contactOptions = [...select.matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g)];
  assert.deepEqual(contactOptions.map((match) => match[1]), EXPECTED);
  assert.deepEqual(contactOptions.map((match) => match[2]), types.CONTACT_TYPES.map((row) => row.label));

  const coach = fs.readFileSync(path.join(ROOT, 'aris-coach.html'), 'utf8');
  assert.match(coach, /\/assets\/js\/contact-types\.js/);
  assert.match(coach, /enum: ForgeContactTypes\.VALID_TYPES/);
  const fn = fs.readFileSync(path.join(ROOT, 'netlify/functions/crm-contacts.js'), 'utf8');
  assert.match(fn, /require\('\.\.\/\.\.\/assets\/js\/contact-types'\)/);
  assert.equal(fn.includes("['seller', 'buyer', 'lender', 'contractor']"), false);
});

test('crm-contacts accepts every type, stores Other labels, and still serves old rows', async () => {
  const state = {
    seq: 0,
    contacts: [
      { id: 'old-seller', memberstack_id: 'mem_1', name: 'Pat Seller', type: 'seller', phone: '555', email: 'pat@example.com', created_at: '2026-01-01T00:00:00.000Z' },
      { id: 'old-contractor', memberstack_id: 'mem_1', name: 'Casey Contractor', type: 'contractor', phone: null, email: null, created_at: '2026-01-02T00:00:00.000Z' },
      { id: 'other-member', memberstack_id: 'mem_2', name: 'Not Mine', type: 'buyer', phone: null, email: null, created_at: '2026-01-03T00:00:00.000Z' },
    ],
    notes: [
      { contact_id: 'old-seller', created_at: '2026-02-02T00:00:00.000Z', contact_method: 'call' },
      { contact_id: 'old-seller', created_at: '2026-03-03T00:00:00.000Z', contact_method: 'text' },
    ],
  };
  const handler = loadHandler(state);

  const denied = await handler({ httpMethod: 'GET', queryStringParameters: {} });
  assert.equal(denied.statusCode, 401);

  const allowed = loadHandler(state, { access: { memberId: 'mem_1' } });

  const listed = await allowed({ httpMethod: 'GET', queryStringParameters: { action: 'list' } });
  assert.equal(listed.statusCode, 200);
  const listedBody = JSON.parse(listed.body);
  assert.deepEqual(listedBody.contacts.map((row) => row.id).sort(), ['old-contractor', 'old-seller']);
  const seller = listedBody.contacts.find((row) => row.id === 'old-seller');
  assert.equal(seller.type, 'seller');
  assert.equal(seller.last_contact_method, 'text');
  assert.equal(seller.last_contact_at, '2026-03-03T00:00:00.000Z');

  const filtered = await allowed({ httpMethod: 'GET', queryStringParameters: { type: 'contractor' } });
  assert.equal(filtered.statusCode, 200);
  assert.deepEqual(JSON.parse(filtered.body).contacts.map((row) => row.name), ['Casey Contractor']);

  const badFilter = await allowed({ httpMethod: 'GET', queryStringParameters: { type: 'architect' } });
  assert.equal(badFilter.statusCode, 400);
  assert.match(JSON.parse(badFilter.body).error, /attorney/);
  assert.match(JSON.parse(badFilter.body).error, /other/);

  for (const type of EXPECTED) {
    const payload = { action: 'create', name: 'New ' + type, type, phone: '', email: '' };
    if (type === 'other') payload.type_label = ' Architect ';
    const res = await allowed({ httpMethod: 'POST', body: JSON.stringify(payload) });
    assert.equal(res.statusCode, 201, type);
    const saved = JSON.parse(res.body).contact;
    assert.equal(saved.type, type);
    assert.equal(saved.memberstack_id, 'mem_1');
    assert.equal(saved.type_label, type === 'other' ? 'Architect' : null);
    assert.equal(saved.phone, null);
  }

  const before = state.contacts.length;
  const noLabel = await allowed({
    httpMethod: 'POST',
    body: JSON.stringify({ action: 'create', name: 'No Label', type: 'other' }),
  });
  assert.equal(noLabel.statusCode, 400);
  assert.match(JSON.parse(noLabel.body).error, /custom label is required/i);
  assert.equal(state.contacts.length, before);

  const tooLong = await allowed({
    httpMethod: 'POST',
    body: JSON.stringify({ action: 'create', name: 'Long', type: 'other', type_label: 'A'.repeat(61) }),
  });
  assert.equal(tooLong.statusCode, 400);

  const legacy = await allowed({
    httpMethod: 'POST',
    body: JSON.stringify({ action: 'create', name: 'Legacy', type: 'lender', type_label: 'should not stick' }),
  });
  assert.equal(legacy.statusCode, 201);
  assert.equal(JSON.parse(legacy.body).contact.type_label, null);

  const missingName = await allowed({
    httpMethod: 'POST',
    body: JSON.stringify({ action: 'create', type: 'buyer' }),
  });
  assert.equal(missingName.statusCode, 400);

  const moved = await allowed({
    httpMethod: 'POST',
    body: JSON.stringify({ action: 'update', id: 'old-seller', type: 'attorney' }),
  });
  assert.equal(moved.statusCode, 200);
  assert.equal(JSON.parse(moved.body).contact.type, 'attorney');
  assert.equal(JSON.parse(moved.body).contact.type_label, null);
  assert.equal(state.contacts.find((row) => row.id === 'old-seller').name, 'Pat Seller');

  const custom = await allowed({
    httpMethod: 'POST',
    body: JSON.stringify({ action: 'update', id: 'old-contractor', type: 'other', type_label: 'Architect' }),
  });
  assert.equal(custom.statusCode, 200);
  assert.equal(JSON.parse(custom.body).contact.type_label, 'Architect');

  const renamed = await allowed({
    httpMethod: 'POST',
    body: JSON.stringify({ action: 'update', id: 'old-contractor', type_label: '  Survey buddy ' }),
  });
  assert.equal(renamed.statusCode, 200);
  assert.equal(JSON.parse(renamed.body).contact.type, 'other');
  assert.equal(JSON.parse(renamed.body).contact.type_label, 'Survey buddy');

  const back = await allowed({
    httpMethod: 'POST',
    body: JSON.stringify({ action: 'update', id: 'old-contractor', type: 'contractor' }),
  });
  assert.equal(back.statusCode, 200);
  assert.equal(JSON.parse(back.body).contact.type, 'contractor');
  assert.equal(JSON.parse(back.body).contact.type_label, null);

  const needsLabel = await allowed({
    httpMethod: 'POST',
    body: JSON.stringify({ action: 'update', id: 'old-seller', type: 'other' }),
  });
  assert.equal(needsLabel.statusCode, 400);
  assert.equal(state.contacts.find((row) => row.id === 'old-seller').type, 'attorney');

  const stolen = await allowed({
    httpMethod: 'POST',
    body: JSON.stringify({ action: 'update', id: 'other-member', name: 'Hijack' }),
  });
  assert.equal(stolen.statusCode, 404);
  assert.equal(state.contacts.find((row) => row.id === 'other-member').name, 'Not Mine');

  const unknown = await allowed({ httpMethod: 'POST', body: JSON.stringify({ action: 'nope' }) });
  assert.equal(unknown.statusCode, 400);
  const options = await allowed({ httpMethod: 'OPTIONS' });
  assert.equal(options.statusCode, 200);
});

function typeList(sql) {
  const match = sql.match(/constraint contacts_type_check[\s\S]*?check \(type in \(\s*([\s\S]*?)\)\s*\)/);
  assert.ok(match, 'contacts_type_check list');
  return [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]);
}

function loadHandler(state, gate) {
  const memPath = require.resolve('../netlify/functions/_Lib/membership');
  const sbPath = require.resolve('../netlify/functions/_Lib/supabase-client');
  const stubs = {
    [memPath]: {
      enforceMembership: async () => gate || ({ response: { statusCode: 401, body: JSON.stringify({ error: 'Authentication failed' }) } }),
    },
    [sbPath]: { supabase: fakeSupabase(state) },
  };
  const orig = Module._load;
  Module._load = function (request, parent, isMain) {
    const resolved = Module._resolveFilename(request, parent, isMain);
    if (stubs[resolved]) return stubs[resolved];
    return orig.apply(this, arguments);
  };
  try {
    const resolved = require.resolve('../netlify/functions/crm-contacts');
    delete require.cache[resolved];
    return require('../netlify/functions/crm-contacts').handler;
  } finally {
    Module._load = orig;
  }
}

function fakeSupabase(state) {
  return {
    from(table) {
      const ctx = { filters: [], op: 'select' };
      const builder = {
        select() { return builder; },
        eq(col, val) { ctx.filters.push([col, val]); return builder; },
        in(col, vals) { ctx.filters.push([col, vals]); return builder; },
        order(col, opts) { ctx.order = { col, ascending: !!(opts && opts.ascending) }; return builder; },
        insert(row) { ctx.op = 'insert'; ctx.payload = row; return builder; },
        update(row) { ctx.op = 'update'; ctx.payload = row; return builder; },
        maybeSingle() { return Promise.resolve(builder._one()); },
        single() { return Promise.resolve(builder._one()); },
        then(resolve, reject) {
          try { resolve(builder._many()); }
          catch (err) { reject(err); }
        },
        _rows() {
          let rows = (table === 'contacts' ? state.contacts : state.notes).filter(() => true);
          for (const [col, val] of ctx.filters) {
            if (Array.isArray(val)) rows = rows.filter((row) => val.includes(row[col]));
            else rows = rows.filter((row) => row[col] === val);
          }
          if (ctx.order) {
            const col = ctx.order.col;
            const dir = ctx.order.ascending ? 1 : -1;
            rows.sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * dir);
          }
          return rows;
        },
        _many() {
          return { data: builder._rows().map((row) => ({ ...row })), error: null };
        },
        _one() {
          if (ctx.op === 'insert') {
            const row = {
              id: 'new-' + (++state.seq),
              created_at: '2026-04-01T00:00:00.000Z',
              ...ctx.payload,
            };
            state.contacts.push(row);
            return { data: { ...row }, error: null };
          }
          if (ctx.op === 'update') {
            const rows = builder._rows();
            if (!rows.length) return { data: null, error: null };
            Object.assign(rows[0], ctx.payload);
            return { data: { ...rows[0] }, error: null };
          }
          const rows = builder._rows();
          if (!rows.length) return { data: null, error: null };
          return { data: { ...rows[0] }, error: null };
        },
      };
      return builder;
    },
  };
}
