/* Member-facing level unlocks.
 *
 * Badges come from education-data.js `list`: a tier badge is true only after
 * every published topic is passed at that tier. These cards never gate a
 * lesson, a quiz, or the next badge. education-data.js remains the only
 * place that decides whether the next tier opens.
 *
 * Book cards open the member unlock pages. The PDF itself is not linked
 * here. Download goes through /api/book-download, which reads Netlify Blobs
 * after checking the same education badge.
 * Real Estate H2O has no cover or PDF in the repo. Apartment Confidential's
 * public PDF stays on apartment-confidential.html and is not the member download.
 * The Empire lesson path stays behind the Empire plan.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof root !== 'undefined') root.ForgeLevelUnlocks = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var DISMISS_KEY = 'forge_level_unlock_dismissed';
  var DIRECTED_IRA_URL = 'https://directedira32a69.referralrock.com/l/JOHNDESSAU79/';

  // Order in this array is the order a member sees earned cards.
  // The Directed IRA consultation is the first Rookie unlock.
  var UNLOCKS = [
    {
      id: 'directed-ira-consult',
      level: 'rookie',
      kind: 'link',
      optional: true,
      blocksProgress: false,
      eyebrow: 'Rookie unlock · Optional',
      title: 'Free Directed IRA consultation',
      body: 'Book a free consultation about using a self-directed IRA, 401(k), or Solo 401(k) to invest in real estate. This does not change your lessons or your level.',
      disclosure: 'Directed IRA is an independent company. FORGE may receive a referral fee.',
      cta: 'Book a free consultation',
      dismiss: 'Not now',
      href: DIRECTED_IRA_URL,
      external: true,
    },
    {
      id: 'real-estate-h2o',
      level: 'rookie',
      kind: 'link',
      optional: false,
      blocksProgress: false,
      eyebrow: 'Rookie unlock',
      title: 'Real Estate H2O',
      body: 'You unlocked John\'s book. Open the page to download your copy.',
      disclosure: '',
      cta: 'Open your book',
      dismiss: '',
      href: '/unlocks/rookie',
      external: false,
    },
    {
      id: 'apartment-confidential',
      level: 'investor',
      kind: 'link',
      optional: false,
      blocksProgress: false,
      eyebrow: 'Investor unlock',
      title: 'Apartment Confidential',
      body: 'You unlocked John\'s book. Open the page to download your copy.',
      disclosure: '',
      cta: 'Open your book',
      dismiss: '',
      href: '/unlocks/investor',
      external: false,
    },
  ];

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function readDismissed(storage) {
    if (!storage || typeof storage.getItem !== 'function') return [];
    try {
      var parsed = JSON.parse(storage.getItem(DISMISS_KEY) || '[]');
      return Array.isArray(parsed) ? parsed.filter(function (id) { return typeof id === 'string'; }) : [];
    } catch (e) {
      return [];
    }
  }

  function dismiss(id, storage) {
    var next = readDismissed(storage);
    if (next.indexOf(id) === -1) next.push(id);
    if (storage && typeof storage.setItem === 'function') {
      storage.setItem(DISMISS_KEY, JSON.stringify(next));
    }
    return next;
  }

  function isEarned(unlock, badges) {
    return !!(badges && badges[unlock.level]);
  }

  function visibleUnlocks(badges, storage) {
    var dismissed = readDismissed(storage);
    return UNLOCKS.filter(function (unlock) {
      if (!isEarned(unlock, badges)) return false;
      if (unlock.optional && dismissed.indexOf(unlock.id) !== -1) return false;
      return true;
    });
  }

  function actionMarkup(unlock) {
    // A placeholder is never an anchor, even if href is filled in later by mistake.
    if (unlock.kind === 'placeholder' || !unlock.href) {
      return '<button type="button" class="level-unlock-card__cta is-disabled" disabled aria-disabled="true">' +
        escapeHtml(unlock.cta) + '</button>';
    }
    var external = unlock.external ? ' target="_blank" rel="noopener"' : '';
    return '<a class="level-unlock-card__cta" href="' + escapeHtml(unlock.href) + '"' + external + '>' +
      escapeHtml(unlock.cta) + '</a>';
  }

  function cardMarkup(unlock) {
    var placeholder = unlock.kind === 'placeholder' || !unlock.href;
    var disclosure = unlock.disclosure
      ? '<p class="level-unlock-card__disclosure">' + escapeHtml(unlock.disclosure) + '</p>'
      : '';
    var dismissBtn = unlock.optional && unlock.dismiss
      ? '<button type="button" class="level-unlock-card__dismiss" data-dismiss-unlock="' + escapeHtml(unlock.id) + '">' +
        escapeHtml(unlock.dismiss) + '</button>'
      : '';
    return '<article class="level-unlock-card" data-unlock-id="' + escapeHtml(unlock.id) + '" data-level="' +
      escapeHtml(unlock.level) + '"' + (placeholder ? ' data-placeholder="true"' : '') + '>' +
      '<div class="level-unlock-card__copy">' +
        '<div class="level-unlock-card__eyebrow">' + escapeHtml(unlock.eyebrow) + '</div>' +
        '<h2 class="level-unlock-card__title">' + escapeHtml(unlock.title) + '</h2>' +
        '<p class="level-unlock-card__body">' + escapeHtml(unlock.body) + '</p>' +
        disclosure +
      '</div>' +
      '<div class="level-unlock-card__actions">' + actionMarkup(unlock) + dismissBtn + '</div>' +
      '</article>';
  }

  function markupFor(badges, storage) {
    return visibleUnlocks(badges, storage).map(cardMarkup).join('');
  }

  var CSS = [
    '#level-unlocks[hidden]{display:none !important;}',
    '#level-unlocks{display:flex;flex-direction:column;gap:12px;margin:0 0 18px;}',
    '.level-unlock-card{display:flex;flex-wrap:wrap;gap:16px 24px;align-items:center;justify-content:space-between;',
    'background:var(--navy,#0f2035);border:1px solid rgba(200,155,60,0.45);border-radius:12px;padding:18px 20px;}',
    '.level-unlock-card[data-placeholder="true"]{border-style:dashed;}',
    '.level-unlock-card__copy{flex:1 1 280px;min-width:0;}',
    '.level-unlock-card__eyebrow{font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:var(--gold,#C89B3C);margin-bottom:6px;}',
    '.level-unlock-card__title{font-family:"Bebas Neue",sans-serif;font-weight:400;font-size:26px;letter-spacing:1px;line-height:1;color:var(--white,#fff);margin:0 0 8px;}',
    '.level-unlock-card__body{margin:0;font-size:13px;line-height:1.55;color:var(--grey-light,#9CA3AF);max-width:68ch;}',
    '.level-unlock-card__disclosure{margin:8px 0 0;font-size:12px;line-height:1.5;color:var(--grey,#6B7280);}',
    '.level-unlock-card__actions{display:flex;flex-direction:column;gap:8px;flex:0 0 230px;}',
    '.level-unlock-card__cta{display:inline-flex;align-items:center;justify-content:center;text-align:center;background:var(--gold,#C89B3C);color:var(--black,#0D1B2A);',
    'font-family:"Bebas Neue",sans-serif;font-size:16px;letter-spacing:1.2px;text-decoration:none;padding:12px 16px;border-radius:8px;border:1px solid transparent;}',
    '.level-unlock-card__cta.is-disabled,.level-unlock-card__cta:disabled{background:transparent;color:var(--grey,#6B7280);border-color:rgba(200,155,60,0.35);cursor:not-allowed;',
    'font-family:Inter,sans-serif;font-size:13px;font-weight:600;letter-spacing:0.2px;}',
    '.level-unlock-card__dismiss{background:transparent;border:1px solid rgba(255,255,255,0.12);color:var(--grey-light,#9CA3AF);font-family:Inter,sans-serif;',
    'font-size:12px;font-weight:600;padding:8px 12px;border-radius:8px;cursor:pointer;}',
    '.level-unlock-card__dismiss:hover{border-color:var(--gold,#C89B3C);color:var(--gold,#C89B3C);}',
  ].join('');

  function ensureStyles(doc) {
    if (!doc || typeof doc.getElementById !== 'function' || typeof doc.createElement !== 'function') return;
    if (doc.getElementById('forge-level-unlock-styles')) return;
    var style = doc.createElement('style');
    style.id = 'forge-level-unlock-styles';
    style.textContent = CSS;
    var parent = doc.head || doc.documentElement;
    if (parent && typeof parent.appendChild === 'function') parent.appendChild(style);
  }

  function render(container, badges, storage) {
    if (!container) return '';
    ensureStyles(container.ownerDocument);
    var html = markupFor(badges, storage);
    container.innerHTML = html;
    if (html) {
      if (typeof container.removeAttribute === 'function') container.removeAttribute('hidden');
      container.hidden = false;
    } else {
      if (typeof container.setAttribute === 'function') container.setAttribute('hidden', '');
      container.hidden = true;
    }
    if (typeof container.querySelectorAll === 'function') {
      var buttons = container.querySelectorAll('[data-dismiss-unlock]');
      Array.prototype.forEach.call(buttons, function (button) {
        button.addEventListener('click', function () {
          dismiss(button.getAttribute('data-dismiss-unlock'), storage);
          render(container, badges, storage);
        });
      });
    }
    return html;
  }

  function show(container, html) {
    container.innerHTML = html;
    if (html) {
      if (typeof container.removeAttribute === 'function') container.removeAttribute('hidden');
      container.hidden = false;
    } else {
      if (typeof container.setAttribute === 'function') container.setAttribute('hidden', '');
      container.hidden = true;
    }
  }

  function bindDismiss(container, storage, rerender) {
    if (typeof container.querySelectorAll !== 'function') return;
    var buttons = container.querySelectorAll('[data-dismiss-unlock]');
    Array.prototype.forEach.call(buttons, function (button) {
      button.addEventListener('click', function () {
        dismiss(button.getAttribute('data-dismiss-unlock'), storage);
        rerender();
      });
    });
  }

  function renderUnlock(container, id, storage) {
    if (!container) return '';
    ensureStyles(container.ownerDocument);
    var unlock = null;
    for (var i = 0; i < UNLOCKS.length; i++) {
      if (UNLOCKS[i].id === id) unlock = UNLOCKS[i];
    }
    if (!unlock) return '';
    var hidden = unlock.optional && readDismissed(storage).indexOf(unlock.id) !== -1;
    var html = hidden ? '' : cardMarkup(unlock);
    show(container, html);
    bindDismiss(container, storage, function () { renderUnlock(container, id, storage); });
    return html;
  }

  return {
    DISMISS_KEY: DISMISS_KEY,
    DIRECTED_IRA_URL: DIRECTED_IRA_URL,
    UNLOCKS: UNLOCKS,
    CSS: CSS,
    readDismissed: readDismissed,
    dismiss: dismiss,
    visibleUnlocks: visibleUnlocks,
    cardMarkup: cardMarkup,
    markupFor: markupFor,
    render: render,
    renderUnlock: renderUnlock,
  };
});
