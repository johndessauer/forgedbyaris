// Shows the Marketing tab, the home-card link, and the Property Search
// buttons only after /api/marketing-access says this member is allowed.
(function (root) {
  var LEADS_KEY = 'forge-marketing-leads';

  function readLeads() {
    try {
      var raw = root.sessionStorage.getItem(LEADS_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || !Array.isArray(parsed.leads)) return null;
      return parsed;
    } catch (err) {
      return null;
    }
  }

  function writeLeads(payload) {
    root.sessionStorage.setItem(LEADS_KEY, JSON.stringify(payload));
  }

  function text() {
    for (var i = 0; i < arguments.length; i++) {
      if (arguments[i] == null) continue;
      var value = String(arguments[i]).trim();
      if (value) return value;
    }
    return '';
  }

  function splitFormatted(address) {
    var parts = String(address || '').split(',').map(function (part) { return part.trim(); }).filter(Boolean);
    if (parts.length < 3) return null;
    var region = parts[parts.length - 1].match(/^([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
    if (!region) return null;
    return {
      address: parts.slice(0, -2).join(', '),
      city: parts[parts.length - 2],
      state: region[1].toUpperCase(),
      zip: region[2],
    };
  }

  function completeAddress(street, city, state, zip) {
    return !!(text(street) && text(city) && /^[A-Za-z]{2}$/.test(text(state)) && /^\d{5}(-\d{4})?$/.test(text(zip)));
  }

  function isAbsentee(record) {
    var ids = (record && record.playIds) || [];
    if (ids.indexOf('absentee') !== -1 || ids.indexOf('bored') !== -1) return true;
    var details = record && record.details || {};
    return details.absenteeMail === true;
  }

  // Marketing mails an absentee owner at the county mailing address when
  // that address is complete. Everyone else, and an absentee owner with no
  // mailing address, is mailed at the property.
  function leadForMarketing(record) {
    var row = record || {};
    var details = row.details || {};
    var property = {
      address: text(row.address, details.address),
      city: text(details.city, row.city),
      state: text(details.state, row.state).toUpperCase(),
      zip: text(details.zip, row.zip, details.zipCode),
    };
    if (!completeAddress(property.address, property.city, property.state, property.zip)) {
      var parsed = splitFormatted(property.address);
      if (parsed) property = parsed;
    }
    var mailing = {
      address: text(details.ownerAddress, row.ownerAddress),
      city: text(details.ownerCity, row.ownerCity),
      state: text(details.ownerState, row.ownerState).toUpperCase(),
      zip: text(details.ownerZip, row.ownerZip, details.ownerZipFive),
    };
    var useMailing = isAbsentee(row) && completeAddress(mailing.address, mailing.city, mailing.state, mailing.zip);
    var chosen = useMailing ? mailing : property;
    return {
      id: row.id,
      address: chosen.address,
      city: chosen.city,
      state: chosen.state,
      zip: chosen.zip,
      owner: text(row.owner, details.owner),
      propertyType: details.propertyType || '',
      units: details.units || details.unitCount || null,
      playIds: row.playIds || [],
      equity: row.equity,
      mailSource: useMailing ? 'owner' : 'property',
    };
  }

  async function fetchAccess(token) {
    var response = await fetch('/api/marketing-access', {
      headers: token ? { Authorization: 'Bearer ' + token } : {},
    });
    if (!response.ok) return { allowed: false };
    return response.json();
  }

  function ensureNav(access) {
    if (!access || access.allowed !== true) return;
    var section = document.querySelector('.sidebar-section');
    if (!section || section.querySelector('[data-mkt-nav]')) return;
    var link = document.createElement('a');
    var onMarketing = /marketing\.html$/.test(location.pathname);
    link.className = 'nav-item' + (onMarketing ? ' active' : '');
    link.href = 'marketing.html';
    link.setAttribute('data-mkt-nav', '1');
    link.innerHTML = '<span class="nav-icon">📣</span>Marketing';
    section.appendChild(link);
  }

  function upgradeHomeCard(access) {
    if (!access || access.allowed !== true) return;
    var card = document.getElementById('module-marketing');
    if (!card || !card.classList.contains('coming')) return;
    var link = document.createElement('a');
    link.className = 'module-card live';
    link.href = 'marketing.html';
    link.id = 'module-marketing';
    link.innerHTML = card.innerHTML
      .replace('module-status soon', 'module-status live')
      .replace('Coming soon!', '● Live');
    card.replaceWith(link);
  }

  async function mount(opts) {
    var options = opts || {};
    var access = { allowed: false };
    try { access = await fetchAccess(options.token); }
    catch (err) { access = { allowed: false }; }
    ensureNav(access);
    upgradeHomeCard(access);
    if (access.allowed && typeof options.onAllowed === 'function') options.onAllowed(access);
    return access;
  }

  var api = {
    LEADS_KEY: LEADS_KEY,
    readLeads: readLeads,
    writeLeads: writeLeads,
    leadForMarketing: leadForMarketing,
    fetchAccess: fetchAccess,
    mount: mount,
  };
  root.ForgeMarketingEntry = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
