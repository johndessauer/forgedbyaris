// What's New on the member dashboard.
// Items live in assets/whats-new.json: id, date, title, description, link.
// Optional requires: "empire" (same plan check as comps). A locked item
// shows the Empire upgrade control and does not link into the feature.
// Dismissal is stored per member as the newest item id. A newer id shows
// the panel again.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof root !== 'undefined') root.ForgeWhatsNew = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var STORAGE_PREFIX = 'forge-whats-new-dismissed:';
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function normalize(item) {
    var row = item || {};
    var requires = String(row.requires || '').trim().toLowerCase();
    if (requires !== 'empire' && requires !== 'comps') requires = '';
    return {
      id: String(row.id || '').trim(),
      date: String(row.date || '').trim(),
      title: String(row.title || '').trim(),
      description: String(row.description || row.body || '').trim(),
      link: String(row.link || row.href || '').trim(),
      requires: requires,
    };
  }

  function prepare(items) {
    return (Array.isArray(items) ? items : []).map(normalize).filter(function (item) {
      return item.id && item.title;
    }).sort(function (a, b) {
      if (a.date === b.date) return 0;
      return a.date < b.date ? 1 : -1;
    });
  }

  function newestId(items) {
    var list = prepare(items);
    return list.length ? list[0].id : '';
  }

  function memberKey(memberId) {
    var id = String(memberId || '').trim();
    return STORAGE_PREFIX + (id || 'member');
  }

  function isDismissed(storage, memberId, items) {
    var newest = newestId(items);
    if (!newest || !storage || typeof storage.getItem !== 'function') return false;
    return storage.getItem(memberKey(memberId)) === newest;
  }

  function dismiss(storage, memberId, items) {
    var newest = newestId(items);
    if (newest && storage && typeof storage.setItem === 'function') {
      storage.setItem(memberKey(memberId), newest);
    }
    return newest;
  }

  function isLocked(item, access) {
    if (!item || (item.requires !== 'empire' && item.requires !== 'comps')) return false;
    return !(access && access.empire);
  }

  function safeLink(link) {
    if (!link || /^(javascript|data):/i.test(link) || link.indexOf('//') === 0) return '';
    if (/^https?:/i.test(link)) return '';
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*(#[A-Za-z0-9._-]*)?$/.test(link)) return '';
    return link;
  }

  function dateLabel(date) {
    var match = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return '';
    var month = Number(match[2]);
    var day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return '';
    return MONTHS[month - 1] + ' ' + day;
  }

  function cardHtml(raw, access) {
    var item = normalize(raw);
    var locked = isLocked(item, access);
    var href = locked ? '' : safeLink(item.link);
    var action = locked
      ? '<div class="whats-new-lock"><span class="module-status soon">Empire</span><p class="whats-new-lock-note">Included with Empire and FORGE Zero.</p><button type="button" class="whats-new-upgrade" data-whats-new-upgrade="1">Unlock Empire →</button></div>'
      : (href ? '<a class="whats-new-link" href="' + escapeHtml(href) + '">Open →</a>' : '');
    return '<article class="whats-new-card' + (locked ? ' is-locked' : '') + '" data-whats-new-id="' + escapeHtml(item.id) + '">' +
      '<div class="whats-new-date">' + escapeHtml(dateLabel(item.date)) + '</div>' +
      '<h3 class="whats-new-title">' + escapeHtml(item.title) + '</h3>' +
      '<p class="whats-new-body">' + escapeHtml(item.description) + '</p>' +
      action +
      '</article>';
  }

  function markup(items, access) {
    return prepare(items).map(function (item) { return cardHtml(item, access); }).join('');
  }

  function hide(section) {
    if (!section) return;
    section.hidden = true;
    if (section.style) section.style.display = 'none';
  }

  function show(section) {
    if (!section) return;
    section.hidden = false;
    if (section.style) section.style.display = '';
  }

  function mount(options) {
    var opts = options || {};
    var items = prepare(opts.items);
    var access = { empire: !!opts.empire };
    var section = opts.section;
    var newest = items.length ? items[0].id : '';
    if (!section || !items.length || isDismissed(opts.storage, opts.memberId, items)) {
      hide(section);
      return { visible: false, newestId: newest };
    }
    if (opts.grid) opts.grid.innerHTML = items.map(function (item) { return cardHtml(item, access); }).join('');
    if (opts.sub) opts.sub.textContent = items.length + (items.length === 1 ? ' update' : ' updates');
    show(section);
    var dismissBtn = opts.dismissButton;
    if (dismissBtn && typeof dismissBtn.addEventListener === 'function' && !dismissBtn._forgeWhatsNewBound) {
      dismissBtn._forgeWhatsNewBound = true;
      dismissBtn.addEventListener('click', function () {
        dismiss(opts.storage, opts.memberId, items);
        hide(section);
      });
    }
    var grid = opts.grid;
    if (grid && typeof grid.addEventListener === 'function' && !grid._forgeWhatsNewBound) {
      grid._forgeWhatsNewBound = true;
      grid.addEventListener('click', function (event) {
        var target = event && event.target;
        var button = target && target.closest ? target.closest('[data-whats-new-upgrade]') : null;
        if (!button) return;
        if (typeof opts.onUpgrade === 'function') opts.onUpgrade();
      });
    }
    return { visible: true, newestId: newest };
  }

  return {
    prepare: prepare,
    newestId: newestId,
    memberKey: memberKey,
    isDismissed: isDismissed,
    dismiss: dismiss,
    isLocked: isLocked,
    cardHtml: cardHtml,
    markup: markup,
    mount: mount,
  };
});
