// Owner contact lookup UI. Confirm cost and balance before a paid lookup.
// Copy buttons only. Nothing is dialed or texted from this page.
(function (root) {
  'use strict';

  var shared = root.ForgeSkipTraceShared;
  var modalHost = null;

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function ensureStyles() {
    if (document.getElementById('forge-skip-trace-css')) return;
    var style = document.createElement('style');
    style.id = 'forge-skip-trace-css';
    style.textContent = [
      '.st-btn{background:transparent;border:1px solid #C89B3C;color:#C89B3C;border-radius:6px;padding:8px 10px;font-size:12px;font-weight:600;cursor:pointer;font-family:Inter,sans-serif;}',
      '.st-btn:hover{background:rgba(200,155,60,0.12);}',
      '.st-btn.locked{border-color:rgba(255,255,255,0.16);color:#9CA3AF;}',
      '.st-btn.primary{background:#FF6B2B;border-color:#FF6B2B;color:#fff;}',
      '.st-modal{position:fixed;inset:0;background:rgba(0,0,0,0.62);z-index:1400;display:flex;align-items:flex-end;justify-content:center;padding:12px;}',
      '@media(min-width:720px){.st-modal{align-items:center;}}',
      '.st-card{width:min(480px,100%);max-height:min(88vh,760px);overflow:auto;background:#0f2035;border:1px solid rgba(200,155,60,0.35);border-radius:12px;padding:18px 16px 16px;color:#fff;font-family:Inter,sans-serif;}',
      '.st-kicker{font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#C89B3C;font-weight:700;}',
      '.st-title{font-family:"Bebas Neue",sans-serif;font-size:26px;letter-spacing:1px;margin:4px 0 8px;}',
      '.st-copy{font-size:13px;line-height:1.5;color:#D1D5DB;margin:0 0 10px;}',
      '.st-note{font-size:12px;line-height:1.45;color:#F8D48A;background:rgba(200,155,60,0.1);border:1px solid rgba(200,155,60,0.28);border-radius:8px;padding:8px 10px;margin:0 0 12px;}',
      '.st-actions{display:flex;gap:8px;flex-wrap:wrap;}',
      '.st-actions .st-btn{flex:1;min-width:120px;}',
      '.st-error{color:#fecaca;font-size:13px;margin:0 0 10px;}',
      '.st-result{margin-top:12px;display:flex;flex-direction:column;gap:10px;}',
      '.st-person{border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:10px;background:#13283f;}',
      '.st-person h3{margin:0 0 6px;font-size:15px;}',
      '.st-row{display:flex;justify-content:space-between;gap:8px;align-items:flex-start;font-size:13px;margin-top:6px;}',
      '.st-flags{display:flex;gap:4px;flex-wrap:wrap;margin-top:4px;}',
      '.st-flag{font-size:10px;letter-spacing:0.4px;text-transform:uppercase;border-radius:99px;padding:2px 6px;background:rgba(255,255,255,0.08);color:#E5E7EB;}',
      '.st-flag.bad{background:rgba(239,68,68,0.16);color:#fecaca;}',
      '.st-flag.ok{background:rgba(34,197,94,0.14);color:#bbf7d0;}',
      '.st-script{font-size:12px;line-height:1.45;color:#E5E7EB;background:rgba(0,0,0,0.2);border-radius:8px;padding:8px;margin:6px 0;}',
      '.st-compliance{font-size:11px;line-height:1.45;color:#9CA3AF;}',
      '.st-mini{background:transparent;border:1px solid rgba(255,255,255,0.16);color:#E5E7EB;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer;}',
      '.st-packs{display:flex;flex-direction:column;gap:8px;}',
      '.st-pack{display:flex;justify-content:space-between;gap:8px;align-items:center;border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:10px;}',
      '.st-recent{font-size:12px;color:#D1D5DB;margin:0;padding-left:16px;}',
      '.st-recent li{margin:4px 0;}'
    ].join('');
    document.head.appendChild(style);
  }

  function buttonHtml(extraClass) {
    return '<button type="button" class="st-btn ' + (extraClass || '') + '" data-owner-contact="1">Get Owner Contact Info</button>';
  }

  function closeModal() {
    if (modalHost) modalHost.remove();
    modalHost = null;
  }

  function openModal(html) {
    ensureStyles();
    closeModal();
    modalHost = document.createElement('div');
    modalHost.className = 'st-modal';
    modalHost.innerHTML = '<div class="st-card" role="dialog" aria-modal="true">' + html + '</div>';
    modalHost.addEventListener('click', function (event) {
      if (event.target === modalHost) closeModal();
    });
    document.body.appendChild(modalHost);
    return modalHost.querySelector('.st-card');
  }

  function showUpgrade(onUpgrade) {
    var card = openModal(
      '<div class="st-kicker">Empire</div>' +
      '<div class="st-title">Get Owner Contact Info</div>' +
      '<p class="st-copy">Owner contact lookup is part of Empire. Upgrade to look up phones, emails, and a mailing address for a property you already have.</p>' +
      '<div class="st-actions"><button type="button" class="st-btn primary" data-upgrade="1">Unlock Empire</button>' +
      '<button type="button" class="st-btn" data-close="1">Not now</button></div>'
    );
    card.querySelector('[data-close]').addEventListener('click', closeModal);
    card.querySelector('[data-upgrade]').addEventListener('click', function () {
      if (typeof onUpgrade === 'function') onUpgrade();
    });
  }

  async function api(opts, path, body) {
    var headers = { 'Content-Type': 'application/json' };
    var token = opts.getToken ? opts.getToken() : '';
    if (token) headers.Authorization = 'Bearer ' + token;
    var response = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    var data = {};
    try { data = await response.json(); } catch (err) { data = {}; }
    data.ok = response.ok;
    data.status = response.status;
    return data;
  }

  function flagHtml(phone) {
    var bits = ['<span class="st-flag">' + esc(phone.type || 'Phone') + '</span>'];
    if (phone.dnc) bits.push('<span class="st-flag bad">DNC</span>');
    if (phone.tcpa) bits.push('<span class="st-flag bad">TCPA</span>');
    if (phone.litigator) bits.push('<span class="st-flag bad">Litigator</span>');
    if (!phone.dnc && !phone.tcpa && !phone.litigator) bits.push('<span class="st-flag ok">No DNC flag</span>');
    return '<div class="st-flags">' + bits.join('') + '</div>';
  }

  function resultHtml(result) {
    if (!result) return '';
    if (result.hit === false) {
      return '<div class="st-result"><p class="st-copy">No owner contact info was found for this address. You were not charged.</p>' +
        (result.entityNote ? '<p class="st-note">' + esc(result.entityNote) + '</p>' : '') +
        '<p class="st-compliance">' + esc(result.complianceNote || shared.COMPLIANCE_NOTE) + '</p></div>';
    }
    var persons = result.persons || [];
    var blocks = persons.map(function (person, index) {
      var mail = person.mailingAddress || {};
      var mailLine = [mail.street, mail.city, [mail.state, mail.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
      var phones = (person.phones || []).map(function (phone) {
        var shown = shared.formatPhone(phone.number);
        return '<div class="st-row"><div><strong>' + esc(shown) + '</strong>' +
          (phone.carrier ? '<div class="st-compliance">' + esc(phone.carrier) + '</div>' : '') +
          flagHtml(phone) + '</div><button type="button" class="st-mini" data-copy="' + esc(shown) + '">Copy</button></div>';
      }).join('');
      var emails = (person.emails || []).map(function (item) {
        return '<div class="st-row"><div>' + esc(item.email) + '</div><button type="button" class="st-mini" data-copy="' + esc(item.email) + '">Copy</button></div>';
      }).join('');
      var scripts = shared.scriptsFor(person, result.address || {});
      var marks = [];
      if (person.deceased) marks.push('<span class="st-flag bad">Deceased</span>');
      if (person.litigator) marks.push('<span class="st-flag bad">Litigator</span>');
      if (person.propertyOwner) marks.push('<span class="st-flag ok">Property owner</span>');
      return '<section class="st-person">' +
        '<h3>' + esc(person.fullName || 'Owner') + '</h3>' +
        (marks.length ? '<div class="st-flags">' + marks.join('') + '</div>' : '') +
        (phones || '<p class="st-compliance">No phone numbers returned.</p>') +
        (emails || '<p class="st-compliance">No email addresses returned.</p>') +
        (mailLine ? '<p class="st-copy" style="margin-top:8px;">Mailing address<br><strong>' + esc(mailLine) + '</strong></p>' : '') +
        '<div class="st-kicker" style="margin-top:8px;">Call script</div><div class="st-script">' + esc(scripts.call) + '</div>' +
        '<button type="button" class="st-mini" data-copy="' + esc(scripts.call) + '">Copy call script</button>' +
        '<div class="st-kicker" style="margin-top:8px;">Text script</div><div class="st-script">' + esc(scripts.text) + '</div>' +
        '<button type="button" class="st-mini" data-copy="' + esc(scripts.text) + '">Copy text script</button>' +
        '<div class="st-actions" style="margin-top:10px;"><button type="button" class="st-btn" data-save-person="' + index + '">Save to Contacts</button></div>' +
        '</section>';
    }).join('');
    var cost = result.cached ? 'Already on file. No charge.' : (result.chargedCents ? ('Charged ' + shared.money(result.chargedCents) + '.') : 'No charge.');
    return '<div class="st-result">' +
      (result.entityNote ? '<p class="st-note">' + esc(result.entityNote) + '</p>' : '') +
      '<p class="st-compliance">' + esc(cost) + ' Balance ' + esc(shared.money(result.balanceCents)) + '.</p>' +
      blocks +
      '<p class="st-compliance">' + esc(result.complianceNote || shared.COMPLIANCE_NOTE) + '</p></div>';
  }

  function bindResult(rootNode, opts, result) {
    if (!rootNode) return;
    rootNode.querySelectorAll('[data-copy]').forEach(function (button) {
      button.addEventListener('click', function () {
        var value = button.getAttribute('data-copy') || '';
        var done = function () { button.textContent = 'Copied'; };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(value).then(done).catch(function () { done(); });
        } else done();
      });
    });
    rootNode.querySelectorAll('[data-save-person]').forEach(function (button) {
      button.addEventListener('click', async function () {
        var index = Number(button.getAttribute('data-save-person'));
        var person = (result.persons || [])[index];
        button.disabled = true;
        button.textContent = 'Saving...';
        var saved = await api(opts, '/api/skip-trace', {
          action: 'save_contact',
          person: person,
          property: result.address || opts.subject || {},
          owner: opts.subject && opts.subject.owner,
          flags: { entityLimited: !!(result.entityNote) },
        });
        button.textContent = saved.ok ? 'Saved to Contacts' : (saved.error || 'Could not save');
        if (!saved.ok) button.disabled = false;
      });
    });
  }

  async function open(subject, opts) {
    var options = opts || {};
    ensureStyles();
    if (options.empire && !options.empire()) {
      showUpgrade(options.onUpgrade);
      return;
    }
    var parsed = shared.parseAddress(subject || {});
    if (parsed.error) {
      if (options.onError) options.onError(parsed.error);
      else openModal('<p class="st-error">' + esc(parsed.error) + '</p><div class="st-actions"><button type="button" class="st-btn" data-close="1">Close</button></div>');
      var closer = modalHost && modalHost.querySelector('[data-close]');
      if (closer) closer.addEventListener('click', closeModal);
      return;
    }
    var card = openModal('<div class="st-kicker">Owner contact</div><div class="st-title">Checking credits</div><p class="st-copy">One moment.</p>');
    var quote = await api(options, '/api/skip-trace', Object.assign({ action: 'quote' }, subject));
    if (!quote.ok && quote.status === 403) {
      card.innerHTML = '<p class="st-error">' + esc(quote.error || 'Empire membership required.') + '</p><div class="st-actions"><button type="button" class="st-btn primary" data-upgrade="1">Unlock Empire</button><button type="button" class="st-btn" data-close="1">Close</button></div>';
      card.querySelector('[data-close]').addEventListener('click', closeModal);
      var upgrade = card.querySelector('[data-upgrade]');
      if (upgrade) upgrade.addEventListener('click', function () { if (options.onUpgrade) options.onUpgrade(); });
      return;
    }
    if (!quote.ok || quote.quote !== true) {
      card.innerHTML = '<p class="st-error">' + esc(quote.error || 'Owner contact lookup could not be quoted.') + '</p><div class="st-actions"><button type="button" class="st-btn" data-close="1">Close</button></div>';
      card.querySelector('[data-close]').addEventListener('click', closeModal);
      return;
    }
    var costLine = quote.cached
      ? 'This address is already on file. Opening it again is free.'
      : ('A successful lookup costs ' + shared.money(quote.costCents) + '. Misses are free.');
    card.innerHTML =
      '<div class="st-kicker">Confirm before spend</div>' +
      '<div class="st-title">Get Owner Contact Info</div>' +
      '<p class="st-copy">' + esc(quote.addressLabel || '') + '</p>' +
      '<p class="st-copy">' + esc(costLine) + ' Balance: <strong>' + esc(shared.money(quote.balanceCents)) + '</strong>.</p>' +
      (quote.entityNote ? '<p class="st-note">' + esc(quote.entityNote) + '</p>' : '') +
      (quote.message ? '<p class="st-error">' + esc(quote.message) + '</p>' : '') +
      '<p class="st-compliance">' + esc(shared.COMPLIANCE_NOTE) + '</p>' +
      '<div class="st-actions">' +
      (quote.sufficient ? '<button type="button" class="st-btn primary" data-go="1">' + (quote.cached ? 'Show contact info' : 'Look up') + '</button>' : '<a class="st-btn primary" href="profile.html" style="text-align:center;text-decoration:none;">Add credits</a>') +
      '<button type="button" class="st-btn" data-close="1">Cancel</button></div>';
    card.querySelector('[data-close]').addEventListener('click', closeModal);
    var go = card.querySelector('[data-go]');
    if (!go) return;
    go.addEventListener('click', async function () {
      go.disabled = true;
      go.textContent = 'Looking up...';
      var result = await api(options, '/api/skip-trace', Object.assign({ action: 'lookup', confirm: true }, subject));
      if (!result.ok) {
        card.querySelector('.st-error') || card.insertAdjacentHTML('beforeend', '');
        go.disabled = false;
        go.textContent = quote.cached ? 'Show contact info' : 'Look up';
        var err = card.querySelector('[data-live-error]');
        if (!err) {
          go.insertAdjacentHTML('beforebegin', '<p class="st-error" data-live-error="1"></p>');
          err = card.querySelector('[data-live-error]');
        }
        err.textContent = result.error || 'Owner contact lookup could not be completed.';
        return;
      }
      closeModal();
      if (options.onResult) options.onResult(result);
    });
  }

  function mountAnalyzer(opts) {
    ensureStyles();
    var rootNode = opts.root;
    if (!rootNode) return;
    rootNode.innerHTML = '<div class="st-actions">' + buttonHtml(opts.empire && opts.empire() ? '' : 'locked') + '</div><div data-owner-result="1"></div>';
    rootNode.querySelector('[data-owner-contact]').addEventListener('click', function () {
      var subject = opts.getSubject ? opts.getSubject() : {};
      open(subject, {
        getToken: opts.getToken,
        empire: opts.empire,
        onUpgrade: opts.onUpgrade,
        subject: subject,
        onError: function (message) {
          var slot = rootNode.querySelector('[data-owner-result]');
          slot.innerHTML = '<p class="st-error">' + esc(message) + '</p>';
        },
        onResult: function (result) {
          var slot = rootNode.querySelector('[data-owner-result]');
          slot.innerHTML = resultHtml(result);
          bindResult(slot, { getToken: opts.getToken, subject: subject }, result);
        },
      });
    });
  }

  function mountProfile(opts) {
    ensureStyles();
    var rootNode = opts.root;
    if (!rootNode) return;
    if (opts.empire && !opts.empire()) {
      rootNode.innerHTML = '<p class="st-copy">Owner contact lookup is part of Empire. Upgrade to buy lookup credits and use Get Owner Contact Info.</p>' +
        '<button type="button" class="st-btn primary" data-upgrade="1">Unlock Empire</button>';
      rootNode.querySelector('[data-upgrade]').addEventListener('click', function () {
        if (opts.onUpgrade) opts.onUpgrade();
      });
      return;
    }
    rootNode.innerHTML = '<p class="st-copy">Loading credits...</p>';
    api(opts, '/api/skip-trace-credits').then(function (data) {
      if (!data.ok) {
        rootNode.innerHTML = '<p class="st-error">' + esc(data.error || 'Credits could not be loaded.') + '</p>';
        return;
      }
      var notice = '';
      var params = new URLSearchParams(location.search);
      if (params.get('skiptrace') === 'success') notice = '<p class="st-note">Payment received. Credits show up after checkout confirms. Refresh if the balance still looks old.</p>';
      if (params.get('skiptrace') === 'cancel') notice = '<p class="st-copy">Checkout canceled. No credits were added.</p>';
      var packs = (data.packs || []).map(function (pack) {
        return '<div class="st-pack"><div><strong>' + esc(pack.label) + '</strong><div class="st-compliance">' + esc(shared.money(data.lookupCents)) + ' per successful lookup. Misses are free.</div></div>' +
          '<button type="button" class="st-btn" data-pack="' + esc(pack.id) + '">Buy</button></div>';
      }).join('');
      var recent = (data.recent || []).map(function (row) {
        return '<li>' + esc(row.addressLabel || 'Address') + ' · ' + (row.hit ? 'found' : 'no match') + ' · ' + esc(shared.money(row.chargedCents)) + '</li>';
      }).join('');
      rootNode.innerHTML = notice +
        '<p class="st-copy">Balance <strong>' + esc(shared.money(data.balanceCents)) + '</strong>. Successful lookups cost ' + esc(shared.money(data.lookupCents)) + '. The same address is free again for 90 days.</p>' +
        '<div class="st-packs">' + packs + '</div>' +
        '<div class="st-kicker" style="margin-top:14px;">Recent lookups</div>' +
        (recent ? '<ul class="st-recent">' + recent + '</ul>' : '<p class="st-compliance">No lookups yet.</p>');
      rootNode.querySelectorAll('[data-pack]').forEach(function (button) {
        button.addEventListener('click', async function () {
          button.disabled = true;
          var session = await api(opts, '/api/skip-trace-credits', { action: 'checkout', pack: button.getAttribute('data-pack') });
          if (session.ok && session.url) location.href = session.url;
          else {
            button.disabled = false;
            button.textContent = session.error || 'Try again';
          }
        });
      });
    });
  }

  root.ForgeSkipTrace = {
    buttonHtml: buttonHtml,
    resultHtml: resultHtml,
    bindResult: bindResult,
    open: open,
    mountAnalyzer: mountAnalyzer,
    mountProfile: mountProfile,
    showUpgrade: showUpgrade,
  };
})(typeof window !== 'undefined' ? window : globalThis);
