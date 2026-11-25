// Property Command Center. One drawer for a search result or a saved lead:
// property facts, comps, market, owner contact, marketing, analyzer, CRM.
(function (root) {
  'use strict';

  var ctx = {
    getToken: function () { return ''; },
    empire: function () { return false; },
    canMarket: function () { return false; },
    onUpgrade: function () {},
    labelPlay: function (id) { return id; },
  };
  var current = null;
  var host = null;

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function ensure() {
    if (host) return host;
    var style = document.createElement('style');
    style.id = 'forge-command-css';
    style.textContent = [
      '.pcc{position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:1050;display:flex;justify-content:flex-end;}',
      '.pcc[hidden]{display:none;}',
      '.pcc-panel{width:min(480px,100%);height:100%;background:#0f2035;color:#fff;border-left:1px solid rgba(200,155,60,0.3);overflow:auto;padding:18px 16px 28px;font-family:Inter,sans-serif;}',
      '.pcc-top{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;}',
      '.pcc-kicker{font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#C89B3C;font-weight:700;}',
      '.pcc-title{font-family:"Bebas Neue",sans-serif;font-size:28px;letter-spacing:0.5px;line-height:1;margin:4px 0;}',
      '.pcc-sub{color:#9CA3AF;font-size:13px;margin:0 0 12px;}',
      '.pcc-close{background:transparent;border:1px solid rgba(255,255,255,0.16);color:#fff;border-radius:6px;padding:6px 10px;cursor:pointer;}',
      '.pcc-section{margin-top:16px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.06);}',
      '.pcc-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;}',
      '@media(max-width:520px){.pcc-grid{grid-template-columns:1fr;}}',
      '.pcc-fact{background:#13283f;border-radius:8px;padding:8px 10px;font-size:12px;color:#D1D5DB;}',
      '.pcc-fact strong{display:block;color:#fff;font-size:13px;margin-top:2px;}',
      '.pcc-tags{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0;}',
      '.pcc-tag{font-size:10px;letter-spacing:0.4px;text-transform:uppercase;border-radius:99px;padding:3px 8px;background:rgba(200,155,60,0.15);color:#F8D48A;}',
      '.pcc-actions{display:flex;flex-direction:column;gap:8px;}',
      '.pcc-actions .st-btn,.pcc-actions .ps-lead-action-btn,.pcc-actions button,.pcc-actions a.pcc-link{width:100%;text-align:center;text-decoration:none;}',
      '.pcc button.pcc-link,.pcc a.pcc-link{display:block;width:100%;box-sizing:border-box;background:#13283f;border:1px solid rgba(255,255,255,0.18);color:#fff;border-radius:6px;padding:10px;font-size:12px;font-weight:600;font-family:Inter,sans-serif;cursor:pointer;text-align:center;}',
      '.pcc-note{font-size:12px;line-height:1.45;color:#F8D48A;margin:8px 0 0;}',
      '.pcc-loan-empty{font-size:13px;line-height:1.45;color:#D1D5DB;margin:8px 0 0;}',
      '.pcc-records{color:#F8D48A;font-size:12px;font-weight:600;}',
      '.pcc .st-btn{display:block;background:transparent;border:1px solid #C89B3C;color:#C89B3C;border-radius:6px;padding:8px 10px;font-size:12px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;}',
      '.pcc .st-btn.locked{border-color:rgba(255,255,255,0.16);color:#9CA3AF;}',
      '.pcc .st-compliance{font-size:11px;color:#9CA3AF;line-height:1.45;margin:8px 0 0;}',
      '.ps-lead-card .actions,.ps-saved-lead-card .actions{flex-wrap:wrap;}',
      '.ps-open-addr{background:none;border:0;padding:0;color:inherit;font:inherit;font-weight:700;cursor:pointer;text-align:left;}'
    ].join('');
    document.head.appendChild(style);
    host = document.createElement('div');
    host.className = 'pcc';
    host.hidden = true;
    host.innerHTML = '<div class="pcc-panel" id="pcc-panel"></div>';
    host.addEventListener('click', function (event) {
      if (event.target === host) close();
    });
    document.body.appendChild(host);
    return host;
  }

  function init(options) {
    ctx = Object.assign(ctx, options || {});
    ensure();
  }

  function close() {
    if (host) host.hidden = true;
    current = null;
  }

  function fullAddress(record) {
    var details = record.details || {};
    var street = record.address || '';
    if (/,\s*[A-Z]{2}\s+\d{5}\b/.test(street)) return street;
    var tail = [details.state, details.zip].filter(Boolean).join(' ');
    return [street, [details.city, tail].filter(Boolean).join(', ')].filter(Boolean).join(', ');
  }

  function subject(record) {
    var details = record.details || {};
    return {
      address: record.address,
      city: details.city || '',
      state: details.state || '',
      zip: details.zip || '',
      owner: record.owner || '',
      ownerFirstName: record.ownerFirstName || details.ownerFirstName || '',
      ownerLastName: record.ownerLastName || details.ownerLastName || '',
    };
  }

  function occupancy(record) {
    var details = record.details || {};
    var plays = record.playIds || [];
    if (plays.indexOf('absentee') !== -1 || plays.indexOf('bored') !== -1 || details.absenteeMail === true) return 'Absentee';
    if (details.absenteeMail === false) return 'Owner-occupied';
    return 'Not marked';
  }

  function mailing(record) {
    var details = record.details || {};
    var line = [details.ownerAddress, details.ownerCity, [details.ownerState, details.ownerZip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    return line || 'No separate mailing address on this record.';
  }

  function fact(label, value) {
    return '<div class="pcc-fact">' + esc(label) + '<strong>' + esc(value || '—') + '</strong></div>';
  }

  function render(record) {
    var details = record.details || {};
    var tags = (record.playIds || []).map(function (id) {
      return '<span class="pcc-tag">' + esc(ctx.labelPlay(id)) + '</span>';
    }).join('');
    var owner = [record.ownerFirstName || details.ownerFirstName, record.ownerLastName || details.ownerLastName].filter(Boolean).join(' ');
    var entity = root.ForgeSkipTraceShared && root.ForgeSkipTraceShared.entityNote(record.owner || owner);
    var comp = '';
    if (root.ForgeComps && record.compKind && record.compId) comp = root.ForgeComps.buttonFor(record.compKind, record.compId);
    var marketQuery = [details.city, details.state, details.zip].filter(Boolean).join(' ') || record.address || '';
    var contactBtn = root.ForgeSkipTrace ? root.ForgeSkipTrace.buttonHtml(ctx.empire() ? '' : 'locked') : '';
    host.hidden = false;
    document.getElementById('pcc-panel').innerHTML =
      '<div class="pcc-top"><div><div class="pcc-kicker">Property Command Center</div>' +
      '<h2 class="pcc-title">' + esc(record.address || 'Property') + '</h2></div>' +
      '<button type="button" class="pcc-close" data-pcc-close="1">Close</button></div>' +
      '<p class="pcc-sub">' + esc(fullAddress(record)) + '</p>' +
      '<div class="pcc-tags">' + (tags || '<span class="pcc-tag">Lead</span>') + '</div>' +
      '<div class="pcc-grid">' +
      fact('Beds / baths', [details.beds != null ? details.beds + ' bd' : '', details.baths != null ? details.baths + ' ba' : ''].filter(Boolean).join(' · ')) +
      fact('Sqft / year', [details.sqft != null ? details.sqft + ' sqft' : '', details.yearBuilt != null ? 'built ' + details.yearBuilt : ''].filter(Boolean).join(' · ')) +
      fact('Est. equity', record.equity ? '$' + record.equity + 'K' : '—') +
      fact('Occupancy', occupancy(record)) +
      fact('Owner', owner || record.owner || 'Unknown') +
      fact('Mailing address', mailing(record)) +
      '</div>' +
      (entity ? '<p class="pcc-note">' + esc(entity) + '</p>' : '') +
      (root.ForgeLoanRecords ? root.ForgeLoanRecords.sectionHtml(record) : '') +
      '<section class="pcc-section"><div class="pcc-kicker">Comps and market</div>' +
      '<div class="pcc-actions" style="margin-top:8px;">' + comp +
      '<a class="pcc-link" href="market-oracle.html?q=' + encodeURIComponent(marketQuery) + '">Open Market Oracle</a></div>' +
      '<p class="st-compliance">Comps use the existing comp report. Market Oracle opens this city without a new charge from this screen.</p></section>' +
      '<section class="pcc-section"><div class="pcc-kicker">Owner contact</div>' +
      '<div class="pcc-actions" style="margin-top:8px;">' + contactBtn + '</div>' +
      '<div data-owner-result="1"></div></section>' +
      '<section class="pcc-section"><div class="pcc-kicker">Work this property</div>' +
      '<div class="pcc-actions" style="margin-top:8px;">' +
      '<button type="button" class="pcc-link" data-pcc-market="1">Market to This Property</button>' +
      '<button type="button" class="pcc-link" data-pcc-analyze="1">Analyze the Deal</button>' +
      '<button type="button" class="pcc-link" data-pcc-save="1">Save Lead</button>' +
      '<button type="button" class="pcc-link" data-pcc-crm="1">' + (record.crmDealId ? 'Already in CRM' : 'Send to CRM') + '</button>' +
      '</div><p class="pcc-note" data-pcc-status="1"></p></section>';
    document.querySelector('[data-pcc-close]').addEventListener('click', close);
    var contact = document.querySelector('#pcc-panel [data-owner-contact]');
    if (contact) contact.addEventListener('click', function () { lookup(record); });
    document.querySelector('[data-pcc-market]').addEventListener('click', function () { market(record); });
    document.querySelector('[data-pcc-analyze]').addEventListener('click', function () { analyze(record); });
    document.querySelector('[data-pcc-save]').addEventListener('click', function () { save(record); });
    document.querySelector('[data-pcc-crm]').addEventListener('click', function () { sendCrm(record); });
    if (!ctx.empire()) {
      var locked = document.querySelector('#pcc-panel [data-owner-contact]');
      if (locked) locked.classList.add('locked');
    }
    if (root.ForgeLoanRecords) {
      root.ForgeLoanRecords.mount(document.getElementById('pcc-panel'), record, {
        getToken: ctx.getToken,
        empire: ctx.empire,
        onUpgrade: ctx.onUpgrade,
      });
    }
  }

  function open(record) {
    ensure();
    current = record;
    render(record);
  }

  function status(message) {
    var node = document.querySelector('[data-pcc-status]');
    if (node) node.textContent = message || '';
  }

  function lookup(record) {
    if (!root.ForgeSkipTrace) return;
    var sub = subject(record);
    root.ForgeSkipTrace.open(sub, {
      getToken: ctx.getToken,
      empire: ctx.empire,
      onUpgrade: ctx.onUpgrade,
      subject: sub,
      onResult: function (result) {
        var slot = document.querySelector('#pcc-panel [data-owner-result]');
        if (!slot) return;
        slot.innerHTML = root.ForgeSkipTrace.resultHtml(result);
        root.ForgeSkipTrace.bindResult(slot, { getToken: ctx.getToken, subject: sub }, result);
      },
    });
  }

  function market(record) {
    if (!ctx.canMarket() || !root.ForgeMarketingEntry) {
      status('Marketing is not on this account yet.');
      return;
    }
    var lead = root.ForgeMarketingEntry.leadForMarketing({
      id: record.id,
      address: record.address,
      owner: record.owner,
      playIds: record.playIds || [],
      equity: record.equity,
      details: record.details || {},
    });
    root.ForgeMarketingEntry.writeLeads({
      version: 1,
      source: 'property-command',
      createdAt: new Date().toISOString(),
      leads: [lead],
    });
    location.href = 'marketing.html?from=property-search';
  }

  function analyze(record) {
    var address = fullAddress(record);
    localStorage.setItem('forge-transfer', JSON.stringify({
      tab: 'wholesale',
      fields: { 'w-address': address },
      source: 'property-search',
      timestamp: Date.now(),
    }));
    location.href = 'deal-analyzer.html';
  }

  async function authPost(payload) {
    var headers = { 'Content-Type': 'application/json' };
    var token = ctx.getToken();
    if (token) headers.Authorization = 'Bearer ' + token;
    var response = await fetch('/api/property-search', { method: 'POST', headers: headers, body: JSON.stringify(payload) });
    var data = {};
    try { data = await response.json(); } catch (err) { data = {}; }
    if (!response.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  async function save(record) {
    if (record.savedId) {
      status('This lead is already saved.');
      return;
    }
    status('Saving...');
    try {
      var details = Object.assign({}, record.details || {}, {
        ownerFirstName: record.ownerFirstName || (record.details && record.details.ownerFirstName) || null,
        ownerLastName: record.ownerLastName || (record.details && record.details.ownerLastName) || null,
        mapUrl: record.mapUrl || (record.details && record.details.mapUrl) || null,
        zillowUrl: record.zillowUrl || (record.details && record.details.zillowUrl) || null,
      });
      var data = await authPost({
        action: 'save',
        leadId: record.id,
        address: record.address,
        playIds: record.playIds || [],
        lat: record.lat,
        lng: record.lng,
        owner: record.owner,
        ownerFirstName: details.ownerFirstName,
        ownerLastName: details.ownerLastName,
        equity: record.equity,
        details: details,
      });
      record.savedId = data.lead && data.lead.id;
      status('Saved.');
    } catch (err) {
      status(err.message || 'Could not save this lead.');
    }
  }

  async function sendCrm(record) {
    if (record.crmDealId) {
      status('This lead is already in the CRM.');
      return;
    }
    try {
      if (!record.savedId) await save(record);
      if (!record.savedId) return;
      status('Sending to CRM...');
      var data = await authPost({ action: 'send_to_crm', id: record.savedId });
      record.crmDealId = data.crmDeal && data.crmDeal.id;
      status('Sent to CRM.');
      render(record);
    } catch (err) {
      status(err.message || 'Could not send this lead to the CRM.');
    }
  }

  root.ForgePropertyCommand = {
    init: init,
    open: open,
    close: close,
    fullAddress: fullAddress,
  };
})(typeof window !== 'undefined' ? window : globalThis);
