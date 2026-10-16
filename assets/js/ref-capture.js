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
  /* Signup pages: URL ?ref first, else stored value, else ''. */
  function getRef(win) { return urlRef(win) || readStored(win); }

  return { KEY: KEY, CHANNEL_REFS: CHANNEL_REFS, sanitize: sanitize, isChannel: isChannel,
    shouldReplace: shouldReplace, capture: capture, getRef: getRef, readStored: readStored };
});
