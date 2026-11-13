const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'education.html'), 'utf8');

function extractBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`Could not extract ${startMarker}`);
  return source.slice(start, end);
}

function loadCoaching(hash) {
  const elements = {};
  for (const id of ['coaching-featured-container', 'coaching-clips-container', 'coaching-grid-section', 'coaching-grid', 'coaching-embed']) {
    elements[id] = { innerHTML: '' };
  }
  const sandbox = {
    URLSearchParams,
    encodeURIComponent,
    console,
    history: { replaceState() {} },
    window: { location: { hash } },
    document: {
      getElementById(id) { return elements[id] || null; },
      createElement() {
        const el = { textContent: '' };
        Object.defineProperty(el, 'innerHTML', {
          get() {
            return String(el.textContent)
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;');
          },
        });
        return el;
      },
    },
  };
  const source = [
    'function escapeHtml(str) {',
    '  const div = document.createElement("div");',
    '  div.textContent = str == null ? "" : str;',
    '  return div.innerHTML;',
    '}',
    extractBetween(html, 'const GROUP_COACHING_REPLAYS = ', 'function selectCoachingSession'),
    'globalThis.api = {',
    '  GROUP_COACHING_REPLAYS,',
    '  coachingTopicItems,',
    '  coachingTopicsBlock,',
    '  coachingTopicsCard,',
    '  coachingEmbedUrl,',
    '  coachingDate,',
    '  renderCoachingFeatured,',
    '  renderCoachingReplays,',
    '  renderCoachingGrid,',
    '  coachingBriefHtml,',
    '  toggleCoachingBrief,',
    '  setMembership(v) { membershipVerified = v; },',
    '  setRendered(v) { coachingRendered = v; },',
    '  setCurrent(index, clip) { coachingCurrent = index; coachingCurrentClip = clip; },',
    '};',
  ].join('\n');
  vm.runInNewContext(source, sandbox, { filename: 'education.html coaching' });
  return { api: sandbox.api, elements };
}

function session(api, n) {
  const found = api.GROUP_COACHING_REPLAYS.find((s) => s.session === n);
  assert.ok(found, `session ${n}`);
  return found;
}

function topicBlockCount(markup) {
  return (markup.match(/Topics covered/g) || []).length;
}

// Values created inside the education.html vm have a different realm, so
// compare their JSON instead of the objects themselves.
function json(value) {
  return JSON.parse(JSON.stringify(value));
}

const PROPOSED = {
  1: [
    'Choose your investing strategy and set your Why with ARIS',
    'Evaluate your market with Market Oracle',
    'Build your capital stack with Capital Radar',
  ],
  2: [
    'Wholesaling, fix-and-flip, BRRRR and rental strategy choices',
    'Market analysis with ARIS and making offers using deal numbers',
    'Backup offers, creative finance and the due-on-sale clause',
    'Four ways real estate pays you and choosing your starting lane',
  ],
  3: [
    'Grade markets using Buy / Watch / Avoid',
    'Review five key market data points and a Crown Point example',
    'Match strategies to Class A, B and C markets',
  ],
  4: [
    'Compare residential sales comps with commercial valuation',
    'Find comps through MLS, agent CMA/BPO, public records and FORGE',
    'Calculate ARV and maximum allowable offer',
    'Build contingencies and test FORGE Property Search',
  ],
};

test('education inline script still parses', () => {
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let found = 0;
  let match;
  while ((match = re.exec(html))) {
    if (/\bsrc\s*=/.test(match[1] || '') || !match[2].trim()) continue;
    found += 1;
    new vm.Script(match[2], { filename: 'education.html' });
  }
  assert.equal(found, 1);
});

test('session dates, studio durations, and video ids stay on the published uploads', () => {
  const { api } = loadCoaching('');
  const replays = api.GROUP_COACHING_REPLAYS;
  assert.deepEqual(json(replays.map((s) => s.session)), [5, 4, 3, 2, 1]);
  assert.deepEqual(json(replays.map((s) => s.youtubeId)), [
    't-PRLfCXFTc',
    'F5NGUHBeAQw',
    'Dp8cqmMoHg4',
    'hUWw3BUte5Y',
    'SxgQqVXivNI',
  ]);

  const s1 = session(api, 1);
  assert.equal(s1.date, '2026-10-14');
  assert.equal(api.coachingDate(s1.date), 'Oct 14, 2026');
  assert.equal(s1.duration, '5:16');
  assert.equal(s1.topics, undefined);
  assert.deepEqual(json(s1.summary), PROPOSED[1]);
  assert.match(s1.description, /The Oct 14 live call was not recorded, so John re-recorded this short lesson\./);
  assert.doesNotMatch(s1.description, /hour-?long/i);
  assert.doesNotMatch(s1.title, /hour/i);

  const s2 = session(api, 2);
  assert.equal(s2.date, '2026-10-21');
  assert.equal(s2.duration, '58:52');
  assert.equal(s2.summary, undefined);
  assert.equal(s2.description, 'John covers wholesaling, fix-and-flip, BRRRR, and rental strategy choices; a live market analysis with ARIS and how to make offers using deal numbers; backup offers, creative finance, and the due-on-sale clause; and the four ways real estate pays you, so you can choose your starting lane.');
  assert.deepEqual(json(s2.chapters), [
    ['0:00', 'Welcome and homework review'],
    ['3:24', 'Wholesaling: strategy and considerations'],
    ['10:43', 'Fix-and-flip: active income, costs and risks'],
    ['19:41', 'Working with contractors'],
    ['21:03', 'Live ARIS market analysis'],
    ['28:01', 'Maximum allowable offer and deal preparation'],
    ['32:26', 'Making offers and following up'],
    ['38:12', 'BRRRR and rental strategies'],
    ['44:27', 'Four ways real estate pays you'],
    ['49:44', 'Lease options and subject-to discussion'],
    ['54:53', 'FORGE education updates and action steps'],
  ]);
  const gaps = s2.chapters.map(([time]) => time.split(':').reduce((acc, part) => acc * 60 + Number(part), 0));
  assert.equal(gaps[0], 0);
  for (let i = 1; i < gaps.length; i += 1) assert.ok(gaps[i] - gaps[i - 1] >= 10);
  assert.ok(gaps[gaps.length - 1] < (58 * 60 + 52));
  assert.deepEqual(json(s2.topics), [
    'The truth about flipping houses today',
    'Why contractors can ruin your flip',
    'Watch ARIS analyze a market live',
    'Volume of offers equals velocity of deals',
    'The backup-offer trick to beat other wholesalers',
    'Subject-to and the due-on-sale clause',
  ]);

  const s3 = session(api, 3);
  assert.equal(s3.date, '2026-10-28');
  assert.equal(s3.duration, '15:55');
  assert.equal(s3.summary, undefined);
  assert.match(s3.description, /\(The live call was not recorded, so John re-recorded the core lesson\.\)/);
  assert.doesNotMatch(s3.description, /hour-?long/i);

  const s4 = session(api, 4);
  assert.equal(s4.date, '2026-11-04');
  assert.equal(s4.duration, '50:41');
  assert.equal(s4.summary, undefined);
  assert.deepEqual(json(s4.chapters), [
    ['0:00', 'Introduction'],
    ['0:36', 'Residential vs Commercial & Cap Rate'],
    ['5:24', 'Sales Comparison Approach'],
    ['13:45', 'Appraisals & Slowing Markets'],
    ['16:13', 'Four Ways to Get Comps'],
    ['24:05', 'After Repair Value (ARV)'],
    ['26:50', 'Maximum Allowable Offer (MAO)'],
    ['35:15', 'Safety Nets & Contingencies'],
    ['40:01', 'FORGE Property Search Live Demo'],
    ['49:35', 'Where to Find Replays'],
  ]);

  const s5 = session(api, 5);
  assert.equal(s5.date, '2026-11-11');
  assert.equal(api.coachingDate(s5.date), 'Nov 11, 2026');
  assert.equal(s5.duration, '1:05:01');
  assert.equal(s5.summary, undefined);
  assert.deepEqual(json(s5.clips), []);
  assert.equal(s5.description, 'FORGE Group Coaching Session 5 (Nov 11, 2026): finding motivated sellers and distressed property leads. You\'ll learn what makes a motivated seller, why pre-foreclosures (notice of default, roughly 80–90 days to auction) and tax delinquencies signal urgency — including commercial properties where taxes usually aren\'t escrowed — plus absentee owners, divorce vs probate, and why cash (or capital you can access fast) wins. John covers vacant properties and "the worst house on the best block" (a C property in a B market, never a B property in a C market), the soil-and-crops way to match your strategy to your market, and stacking distress indicators. Member Q&A covers marketing to tax-delinquent commercial owners (professional letters, not postcards, with 5+ weekly touches), where to find tax data, and a word-for-word door-knocking opener. Then the negotiation: empathy, asking questions and listening, the "If I could, would you?" line from Chris Voss\'s Never Split the Difference, a live role-play lab, the three things that make a deal, the four negotiator types, and why capital readiness is what lets you commit to a tight close. Wrap-up: log seller notes in FORGE CRM and have ARIS draft your "If I could, would you?" scripts.');
  assert.deepEqual(json(s5.chapters), [
    ['0:00', 'Welcome'],
    ['1:25', 'What Makes a Motivated Seller'],
    ['2:41', 'Pre-Foreclosures & Tax Delinquencies'],
    ['5:00', 'Absentee Owners & the Finance Pattern'],
    ['6:23', 'Why Cash Offers Win'],
    ['8:56', 'Divorce vs Probate'],
    ['12:54', 'Vacant Properties'],
    ['14:58', 'Worst House on the Best Block'],
    ['18:10', 'Soil & Crops: Match Strategy to Market'],
    ['24:02', 'Stacking Distress Indicators'],
    ['25:30', 'Q&A: Marketing to Tax-Delinquent Commercial'],
    ['30:27', 'Letters, Not Postcards: 5+ Touches'],
    ['34:27', 'Where to Find Tax-Delinquency Data'],
    ['37:23', 'Door-Knocking Scripts'],
    ['41:25', 'Members\' Door-Knocking Experience'],
    ['46:13', 'Empathy, Ask Questions & Listen'],
    ['50:00', '“If I Could, Would You?”'],
    ['53:12', 'Role-Play Lab'],
    ['54:46', 'Three Things That Make a Deal'],
    ['59:32', 'Four Negotiator Types'],
    ['1:01:25', 'Committing to a Close Date: Capital Is Key'],
    ['1:02:38', 'Notes in FORGE CRM & ARIS Scripts'],
    ['1:04:08', 'Wrap-Up & Where to Find Replays'],
  ]);
  const s5Gaps = s5.chapters.map(([time]) => time.split(':').reduce((acc, part) => acc * 60 + Number(part), 0));
  assert.equal(s5Gaps[0], 0);
  for (let i = 1; i < s5Gaps.length; i += 1) assert.ok(s5Gaps[i] - s5Gaps[i - 1] >= 10);
  assert.ok(s5Gaps[s5Gaps.length - 1] < (65 * 60 + 1));

  assert.equal(html.includes('Never Split the Difference'), true);
  const liveStart = html.indexOf('const LIVE_COACHING_VIDEOS');
  const liveEnd = html.indexOf('let liveCoachingRendered');
  const liveBlock = html.slice(liveStart, liveEnd);
  const session5Clips = [
    ['2K6LyqD_lF8', 'What Makes a Motivated Seller? Pre-Foreclosures, Tax Delinquencies & Absentee Owners'],
    ['lf5IhK51e3A', 'Worst House on the Best Block: Why You Buy a C Property in a B Market'],
    ['J-w9DM0w_no', 'Door-Knocking a Tax-Delinquent Commercial Property: What to Say'],
    ['8DPxw0SpcSM', '"If I Could, Would You?" The Negotiation Line That Closes Motivated Sellers'],
  ];
  let clipAt = liveBlock.indexOf('BF0AMw5my64');
  assert.ok(clipAt > 0);
  for (const [id, title] of session5Clips) {
    const at = liveBlock.indexOf(id);
    assert.ok(at > clipAt, id);
    assert.ok(liveBlock.includes(title), title);
    clipAt = at;
  }
  assert.ok(html.indexOf('id="nov-10-2026-webinar-highlights"') < html.indexOf('id="live-coaching-container"'));
  assert.equal(html.includes('2026-10-18'), false);
  assert.equal(html.includes('Wholesaling: buyers, leads and local rules'), false);
  assert.equal(html.includes('Homework: choose your starting lane'), false);
  assert.equal(html.includes('The backup-offer approach'), false);
  assert.equal(html.includes('Creative finance and due-on-sale'), false);
  assert.equal(html.includes('STRATEGY. MARKET. MONEY.'), false);
  for (const n of [2, 3, 4]) {
    for (const line of PROPOSED[n]) assert.equal(html.includes(line), false, line);
  }
});

test('each replay shows one topic list, and a short summary does not duplicate a longer list', () => {
  const { api } = loadCoaching('');
  for (const s of api.GROUP_COACHING_REPLAYS) {
    const items = api.coachingTopicItems(s);
    assert.equal(items.placeholder, false);
    assert.ok(items.items.length >= 3);
    const block = api.coachingTopicsBlock(s);
    const card = api.coachingTopicsCard(s);
    assert.equal(topicBlockCount(block), 1);
    assert.equal(topicBlockCount(card), 1);
    assert.equal((block.match(/<ul class="coaching-topics">/g) || []).length, 1);
    assert.equal((block.match(/<li/g) || []).length, items.items.length);
    assert.equal((card.match(/<ul/g) || []).length, 0);
    for (const item of items.items) {
      assert.equal(block.includes(item), true);
      assert.equal(card.includes(item), true);
    }
    if (s.topics) {
      assert.deepEqual(json(items.items), json(s.topics));
      const proposed = PROPOSED[s.session];
      if (proposed) {
        for (const line of proposed) assert.equal(block.includes(line), false);
      }
    } else {
      assert.deepEqual(json(items.items), PROPOSED[s.session]);
    }
  }

  const both = api.coachingTopicsBlock({
    topics: ['Longer topic already on the replay', 'Second existing topic'],
    summary: ['Short summary that must stay hidden'],
  });
  assert.equal(topicBlockCount(both), 1);
  assert.match(both, /Longer topic already on the replay/);
  assert.match(both, /Second existing topic/);
  assert.doesNotMatch(both, /Short summary that must stay hidden/);
  assert.equal((both.match(/<ul class="coaching-topics">/g) || []).length, 1);

  const summaryOnly = api.coachingTopicItems({ summary: ['  Only the short summary  ', ''] });
  assert.deepEqual(json(summaryOnly), { placeholder: false, items: ['Only the short summary'] });

  const empty = api.coachingTopicItems({});
  assert.equal(empty.placeholder, true);
  assert.equal(topicBlockCount(api.coachingTopicsBlock({})), 1);

  assert.equal(api.coachingBriefHtml({}), '');
  assert.equal(api.coachingBriefHtml({ description: '   ' }), '');
  const brief = api.coachingBriefHtml({ description: 'One paragraph recap.' });
  assert.equal((brief.match(/Group Coaching Call Brief/g) || []).length, 1);
  assert.equal((brief.match(/One paragraph recap\./g) || []).length, 1);
  assert.match(brief, /<p [^>]*hidden>/);
  assert.doesNotMatch(brief, /<ul|<li/);
});

test('member gate still hides replays, and a verified player renders one summary with captions off', () => {
  const locked = loadCoaching('#group-coaching/session-1');
  locked.api.setMembership(false);
  locked.api.setRendered(false);
  locked.api.renderCoachingReplays();
  assert.match(locked.elements['coaching-featured-container'].innerHTML, /Loading replays/);
  assert.equal(locked.elements['coaching-featured-container'].innerHTML.includes('Topics covered'), false);
  assert.match(html, /planNeedsPayment \? 'billing\.html\?payment=failed' : 'signup\.html'/);
  assert.match(html, /pln_foundation--s11cv0hs9/);
  assert.match(html, /prc_empire-plan--401c10a7h/);

  const open = loadCoaching('#group-coaching/session-1');
  open.api.setMembership(true);
  open.api.setRendered(false);
  open.api.renderCoachingReplays();
  const featured = open.elements['coaching-featured-container'].innerHTML;
  assert.equal(topicBlockCount(featured), 1);
  assert.match(featured, /Choose your investing strategy and set your Why with ARIS/);
  assert.match(featured, /Evaluate your market with Market Oracle/);
  assert.match(featured, /Build your capital stack with Capital Radar/);
  assert.match(featured, /Oct 14, 2026/);
  assert.match(featured, /re-recorded this short lesson/);
  assert.equal((featured.match(/re-recorded this short lesson/g) || []).length, 1);
  assert.match(featured, /5:16/);
  assert.match(featured, /youtube-nocookie\.com\/embed\/SxgQqVXivNI\?/);
  assert.match(featured, /cc_load_policy=0/);
  assert.doesNotMatch(featured, /cc_load_policy=1/);
  assert.equal((featured.match(/<ul class="coaching-topics">/g) || []).length, 1);

  const card = open.elements['coaching-grid'].innerHTML;
  assert.match(card, /Session 1/);
  assert.match(card, /Oct 14, 2026/);
  assert.equal(topicBlockCount(card), 5);
  assert.equal((card.match(/coaching-topics-placeholder/g) || []).length, 0);
  assert.equal(card.includes('Group Coaching Call Brief'), false);
  assert.equal(card.includes('re-recorded this short lesson'), false);
  assert.equal(card.includes('choose your starting lane'), false);

  for (const replay of open.api.GROUP_COACHING_REPLAYS) {
    open.api.setCurrent(open.api.GROUP_COACHING_REPLAYS.indexOf(replay), null);
    open.api.renderCoachingFeatured(false);
    const view = open.elements['coaching-featured-container'].innerHTML;
    assert.equal(topicBlockCount(view), 1, `session ${replay.session} topic blocks`);
    assert.match(view, new RegExp(`embed/${replay.youtubeId}\\?`));
    assert.match(view, /cc_load_policy=0/);
    assert.doesNotMatch(view, /Placeholder: topics/);
    if (replay.chapters.length) {
      assert.equal((view.match(/class="coaching-chip"/g) || []).length, replay.chapters.length);
      assert.match(view, new RegExp(replay.chapters[0][1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    } else {
      assert.doesNotMatch(view, /coaching-chip/);
    }
    const briefAt = view.indexOf('>Group Coaching Call Brief<');
    const iframeAt = view.indexOf('<iframe');
    const titleAt = view.indexOf('coaching-title');
    assert.ok(iframeAt >= 0 && briefAt > iframeAt, `session ${replay.session} brief sits under the player`);
    assert.ok(titleAt > briefAt, `session ${replay.session} brief is not in the title column`);
    assert.equal((view.match(/Group Coaching Call Brief/g) || []).length, 1);
    assert.match(view, /id="coaching-call-brief"[^>]*hidden/);
    assert.equal((view.match(/class="coaching-desc/g) || []).length, 1);
    const paragraph = replay.description
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
    assert.equal(view.split(paragraph).length - 1, 1);
  }

  open.elements['coaching-call-brief'] = { hidden: true };
  const link = { setAttribute(name, value) { this[name] = value; } };
  open.api.toggleCoachingBrief(link);
  assert.equal(open.elements['coaching-call-brief'].hidden, false);
  assert.equal(link['aria-expanded'], 'true');
  open.api.toggleCoachingBrief(link);
  assert.equal(open.elements['coaching-call-brief'].hidden, true);
  assert.equal(link['aria-expanded'], 'false');

  const embed = open.api.coachingEmbedUrl('SxgQqVXivNI', { start: 42 });
  assert.equal(embed.includes('cc_load_policy=0'), true);
  assert.equal(embed.includes('start=42'), true);
  assert.match(html, /cc_load_policy=0&rel=0/);
  assert.equal(html.includes('cc_load_policy=1'), false);
  assert.equal(html.includes("cc_load_policy: '1'"), false);
});
