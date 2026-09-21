// ===================================================================
// FORGE — shared site script
// ===================================================================
 
// TODO(tomorrow): replace this placeholder with the real URL.
// WEBINAR_URL  -> John will send the GHL webinar-registration link.
window.FORGE_LINKS = {
  WEBINAR_URL: '#webinar-link-pending',
  DEMO_URL: 'https://api.leadconnectorhq.com/widget/bookings/chris-ciampa-personal-calendar-lyxn1ck2j'
};

// Public announcement bar (index.html only). Edit this object to change
// the message shown above the nav — bump `id` whenever the text changes
// so a visitor who dismissed an earlier banner sees the new one. The CTA
// itself is a static data-cta="demo" element in the HTML (reuses the
// same FORGE_LINKS href + Meta Pixel event as every other CTA on the
// site) — this object only controls the wording and whether it shows.
window.FORGE_ANNOUNCEMENT = {
  enabled: true,
  id: 'group-coaching-oct15',
  text: 'LIVE Group Coaching starts October 15, 2026.',
  ctaLabel: 'Reserve Your Spot'
};

function initAnnouncementBar() {
  var cfg = window.FORGE_ANNOUNCEMENT;
  var bar = document.getElementById('announcement-bar');
  if (!bar || !cfg || !cfg.enabled) return;
  try {
    if (window.localStorage && localStorage.getItem('forge_announcement_dismissed') === cfg.id) return;
  } catch (e) {}
  var textEl = document.getElementById('announcementText');
  var ctaEl = document.getElementById('announcementCta');
  if (textEl) textEl.textContent = cfg.text;
  if (ctaEl) ctaEl.textContent = cfg.ctaLabel + ' \u2192';
  bar.classList.add('announcement-bar--visible');
  var closeBtn = document.getElementById('announcementClose');
  if (closeBtn) {
    closeBtn.addEventListener('click', function () {
      bar.classList.remove('announcement-bar--visible');
      try { if (window.localStorage) localStorage.setItem('forge_announcement_dismissed', cfg.id); } catch (e) {}
    });
  }
}
 
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
  initAnnouncementBar();
  initArisIntro();
  initSalesChat();
  initGhlWidgetOverride();
});

// ===================================================================
// "Hear From ARIS" intro panel (About ARIS page) — plays a pre-recorded
// ARIS voice clip introducing himself, then reveals a Yes/No prompt to
// route into the demo booking CTA. Caption text is real, final copy in
// the base HTML (not injected by JS), so it reads fine even if the audio
// fails to load or JS never runs the reveal step.
// ===================================================================
function initArisIntro() {
  var btn = document.getElementById('arisIntroBtn');
  var panel = document.getElementById('arisIntroPanel');
  if (!btn || !panel) return;

  var audio = document.getElementById('arisIntroAudio');
  var ask = document.getElementById('arisIntroAsk');
  var noBtn = document.getElementById('arisIntroNo');
  var decline = document.getElementById('arisIntroDecline');

  function revealAsk() {
    if (ask) ask.classList.remove('aris-anim-hidden');
  }

  btn.addEventListener('click', function () {
    panel.hidden = false;
    btn.hidden = true;
    if (audio && audio.getAttribute('src')) {
      audio.play().catch(function () {
        // Playback blocked/failed for any reason — don't leave the visitor
        // stuck reading a panel with no next step.
        revealAsk();
      });
    } else {
      revealAsk();
    }
  });

  if (audio) {
    audio.addEventListener('ended', revealAsk);
    audio.addEventListener('error', revealAsk);
  }

  if (noBtn) {
    noBtn.addEventListener('click', function () {
      if (ask) ask.classList.add('aris-anim-hidden');
      if (decline) decline.hidden = false;
    });
  }
}
 
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
 
// ===================================================================
// Public sales chat widget (homepage) — ARIS acting as a knowledgeable
// frontline sales rep. Streams from /api/aris-stream with promptKey
// 'sales' and renders an inline webinar/demo CTA button when ARIS
// suggests one via the <<<CTA_SUGGEST{...}CTA_SUGGEST>>> marker.
// ===================================================================
function initSalesChat() {
  var root = document.getElementById('salesChat');
  var toggle = document.getElementById('salesChatToggle');
  var panel = document.getElementById('salesChatPanel');
  var closeBtn = document.getElementById('salesChatClose');
  var messagesEl = document.getElementById('salesChatMessages');
  var input = document.getElementById('salesChatInput');
  var sendBtn = document.getElementById('salesChatSend');
  if (!root || !toggle || !panel || !closeBtn || !messagesEl || !input || !sendBtn) return;

  var history = [];
  var sending = false;
  var opened = false;

  function escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function formatMini(text) {
    return escapeHtml(text)
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n\n/g, '<br><br>')
      .replace(/\n/g, '<br>');
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function appendMsg(role, text) {
    var div = document.createElement('div');
    div.className = 'sales-chat__msg ' + role;
    div.innerHTML = formatMini(text);
    messagesEl.appendChild(div);
    scrollToBottom();
    return div;
  }

  function appendCta(cta) {
    var wrap = document.createElement('div');
    wrap.className = 'sales-chat__cta';
    var a = document.createElement('a');
    a.className = 'sales-chat__cta-btn';
    a.target = '_blank';
    a.rel = 'noopener';
    if (cta === 'demo') {
      a.href = window.FORGE_LINKS.DEMO_URL;
      a.textContent = 'Book a 1:1 Demo';
      a.addEventListener('click', function () {
        if (window.fbq) fbq('track', 'Schedule', { content_name: 'demo_booking' });
      });
    } else {
      a.href = window.FORGE_LINKS.WEBINAR_URL;
      a.textContent = 'Register for the Webinar';
      a.addEventListener('click', function () {
        if (window.fbq) fbq('track', 'Lead', { content_name: 'webinar_registration' });
      });
    }
    wrap.appendChild(a);
    messagesEl.appendChild(wrap);
    scrollToBottom();
  }

  function showTyping() {
    var div = document.createElement('div');
    div.className = 'sales-chat__typing';
    div.id = 'salesChatTyping';
    div.innerHTML = '<span></span><span></span><span></span>';
    messagesEl.appendChild(div);
    scrollToBottom();
  }

  function hideTyping() {
    var t = document.getElementById('salesChatTyping');
    if (t) t.remove();
  }

  function openPanel() {
    panel.hidden = false;
    root.classList.add('is-open');
    if (!opened) {
      opened = true;
      appendMsg('aris', "Hey — I'm ARIS, the AI behind FORGE. Ask me anything about the platform, or how it stacks up against a coaching program.");
    }
    input.focus();
  }

  function closePanel() {
    panel.hidden = true;
    root.classList.remove('is-open');
  }

  toggle.addEventListener('click', openPanel);
  closeBtn.addEventListener('click', closePanel);

  function setSending(state) {
    sending = state;
    input.disabled = state;
    sendBtn.disabled = state;
  }

  async function sendMessage() {
    var text = input.value.trim();
    if (!text || sending) return;
    input.value = '';
    appendMsg('user', text);
    history.push({ role: 'user', content: text });
    setSending(true);
    showTyping();

    try {
      var res = await fetch('/api/aris-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 700,
          promptKey: 'sales',
          messages: history
        })
      });

      if (!res.ok) {
        hideTyping();
        appendMsg('aris', "Something went wrong on my end — try that again in a moment.");
        setSending(false);
        return;
      }

      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';
      var accumulatedText = '';
      var bubble = null;

      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        var events = buffer.split('\n\n');
        buffer = events.pop();

        for (var i = 0; i < events.length; i++) {
          var evt = events[i];
          var dataLine = evt.split('\n').find(function (l) { return l.startsWith('data:'); });
          if (!dataLine) continue;
          var jsonStr = dataLine.slice(5).trim();
          if (!jsonStr) continue;
          var parsed;
          try { parsed = JSON.parse(jsonStr); } catch (e) { continue; }

          if (parsed.type === 'content_block_delta' && parsed.delta && parsed.delta.type === 'text_delta') {
            if (!bubble) {
              hideTyping();
              bubble = appendMsg('aris', '');
            }
            accumulatedText += parsed.delta.text;
            var displayText = accumulatedText;
            var markerIdx = displayText.indexOf('<<<CTA_SUGGEST');
            if (markerIdx !== -1) displayText = displayText.slice(0, markerIdx);
            bubble.innerHTML = formatMini(displayText);
            scrollToBottom();
          }
        }
      }

      hideTyping();
      var reply = accumulatedText || "I didn't catch that — could you try again?";
      var cta = null;
      var ctaMatch = reply.match(/<<<CTA_SUGGEST\s*([\s\S]*?)\s*CTA_SUGGEST>>>/);
      if (ctaMatch) {
        try { cta = JSON.parse(ctaMatch[1]).cta; } catch (e) { cta = null; }
        reply = reply.replace(/<<<CTA_SUGGEST[\s\S]*?CTA_SUGGEST>>>/g, '').trim();
      }

      if (bubble) {
        bubble.innerHTML = formatMini(reply);
      } else {
        appendMsg('aris', reply);
      }
      history.push({ role: 'assistant', content: reply });

      if (cta === 'webinar' || cta === 'demo') {
        appendCta(cta);
      }
    } catch (err) {
      hideTyping();
      appendMsg('aris', "Something went wrong on my end — try that again in a moment.");
    }

    setSending(false);
    input.focus();
  }

  sendBtn.addEventListener('click', sendMessage);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendMessage();
    }
  });
}

// ===================================================================
// GHL chat widget - hide the default floating launcher (it collided
// visually with the ARIS sales chat button) and let a nav "Contact"
// link open the same widget instead. GHL's launcher lives inside a
// closed-off web component's shadow DOM (<chat-widget> -> .lc_text-widget
// -> button.lc_text-widget--bubble), so plain CSS from our stylesheet
// can't reach it - this has to run in JS. Opening the widget is done
// via GHL's own window.leadConnector.chatWidget.openWidget() call.
// ===================================================================
function initGhlWidgetOverride() {
  var contactLink = document.getElementById('navContactChat');
  if (contactLink) {
    contactLink.addEventListener('click', function (e) {
      e.preventDefault();
      if (window.leadConnector && window.leadConnector.chatWidget && typeof window.leadConnector.chatWidget.openWidget === 'function') {
        window.leadConnector.chatWidget.openWidget();
      }
    });
  }

  function hideLauncher(host) {
    if (!host || !host.shadowRoot) return false;
    var hidAny = false;
    var bubbleWrap = host.shadowRoot.querySelector('.lc_text-widget--bubble');
    if (bubbleWrap) {
      bubbleWrap.style.setProperty('display', 'none', 'important');
      hidAny = true;
    }
    // GHL's automatic proactive greeting card (the "Hi there! Have a
    // question?" popup) is a separate element from the bubble launcher
    // above and shows itself a few seconds after load - it was colliding
    // with the ARIS sales chat button the same way the bubble used to.
    var promptCard = host.shadowRoot.querySelector('.lc_text-widget--prompt');
    if (promptCard) {
      promptCard.style.setProperty('display', 'none', 'important');
      hidAny = true;
    }
    return hidAny;
  }

  function watch(host) {
    hideLauncher(host);
    if (host.shadowRoot) {
      new MutationObserver(function () { hideLauncher(host); })
        .observe(host.shadowRoot, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
    }
  }

  var existing = document.querySelector('chat-widget');
  if (existing) {
    watch(existing);
  } else {
    var bodyWatcher = new MutationObserver(function () {
      var host = document.querySelector('chat-widget');
      if (host) {
        bodyWatcher.disconnect();
        watch(host);
      }
    });
    bodyWatcher.observe(document.body, { childList: true, subtree: true });
  }
                                   }
