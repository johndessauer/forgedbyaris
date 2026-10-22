/* FWN checkout pages. Creates the Memberstack account, then asks the
 * server to open Stripe Checkout. The server owns prices and metadata. */
(function () {
  var PACKAGE = document.body.getAttribute('data-fwn-package') || '';
  var BUTTON_LABEL = 'Continue to Checkout';

  function query() { return new URLSearchParams(window.location.search); }

  function srcValue() {
    var src = String(query().get('src') || '').toLowerCase();
    return src === 'fwn-virtual' || src === 'fwn-raleigh' ? src : '';
  }

  function soldByValue() {
    var sold = String(query().get('sold_by') || '').toLowerCase();
    return sold === 'cart' || sold === 'john' || sold === 'rep' ? sold : '';
  }

  function repValue() {
    if (window.ForgeRef && window.ForgeRef.getRef) return window.ForgeRef.getRef(window) || '';
    return String(query().get('ref') || '');
  }

  function showError(msg) {
    var el = document.getElementById('error-msg');
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
  }

  function waitForMemberstack() {
    return new Promise(function (resolve, reject) {
      var start = Date.now();
      (function check() {
        if (window.$memberstackDom && window.$memberstackDom.getCurrentMember) return resolve(window.$memberstackDom);
        if (Date.now() - start > 8000) return reject(new Error('Account service is still loading. Please try again.'));
        setTimeout(check, 50);
      })();
    });
  }

  function isEmailTakenError(err) {
    var code = String((err && err.code) || '').toLowerCase();
    var msg = String((err && err.message) || '').toLowerCase();
    return (code.indexOf('email') !== -1 && /(exist|taken|in-use|use|registered)/.test(code)) ||
      /already (exists|in use|taken|registered)|already has an account|email.*(taken|exists|in use)/.test(msg);
  }

  function friendlySignupError(err) {
    if (isEmailTakenError(err)) return 'An account with this email already exists. Please sign in instead.';
    return (err && err.message) ? err.message : 'Something went wrong. Please try again.';
  }

  function hasActivePaidPlan(member) {
    return ((member && member.planConnections) || []).some(function (pc) {
      return (pc.status === 'ACTIVE' || pc.status === 'TRIALING') && pc.payment && pc.payment.priceId;
    });
  }

  async function handleCheckout() {
    var firstName = document.getElementById('first-name').value.trim();
    var lastName = document.getElementById('last-name').value.trim();
    var email = document.getElementById('email').value.trim();
    var phone = document.getElementById('phone').value.trim();
    var password = document.getElementById('password').value;
    var btn = document.getElementById('checkout-btn');
    var errEl = document.getElementById('error-msg');
    errEl.style.display = 'none';

    if (!srcValue()) {
      showError('This checkout link needs a source. Open it with src=fwn-virtual or src=fwn-raleigh.');
      return;
    }
    if (!firstName || !lastName) { showError('Please enter your first and last name.'); return; }
    if (!email) { showError('Please enter your email address.'); return; }
    if (phone) {
      var digits = phone.replace(/\D/g, '');
      if (digits.length < 7 || digits.length > 15) {
        showError('Enter a valid phone number, or leave phone blank.');
        return;
      }
    }
    if (!password || password.length < 8) { showError('Password must be at least 8 characters.'); return; }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Creating your account...';

    var resetBtn = function () {
      btn.disabled = false;
      btn.innerHTML = BUTTON_LABEL;
    };

    try {
      var memberstack = await waitForMemberstack();
      var member = null;
      var existing = await memberstack.getCurrentMember();
      var existingMember = existing && existing.data;
      if (existingMember) {
        var existingEmail = String((existingMember.auth && existingMember.auth.email) || existingMember.email || '').toLowerCase();
        if (existingEmail && existingEmail === email.toLowerCase()) member = existingMember;
        else await memberstack.logout();
      }

      var referralSource = repValue();
      if (!member) {
        try {
          var signup = await memberstack.signupMemberEmailPassword({
            email: email,
            password: password,
            customFields: {
              'first-name': firstName,
              'last-name': lastName,
              'full-name': firstName + ' ' + lastName,
              'plan-type': 'FWN ' + PACKAGE,
              ...(referralSource ? { 'referral-source': referralSource } : {})
            }
          });
          var signupData = signup && signup.data;
          member = (signupData && signupData.member) || signupData || null;
        } catch (signupErr) {
          if (!isEmailTakenError(signupErr)) throw signupErr;
          btn.innerHTML = '<span class="spinner"></span>Finding your account...';
          try {
            var login = await memberstack.loginMemberEmailPassword({ email: email, password: password });
            var loginData = login && login.data;
            member = (loginData && loginData.member) || loginData || null;
          } catch (loginErr) {
            console.error('FWN checkout: account exists, login failed:', loginErr);
            showError('An account with this email already exists, but that password does not match it. Enter the password used when the account was first created, or reset it from the Sign In page.');
            resetBtn();
            return;
          }
        }
      }

      if (hasActivePaidPlan(member)) {
        window.location.href = '/dashboard.html';
        return;
      }

      btn.innerHTML = '<span class="spinner"></span>Redirecting to payment...';
      var response = await fetch('/api/fwn-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          package: PACKAGE,
          email: email,
          name: firstName + ' ' + lastName,
          phone: phone,
          memberId: member && member.id,
          src: srcValue(),
          sold_by: soldByValue(),
          ref: referralSource,
          cancelPath: window.location.pathname + window.location.search
        })
      });
      var data = {};
      try { data = await response.json(); } catch (parseErr) { data = {}; }
      if (!response.ok) throw new Error(data.error || 'Checkout could not be started.');
      if (!data.url || !/^https:\/\/checkout\.stripe\.com\//.test(data.url)) {
        throw new Error('Checkout did not return a payment link.');
      }
      window.location.href = data.url;
    } catch (err) {
      console.error('FWN checkout error:', err);
      showError(friendlySignupError(err));
      resetBtn();
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('checkout-btn');
    if (!srcValue()) {
      showError('This checkout link needs a source. Open it with src=fwn-virtual or src=fwn-raleigh.');
      if (btn) btn.disabled = true;
    }
    if (btn) btn.addEventListener('click', handleCheckout);
  });
})();
