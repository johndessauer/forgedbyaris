// ===================================================================
// FORGE — shared site script
// ===================================================================

// TODO(tomorrow): replace these two placeholders with the real URLs.
// WEBINAR_URL  -> John will send the GHL webinar-registration link.
// DEMO_URL     -> "Book a 1:1 Demo" routes to a GHL calendar appointment
//                 with Chris. Replace with that calendar's booking link.
window.FORGE_LINKS = {
  WEBINAR_URL: '#webinar-link-pending',
  DEMO_URL: '#demo-link-pending'
};

document.addEventListener('DOMContentLoaded', function () {
  // Wire every CTA marked data-cta to the right placeholder link + pixel event.
  document.querySelectorAll('[data-cta]').forEach(function (el) {
    var kind = el.getAttribute('data-cta');
    if (kind === 'webinar') {
      el.setAttribute('href', window.FORGE_LINKS.WEBINAR_URL);
      el.addEventListener('click', function () {
        if (window.fbq) fbq('track', 'Lead', { content_name: 'webinar_registration' });
      });
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
