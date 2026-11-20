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
    { id: 'postcard', name: 'Postcard', description: 'Printed and mailed for you, postage included. A QR code tracks scans.', group: 'fulfill', medium: 'mail', price: '$1.09 per piece', residential: true, commercial: true },
    { id: 'letter', name: 'Letter', description: 'A plain-language one-page letter in your voice, mailed about 2 weeks after the postcard.', group: 'fulfill', medium: 'mail', price: '$0.99 per piece', residential: true, commercial: true },
    { id: 'handwritten', name: 'Handwritten-style note', description: 'A real-looking handwritten card. Higher cost, higher open rate.', group: 'fulfill', medium: 'mail', price: '$1.42 per piece', residential: true, commercial: true },
    { id: 'door-hanger', name: 'Door hanger', description: 'Printed 4.25 × 11 hangers shipped to you for door knocking. Residential only.', group: 'fulfill', medium: 'print', price: '$0.26 each plus shipping', residential: true, commercial: false },
    { id: 'flyer', name: 'Flyer', description: 'A 4×6 flyer shipped to you. On a commercial list this becomes a one-page property summary.', group: 'fulfill', medium: 'print', price: 'about $0.10 each plus shipping', residential: true, commercial: true, commercialName: 'One-page property summary', commercialDescription: 'A one-page property summary you can mail or hand to a decision maker.' },
    { id: 'bandit', name: 'Bandit sign', description: '18 × 24 weatherproof sign with stake, shipped to you. Check local sign rules. Residential only.', group: 'fulfill', medium: 'print', price: '$4.94 each plus shipping', residential: true, commercial: false },
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
      ? ['letter', 'call', 'networking', 'social', 'flyer']
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
    } else if (channel.id === 'bandit') {
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
    } else if (commercial && (channel.id === 'letter' || channel.id === 'flyer')) {
      a = 'Hello,\n\nI am ' + name + ', an independent investor. I am writing about ' + where + '. If the ownership group wants to talk through an as-is sale, seller financing, or an income-based range (a rough range, not an appraisal), I am the person to call. ' + phone + '.\n\n' + sign + '\n' + postalBlock(context) + '\n' + disclosure;
      b = 'Hello,\n\n' + name + ' here. Investors who own ' + where + ' sometimes want a direct conversation about vacancy, deferred maintenance, or a 1031 exchange. I buy property myself. There is no cost to talk. ' + phone + '.\n\n' + sign;
    } else {
      a = 'Hi ' + owner + ', I am ' + name + ', a local investor. If managing ' + where + ' has stopped being worth the hassle, I can make a simple cash offer, as-is, no repairs, no agent fees, and close when you want. A quick call or text to ' + phone + ' is all it takes. ' + disclosure;
      b = 'Hi ' + owner + ', I am ' + name + '. I buy houses in this area and I can make the sale of ' + where + ' simple: as-is, no showings, and a closing date you choose. If you would rather not sell, no problem. ' + phone + '.';
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
      flyer: '<rect x="46" y="10" width="68" height="76" rx="2" fill="#F7F5F2" stroke="#C89B3C"/><rect x="56" y="20" width="48" height="22" fill="#1F3348"/><rect x="56" y="50" width="40" height="3" fill="#8AA0B4"/><rect x="56" y="58" width="32" height="3" fill="#8AA0B4"/>',
      bandit: '<rect x="28" y="22" width="104" height="52" rx="2" fill="#F5D90A" stroke="#1F3348"/><rect x="40" y="34" width="80" height="6" fill="#1F3348"/><rect x="48" y="48" width="64" height="5" fill="#1F3348"/><path d="M80 74 v14" stroke="#8AA0B4" stroke-width="3"/>',
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
  };
});
