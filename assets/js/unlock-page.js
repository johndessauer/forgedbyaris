/* Member book unlock pages. The education level check matches
 * education-badges.js: Rookie or higher, or Investor or higher.
 * The coaching booking URL is not in this file. The Investor page asks
 * the gated book-download function for it after the level check passes.
 */
(function () {
  var ORDER = ['rookie', 'investor', 'mogul'];
  var LABEL = { rookie: 'Rookie', investor: 'Investor', mogul: 'Mogul' };

  function meetsLevel(badges, minLevel) {
    var need = ORDER.indexOf(minLevel);
    if (need < 0) return false;
    return ORDER.some(function (tier, index) {
      return index >= need && badges && badges[tier];
    });
  }

  function waitForMemberstack(maxWaitMs) {
    return new Promise(function (resolve, reject) {
      var start = Date.now();
      (function check() {
        if (window.$memberstackDom && window.$memberstackDom.getCurrentMember) resolve(window.$memberstackDom);
        else if (Date.now() - start > (maxWaitMs || 6000)) reject(new Error('timeout'));
        else setTimeout(check, 100);
      })();
    });
  }

  async function init() {
    var book = document.body.getAttribute('data-book');
    var level = document.body.getAttribute('data-level');
    var filename = document.body.getAttribute('data-filename');
    var loading = document.getElementById('loading');
    var locked = document.getElementById('locked');
    var unlocked = document.getElementById('unlocked');
    var status = document.getElementById('download-status');
    var button = document.getElementById('download-btn');
    try {
      var memberstack = await waitForMemberstack();
      var memberRes = await memberstack.getCurrentMember();
      var member = memberRes && memberRes.data;
      if (!member) { window.location.href = '/login.html'; return; }
      var token = await memberstack.getMemberCookie();
      var gateRes = await fetch('/api/membership-check', {
        headers: { Authorization: 'Bearer ' + token },
      });
      var gate = {};
      try { gate = await gateRes.json(); } catch (err) { gate = {}; }
      if (gateRes.status === 403) {
        window.location.href = gate.paymentIssue ? '/billing.html?payment=failed' : '/signup.html';
        return;
      }
      if (!gateRes.ok || !gate.active) { window.location.href = '/login.html'; return; }

      var listRes = await fetch('/api/education-data?action=list', {
        headers: { Authorization: 'Bearer ' + token },
      });
      if (!listRes.ok) throw new Error('badges');
      var list = await listRes.json();
      var badges = list.badges || {};
      loading.hidden = true;
      if (!meetsLevel(badges, level)) {
        locked.hidden = false;
        return;
      }
      unlocked.hidden = false;

      var bonus = document.getElementById('ira-bonus');
      if (bonus && window.ForgeLevelUnlocks && typeof window.ForgeLevelUnlocks.renderUnlock === 'function') {
        window.ForgeLevelUnlocks.renderUnlock(bonus, 'directed-ira-consult', window.localStorage);
      }

      var callButton = document.getElementById('coaching-book-btn');
      if (callButton && book === 'apartment-confidential') {
        try {
          var callRes = await fetch('/api/book-download?book=apartment-confidential&part=coaching', {
            headers: { Authorization: 'Bearer ' + token },
          });
          if (callRes.ok) {
            var callData = await callRes.json();
            if (callData && callData.url) {
              var link = document.createElement('a');
              link.href = callData.url;
              link.target = '_blank';
              link.rel = 'noopener';
              link.className = 'book-call';
              link.textContent = 'Book your call';
              callButton.replaceWith(link);
            }
          }
        } catch (err) { /* the button stays disabled if the link cannot be loaded */ }
      }

      if (!button) return;
      button.addEventListener('click', async function () {
        button.disabled = true;
        if (status) status.textContent = 'Preparing your download…';
        try {
          var res = await fetch('/api/book-download?book=' + encodeURIComponent(book), {
            headers: { Authorization: 'Bearer ' + token },
          });
          var type = res.headers.get('content-type') || '';
          if (!res.ok || type.indexOf('application/pdf') === -1) {
            var errBody = {};
            try { errBody = await res.json(); } catch (err) { errBody = {}; }
            if (status) status.textContent = errBody.error || 'This book is not available yet.';
            button.disabled = false;
            return;
          }
          var blob = await res.blob();
          var url = URL.createObjectURL(blob);
          var link = document.createElement('a');
          link.href = url;
          link.download = filename || 'book.pdf';
          document.body.appendChild(link);
          link.click();
          link.remove();
          URL.revokeObjectURL(url);
          if (status) status.textContent = 'Your download should start in a moment.';
          button.disabled = false;
        } catch (err) {
          if (status) status.textContent = 'The download did not start. Try again in a moment.';
          button.disabled = false;
        }
      });
    } catch (err) {
      if (loading) loading.textContent = 'Could not check your ' + (LABEL[level] || 'level') + ' status. Refresh the page to try again.';
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
