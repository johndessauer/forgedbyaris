const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const greetings = require('../assets/js/aris-greetings');

const {
  selectDashboardGreeting,
  selectCoachOpening,
  firstNameFromMember,
  extractAddress,
  extractTopic,
  thanksgivingDay,
} = greetings;

function store() {
  const data = new Map();
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
  };
}

function john() {
  return {
    id: 'mem_john',
    customFields: { 'first-name': 'John', 'last-name': 'Smith', 'full-name': 'John Smith' },
    auth: { email: 'john@example.com' },
  };
}

function at(iso) {
  return new Date(iso);
}

function daysBefore(iso, days) {
  return new Date(at(iso).getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function userMessage(text, createdAt, memberId) {
  const message = { role: 'user', content: text, created_at: createdAt };
  if (memberId) message.memberId = memberId;
  return message;
}

function assertNotHistory(result) {
  assert.equal(result.persist, false);
  assert.equal(result.includeInModelHistory, false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'role'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'content'), false);
}

test('first name comes from Memberstack first-name, not the email', () => {
  assert.equal(firstNameFromMember(john()), 'John');
  assert.equal(firstNameFromMember({
    customFields: [{ key: 'first-name', value: 'JOHN' }],
    auth: { email: 'john@example.com' },
  }), 'John');
  assert.equal(firstNameFromMember({
    customFields: { 'full-name': 'Mary-Jane Watson' },
    auth: { email: 'mj@example.com' },
  }), 'Mary-Jane');
  assert.equal(firstNameFromMember({
    customFields: { 'first-name': 'McDonald' },
  }), 'McDonald');
  assert.equal(firstNameFromMember({
    auth: { email: 'ada@example.com' },
  }), '');
  assert.equal(firstNameFromMember({
    customFields: { 'full-name': 'ada@example.com' },
  }), '');
  assert.equal(firstNameFromMember(null), '');
  assert.equal(firstNameFromMember({ customFields: { 'full-name': 'Member' } }), '');
});

test('first Chicago-day visit is the long greeting and a later visit the same day is shorter', () => {
  const storage = store();
  const member = john();
  const first = selectDashboardGreeting({
    member,
    storage,
    now: at('2026-06-10T15:00:00.000Z'),
    random: () => 0,
  });
  const again = selectDashboardGreeting({
    member,
    storage,
    now: at('2026-06-10T22:00:00.000Z'),
    random: () => 0,
  });

  assert.equal(first.firstOfDay, true);
  assert.equal(first.tone, 'first');
  assert.equal(first.dateKey, '2026-06-10');
  assert.match(first.text, /^Hey John, how are ya\? Glad to see you're back\./);
  assert.equal(first.placeholder, 'What are we working on today, and how can I help?');
  assert.ok(first.text.includes(first.placeholder));
  assertNotHistory(first);

  assert.equal(again.firstOfDay, false);
  assert.equal(again.tone, 'repeat');
  assert.equal(again.dateKey, '2026-06-10');
  assert.doesNotMatch(again.text, /Glad to see you're back/);
  assert.ok(again.text.length < first.text.length);
  assert.match(again.text, /^Hey John\./);
  assert.ok(again.text.includes(again.placeholder));
  assert.notEqual(first.templateId, again.templateId);
});

test('the day rolls at midnight in America/Chicago and the next wording does not repeat', () => {
  const storage = store();
  const member = john();
  const late = selectDashboardGreeting({
    member,
    storage,
    now: at('2026-11-27T05:59:00.000Z'),
    random: () => 0,
  });
  const midnight = selectDashboardGreeting({
    member,
    storage,
    now: at('2026-11-27T06:00:00.000Z'),
    random: () => 0,
  });
  const laterThatDay = selectDashboardGreeting({
    member,
    storage,
    now: at('2026-11-27T18:00:00.000Z'),
    random: () => 0,
  });

  assert.equal(late.dateKey, '2026-11-26');
  assert.equal(late.firstOfDay, true);
  assert.equal(midnight.dateKey, '2026-11-27');
  assert.equal(midnight.firstOfDay, true);
  assert.notEqual(late.templateId, midnight.templateId);
  assert.equal(laterThatDay.firstOfDay, false);
  assert.equal(laterThatDay.dateKey, '2026-11-27');
  assert.notEqual(midnight.templateId, laterThatDay.templateId);
});

test('a missing name stays out of the sentence and members do not share a day record', () => {
  const storage = store();
  const nameless = selectDashboardGreeting({
    member: { id: 'mem_ada', auth: { email: 'ada@example.com' } },
    storage,
    now: at('2026-06-10T15:00:00.000Z'),
    random: () => 0,
  });
  const other = selectDashboardGreeting({
    member: john(),
    storage,
    now: at('2026-06-10T15:00:00.000Z'),
    random: () => 0,
  });

  assert.equal(nameless.firstName, '');
  assert.doesNotMatch(nameless.text, /ada|@|John/i);
  assert.match(nameless.text, /^Hey, how are ya\?/);
  assert.equal(other.firstOfDay, true);
  assert.match(other.text, /John/);
});

test('street addresses are read from the member\'s own recent user text', () => {
  assert.equal(extractAddress('Look at 1234 Main Street this week'), '1234 Main Street');
  assert.equal(extractAddress('the house at 88 oak ave is vacant'), '88 Oak Ave');
  assert.equal(extractAddress('4400 E Riverside Dr needs a roof'), '4400 E Riverside Dr');
  assert.equal(extractAddress('88 N. Oak Avenue'), '88 N Oak Avenue');
  assert.equal(extractAddress('let us talk strategy and follow up'), '');
  assert.equal(extractAddress('5 days ago I walked the Street'), '');

  const now = at('2026-06-10T18:00:00.000Z').getTime();
  const recent = daysBefore('2026-06-10T18:00:00.000Z', 3);
  const stale = daysBefore('2026-06-10T18:00:00.000Z', 20);
  const messages = [
    { role: 'assistant', content: 'Try 555 Assistant Blvd', created_at: recent },
    userMessage('Ignore 999 Other Road', recent, 'mem_other'),
    userMessage('Underwrite 1234 Main Street', stale, 'mem_john'),
    {
      role: 'user',
      memberId: 'mem_john',
      created_at: recent,
      content: [{ type: 'text', text: 'Pull 10 King Drive and check the taxes' }],
    },
    { role: 'user', content: [{ type: 'tool_result', content: '1 Tool Road' }], created_at: recent },
  ];
  const snapshot = JSON.parse(JSON.stringify(messages));
  assert.equal(extractTopic(messages, 'mem_john', now), '10 King Drive');
  assert.deepEqual(messages, snapshot);
  assert.equal(extractTopic([
    userMessage('1234 Main Street', daysBefore('2026-06-10T18:00:00.000Z', 16), 'mem_john'),
  ], 'mem_john', now), '');
  assert.equal(extractTopic([
    userMessage('1234 Main Street', recent),
  ], 'mem_john', now), '1234 Main Street');
});

test('coach falls back to a standard greeting unless this is a memory open with a recent address', () => {
  const now = at('2026-06-10T18:00:00.000Z');
  const recent = daysBefore('2026-06-10T18:00:00.000Z', 2);
  const own = [userMessage('The deal is 1234 Main Street', recent, 'mem_john')];
  const storage = store();

  const first = selectCoachOpening({ member: john(), messages: own, storage, now, random: () => 0 });
  const second = selectCoachOpening({ member: john(), messages: own, storage, now, random: () => 0 });
  const third = selectCoachOpening({ member: john(), messages: own, storage, now, random: () => 0 });

  assert.equal(first.kind, 'first');
  assert.equal(first.topic, '');
  assert.doesNotMatch(first.text, /1234 Main Street|Are we talking about/);
  assert.match(first.text, /Hey John/);
  assertNotHistory(first);

  assert.equal(second.kind, 'first');
  assert.doesNotMatch(second.text, /1234 Main Street/);
  assert.notEqual(first.templateId, second.templateId);

  assert.equal(third.kind, 'memory');
  assert.equal(third.topic, '1234 Main Street');
  assert.match(third.text, /Are we talking about 1234 Main Street\? Are we working on something new\? What do you need\? How can I help\?/);
  assert.doesNotMatch(third.text, /Zillow|PropStream|Glad to see you're back/);
  assertNotHistory(third);

  let memoryOpens = 0;
  const cadence = store();
  for (let i = 0; i < 6; i++) {
    const opening = selectCoachOpening({ member: john(), messages: own, storage: cadence, now, random: () => 0.4 });
    if (opening.kind === 'memory') memoryOpens += 1;
  }
  assert.equal(memoryOpens, 2);
});

test('a memory open with no usable topic, another member\'s address, or a quick-chat handoff stays off that topic', () => {
  const now = at('2026-06-10T18:00:00.000Z');
  const recent = daysBefore('2026-06-10T18:00:00.000Z', 2);
  const seeded = store();
  seeded.setItem('forge-coach-greeting:mem_john', JSON.stringify({ opens: 2, templateId: 'first-back' }));

  const noTopic = selectCoachOpening({
    member: john(),
    messages: [userMessage('Let us review the buy box', recent, 'mem_john')],
    storage: seeded,
    now,
    random: () => 0,
  });
  assert.notEqual(noTopic.kind, 'memory');
  assert.equal(noTopic.topic, '');
  assert.doesNotMatch(noTopic.text, /Are we talking about/);
  assert.match(noTopic.text, /John/);

  const foreign = selectCoachOpening({
    member: john(),
    messages: [userMessage('999 Other Road is the one', recent, 'mem_other')],
    storage: store(),
    now,
    random: () => 0,
  });
  seeded.setItem('forge-coach-greeting:mem_john', JSON.stringify({ opens: 2, templateId: '' }));
  const foreignOnMemorySlot = selectCoachOpening({
    member: john(),
    messages: [
      userMessage('999 Other Road is the one', recent, 'mem_other'),
      { role: 'assistant', content: 'What about 555 Assistant Blvd?', created_at: recent },
    ],
    storage: seeded,
    now,
    random: () => 0,
  });
  assert.doesNotMatch(foreign.text, /999 Other Road|555 Assistant/);
  assert.notEqual(foreignOnMemorySlot.kind, 'memory');
  assert.doesNotMatch(foreignOnMemorySlot.text, /999 Other Road|555 Assistant/);

  const handoff = selectCoachOpening({
    member: john(),
    messages: [userMessage('1234 Main Street', recent, 'mem_john')],
    storage: store(),
    now,
    quickChat: 'What do you think of 1234 Main Street?',
    random: () => 0,
  });
  assert.equal(handoff.show, false);
  assert.equal(handoff.text, '');
  assert.equal(handoff.kind, 'skipped');
  assert.doesNotMatch(JSON.stringify(handoff), /1234 Main Street/);
  assertNotHistory(handoff);
});

test('same-day return is short, a long gap is warmer, and vendor names stay out of the line', () => {
  const now = at('2026-06-10T18:00:00.000Z');
  const sameDay = selectCoachOpening({
    member: john(),
    messages: [userMessage('Still on the numbers', '2026-06-10T16:00:00.000Z', 'mem_john')],
    storage: store(),
    now,
    random: () => 0,
  });
  const gap = selectCoachOpening({
    member: john(),
    messages: [userMessage('1234 Main Street on Zillow', daysBefore('2026-06-10T18:00:00.000Z', 10), 'mem_john')],
    storage: store(),
    now,
    random: () => 0,
  });
  const memorySlot = store();
  memorySlot.setItem('forge-coach-greeting:mem_john', JSON.stringify({ opens: 2, templateId: 'gap-minute' }));
  const memory = selectCoachOpening({
    member: john(),
    messages: [userMessage('Check 1234 Main Street on Zillow and PropStream', daysBefore('2026-06-10T18:00:00.000Z', 10), 'mem_john')],
    storage: memorySlot,
    now,
    random: () => 0,
  });
  const tooOld = store();
  tooOld.setItem('forge-coach-greeting:mem_john', JSON.stringify({ opens: 2, templateId: '' }));
  const stale = selectCoachOpening({
    member: john(),
    messages: [userMessage('1234 Main Street', daysBefore('2026-06-10T18:00:00.000Z', 16), 'mem_john')],
    storage: tooOld,
    now,
    random: () => 0,
  });

  assert.equal(sameDay.kind, 'repeat');
  assert.match(sameDay.text, /^Hey John\. What do you need\?$/);
  assert.equal(gap.kind, 'gap');
  assert.match(gap.text, /it's been a minute/i);
  assert.doesNotMatch(gap.text, /1234 Main Street|Zillow/);
  assert.equal(memory.kind, 'memory');
  assert.match(memory.text, /1234 Main Street/);
  assert.doesNotMatch(memory.text, /Zillow|PropStream/);
  assert.equal(stale.kind, 'gap');
  assert.doesNotMatch(stale.text, /1234 Main Street/);
});

test('Thanksgiving, New Year, and a stored birthday are light prefixes', () => {
  assert.equal(thanksgivingDay(2024), 28);
  assert.equal(thanksgivingDay(2025), 27);
  assert.equal(thanksgivingDay(2026), 26);

  const member = john();
  const storage = () => store();
  const thanksgiving = selectDashboardGreeting({
    member,
    storage: storage(),
    now: at('2026-11-26T18:00:00.000Z'),
    random: () => 0,
  });
  const dayAfter = selectDashboardGreeting({
    member,
    storage: storage(),
    now: at('2026-11-27T18:00:00.000Z'),
    random: () => 0,
  });
  const newYear = selectDashboardGreeting({
    member,
    storage: storage(),
    now: at('2026-01-01T18:00:00.000Z'),
    random: () => 0,
  });
  const eve = selectDashboardGreeting({
    member,
    storage: storage(),
    now: at('2026-12-31T18:00:00.000Z'),
    random: () => 0,
  });
  const birthday = selectDashboardGreeting({
    member: { ...john(), customFields: { ...john().customFields, birthday: '1990-07-15' } },
    storage: storage(),
    now: at('2026-07-15T18:00:00.000Z'),
    random: () => 0,
  });
  const slashBirthday = selectCoachOpening({
    member: john(),
    profile: { birthday: '07/15/1990', phone: '555-0100' },
    messages: [],
    storage: storage(),
    now: at('2026-07-15T18:00:00.000Z'),
    random: () => 0,
  });
  const noBirthday = selectDashboardGreeting({
    member,
    profile: { phone: '555-0100', preferences: { voiceReplies: true } },
    storage: storage(),
    now: at('2026-07-15T18:00:00.000Z'),
    random: () => 0,
  });
  const wrongDay = selectDashboardGreeting({
    member: { ...john(), customFields: { ...john().customFields, birthday: '1990-07-16' } },
    storage: storage(),
    now: at('2026-07-15T18:00:00.000Z'),
    random: () => 0,
  });
  const garbage = selectDashboardGreeting({
    member: { ...john(), customFields: { ...john().customFields, dob: 'sometime' } },
    storage: storage(),
    now: at('2026-07-15T18:00:00.000Z'),
    random: () => 0,
  });

  assert.match(thanksgiving.text, /^Happy Thanksgiving\. Hey John,/);
  assert.doesNotMatch(dayAfter.text, /Thanksgiving/);
  assert.match(newYear.text, /^Happy New Year\. /);
  assert.match(eve.text, /^Happy New Year's Eve\. /);
  assert.match(birthday.text, /^Happy birthday\. Hey John,/);
  assert.match(slashBirthday.text, /^Happy birthday\. /);
  assert.doesNotMatch(noBirthday.text, /birthday/i);
  assert.doesNotMatch(wrongDay.text, /birthday/i);
  assert.doesNotMatch(garbage.text, /birthday/i);
});

test('the pages keep the greeting out of chat memory and off the voice path', () => {
  const root = path.join(__dirname, '..');
  const coach = fs.readFileSync(path.join(root, 'aris-coach.html'), 'utf8');
  const dashboard = fs.readFileSync(path.join(root, 'dashboard.html'), 'utf8');
  const voice = fs.readFileSync(path.join(root, 'netlify/edge-functions/aris-voice.js'), 'utf8');
  const greetingFn = coach.slice(coach.indexOf('function maybeShowCoachGreeting'), coach.indexOf('function showIntro'));
  const paintFn = coach.slice(coach.indexOf('function paintCoachGreeting'), coach.indexOf('function forgeCoachPageReady'));

  assert.match(dashboard, /selectDashboardGreeting/);
  assert.match(dashboard, /id="quick-prompt"/);
  assert.match(dashboard, /aris-greetings\.js/);
  assert.match(coach, /data-forge-greeting/);
  assert.match(coach, /includeInModelHistory/);
  assert.match(coach, /__forgeQuickChatHandoff/);
  assert.doesNotMatch(greetingFn, /conversationHistory/);
  assert.doesNotMatch(greetingFn, /attachVoiceButton/);
  assert.doesNotMatch(paintFn, /attachVoiceButton|aris-voice|conversationHistory\.push/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'assets/js/aris-greetings.js'), 'utf8'), /createRequire|aris-voice/);
  assert.doesNotMatch(voice, /ForgeGreetings|forge-greeting/);
});
