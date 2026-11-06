// ===================================================================
// FORGE — shared site script
// ===================================================================
 
// First-party registration page. Not a GHL/Keap form, and not /webinar/join
// (that path is the attendance redirect for reminder links).
window.FORGE_LINKS = {
  WEBINAR_URL: '/webinar/register?src=site',
  DEMO_URL: 'https://api.leadconnectorhq.com/widget/booking/JlM6SoqbqCKmDois6PHx'
};

// Homepage promo bars (index.html). Each row dismisses on its own id, stored
// separately from the retired single-banner key so a visitor who closed the
// expired October coaching bar still sees these. Webinar wording is filled
// from assets/js/webinar-schedule.js, then aligned to GET /api/webinar-register
// when that pin is an approved date that has not ended.
var ANNOUNCEMENT_DISMISS_KEY = 'forge_announcement_dismissed_ids';

function readDismissedAnnouncements() {
  try {
    if (!window.localStorage) return [];
    var parsed = JSON.parse(localStorage.getItem(ANNOUNCEMENT_DISMISS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function initAnnouncementBar() {
  var bar = document.getElementById('announcement-bar');
  if (!bar) return;
  var dismissed = readDismissedAnnouncements();
  bar.querySelectorAll('[data-announcement-id]').forEach(function (row) {
    var id = row.getAttribute('data-announcement-id');
    if (dismissed.indexOf(id) !== -1) {
      row.hidden = true;
      return;
    }
    var closeBtn = row.querySelector('.announcement-bar__close');
    if (!closeBtn) return;
    closeBtn.addEventListener('click', function () {
      row.hidden = true;
      var next = readDismissedAnnouncements();
      if (next.indexOf(id) === -1) next.push(id);
      try { if (window.localStorage) localStorage.setItem(ANNOUNCEMENT_DISMISS_KEY, JSON.stringify(next)); } catch (e) {}
    });
  });

  var webinarText = document.getElementById('webinarAnnouncementText');
  var schedule = window.ForgeWebinarSchedule;
  if (!webinarText || !schedule) return;
  function apply(pinned) {
    webinarText.textContent = schedule.bannerText(new Date(), pinned || null);
  }
  apply(null);
  var webinarCta = document.getElementById('webinarAnnouncementCta');
  if (webinarCta) {
    webinarCta.addEventListener('click', function () {
      if (window.fbq) fbq('track', 'Lead', { content_name: 'webinar_registration' });
    });
  }
  fetch('/api/webinar-register').then(function (r) { return r.json(); }).then(function (s) {
    if (!s || !s.date || schedule.DATES.indexOf(s.date) === -1) return;
    apply(s.date);
  }).catch(function () {});
}
 
document.addEventListener('DOMContentLoaded', function () {
  // Wire every CTA marked data-cta to the right placeholder link + pixel event.
  document.querySelectorAll('[data-cta]').forEach(function (el) {
    var kind = el.getAttribute('data-cta');
    if (kind === 'webinar') {
      var href = el.getAttribute('href') || '';
      if (!href || href === '#' || href.charAt(0) === '#') {
        el.setAttribute('href', window.FORGE_LINKS.WEBINAR_URL);
      }
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
  initConnectMenu();
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
  var panel = document.getElementById('salesChatPanel');
  var closeBtn = document.getElementById('salesChatClose');
  var messagesEl = document.getElementById('salesChatMessages');
  var input = document.getElementById('salesChatInput');
  var sendBtn = document.getElementById('salesChatSend');
  if (!root || !panel || !closeBtn || !messagesEl || !input || !sendBtn) return;

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

  closeBtn.addEventListener('click', closePanel);
  var ask = document.getElementById('navAskAris');
  if (ask) {
    ask.addEventListener('click', function () {
      if (window.FORGE_CLOSE_CONNECT) window.FORGE_CLOSE_CONNECT();
      var support = window.leadConnector && window.leadConnector.chatWidget;
      if (support && typeof support.closeWidget === 'function') support.closeWidget();
      openPanel();
    });
  }
  window.FORGE_CLOSE_SALES_CHAT = closePanel;

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
// Connect menu (homepage nav). Ask ARIS and Support live here so the
// corner is not shared by two launchers. Support opens the GHL chat
// widget (the SMS opt-in surface). Its blue bubble and greeting card
// stay hidden: they render inside <chat-widget>'s shadow DOM at
// z-index 99999999, which page CSS cannot reach, and the shadow root
// often does not exist yet when this script first runs.
// ===================================================================
var GHL_HIDE_CSS = [
  'button.lc_text-widget--bubble,',
  '.lc_text-widget--prompt {',
  '  display: none !important;',
  '  visibility: hidden !important;',
  '  pointer-events: none !important;',
  '}',
  '.lc_text-widget:not(.lc_text-widget--active) {',
  '  width: 0 !important;',
  '  height: 0 !important;',
  '  overflow: hidden !important;',
  '  pointer-events: none !important;',
  '  z-index: 0 !important;',
  '}'
].join('\n');

function initConnectMenu() {
  var btn = document.getElementById('navConnectBtn');
  var menu = document.getElementById('navConnectMenu');
  if (!btn || !menu) return;
  function close() {
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  }
  function open() {
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
  }
  function items() {
    return Array.prototype.slice.call(menu.querySelectorAll('[role="menuitem"]'));
  }
  function focusItem(index) {
    var list = items();
    if (!list.length) return;
    var i = ((index % list.length) + list.length) % list.length;
    list[i].focus();
  }
  window.FORGE_CLOSE_CONNECT = close;
  // Click and tap toggle the menu. Hover does not. Enter, Space, and
  // ArrowDown open it from the keyboard and move focus into the items.
  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (menu.hidden) open();
    else close();
  });
  btn.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (menu.hidden) open();
      focusItem(0);
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && menu.hidden) {
      e.preventDefault();
      open();
      focusItem(0);
    }
  });
  menu.addEventListener('keydown', function (e) {
    var list = items();
    var i = list.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); focusItem(i + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusItem(i < 0 ? list.length - 1 : i - 1); }
    else if (e.key === 'Home') { e.preventDefault(); focusItem(0); }
    else if (e.key === 'End') { e.preventDefault(); focusItem(list.length - 1); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); btn.focus(); }
  });
  document.addEventListener('click', function (e) {
    if (menu.hidden) return;
    if (btn.contains(e.target) || menu.contains(e.target)) return;
    close();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !menu.hidden && document.activeElement === btn) {
      close();
    }
  });
}

function openSupportChat() {
  var tries = 0;
  function attempt() {
    var api = window.leadConnector && window.leadConnector.chatWidget;
    if (api && typeof api.openWidget === 'function') {
      api.openWidget();
      return;
    }
    tries += 1;
    if (tries < 20) {
      setTimeout(attempt, 250);
      return;
    }
    window.location.href = 'mailto:support@forgedbyaris.com';
  }
  attempt();
}

function initGhlWidgetOverride() {
  var supportBtn = document.getElementById('navSupportChat');
  if (supportBtn) {
    supportBtn.addEventListener('click', function () {
      if (window.FORGE_CLOSE_CONNECT) window.FORGE_CLOSE_CONNECT();
      if (window.FORGE_CLOSE_SALES_CHAT) window.FORGE_CLOSE_SALES_CHAT();
      openSupportChat();
    });
  }

  function arm(host) {
    if (!host || !host.shadowRoot || host.__forgeGhlHide) return !!host && !!host.shadowRoot && !!host.__forgeGhlHide;
    host.__forgeGhlHide = true;
    function apply() {
      if (!host.shadowRoot || host.shadowRoot.getElementById('forge-ghl-hide')) return;
      var style = document.createElement('style');
      style.id = 'forge-ghl-hide';
      style.textContent = GHL_HIDE_CSS;
      host.shadowRoot.appendChild(style);
    }
    apply();
    new MutationObserver(apply).observe(host.shadowRoot, { childList: true, subtree: true });
    return true;
  }

  function watch(host) {
    if (arm(host)) return;
    var tries = 0;
    var timer = setInterval(function () {
      tries += 1;
      if (arm(host) || tries > 40) clearInterval(timer);
    }, 250);
  }

  function scan() {
    document.querySelectorAll('chat-widget').forEach(watch);
  }
  scan();
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
}
