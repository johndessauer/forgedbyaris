/* Reads member_profiles.preferences the way the profile page saves them.
 * A missing voice or nudge setting keeps today's behavior: spoken replies
 * stay on, and CRM follow-ups use the usual schedule. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof root !== 'undefined') root.ForgePreferences = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  var NUDGE_VALUES = ['frequent', 'default', 'relaxed'];
  var MARKET_MAX = 80;

  function voiceRepliesOn(preferences) {
    return !(preferences && preferences.voiceReplies === false);
  }

  function defaultMarket(preferences) {
    if (!preferences || typeof preferences.defaultMarket !== 'string') return '';
    return preferences.defaultMarket.replace(/\s+/g, ' ').trim().slice(0, MARKET_MAX);
  }

  function nudgeSensitivity(preferences) {
    var value = preferences && preferences.nudgeSensitivity;
    return NUDGE_VALUES.indexOf(value) !== -1 ? value : 'default';
  }

  function load(token) {
    if (!token || typeof fetch !== 'function') return Promise.resolve({});
    return fetch('/api/profile-data?action=get', {
      headers: { Authorization: 'Bearer ' + token },
    }).then(function (res) {
      if (!res.ok) throw new Error('Could not load preferences');
      return res.json();
    }).then(function (body) {
      var prefs = body && body.profile && body.profile.preferences;
      return prefs && typeof prefs === 'object' && !Array.isArray(prefs) ? prefs : {};
    });
  }

  return {
    voiceRepliesOn: voiceRepliesOn,
    defaultMarket: defaultMarket,
    nudgeSensitivity: nudgeSensitivity,
    load: load,
  };
});
