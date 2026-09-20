// ===================================================================
// FORGE — shared site script
// ===================================================================

// WEBINAR_URL is null until John sends the real GHL registration link
// for the Sept 17 webinar — until then, webinar CTAs render disabled
// with a "coming soon" label instead of linking anywhere.
// DEMO_URL routes "Book a 1:1 Demo" to Chris Ciampa's GHL calendar.
window.FORGE_LINKS = {
  WEBINAR_URL: null,
  DEMO_URL: 'https://api.leadconnectorhq.com/widget/bookings/chris-ciampa-personal-calendar-lyxn1ck2j'
};

document.addEventListener('DOMContentLoaded', function () {
  // Wire every CTA marked data-cta to the right link + pixel event.
  document.querySelectorAll('[data-cta]').forEach(function (el) {
    var kind = el.getAttribute('data-cta');
    if (kind === 'webinar') {
      if (window.FORGE_LINKS.WEBINAR_URL) {
        el.setAttribute('href', window.FORGE_LINKS.WEBINAR_URL);
        el.addEventListener('click', function () {
          if (window.fbq) fbq('track', 'Lead', { content_name: 'webinar_registration' });
        });
      } else {
        // No registration link yet — render as a disabled "coming soon" button.
        el.classList.add('btn--disabled');
        el.setAttribute('aria-disabled', 'true');
        el.removeAttribute('href');
        el.addEventListener('click', function (e) { e.preventDefault(); });
      }
    } else if (kind === 'demo') {
      el.setAttribute('href', window.FORGE_LINKS.DEMO_URL);
      el.addEventListener('click', function () {
        if (window.fbq) fbq('track', 'Schedule', { content_name: 'demo_booking' });
      });
    }
  });

  // Mobile nav toggle
  var toggle = document.querySelector('.site-nav__toggle');
  var links = document.querySelector('.site-nav__links');
  if (toggle && links) {
    toggle.addEventListener('click', function () {
      links.classList.toggle('open');
      var expanded = links.classList.contains('open');
      toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    });
  }
});
