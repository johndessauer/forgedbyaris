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
 
  initArisDemo();
});
 
// ===================================================================
// Animated ARIS demo panel (homepage hero) — types the question and
// reply, counts up the stats, holds, then loops. The HTML already
// contains the real final copy so a no-JS or reduced-motion visitor
// always sees the complete, correct panel with no animation.
// ===================================================================
function initArisDemo() {
  var panel = document.getElementById('arisDemo');
  if (!panel) return;
 
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) return;
 
  var questionBubble = document.getElementById('arisQuestion');
  var replyBubble = document.getElementById('arisReply');
  var statsWrap = document.getElementById('arisStats');
  if (!questionBubble || !replyBubble || !statsWrap) return;
  var stats = statsWrap.querySelectorAll('.aris-stat__num');
  var statEls = statsWrap.querySelectorAll('.aris-stat');
 
  // Capture the real copy once, before anything is touched.
  var questionText = questionBubble.querySelector('.aris-type-text').textContent;
  var replyText = replyBubble.querySelector('.aris-type-text').textContent;
 
  function formatStat(el, value) {
    var prefix = el.getAttribute('data-prefix') || '';
    var suffix = el.getAttribute('data-suffix') || '';
    var decimals = parseInt(el.getAttribute('data-decimals') || '0', 10);
    return prefix + value.toFixed(decimals) + suffix;
  }
 
  function typeInto(bubble, text, speed, callback) {
    var target = bubble.querySelector('.aris-type-text');
    var cursor = bubble.querySelector('.aris-cursor');
    var i = 0;
    target.textContent = '';
    if (cursor) cursor.classList.add('is-active');
    var timer = setInterval(function () {
      i++;
      target.textContent = text.slice(0, i);
      if (i >= text.length) {
        clearInterval(timer);
        if (cursor) cursor.classList.remove('is-active');
        if (callback) setTimeout(callback, 400);
      }
    }, speed);
  }
 
  function countUp(el, duration) {
    var target = parseFloat(el.getAttribute('data-value'));
    var start = null;
    function step(ts) {
      if (!start) start = ts;
      var progress = Math.min((ts - start) / duration, 1);
      el.textContent = formatStat(el, target * progress);
      if (progress < 1) requestAnimationFrame(step);
      else el.textContent = formatStat(el, target);
    }
    requestAnimationFrame(step);
  }
 
  function resetPanel() {
    [questionBubble, replyBubble].forEach(function (b) {
      b.classList.add('aris-anim-hidden');
      var t = b.querySelector('.aris-type-text');
      if (t) t.textContent = '';
      var dots = b.querySelector('.aris-typing-dots');
      if (dots) dots.classList.remove('is-active');
    });
    statEls.forEach(function (el) { el.classList.add('aris-anim-hidden'); });
    stats.forEach(function (el) { el.textContent = formatStat(el, 0); });
  }
 
  function runCycle() {
    resetPanel();
    setTimeout(function () {
      questionBubble.classList.remove('aris-anim-hidden');
      typeInto(questionBubble, questionText, 32, function () {
        replyBubble.classList.remove('aris-anim-hidden');
        var dots = replyBubble.querySelector('.aris-typing-dots');
        if (dots) dots.classList.add('is-active');
        setTimeout(function () {
          if (dots) dots.classList.remove('is-active');
          typeInto(replyBubble, replyText, 16, function () {
            statEls.forEach(function (el) { el.classList.remove('aris-anim-hidden'); });
            stats.forEach(function (el) { countUp(el, 900); });
            setTimeout(runCycle, 4200);
          });
        }, 900);
      });
    }, 500);
  }
 
  runCycle();
}
 
