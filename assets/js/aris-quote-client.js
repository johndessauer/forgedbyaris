/* How Capital Radar reads /api/aris-quote failures.
 * A missing member token is not an ARIS outage: the page used to send
 * "Bearer null" and show "ARIS unavailable" for the 401 that produces. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof root !== 'undefined') root.ArisQuoteClient = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  function usableMemberToken(token) {
    if (typeof token !== 'string') return '';
    var trimmed = token.trim();
    if (!trimmed || trimmed === 'null' || trimmed === 'undefined') return '';
    return trimmed;
  }

  function errorFromQuoteResponse(status, body) {
    var error = body && typeof body.error === 'string' ? body.error : '';
    if (status === 401 || error === 'session_expired') return 'Please log in again.';
    return 'ARIS unavailable (HTTP ' + status + '). Try again.';
  }

  return {
    usableMemberToken: usableMemberToken,
    errorFromQuoteResponse: errorFromQuoteResponse
  };
});
