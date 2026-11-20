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

  root.ForgeMarketingEntry = {
    LEADS_KEY: LEADS_KEY,
    readLeads: readLeads,
    writeLeads: writeLeads,
    fetchAccess: fetchAccess,
    mount: mount,
  };
})(typeof window !== 'undefined' ? window : globalThis);
