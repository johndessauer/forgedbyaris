/* FORGE webinar checkout pages. Not FWN. Creates the Memberstack account,
 * then opens Memberstack checkout for the single package price. That price
 * is a $97/month subscription with the setup fee already enabled, so the
 * first charge is the full tier. This script never adds a second price. */
(function () {
  var PACKAGE = document.body.getAttribute('data-webinar-package') || '';
  var BUTTON_LABEL = 'Continue to Checkout';
  var FWN_SOURCES = { 'fwn-virtual': true, 'fwn-raleigh': true };

  function query() { return new URLSearchParams(window.location.search); }

  function sanitize(value) {
    if (window.ForgeRef && window.ForgeRef.sanitize) return window.ForgeRef.sanitize(value);
    if (value == null) return '';
    return String(value).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 64);
  }

  function srcValue() {
    return sanitize(query().get('src'));
  }

  function srcError() {
    var src = srcValue();
    if (!src) return 'This checkout link needs a source. Open it with src set.';
    if (FWN_SOURCES[src]) return 'This page is not an FWN checkout. FWN enrollments use the FWN link.';
    return '';
  }

  function soldByValue() {
    var sold = String(query().get('sold_by') || '').toLowerCase();
    return sold === 'cart' || sold === 'john' || sold === 'rep' ? sold : '';
  }

  function repValue() {
    if (window.ForgeRef && window.ForgeRef.getRef) return window.ForgeRef.getRef(window) || '';
    return sanitize(query().get('ref'));
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

  async function saveWebinarAttribution(memberstack, webinar) {
    if (!memberstack.updateMemberJSON) return;
    var existing = {};
    try {
      if (memberstack.getMemberJSON) {
        var current = await memberstack.getMemberJSON();
        existing = (current && current.data) || {};
      }
    } catch (err) {
      existing = {};
    }
    try {
      await memberstack.updateMemberJSON({ json: Object.assign({}, existing, { webinar: webinar }) });
    } catch (err) {
      console.error('Webinar checkout: could not save attribution on the member:', err);
    }
  }

  function checkoutUrl(result) {
    var data = result && result.data;
    var url = (data && (data.url || data.checkoutUrl)) || (result && result.url) || '';
    return typeof url === 'string' && /^https:\/\//.test(url) ? url : '';
  }

  async function openMemberstackCheckout(memberstack, data) {
    var checkout = data.checkout || {};
    var success = checkout.successURL || (window.location.origin + '/webinar/thank-you');
    var cancel = checkout.cancelURL || window.location.href;
    var params = {
      priceId: data.priceId,
      successURL: success,
      cancelURL: cancel,
      successUrl: success,
      cancelUrl: cancel,
      autoRedirect: false
    };
    if (checkout.metadataForCheckout) params.metadataForCheckout = checkout.metadataForCheckout;
    if (window.ForgeRef && window.ForgeRef.withCheckout) params = window.ForgeRef.withCheckout(params, window);
    var result;
    try {
      result = await memberstack.purchasePlansWithCheckout(params);
    } catch (err) {
      if (!params.metadataForCheckout) throw err;
      var refOnly = params.metadataForCheckout.ref;
      console.error('Webinar checkout: retrying with ref only:', err);
      if (refOnly) params.metadataForCheckout = { ref: refOnly };
      else delete params.metadataForCheckout;
      try {
        result = await memberstack.purchasePlansWithCheckout(params);
      } catch (err2) {
        if (!params.metadataForCheckout) throw err2;
        console.error('Webinar checkout: retrying without checkout metadata:', err2);
        delete params.metadataForCheckout;
        result = await memberstack.purchasePlansWithCheckout(params);
      }
    }
    if (result && result.error) throw result.error;
    var url = checkoutUrl(result);
    if (!url) throw new Error('Checkout did not return a payment link.');
    window.location.href = url;
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

    var sourceError = srcError();
    if (sourceError) { showError(sourceError); return; }
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
              'plan-type': 'FORGE Webinar ' + PACKAGE,
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
            console.error('Webinar checkout: account exists, login failed:', loginErr);
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
      var response = await fetch('/api/webinar-checkout', {
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
      if (!data.priceId || String(data.priceId).indexOf('prc_') !== 0) {
        throw new Error('Checkout did not return a payment price.');
      }
      await saveWebinarAttribution(memberstack, {
        name: firstName + ' ' + lastName,
        email: email,
        phone: phone,
        package: data.package || PACKAGE,
        lead_source: data.lead_source,
        sold_by: data.sold_by,
        rep: data.rep,
        planId: data.planId || ''
      });
      await openMemberstackCheckout(memberstack, data);
    } catch (err) {
      console.error('Webinar checkout error:', err);
      showError(friendlySignupError(err));
      resetBtn();
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('checkout-btn');
    var sourceError = srcError();
    if (sourceError) {
      showError(sourceError);
      if (btn) btn.disabled = true;
    }
    if (btn) btn.addEventListener('click', handleCheckout);
  });
})();
