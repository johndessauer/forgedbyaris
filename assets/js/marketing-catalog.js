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
    { id: 'handwritten', name: 'Handwritten note', description: 'A folded notecard with a real stamp and a handwritten envelope. Pick the handwriting.', group: 'fulfill', medium: 'mail', residential: true, commercial: true },
    { id: 'door-hanger', name: 'Door hanger', description: 'Coming soon. A 50-pack reference price is shown. Not mailed to a property. Residential only.', group: 'fulfill', medium: 'print', residential: true, commercial: false },
    { id: 'yard-sign', name: 'Yard sign', description: '18 × 24 on a wire step-in stake. Cash offer, any condition, or sold. Coming soon. Not sent to a property. Residential only.', group: 'fulfill', medium: 'print', residential: true, commercial: false, comingSoon: true, selectable: false },
    { id: 'yellow-letter', name: 'Yellow letter', description: 'A handwritten letter on yellow lined paper, mailed in an envelope. Pick the handwriting.', group: 'fulfill', medium: 'mail', residential: true, commercial: true },
    { id: 'jumbo-postcard', name: 'Jumbo postcard', description: 'A 6 × 11 postcard, mailed First Class. One per property.', group: 'fulfill', medium: 'mail', residential: true, commercial: true },
    { id: 'offer-letter', name: 'Offer letter', description: 'A one-page offer in a #10 envelope, printed in color and mailed First Class. It invites a conversation. It is not a binding offer.', group: 'fulfill', medium: 'mail', residential: true, commercial: true },
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
    'yard-sign': spec([50, 100], SIGN_OPTION, true),
    'door-hanger': spec([50], [['4.25x11', '4.25 × 11']], true),
  });

  // Everyday Thanks.io hands, chosen from the public sample images.
  // Shopping List is the default: casual cursive, not a formal script.
  const HAND_CHOICES = [
    ['shopping-list', 'Shopping List'],
    ['normal-print', 'Normal Print'],
    ['lazy-note', 'Lazy Note'],
    ['blurred-lines', 'Blurred Lines'],
    ['that-dude', 'That Dude'],
  ];

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
    'jumbo-postcard': styleSpec('size', '6x11', [
      ['6x11', '6 × 11'],
    ]),
    'offer-letter': styleSpec('finish', 'color', [
      ['color', 'Color'],
    ]),
    handwritten: styleSpec('product', 'notecard', [
      ['notecard', 'Folded notecard'],
      ['4x6', '4 × 6 postcard'],
      ['6x9', '6 × 9 postcard'],
    ], {
      hands: HAND_CHOICES,
      handDefault: 'shopping-list',
      ink: 'blue',
    }),
    'yellow-letter': styleSpec('paper', 'lined', [
      ['lined', 'Yellow lined'],
    ], {
      hands: HAND_CHOICES,
      handDefault: 'shopping-list',
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

  const ANGLES = [
    { id: 'cash', label: 'Cash Offer', residential: true, commercial: true, kicker: 'CASH OFFER', headline: ['CASH', 'OFFER'], card: 'Cash offer. As-is.', opener: 'A cash offer, as-is, with no repairs and no agent fees.', alt: 'A simple cash sale, with no repairs and no agent fees.', guard: 'Do not promise a price.', mailHeadline: 'A cash offer. As-is.', mailSub: 'No repairs. No agent fees. You choose the date.', bullets: ['Cash, as-is', 'No repairs first', 'You pick the date'], paragraphs: ["I'm looking to buy a home in your neighborhood, and I can make the next step simple.", 'If you want a cash offer as-is, with no repairs and no agent fees, I am ready to talk.', 'A short call is enough to see if a sale makes sense.', 'If now is not the time, set this aside. There is no cost to talk.'], ps: 'P.S. Call or text when you want a straightforward conversation.' },
    { id: 'prefore', label: 'Behind on Payments / Pre-foreclosure', residential: true, commercial: true, kicker: 'OPTIONS', headline: ['BEHIND?', 'OPTIONS'], card: 'A private option.', opener: 'If the payments have gotten hard, there may be a private option.', alt: 'I can talk through options. I will not pretend to know your file.', guard: 'Do not say you know they are behind or in foreclosure.', mailHeadline: 'A private option.', mailSub: 'If the payments have gotten hard, there may be another path.', bullets: ['A private talk', 'As-is sale', 'No listing'], paragraphs: ['If the payments have gotten hard, there may be a private option.', 'I buy houses as-is. I will not pretend to know your file, and this is not a notice.', 'A conversation can cover a simple sale, with no repairs and no showings.', 'There is no cost to talk, and you can say no.'], ps: 'P.S. This is an invitation to talk, not a statement about your mortgage.' },
    { id: 'probate', label: 'Inherited / Probate', residential: true, commercial: true, kicker: 'INHERITED', headline: ['INHERITED?', 'WE HELP'], card: 'A simple way to sell.', opener: 'If you inherited a property and want a simple way to sell, I can help.', alt: 'No clean-out required before a conversation.', guard: 'Do not say you know they inherited it.', mailHeadline: 'A simple way to sell.', mailSub: 'If you inherited a property, you do not have to handle it alone.', bullets: ['No clean-out first', 'As-is', 'Your timeline'], paragraphs: ['If you inherited a property and want a simple way to sell, I can help.', 'I buy as-is. No clean-out is required before a conversation.', 'I do not assume how the property came to you. If a sale would help, we can talk.', 'If you would rather keep it, that is fine too.'], ps: 'P.S. One call is enough to see whether a sale would help.' },
    { id: 'landlord', label: 'Tired Landlord', residential: true, commercial: true, kicker: 'TIRED?', headline: ['TIRED', 'LANDLORD'], card: 'Sell the rental as-is.', opener: 'If the rentals are more work than they are worth, I buy as-is.', alt: 'No showings and no repairs before we talk.', guard: 'Do not claim you know their rents.', mailHeadline: 'Sell the rental as-is.', mailSub: 'If the rentals are more work than they are worth, there is a direct buyer.', bullets: ['No showings', 'No repairs', 'As-is'], paragraphs: ['If the rentals are more work than they are worth, I buy as-is.', 'No showings and no repairs are required before we talk.', 'I will not guess your rents. A direct conversation is enough.', 'You choose whether a sale makes sense.'], ps: 'P.S. I buy the property. I am not asking to manage it.' },
    { id: 'vacant', label: 'Vacant Property', residential: true, commercial: true, kicker: 'VACANT', headline: ['VACANT?', 'CASH'], card: 'A cash offer for an empty house.', opener: 'If the property is sitting empty, I can make a cash offer as-is.', alt: 'A direct buyer for a house that is not being used.', guard: 'Do not say you inspected the property.', mailHeadline: 'A cash offer for an empty house.', mailSub: 'If the property is sitting empty, it does not have to stay that way.', bullets: ['Cash offer', 'As-is', 'No repairs'], paragraphs: ['If the property is sitting empty, I can make a cash offer as-is.', 'I have not inspected it, and I will not pretend that I have.', 'No repairs and no clean-out are required before a conversation.', 'If you want a direct buyer, call or text.'], ps: 'P.S. An empty house can still be a simple sale.' },
    { id: 'divorce', label: 'Divorce', residential: true, commercial: false, kicker: 'SIMPLE SALE', headline: ['SIMPLE', 'SALE'], card: 'A sale on your timeline.', opener: 'If you need a simple sale on your timeline, I buy as-is.', alt: 'One conversation. No listing and no repairs.', guard: 'Do not say you know about a divorce.', mailHeadline: 'A sale on your timeline.', mailSub: 'A simple as-is sale, with no listing and no repairs.', bullets: ['Your timeline', 'No listing', 'No repairs'], paragraphs: ['If you need a simple sale on your timeline, I buy as-is.', 'One conversation. No listing and no repairs.', 'I will not assume anything about your situation. This is only an offer to talk.', 'You can say no, and that is the end of it.'], ps: 'P.S. You set the pace. A short call is enough.' },
    { id: 'repairs', label: 'Code Violations / Repairs', residential: true, commercial: true, kicker: 'NO REPAIRS', headline: ['NO', 'REPAIRS'], card: 'No repairs first.', opener: 'No repairs first. I can still make an as-is cash offer.', alt: 'Leave the repairs. I can still make an as-is offer.', guard: 'Do not say you know about a code case.', mailHeadline: 'No repairs first.', mailSub: 'Leave the work. An as-is offer can still start with a call.', bullets: ['No repairs', 'As-is cash', 'No clean-out'], paragraphs: ['No repairs first. I can still make an as-is cash offer.', 'Leave the work where it is. I do not need a perfect house to start a conversation.', 'I will not claim to know about any code case. This letter is only an invitation.', 'If a simple sale would help, call or text.'], ps: 'P.S. You do not have to fix anything before we talk.' },
    { id: 'expired', label: 'Expired Listing', residential: true, commercial: true, kicker: 'EXPIRED', headline: ['LISTING', 'EXPIRED?'], card: 'A direct buyer.', opener: 'If a listing already ran its course, I am a direct buyer.', alt: 'Skip another listing and talk to a buyer.', guard: 'Do not say you know their listing history.', mailHeadline: 'A direct buyer.', mailSub: 'If a listing already ran its course, you can talk to a buyer.', bullets: ['No new listing', 'As-is', 'Direct buyer'], paragraphs: ['If a listing already ran its course, I am a direct buyer.', 'You can skip another listing and talk to someone who buys the house.', 'I do not know your listing history, and I will not pretend to.', 'A short call is enough to see if an as-is sale fits.'], ps: 'P.S. This is a conversation with a buyer, not another listing pitch.' },
    { id: 'tax', label: 'Tax Delinquent', residential: true, commercial: true, kicker: 'TAXES', headline: ['BEHIND', 'ON TAXES?'], card: 'A private sale is one option.', opener: 'If the taxes are getting heavy, a private sale is one option.', alt: 'I buy as-is. This is a conversation, not a notice.', guard: 'Do not say you know they are tax delinquent.', mailHeadline: 'A private sale is one option.', mailSub: 'If the taxes are getting heavy, you can talk through a sale.', bullets: ['Private sale', 'As-is', 'No notice'], paragraphs: ['If the taxes are getting heavy, a private sale is one option.', 'I buy as-is. This is a conversation, not a notice.', 'I will not say I know your tax situation. You can tell me only what you want to.', 'There is no cost to talk.'], ps: 'P.S. This is not a bill and not a government notice.' },
    { id: 'neighbor', label: "Neighbor: I'm buying in your area", residential: true, commercial: false, kicker: 'NEARBY', headline: ['BUYING', 'NEARBY'], card: 'I am buying in this area.', opener: 'I am buying houses in your area.', alt: 'Your neighbor can sell as-is, with no agent fees.', guard: 'Do not pretend to live there if the brand does not say so.', mailHeadline: 'I am buying in this area.', mailSub: 'A neighbor can sell as-is, with no agent fees.', bullets: ['Buying nearby', 'As-is', 'No agent fees'], paragraphs: ['I am buying houses in your area.', 'Your neighbor can sell as-is, with no agent fees and no repairs first.', 'I will not pretend to live on the block unless that is actually true.', 'If you have thought about selling, a call or text is enough.'], ps: 'P.S. I am an independent buyer, reaching out to homeowners nearby.' },
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
    { id: 'cash-offer', label: 'Cash Offer', fill: '#f7f7f5', ink: '#1a1a1a', band: '#c1121f', layout: 'cash-offer', lines: ['CASH', 'OFFER'] },
    { id: 'any-condition', label: 'Any Condition', fill: '#f4f7fb', ink: '#143d7a', band: '#143d7a', layout: 'stack', lines: ['ANY', 'CONDITION'] },
    { id: 'sell-fast', label: 'Sell Fast', fill: '#fffdf8', ink: '#1c2430', band: '#1c2430', layout: 'stack', lines: ['SELL', 'FAST'] },
    { id: 'no-repairs', label: 'No Repairs', fill: '#fffdf8', ink: '#1a1a1a', band: '#c1121f', layout: 'marker', lines: ['No repairs', 'No fees'] },
    { id: 'sold', label: 'Sold', fill: '#c1121f', ink: '#ffffff', band: '#8d0c16', layout: 'sold', lines: ['SOLD'] },
    { id: 'call', label: 'Call', fill: '#f7f7f5', ink: '#1a1a1a', band: '#c1121f', layout: 'phone', lines: ['CALL'] },
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

  function designOrderable(id) {
    if (id === 'bandit' || id === 'yard-sign') return false;
    return true;
  }

  function priceMode(id, design) {
    const row = normalizeDesign(id, design);
    if (id === 'bandit' || id === 'yard-sign') return 'soon';
    if (id === 'letter' && row.envelope === 'plain') return 'soon';
    if (id === 'door-hanger') return row.hangerSize === '4.25x11' ? 'reference' : 'soon';
    return 'priced';
  }

  function previewMailer() {
    if (typeof module === 'object' && module.exports && typeof require === 'function') {
      return require('./marketing-mailer');
    }
    return globalThis.ForgeMarketingMailer;
  }

  function stylePreview(channelId, choiceId, extra) {
    const more = extra || {};
    const id = String(channelId || '');
    const design = normalizeDesign(id, more.design);
    if (more.template) design.template = more.template;
    if (more.swatch || (more.design && more.design.swatch)) design.swatch = true;
    const angle = angleById(more.angle, more.propertyClass) || ANGLES[0];
    return previewMailer().render({
      id: id,
      choice: String(choiceId || ''),
      design: design,
      template: templateById(id, design.template),
      swatch: !!design.swatch,
      hand: more.hand || 'shopping-list',
      angle: angle,
      brand: more.brand || {},
      commercial: more.propertyClass === 'commercial',
    });
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
      : ['postcard', 'handwritten', 'door-knock', 'letter'];
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

  function recommendationText(propertyClass, testMode) {
    if (propertyClass === 'commercial') {
      return 'For a commercial list I would start with a formal letter, a call script for the decision maker, and networking. Yard signs and door hangers are not offered on commercial marketing. Cadence stays slower, with more value in each touch.';
    }
    const mailLine = testMode === false
      ? ' Mail from FORGE is printed and sent.'
      : ' Mail from FORGE is in test mode, so nothing is really printed yet.';
    return 'For a residential list I would start with a postcard, a handwritten-style note, and a door-knock script, then a letter. You run the calls, texts, and door knocking yourself.' + mailLine;
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
      b = 'Subject: A simple option for ' + where + '\n\nHi ' + owner + ',\n\n' + (commercial ? "I'm looking to buy a property in your area" : "I'm looking to buy a home in your neighborhood") + ' and I can make this easy if ' + where + ' is more than you want to manage. There is no cost to talk.\n\n' + sign + '\n' + phone + '\n' + postalBlock(context) + '\n\nUnsubscribe: reply with "unsubscribe".\n' + disclosure;
    } else if (channel.id === 'call') {
      a = commercial
        ? 'Opening: This is ' + name + '. I am calling about ' + where + '. I am an investor, not a broker. Who is the person who decides on a sale? I can talk through an income-based range, seller financing, or a straightforward as-is close. ' + phone + '.'
        : 'Opening: Hi, this is ' + name + '. I buy houses in the area and I am calling about ' + where + '. If a simple as-is sale would help, I can walk through it. There is no cost to talk. ' + phone + '.\nVoicemail: Same introduction, one ask, and the phone number twice.\nObjection: If they say they are not selling, thank them and ask if you may check back later.';
      b = 'Opening: Hi ' + owner + ', ' + name + ' here. I am a local investor. Would it be useful to hear what an as-is sale of ' + where + ' could look like, with no repairs and no agent fees? If now is a bad time, I can call back. ' + phone + '.';
    } else if (channel.id === 'door-knock') {
      a = 'Hi, I am ' + name + ', a local investor. I am not an agent. I am working in the neighborhood and wanted to ask, person to person, if you have thought about selling ' + where + ' as-is. If this is a bad time I will leave. My phone is ' + phone + '.\nSafety: go in daylight, stay on the walk, leave when asked, and do not step inside.';
      b = 'Short version: "I buy houses as-is, no repairs and no agent fees. If ' + where + ' is more work than you want, here is my number, ' + phone + '. If you would rather I not stop by again, tell me and I will not."';
    } else if (channel.id === 'offer-letter') {
      a = 'Property: ' + where + '\n\nDear ' + owner + ',\n\nI would like to talk about a simple as-is sale of ' + where + '. This is an invitation to discuss, and it is not a binding offer. There is no cost to talk.\n\n' + name + '\n' + phone;
      b = 'Property: ' + where + '\n\nDear ' + owner + ',\n\nIf you want to hear what a sale of ' + where + ' could look like, I am glad to talk. This is not a binding offer, and you can say no.\n\n' + name + '\n' + phone;
    } else if (channel.id === 'handwritten' || channel.id === 'yellow-letter') {
      const ownerFirst = String(owner || 'there').trim().split(/\s+/)[0] || 'there';
      const mine = String(name || 'Sam').trim().split(/\s+/)[0] || 'Sam';
      const talk = commercial
        ? "I'm looking at a property in your area."
        : "I'm looking to buy a home in your neighborhood.";
      a = 'Hi ' + ownerFirst + ',\n\n' + talk + '\nNo repairs and no agent fees.\nA short call is enough.\n\n' + mine + '\n' + phone;
      b = 'Hi ' + ownerFirst + ',\n\nIf ' + where + ' is more than you want to keep, I can keep this simple.\nAs-is. Your timeline.\n\n' + mine + '\n' + phone;
    } else if (channel.id === 'yard-sign') {
      a = 'CASH OFFER\nANY CONDITION\n' + phone;
      b = 'SELL FAST\nNO REPAIRS · NO FEES\n' + phone;
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
      b = 'Hi ' + owner + ', I am ' + name + '. ' + (commercial ? "I'm looking to buy a property in your area" : "I'm looking to buy a home in your neighborhood") + ' and I can make the sale of ' + where + ' simple: as-is, no showings, and a closing date you choose. If you would rather not sell, no problem. ' + phone + '.';
    }
    const angle = angleById(context.angle, commercial ? 'commercial' : 'residential');
    if (angle && channel.id !== 'handwritten' && channel.id !== 'yellow-letter') {
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
