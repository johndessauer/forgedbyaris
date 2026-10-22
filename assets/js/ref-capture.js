/* FORGE referral capture: persists ?ref= across navigation (localStorage + 90-day cookie).
 * Policy: last-touch wins, EXCEPT a channel ref (CHANNEL_REFS, e.g. 'blog') never
 * overwrites a stored rep ref. Rep refs can replace anything; channel refs can only
 * replace an empty value or another channel ref. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') { window.ForgeRef = api; try { api.capture(window); } catch (e) {} }
})(this, function () {
  var KEY = 'forge_ref';
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
  function readStored(win) {
    var v = '';
    try { v = win.localStorage.getItem(KEY) || ''; } catch (e) {}
    if (!v) {
      try {
        var m = (win.document.cookie || '').match(new RegExp('(?:^|;\\s*)' + KEY + '=([^;]*)'));
        if (m) v = decodeURIComponent(m[1]);
      } catch (e) {}
    }
    return sanitize(v);
  }
  function store(win, ref) {
    try { win.localStorage.setItem(KEY, ref); } catch (e) {}
    try { win.document.cookie = KEY + '=' + encodeURIComponent(ref) + '; max-age=' + MAX_AGE + '; path=/; SameSite=Lax'; } catch (e) {}
  }
  function urlRef(win) {
    try { return sanitize(new URLSearchParams(win.location.search).get('ref')); } catch (e) { return ''; }
  }
  function capture(win) {
    var incoming = urlRef(win);
    if (incoming && shouldReplace(readStored(win), incoming)) store(win, incoming);
  }
  /* Signup pages: URL ?ref first, else stored value, else ''.
   * The stored value lasts 90 days from the landing that set it, which is
   * longer than 30 days. Last-touch still applies between rep refs. */
  function getRef(win) { return urlRef(win) || readStored(win); }

  /* Attach the stored ref to a Memberstack checkout call. Memberstack puts
   * metadataForCheckout on the Stripe Checkout Session. Prices are unchanged. */
  function withCheckout(params, win) {
    var base = params || {};
    var target = win || (typeof window !== 'undefined' ? window : null);
    var ref = target ? getRef(target) : '';
    if (!ref) return base;
    return Object.assign({}, base, {
      metadataForCheckout: Object.assign({}, base.metadataForCheckout, { ref: ref })
    });
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

  return { KEY: KEY, CHANNEL_REFS: CHANNEL_REFS, MAX_AGE: MAX_AGE, sanitize: sanitize, isChannel: isChannel,
    shouldReplace: shouldReplace, capture: capture, getRef: getRef, readStored: readStored,
    withCheckout: withCheckout, purchase: purchase };
});
