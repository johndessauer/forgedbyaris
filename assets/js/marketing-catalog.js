// Shared Marketing catalog for the browser and the Netlify functions.
// Step 1 is copy and export only. Nothing in this file places an order,
// sends mail, email, or text, or charges a wallet.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ForgeMarketingCatalog = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const DISCLOSURE_DEFAULT = 'Independent real estate investor. Not a licensed real estate agent or broker unless stated.';

  const RIGHTS_TEXT = 'I own this logo or image, or I have permission to use it on my marketing, and it does not copy anyone else\'s brand.';

  const ATTESTATION_TEXT = 'I will scrub these numbers against the National Do Not Call Registry, my state\'s registry, and my own do-not-call list before I call or text. I will get the consent the law requires before I send any text. I will call only during legal hours. I am the one calling or texting, not FORGE, and I am responsible for following the law. This phone information is for information only and is not a guarantee of compliance.';

  const ATTESTATION_VERSION = '2026-11-19-12.5';

  const COMPLIANCE_REMINDER = 'You are responsible for consent, do-not-call and litigator scrubbing, A2P registration, and CAN-SPAM on your own platform. Emails need your postal address and an unsubscribe line. Text copy is only for contacts who opted in or responded. FORGE does not send email or text. You are the one calling, texting, or emailing, not FORGE.';

  const STUDENT_NOTICE = 'You, and not FORGE, place every call and send every text and email that comes from this copy. FORGE does not call, text, or email anyone for you. This copy is for your convenience only. It is not legal advice, and it is not a promise of results. You are responsible for the laws that apply to your marketing.';

  const INFO_ONLY_LABEL = 'For information only. Not a guarantee of compliance. You are responsible for who you call and text.';

  // Lob's documented example. Well-formed for a test mailing, not a real property.
  const SAMPLE_LEAD = Object.freeze({
    id: 'sample',
    address: '210 King St',
    city: 'San Francisco',
    state: 'CA',
    zip: '94107',
    owner: 'Pat Example',
    propertyType: 'SFR',
    playIds: ['absentee'],
    sample: true,
  });

  // Example prices from the approved picker (cost plus about 20 to 25 percent).
  // They are not charged in this step. John sets the final prices later.
  const CHANNELS = [
    { id: 'postcard', name: 'Postcard', description: 'Mailed First Class. Choose 4 × 6, 6 × 9, or 6 × 11. A QR code tracks scans.', group: 'fulfill', medium: 'mail', residential: true, commercial: true },
    { id: 'letter', name: 'Letter', description: 'One page, First Class, in a #10 double-window envelope. Choose color or black and white.', group: 'fulfill', medium: 'mail', residential: true, commercial: true },
    { id: 'handwritten', name: 'Handwritten note', description: 'A folded notecard with a real stamp and a handwritten envelope, or a handwritten postcard. Pick the handwriting. Coming soon.', group: 'fulfill', medium: 'mail', residential: true, commercial: true },
    { id: 'door-hanger', name: 'Door hanger', description: 'Coming soon. A 50-pack reference price is shown. Not mailed to a property. Residential only.', group: 'fulfill', medium: 'print', residential: true, commercial: false },
    { id: 'bandit', name: 'Bandit sign', description: '18 × 24 full-color, both sides, corrugated, with H-stakes. Packs of 50 or 100, shipped to you. Not sent to a property. Check local sign rules. Residential only.', group: 'fulfill', medium: 'print', residential: true, commercial: false },
    { id: 'yard-sign', name: 'Yard sign', description: '18 × 24 on a wire step-in stake. We Buy or Sold. Coming soon. Not sent to a property. Residential only.', group: 'fulfill', medium: 'print', residential: true, commercial: false, comingSoon: true, selectable: false },
    { id: 'yellow-letter', name: 'Yellow letter', description: 'Letter size with a handwritten look on yellow paper. Coming soon. Not mailed yet.', group: 'fulfill', medium: 'mail', residential: true, commercial: true, comingSoon: true },
    { id: 'jumbo-postcard', name: 'Jumbo postcard', description: 'Oversized postcard, larger than 6 × 11. Coming soon. Not mailed yet.', group: 'fulfill', medium: 'mail', residential: true, commercial: true, comingSoon: true },
    { id: 'offer-letter', name: 'Offer letter', description: 'A check-style offer page. Coming soon. It is a marketing sample, not a real check, and it is not mailed yet.', group: 'fulfill', medium: 'mail', residential: true, commercial: true, comingSoon: true },
    { id: 'skip-trace', name: 'Skip trace', description: 'Adds phones and emails to a list. Not available in this step.', group: 'fulfill', medium: 'data', price: '$0.20 per contact', residential: true, commercial: true, copy: false },
    { id: 'phone-scrub', name: 'Phone scrub', description: 'List-cleaning flags only. You still decide who to call, and you stay responsible.', group: 'fulfill', medium: 'data', price: '$0.02 per number', residential: true, commercial: true, copy: false },
    { id: 'list-pull', name: 'List pull', description: 'Pulls a list such as absentee or pre-foreclosure. Not available in this step.', group: 'fulfill', medium: 'data', price: '$0.05 per record', residential: true, commercial: true, copy: false },
    { id: 'call', name: 'Call script', description: 'ARIS writes your opening, voicemail, and objection answers. You dial from your own phone.', group: 'copy', medium: 'copy', price: 'Included, no charge', residential: true, commercial: true, attest: true },
    { id: 'door-knock', name: 'Door-knock script', description: 'A short script plus safety and etiquette tips. Residential only. You knock yourself.', group: 'copy', medium: 'copy', price: 'Included, no charge', residential: true, commercial: false },
    { id: 'email', name: 'Email sequence', description: 'A 3-email follow-up written for you. You send it from your own email platform.', group: 'copy', medium: 'copy', price: 'Included, no charge', residential: true, commercial: true },
    { id: 'text', name: 'Text message', description: 'Short messages for contacts who opted in or responded. No cold-text templates.', group: 'copy', medium: 'copy', price: 'Included, no charge', residential: true, commercial: true, attest: true },
    { id: 'social', name: 'Social post', description: 'Posts, local seller notes, and replies you post under your own account.', group: 'copy', medium: 'copy', price: 'Included, no charge', residential: true, commercial: true },
    { id: 'seller-page', name: 'Online ad and seller page', description: 'Ad copy plus simple seller-page copy. You run and pay for the ads.', group: 'copy', medium: 'copy', price: 'Included, no charge', residential: true, commercial: true },
    { id: 'networking', name: 'Networking outreach', description: 'Messages to agents, wholesalers, attorneys, property managers, and other investors.', group: 'copy', medium: 'copy', price: 'Included, no charge', residential: true, commercial: true },
  ].map(function (row) {
    const channel = Object.assign({ copy: true, attest: false }, row);
    Object.freeze(channel);
    return channel;
  });

  const BY_ID = {};
  CHANNELS.forEach(function (channel) { BY_ID[channel.id] = channel; });

  // Pack sizes are the only quantities a student can order. A property
  // count is never a valid pack.
  const SIGN_OPTION = [['18x24-hstake', '18 × 24, both sides, with H-stakes']];
  const PRINT_SPECS = Object.freeze({
    bandit: spec([50, 100], SIGN_OPTION, false),
    'yard-sign': spec([50, 100], SIGN_OPTION, false),
    'door-hanger': spec([50], [['4.25x11', '4.25 × 11']], true),
  });

  const PIECE_STYLES = Object.freeze({
    postcard: styleSpec('size', '4x6', [
      ['4x6', '4 × 6'],
      ['6x9', '6 × 9'],
      ['6x11', '6 × 11'],
    ]),
    letter: styleSpec('finish', 'bw', [
      ['bw', 'Black and white'],
      ['color', 'Color'],
    ]),
    handwritten: styleSpec('product', 'notecard', [
      ['notecard', 'Folded notecard'],
      ['4x6', '4 × 6 postcard'],
      ['6x9', '6 × 9 postcard'],
    ], {
      comingSoon: true,
      hands: [
        ['hi-clarice', 'Hi Clarice'],
        ['shopping-list', 'Shopping List'],
        ['normal-print', 'Normal Print'],
      ],
      handDefault: 'hi-clarice',
      ink: 'blue',
    }),
  });

  function spec(packs, options, comingSoon) {
    return Object.freeze({
      packs: Object.freeze(packs.slice()),
      comingSoon: !!comingSoon,
      options: Object.freeze(options.map(function (row) {
        return Object.freeze({ id: row[0], label: row[1] });
      })),
    });
  }

  function styleSpec(field, fallback, choices, extra) {
    const more = extra || {};
    return Object.freeze({
      field: field,
      default: fallback,
      comingSoon: !!more.comingSoon,
      handDefault: more.handDefault || '',
      ink: more.ink || '',
      choices: Object.freeze(choices.map(function (row) {
        return Object.freeze({ id: row[0], label: row[1] });
      })),
      hands: Object.freeze((more.hands || []).map(function (row) {
        return Object.freeze({ id: row[0], label: row[1] });
      })),
    });
  }

  function printSpec(id) {
    return PRINT_SPECS[String(id || '')] || null;
  }

  function pieceStyle(id) {
    return PIECE_STYLES[String(id || '')] || null;
  }

  function px(value) {
    return Math.round(value * 10) / 10;
  }

  function xmlText(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // One frame for every piece. The artwork inside is drawn to the real
  // proportion of the option the student picked.
  function frameSvg(inner) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 110" width="160" height="110" focusable="false" aria-hidden="true">' +
      '<rect width="160" height="110" fill="#f4f1ec"/>' + inner + '</svg>';
  }

  function paperShadow(x, y, w, h) {
    return '<rect x="' + px(x + 1.1) + '" y="' + px(y + 1.6) + '" width="' + px(w) + '" height="' + px(h) + '" rx="2" fill="#1c2430" opacity="0.14"/>';
  }

  const HAND_FONT = {
    'hi-clarice': 'Great Vibes, Segoe Script, cursive',
    'shopping-list': 'Caveat, Segoe Print, cursive',
    'normal-print': 'Patrick Hand, Segoe Print, sans-serif',
  };

  function handCopy(hand) {
    if (hand === 'shopping-list') return ['Hi —', 'call me', 'today'];
    if (hand === 'normal-print') return ['Hi,', 'as-is.', 'Call me.'];
    return ['Hello,', 'call me'];
  }

  function writeLines(hand, lines, x, y, size, color) {
    const font = HAND_FONT[hand] || HAND_FONT['hi-clarice'];
    const script = !hand || hand === 'hi-clarice';
    const fontSize = script ? size * 1.55 : size;
    const leading = fontSize * (script ? 0.92 : 1.22);
    const fill = color || '#1d4e89';
    return lines.map(function (line, index) {
      return '<text x="' + px(x) + '" y="' + px(y + index * leading) + '" fill="' + fill + '" font-family="' + font + '" font-size="' + px(fontSize) + '">' + xmlText(line) + '</text>';
    }).join('');
  }

  function inkFill(ink) {
    return ink === 'black' ? '#1c2430' : '#1d4e89';
  }

  function postageStamp(x, y, w, h) {
    const width = w || 14;
    const height = h || 16;
    return '<rect x="' + px(x) + '" y="' + px(y) + '" width="' + px(width) + '" height="' + px(height) + '" rx="1" fill="#d4544a" stroke="#f6d2ce" stroke-width="0.7"/>' +
      '<circle cx="' + px(x + width / 2) + '" cy="' + px(y + height / 2) + '" r="' + px(Math.min(width, height) * 0.28) + '" fill="none" stroke="#f8e6e3" stroke-width="0.7"/>';
  }

  function houseMark(cx, cy, scale) {
    const half = scale * 0.46;
    const roof = cy - scale * 0.42;
    const eave = cy - scale * 0.05;
    const bodyBottom = cy + scale * 0.48;
    return '<path d="M' + px(cx) + ' ' + px(roof) + ' L' + px(cx + half + scale * 0.12) + ' ' + px(eave) + ' L' + px(cx - half - scale * 0.12) + ' ' + px(eave) + ' Z" fill="#f4f1ec"/>' +
      '<rect x="' + px(cx - half) + '" y="' + px(eave) + '" width="' + px(half * 2) + '" height="' + px(bodyBottom - eave) + '" fill="#f4f1ec"/>' +
      '<rect x="' + px(cx - half * 0.22) + '" y="' + px(eave + (bodyBottom - eave) * 0.42) + '" width="' + px(half * 0.44) + '" height="' + px((bodyBottom - eave) * 0.58) + '" fill="#243246"/>';
  }

  function postcardBox(sizeId) {
    const inch = 132 / 11;
    const table = { '4x6': [6, 4], '6x9': [9, 6], '6x11': [11, 6] };
    const pair = table[sizeId] || table['4x6'];
    const w = pair[0] * inch;
    const h = pair[1] * inch;
    return { x: (160 - w) / 2, y: (110 - h) / 2, w: w, h: h };
  }

  function postcardArt(sizeId) {
    const box = postcardBox(sizeId);
    const photo = box.w * 0.38;
    const bar = Math.max(1.5, box.h * 0.055);
    const textX = box.x + photo + box.w * 0.07;
    const textW = box.w - photo - box.w * 0.12;
    const top = box.y + box.h * 0.28;
    const gap = box.h * 0.16;
    return paperShadow(box.x, box.y, box.w, box.h) +
      '<rect x="' + px(box.x) + '" y="' + px(box.y) + '" width="' + px(box.w) + '" height="' + px(box.h) + '" rx="2" fill="#fffdf8" stroke="#e3dcd0" stroke-width="0.7"/>' +
      '<path d="M' + px(box.x + photo) + ' ' + px(box.y) + ' H' + px(box.x + 2) + ' Q' + px(box.x) + ' ' + px(box.y) + ' ' + px(box.x) + ' ' + px(box.y + 2) + ' V' + px(box.y + box.h - 2) + ' Q' + px(box.x) + ' ' + px(box.y + box.h) + ' ' + px(box.x + 2) + ' ' + px(box.y + box.h) + ' H' + px(box.x + photo) + ' Z" fill="#243246"/>' +
      houseMark(box.x + photo * 0.5, box.y + box.h * 0.52, Math.min(photo, box.h) * 0.62) +
      '<rect x="' + px(textX) + '" y="' + px(top) + '" width="' + px(textW) + '" height="' + px(bar) + '" rx="0.6" fill="#243246"/>' +
      '<rect x="' + px(textX) + '" y="' + px(top + gap) + '" width="' + px(textW * 0.78) + '" height="' + px(bar * 0.7) + '" rx="0.5" fill="#8b97a3"/>' +
      '<rect x="' + px(textX) + '" y="' + px(top + gap * 2) + '" width="' + px(textW * 0.62) + '" height="' + px(bar * 0.7) + '" rx="0.5" fill="#c5bfb4"/>' +
      '<rect x="' + px(box.x + box.w - box.w * 0.1) + '" y="' + px(box.y + box.h - box.h * 0.22) + '" width="' + px(Math.max(4, box.w * 0.06)) + '" height="' + px(Math.max(4, box.h * 0.12)) + '" fill="#243246"/>';
  }

  function plainEnvelopeArt(finish) {
    const w = 142;
    const h = w * (4.125 / 9.5);
    const x = (160 - w) / 2;
    const y = (110 - h) / 2;
    const color = finish === 'color';
    return paperShadow(x, y, w, h) +
      '<rect x="' + px(x) + '" y="' + px(y) + '" width="' + px(w) + '" height="' + px(h) + '" rx="2" fill="#f7f4ee" stroke="#ddd4c8" stroke-width="0.8"/>' +
      (color ? '<rect x="' + px(x) + '" y="' + px(y) + '" width="' + px(w) + '" height="5" fill="#243246"/>' : '') +
      '<rect x="' + px(x + w - 22) + '" y="' + px(y + 8) + '" width="12" height="14" rx="1" fill="#d4544a"/>' +
      '<rect x="' + px(x + 14) + '" y="' + px(y + 28) + '" width="46" height="1.4" fill="#3e4a57"/>' +
      '<rect x="' + px(x + 14) + '" y="' + px(y + 34) + '" width="38" height="1.4" fill="#3e4a57"/>' +
      '<rect x="' + px(x + 14) + '" y="' + px(y + 40) + '" width="30" height="1.4" fill="#3e4a57"/>';
  }

  function letterArt(finish, envelope) {
    if (envelope === 'plain') return plainEnvelopeArt(finish);
    const w = 142;
    const h = w * (4.125 / 9.5);
    const x = (160 - w) / 2;
    const y = (110 - h) / 2;
    const color = finish === 'color';
    const top = { x: x + 9, y: y + 13, w: 52, h: 14 };
    const bottom = { x: x + 9, y: y + 32, w: 74, h: 22 };
    function rule(rx, ry, rw, fill) {
      return '<rect x="' + px(rx) + '" y="' + px(ry) + '" width="' + px(rw) + '" height="1.35" rx="0.4" fill="' + fill + '"/>';
    }
    const ink = '#3e4a57';
    const topLines = color
      ? '<rect x="' + px(top.x + 2) + '" y="' + px(top.y + 2) + '" width="' + px(top.w - 4) + '" height="6.2" rx="0.4" fill="#243246"/>' +
        '<rect x="' + px(top.x + 2) + '" y="' + px(top.y + 9.4) + '" width="18" height="1.8" rx="0.3" fill="#2f6f86"/>'
      : rule(top.x + 3, top.y + 4, 32, ink) + rule(top.x + 3, top.y + 8, 24, ink);
    const body = color
      ? '<rect x="' + px(bottom.x + 3) + '" y="' + px(bottom.y + 3) + '" width="16" height="12" rx="0.6" fill="#2a4564"/>' +
        '<rect x="' + px(bottom.x + 5) + '" y="' + px(bottom.y + 5) + '" width="8" height="5" fill="#d5e6ee"/>' +
        rule(bottom.x + 23, bottom.y + 5, 40, ink) +
        rule(bottom.x + 23, bottom.y + 9.5, 34, '#2f6f86') +
        rule(bottom.x + 23, bottom.y + 14, 26, ink)
      : rule(bottom.x + 3, bottom.y + 5, 52, ink) +
        rule(bottom.x + 3, bottom.y + 10, 46, ink) +
        rule(bottom.x + 3, bottom.y + 15, 34, ink);
    function windowPane(pane, inner) {
      return '<rect x="' + px(pane.x) + '" y="' + px(pane.y) + '" width="' + px(pane.w) + '" height="' + px(pane.h) + '" rx="1.2" fill="#fbfcfe" stroke="#c3d0dc" stroke-width="0.7"/>' + inner;
    }
    return paperShadow(x, y, w, h) +
      '<rect x="' + px(x) + '" y="' + px(y) + '" width="' + px(w) + '" height="' + px(h) + '" rx="2" fill="#f7f4ee" stroke="#ddd4c8" stroke-width="0.8"/>' +
      '<path d="M' + px(x + 1) + ' ' + px(y + 1) + ' L' + px(x + w / 2) + ' ' + px(y + 7) + ' L' + px(x + w - 1) + ' ' + px(y + 1) + '" fill="none" stroke="#e7dfd4" stroke-width="0.7"/>' +
      windowPane(top, topLines) +
      windowPane(bottom, body);
  }

  function noteArt(hand, ink) {
    const ex = 36;
    const ey = 48;
    const ew = 112;
    const eh = 48;
    const cx = 12;
    const cy = 12;
    const cw = 102;
    const ch = 66;
    const fold = cx + 40;
    const script = !hand || hand === 'hi-clarice';
    return paperShadow(ex, ey, ew, eh) +
      '<rect x="' + px(ex) + '" y="' + px(ey) + '" width="' + px(ew) + '" height="' + px(eh) + '" rx="2" fill="#f3efe6" stroke="#ddd4c8" stroke-width="0.7"/>' +
      postageStamp(ex + ew - 20, ey + 7, 13, 15) +
      paperShadow(cx, cy, cw, ch) +
      '<rect x="' + px(cx) + '" y="' + px(cy) + '" width="' + px(cw) + '" height="' + px(ch) + '" rx="2" fill="#fffdf8" stroke="#e4ddd2" stroke-width="0.7"/>' +
      '<rect x="' + px(cx + 0.7) + '" y="' + px(cy + 0.7) + '" width="' + px(fold - cx - 0.7) + '" height="' + px(ch - 1.4) + '" fill="#f4f0e8"/>' +
      '<line x1="' + px(fold) + '" y1="' + px(cy + 5) + '" x2="' + px(fold) + '" y2="' + px(cy + ch - 5) + '" stroke="#e3dacd" stroke-width="0.8"/>' +
      writeLines(hand, handCopy(hand), fold + 6, cy + (script ? 30 : 22), script ? 8 : 9, inkFill(ink));
  }

  function handwrittenCardArt(sizeId, hand, ink) {
    const box = postcardBox(sizeId === '6x9' ? '6x9' : '4x6');
    const mid = box.x + box.w * 0.56;
    const script = !hand || hand === 'hi-clarice';
    const stampW = Math.max(10, box.w * 0.12);
    const stampH = stampW * 1.15;
    return paperShadow(box.x, box.y, box.w, box.h) +
      '<rect x="' + px(box.x) + '" y="' + px(box.y) + '" width="' + px(box.w) + '" height="' + px(box.h) + '" rx="2" fill="#fffdf8" stroke="#e4ddd2" stroke-width="0.7"/>' +
      '<line x1="' + px(mid) + '" y1="' + px(box.y + 5) + '" x2="' + px(mid) + '" y2="' + px(box.y + box.h - 5) + '" stroke="#eadfce" stroke-width="0.6"/>' +
      writeLines(hand, handCopy(hand), box.x + box.w * 0.06, box.y + box.h * (script ? 0.42 : 0.32), Math.max(5.5, box.h * 0.15), inkFill(ink)) +
      postageStamp(box.x + box.w - stampW - box.w * 0.05, box.y + box.h * 0.08, stampW, stampH) +
      '<rect x="' + px(mid + box.w * 0.06) + '" y="' + px(box.y + box.h * 0.48) + '" width="' + px(box.w * 0.3) + '" height="1.2" rx="0.4" fill="#c9c0b4"/>' +
      '<rect x="' + px(mid + box.w * 0.06) + '" y="' + px(box.y + box.h * 0.62) + '" width="' + px(box.w * 0.26) + '" height="1.2" rx="0.4" fill="#c9c0b4"/>' +
      '<rect x="' + px(mid + box.w * 0.06) + '" y="' + px(box.y + box.h * 0.76) + '" width="' + px(box.w * 0.22) + '" height="1.2" rx="0.4" fill="#c9c0b4"/>';
  }

  function stake(cx, top) {
    return '<line x1="' + px(cx) + '" y1="' + px(top) + '" x2="' + px(cx) + '" y2="104" stroke="#8d97a1" stroke-width="2.5" stroke-linecap="round"/>' +
      '<line x1="' + px(cx - 16) + '" y1="104" x2="' + px(cx + 16) + '" y2="104" stroke="#8d97a1" stroke-width="2.5" stroke-linecap="round"/>';
  }

  function signFace(fill, ink, rule) {
    const signH = 74;
    const signW = signH * (18 / 24);
    const x = (160 - signW) / 2;
    const y = 6;
    let ribs = '';
    if (fill === '#f5d20a') {
      for (let i = 0; i < 8; i += 1) {
        const lx = x + 5 + i * ((signW - 10) / 7);
        ribs += '<line x1="' + px(lx) + '" y1="' + px(y + 2) + '" x2="' + px(lx) + '" y2="' + px(y + signH - 2) + '" stroke="#e0b000" stroke-width="0.8" opacity="0.7"/>';
      }
    }
    return stake(80, y + signH - 1) +
      paperShadow(x, y, signW, signH) +
      '<rect x="' + px(x) + '" y="' + px(y) + '" width="' + px(signW) + '" height="' + px(signH) + '" rx="1.4" fill="' + fill + '" stroke="' + ink + '" stroke-width="1.1"/>' +
      ribs +
      '<text x="80" y="' + px(y + 24) + '" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="8" font-weight="700" fill="' + ink + '">WE BUY</text>' +
      '<text x="80" y="' + px(y + 35) + '" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="8" font-weight="700" fill="' + ink + '">HOUSES</text>' +
      (rule ? '<rect x="' + px(x + 10) + '" y="' + px(y + 40) + '" width="' + px(signW - 20) + '" height="1" fill="' + rule + '"/>' : '') +
      '<text x="80" y="' + px(y + 54) + '" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="6.2" font-weight="600" fill="' + ink + '">555-0100</text>';
  }

  function hangerArt() {
    const x = 63;
    const y = 8;
    const w = 34;
    const h = 94;
    const cx = x + w / 2;
    const shoulder = y + 26;
    const d = 'M' + px(x + 7) + ' ' + px(shoulder) +
      ' V' + px(y + 16) +
      ' C' + px(x + 7) + ' ' + px(y + 4) + ' ' + px(x + w - 7) + ' ' + px(y + 4) + ' ' + px(x + w - 7) + ' ' + px(y + 16) +
      ' V' + px(shoulder) +
      ' H' + px(x + w) +
      ' V' + px(y + h - 7) +
      ' Q' + px(x + w) + ' ' + px(y + h) + ' ' + px(x + w - 7) + ' ' + px(y + h) +
      ' H' + px(x + 7) +
      ' Q' + px(x) + ' ' + px(y + h) + ' ' + px(x) + ' ' + px(y + h - 7) +
      ' V' + px(shoulder) +
      ' H' + px(x + 7) +
      ' Z M' + px(cx - 4.2) + ' ' + px(y + 15) +
      ' a4.2 4.2 0 1 0 8.4 0 a4.2 4.2 0 1 0 -8.4 0 Z';
    return paperShadow(x + 1, y + 2, w, h) +
      '<path d="' + d + '" fill="#fffdf8" stroke="#cfc6ba" stroke-width="1" fill-rule="evenodd"/>' +
      '<rect x="' + px(x + 7) + '" y="' + px(shoulder + 12) + '" width="' + px(w - 14) + '" height="2" rx="0.6" fill="#d9d1c6"/>' +
      '<rect x="' + px(x + 8) + '" y="' + px(shoulder + 18) + '" width="' + px(w - 16) + '" height="1.3" rx="0.5" fill="#e6dfd4"/>' +
      '<rect x="' + px(x + 8) + '" y="' + px(shoulder + 23) + '" width="' + px(w - 18) + '" height="1.3" rx="0.5" fill="#e6dfd4"/>';
  }

  const ANGLES = [
    { id: 'cash', label: 'We Buy Houses / Cash Offer', residential: true, commercial: true, kicker: 'AS-IS CASH', headline: ['WE BUY', 'HOUSES'], card: 'We buy houses as-is.', opener: 'We buy houses as-is for cash.', alt: 'A simple cash sale, with no repairs and no agent fees.', guard: 'Do not promise a price.' },
    { id: 'prefore', label: 'Behind on Payments / Pre-foreclosure', residential: true, commercial: true, kicker: 'OPTIONS', headline: ['BEHIND?', 'OPTIONS'], card: 'A private option.', opener: 'If the payments have gotten hard, there may be a private option.', alt: 'I can talk through options. I will not pretend to know your file.', guard: 'Do not say you know they are behind or in foreclosure.' },
    { id: 'probate', label: 'Inherited / Probate', residential: true, commercial: true, kicker: 'INHERITED', headline: ['INHERITED?', 'WE HELP'], card: 'A simple way to sell.', opener: 'If you inherited a property and want a simple way to sell, I can help.', alt: 'No clean-out required before a conversation.', guard: 'Do not say you know they inherited it.' },
    { id: 'landlord', label: 'Tired Landlord', residential: true, commercial: true, kicker: 'TIRED?', headline: ['TIRED', 'LANDLORD'], card: 'Sell the rental as-is.', opener: 'If the rentals are more work than they are worth, I buy as-is.', alt: 'No showings and no repairs before we talk.', guard: 'Do not claim you know their rents.' },
    { id: 'vacant', label: 'Vacant Property', residential: true, commercial: true, kicker: 'VACANT', headline: ['VACANT?', 'WE BUY'], card: 'I buy empty houses.', opener: 'If the property is sitting empty, I can buy it as-is.', alt: 'A direct buyer for a house that is not being used.', guard: 'Do not say you inspected the property.' },
    { id: 'divorce', label: 'Divorce', residential: true, commercial: false, kicker: 'SIMPLE SALE', headline: ['SIMPLE', 'SALE'], card: 'A sale on your timeline.', opener: 'If you need a simple sale on your timeline, I buy as-is.', alt: 'One conversation. No listing and no repairs.', guard: 'Do not say you know about a divorce.' },
    { id: 'repairs', label: 'Code Violations / Repairs', residential: true, commercial: true, kicker: 'AS-IS', headline: ['NEED WORK?', 'WE BUY'], card: 'No repairs first.', opener: 'I buy houses that need work. No repairs first.', alt: 'Leave the repairs. I can still make an as-is offer.', guard: 'Do not say you know about a code case.' },
    { id: 'expired', label: 'Expired Listing', residential: true, commercial: true, kicker: 'EXPIRED', headline: ['LISTING', 'EXPIRED?'], card: 'A direct buyer.', opener: 'If a listing already ran its course, I am a direct buyer.', alt: 'Skip another listing and talk to a buyer.', guard: 'Do not say you know their listing history.' },
    { id: 'tax', label: 'Tax Delinquent', residential: true, commercial: true, kicker: 'TAXES', headline: ['BEHIND', 'ON TAXES?'], card: 'A private sale is one option.', opener: 'If the taxes are getting heavy, a private sale is one option.', alt: 'I buy as-is. This is a conversation, not a notice.', guard: 'Do not say you know they are tax delinquent.' },
    { id: 'neighbor', label: "Neighbor: I'm buying in your area", residential: true, commercial: false, kicker: 'NEARBY', headline: ['BUYING', 'NEARBY'], card: 'I am buying in this area.', opener: 'I am buying houses in your area.', alt: 'Your neighbor can sell as-is, with no agent fees.', guard: 'Do not pretend to live there if the brand does not say so.' },
  ];

  const MAIL_TEMPLATES = [
    { id: 'classic', label: 'Classic', layout: 'classic' },
    { id: 'bold', label: 'Bold', layout: 'bold' },
    { id: 'friendly', label: 'Friendly', layout: 'friendly' },
    { id: 'minimal', label: 'Minimal', layout: 'minimal' },
    { id: 'photo', label: 'Property', layout: 'photo' },
    { id: 'script', label: 'Handwritten', layout: 'script' },
  ];

  const YARD_TEMPLATES = [
    { id: 'we-buy', label: 'We Buy', fill: '#f7f7f5', ink: '#1a1a1a', band: '#c1121f', layout: 'we-buy' },
    { id: 'sold', label: 'Sold', fill: '#c1121f', ink: '#ffffff', band: '#8d0c16', layout: 'sold' },
    { id: 'cash', label: 'Cash', fill: '#f4f7fb', ink: '#143d7a', band: '#143d7a', layout: 'cash' },
    { id: 'clean', label: 'Clean', fill: '#fffdf8', ink: '#1c2430', band: '#1c2430', layout: 'we-buy' },
    { id: 'marker', label: 'Marker', fill: '#fffdf8', ink: '#1a1a1a', band: '#c1121f', layout: 'marker' },
    { id: 'big-phone', label: 'Big Phone', fill: '#f7f7f5', ink: '#1a1a1a', band: '#c1121f', layout: 'phone' },
  ];

  const BANDIT_TEMPLATES = [
    { id: 'classic-yellow', label: 'Classic Yellow', fill: '#ffe14a', ink: '#161616', layout: 'classic' },
    { id: 'red-urgent', label: 'Red Urgent', fill: '#e10600', ink: '#ffffff', layout: 'urgent' },
    { id: 'white-blue', label: 'White / Blue', fill: '#f4f7fb', ink: '#143d7a', layout: 'classic' },
    { id: 'marker', label: 'Marker', fill: '#fff3a1', ink: '#1a1a1a', layout: 'marker' },
    { id: 'orange-cash', label: 'Orange Cash', fill: '#ff6a00', ink: '#1a1208', layout: 'cash' },
    { id: 'big-phone', label: 'Big Phone', fill: '#ffe14a', ink: '#161616', layout: 'phone' },
  ];

  const SIGN_COLOR_FILLS = { yellow: '#ffe14a', white: '#f7f7f5', red: '#e10600', orange: '#ff6a00' };
  const SIGN_INK_FILLS = { black: '#161616', red: '#c1121f', blue: '#143d7a' };

  function anglesFor(propertyClass) {
    const commercial = propertyClass === 'commercial';
    return ANGLES.filter(function (angle) { return commercial ? angle.commercial : angle.residential; });
  }

  function angleById(id, propertyClass) {
    const list = propertyClass ? anglesFor(propertyClass) : ANGLES;
    const found = list.filter(function (angle) { return angle.id === id; })[0];
    return found || null;
  }

  function templatesFor(id) {
    const key = String(id || '');
    if (key === 'bandit') return BANDIT_TEMPLATES;
    if (key === 'yard-sign') return YARD_TEMPLATES;
    if (key === 'postcard' || key === 'letter' || key === 'handwritten' || key === 'door-hanger' || key === 'yellow-letter' || key === 'jumbo-postcard' || key === 'offer-letter') return MAIL_TEMPLATES;
    return [];
  }

  function templateById(id, templateId) {
    const list = templatesFor(id);
    return list.filter(function (row) { return row.id === templateId; })[0] || list[0] || null;
  }

  function normalizeDesign(id, raw) {
    const saved = raw || {};
    const templates = templatesFor(id);
    const template = templates.some(function (row) { return row.id === saved.template; }) ? saved.template : (templates[0] ? templates[0].id : 'classic');
    const signSize = saved.signSize === '24x18' ? '24x18' : '18x24';
    const signColor = Object.prototype.hasOwnProperty.call(SIGN_COLOR_FILLS, saved.signColor) ? saved.signColor : '';
    const lettering = Object.prototype.hasOwnProperty.call(SIGN_INK_FILLS, saved.lettering) ? saved.lettering : '';
    const sides = saved.sides === 'single' ? 'single' : 'double';
    const stakes = saved.stakes === 'none' ? 'none' : 'h-stake';
    return {
      template: template,
      signSize: signSize,
      signColor: signColor,
      lettering: lettering,
      sides: sides,
      stakes: stakes,
      material: 'corrugated-4mm',
      envelope: saved.envelope === 'plain' ? 'plain' : 'window',
      ink: saved.ink === 'black' ? 'black' : 'blue',
      hangerSize: saved.hangerSize === '3.5x8.5' || saved.hangerSize === '4.25x14' ? saved.hangerSize : '4.25x11',
      hangerFinish: saved.hangerFinish === 'uv' ? 'uv' : 'standard',
    };
  }

  function designOrderable(id, design) {
    const row = normalizeDesign(id, design);
    if (id === 'yard-sign' || id === 'yellow-letter' || id === 'jumbo-postcard' || id === 'offer-letter') return false;
    if (id === 'bandit') {
      return row.signSize === '18x24' && row.sides === 'double' && row.stakes === 'h-stake';
    }
    return true;
  }

  function priceMode(id, design) {
    const row = normalizeDesign(id, design);
    if (id === 'yard-sign' || id === 'yellow-letter' || id === 'jumbo-postcard' || id === 'offer-letter') return 'soon';
    if (id === 'letter' && row.envelope === 'plain') return 'soon';
    if (id === 'bandit') return designOrderable(id, row) ? 'priced' : 'soon';
    if (id === 'door-hanger') return row.hangerSize === '4.25x11' ? 'reference' : 'soon';
    return 'priced';
  }

  function brandPhone(brand) {
    const raw = String(brand && brand.phone || '').replace(/[^\d+().\-\s]/g, '').trim();
    return raw || '555-0100';
  }

  function safeHex(value) {
    return /^#[0-9a-fA-F]{6}$/.test(String(value || '')) ? String(value) : '';
  }

  function displayType(text, x, y, size, fill, anchor, family) {
    return '<text x="' + px(x) + '" y="' + px(y) + '" text-anchor="' + (anchor || 'middle') + '" font-family="' + (family || 'Bebas Neue, Impact, sans-serif') + '" font-size="' + px(size) + '" fill="' + fill + '">' + xmlText(text) + '</text>';
  }

  function banditScene(channelId, design, template, angle, brand, swatch) {
    const tpl = template || BANDIT_TEMPLATES[0];
    const chosen = angle || ANGLES[0];
    let fill = tpl.fill;
    let ink = tpl.ink;
    if (!swatch && design.signColor) fill = SIGN_COLOR_FILLS[design.signColor];
    if (!swatch && design.lettering) ink = SIGN_INK_FILLS[design.lettering];
    const landscape = !swatch && design.signSize === '24x18';
    const noStake = !swatch && design.stakes === 'none';
    const signW = landscape ? 96 : 62;
    const signH = landscape ? 58 : 74;
    const x = (160 - signW) / 2;
    const y = landscape ? 14 : 8;
    const lines = tpl.layout === 'cash' ? ['CASH FOR', 'HOUSES'] : (chosen.headline || ['WE BUY', 'HOUSES']);
    const phone = brandPhone(brand);
    const parts = phone.split('-');
    const phoneTop = parts.length > 1 ? parts[0] : phone.slice(0, 3);
    const phoneBottom = parts.length > 1 ? parts.slice(1).join('-') : phone.slice(3);
    let ribs = '';
    for (let i = 0; i < 7; i += 1) {
      const lx = x + 4 + i * ((signW - 8) / 6);
      ribs += '<line x1="' + px(lx) + '" y1="' + px(y + 2) + '" x2="' + px(lx) + '" y2="' + px(y + signH - 2) + '" stroke="' + ink + '" stroke-width="0.6" opacity="0.13"/>';
    }
    const cx = 80;
    let stake = '';
    if (!noStake) {
      stake = '<line x1="' + cx + '" y1="' + px(y + signH - 1) + '" x2="' + cx + '" y2="100" stroke="#8d97a1" stroke-width="2.6" stroke-linecap="round"/>' +
        '<line x1="' + (cx - 18) + '" y1="100" x2="' + (cx + 18) + '" y2="100" stroke="#8d97a1" stroke-width="2.6" stroke-linecap="round"/>';
    }
    const font = tpl.layout === 'marker' ? 'Caveat, Segoe Print, cursive' : 'Bebas Neue, Impact, sans-serif';
    const headSize = landscape ? 15 : 13;
    let face = ribs;
    if (tpl.layout === 'phone') {
      face += displayType(lines[0] + ' ' + lines[1], cx, y + 16, 9, ink, 'middle', font);
      face += displayType(phoneTop, cx, y + signH * 0.48, landscape ? 22 : 20, ink, 'middle', 'Bebas Neue, Impact, sans-serif');
      face += displayType(phoneBottom, cx, y + signH * 0.78, landscape ? 22 : 20, ink, 'middle', 'Bebas Neue, Impact, sans-serif');
    } else if (tpl.layout === 'urgent') {
      face += displayType('CALL / TEXT', cx, y + 12, 7, ink, 'middle', font);
      face += displayType(lines[0], cx, y + 28, headSize, ink, 'middle', font);
      face += displayType(lines[1], cx, y + 44, headSize, ink, 'middle', font);
      face += displayType(phone, cx, y + signH - 9, landscape ? 20 : 16, ink, 'middle', 'Bebas Neue, Impact, sans-serif');
    } else {
      face += displayType(lines[0], cx, y + (landscape ? 18 : 22), headSize, ink, 'middle', font);
      face += displayType(lines[1], cx, y + (landscape ? 34 : 36), headSize, ink, 'middle', font);
      face += displayType(phone, cx, y + signH - 10, landscape ? 22 : 18, ink, 'middle', 'Bebas Neue, Impact, sans-serif');
    }
    const name = String(brand && brand.name || '').trim();
    if (name && tpl.layout !== 'phone') {
      face += displayType(name.slice(0, 18), cx, y + signH - 18, 6, ink, 'middle', 'Inter, Arial, sans-serif');
    }
    return '<rect width="160" height="110" fill="#d5e4f0"/>' +
      '<path d="M0 76 Q40 70 80 78 T160 74 V110 H0 Z" fill="#6f9a55"/>' +
      '<ellipse cx="80" cy="96" rx="28" ry="4" fill="#4f7340" opacity="0.35"/>' +
      stake +
      '<g transform="rotate(-2 80 46)">' +
      paperShadow(x, y, signW, signH) +
      '<rect x="' + px(x) + '" y="' + px(y) + '" width="' + px(signW) + '" height="' + px(signH) + '" rx="1.2" fill="' + fill + '" stroke="' + ink + '" stroke-width="1.2"/>' +
      face +
      '</g>';
  }

  function accentOf(template, brand) {
    const branded = safeHex(brand && brand.primary);
    if (template && template.layout === 'friendly') return branded || '#8c5a3c';
    if (template && template.layout === 'bold') return branded || '#1c2430';
    return branded || '#243246';
  }

  function cardFace(box, template, angle, brand, ink) {
    const tpl = template || MAIL_TEMPLATES[0];
    const chosen = angle || ANGLES[0];
    const accent = accentOf(tpl, brand);
    const phone = brandPhone(brand);
    const name = String(brand && brand.name || '').trim();
    const layout = tpl.layout || 'classic';
    let body = paperShadow(box.x, box.y, box.w, box.h) +
      '<rect x="' + px(box.x) + '" y="' + px(box.y) + '" width="' + px(box.w) + '" height="' + px(box.h) + '" rx="2" fill="' + (layout === 'bold' ? accent : '#fffdf8') + '" stroke="#e4ddd2" stroke-width="0.7"/>';
    const textFill = layout === 'bold' ? '#f7f5f2' : '#1c2430';
    const scriptFill = ink || '#1d4e89';
    if (layout === 'photo') {
      body += houseMark(box.x + box.w * 0.28, box.y + box.h * 0.55, Math.min(box.w, box.h) * 0.7);
    }
    if (layout === 'script' || layout === 'friendly') {
      body += writeLines('hi-clarice', [chosen.card], box.x + 8, box.y + box.h * 0.42, Math.max(6, box.h * 0.16), scriptFill);
    } else if (layout === 'minimal') {
      body += '<rect x="' + px(box.x + 8) + '" y="' + px(box.y + 10) + '" width="' + px(box.w * 0.4) + '" height="1.2" fill="' + accent + '"/>';
      body += displayType(chosen.kicker, box.x + 8, box.y + box.h * 0.45, Math.max(8, box.h * 0.16), textFill, 'start', 'Inter, Arial, sans-serif');
    } else {
      body += displayType(chosen.kicker, box.x + box.w * 0.62, box.y + box.h * 0.38, Math.max(8, box.h * 0.16), textFill, 'middle');
      body += displayType(phone, box.x + box.w * 0.62, box.y + box.h * 0.62, Math.max(7, box.h * 0.12), textFill, 'middle', 'Inter, Arial, sans-serif');
    }
    if (name && layout !== 'script') {
      body += displayType(name.slice(0, 16), box.x + 8, box.y + box.h - 6, 6, textFill, 'start', 'Inter, Arial, sans-serif');
    }
    return body;
  }

  function yellowLetterArt(template, angle, brand, hand, ink) {
    const box = { x: 46, y: 10, w: 68, h: 90 };
    const chosen = angle || ANGLES[0];
    return paperShadow(box.x, box.y, box.w, box.h) +
      '<rect x="' + px(box.x) + '" y="' + px(box.y) + '" width="' + px(box.w) + '" height="' + px(box.h) + '" fill="#ffe56a" stroke="#e2c84a" stroke-width="0.8"/>' +
      writeLines(hand || 'hi-clarice', [chosen.card, brandPhone(brand)], box.x + 6, box.y + 28, 8, inkFill(ink));
  }

  function offerArt(template, angle, brand) {
    const box = { x: 18, y: 28, w: 124, h: 54 };
    const chosen = angle || ANGLES[0];
    const accent = accentOf(template, brand);
    return paperShadow(box.x, box.y, box.w, box.h) +
      '<rect x="' + px(box.x) + '" y="' + px(box.y) + '" width="' + px(box.w) + '" height="' + px(box.h) + '" rx="2" fill="#fbf8f1" stroke="' + accent + '" stroke-width="1"/>' +
      '<rect x="' + px(box.x) + '" y="' + px(box.y) + '" width="28" height="' + px(box.h) + '" fill="' + accent + '"/>' +
      displayType('OFFER', box.x + 14, box.y + 32, 11, '#f7f5f2', 'middle') +
      displayType('PAY TO', box.x + 40, box.y + 16, 7, '#5c6b7a', 'start', 'Inter, Arial, sans-serif') +
      '<rect x="' + px(box.x + 40) + '" y="' + px(box.y + 20) + '" width="72" height="1" fill="#c9c0b4"/>' +
      displayType(chosen.kicker, box.x + 40, box.y + 36, 9, '#1c2430', 'start', 'Inter, Arial, sans-serif') +
      displayType(brandPhone(brand), box.x + 40, box.y + 48, 8, '#1c2430', 'start', 'Inter, Arial, sans-serif');
  }

  function hangerLook(design, template, angle, brand) {
    const tpl = template || MAIL_TEMPLATES[0];
    const fill = tpl.layout === 'bold' ? accentOf(tpl, brand) : (tpl.layout === 'friendly' ? '#f6e7c1' : '#fffdf8');
    const ink = tpl.layout === 'bold' ? '#f7f5f2' : '#1c2430';
    const scale = design && design.hangerSize === '3.5x8.5' ? 0.84 : (design && design.hangerSize === '4.25x14' ? 1 : 0.94);
    const x = 80 - 17 * scale;
    const y = 8;
    const w = 34 * scale;
    const h = 94 * scale;
    const shoulder = y + 26 * scale;
    const d = 'M' + px(x + 7 * scale) + ' ' + px(shoulder) +
      ' V' + px(y + 16 * scale) +
      ' C' + px(x + 7 * scale) + ' ' + px(y + 4 * scale) + ' ' + px(x + w - 7 * scale) + ' ' + px(y + 4 * scale) + ' ' + px(x + w - 7 * scale) + ' ' + px(y + 16 * scale) +
      ' V' + px(shoulder) +
      ' H' + px(x + w) +
      ' V' + px(y + h - 7 * scale) +
      ' Q' + px(x + w) + ' ' + px(y + h) + ' ' + px(x + w - 7 * scale) + ' ' + px(y + h) +
      ' H' + px(x + 7 * scale) +
      ' Q' + px(x) + ' ' + px(y + h) + ' ' + px(x) + ' ' + px(y + h - 7 * scale) +
      ' V' + px(shoulder) +
      ' H' + px(x + 7 * scale) +
      ' Z M' + px(x + w / 2 - 4 * scale) + ' ' + px(y + 15 * scale) +
      ' a' + px(4 * scale) + ' ' + px(4 * scale) + ' 0 1 0 ' + px(8 * scale) + ' 0 a' + px(4 * scale) + ' ' + px(4 * scale) + ' 0 1 0 -' + px(8 * scale) + ' 0 Z';
    const chosen = angle || ANGLES[0];
    return paperShadow(x, y, w, h) +
      '<path d="' + d + '" fill="' + fill + '" stroke="#cfc6ba" stroke-width="1" fill-rule="evenodd"/>' +
      displayType(chosen.kicker, x + w / 2, y + h * 0.55, Math.max(6, 8 * scale), ink, 'middle', 'Inter, Arial, sans-serif');
  }

  function yardSignScene(design, template, angle, brand) {
    const tpl = template || YARD_TEMPLATES[0];
    const chosen = angle || ANGLES[0];
    const fill = tpl.fill;
    const ink = tpl.ink;
    const band = tpl.band || ink;
    const signW = 70;
    const signH = 78;
    const x = (160 - signW) / 2;
    const y = 8;
    const cx = 80;
    const phone = brandPhone(brand);
    const font = tpl.layout === 'marker' ? 'Caveat, Segoe Print, cursive' : 'Bebas Neue, Impact, sans-serif';
    let face = '<rect x="' + px(x) + '" y="' + px(y) + '" width="' + px(signW) + '" height="8" fill="' + band + '"/>';
    if (tpl.layout === 'sold') {
      face += displayType('SOLD', cx, y + 48, 28, ink, 'middle', font);
    } else if (tpl.layout === 'phone') {
      face += displayType('WE BUY', cx, y + 24, 12, ink, 'middle', font);
      face += displayType('555', cx, y + 46, 20, ink, 'middle', 'Bebas Neue, Impact, sans-serif');
      face += displayType('0100', cx, y + 66, 20, ink, 'middle', 'Bebas Neue, Impact, sans-serif');
    } else if (tpl.layout === 'cash') {
      face += displayType('CASH', cx, y + 32, 18, ink, 'middle', font);
      face += displayType('OFFER', cx, y + 50, 16, ink, 'middle', font);
      face += displayType(phone, cx, y + signH - 10, 12, ink, 'middle', 'Bebas Neue, Impact, sans-serif');
    } else if (tpl.layout === 'marker') {
      face += writeLines('shopping-list', ['We buy', 'houses'], x + 10, y + 36, 9, ink);
      face += displayType(phone, cx, y + signH - 12, 11, ink, 'middle', 'Caveat, Segoe Print, cursive');
    } else {
      const lines = chosen.headline || ['WE BUY', 'HOUSES'];
      face += displayType(lines[0], cx, y + 30, 15, ink, 'middle', font);
      face += displayType(lines[1], cx, y + 46, 15, ink, 'middle', font);
      face += displayType(phone, cx, y + signH - 10, 13, ink, 'middle', 'Bebas Neue, Impact, sans-serif');
    }
    return '<rect width="160" height="110" fill="#d5e4f0"/>' +
      '<path d="M0 78 Q40 72 80 80 T160 76 V110 H0 Z" fill="#7eaa62"/>' +
      '<line x1="' + cx + '" y1="' + px(y + signH) + '" x2="' + cx + '" y2="100" stroke="#5c5346" stroke-width="1.7"/>' +
      '<path d="M' + cx + ' 100 l-9 8 M' + cx + ' 100 l9 8" stroke="#5c5346" stroke-width="1.7" data-stake="step-in"/>' +
      paperShadow(x, y, signW, signH) +
      '<rect x="' + px(x) + '" y="' + px(y) + '" width="' + px(signW) + '" height="' + px(signH) + '" rx="1" fill="' + fill + '" stroke="' + band + '" stroke-width="1.4"/>' +
      face;
  }

  function stylePreview(channelId, choiceId, extra) {
    const more = extra || {};
    const id = String(channelId || '');
    const choice = String(choiceId || '');
    const design = normalizeDesign(id, more.design);
    if (more.template) design.template = more.template;
    if (more.swatch || (more.design && more.design.swatch)) design.swatch = true;
    const hand = more.hand || 'hi-clarice';
    const angle = angleById(more.angle, more.propertyClass) || ANGLES[0];
    const brand = more.brand || {};
    const template = templateById(id, design.template);
    const swatch = !!design.swatch;
    let inner = '';
    if (id === 'bandit') inner = banditScene(id, design, template, angle, brand, swatch);
    else if (id === 'yard-sign') inner = yardSignScene(design, template, angle, brand);
    else if (id === 'yellow-letter') inner = yellowLetterArt(template, angle, brand, hand, design.ink);
    else if (id === 'jumbo-postcard') inner = cardFace({ x: 8, y: 14, w: 144, h: 82 }, template, angle, brand);
    else if (id === 'offer-letter') inner = offerArt(template, angle, brand);
    else if (id === 'door-hanger') inner = hangerLook(design, template, angle, brand);
    else if (id === 'letter' && template && template.id !== 'classic') inner = cardFace({ x: 36, y: 12, w: 88, h: 86 }, template, angle, brand);
    else if (id === 'letter') inner = letterArt(choice === 'color' ? 'color' : 'bw', design.envelope) + displayType(angle.kicker, 80, 104, 8, '#1c2430', 'middle', 'Inter, Arial, sans-serif');
    else if (id === 'handwritten' && (choice === '4x6' || choice === '6x9') && (!template || template.id === 'classic')) inner = handwrittenCardArt(choice, hand, design.ink) + displayType(angle.kicker, 80, 104, 8, '#1c2430', 'middle', 'Inter, Arial, sans-serif');
    else if (id === 'handwritten' && (choice === '4x6' || choice === '6x9')) inner = cardFace(postcardBox(choice), template, angle, brand, inkFill(design.ink));
    else if (id === 'handwritten' && (!template || template.id === 'classic')) inner = noteArt(hand, design.ink) + displayType(angle.kicker, 80, 106, 8, '#1c2430', 'middle', 'Inter, Arial, sans-serif');
    else if (id === 'handwritten') inner = cardFace({ x: 28, y: 16, w: 104, h: 78 }, template, angle, brand, inkFill(design.ink));
    else if (template && template.id !== 'classic') inner = cardFace(postcardBox(choice || '4x6'), template, angle, brand);
    else inner = postcardArt(choice || '4x6') + displayType(angle.kicker, 80, 104, 8, '#1c2430', 'middle', 'Inter, Arial, sans-serif');
    return frameSvg(inner);
  }

  // Longest names first. The output filter is the second lock, after the prompt rule.
  const VENDOR_RULES = [
    ['PropertyRadar', "FORGE's lead data"],
    ['Property Radar', "FORGE's lead data"],
    ['BatchData', "FORGE's lead data"],
    ['Batch Data', "FORGE's lead data"],
    ['QualitySkip', "FORGE's lead data"],
    ['Click2Mail', "FORGE's mail service"],
    ['PostGrid', "FORGE's mail service"],
    ['Thanks.io', "FORGE's mail service"],
    ['Thanksio', "FORGE's mail service"],
    ['Wise Pelican', "FORGE's print service"],
    ['WisePelican', "FORGE's print service"],
    ['DirtCheapSigns', "FORGE's print service"],
    ['Dirt Cheap Signs', "FORGE's print service"],
    ['AmericasPrinter', "FORGE's print service"],
    ['CheckThatPhone', 'a scrub service'],
    ['NumberBroom', 'a scrub service'],
    ['TCPA Lookup', 'a scrub service'],
    ['SmartyStreets', "FORGE's mail service"],
    ['Amazon SES', 'your own email platform'],
    ['GoHighLevel', 'your own platform'],
    ['HighLevel', 'your own platform'],
    ['Pitney Bowes', 'the postal service'],
    ['Vistaprint', "FORGE's print service"],
    ['UPrinting', "FORGE's print service"],
    ['RaahSign', "FORGE's print service"],
    ['Henley Printing', "FORGE's print service"],
    ['MaxQ Printing', "FORGE's print service"],
    ['55 Printing', "FORGE's print service"],
    ['Twilio', 'your own text platform'],
    ['Smarty', "FORGE's mail service"],
    ['4over', "FORGE's print service"],
    ['Lob', "FORGE's mail service"],
  ];

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function filterVendorNames(text) {
    let out = String(text == null ? '' : text);
    VENDOR_RULES.forEach(function (rule) {
      const pattern = new RegExp('\\b' + escapeRegExp(rule[0]).replace(/\\\./g, '\\.') + '\\b', 'gi');
      out = out.replace(pattern, rule[1]);
    });
    return out;
  }

  function containsVendorName(text) {
    const value = String(text == null ? '' : text);
    return VENDOR_RULES.some(function (rule) {
      const pattern = new RegExp('\\b' + escapeRegExp(rule[0]).replace(/\\\./g, '\\.') + '\\b', 'i');
      return pattern.test(value);
    });
  }

  function channelById(id) {
    return BY_ID[String(id || '')] || null;
  }

  function classifyPropertyType(type, units) {
    const unitCount = Number(units);
    const raw = String(type || '').trim().toLowerCase();
    if (Number.isFinite(unitCount) && unitCount >= 5) return 'commercial';
    if (/apartment|5\s*\+|five\s*\+|retail|office|industrial|warehouse|\bflex\b|garage|mixed[-\s]?use|self[-\s]?storage|\bland\b|\bhotel\b/.test(raw)) return 'commercial';
    if (raw === 'apt' || raw === 'lnd' || raw === 'com' || raw === 'ind' || raw === 'agr') return 'commercial';
    if (Number.isFinite(unitCount) && unitCount >= 1 && unitCount <= 4) return 'residential';
    if (/single[-\s]?family|\bsfr\b|condo|town\s?home|townhouse|duplex|triplex|fourplex|quadplex|manufactured|mobile home|\bresidential\b|\bres\b|\bpud\b|\bcabin\b/.test(raw)) return 'residential';
    if (raw === 'sfr' || raw === 'cnd' || raw === 'res') return 'residential';
    return 'unknown';
  }

  function classifyLead(lead) {
    const row = lead || {};
    const details = row.details || {};
    if (row.assignedClass === 'residential' || row.assignedClass === 'commercial') return row.assignedClass;
    const units = row.units != null ? row.units : (details.units != null ? details.units : details.unitCount);
    const type = row.propertyType != null ? row.propertyType : details.propertyType;
    return classifyPropertyType(type, units);
  }

  function splitLeads(leads) {
    const out = { residential: [], commercial: [], unknown: [] };
    (leads || []).forEach(function (lead) {
      const cls = classifyLead(lead);
      out[cls].push(lead);
    });
    return out;
  }

  function channelsForClass(propertyClass) {
    const commercial = propertyClass === 'commercial';
    return CHANNELS.filter(function (channel) {
      return commercial ? channel.commercial : channel.residential;
    });
  }

  function recommendChannelIds(input) {
    const opts = input || {};
    const commercial = opts.propertyClass === 'commercial';
    const goal = String(opts.goal || 'sellers');
    const ids = commercial
      ? ['letter', 'call', 'networking', 'social']
      : ['postcard', 'handwritten', 'door-knock', 'bandit', 'letter'];
    if (goal === 'buyers') ids.push('email', 'seller-page');
    if (goal === 'followup') ids.push('email');
    const allowed = {};
    channelsForClass(opts.propertyClass).forEach(function (channel) { allowed[channel.id] = true; });
    const seen = {};
    return ids.filter(function (id) {
      if (!allowed[id] || seen[id]) return false;
      seen[id] = true;
      return true;
    });
  }

  function recommendationText(propertyClass) {
    if (propertyClass === 'commercial') {
      return 'For a commercial list I would start with a formal letter, a call script for the decision maker, and networking. Bandit signs and door hangers are not offered on commercial marketing. Cadence stays slower, with more value in each touch.';
    }
    return 'For a residential list I would start with a postcard, a handwritten-style note, and a door-knock script, then a letter. You run the calls, texts, and door knocking yourself. Mail from FORGE is in test mode, so nothing is really printed yet.';
  }

  function displayName(channel, propertyClass) {
    if (!channel) return '';
    if (propertyClass === 'commercial' && channel.commercialName) return channel.commercialName;
    return channel.name;
  }

  function displayDescription(channel, propertyClass) {
    if (!channel) return '';
    if (propertyClass === 'commercial' && channel.commercialDescription) return channel.commercialDescription;
    return channel.description;
  }

  function visibleChannels(input) {
    const opts = input || {};
    const recommended = recommendChannelIds(opts);
    const rank = {};
    recommended.forEach(function (id, index) { rank[id] = index; });
    let list = channelsForClass(opts.propertyClass);
    if (opts.filter === 'fulfill') list = list.filter(function (channel) { return channel.group === 'fulfill'; });
    if (opts.filter === 'copy') list = list.filter(function (channel) { return channel.group === 'copy'; });
    if (opts.recommendedFirst !== false) {
      list = list.slice().sort(function (a, b) {
        const ar = Object.prototype.hasOwnProperty.call(rank, a.id) ? rank[a.id] : 100;
        const br = Object.prototype.hasOwnProperty.call(rank, b.id) ? rank[b.id] : 100;
        return ar - br;
      });
    }
    return list.map(function (channel) {
      return { channel: channel, recommended: Object.prototype.hasOwnProperty.call(rank, channel.id) };
    });
  }

  function addressLine(lead) {
    const row = lead || SAMPLE_LEAD;
    const city = [row.city, [row.state, row.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    return [row.address, city].filter(Boolean).join(', ');
  }

  function senderName(ctx) {
    const brand = (ctx && ctx.brand) || {};
    const sender = (ctx && ctx.sender) || {};
    return brand.businessName || brand.signOff || sender.name || 'your name';
  }

  function senderPhone(ctx) {
    const brand = (ctx && ctx.brand) || {};
    const sender = (ctx && ctx.sender) || {};
    return brand.phone || sender.phone || 'your phone';
  }

  function postalBlock(ctx) {
    const brand = (ctx && ctx.brand) || {};
    const addr = brand.returnAddress || {};
    const line = [addr.line1, addr.line2, [addr.city, addr.state, addr.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    return line || '[your postal address]';
  }

  function starterPiece(channelId, ctx) {
    const channel = channelById(channelId);
    if (!channel || channel.copy === false) return null;
    const context = ctx || {};
    const lead = (context.leads && context.leads[0]) || SAMPLE_LEAD;
    const where = addressLine(lead);
    const name = senderName(context);
    const phone = senderPhone(context);
    const owner = lead.owner || 'there';
    const commercial = context.propertyClass === 'commercial';
    const soft = context.softTone === true;
    const sign = (context.brand && context.brand.signOff) || name;
    const disclosure = (context.brand && context.brand.disclosure) || DISCLOSURE_DEFAULT;
    let a = '';
    let b = '';
    if (channel.id === 'text') {
      a = 'Hi ' + owner + ', this is ' + name + '. You asked me to text about ' + where + '. I buy real estate as-is. Call or text ' + phone + ' if you want to talk. Reply STOP to opt out.';
      b = owner + ', ' + name + ' here. Following up on ' + where + ' since you opted in. No repairs, no agent fees. ' + phone + '. Reply STOP to opt out.';
    } else if (channel.id === 'email') {
      a = 'Subject: ' + where + '\n\nHi ' + owner + ',\n\nI am ' + name + ', a local investor. If you want a simple as-is offer on ' + where + ', I can close on your timeline. No repairs and no agent fees.\n\n' + sign + '\n' + phone + '\n' + postalBlock(context) + '\n\nUnsubscribe: reply to this email with "unsubscribe".\n' + disclosure;
      b = 'Subject: A simple option for ' + where + '\n\nHi ' + owner + ',\n\nI buy houses in this area and I can make this easy if ' + where + ' is more than you want to manage. There is no cost to talk.\n\n' + sign + '\n' + phone + '\n' + postalBlock(context) + '\n\nUnsubscribe: reply with "unsubscribe".\n' + disclosure;
    } else if (channel.id === 'call') {
      a = commercial
        ? 'Opening: This is ' + name + '. I am calling about ' + where + '. I am an investor, not a broker. Who is the person who decides on a sale? I can talk through an income-based range, seller financing, or a straightforward as-is close. ' + phone + '.'
        : 'Opening: Hi, this is ' + name + '. I buy houses in the area and I am calling about ' + where + '. If a simple as-is sale would help, I can walk through it. There is no cost to talk. ' + phone + '.\nVoicemail: Same introduction, one ask, and the phone number twice.\nObjection: If they say they are not selling, thank them and ask if you may check back later.';
      b = 'Opening: Hi ' + owner + ', ' + name + ' here. I am a local investor. Would it be useful to hear what an as-is sale of ' + where + ' could look like, with no repairs and no agent fees? If now is a bad time, I can call back. ' + phone + '.';
    } else if (channel.id === 'door-knock') {
      a = 'Hi, I am ' + name + ', a local investor. I am not an agent. I am working in the neighborhood and wanted to ask, person to person, if you have thought about selling ' + where + ' as-is. If this is a bad time I will leave. My phone is ' + phone + '.\nSafety: go in daylight, stay on the walk, leave when asked, and do not step inside.';
      b = 'Short version: "I buy houses as-is, no repairs and no agent fees. If ' + where + ' is more work than you want, here is my number, ' + phone + '. If you would rather I not stop by again, tell me and I will not."';
    } else if (channel.id === 'bandit' || channel.id === 'yard-sign') {
      a = 'WE BUY HOUSES\nAS-IS · CASH · FAST\n' + phone;
      b = name.toUpperCase() + '\nLOCAL HOME BUYER\n' + phone;
    } else if (channel.id === 'social') {
      a = commercial
        ? 'I buy commercial property in this market, including buildings that need an operator who can look at vacancy, deferred maintenance, or a 1031. If you own one and want a direct conversation, message me. ' + name + ' · ' + phone
        : 'I buy houses as-is in this area. No repairs, no agent fees, and you pick the closing date. If you have been thinking about selling, send me the address. ' + name + ' · ' + phone;
      b = 'Looking for off-market real estate. Homeowners and other investors can reach me directly. ' + name + ' · ' + phone + '. I am an independent investor, not a listing agent.';
    } else if (channel.id === 'seller-page') {
      a = 'Headline: Sell your property as-is.\nPage: I am ' + name + '. I buy real estate directly from owners. You will see an honest conversation, not a listing pitch. Call or text ' + phone + '. ' + disclosure;
      b = 'Ad: Local investor buying as-is. No repairs. No agent fees.\nPage: Tell me about the property. I will follow up myself. ' + phone + '.';
    } else if (channel.id === 'networking') {
      a = commercial
        ? 'I am ' + name + ', an independent investor looking for commercial opportunities in this market: 5+ units, retail, office, industrial, or land. If you represent an owner who wants a direct buyer, I would like to compare notes. ' + phone + '.'
        : 'I am ' + name + '. I buy residential real estate as-is in this market. If you hear of an owner who wants a simple close, I am glad to take the introduction. ' + phone + '.';
      b = 'Following up, ' + name + ' here. I am still buying in this market and I close on the owner\'s timeline. ' + phone + '. ' + disclosure;
    } else if (soft) {
      a = 'Hi ' + owner + ', I am ' + name + '. I work with homeowners who want to understand their options on ' + where + ' before things get harder. I may be able to buy the home, or point you toward other options. There is no cost to talk. ' + phone + '. ' + disclosure;
      b = 'Hi ' + owner + ', I am ' + name + '. If you have ended up with ' + where + ' and do not want to deal with the cleanup or the market, I can buy it as-is and handle the details. If you would rather keep it, I am glad to point you in a good direction. ' + phone + '.';
    } else if (commercial && channel.id === 'letter') {
      a = 'Hello,\n\nI am ' + name + ', an independent investor. I am writing about ' + where + '. If the ownership group wants to talk through an as-is sale, seller financing, or an income-based range (a rough range, not an appraisal), I am the person to call. ' + phone + '.\n\n' + sign + '\n' + postalBlock(context) + '\n' + disclosure;
      b = 'Hello,\n\n' + name + ' here. Investors who own ' + where + ' sometimes want a direct conversation about vacancy, deferred maintenance, or a 1031 exchange. I buy property myself. There is no cost to talk. ' + phone + '.\n\n' + sign;
    } else {
      a = 'Hi ' + owner + ', I am ' + name + ', a local investor. If managing ' + where + ' has stopped being worth the hassle, I can make a simple cash offer, as-is, no repairs, no agent fees, and close when you want. A quick call or text to ' + phone + ' is all it takes. ' + disclosure;
      b = 'Hi ' + owner + ', I am ' + name + '. I buy houses in this area and I can make the sale of ' + where + ' simple: as-is, no showings, and a closing date you choose. If you would rather not sell, no problem. ' + phone + '.';
    }
    const angle = angleById(context.angle, commercial ? 'commercial' : 'residential');
    if (angle) {
      a = angle.opener + '\n' + a;
      b = angle.alt + '\n' + b;
    }
    return {
      channel: channel.id,
      variantA: filterVendorNames(a),
      variantB: filterVendorNames(b),
      source: 'template',
    };
  }

  function artSvg(id) {
    const common = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 96" fill="none"';
    const frames = {
      postcard: '<rect x="28" y="16" width="104" height="64" rx="4" fill="#F4EFE4" stroke="#C89B3C"/><rect x="40" y="28" width="46" height="4" fill="#1F3348"/><rect x="40" y="38" width="36" height="3" fill="#8AA0B4"/><rect x="108" y="52" width="14" height="14" fill="#1F3348"/>',
      letter: '<rect x="48" y="12" width="64" height="72" rx="2" fill="#F7F5F2" stroke="#C89B3C"/><path d="M48 12 l32 26 l32 -26" stroke="#C89B3C"/><rect x="60" y="48" width="40" height="3" fill="#8AA0B4"/><rect x="60" y="56" width="32" height="3" fill="#8AA0B4"/>',
      handwritten: '<rect x="36" y="18" width="88" height="60" rx="3" fill="#F6E7A8" stroke="#C89B3C" transform="rotate(-4 80 48)"/><path d="M52 40 q20 8 36 -2" stroke="#1F3348" stroke-width="1.4"/><path d="M52 52 q24 10 40 0" stroke="#1F3348" stroke-width="1.4"/>',
      'door-hanger': '<path d="M70 10 h20 a10 10 0 0 1 0 20 h-20 a10 10 0 0 1 0 -20 z" fill="#F4EFE4" stroke="#C89B3C"/><rect x="68" y="28" width="24" height="58" rx="3" fill="#F4EFE4" stroke="#C89B3C"/><circle cx="80" cy="20" r="4" fill="#0D1B2A"/>',
      bandit: '<rect x="28" y="22" width="104" height="52" rx="2" fill="#F5D90A" stroke="#1F3348"/><rect x="40" y="34" width="80" height="6" fill="#1F3348"/><rect x="48" y="48" width="64" height="5" fill="#1F3348"/><path d="M80 74 v14" stroke="#8AA0B4" stroke-width="3"/>',
      'yard-sign': '<rect x="36" y="16" width="88" height="48" rx="2" fill="#F4EFE4" stroke="#C89B3C"/><path d="M80 64 v20 M68 84 h24" stroke="#8AA0B4" stroke-width="3"/>',
      'skip-trace': '<circle cx="70" cy="40" r="18" stroke="#C89B3C" stroke-width="3"/><path d="M84 54 l16 16" stroke="#C89B3C" stroke-width="3"/>',
      'phone-scrub': '<rect x="62" y="16" width="36" height="64" rx="6" stroke="#8AA0B4" stroke-width="2"/><path d="M70 34 h20 M70 44 h14" stroke="#22c55e"/>',
      'list-pull': '<rect x="40" y="18" width="80" height="60" rx="3" stroke="#C89B3C"/><path d="M52 34 h56 M52 46 h56 M52 58 h36" stroke="#8AA0B4"/>',
      call: '<rect x="58" y="18" width="44" height="60" rx="6" fill="#12324A" stroke="#C89B3C"/><circle cx="80" cy="64" r="4" fill="#C89B3C"/>',
      'door-knock': '<path d="M78 70 v14 M70 84 h16" stroke="#C89B3C"/><circle cx="78" cy="40" r="16" stroke="#F4EFE4" stroke-width="2"/><path d="M78 28 v10" stroke="#F4EFE4"/>',
      email: '<rect x="32" y="24" width="96" height="52" rx="4" stroke="#C89B3C"/><path d="M32 28 l48 30 l48 -30" stroke="#C89B3C"/>',
      text: '<rect x="36" y="20" width="52" height="28" rx="8" fill="#1F3348" stroke="#C89B3C"/><rect x="72" y="48" width="52" height="28" rx="8" fill="#F4EFE4"/>',
      social: '<rect x="28" y="20" width="104" height="56" rx="6" stroke="#C89B3C"/><circle cx="52" cy="48" r="10" stroke="#8AA0B4"/><path d="M70 42 h40 M70 54 h28" stroke="#8AA0B4"/>',
      'seller-page': '<rect x="36" y="14" width="88" height="68" rx="3" stroke="#C89B3C"/><rect x="36" y="14" width="88" height="12" fill="#1F3348"/><rect x="48" y="38" width="40" height="4" fill="#C89B3C"/>',
      networking: '<circle cx="60" cy="40" r="12" stroke="#C89B3C"/><circle cx="100" cy="40" r="12" stroke="#C89B3C"/><path d="M72 40 h16" stroke="#8AA0B4"/>',
    };
    return '<svg ' + common + '>' + (frames[id] || frames.postcard) + '</svg>';
  }

  return {
    DISCLOSURE_DEFAULT: DISCLOSURE_DEFAULT,
    RIGHTS_TEXT: RIGHTS_TEXT,
    ATTESTATION_TEXT: ATTESTATION_TEXT,
    ATTESTATION_VERSION: ATTESTATION_VERSION,
    COMPLIANCE_REMINDER: COMPLIANCE_REMINDER,
    STUDENT_NOTICE: STUDENT_NOTICE,
    INFO_ONLY_LABEL: INFO_ONLY_LABEL,
    SAMPLE_LEAD: SAMPLE_LEAD,
    CHANNELS: CHANNELS,
    VENDOR_RULES: VENDOR_RULES,
    channelById: channelById,
    classifyPropertyType: classifyPropertyType,
    classifyLead: classifyLead,
    splitLeads: splitLeads,
    channelsForClass: channelsForClass,
    recommendChannelIds: recommendChannelIds,
    recommendationText: recommendationText,
    displayName: displayName,
    displayDescription: displayDescription,
    visibleChannels: visibleChannels,
    addressLine: addressLine,
    filterVendorNames: filterVendorNames,
    containsVendorName: containsVendorName,
    starterPiece: starterPiece,
    artSvg: artSvg,
    PRINT_SPECS: PRINT_SPECS,
    printSpec: printSpec,
    pieceStyle: pieceStyle,
    stylePreview: stylePreview,
    anglesFor: anglesFor,
    angleById: angleById,
    templatesFor: templatesFor,
    normalizeDesign: normalizeDesign,
    designOrderable: designOrderable,
    priceMode: priceMode,
    ANGLES: ANGLES,
  };
});
