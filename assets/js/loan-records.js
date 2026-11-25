// Loan & Lien Records inside the Property Command Center.
// Facts are already on the lead. Document images stay behind a server flag
// and always confirm a price before a purchase. Repeat views are free.
(function (root) {
  'use strict';

  var DISCLAIMER = 'Recorded mortgage/deed and lien data with estimated balances. Promissory notes are not public records.';
  var modalHost = null;

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function money(cents) {
    var n = Math.round(Number(cents) || 0);
    var sign = n < 0 ? '-' : '';
    var abs = Math.abs(n);
    return sign + '$' + Math.floor(abs / 100) + '.' + String(abs % 100).padStart(2, '0');
  }

  function withCommas(whole) {
    var text = String(whole);
    var out = '';
    while (text.length > 3) {
      out = ',' + text.slice(-3) + out;
      text = text.slice(0, -3);
    }
    return text + out;
  }

  function formatDollars(value) {
    if (value == null || value === '') return '';
    var n = Number(value);
    if (!isFinite(n)) return '';
    var sign = n < 0 ? '-' : '';
    var cents = Math.round(Math.abs(n) * 100);
    return sign + '$' + withCommas(Math.floor(cents / 100)) + '.' + String(cents % 100).padStart(2, '0');
  }

  function formatPercent(value) {
    if (value == null || value === '') return '';
    var n = Number(value);
    if (!isFinite(n)) return '';
    if (n > 0 && n < 1) n = n * 100;
    var rounded = Math.round(n * 100) / 100;
    return String(rounded) + '%';
  }

  function formatDate(value) {
    var text = String(value == null ? '' : value).trim();
    if (!text) return '';
    var iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/) || text.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (iso) {
      var month = Number(iso[2]);
      var day = Number(iso[3]);
      var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return months[month - 1] + ' ' + day + ', ' + iso[1];
    }
    var us = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (us) return Number(us[1]) + '/' + Number(us[2]) + '/' + us[3];
    return text.slice(0, 40);
  }

  function isSample(record) {
    if (!record) return false;
    var details = record.details || {};
    if (details.sample === true) return true;
    return /^demo-/i.test(String(record.id || ''));
  }

  function hasLoanFacts(loans) {
    if (!loans || typeof loans !== 'object') return false;
    var keys = ['numberLoans', 'totalLoanBalance', 'lender', 'originalAmount', 'date', 'rate', 'type', 'termYears', 'cltv', 'openLiens', 'freeAndClear', 'recorderUrl'];
    for (var i = 0; i < keys.length; i++) {
      if (loans[keys[i]] != null && loans[keys[i]] !== '') return true;
    }
    return false;
  }

  function safeUrl(value) {
    var text = String(value || '').trim();
    if (!/^https?:\/\//i.test(text)) return '';
    if (text.length > 500) return '';
    return text;
  }

  function fact(label, value) {
    return '<div class="pcc-fact">' + esc(label) + '<strong>' + esc(value || '—') + '</strong></div>';
  }

  function show(value, formatter) {
    if (value == null || value === '') return '';
    return formatter ? formatter(value) : String(value);
  }

  function sectionHtml(record) {
    var details = (record && record.details) || {};
    var loans = details.loans;
    var body = '';
    if (isSample(record)) {
      body = '<p class="pcc-loan-empty">Sample listing. Open loans, liens, and county records show on live results.</p>';
    } else if (!loans) {
      body = '<p class="pcc-loan-empty">Loan and lien details were not included with this saved listing.</p>';
    } else if (!hasLoanFacts(loans)) {
      body = '<p class="pcc-loan-empty">No recorded loan or lien details are on this listing.</p>';
    } else {
      var badges = '';
      if (loans.freeAndClear === true) badges += '<span class="pcc-tag">Free and clear</span>';
      if (loans.openLiens === true) badges += '<span class="pcc-tag">Open liens</span>';
      else if (loans.openLiens === false) badges += '<span class="pcc-tag">No open liens</span>';
      var openLoans = loans.numberLoans == null ? '' : (Number(loans.numberLoans) === 0 ? 'None' : String(loans.numberLoans));
      var term = loans.termYears == null ? '' : (String(loans.termYears) + ' years');
      var link = safeUrl(loans.recorderUrl);
      body = (badges ? '<div class="pcc-tags">' + badges + '</div>' : '') +
        '<div class="pcc-grid">' +
        fact('Open loans', openLoans) +
        fact('Lender', show(loans.lender)) +
        fact('Original amount', show(loans.originalAmount, formatDollars)) +
        fact('Date', show(loans.date, formatDate)) +
        fact('Rate', show(loans.rate, formatPercent)) +
        fact('Type', show(loans.type)) +
        fact('Term', term) +
        fact('Est. combined balance', show(loans.totalLoanBalance, formatDollars)) +
        fact('Est. CLTV', show(loans.cltv, formatPercent)) +
        '</div>' +
        (link ? '<p class="pcc-note"><a class="pcc-records" href="' + esc(link) + '" target="_blank" rel="noopener noreferrer">View county records</a></p>' : '');
    }
    return '<section class="pcc-section" data-loan-section="1">' +
      '<div class="pcc-kicker">Loan &amp; Lien Records</div>' +
      body +
      '<p class="pcc-note">' + esc(DISCLAIMER) + '</p>' +
      '<div data-loan-docs="1"></div>' +
      '</section>';
  }

  function ensureStyles() {
    if (document.getElementById('forge-loan-docs-css')) return;
    var style = document.createElement('style');
    style.id = 'forge-loan-docs-css';
    style.textContent = [
      '.pcc-records{color:#F8D48A;font-size:12px;font-weight:600;}',
      '.pcc-loan-empty{font-size:13px;line-height:1.45;color:#D1D5DB;margin:8px 0 0;}',
      '.ld-modal{position:fixed;inset:0;background:rgba(0,0,0,0.62);z-index:1400;display:flex;align-items:flex-end;justify-content:center;padding:12px;}',
      '@media(min-width:720px){.ld-modal{align-items:center;}}',
      '.ld-card{width:min(480px,100%);max-height:min(88vh,760px);overflow:auto;background:#0f2035;border:1px solid rgba(200,155,60,0.35);border-radius:12px;padding:18px 16px 16px;color:#fff;font-family:Inter,sans-serif;}',
      '.ld-copy{font-size:13px;line-height:1.5;color:#D1D5DB;margin:0 0 10px;}',
      '.ld-card .st-compliance{font-size:11px;line-height:1.45;color:#9CA3AF;margin:0 0 10px;}',
      '.ld-error{color:#fecaca;font-size:13px;margin:0 0 10px;}',
      '.ld-actions{display:flex;gap:8px;flex-wrap:wrap;}',
      '.ld-actions button,.ld-actions a{flex:1;min-width:120px;text-align:center;text-decoration:none;}',
      '.ld-doc{border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:10px;margin-top:8px;background:#13283f;}',
      '.ld-doc p{margin:0 0 8px;font-size:13px;}',
      '.ld-frame{width:100%;height:240px;border:0;border-radius:8px;background:#fff;margin-top:8px;}',
      '.ld-card .pcc-link{display:block;box-sizing:border-box;background:#13283f;border:1px solid rgba(255,255,255,0.18);color:#fff;border-radius:6px;padding:10px;font-size:12px;font-weight:600;font-family:Inter,sans-serif;cursor:pointer;text-align:center;text-decoration:none;}'
    ].join('');
    document.head.appendChild(style);
  }

  function closeModal() {
    if (modalHost) modalHost.remove();
    modalHost = null;
  }

  function openModal(html) {
    ensureStyles();
    closeModal();
    modalHost = document.createElement('div');
    modalHost.className = 'ld-modal';
    modalHost.innerHTML = '<div class="ld-card" role="dialog" aria-modal="true">' + html + '</div>';
    modalHost.addEventListener('click', function (event) {
      if (event.target === modalHost) closeModal();
    });
    document.body.appendChild(modalHost);
    return modalHost.querySelector('.ld-card');
  }

  function showUpgrade(onUpgrade) {
    var card = openModal(
      '<div class="pcc-kicker">Empire</div>' +
      '<div class="pcc-title" style="font-size:26px;">County document images</div>' +
      '<p class="ld-copy">Recorded document images are part of Empire.</p>' +
      '<div class="ld-actions"><button type="button" class="pcc-link" data-upgrade="1">Unlock Empire</button>' +
      '<button type="button" class="pcc-link" data-close="1">Not now</button></div>'
    );
    card.querySelector('[data-close]').addEventListener('click', closeModal);
    card.querySelector('[data-upgrade]').addEventListener('click', function () {
      if (typeof onUpgrade === 'function') onUpgrade();
    });
  }

  async function api(opts, body) {
    var headers = { 'Content-Type': 'application/json' };
    var token = opts.getToken ? opts.getToken() : '';
    if (token) headers.Authorization = 'Bearer ' + token;
    var response = await fetch('/api/loan-records', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body),
    });
    var data = {};
    try { data = await response.json(); } catch (err) { data = {}; }
    data.ok = response.ok;
    data.status = response.status;
    return data;
  }

  function docLine(doc) {
    var bits = [doc.type || 'Recorded document', formatDate(doc.date), formatDollars(doc.amount), doc.position].filter(Boolean);
    return bits.join(' · ');
  }

  function renderDocs(slot, status, record, opts) {
    if (!slot) return;
    if (isSample(record)) {
      slot.innerHTML = '<p class="pcc-loan-empty">Document images are not available for sample listings.</p>';
      return;
    }
    if (!status || status.comingSoon || status.enabled === false) {
      slot.innerHTML = '<p class="pcc-loan-empty">County document images are coming soon.</p>';
      return;
    }
    if (!status.empire) {
      slot.innerHTML = '<div class="pcc-actions" style="margin-top:8px;"><button type="button" class="st-btn locked" data-loan-locked="1">County document images</button></div>';
      slot.querySelector('[data-loan-locked]').addEventListener('click', function () {
        showUpgrade(opts.onUpgrade);
      });
      return;
    }
    if (!status.priced || status.priceCents == null) {
      slot.innerHTML = '<p class="pcc-loan-empty">County document images are not available yet.</p>';
      return;
    }
    slot.innerHTML = '<div class="pcc-actions" style="margin-top:8px;"><button type="button" class="st-btn" data-loan-list="1">County document images</button></div>';
    slot.querySelector('[data-loan-list]').addEventListener('click', function () {
      confirmList(record, status, opts, slot);
    });
  }

  function confirmList(record, status, opts, slot) {
    var card = openModal(
      '<div class="pcc-kicker">Confirm before spend</div>' +
      '<div class="pcc-title" style="font-size:26px;">County document images</div>' +
      '<p class="ld-copy">Each document image costs ' + esc(money(status.priceCents)) + '. Loading the list of recorded mortgages and liens does not charge you. You confirm again before an image is purchased. Repeat views of an image are free.</p>' +
      '<div class="ld-actions"><button type="button" class="pcc-link" data-go="1">Show documents</button>' +
      '<button type="button" class="pcc-link" data-close="1">Cancel</button></div>'
    );
    card.querySelector('[data-close]').addEventListener('click', closeModal);
    card.querySelector('[data-go]').addEventListener('click', async function () {
      var button = card.querySelector('[data-go]');
      button.disabled = true;
      button.textContent = 'Loading...';
      var data = await api(opts, { action: 'list', confirm: true, radarId: record.id });
      if (!data.ok || !data.documents) {
        button.disabled = false;
        button.textContent = 'Show documents';
        var err = card.querySelector('[data-live-error]');
        if (!err) {
          button.insertAdjacentHTML('beforebegin', '<p class="ld-error" data-live-error="1"></p>');
          err = card.querySelector('[data-live-error]');
        }
        err.textContent = data.error || 'Recorded documents could not be loaded.';
        return;
      }
      closeModal();
      showList(slot, data, record, opts);
    });
  }

  function showList(slot, data, record, opts) {
    var docs = data.documents || [];
    slot._loanDocs = docs;
    if (!docs.length) {
      slot.innerHTML = '<p class="pcc-loan-empty">No recorded mortgage or lien documents were listed for this property.</p>';
      return;
    }
    slot.innerHTML = docs.map(function (doc, index) {
      var label = doc.purchased ? 'View again' : ('View image · ' + money(data.priceCents));
      var blocked = doc.hasImage === false;
      var button = blocked
        ? '<p class="st-compliance">No image for this recording.</p>'
        : '<button type="button" class="st-btn" data-loan-doc="' + index + '">' + esc(label) + '</button>';
      return '<div class="ld-doc"><p>' + esc(docLine(doc)) + '</p>' + button + '</div>';
    }).join('');
    slot.querySelectorAll('[data-loan-doc]').forEach(function (button) {
      button.addEventListener('click', function () {
        var doc = docs[Number(button.getAttribute('data-loan-doc'))];
        confirmImage(doc, data.priceCents, record, opts, slot);
      });
    });
  }

  function confirmImage(doc, priceCents, record, opts, slot) {
    var card = openModal('<div class="pcc-kicker">Confirm before spend</div><div class="pcc-title" style="font-size:26px;">Checking price</div><p class="ld-copy">One moment.</p>');
    api(opts, { action: 'purchase', radarId: record.id, documentId: doc.documentId }).then(function (quote) {
      if (!quote.ok || quote.quote !== true) {
        card.innerHTML = '<p class="ld-error">' + esc(quote.error || 'This document image could not be quoted.') + '</p><div class="ld-actions"><button type="button" class="pcc-link" data-close="1">Close</button></div>';
        card.querySelector('[data-close]').addEventListener('click', closeModal);
        return;
      }
      var costLine = quote.cached || quote.costCents === 0
        ? 'This document is already on file. Opening it again is free.'
        : ('This recorded document image costs ' + money(quote.costCents) + '.');
      card.innerHTML =
        '<div class="pcc-kicker">Confirm before spend</div>' +
        '<div class="pcc-title" style="font-size:26px;">Document image</div>' +
        '<p class="ld-copy">' + esc(docLine(doc)) + '</p>' +
        '<p class="ld-copy">' + esc(costLine) + ' Repeat views of this document are free.</p>' +
        '<p class="st-compliance">' + esc(DISCLAIMER) + '</p>' +
        '<div class="ld-actions"><button type="button" class="pcc-link" data-go="1">' + (quote.costCents === 0 ? 'View image' : 'Purchase image') + '</button>' +
        '<button type="button" class="pcc-link" data-close="1">Cancel</button></div>';
      card.querySelector('[data-close]').addEventListener('click', closeModal);
      card.querySelector('[data-go]').addEventListener('click', async function () {
        var button = card.querySelector('[data-go]');
        button.disabled = true;
        button.textContent = 'Opening...';
        var result = await api(opts, {
          action: 'purchase',
          confirm: true,
          radarId: record.id,
          documentId: doc.documentId,
        });
        if (!result.ok || !result.imageDataUrl) {
          button.disabled = false;
          button.textContent = quote.costCents === 0 ? 'View image' : 'Purchase image';
          var err = card.querySelector('[data-live-error]');
          if (!err) {
            button.insertAdjacentHTML('beforebegin', '<p class="ld-error" data-live-error="1"></p>');
            err = card.querySelector('[data-live-error]');
          }
          err.textContent = result.error || 'That document image could not be loaded. You were not charged.';
          return;
        }
        var safe = String(result.imageDataUrl);
        if (safe.indexOf('data:application/pdf') !== 0 && safe.indexOf('data:image/') !== 0) {
          button.disabled = false;
          button.textContent = 'View image';
          return;
        }
        card.innerHTML = '<div class="pcc-kicker">Document image</div>' +
          '<p class="ld-copy">' + esc(result.cached ? 'Already on file. No charge.' : ('Charged ' + money(result.chargedCents) + '.')) + '</p>' +
          '<iframe class="ld-frame" title="Recorded document" src="' + esc(safe) + '"></iframe>' +
          '<div class="ld-actions" style="margin-top:10px;"><a class="pcc-link" href="' + esc(safe) + '" download="county-record">Download</a>' +
          '<button type="button" class="pcc-link" data-close="1">Close</button></div>';
        card.querySelector('[data-close]').addEventListener('click', closeModal);
        if (slot && slot._loanDocs) {
          slot._loanDocs.forEach(function (item) {
            if (item.documentId === doc.documentId) item.purchased = true;
          });
          showList(slot, { documents: slot._loanDocs, priceCents: priceCents }, record, opts);
        }
      });
    });
  }

  function mount(rootNode, record, opts) {
    var options = opts || {};
    var slot = rootNode && rootNode.querySelector('[data-loan-docs]');
    if (!slot) return;
    ensureStyles();
    if (isSample(record)) {
      renderDocs(slot, { enabled: false, comingSoon: true }, record, options);
      return;
    }
    slot.innerHTML = '';
    api(options, { action: 'status' }).then(function (status) {
      if (!slot.isConnected) return;
      renderDocs(slot, status && status.ok ? status : { enabled: false, comingSoon: true }, record, options);
    }).catch(function () {
      if (slot.isConnected) renderDocs(slot, { enabled: false, comingSoon: true }, record, options);
    });
  }

  var apiExport = {
    DISCLAIMER: DISCLAIMER,
    sectionHtml: sectionHtml,
    mount: mount,
    isSample: isSample,
    hasLoanFacts: hasLoanFacts,
    formatDollars: formatDollars,
    formatPercent: formatPercent,
    formatDate: formatDate,
    money: money,
    safeUrl: safeUrl,
  };
  root.ForgeLoanRecords = apiExport;
  if (typeof module === 'object' && module.exports) module.exports = apiExport;
})(typeof window !== 'undefined' ? window : globalThis);
