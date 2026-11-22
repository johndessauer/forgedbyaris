// Marketing campaign screen. Copy and export only.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ForgeMarketingApp = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function loadCatalog() {
    if (typeof globalThis !== 'undefined' && globalThis.ForgeMarketingCatalog) return globalThis.ForgeMarketingCatalog;
    return require('./marketing-catalog.js');
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function createState(seed) {
    var input = seed || {};
    return {
      view: 'flow',
      step: 1,
      goal: input.goal || 'sellers',
      propertyClass: input.propertyClass || 'residential',
      filter: input.filter || 'all',
      recommendedFirst: input.recommendedFirst !== false,
      selected: Object.assign({}, input.selected || {}),
      copies: {
        residential: Object.assign({}, (input.copies && input.copies.residential) || {}),
        commercial: Object.assign({}, (input.copies && input.copies.commercial) || {}),
      },
      approved: Object.assign({}, input.approved || {}),
      leads: Array.isArray(input.leads) ? input.leads.slice() : [],
      brands: Array.isArray(input.brands) ? input.brands.slice() : [],
      brandId: input.brandId || '',
      empire: !!input.empire,
      brandLimit: input.brandLimit || (input.empire ? 3 : 1),
      reviewer: !!input.reviewer,
      sender: input.sender || { name: '', phone: '' },
      previewId: input.previewId || '',
      message: '',
      reason: '',
      recommendation: '',
      attested: false,
      usingSample: false,
      editingId: '',
      addressError: '',
      fromSearch: !!input.fromSearch,
      showAddAddress: !!input.showAddAddress,
      goalNote: input.goalNote || '',
      swatches: Array.isArray(input.swatches) ? input.swatches.slice() : [],
      logoUrls: Object.assign({}, input.logoUrls || {}),
      quote: input.quote || null,
      styles: Object.assign({}, input.styles || {}),
      designs: Object.assign({}, input.designs || {}),
      angle: input.angle || 'cash',
      menu: input.menu || null,
      confirmKey: '',
      printKey: '',
      prints: Object.assign({}, input.prints || {}),
      shipTo: input.shipTo || null,
      shipTouched: !!input.shipTouched,
      zoomChannel: '',
    };
  }

  function activeBrand(state) {
    return (state.brands || []).filter(function (brand) { return brand.id === state.brandId; })[0] || null;
  }

  function split(state) {
    return loadCatalog().splitLeads(state.leads);
  }

  function unknownLeft(state) {
    return split(state).unknown.length;
  }

  function selectedIds(state) {
    return Object.keys(state.selected || {}).filter(function (id) { return state.selected[id]; });
  }

  function currentCopies(state) {
    return state.copies[state.propertyClass] || {};
  }

  function renderSteps(state) {
    var steps = [
      [1, 'Goal & list'],
      [2, 'Marketing type'],
      [3, 'Copy'],
      [4, 'Approve'],
      [5, 'Cost'],
      [6, 'Confirm'],
    ];
    return '<ol class="mkt-steps">' + steps.map(function (step) {
      var disabled = false;
      var cls = disabled ? 'is-disabled' : (state.step === step[0] ? 'is-current' : (state.step > step[0] ? 'is-done' : ''));
      var tag = disabled ? '<span>' : '<button type="button" data-action="step" data-step="' + step[0] + '">';
      var end = disabled ? '</span>' : '</button>';
      return '<li class="' + cls + '">' + tag + '<b>' + step[0] + '</b> ' + esc(step[1]) + (disabled ? ' · coming soon' : '') + end + '</li>';
    }).join('') + '</ol>';
  }

  function renderGoal(state) {
    var catalog = loadCatalog();
    var groups = split(state);
    var leads = state.leads || [];
    var brand = activeBrand(state);
    var mailMissing = brand ? mailMissingFields(brand) : ['business name', 'return address', 'phone'];
    var offer = !state.brandId
      ? '<div class="mkt-offer"><p>I can set up your Brand Kit in about two minutes: logo, colors, and the name and phone that go on every piece. You can skip it. Skipping uses a plain template with your name and phone, and no FORGE branding.</p><button type="button" data-action="show-brand">Set up Brand Kit</button></div>'
      : '';
    var summary = leads.length
      ? '<p class="mkt-count">You selected <strong>' + leads.length + '</strong> ' + (leads.length === 1 ? 'property' : 'properties') + (groups.residential.length ? ' · ' + groups.residential.length + ' residential' : '') + (groups.commercial.length ? ' · ' + groups.commercial.length + ' commercial' : '') + (groups.unknown.length ? ' · ' + groups.unknown.length + ' to assign' : '') + '.</p>'
      : '<p class="mkt-count">No properties are loaded. Start from Property Search, or use one sample property so you can see the flow. The sample is not a real address.</p><button type="button" class="mkt-secondary" data-action="use-sample">Use a sample property</button>';
    var unknown = groups.unknown.map(function (lead) {
      var current = lead.assignedClass || '';
      return '<li><span>' + esc(lead.address || 'Unknown address') + '</span> <select data-assign="' + esc(lead.id) + '"><option value="">Assign</option><option value="residential"' + (current === 'residential' ? ' selected' : '') + '>Residential</option><option value="commercial"' + (state.empire ? '' : ' disabled') + (current === 'commercial' ? ' selected' : '') + '>Commercial' + (state.empire ? '' : ' (Empire)') + '</option></select></li>';
    }).join('');
    var goals = [
      ['sellers', 'Find motivated sellers'],
      ['followup', 'Follow up on a lead list'],
      ['buyers', 'Market a real estate deal to cash buyers'],
    ].map(function (goal) {
      return '<label class="mkt-choice' + (state.goal === goal[0] ? ' is-on' : '') + '"><input type="radio" name="mkt-goal" value="' + goal[0] + '"' + (state.goal === goal[0] ? ' checked' : '') + '> ' + esc(goal[1]) + '</label>';
    }).join('');
    var commercialLock = !state.empire && groups.commercial.length
      ? '<p class="mkt-note">Commercial marketing is part of Empire. Those properties stay out of this campaign until the plan includes Empire.</p>'
      : '';
    var mailNote = mailMissing.length
      ? '<p class="mkt-note">Before any mail copy can be exported, the Brand Kit needs your ' + esc(mailMissing.join(', ')) + '. Logo, colors, and headshot stay optional.</p>'
      : '';
    return offer + summary + addressBook(state) + (unknown ? '<h3>Assign property types ARIS will not guess</h3><ul class="mkt-assign">' + unknown + '</ul>' : '') + commercialLock + '<h3>What do you want this campaign to do?</h3>' + goalNoteHtml(state) + '<div class="mkt-choices">' + goals + '</div>' + '<p class="mkt-aris">' + esc(catalog.recommendationText(state.propertyClass, mailIsTest(state))) + '</p>' + mailNote + (state.message ? '<p class="mkt-message">' + esc(state.message) + '</p>' : '') + '<div class="mkt-row"><button type="button" data-action="continue-goal">Continue</button></div>';
  }

  function goalNoteHtml(state) {
    return state.goalNote ? '<p class="mkt-aris">' + esc(state.goalNote) + '</p>' : '';
  }

  var GOAL_NAME = {
    sellers: 'Find motivated sellers',
    followup: 'Follow up on a lead list',
    buyers: 'Market a real estate deal to cash buyers',
  };
  var LEAD_NAME = {
    absentee: 'Absentee Owners',
    activeinvestor: 'Active Investor Owned',
    listing: 'Active Listing',
    bored: 'Bored Investor',
    cashbuyer: 'Cash Buyers',
    taxdelinquent: 'Delinquent Tax Activity',
    flipped: 'Flipped',
    foreactivity: 'Foreclosure Activity',
    foreclosure: 'Foreclosures (Bank-Owned)',
    freeclear: 'Free & Clear',
    highequity: 'High Equity',
    longterm: 'Long-Term Owner',
    lowequity: 'Low Equity',
    inherited: 'Potentially Inherited',
    prefore: 'Pre-Foreclosures',
    upsidedown: 'Upside Down',
    vacant: 'Vacancy',
    zombie: 'Zombie Property',
    probate: 'Probate',
    divorce: 'Divorce',
  };
  var BUYER_LEADS = { cashbuyer: 1, listing: 1 };

  function articleFor(phrase) {
    return /^[aeiou]/i.test(phrase) ? 'an' : 'a';
  }

  function pickCampaignGoal(stored) {
    var source = String(stored && stored.source || '');
    if (source === 'import' || source === 'lead-list' || source === 'crm' || source === 'followup') {
      return { goal: 'followup', line: 'ARIS picked Follow up on a lead list because this is a lead list. Change it if you want.' };
    }
    var ids = [];
    function add(id) {
      if (id && LEAD_NAME[id] && ids.indexOf(id) === -1) ids.push(id);
    }
    ((stored && stored.leads) || []).forEach(function (lead) {
      (lead.playIds || []).forEach(add);
    });
    (stored && stored.leadTypes || []).forEach(add);
    var sellers = ids.filter(function (id) { return !BUYER_LEADS[id]; });
    var buyers = ids.filter(function (id) { return BUYER_LEADS[id]; });
    var goal = buyers.length && !sellers.length ? 'buyers' : 'sellers';
    var typeId = (goal === 'buyers' ? buyers[0] : sellers[0]) || ids[0];
    var typeName = LEAD_NAME[typeId] || 'motivated seller';
    return {
      goal: goal,
      line: 'ARIS picked ' + GOAL_NAME[goal] + ' because this is ' + articleFor(typeName) + ' ' + typeName + ' lead. Change it if you want.',
    };
  }

  function arriveFromSearch(state, stored) {
    if (!stored || stored.source !== 'property-search' || !(stored.leads && stored.leads.length)) return false;
    var picked = pickCampaignGoal(stored);
    state.goal = picked.goal;
    state.goalNote = picked.line;
    state.fromSearch = true;
    state.step = 2;
    state.leads = stored.leads.slice();
    return true;
  }

  function isFreshMarketHandoff(search, stored) {
    var params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
    if (params.get('wallet')) return false;
    if (params.get('from') !== 'property-search') return false;
    return !!(stored && stored.source === 'property-search' && stored.leads && stored.leads.length);
  }

  function missingMailFields(lead) {
    var row = lead || {};
    var missing = [];
    if (!String(row.address || '').trim()) missing.push('street');
    if (!String(row.city || '').trim()) missing.push('city');
    if (!/^[A-Za-z]{2}$/.test(String(row.state || '').trim())) missing.push('state');
    if (!/^\d{5}(-\d{4})?$/.test(String(row.zip || '').trim())) missing.push('ZIP');
    return missing;
  }

  function formatLead(lead) {
    var place = [lead.city, [lead.state, lead.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    var line = [lead.address, place].filter(Boolean).join(', ');
    return (line || 'New address') + (lead.owner ? ' · ' + lead.owner : '');
  }

  function mailToLine(lead) {
    if (lead.mailSource === 'owner') return 'Mailing to the owner mailing address';
    if (lead.mailSource === 'property') return 'Mailing to the property address';
    return '';
  }

  function addressEditor(state, lead, label) {
    var row = lead || {};
    return '<form class="mkt-address-form">' +
      '<label>Street<input name="address" value="' + esc(row.address || '') + '"></label>' +
      '<label>City<input name="city" value="' + esc(row.city || '') + '"></label>' +
      '<label>State<input name="state" maxlength="2" value="' + esc(row.state || '') + '"></label>' +
      '<label>ZIP<input name="zip" value="' + esc(row.zip || '') + '"></label>' +
      '<label>Owner name (optional)<input name="owner" value="' + esc(row.owner || '') + '"></label>' +
      (state.addressError ? '<p class="mkt-message">' + esc(state.addressError) + '</p>' : '') +
      '<div class="mkt-row"><button type="button" data-action="save-address" data-id="' + esc(row.id || '') + '">' + esc(label) + '</button></div>' +
      '</form>';
  }

  function addressBook(state) {
    var rows = (state.leads || []).map(function (lead) {
      if (state.editingId === lead.id) return '<li>' + addressEditor(state, lead, 'Save address') + '</li>';
      var missing = missingMailFields(lead);
      var mailed = mailToLine(lead);
      return '<li><span>' + esc(formatLead(lead)) + (missing.length ? ' · missing ' + esc(missing.join(', ')) : '') + '</span>' +
        (mailed ? '<span class="mkt-mail-to">' + esc(mailed) + '</span>' : '') +
        ' <button type="button" class="mkt-secondary" data-action="edit-address" data-id="' + esc(lead.id) + '">Edit</button> <button type="button" class="mkt-secondary" data-action="remove-address" data-id="' + esc(lead.id) + '">Remove</button></li>';
    }).join('');
    var fromSearch = !!state.fromSearch && (state.leads || []).length;
    var adding = '';
    if (!state.editingId) {
      if (fromSearch && !state.showAddAddress) {
        adding = '<p><button type="button" class="mkt-add-link" data-action="show-add-address">+ Add another address</button></p>';
      } else {
        adding = '<h3>' + (fromSearch ? 'Add another address' : 'Add an address') + '</h3>' + addressEditor(state, {}, 'Add address');
      }
    }
    return (rows ? '<h3>Properties</h3><ul class="mkt-assign">' + rows + '</ul>' : '') + adding;
  }

  function confirmAddresses(state) {
    var leads = state.leads || [];
    if (!leads.length) {
      return '<p class="mkt-message">There is no property to mail.</p><h3>Add an address</h3>' + addressEditor(state, {}, 'Add address');
    }
    return leads.filter(function (lead) { return missingMailFields(lead).length; }).map(function (lead) {
      return '<article class="mkt-draft"><p>This property is missing ' + esc(missingMailFields(lead).join(', ')) + '.</p>' +
        addressEditor(state, lead, 'Save address') + '</article>';
    }).join('');
  }

  function mailMissingFields(brand) {
    var missing = [];
    if (!brand || !String(brand.businessName || '').trim()) missing.push('business name');
    var digits = String(brand && brand.phone || '').replace(/\D/g, '');
    if (digits.length < 7) missing.push('phone');
    var addr = (brand && brand.returnAddress) || {};
    if (!String(addr.line1 || '').trim() || !String(addr.city || '').trim() || !String(addr.state || '').trim() || !String(addr.zip || '').trim()) missing.push('return address');
    return missing;
  }

  function selectionKey(state) {
    return (state.propertyClass || 'residential') + ':' + (state.goal || 'sellers');
  }

  function applyRecommendations(state) {
    var catalog = loadCatalog();
    var ids = catalog.recommendChannelIds({ propertyClass: state.propertyClass, goal: state.goal });
    state.selected = {};
    ids.forEach(function (id) {
      var channel = catalog.channelById(id);
      if (channel && channel.copy !== false) state.selected[id] = true;
    });
    state.recsFor = selectionKey(state);
  }

  function pieceBadge(channel, opts) {
    var options = opts || {};
    if (!channel || channel.copy === false || channel.comingSoon) return { text: 'Coming soon', cls: 'is-soon' };
    var printed = loadCatalog().printSpec(channel.id);
    var noteSoon = (channel.id === 'handwritten' || channel.id === 'yellow-letter') && !options.handwrittenOrderable;
    if (noteSoon || (printed && printed.comingSoon)) return { text: 'Coming soon', cls: 'is-soon' };
    if (channel.medium === 'print') return { text: 'Ship to me', cls: 'is-ship' };
    if (channel.group === 'fulfill') return { text: 'We mail it', cls: 'is-mail' };
    return { text: 'You send it', cls: 'is-send' };
  }

  function renderPiece(channel, opts) {
    var catalog = loadCatalog();
    var options = opts || {};
    var name = catalog.displayName(channel, options.propertyClass);
    var description = catalog.displayDescription(channel, options.propertyClass);
    var badge = pieceBadge(channel, options);
    var selectable = channel.copy !== false && channel.selectable !== false;
    var checked = !!options.selected && selectable;
    var box = !selectable
      ? ''
      : '<input type="checkbox" ' + (checked ? 'checked ' : '') + 'aria-label="' + esc(name) + '">';
    var tag = selectable ? 'label' : 'div';
    var action = selectable ? ' data-action="toggle" data-id="' + esc(channel.id) + '"' : '';
    var inside = options.inside || '';
    return '<article class="mkt-piece-card' + (checked ? ' is-on' : '') + '">' +
      '<' + tag + ' class="mkt-piece-head"' + action + '>' +
      box +
      '<span class="mkt-piece-copy"><span class="mkt-pill ' + badge.cls + '">' + esc(badge.text) + '</span><strong>' + esc(name) + '</strong><span>' + esc(description) + '</span></span></' + tag + '>' +
      inside +
      '</article>';
  }

  function recommendLine(propertyClass) {
    if (propertyClass === 'commercial') {
      return 'ARIS would start with a formal letter, a call script, and networking.';
    }
    return 'ARIS would start with a postcard, a handwritten-style note, a door-knock script, and a letter.';
  }

  function styleValue(state, channelId) {
    var spec = loadCatalog().pieceStyle(channelId);
    if (!spec) return {};
    var saved = (state.styles || {})[channelId] || {};
    var value = {};
    value[spec.field] = spec.choices.some(function (row) { return row.id === saved[spec.field]; }) ? saved[spec.field] : spec.default;
    if (spec.hands && spec.hands.length) {
      value.hand = spec.hands.some(function (row) { return row.id === saved.hand; }) ? saved.hand : spec.handDefault;
    }
    return value;
  }

  function menuCents(state, channelId, choiceId) {
    var menu = state.menu || {};
    var list = menu[channelId] || menu.signs || [];
    if (channelId === 'bandit') return null;
    var found = null;
    list.forEach(function (row) {
      if (row.id === choiceId) found = row;
    });
    if (!found) {
      (menu.comingSoon || []).forEach(function (row) {
        if (row.id === channelId) found = row;
      });
    }
    return found ? found.studentPriceCents : null;
  }

  function styleSelect(label, attrs, rows, selected, fieldClass) {
    var options = rows.map(function (row) {
      var id = row.id != null ? row.id : row;
      var text = row.label != null ? row.label : row;
      return '<option value="' + esc(id) + '"' + (String(id) === String(selected) ? ' selected' : '') + '>' + esc(text) + '</option>';
    }).join('');
    return '<label class="mkt-field' + (fieldClass ? ' ' + fieldClass : '') + '"><span>' + esc(label) + '</span><select' + (attrs ? ' ' + attrs : '') + '>' + options + '</select></label>';
  }

  function styleChoice(state, channel) {
    var catalog = loadCatalog();
    var spec = catalog.pieceStyle(channel.id);
    var printed = catalog.printSpec(channel.id);
    var value = spec ? styleValue(state, channel.id) : {};
    if (spec) {
      return {
        spec: spec,
        printed: printed,
        choiceId: value[spec.field],
        hand: value.hand || '',
        pack: 0,
      };
    }
    if (!printed) return null;
    var saved = printChoice(state, channel.id);
    var pack = saved ? saved.quantity : (printed.packs[0] || 50);
    var option = saved ? saved.option : (printed.options[0] ? printed.options[0].id : '');
    if (printed.comingSoon) {
      var soonRow = null;
      ((state.menu && state.menu.comingSoon) || []).forEach(function (row) {
        if (row.id === channel.id) soonRow = row;
      });
      if (soonRow && soonRow.pack) pack = soonRow.pack;
    }
    return { spec: null, printed: printed, choiceId: option, hand: '', pack: pack };
  }

  function stylePrice(state, channel, picked, design) {
    if (loadCatalog().priceMode(channel.id, design) === 'soon' || !picked) {
      return '<p class="mkt-style-price mkt-price">Pricing coming soon</p>';
    }
    if (picked.spec) {
      var each = menuCents(state, channel.id, picked.choiceId);
      return each == null ? '' : '<p class="mkt-style-price mkt-price">' + money(each) + ' each</p>';
    }
    var printed = picked.printed;
    var unit = null;
    if (printed && printed.comingSoon) {
      ((state.menu && state.menu.comingSoon) || []).forEach(function (row) {
        if (row.id === channel.id) unit = row.studentPriceCents;
      });
    } else {
      unit = menuCents(state, channel.id, String(picked.pack));
    }
    if (unit == null) return '';
    var pack = picked.pack || 0;
    var total = pack ? '<span>' + money(unit * pack) + ' for ' + pack + '</span>' : '';
    return '<p class="mkt-style-price mkt-price">' + money(unit) + ' each' + total + '</p>';
  }

  function previewBrand(state) {
    var brand = activeBrand(state) || {};
    var colors = brand.colors || {};
    var addr = brand.returnAddress || {};
    var line = [addr.line1, addr.city, addr.state, addr.zip].filter(Boolean).join(', ');
    return {
      name: brand.businessName || (state.sender && state.sender.name) || '',
      phone: brand.phone || (state.sender && state.sender.phone) || '',
      primary: colors.primary || '',
      accent: colors.accent || '',
      address: line,
    };
  }

  function mailIsTest(state) {
    if (state && state.menu && typeof state.menu.testMode === 'boolean') return state.menu.testMode;
    if (state && typeof state.testMode === 'boolean') return state.testMode;
    return true;
  }

  function styleHelp(channel, picked, design, testMode) {
    var price = testMode === false ? 'price' : 'test price';
    var mode = loadCatalog().priceMode(channel.id, design);
    if (channel.id === 'letter' && design && design.envelope === 'plain') {
      return testMode === false
        ? 'A plain envelope does not have a price yet. This mailing uses a window envelope.'
        : 'A plain envelope does not have a test price yet. This test mailing uses a window envelope.';
    }
    if (channel.id === 'yard-sign') return 'Preview only. 18 × 24 on a wire step-in stake. Not orderable yet.';
    if (mode === 'soon') return 'Preview only. Not orderable yet.';
    if (channel.id === 'jumbo-postcard') return '6 × 11, one per property. Template does not change this ' + price + '.';
    if (channel.id === 'offer-letter') return 'Color printing in a #10 envelope. This is not a binding offer. Template does not change this ' + price + '.';
    if (channel.id === 'postcard') return 'Template does not change this ' + price + '.';
    if (channel.id === 'letter') return 'Window envelope. Template does not change this ' + price + '.';
    if (channel.id === 'handwritten') {
      var inkNote = 'Ink color does not change this ' + price + '.';
      return picked && picked.choiceId === 'notecard'
        ? inkNote + ' A folded notecard uses a real stamp and a handwritten envelope.'
        : inkNote + ' The message is handwritten on the postcard.';
    }
    if (channel.id === 'yellow-letter') return 'Handwriting does not change this ' + price + '. The letter is on yellow lined paper, in an envelope.';
    if (channel.id === 'door-hanger') return 'Finish does not change this reference price. Not mailed to a property.';
    return '';
  }

  function previewSvg(state, channel, templateId, swatch) {
    var catalog = loadCatalog();
    var picked = styleChoice(state, channel);
    var design = catalog.normalizeDesign(channel.id, (state.designs || {})[channel.id]);
    if (templateId) design.template = templateId;
    var previewId = picked ? (picked.spec ? picked.choiceId : (picked.choiceId || '')) : '';
    return catalog.stylePreview(channel.id, previewId, {
      hand: picked ? picked.hand : '',
      design: design,
      template: templateId || design.template,
      swatch: !!swatch,
      angle: state.angle,
      brand: previewBrand(state),
      propertyClass: state.propertyClass,
    });
  }

  function designSelect(label, channelId, field, rows, selected, fieldClass) {
    return styleSelect(label, 'data-design="' + esc(channelId) + '" data-design-field="' + esc(field) + '"', rows, selected, fieldClass);
  }

  function templateRow(state, channel, design, picked) {
    var catalog = loadCatalog();
    var templates = catalog.templatesFor(channel.id);
    if (!templates.length) return '';
    var previewId = picked ? (picked.spec ? picked.choiceId : (picked.choiceId || '')) : '';
    return '<div class="mkt-templates">' + templates.map(function (tpl) {
      var svg = catalog.stylePreview(channel.id, previewId, {
        hand: picked ? picked.hand : '',
        design: design,
        template: tpl.id,
        swatch: true,
        angle: state.angle,
        brand: previewBrand(state),
        propertyClass: state.propertyClass,
      });
      return '<button type="button" class="mkt-template' + (tpl.id === design.template ? ' is-on' : '') + '" data-action="pick-template" data-id="' + esc(channel.id) + '" data-template="' + esc(tpl.id) + '" aria-label="' + esc(tpl.label) + ' template"><span class="mkt-template-art">' + svg + '</span><span>' + esc(tpl.label) + '</span></button>';
    }).join('') + '</div>';
  }

  function styleBlock(state, channel) {
    var catalog = loadCatalog();
    var templates = catalog.templatesFor(channel.id);
    var picked = styleChoice(state, channel);
    if (!picked && !templates.length) return '';
    var design = catalog.normalizeDesign(channel.id, (state.designs || {})[channel.id]);
    var preview = previewSvg(state, channel);
    var thumb = '<button type="button" class="mkt-thumb" data-action="zoom-preview" data-id="' + esc(channel.id) + '" aria-label="Enlarge ' + esc(channel.name) + ' preview">' + preview + '</button>';
    var fields = '';
    if (picked && picked.spec) {
      var fieldLabel = picked.spec.field === 'size' ? 'Size' : (picked.spec.field === 'finish' ? 'Print' : (picked.spec.field === 'paper' ? 'Paper' : 'Style'));
      if (picked.spec.choices.length > 1) {
        fields += styleSelect(fieldLabel, 'data-style="' + esc(channel.id) + '" data-style-field="' + esc(picked.spec.field) + '"', picked.spec.choices, picked.choiceId);
      }
      if (picked.spec.hands && picked.spec.hands.length) {
        fields += styleSelect('Handwriting', 'data-style="' + esc(channel.id) + '" data-style-field="hand"', picked.spec.hands, picked.hand);
      }
      if (channel.id === 'letter') {
        fields += designSelect('Envelope', channel.id, 'envelope', [
          { id: 'window', label: 'Window' },
          { id: 'plain', label: 'Plain' },
        ], design.envelope);
      }
      if (channel.id === 'handwritten' || channel.id === 'yellow-letter') {
        fields += designSelect('Ink', channel.id, 'ink', [
          { id: 'blue', label: 'Blue' },
          { id: 'black', label: 'Black' },
        ], design.ink, 'is-short');
      }
    } else if (channel.id === 'door-hanger') {
      fields += designSelect('Size', channel.id, 'hangerSize', [
        { id: '4.25x11', label: '4.25 × 11' },
        { id: '3.5x8.5', label: '3.5 × 8.5' },
        { id: '4.25x14', label: '4.25 × 14' },
      ], design.hangerSize);
      fields += designSelect('Finish', channel.id, 'hangerFinish', [
        { id: 'standard', label: 'Standard' },
        { id: 'uv', label: 'UV gloss' },
      ], design.hangerFinish);
      if (picked && picked.printed && picked.printed.packs.length) {
        fields += styleSelect('Pack', '', picked.printed.packs.map(function (qty) {
          return { id: qty, label: String(qty) };
        }), picked.pack, 'is-short');
      }
    } else if (channel.id === 'yellow-letter') {
      fields += designSelect('Ink', channel.id, 'ink', [
        { id: 'blue', label: 'Blue' },
        { id: 'black', label: 'Black' },
      ], design.ink, 'is-short');
    }
    var help = styleHelp(channel, picked, design, mailIsTest(state));
    return '<div class="mkt-options"><div class="mkt-style">' + thumb +
      '<div class="mkt-style-fields">' + fields + '</div>' +
      stylePrice(state, channel, picked, design) +
      (help ? '<p class="mkt-style-help">' + esc(help) + '</p>' : '') +
      '</div>' + templateRow(state, channel, design, picked) + '</div>';
  }

  function zoomMarkup(state) {
    if (!state || !state.zoomChannel) return '';
    var channel = loadCatalog().channelById(state.zoomChannel);
    if (!channel) return '';
    var svg = previewSvg(state, channel);
    if (!svg) return '';
    var name = loadCatalog().displayName(channel, state.propertyClass);
    return '<div class="mkt-lightbox" role="dialog" aria-modal="true" aria-label="' + esc(name) + ' preview">' +
      '<button type="button" class="mkt-lightbox-backdrop" data-action="close-zoom" aria-label="Close preview"></button>' +
      '<div class="mkt-lightbox-card"><div class="mkt-lightbox-bar"><span>' + esc(name) + '</span>' +
      '<button type="button" class="mkt-lightbox-close" data-action="close-zoom">Close</button></div>' +
      svg + '</div></div>';
  }

  function angleRow(state) {
    var catalog = loadCatalog();
    var angles = catalog.anglesFor(state.propertyClass);
    var current = catalog.angleById(state.angle, state.propertyClass) || angles[0];
    return '<h2 class="mkt-ask">What should the message say?</h2><div class="mkt-angles">' + angles.map(function (angle) {
      return '<button type="button" class="mkt-angle' + (current && angle.id === current.id ? ' is-on' : '') + '" data-action="pick-angle" data-angle="' + esc(angle.id) + '">' + esc(angle.label) + '</button>';
    }).join('') + '</div>';
  }

  function renderPicker(state) {
    var catalog = loadCatalog();
    if (state.recsFor !== selectionKey(state)) applyRecommendations(state);
    var recommendedIds = catalog.recommendChannelIds({ propertyClass: state.propertyClass, goal: state.goal });
    var recommended = {};
    recommendedIds.forEach(function (id) { recommended[id] = true; });
    var visible = catalog.channelsForClass(state.propertyClass);
    var picked = [];
    var more = [];
    recommendedIds.forEach(function (id) {
      var channel = catalog.channelById(id);
      if (channel) picked.push(channel);
    });
    visible.forEach(function (channel) {
      if (!recommended[channel.id]) more.push(channel);
    });
    var cards = function (list) {
      return list.map(function (channel) {
        return renderPiece(channel, {
          propertyClass: state.propertyClass,
          selected: !!state.selected[channel.id],
          handwrittenOrderable: !!(state.menu && (state.menu.handwrittenOrderable || state.menu.yellowLetterOrderable)),
          inside: (state.selected[channel.id] || channel.selectable === false) ? styleBlock(state, channel) : '',
        });
      }).join('');
    };
    var commercialLock = state.empire ? '' : ' disabled';
    return goalNoteHtml(state) + '<h2 class="mkt-ask">Who are you marketing to?</h2>' +
      '<div class="mkt-who-grid">' +
      '<button type="button" class="mkt-who' + (state.propertyClass === 'residential' ? ' is-on' : '') + '" data-action="class" data-class="residential"><strong>Residential</strong><span>Homeowners</span></button>' +
      '<button type="button" class="mkt-who' + (state.propertyClass === 'commercial' ? ' is-on' : '') + '"' + commercialLock + ' data-action="class" data-class="commercial"><strong>Commercial</strong><span>Business and property owners</span>' + (state.empire ? '' : '<em>Empire</em>') + '</button>' +
      '</div>' +
      '<p class="mkt-legend">' + (mailIsTest(state)
        ? 'We mail it means one postcard or letter per property, in test mode. Ship to me means printed goods ship to you in a pack you choose. They are not sent to a property. Nothing is really printed yet. You send it means you send it yourself. FORGE does not send email or text.'
        : 'We mail it means one postcard or letter per property. Mail is printed and sent. Ship to me means printed goods ship to you in a pack you choose. They are not sent to a property. You send it means you send it yourself. FORGE does not send email or text.') + '</p>' +
      angleRow(state) +
      '<h2 class="mkt-ask">ARIS recommends</h2>' +
      '<p class="mkt-aris">' + esc(recommendLine(state.propertyClass)) + '</p>' +
      (state.message ? '<p class="mkt-message">' + esc(state.message) + '</p>' : '') +
      '<div class="mkt-pick-list">' + cards(picked) + '</div>' +
      '<details class="mkt-more"><summary>More options</summary><div class="mkt-pick-list">' + cards(more) + '</div></details>' +
      '<div class="mkt-row"><button type="button" data-action="generate">Write copy with ARIS</button></div>' +
      zoomMarkup(state);
  }

  function money(cents) {
    var n = Math.round(Number(cents) || 0);
    var sign = n < 0 ? '-' : '';
    var abs = Math.abs(n);
    return sign + '$' + Math.floor(abs / 100) + '.' + String(abs % 100).padStart(2, '0');
  }

  function topUpButtons() {
    return '<div class="mkt-row">' + [2500, 5000, 10000, 25000].map(function (cents) {
      return '<button type="button" class="mkt-secondary" data-action="topup" data-amount="' + cents + '">Add ' + money(cents) + '</button>';
    }).join('') + '</div>';
  }

  function costRows(state, kind) {
    var catalog = loadCatalog();
    var quote = state.quote || { lines: [] };
    return (quote.lines || []).filter(function (line) {
      if (kind === 'print') return line.kind === 'print';
      return line.kind !== 'print';
    }).map(function (line) {
      var channel = catalog.channelById(line.channelId);
      var name = catalog.displayName(channel, state.propertyClass) || line.channelId;
      if (line.styleLabel) name += ' · ' + line.styleLabel;
      if (line.handLabel) name += ' · ' + line.handLabel;
      var charged = kind === 'print' ? line.quantity > 0 : !!line.mailed;
      var total = line.comingSoon ? 'Coming soon' : (charged ? money(line.studentPriceCents) : (mailIsTest(state) ? 'Not charged in this test' : 'Not charged'));
      var count = charged ? line.quantity : '—';
      return '<tr><td>' + esc(name) + '</td><td>' + money(line.unitStudentPriceCents) + '</td><td>' + esc(count) + '</td><td>' + esc(total) + '</td></tr>';
    }).join('');
  }

  function countNote(quote) {
    var lines = (quote && quote.lines) || [];
    var emptyMail = lines.some(function (line) { return line.mailed && !line.quantity; });
    if (!quote || !emptyMail) return '';
    var selected = Number(quote.selectedLeadCount) || 0;
    if (!selected) {
      return '<p class="mkt-note">Count is 0 because no properties are loaded. On step 1, start from Property Search, or use a sample property that includes a street, city, state, and ZIP.</p>';
    }
    return '<p class="mkt-note">Count is 0 because none of the ' + selected + ' selected properties have a street, city, state, and ZIP. Go back to Property Search and choose properties that show a full address. A sample property counts only when it has all four.</p>';
  }

  function markupNote(quote) {
    if (!quote || quote.printMarkupRate == null) return '';
    var hasPrint = (quote.lines || []).some(function (line) { return line.kind === 'print'; });
    if (!hasPrint) return '';
    var pct = Math.round(Number(quote.printMarkupRate) * 100);
    var price = quote.testMode === false ? 'price' : 'test price';
    return '<p class="mkt-note">Print markup ' + pct + '%. Configured between 25% and 35%. Shipping is not included in this ' + price + '.</p>';
  }

  function shipDraft(state) {
    var brand = activeBrand(state);
    var addr = (brand && brand.returnAddress) || {};
    var over = state.shipTouched ? (state.shipTo || {}) : {};
    function pick(key) {
      if (state.shipTouched && over[key] != null) return over[key];
      return addr[key] || '';
    }
    return {
      line1: pick('line1'),
      line2: pick('line2'),
      city: pick('city'),
      state: pick('state'),
      zip: pick('zip'),
    };
  }

  function printChoice(state, id) {
    var spec = loadCatalog().printSpec(id);
    if (!spec || spec.comingSoon) return null;
    if (!loadCatalog().designOrderable(id, (state.designs || {})[id])) return null;
    var saved = (state.prints || {})[id] || {};
    var quantity = spec.packs.indexOf(Number(saved.quantity)) >= 0 ? Number(saved.quantity) : spec.packs[0];
    var option = spec.options.some(function (row) { return row.id === saved.option; }) ? saved.option : spec.options[0].id;
    return { channelId: id, quantity: quantity, option: option };
  }

  function printOrders(state) {
    var catalog = loadCatalog();
    return selectedIds(state).filter(function (id) {
      var channel = catalog.channelById(id);
      return channel && channel.medium === 'print' && state.approved[state.propertyClass + ':' + id];
    }).map(function (id) { return printChoice(state, id); }).filter(Boolean);
  }

  function shipForm(state) {
    var draft = shipDraft(state);
    function field(key, label) {
      return '<label>' + label + '<input data-ship="' + key + '" value="' + esc(draft[key] || '') + '"></label>';
    }
    return '<div class="mkt-ship"><span>Ship to me</span>' +
      field('line1', 'Street') +
      field('line2', 'Line 2') +
      field('city', 'City') +
      field('state', 'State') +
      field('zip', 'ZIP') +
      '<p class="mkt-note">Filled from your Brand Kit return address. Change it if this order should ship somewhere else.</p></div>';
  }

  function printPicker(state) {
    var catalog = loadCatalog();
    var orders = printOrders(state);
    if (!orders.length) return '';
    return '<h3>Ship to me</h3><p class="mkt-note">Pick a pack. The property count does not change this quantity.</p>' +
      orders.map(function (order) {
        var spec = catalog.printSpec(order.channelId);
        var channel = catalog.channelById(order.channelId);
        var name = catalog.displayName(channel, state.propertyClass);
        var packs = spec.packs.map(function (qty) {
          return '<option value="' + qty + '"' + (qty === order.quantity ? ' selected' : '') + '>' + qty + '</option>';
        }).join('');
        var options = spec.options.map(function (row) {
          return '<option value="' + esc(row.id) + '"' + (row.id === order.option ? ' selected' : '') + '>' + esc(row.label) + '</option>';
        }).join('');
        return '<div class="mkt-pack"><strong>' + esc(name) + '</strong><label>Pack<select data-print-pack="' + esc(order.channelId) + '">' + packs + '</select></label><label>Size<select data-print-option="' + esc(order.channelId) + '">' + options + '</select></label></div>';
      }).join('') + shipForm(state);
  }

  function renderCost(state) {
    var quote = state.quote;
    var mailDue = quote ? (quote.mailChargedCents != null ? quote.mailChargedCents : quote.chargedCents) : 0;
    var printDue = quote && quote.printChargedCents ? quote.printChargedCents : 0;
    var table = quote
      ? (costRows(state, 'mail')
          ? '<h3>Mail, one per property</h3><table class="mkt-cost"><thead><tr><th>Piece</th><th>Each</th><th>Count</th><th>Total</th></tr></thead><tbody>' + costRows(state, 'mail') + '</tbody></table>'
          : '') +
        countNote(quote) +
        printPicker(state) +
        (costRows(state, 'print')
          ? '<table class="mkt-cost"><thead><tr><th>Piece</th><th>Each</th><th>Pack</th><th>Total</th></tr></thead><tbody>' + costRows(state, 'print') + '</tbody></table>'
          : '') +
        markupNote(quote) +
        '<p class="mkt-total"><strong>' + (mailIsTest(state) ? 'Test mail total' : 'Mail total') + '</strong> ' + money(mailDue) + '</p>' +
        (printDue || costRows(state, 'print') ? '<p class="mkt-total"><strong>Ship to me total</strong> ' + money(printDue) + '</p>' : '') +
        '<p>Credit balance ' + money(quote.balanceCents) + (quote.shortfallCents ? '. Add ' + money(quote.shortfallCents) + ' before you confirm.' : '.') + '</p>'
      : '<p class="mkt-note">' + (mailIsTest(state) ? 'The test price loads when you open this step.' : 'The price loads when you open this step.') + '</p>';
    return '<h2 class="mkt-ask">Cost</h2>' +
      '<p class="mkt-note">' + (mailIsTest(state)
        ? 'Test mode. Nothing is really printed. Mail is one piece per property. Printed goods ship to you in the pack you pick. FORGE does not send email or text.'
        : 'Mail is printed and sent for real. Mail is one piece per property. Printed goods ship to you in the pack you pick. FORGE does not send email or text.') + '</p>' +
      table + topUpButtons() +
      statusLine(state) +
      '<div class="mkt-row mkt-next"><button type="button" data-action="step" data-step="6">Continue to confirm</button></div>';
  }

  function renderConfirm(state) {
    var quote = state.quote || {};
    var short = quote.shortfallCents > 0;
    var mailDue = quote.mailChargedCents != null ? quote.mailChargedCents : quote.chargedCents;
    var printDue = quote.printChargedCents || 0;
    var testing = mailIsTest(state);
    var button = short
      ? '<p class="mkt-message">Add ' + money(quote.shortfallCents) + (testing ? ' in test credits' : ' in credits') + ' before this order.</p>' + topUpButtons()
      : '<div class="mkt-row">' +
        (mailDue ? '<button type="button" data-action="confirm-mail">' + (testing ? 'Confirm test mail' : 'Confirm mail') + '</button>' : '') +
        (printDue ? '<button type="button" data-action="confirm-print">' + (testing ? 'Place test print order' : 'Place print order') + '</button>' : '') +
        '</div>';
    return '<h2 class="mkt-ask">Confirm</h2>' +
      '<p class="mkt-note">' + (testing
        ? 'Test mode. Confirming mail debits test credits and hands postcards and letters to the test mail service. A print order debits test credits and is only recorded. Nothing is really printed. FORGE does not send email or text.'
        : 'Confirming mail debits credits and sends postcards and letters. A print order debits credits and is recorded. FORGE does not send email or text.') + '</p>' +
      '<p class="mkt-total"><strong>' + (testing ? 'Test mail total' : 'Mail total') + '</strong> ' + money(mailDue || 0) + '</p>' +
      (printDue ? '<p class="mkt-total"><strong>Ship to me total</strong> ' + money(printDue) + '</p>' + shipForm(state) : '') +
      '<p>Credit balance ' + money(quote.balanceCents) + '</p>' +
      confirmAddresses(state) +
      button +
      statusLine(state);
  }

  function statusLine(state) {
    return (state.message ? '<p class="mkt-message">' + esc(state.message) + '</p>' : '') +
      (state.reason ? '<p class="mkt-reason">' + esc(state.reason) + '</p>' : '');
  }

  function renderCopy(state) {
    var catalog = loadCatalog();
    var copies = currentCopies(state);
    var ids = selectedIds(state).filter(function (id) { return copies[id]; });
    if (!ids.length) return '<p>Nothing has been written yet.</p><button type="button" data-action="step" data-step="2">Back to the picker</button>';
    return '<p class="mkt-aris">' + esc(state.recommendation || '') + '</p>' + ids.map(function (id) {
      var channel = catalog.channelById(id);
      var piece = copies[id];
      var name = catalog.displayName(channel, state.propertyClass);
      return '<article class="mkt-draft"><h3>' + esc(name) + '</h3><p class="mkt-source">' + (piece.source === 'aris' ? 'Written by ARIS. Edit it before you approve it.' : 'Starting draft. ARIS did not return this one, so edit it before you approve it.') + '</p><h4>Variant A</h4><pre>' + esc(piece.variantA) + '</pre><h4>Variant B</h4><pre>' + esc(piece.variantB) + '</pre></article>';
    }).join('') + '<div class="mkt-row"><button type="button" data-action="step" data-step="4">Edit and approve</button></div>';
  }

  function renderApprove(state) {
    var catalog = loadCatalog();
    var copies = currentCopies(state);
    var ids = selectedIds(state).filter(function (id) { return copies[id]; });
    var needsAttest = ids.some(function (id) {
      var channel = catalog.channelById(id);
      return channel && channel.attest;
    });
    var blocks = ids.map(function (id) {
      var channel = catalog.channelById(id);
      var piece = copies[id];
      var name = catalog.displayName(channel, state.propertyClass);
      var key = state.propertyClass + ':' + id;
      return '<article class="mkt-draft"><h3>' + esc(name) + '</h3>' +
        '<label>Variant A<textarea data-copy="' + esc(key) + '" data-variant="variantA">' + esc(piece.variantA) + '</textarea></label>' +
        '<label>Variant B<textarea data-copy="' + esc(key) + '" data-variant="variantB">' + esc(piece.variantB) + '</textarea></label>' +
        '<label class="mkt-check"><input type="checkbox" data-approve="' + esc(key) + '"' + (state.approved[key] ? ' checked' : '') + '> Approve this piece</label></article>';
    }).join('');
    var attest = needsAttest
      ? '<label class="mkt-check mkt-attest"><input type="checkbox" data-attest="1"' + (state.attested ? ' checked' : '') + '> ' + esc(catalog.ATTESTATION_TEXT) + '</label><p class="mkt-note">' + esc(catalog.INFO_ONLY_LABEL) + ' Phone numbers are not shown in this step.</p>'
      : '';
    var approved = ids.filter(function (id) { return state.approved[state.propertyClass + ':' + id]; });
    var canMail = approved.some(isMailable);
    var canPrint = approved.some(function (id) {
      var channel = catalog.channelById(id);
      return channel && channel.medium === 'print';
    });
    var forward = (canMail || canPrint)
      ? '<button type="button" data-action="step" data-step="5">Continue to cost</button>'
      : '';
    var ownNote = !canMail && !canPrint && approved.length
      ? '<p class="mkt-note">These pieces are send-it-yourself and there\'s nothing to mail.</p>'
      : '';
    return blocks + attest +
      '<div class="mkt-notice"><strong>You are responsible.</strong> ' + esc(catalog.STUDENT_NOTICE) + '</div>' +
      '<div class="mkt-notice">' + esc(catalog.COMPLIANCE_REMINDER) + '</div>' +
      '<div class="mkt-actions"><button type="button" data-action="export">Export copy</button>' + forward + '</div>' +
      ownNote +
      (state.message ? '<p class="mkt-message">' + esc(state.message) + '</p>' : '');
  }

  function isMailable(id) {
    return id === 'postcard' || id === 'letter' || id === 'jumbo-postcard' || id === 'offer-letter' || id === 'handwritten' || id === 'yellow-letter';
  }

  function approvedMailIds(state) {
    return selectedIds(state).filter(function (id) {
      return isMailable(id) && state.approved[state.propertyClass + ':' + id];
    });
  }

  function renderBrand(state) {
    var catalog = loadCatalog();
    var brand = activeBrand(state) || {
      businessName: state.sender.name || '',
      phone: state.sender.phone || '',
      disclosure: catalog.DISCLOSURE_DEFAULT,
      returnAddress: {},
      colors: {},
    };
    var addr = brand.returnAddress || {};
    var slots = (state.brands || []).map(function (row) {
      return '<button type="button" class="mkt-chip' + (row.id === state.brandId ? ' is-on' : '') + '" data-action="pick-brand" data-id="' + esc(row.id) + '">' + esc(row.label || row.businessName || 'Brand') + '</button>';
    }).join('');
    var add = state.brands.length < state.brandLimit
      ? '<button type="button" class="mkt-secondary" data-action="new-brand">Add a brand</button>'
      : '<p class="mkt-note">' + (state.empire ? 'Empire includes 3 brands.' : 'Foundation includes one Brand Kit. More brands are part of Empire.') + '</p>';
    var savedLogo = brand.logo ? '<p class="mkt-saved">Logo saved: ' + esc(brand.logo.fileName || 'logo') + (brand.logo.width ? ' (' + esc(brand.logo.width) + ' × ' + esc(brand.logo.height || '?') + ')' : '') + '.</p>' : '';
    var savedHead = brand.headshot ? '<p class="mkt-saved">Headshot saved: ' + esc(brand.headshot.fileName || 'headshot') + '.</p>' : '';
    return '<form id="mkt-brand-form" class="mkt-brand">' +
      (state.message ? '<p class="mkt-message" role="status">' + esc(state.message) + '</p>' : '') +
      '<div class="mkt-chip-row">' + slots + add + '</div>' +
      '<p class="mkt-note">Students change the logo, the colors, and the text. Fonts and layouts stay on the neutral template. The template does not carry FORGE branding.</p>' +
      '<label>Business name<input name="businessName" value="' + esc(brand.businessName || '') + '"></label>' +
      '<label>Phone<input name="phone" value="' + esc(brand.phone || '') + '"></label>' +
      '<label>Website<input name="website" value="' + esc(brand.website || '') + '"></label>' +
      '<label>Email<input name="email" value="' + esc(brand.email || '') + '"></label>' +
      '<label>Sign-off<input name="signOff" value="' + esc(brand.signOff || '') + '"></label>' +
      '<label>Tagline (optional)<input name="tagline" value="' + esc(brand.tagline || '') + '"></label>' +
      '<label>Disclosure line<textarea name="disclosure">' + esc(brand.disclosure || catalog.DISCLOSURE_DEFAULT) + '</textarea></label>' +
      '<div class="mkt-address"><span>Mailing return address</span>' +
      '<input name="line1" placeholder="Street" value="' + esc(addr.line1 || '') + '">' +
      '<input name="line2" placeholder="Line 2" value="' + esc(addr.line2 || '') + '">' +
      '<input name="city" placeholder="City" value="' + esc(addr.city || '') + '">' +
      '<input name="state" placeholder="State" value="' + esc(addr.state || '') + '">' +
      '<input name="zip" placeholder="ZIP" value="' + esc(addr.zip || '') + '"></div>' +
      '<div class="mkt-colors"><label>Primary<input name="primary" value="' + esc((brand.colors && brand.colors.primary) || '') + '" placeholder="#1F3348"></label>' +
      '<label>Accent<input name="accent" value="' + esc((brand.colors && brand.colors.accent) || '') + '" placeholder="#5C6B7A"></label></div>' +
      '<p class="mkt-note">Upload a logo and ARIS will suggest three colors from it. You can keep them or type your own.</p>' +
      ((state.swatches || []).length ? '<div class="mkt-chip-row">' + state.swatches.map(function (hex, index) {
        var slot = index === 0 ? 'primary' : 'accent';
        return '<button type="button" data-action="apply-swatch" data-slot="' + slot + '" data-hex="' + esc(hex) + '">Use ' + slot + ' ' + esc(hex) + '</button>';
      }).join('') + '</div>' : '') +
      '<label class="mkt-check"><input type="checkbox" name="rights"><span>' + esc(catalog.RIGHTS_TEXT) + ' A headshot must be of you, or of someone who gave permission.</span></label>' +
      savedLogo + savedHead +
      '<div class="mkt-uploads"><label class="mkt-file"><span>Logo PNG, JPG, SVG, or WebP</span><input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,.png,.jpg,.jpeg,.webp,.svg" data-upload="logo"></label>' +
      '<label class="mkt-file"><span>Headshot JPG, PNG, or WebP</span><input type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" data-upload="headshot"></label></div>' +
      '<div class="mkt-save"><button type="button" data-action="save-brand">Save Brand Kit</button></div>' +
      '</form>';
  }

  function renderMain(state) {
    if (state.view === 'brand') return renderBrand(state);
    if (state.step === 2) return renderPicker(state);
    if (state.step === 5) return renderCost(state);
    if (state.step === 6) return renderConfirm(state);
    if (state.step === 3) return renderCopy(state);
    if (state.step === 4) return renderApprove(state);
    return renderGoal(state);
  }

  function previewLead(state) {
    var catalog = loadCatalog();
    var groups = split(state);
    var pool = state.propertyClass === 'commercial' ? groups.commercial : groups.residential;
    return (pool && pool[0]) || (state.leads && state.leads[0]) || catalog.SAMPLE_LEAD;
  }

  function withoutDisclosure(text, disclosure) {
    var line = String(disclosure || '').trim();
    var body = String(text || '');
    if (!line) return body.trim();
    var parts = body.split(line);
    return parts.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
  }

  function renderPreview(state) {
    var catalog = loadCatalog();
    var channel = catalog.channelById(state.previewId) || catalog.channelById('postcard');
    var brand = activeBrand(state) || {};
    var colors = brand.colors || {};
    var primary = colors.primary || '#1F3348';
    var accent = colors.accent || '#5C6B7A';
    var ink = colors.textOnPrimary || '#F7F5F2';
    var lead = previewLead(state);
    var piece = (currentCopies(state)[channel.id]) || catalog.starterPiece(channel.id, {
      propertyClass: state.propertyClass,
      brand: brand,
      sender: state.sender,
      leads: [lead],
    });
    var disclosure = brand.disclosure || catalog.DISCLOSURE_DEFAULT;
    var body = withoutDisclosure(piece ? piece.variantA : '', disclosure);
    var sample = !state.leads.length || lead.sample;
    var name = catalog.displayName(channel, state.propertyClass);
    if (channel.id === 'handwritten' || channel.id === 'yellow-letter') {
      var pickedHand = styleChoice(state, channel);
      var handName = '';
      if (pickedHand && pickedHand.spec && pickedHand.spec.hands) {
        pickedHand.spec.hands.forEach(function (row) {
          if (row.id === pickedHand.hand) handName = row.label;
        });
      }
      return '<div class="mkt-preview">' +
        '<div class="mkt-kicker">Preview</div>' +
        '<h2>' + esc(name) + '</h2>' +
        (handName ? '<p class="mkt-note">Handwriting: ' + esc(handName) + '</p>' : '') +
        previewSvg(state, channel) +
        '<small>' + esc(disclosure) + '</small>' +
        '</div>';
    }
    var logoUrl = state.logoUrls && brand.id ? state.logoUrls[brand.id] : '';
    var showLogo = channel.id !== 'handwritten' && (logoUrl || brand.logo);
    var logoHtml = '';
    if (showLogo && logoUrl) logoHtml = '<img class="mkt-logo" src="' + esc(logoUrl) + '" alt="">';
    else if (showLogo) logoHtml = '<div class="mkt-logo">Logo on file</div>';
    return '<div class="mkt-preview">' +
      '<div class="mkt-kicker">Preview · tap any card</div>' +
      '<h2>' + esc(name) + '</h2>' +
      (sample ? '<p class="mkt-note">Sample data. Not a real owner and not a real address.</p>' : '') +
      '<div class="mkt-piece" style="--brand:' + esc(primary) + ';--accent:' + esc(accent) + ';--ink:' + esc(ink) + '">' +
      logoHtml +
      '<strong>' + esc(brand.businessName || state.sender.name || 'Your name') + '</strong>' +
      '<p>' + esc(body) + '</p>' +
      '<div class="mkt-qr-block"><div class="mkt-qr" aria-hidden="true"></div><span class="mkt-qr-caption">QR code (placeholder)</span></div>' +
      '<small>' + esc(disclosure) + '</small>' +
      '</div>' +
      '<p class="mkt-price">' + (menuCents(state, channel.id, (styleValue(state, channel.id)[ (catalog.pieceStyle(channel.id) || {}).field ])) == null ? 'Price follows the style you pick.' : money(menuCents(state, channel.id, styleValue(state, channel.id)[(catalog.pieceStyle(channel.id) || {}).field])) + ' each') + '</p>' +
      '<p class="mkt-note">Wallet, printing, and mailing are not in this step.</p></div>';
  }

  async function ensureLogo(state) {
    var brand = activeBrand(state);
    if (!brand || !brand.logo || !brand.id || !state.token) return;
    if (!state.logoUrls) state.logoUrls = {};
    if (state.logoUrls[brand.id]) return;
    try {
      var response = await fetch('/api/marketing-brand?asset=logo&brandId=' + encodeURIComponent(brand.id), {
        headers: { Authorization: 'Bearer ' + state.token },
      });
      if (!response.ok || typeof URL === 'undefined' || !URL.createObjectURL) return;
      state.logoUrls[brand.id] = URL.createObjectURL(await response.blob());
    } catch (err) {}
  }

  function lockedHtml() {
    return '<div class="module-card coming" aria-disabled="true"><div class="module-icon">📣</div><div class="module-name">Marketing</div><div class="module-desc">Send mail and outreach campaigns to your leads, right from FORGE.</div><div class="module-status soon">Coming soon!</div></div><p class="mkt-note"><a href="dashboard.html">Back to the dashboard</a></p>';
  }

  function applyMailMode(state) {
    var testing = mailIsTest(state);
    var lead = document.getElementById('mkt-lead');
    if (lead) {
      lead.textContent = testing
        ? 'Pick how you want to reach these owners. ARIS marks the best fit for your list. Mail runs in test mode, so nothing is really printed yet.'
        : 'Pick how you want to reach these owners. ARIS marks the best fit for your list.';
    }
    var banner = document.getElementById('mkt-banner');
    if (banner) {
      banner.textContent = testing
        ? 'Test mode. Mail is not really printed or delivered. FORGE does not send email or text. You are responsible for what you send from your own phone and platforms.'
        : 'Mail is printed and sent for real. FORGE does not send email or text. You are responsible for what you send from your own phone and platforms.';
    }
  }

  function paint(state) {
    applyMailMode(state);
    var steps = document.getElementById('mkt-steps');
    var main = document.getElementById('mkt-main');
    var preview = document.getElementById('mkt-preview');
    if (steps) steps.innerHTML = state.view === 'brand' ? '' : renderSteps(state);
    if (main) main.innerHTML = renderMain(state);
    if (preview) preview.innerHTML = state.view === 'brand' ? renderPreview(state) : renderPreview(state);
  }

  function readCopyEdits(state) {
    document.querySelectorAll('[data-copy]').forEach(function (el) {
      var parts = String(el.getAttribute('data-copy') || '').split(':');
      var cls = parts[0];
      var id = parts[1];
      var variant = el.getAttribute('data-variant');
      if (!state.copies[cls] || !state.copies[cls][id] || (variant !== 'variantA' && variant !== 'variantB')) return;
      state.copies[cls][id][variant] = el.value;
    });
  }

  function readBrandForm() {
    var form = document.getElementById('mkt-brand-form');
    if (!form) return null;
    var val = function (name) {
      var el = form.querySelector('[name="' + name + '"]');
      return el ? el.value : '';
    };
    return {
      id: '',
      businessName: val('businessName'),
      phone: val('phone'),
      website: val('website'),
      email: val('email'),
      signOff: val('signOff'),
      tagline: val('tagline'),
      disclosure: val('disclosure'),
      returnAddress: {
        line1: val('line1'),
        line2: val('line2'),
        city: val('city'),
        state: val('state'),
        zip: val('zip'),
      },
      colors: { primary: val('primary'), accent: val('accent') },
      rights: !!(form.querySelector('[name="rights"]') && form.querySelector('[name="rights"]').checked),
    };
  }

  async function postJson(token, url, body) {
    var response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token ? 'Bearer ' + token : '',
      },
      body: JSON.stringify(body),
    });
    var data = {};
    try { data = await response.json(); } catch (err) { data = {}; }
    data.ok = response.ok;
    data.status = response.status;
    return data;
  }

  function cropSquare(file) {
    return new Promise(function (resolve) {
      if (!file || !/^image\/(png|jpeg|webp)$/.test(file.type) || typeof document === 'undefined') {
        resolve(file);
        return;
      }
      var url = URL.createObjectURL(file);
      var image = new Image();
      image.onload = function () {
        var side = Math.min(image.width, image.height);
        var canvas = document.createElement('canvas');
        canvas.width = side;
        canvas.height = side;
        canvas.getContext('2d').drawImage(image, Math.floor((image.width - side) / 2), Math.floor((image.height - side) / 2), side, side, 0, 0, side, side);
        canvas.toBlob(function (blob) {
          URL.revokeObjectURL(url);
          if (!blob) { resolve(file); return; }
          resolve(new File([blob], String(file.name || 'headshot').replace(/\.\w+$/, '') + '.png', { type: 'image/png' }));
        }, 'image/png');
      };
      image.onerror = function () { URL.revokeObjectURL(url); resolve(file); };
      image.src = url;
    });
  }

  function fileToBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(new Error('Could not read that file.')); };
      reader.readAsDataURL(file);
    });
  }

  function sampleColors(file) {
    return new Promise(function (resolve) {
      if (!file || !/^image\/(png|jpeg|jpg|webp)$/.test(file.type)) {
        resolve([]);
        return;
      }
      var url = URL.createObjectURL(file);
      var image = new Image();
      image.onload = function () {
        var canvas = document.createElement('canvas');
        canvas.width = 24;
        canvas.height = 24;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0, 24, 24);
        var data = ctx.getImageData(0, 0, 24, 24).data;
        var counts = {};
        for (var i = 0; i < data.length; i += 16) {
          if (data[i + 3] < 200) continue;
          var hex = '#' + [data[i], data[i + 1], data[i + 2]].map(function (n) {
            return Math.min(255, Math.round(n / 32) * 32).toString(16).padStart(2, '0');
          }).join('');
          counts[hex] = (counts[hex] || 0) + 1;
        }
        URL.revokeObjectURL(url);
        resolve(Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, 8));
      };
      image.onerror = function () { resolve([]); };
      image.src = url;
    });
  }

  async function onClick(state, event) {
    var button = event.target.closest('[data-action]');
    if (!button) return;
    var action = button.getAttribute('data-action');
    if (action === 'step') {
      var next = Number(button.getAttribute('data-step'));
      if (next >= 1 && next <= 6) {
        if (state.step === 4) readCopyEdits(state);
        state.step = next;
        state.view = 'flow';
        state.message = '';
        state.reason = '';
        if (next === 5 || next === 6) {
          state.message = mailIsTest(state) ? 'Loading the test price…' : 'Loading the price…';
          paint(state);
          await loadCost(state);
        }
        paint(state);
      }
      return;
    }
    if (action === 'show-brand') {
      state.view = 'brand';
      state.message = '';
      paint(state);
      return;
    }
    if (action === 'show-flow' || action === 'continue-goal') {
      if (action === 'continue-goal' && unknownLeft(state)) {
        state.message = 'Assign every property ARIS could not classify. ARIS does not guess.';
        paint(state);
        return;
      }
      if (action === 'continue-goal' && state.propertyClass === 'commercial' && !state.empire) return;
      state.view = 'flow';
      if (action === 'continue-goal') state.step = 2;
      state.message = '';
      paint(state);
      return;
    }
    if (action === 'class') {
      var cls = button.getAttribute('data-class');
      if (cls === 'commercial' && !state.empire) return;
      state.propertyClass = cls === 'commercial' ? 'commercial' : 'residential';
      if (!loadCatalog().angleById(state.angle, state.propertyClass)) state.angle = 'cash';
      state.previewId = '';
      state.recsFor = '';
      paint(state);
      return;
    }
    if (action === 'pick-angle') {
      var nextAngle = button.getAttribute('data-angle') || 'cash';
      if (loadCatalog().angleById(nextAngle, state.propertyClass)) state.angle = nextAngle;
      paint(state);
      return;
    }
    if (action === 'pick-template') {
      var pieceId = button.getAttribute('data-id');
      var nextTemplate = button.getAttribute('data-template');
      if (!state.designs) state.designs = {};
      var currentDesign = loadCatalog().normalizeDesign(pieceId, state.designs[pieceId]);
      currentDesign.template = nextTemplate;
      state.designs[pieceId] = currentDesign;
      paint(state);
      return;
    }
    if (action === 'zoom-preview') {
      state.zoomChannel = button.getAttribute('data-id') || '';
      paint(state);
      return;
    }
    if (action === 'close-zoom') {
      state.zoomChannel = '';
      paint(state);
      return;
    }
    if (action === 'toggle') {
      var id = button.getAttribute('data-id');
      state.selected[id] = !state.selected[id];
      state.recsFor = selectionKey(state);
      state.previewId = id;
      state.zoomChannel = '';
      paint(state);
      return;
    }
    if (action === 'show-add-address') {
      state.showAddAddress = true;
      state.addressError = '';
      paint(state);
      return;
    }
    if (action === 'use-sample') {
      var sample = Object.assign({}, loadCatalog().SAMPLE_LEAD);
      state.leads = [sample];
      state.usingSample = true;
      state.propertyClass = 'residential';
      state.editingId = '';
      state.addressError = '';
      paint(state);
      return;
    }
    if (action === 'edit-address') {
      state.editingId = button.getAttribute('data-id') || '';
      state.addressError = '';
      paint(state);
      return;
    }
    if (action === 'remove-address') {
      var removeId = button.getAttribute('data-id');
      state.leads = (state.leads || []).filter(function (lead) { return String(lead.id) !== String(removeId); });
      if (state.editingId === removeId) state.editingId = '';
      state.addressError = '';
      if (state.step >= 5) await loadCost(state);
      paint(state);
      return;
    }
    if (action === 'save-address') return saveAddress(state, button);
    if (action === 'pick-brand') {
      state.brandId = button.getAttribute('data-id');
      paint(state);
      ensureLogo(state).then(function () { paint(state); });
      return;
    }
    if (action === 'new-brand') {
      state.brandId = '';
      paint(state);
      return;
    }
    if (action === 'apply-swatch') {
      var slot = button.getAttribute('data-slot') === 'accent' ? 'accent' : 'primary';
      var field = document.querySelector('#mkt-brand-form [name="' + slot + '"]');
      if (field) field.value = button.getAttribute('data-hex') || '';
      return;
    }
    if (action === 'generate') return generate(state);
    if (action === 'topup') return startTopUp(state, Number(button.getAttribute('data-amount')));
    if (action === 'confirm-mail') return confirmMail(state);
    if (action === 'confirm-print') return confirmPrint(state);
    if (action === 'save-brand') return saveBrand(state);
    if (action === 'export') return exportCopy(state);
  }

  function onChange(state, event) {
    var target = event.target;
    if (target && target.name === 'mkt-goal') {
      state.goal = target.value;
      paint(state);
      return;
    }
    if (target && target.hasAttribute('data-assign')) {
      var leadId = target.getAttribute('data-assign');
      state.leads.forEach(function (lead) {
        if (String(lead.id) === leadId) lead.assignedClass = target.value;
      });
      paint(state);
      return;
    }
    if (target && target.hasAttribute('data-approve')) {
      readCopyEdits(state);
      state.approved[target.getAttribute('data-approve')] = target.checked;
      paint(state);
      return;
    }
    if (target && target.hasAttribute('data-attest')) {
      state.attested = target.checked;
      return;
    }
    if (target && target.hasAttribute('data-upload')) {
      uploadFile(state, target.getAttribute('data-upload'), target.files && target.files[0]);
      return;
    }
    if (target && target.hasAttribute('data-design')) {
      var designId = target.getAttribute('data-design');
      var designField = target.getAttribute('data-design-field');
      if (!state.designs) state.designs = {};
      var nextDesign = loadCatalog().normalizeDesign(designId, state.designs[designId]);
      nextDesign[designField] = target.value;
      state.designs[designId] = nextDesign;
      paint(state);
      return;
    }
    if (target && target.hasAttribute('data-style')) {
      var styleId = target.getAttribute('data-style');
      var field = target.getAttribute('data-style-field');
      if (!state.styles) state.styles = {};
      var current = styleValue(state, styleId);
      current[field] = target.value;
      state.styles[styleId] = current;
      if (field === 'hand') state.previewId = styleId;
      if (state.step >= 5) loadCost(state).then(function () { paint(state); });
      else paint(state);
      return;
    }
    if (target && (target.hasAttribute('data-print-pack') || target.hasAttribute('data-print-option'))) {
      var printId = target.getAttribute('data-print-pack') || target.getAttribute('data-print-option');
      var choice = printChoice(state, printId);
      if (!choice) return;
      if (!state.prints) state.prints = {};
      if (target.hasAttribute('data-print-pack')) choice.quantity = Number(target.value);
      else choice.option = target.value;
      state.prints[printId] = choice;
      if (state.step >= 5) loadCost(state).then(function () { paint(state); });
      else paint(state);
      return;
    }
    if (target && target.hasAttribute('data-ship')) {
      var draft = shipDraft(state);
      draft[target.getAttribute('data-ship')] = target.value;
      state.shipTo = draft;
      state.shipTouched = true;
    }
  }

  async function saveBrand(state) {
    var form = readBrandForm();
    if (!form) return;
    form.id = state.brandId || '';
    var saved = await postJson(state.token, '/api/marketing-brand', { action: 'save', brand: form });
    if (!saved.ok) {
      state.message = saved.error || 'Brand Kit could not be saved.';
      paint(state);
      return;
    }
    if (saved.brand) {
      state.brandId = saved.brand.id;
      var replaced = false;
      state.brands = state.brands.map(function (row) {
        if (row.id === saved.brand.id) { replaced = true; return saved.brand; }
        return row;
      });
      if (!replaced) state.brands.push(saved.brand);
    }
    state.message = saved.flagged
      ? 'Saved. The name was flagged for John to review. Nothing was emailed.'
      : 'Brand Kit saved.';
    if (form.colors && (form.colors.primary || form.colors.accent)) {
      state.message += ' Colors saved.';
    }
    paint(state);
  }

  function fileKindOk(kind, file) {
    var name = String(file && file.name || '').toLowerCase();
    var type = String(file && file.type || '').toLowerCase();
    var logo = kind === 'logo';
    var okType = logo
      ? /image\/(png|jpeg|jpg|webp|svg\+xml)/.test(type) || /\.(png|jpe?g|webp|svg)$/.test(name)
      : /image\/(png|jpeg|jpg|webp)/.test(type) || /\.(png|jpe?g|webp)$/.test(name);
    if (!okType) return logo ? 'Use a PNG, JPG, SVG, or WebP.' : 'Headshots must be a JPG, PNG, or WebP.';
    if (file.size > 5 * 1024 * 1024) return 'This file is over 5 MB. Choose a smaller image.';
    return '';
  }

  async function readUploadResponse(response) {
    var text = '';
    try { text = await response.text(); } catch (err) { text = ''; }
    var data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (err) { data = {}; }
    data.ok = response.ok;
    data.status = response.status;
    if (!response.ok && !data.error) {
      data.error = response.status === 413
        ? 'This file is over 5 MB. Choose a smaller image.'
        : 'The upload did not go through. Try again.';
    }
    return data;
  }

  async function uploadFile(state, kind, file) {
    try {
      if (!file) return;
      var form = readBrandForm();
      if (!form || !form.rights) {
        state.message = 'Check the rights box to upload.';
        paint(state);
        return;
      }
      var typeError = fileKindOk(kind, file);
      if (typeError) {
        state.message = typeError;
        paint(state);
        return;
      }
      if (!state.brandId) {
        await saveBrand(state);
        if (!state.brandId) {
          if (!state.message) state.message = 'Save the Brand Kit before you upload a file.';
          paint(state);
          return;
        }
      }
      if (kind === 'headshot') file = await cropSquare(file);
      state.message = 'Uploading…';
      paint(state);
      var params = new URLSearchParams({
        action: 'upload',
        brandId: state.brandId,
        kind: kind,
        fileName: file.name || 'upload',
        rights: '1',
      });
      var response = await fetch('/api/marketing-brand?' + params.toString(), {
        method: 'POST',
        headers: {
          Authorization: state.token ? 'Bearer ' + state.token : '',
          'Content-Type': file.type || 'application/octet-stream',
        },
        body: file,
      });
      var uploaded = await readUploadResponse(response);
      if (!uploaded.ok) {
        state.message = uploaded.error || 'That file could not be saved.';
        paint(state);
        return;
      }
      if (kind === 'logo') {
        var samples = uploaded.swatches && uploaded.swatches.length ? uploaded.swatches : [];
        try { if (!samples.length) samples = await sampleColors(file); } catch (err) { samples = []; }
        if (samples.length) {
          var suggested = await postJson(state.token, '/api/marketing-brand', { action: 'suggest', samples: samples });
          if (suggested.ok && suggested.swatches) state.swatches = suggested.swatches;
        }
      }
      if (uploaded.brand) {
        var replaced = false;
        state.brands = state.brands.map(function (row) {
          if (row.id !== uploaded.brand.id) return row;
          replaced = true;
          return uploaded.brand;
        });
        if (!replaced) state.brands.push(uploaded.brand);
        state.brandId = uploaded.brand.id;
      }
      if (kind === 'logo' && state.brandId && typeof URL !== 'undefined' && URL.createObjectURL) {
        if (!state.logoUrls) state.logoUrls = {};
        try { state.logoUrls[state.brandId] = URL.createObjectURL(file); } catch (err) {}
      }
      var savedName = uploaded.brand && uploaded.brand[kind] && uploaded.brand[kind].fileName;
      state.message = (savedName ? 'Saved ' + savedName + '. ' : 'File saved. ') + ((uploaded.warnings || []).join(' '));
      if (state.swatches && state.swatches.length) state.message += ' Suggested colors: ' + state.swatches.join(', ') + '.';
      if (uploaded.flagged) state.message += ' Flagged for John. Nothing was emailed.';
      paint(state);
    } catch (err) {
      state.message = 'The upload did not go through. Try again.';
      paint(state);
    }
  }

  async function loadCost(state) {
    var result = await postJson(state.token, '/api/marketing-order', {
      action: 'quote',
      channels: approvedMailIds(state),
      prints: printOrders(state),
      styles: state.styles || {},
      leads: state.leads || [],
      brandId: state.brandId,
    });
    if (!result.ok) {
      state.message = result.error || (mailIsTest(state) ? 'The test price could not be loaded.' : 'The price could not be loaded.');
      return;
    }
    state.quote = result;
    state.message = '';
  }

  var CAMPAIGN_KEY = 'forge-marketing-campaign';

  function browserStores() {
    var stores = [];
    try { if (typeof sessionStorage !== 'undefined') stores.push(sessionStorage); } catch (err) {}
    try { if (typeof localStorage !== 'undefined') stores.push(localStorage); } catch (err) {}
    return stores;
  }

  function campaignStorage(storage) {
    if (storage) return storage;
    var stores = browserStores();
    return {
      getItem: function (key) {
        for (var i = 0; i < stores.length; i++) {
          try {
            var value = stores[i].getItem(key);
            if (value) return value;
          } catch (err) {}
        }
        return null;
      },
      setItem: function (key, value) {
        stores.forEach(function (store) {
          try { store.setItem(key, value); } catch (err) {}
        });
      },
    };
  }

  function saveCampaign(storage, state, amountCents) {
    var payload = {
      version: 1,
      amountCents: amountCents || 0,
      balanceCents: state.quote && typeof state.quote.balanceCents === 'number' ? state.quote.balanceCents : null,
      step: state.step,
      goal: state.goal,
      propertyClass: state.propertyClass,
      filter: state.filter,
      recommendedFirst: state.recommendedFirst,
      selected: state.selected,
      copies: state.copies,
      approved: state.approved,
      leads: state.leads,
      brandId: state.brandId,
      previewId: state.previewId,
      recommendation: state.recommendation,
      attested: !!state.attested,
      usingSample: !!state.usingSample,
      fromSearch: !!state.fromSearch,
      goalNote: state.goalNote || '',
      showAddAddress: !!state.showAddAddress,
      swatches: state.swatches,
      quote: state.quote,
      confirmKey: state.confirmKey,
      printKey: state.printKey,
      prints: state.prints,
      styles: state.styles,
      designs: state.designs,
      angle: state.angle,
      shipTo: state.shipTo,
      shipTouched: !!state.shipTouched,
      sender: state.sender,
      noticed: !!state.noticed,
    };
    campaignStorage(storage).setItem(CAMPAIGN_KEY, JSON.stringify(payload));
    return payload;
  }

  function readCampaign(storage) {
    try {
      var parsed = JSON.parse(campaignStorage(storage).getItem(CAMPAIGN_KEY) || 'null');
      if (!parsed || parsed.version !== 1) return null;
      return parsed;
    } catch (err) {
      return null;
    }
  }

  function applyCampaign(state, draft) {
    if (!draft) return;
    state.goal = draft.goal || state.goal;
    state.propertyClass = draft.propertyClass || state.propertyClass;
    state.filter = draft.filter || state.filter;
    state.recommendedFirst = draft.recommendedFirst !== false;
    state.selected = Object.assign({}, draft.selected || {});
    state.copies = {
      residential: Object.assign({}, (draft.copies && draft.copies.residential) || {}),
      commercial: Object.assign({}, (draft.copies && draft.copies.commercial) || {}),
    };
    state.approved = Object.assign({}, draft.approved || {});
    if (Array.isArray(draft.leads)) state.leads = draft.leads.slice();
    if (draft.brandId && (state.brands || []).some(function (brand) { return brand.id === draft.brandId; })) state.brandId = draft.brandId;
    state.previewId = draft.previewId || '';
    state.recommendation = draft.recommendation || '';
    state.attested = !!draft.attested;
    state.usingSample = !!draft.usingSample;
    state.fromSearch = !!draft.fromSearch;
    state.goalNote = draft.goalNote || '';
    state.showAddAddress = !!draft.showAddAddress;
    state.swatches = Array.isArray(draft.swatches) ? draft.swatches.slice() : [];
    state.quote = draft.quote || state.quote;
    state.confirmKey = draft.confirmKey || '';
    state.printKey = draft.printKey || '';
    state.prints = Object.assign({}, draft.prints || {});
    state.styles = Object.assign({}, draft.styles || {});
    state.designs = Object.assign({}, draft.designs || {});
    state.angle = draft.angle || state.angle || 'cash';
    state.shipTo = draft.shipTo || null;
    state.shipTouched = !!draft.shipTouched;
    state.sender = draft.sender || state.sender;
    if (draft.step) state.step = draft.step;
    state.noticed = !!draft.noticed;
  }

  function clearCampaign(storage) {
    var targets = storage ? [storage] : browserStores();
    targets.forEach(function (store) {
      try { store.removeItem(CAMPAIGN_KEY); } catch (err) {}
    });
  }

  function resumeCampaign(state, search, storage) {
    var params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
    var wallet = params.get('wallet');
    var returning = wallet === 'success' || wallet === 'ok' || wallet === 'cancel';
    // A Market click is a new campaign. The saved wallet campaign must not
    // put the page back on its old step.
    if (!returning && state.fromSearch && params.get('from') === 'property-search') {
      clearCampaign(storage);
      return { wallet: '', fresh: true, before: null };
    }
    var draft = readCampaign(storage);
    if (draft) applyCampaign(state, draft);
    if (!returning && !draft) return null;
    if (returning) {
      state.step = 5;
      state.view = 'flow';
    }
    if ((wallet === 'success' || wallet === 'ok') && !(draft && draft.noticed)) {
      var cents = draft && Number(draft.amountCents);
      state.message = cents ? 'Added ' + money(cents) + ' to your credit.' : 'Added credit to your balance.';
      state.reason = '';
      state.noticed = true;
      if (draft) saveCampaign(storage, state, cents);
    }
    return { wallet: wallet || '', before: draft ? draft.balanceCents : null };
  }

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  async function pollBalance(state, before) {
    var tries = 4;
    for (var i = 0; i < tries; i++) {
      try {
        var response = await fetch('/api/marketing-wallet', {
          headers: { Authorization: state.token ? 'Bearer ' + state.token : '' },
        });
        if (response.ok) {
          var data = await response.json();
          if (typeof data.testMode === 'boolean') {
            state.testMode = data.testMode;
            if (state.menu) state.menu.testMode = data.testMode;
          }
          if (!state.quote) state.quote = { lines: [], chargedCents: 0, shortfallCents: 0, balanceCents: 0 };
          state.quote.balanceCents = data.balanceCents;
          if (state.quote.chargedCents) state.quote.shortfallCents = Math.max(0, state.quote.chargedCents - data.balanceCents);
          paint(state);
          if (before == null || Number(data.balanceCents) > Number(before)) return;
        }
      } catch (err) {}
      if (i < tries - 1) await delay(1500);
    }
  }

  async function startTopUp(state, cents) {
    state.reason = '';
    saveCampaign(null, state, cents);
    var result = await postJson(state.token, '/api/marketing-wallet', { action: 'topup', amountCents: cents });
    if (result.ok && result.url) {
      window.location.href = result.url;
      return;
    }
    state.message = result.error || (mailIsTest(state) ? 'Test checkout is not configured.' : 'Checkout could not be started.');
    state.reason = result.reason || (result.error ? 'client_status_' + (result.status || 0) : 'client_non_json');
    paint(state);
  }

  function readAddressForm(form) {
    function val(name) {
      var el = form.querySelector('[name="' + name + '"]');
      return el ? String(el.value || '').trim() : '';
    }
    return {
      address: val('address'),
      city: val('city'),
      state: val('state').toUpperCase(),
      zip: val('zip'),
      owner: val('owner'),
    };
  }

  async function saveAddress(state, button) {
    var form = button.closest('form');
    if (!form) return;
    var row = readAddressForm(form);
    var missing = missingMailFields(row);
    if (missing.length) {
      state.addressError = 'Enter a valid ' + missing.join(', ') + '.';
      paint(state);
      return;
    }
    state.addressError = '';
    var id = button.getAttribute('data-id');
    if (id) {
      (state.leads || []).forEach(function (lead) {
        if (String(lead.id) !== String(id)) return;
        lead.address = row.address;
        lead.city = row.city;
        lead.state = row.state;
        lead.zip = row.zip;
        lead.owner = row.owner;
        lead.mailSource = '';
      });
      state.editingId = '';
    } else {
      if (!state.leads) state.leads = [];
      state.leads.push({
        id: 'lead_' + Date.now().toString(36),
        address: row.address,
        city: row.city,
        state: row.state,
        zip: row.zip,
        owner: row.owner,
        propertyType: 'SFR',
      });
    }
    state.message = '';
    if (state.step >= 5) await loadCost(state);
    paint(state);
  }

  async function confirmMail(state) {
    readCopyEdits(state);
    var incomplete = (state.leads || []).filter(function (lead) { return missingMailFields(lead).length; });
    if (!(state.leads || []).length || incomplete.length) {
      state.message = incomplete.length
        ? 'Fix the address marked below before you confirm.'
        : 'Add a street, city, state, and ZIP for each property you want mailed.';
      paint(state);
      return;
    }
    var copies = currentCopies(state);
    var pieces = selectedIds(state).filter(function (id) { return copies[id]; }).map(function (id) {
      return {
        channel: id,
        variantA: copies[id].variantA,
        variantB: copies[id].variantB,
        approved: !!state.approved[state.propertyClass + ':' + id],
      };
    });
    var notesReady = !!(state.menu && state.menu.handwrittenOrderable);
    var mailIds = approvedMailIds(state).filter(function (id) {
      return (id !== 'handwritten' && id !== 'yellow-letter') || notesReady;
    });
    if (!mailIds.length) {
      var approved = approvedMailIds(state);
      state.message = approved.indexOf('yellow-letter') !== -1 && approved.indexOf('handwritten') !== -1
        ? 'Handwritten notes and yellow letters are coming soon.'
        : (approved.indexOf('yellow-letter') !== -1
          ? 'Yellow letters are coming soon.'
          : (approved.indexOf('handwritten') !== -1
            ? 'Handwritten notes are coming soon.'
            : 'Approve a postcard or a letter before you confirm.'));
      paint(state);
      return;
    }
    if (!state.confirmKey) state.confirmKey = 'cfm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    var result = await postJson(state.token, '/api/marketing-order', {
      action: 'confirm',
      channels: mailIds,
      pieces: pieces.filter(function (piece) { return mailIds.indexOf(piece.channel) !== -1; }),
      leads: state.leads || [],
      styles: state.styles || {},
      designs: state.designs || {},
      brandId: state.brandId,
      idempotencyKey: state.confirmKey,
    });
    if (!result.ok) {
      if (result.status !== 409) state.confirmKey = '';
      state.message = result.error || (mailIsTest(state) ? 'The test mailing was not accepted.' : 'The mailing was not accepted.');
      if (result.shortfallCents && state.quote) state.quote.shortfallCents = result.shortfallCents;
      paint(state);
      return;
    }
    if (state.quote) state.quote.balanceCents = result.balanceCents;
    state.confirmKey = '';
    state.message = mailIsTest(state) ? 'Test mail accepted. Nothing was really printed.' : 'Mail accepted.';
    paint(state);
  }

  async function confirmPrint(state) {
    var orders = printOrders(state);
    if (!orders.length) {
      state.message = 'Choose a pack size before you ship printed goods.';
      paint(state);
      return;
    }
    var ship = shipDraft(state);
    if (!ship.line1 || !ship.city || !/^[A-Za-z]{2}$/.test(ship.state || '') || !/^\d{5}(-\d{4})?$/.test(ship.zip || '')) {
      state.message = 'Add the address where printed goods should ship.';
      paint(state);
      return;
    }
    if (!state.printKey) state.printKey = 'prn_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    var result = await postJson(state.token, '/api/marketing-order', {
      action: 'confirm-print',
      prints: orders,
      shipTo: ship,
      brandId: state.brandId,
      idempotencyKey: state.printKey,
    });
    if (!result.ok) {
      if (result.status !== 409) state.printKey = '';
      state.message = result.error || (mailIsTest(state) ? 'The test print order was not recorded.' : 'The print order was not recorded.');
      if (result.shortfallCents && state.quote) state.quote.shortfallCents = result.shortfallCents;
      paint(state);
      return;
    }
    if (state.quote) state.quote.balanceCents = result.balanceCents;
    state.printKey = '';
    state.message = mailIsTest(state)
      ? 'Test print order recorded. Nothing was sent to a printer. Test credits were debited.'
      : 'Print order recorded. Credits were debited.';
    paint(state);
  }

  async function generate(state) {
    var catalog = loadCatalog();
    var ids = selectedIds(state).filter(function (id) {
      var channel = catalog.channelById(id);
      return channel && channel.copy !== false && channel.selectable !== false && catalog.channelsForClass(state.propertyClass).some(function (row) { return row.id === id; });
    });
    if (!ids.length) {
      state.message = 'Select at least one type ARIS can write. Printing and data services are coming soon.';
      paint(state);
      return;
    }
    var groups = split(state);
    var leads = state.propertyClass === 'commercial' ? groups.commercial : groups.residential;
    state.message = 'ARIS is writing…';
    paint(state);
    var result = await postJson(state.token, '/api/marketing-copy', {
      action: 'generate',
      goal: state.goal,
      propertyClass: state.propertyClass,
      channels: ids,
      brandId: state.brandId,
      leads: leads,
      sender: state.sender,
      angle: state.angle,
    });
    if (!result.ok) {
      ids.forEach(function (id) {
        state.copies[state.propertyClass][id] = catalog.starterPiece(id, {
          propertyClass: state.propertyClass,
          brand: activeBrand(state),
          sender: state.sender,
          leads: leads,
          angle: state.angle,
          softTone: (leads || []).some(function (lead) {
            return (lead.playIds || []).indexOf('prefore') !== -1 || (lead.playIds || []).indexOf('inherited') !== -1;
          }),
        });
      });
      state.recommendation = catalog.recommendationText(state.propertyClass, mailIsTest(state));
      state.message = result.error || 'ARIS is unavailable, so these are starting drafts.';
    } else {
      (result.copies || []).forEach(function (piece) {
        state.copies[state.propertyClass][piece.channel] = piece;
      });
      state.recommendation = result.recommendation || '';
      state.message = '';
    }
    state.step = 3;
    state.view = 'flow';
    paint(state);
  }

  async function exportCopy(state) {
    readCopyEdits(state);
    var catalog = loadCatalog();
    var copies = currentCopies(state);
    var ids = selectedIds(state).filter(function (id) { return copies[id]; });
    var pieces = ids.map(function (id) {
      var key = state.propertyClass + ':' + id;
      return {
        channel: id,
        variantA: copies[id].variantA,
        variantB: copies[id].variantB,
        approved: !!state.approved[key],
      };
    });
    var needsAttest = ids.some(function (id) {
      var channel = catalog.channelById(id);
      return channel && channel.attest;
    });
    if (needsAttest && !state.attested) {
      state.message = 'Export stays off until you confirm the calling and texting statement.';
      paint(state);
      return;
    }
    var result = await postJson(state.token, '/api/marketing-copy', {
      action: 'export',
      propertyClass: state.propertyClass,
      channels: ids,
      pieces: pieces,
      brandId: state.brandId,
      accepted: needsAttest ? true : false,
    });
    if (!result.ok) {
      state.message = result.error || 'That copy could not be exported.';
      paint(state);
      return;
    }
    var blob = new Blob([result.text], { type: 'text/plain' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = result.filename || 'forge-marketing-copy.txt';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    state.message = 'Exported. The compliance reminder is at the top of the file. FORGE did not send it.';
    paint(state);
  }

  function showFallback(loading, app, locked, html) {
    if (loading) loading.hidden = true;
    if (app) app.hidden = true;
    if (locked) {
      locked.hidden = false;
      locked.innerHTML = html;
    }
  }

  async function start(opts) {
    var options = opts || {};
    var loading = document.getElementById('mkt-loading');
    var locked = document.getElementById('mkt-locked');
    var app = document.getElementById('mkt-app');
    var problem = '<p class="mkt-message">Marketing could not be opened. Refresh the page. If this keeps happening, email support@forgedbyaris.com.</p>';
    try {
      var response = await fetch('/api/marketing-access', {
        headers: options.token ? { Authorization: 'Bearer ' + options.token } : {},
      });
      var access = {};
      try { access = await response.json(); } catch (err) { access = {}; }
      if (!response.ok || access.allowed !== true) {
        showFallback(loading, app, locked, lockedHtml());
        return;
      }
      var scope = typeof globalThis !== 'undefined' ? globalThis : {};
      var entry = scope.ForgeMarketingEntry;
      var stored = entry && entry.readLeads ? entry.readLeads() : null;
      var state = createState({
        empire: !!access.empire,
        brandLimit: access.brandLimit || (access.empire ? 3 : 1),
        reviewer: !!access.reviewer,
        leads: stored && stored.leads ? stored.leads : [],
        sender: options.sender || {},
        menu: access.menu || null,
      });
      if (stored && stored.leads && stored.leads.length) {
        var groups = loadCatalog().splitLeads(stored.leads);
        if (!groups.residential.length && groups.commercial.length && access.empire) state.propertyClass = 'commercial';
      }
      var pageSearch = '';
      try { pageSearch = location.search || ''; } catch (err) { pageSearch = ''; }
      if (isFreshMarketHandoff(pageSearch, stored)) arriveFromSearch(state, stored);
      state.token = options.token;
      var brandResponse = await fetch('/api/marketing-brand', {
        headers: { Authorization: 'Bearer ' + options.token },
      });
      if (brandResponse.ok) {
        var brandDoc = await brandResponse.json();
        state.brands = brandDoc.brands || [];
        state.brandId = state.brands[0] ? state.brands[0].id : '';
      }
      if (loading) loading.hidden = true;
      if (app) {
        app.hidden = false;
        app.addEventListener('click', function (event) { onClick(state, event); });
        app.addEventListener('change', function (event) { onChange(state, event); });
      }
      if (typeof document.addEventListener === 'function') {
        document.addEventListener('keydown', function (event) {
          if ((event.key === 'Escape' || event.key === 'Esc') && state.zoomChannel) {
            state.zoomChannel = '';
            paint(state);
          }
        });
      }
      await ensureLogo(state);
      var walletReturn = null;
      if (typeof location !== 'undefined') walletReturn = resumeCampaign(state, pageSearch);
      if (walletReturn && walletReturn.fresh) saveCampaign(null, state, 0);
      paint(state);
      if (walletReturn && walletReturn.fresh && typeof history !== 'undefined' && history.replaceState) {
        try { history.replaceState(null, '', location.pathname); } catch (err) {}
      }
      if (walletReturn && (walletReturn.wallet === 'success' || walletReturn.wallet === 'ok')) {
        if (typeof history !== 'undefined' && history.replaceState) history.replaceState(null, '', location.pathname);
        pollBalance(state, walletReturn.before);
      } else if (walletReturn && walletReturn.wallet === 'cancel' && typeof history !== 'undefined' && history.replaceState) {
        history.replaceState(null, '', location.pathname);
      }
    } catch (err) {
      showFallback(loading, app, locked, problem);
    }
  }

  return {
    createState: createState,
    renderSteps: renderSteps,
    renderGoal: renderGoal,
    renderPiece: renderPiece,
    renderPicker: renderPicker,
    renderCopy: renderCopy,
    renderApprove: renderApprove,
    renderCost: renderCost,
    renderConfirm: renderConfirm,
    renderBrand: renderBrand,
    renderMain: renderMain,
    renderPreview: renderPreview,
    withoutDisclosure: withoutDisclosure,
    lockedHtml: lockedHtml,
    mailMissingFields: mailMissingFields,
    start: start,
    saveCampaign: saveCampaign,
    readCampaign: readCampaign,
    resumeCampaign: resumeCampaign,
    pickCampaignGoal: pickCampaignGoal,
    arriveFromSearch: arriveFromSearch,
    isFreshMarketHandoff: isFreshMarketHandoff,
  };
});
