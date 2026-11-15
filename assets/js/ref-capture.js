/* FORGE referral and sales-rep capture.
 * ?ref= persists in localStorage + a 90-day cookie (forge_ref).
 * ?rep= persists the same way, separately (forge_rep).
 * Ref policy: last-touch wins, EXCEPT a channel ref (CHANNEL_REFS, e.g. 'blog')
 * never overwrites a stored partner ref. Partner refs can replace anything;
 * channel refs can only replace an empty value or another channel ref.
 * Rep policy: last-touch wins. A new ?rep= replaces the stored slug. An empty
 * visit does not clear it. ?ref= and ?rep= never overwrite each other. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') {
    window.ForgeRef = api;
    try { api.capture(window); } catch (e) {}
    try { api.watchBookingLinks(window); } catch (e) {}
  }
})(this, function () {
  var KEY = 'forge_ref';
  var REP_KEY = 'forge_rep';
  var MAX_AGE = 90 * 24 * 60 * 60;
  var CHANNEL_REFS = ['blog'];

  function sanitize(v) {
    if (v == null) return '';
    return String(v).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 64);
  }
  function isChannel(ref) { return CHANNEL_REFS.indexOf(ref) !== -1; }
  function shouldReplace(stored, incoming) {
    if (!incoming) return false;
    if (!stored) return true;
    if (!isChannel(incoming)) return true;
    return isChannel(stored);
  }
  function readStoredKey(win, key) {
    var v = '';
    try { v = win.localStorage.getItem(key) || ''; } catch (e) {}
    if (!v) {
      try {
        var m = (win.document.cookie || '').match(new RegExp('(?:^|;\\s*)' + key + '=([^;]*)'));
        if (m) v = decodeURIComponent(m[1]);
      } catch (e) {}
    }
    return sanitize(v);
  }
  function storeKey(win, key, value) {
    try { win.localStorage.setItem(key, value); } catch (e) {}
    try { win.document.cookie = key + '=' + encodeURIComponent(value) + '; max-age=' + MAX_AGE + '; path=/; SameSite=Lax'; } catch (e) {}
  }
  function readStored(win) { return readStoredKey(win, KEY); }
  function store(win, ref) { storeKey(win, KEY, ref); }
  function urlParam(win, name) {
    try { return sanitize(new URLSearchParams(win.location.search).get(name)); } catch (e) { return ''; }
  }
  function urlRef(win) { return urlParam(win, 'ref'); }
  function capture(win) {
    var incoming = urlRef(win);
    if (incoming && shouldReplace(readStored(win), incoming)) store(win, incoming);
    var rep = urlParam(win, 'rep');
    if (rep) storeKey(win, REP_KEY, rep);
  }
  /* Signup pages: URL param first, else stored value, else ''.
   * The stored value lasts 90 days from the landing that set it, which is
   * longer than 30 days. Last-touch still applies between partner refs,
   * and between sales-rep slugs. */
  function getRef(win) { return urlRef(win) || readStored(win); }
  function getRep(win) { return urlParam(win, 'rep') || readStoredKey(win, REP_KEY); }

  /* Attach the stored ref and sales rep to a Memberstack checkout call.
   * Memberstack puts metadataForCheckout on the Stripe Checkout Session.
   * sales_rep is separate from metadata.rep, which FWN already uses for ?ref=.
   * Prices are unchanged. */
  function withCheckout(params, win) {
    var base = params || {};
    var target = win || (typeof window !== 'undefined' ? window : null);
    var ref = target ? getRef(target) : '';
    var salesRep = target ? getRep(target) : '';
    if (!ref && !salesRep) return base;
    var meta = Object.assign({}, base.metadataForCheckout);
    if (ref) meta.ref = ref;
    if (salesRep) meta.sales_rep = salesRep;
    return Object.assign({}, base, { metadataForCheckout: meta });
  }

  async function purchase(memberstack, params, win) {
    if (!memberstack || typeof memberstack.purchasePlansWithCheckout !== 'function') {
      throw new Error('Checkout is unavailable.');
    }
    var args = withCheckout(params, win);
    try {
      return await memberstack.purchasePlansWithCheckout(args);
    } catch (err) {
      if (!args.metadataForCheckout) throw err;
      if (typeof console !== 'undefined' && console.error) {
        console.error('FORGE checkout: retrying without ref metadata:', err);
      }
      return memberstack.purchasePlansWithCheckout(params || {});
    }
  }

  function pageBase(win) {
    try { if (win.location && win.location.href) return win.location.href; } catch (e) {}
    return 'https://forgedbyaris.com/';
  }
  function isBookingHref(href, win) {
    if (!href || href.charAt(0) === '#') return false;
    var url;
    try { url = new URL(href, pageBase(win)); } catch (e) { return false; }
    var path = url.pathname.replace(/\/+$/, '') || '/';
    if (url.hostname === 'api.leadconnectorhq.com' && path.indexOf('/widget/booking/') === 0) return true;
    var host = url.hostname.replace(/^www\./, '');
    var here = '';
    try { here = String((win.location && win.location.hostname) || '').replace(/^www\./, ''); } catch (e) {}
    return path === '/book' && (host === 'forgedbyaris.com' || (here && host === here));
  }
  function hrefWithRep(href, rep, win) {
    if (!rep || !href) return href;
    var url;
    try { url = new URL(href, pageBase(win)); } catch (e) { return href; }
    if (url.searchParams.get('rep')) return href;
    url.searchParams.set('rep', rep);
    if (href.indexOf('://') === -1 && href.charAt(0) === '/') return url.pathname + url.search + url.hash;
    return url.toString();
  }
  function decorateBookingLinks(win) {
    var rep = getRep(win);
    if (!rep || !win.document || !win.document.querySelectorAll) return;
    var links = win.document.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      var href = a.getAttribute('href');
      if (!isBookingHref(href, win)) continue;
      var next = hrefWithRep(href, rep, win);
      if (next !== href) a.setAttribute('href', next);
    }
  }
  function anchorFrom(node) {
    while (node && node.tagName !== 'A') node = node.parentNode;
    return node && node.tagName === 'A' ? node : null;
  }
  function watchBookingLinks(win) {
    if (!win || !win.document || win.document.__forgeRepBound) return;
    win.document.__forgeRepBound = true;
    function run() { try { decorateBookingLinks(win); } catch (e) {} }
    win.document.addEventListener('click', function (e) {
      var a = anchorFrom(e && e.target);
      if (!a) return;
      var href = a.getAttribute('href');
      if (!isBookingHref(href, win)) return;
      var next = hrefWithRep(href, getRep(win), win);
      if (next !== href) a.setAttribute('href', next);
    }, true);
    if (win.document.readyState === 'loading') {
      win.document.addEventListener('DOMContentLoaded', function () {
        run();
        setTimeout(run, 0);
      });
    } else {
      run();
      setTimeout(run, 0);
    }
  }

  return { KEY: KEY, REP_KEY: REP_KEY, CHANNEL_REFS: CHANNEL_REFS, MAX_AGE: MAX_AGE, sanitize: sanitize, isChannel: isChannel,
    shouldReplace: shouldReplace, capture: capture, getRef: getRef, getRep: getRep, readStored: readStored,
    withCheckout: withCheckout, purchase: purchase, isBookingHref: isBookingHref, hrefWithRep: hrefWithRep,
    decorateBookingLinks: decorateBookingLinks, watchBookingLinks: watchBookingLinks };
});
