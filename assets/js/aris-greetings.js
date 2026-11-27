/* Personalized ARIS greetings. Typed text only.
 *
 * The dashboard uses selectDashboardGreeting for the first visit of the
 * Chicago day, then a shorter line on later visits that same day.
 * The coach uses selectCoachOpening for one on-screen bubble. That result
 * is not a chat message: persist and includeInModelHistory stay false,
 * and there is no role or content field for the model payload.
 *
 * The member's first name is Memberstack customFields['first-name']
 * (the signup field). A full-name value is the fallback. An email is not
 * a name. A birthday is read only when a birthday value is already stored.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof root !== 'undefined') root.ForgeGreetings = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  var CHICAGO = 'America/Chicago';
  var DASHBOARD_PREFIX = 'forge-greeting:';
  var COACH_PREFIX = 'forge-coach-greeting:';
  var TOPIC_WINDOW_DAYS = 14;
  var LONG_GAP_DAYS = 7;
  var MEMORY_OPEN_INTERVAL = 3;
  var DAY_MS = 24 * 60 * 60 * 1000;

  var BIRTHDAY_KEYS = ['birthday', 'birthdate', 'birth-date', 'date-of-birth', 'date_of_birth', 'dob'];
  var VENDOR_RE = /\b(PropStream|Zillow|Redfin|Realtor\.com|DealMachine|BatchLeads|PrivyX|PropertyRadar|Realeflow)\b/gi;
  var ADDRESS_STOP = {
    the: 1, a: 1, an: 1, on: 1, at: 1, in: 1, my: 1, our: 1, this: 1, that: 1,
    days: 1, ago: 1, for: 1, and: 1, to: 1, of: 1, from: 1, with: 1, your: 1,
  };
  var ADDRESS_RE = /\b(\d{1,6})\s+((?:(?:north|south|east|west|n|s|e|w|ne|nw|se|sw)\.?\s+)?)([A-Za-z0-9][A-Za-z0-9.'-]*(?:\s+[A-Za-z0-9][A-Za-z0-9.'-]*){0,3})\s+(street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|court|ct|place|pl|way|circle|cir|trail|trl|parkway|pkwy|highway|hwy)\b\.?/i;
  var SUFFIXES = {
    street: 'Street', st: 'St', avenue: 'Avenue', ave: 'Ave', road: 'Road', rd: 'Rd',
    boulevard: 'Boulevard', blvd: 'Blvd', drive: 'Drive', dr: 'Dr', lane: 'Lane', ln: 'Ln',
    court: 'Court', ct: 'Ct', place: 'Place', pl: 'Pl', way: 'Way', circle: 'Circle',
    cir: 'Cir', trail: 'Trail', trl: 'Trl', parkway: 'Parkway', pkwy: 'Pkwy',
    highway: 'Highway', hwy: 'Hwy',
  };

  var FIRST_POOL = [
    {
      id: 'first-back',
      named: 'Hey {name}, how are ya? Glad to see you\'re back. What are we working on today, and how can I help?',
      anon: 'Hey, how are ya? Glad to see you\'re back. What are we working on today, and how can I help?',
      placeholder: 'What are we working on today, and how can I help?',
    },
    {
      id: 'first-deal',
      named: 'Hey {name}, good to have you here. What deal are we taking apart today, and how can I help?',
      anon: 'Good to have you here. What deal are we taking apart today, and how can I help?',
      placeholder: 'What deal are we taking apart today, and how can I help?',
    },
    {
      id: 'first-board',
      named: '{name}, welcome back. What\'s on the board today, and how can I help?',
      anon: 'Welcome back. What\'s on the board today, and how can I help?',
      placeholder: 'What\'s on the board today, and how can I help?',
    },
    {
      id: 'first-start',
      named: 'Hey {name}, glad you made it in. Where do you want to start today, and how can I help?',
      anon: 'Glad you made it in. Where do you want to start today, and how can I help?',
      placeholder: 'Where do you want to start today, and how can I help?',
    },
  ];

  var REPEAT_POOL = [
    {
      id: 'repeat-need',
      named: 'Hey {name}. What do you need?',
      anon: 'What do you need?',
      placeholder: 'What do you need?',
    },
    {
      id: 'repeat-help',
      named: 'Hey {name}, still with you. How can I help?',
      anon: 'Still with you. How can I help?',
      placeholder: 'How can I help?',
    },
    {
      id: 'repeat-next',
      named: 'Back again, {name}. What\'s next?',
      anon: 'Back again. What\'s next?',
      placeholder: 'What\'s next?',
    },
  ];

  var GAP_POOL = [
    {
      id: 'gap-minute',
      named: 'Hey {name}, it\'s been a minute. Glad you\'re here. What are we picking up, and how can I help?',
      anon: 'It\'s been a minute. Glad you\'re here. What are we picking up, and how can I help?',
      placeholder: 'What are we picking up, and how can I help?',
    },
    {
      id: 'gap-while',
      named: 'Hey {name}, it\'s been a while. What are we working on now, and how can I help?',
      anon: 'It\'s been a while. What are we working on now, and how can I help?',
      placeholder: 'What are we working on now, and how can I help?',
    },
    {
      id: 'gap-return',
      named: '{name}, good to see you after the gap. Where should we start, and how can I help?',
      anon: 'Good to see you after the gap. Where should we start, and how can I help?',
      placeholder: 'Where should we start, and how can I help?',
    },
  ];

  var MEMORY_POOL = [
    {
      id: 'memory-talking',
      named: 'Hey {name}. Are we talking about {topic}? Are we working on something new? What do you need? How can I help?',
      anon: 'Are we talking about {topic}? Are we working on something new? What do you need? How can I help?',
      placeholder: 'Are we working on something new?',
    },
    {
      id: 'memory-still',
      named: 'Hey {name}. Still on {topic}, or is this something new? What do you need? How can I help?',
      anon: 'Still on {topic}, or is this something new? What do you need? How can I help?',
      placeholder: 'What do you need?',
    },
    {
      id: 'memory-pick',
      named: 'Hey {name}. Want to pick up {topic}, or work on something new? How can I help?',
      anon: 'Want to pick up {topic}, or work on something new? How can I help?',
      placeholder: 'How can I help?',
    },
  ];

  function chicagoParts(date) {
    var when = date instanceof Date ? date : new Date(date || Date.now());
    var fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: CHICAGO,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
    });
    var map = {};
    fmt.formatToParts(when).forEach(function (part) {
      if (part.type !== 'literal') map[part.type] = part.value;
    });
    return {
      dateKey: map.year + '-' + map.month + '-' + map.day,
      year: Number(map.year),
      month: Number(map.month),
      day: Number(map.day),
      weekday: map.weekday,
    };
  }

  function thanksgivingDay(year) {
    var dow = new Date(Date.UTC(year, 10, 1)).getUTCDay();
    var firstThursday = 1 + ((4 - dow + 7) % 7);
    return firstThursday + 21;
  }

  function parseMonthDay(value) {
    var raw = String(value == null ? '' : value).trim();
    if (!raw) return null;
    var iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    var mdy = iso ? null : raw.match(/^(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?$/);
    var month = iso ? Number(iso[2]) : mdy ? Number(mdy[1]) : 0;
    var day = iso ? Number(iso[3]) : mdy ? Number(mdy[2]) : 0;
    if (!month || !day || month < 1 || month > 12 || day < 1 || day > 31) return null;
    return { month: month, day: day };
  }

  function fieldBag(value, key) {
    if (!value) return '';
    if (Array.isArray(value)) {
      var hit = null;
      value.some(function (field) {
        if (!field) return false;
        if (field.key === key || field.id === key || field.name === key) {
          hit = field;
          return true;
        }
        return false;
      });
      if (!hit) return '';
      if (hit.value != null) return String(hit.value);
      if (hit.field_value != null) return String(hit.field_value);
      return '';
    }
    if (typeof value !== 'object') return '';
    if (value[key] == null) return '';
    return String(value[key]);
  }

  function readBirthday(bag) {
    if (!bag || typeof bag !== 'object') return '';
    for (var i = 0; i < BIRTHDAY_KEYS.length; i++) {
      var found = fieldBag(bag, BIRTHDAY_KEYS[i]).trim();
      if (found) return found;
    }
    return '';
  }

  function birthdayValue(options) {
    if (!options) return '';
    if (options.birthday) return String(options.birthday);
    var member = options.member || {};
    var profile = options.profile || {};
    var sources = [member.customFields, member.metaData, member.metadata, profile, profile.preferences];
    for (var i = 0; i < sources.length; i++) {
      var found = readBirthday(sources[i]);
      if (found) return found;
    }
    return '';
  }

  function holidayPrefix(parts, birthday) {
    var lines = [];
    var born = parseMonthDay(birthday);
    if (born && born.month === parts.month && born.day === parts.day) lines.push('Happy birthday.');
    if (parts.month === 11 && parts.day === thanksgivingDay(parts.year)) lines.push('Happy Thanksgiving.');
    if (parts.month === 1 && parts.day === 1) lines.push('Happy New Year.');
    if (parts.month === 12 && parts.day === 31) lines.push("Happy New Year's Eve.");
    return lines.join(' ');
  }

  function titleCaseName(token) {
    if (/[a-z]/.test(token) && /[A-Z]/.test(token)) return token;
    return token.split('-').map(function (part) {
      if (!part) return part;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    }).join('-');
  }

  function cleanNameToken(value) {
    var token = String(value || '').trim().split(/\s+/)[0] || '';
    token = token.replace(/[^A-Za-z'-]/g, '');
    if (!token || token.indexOf('@') !== -1) return '';
    if (/^member$/i.test(token)) return '';
    return titleCaseName(token);
  }

  function firstNameFromMember(member) {
    if (!member) return '';
    if (typeof member === 'string') return cleanNameToken(member);
    var fields = member.customFields || {};
    var meta = member.metaData || member.metadata || {};
    var explicit = fieldBag(fields, 'first-name') || fieldBag(meta, 'first-name') || fieldBag(meta, 'firstName');
    var fromExplicit = cleanNameToken(explicit);
    if (fromExplicit) return fromExplicit;
    var full = fieldBag(fields, 'full-name') || fieldBag(meta, 'full-name') || fieldBag(meta, 'fullName');
    if (!full || full.indexOf('@') !== -1) return '';
    return cleanNameToken(full);
  }

  function resolveName(options) {
    if (!options) return '';
    if (options.firstName) return cleanNameToken(options.firstName);
    return firstNameFromMember(options.member);
  }

  function memberKey(options) {
    if (options && options.memberId) return String(options.memberId);
    var member = options && options.member;
    if (member && member.id) return String(member.id);
    return 'anon';
  }

  function storageOf(options) {
    if (options && options.storage) return options.storage;
    if (typeof localStorage !== 'undefined') return localStorage;
    return null;
  }

  function readRecord(storage, key) {
    if (!storage || typeof storage.getItem !== 'function') return null;
    try {
      var raw = storage.getItem(key);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (err) {
      return null;
    }
  }

  function writeRecord(storage, key, value) {
    if (!storage || typeof storage.setItem !== 'function') return;
    try {
      storage.setItem(key, JSON.stringify(value));
    } catch (err) {}
  }

  function rollUnit(random) {
    var roll = Number(typeof random === 'function' ? random() : Math.random());
    if (!isFinite(roll)) roll = 0;
    roll = roll - Math.floor(roll);
    if (roll < 0) roll = 0;
    return roll;
  }

  function pickIndex(length, previousIndex, random) {
    if (length <= 1) return 0;
    var roll = rollUnit(random);
    if (previousIndex == null || previousIndex < 0 || previousIndex >= length) {
      return Math.min(length - 1, Math.floor(roll * length));
    }
    var offset = Math.floor(roll * (length - 1));
    return offset >= previousIndex ? offset + 1 : offset;
  }

  function pickTemplate(pool, previousId, random) {
    var previousIndex = -1;
    for (var i = 0; i < pool.length; i++) {
      if (pool[i].id === previousId) previousIndex = i;
    }
    return pool[pickIndex(pool.length, previousIndex, random)];
  }

  function fill(template, name, topic) {
    var text = name ? template.named : template.anon;
    return String(text || '')
      .replace(/\{name\}/g, name || '')
      .replace(/\{topic\}/g, topic || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function redactVendors(text) {
    VENDOR_RE.lastIndex = 0;
    return String(text || '').replace(VENDOR_RE, '').replace(/\s{2,}/g, ' ').replace(/\s+([?.!,])/g, '$1').trim();
  }

  function compose(body, parts, birthday) {
    var prefix = holidayPrefix(parts, birthday);
    return redactVendors(prefix ? prefix + ' ' + body : body);
  }

  function displayResult(extra) {
    var result = {
      show: true,
      text: extra.text,
      placeholder: extra.placeholder || '',
      tone: extra.tone,
      kind: extra.kind || extra.tone,
      templateId: extra.templateId,
      firstOfDay: !!extra.firstOfDay,
      firstName: extra.firstName || '',
      dateKey: extra.dateKey || '',
      topic: extra.topic || '',
      persist: false,
      includeInModelHistory: false,
    };
    return result;
  }

  function selectDashboardGreeting(options) {
    options = options || {};
    var now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    var parts = chicagoParts(now);
    var name = resolveName(options);
    var storage = storageOf(options);
    var key = DASHBOARD_PREFIX + memberKey(options);
    var prev = readRecord(storage, key);
    var firstOfDay = !prev || prev.date !== parts.dateKey;
    var pool = firstOfDay ? FIRST_POOL : REPEAT_POOL;
    var template = pickTemplate(pool, prev && prev.templateId, options.random);
    var text = compose(fill(template, name), parts, birthdayValue(options));
    writeRecord(storage, key, { date: parts.dateKey, templateId: template.id, tone: firstOfDay ? 'first' : 'repeat' });
    return displayResult({
      text: text,
      placeholder: template.placeholder,
      tone: firstOfDay ? 'first' : 'repeat',
      templateId: template.id,
      firstOfDay: firstOfDay,
      firstName: name,
      dateKey: parts.dateKey,
    });
  }

  function timeOf(message) {
    if (!message) return 0;
    var raw = message.created_at || message.createdAt;
    if (!raw) return 0;
    var ts = Date.parse(raw);
    return isFinite(ts) ? ts : 0;
  }

  function plainText(message) {
    if (!message) return '';
    var content = message.content;
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    var parts = [];
    content.forEach(function (block) {
      if (!block || typeof block !== 'object') return;
      if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
    });
    return parts.join('\n');
  }

  function ownedByMember(message, memberId) {
    if (!message || message.role !== 'user') return false;
    var owner = message.memberId || message.memberstack_id || message.memberstackId;
    if (!owner) return true;
    if (!memberId) return false;
    return String(owner) === String(memberId);
  }

  function tidyToken(word) {
    var bare = String(word || '').replace(/\./g, '');
    var lower = bare.toLowerCase();
    if (SUFFIXES[lower]) return SUFFIXES[lower];
    if (/^(n|s|e|w|ne|nw|se|sw)$/i.test(lower)) return lower.toUpperCase();
    if (/^(north|south|east|west)$/i.test(lower)) return lower.charAt(0).toUpperCase() + lower.slice(1).toLowerCase();
    if (/[a-z]/.test(bare) && /[A-Z]/.test(bare)) return bare;
    return bare.charAt(0).toUpperCase() + bare.slice(1).toLowerCase();
  }

  function addressNameOk(name) {
    var words = String(name || '').trim().split(/\s+/);
    if (!words.length || words.length > 4) return false;
    for (var i = 0; i < words.length; i++) {
      var key = words[i].toLowerCase().replace(/\./g, '');
      if (!key || ADDRESS_STOP[key]) return false;
    }
    return true;
  }

  function extractAddress(text) {
    var match = String(text || '').match(ADDRESS_RE);
    if (!match) return '';
    if (!addressNameOk(match[3])) return '';
    var pieces = [match[1]];
    if (match[2] && match[2].trim()) pieces.push(tidyToken(match[2].trim()));
    match[3].trim().split(/\s+/).forEach(function (word) { pieces.push(tidyToken(word)); });
    pieces.push(tidyToken(match[4]));
    var address = pieces.join(' ').replace(/\s+/g, ' ').trim();
    VENDOR_RE.lastIndex = 0;
    if (!address || VENDOR_RE.test(address)) return '';
    return address;
  }

  function extractTopic(messages, memberId, now) {
    var newest = null;
    (messages || []).forEach(function (message) {
      if (!ownedByMember(message, memberId)) return;
      var ts = timeOf(message);
      if (!ts) return;
      if (ts < now - TOPIC_WINDOW_DAYS * DAY_MS) return;
      if (ts > now + 60 * 60 * 1000) return;
      var address = extractAddress(plainText(message));
      if (!address) return;
      if (!newest || ts >= newest.ts) newest = { ts: ts, address: address };
    });
    return newest ? newest.address : '';
  }

  function latestActivity(messages, fallback) {
    var newest = 0;
    (messages || []).forEach(function (message) {
      var ts = timeOf(message);
      if (ts > newest) newest = ts;
    });
    if (newest) return newest;
    var parsed = Date.parse(fallback || '');
    return isFinite(parsed) ? parsed : 0;
  }

  function sessionTone(activity, now) {
    if (!activity) return 'first';
    if (chicagoParts(activity).dateKey === chicagoParts(now).dateKey) return 'repeat';
    if (now - activity >= LONG_GAP_DAYS * DAY_MS) return 'gap';
    return 'first';
  }

  function poolForTone(tone) {
    if (tone === 'repeat') return REPEAT_POOL;
    if (tone === 'gap') return GAP_POOL;
    return FIRST_POOL;
  }

  function hiddenOpening(reason) {
    return {
      show: false,
      text: '',
      placeholder: '',
      tone: 'skipped',
      kind: 'skipped',
      templateId: '',
      firstOfDay: false,
      firstName: '',
      dateKey: '',
      topic: '',
      reason: reason || 'skipped',
      persist: false,
      includeInModelHistory: false,
    };
  }

  function selectCoachOpening(options) {
    options = options || {};
    if (options.quickChat) return hiddenOpening('quick-chat');
    var now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    var parts = chicagoParts(now);
    var name = resolveName(options);
    var id = memberKey(options);
    var storage = storageOf(options);
    var key = COACH_PREFIX + id;
    var prev = readRecord(storage, key) || {};
    var opens = (Number(prev.opens) || 0) + 1;
    var messages = Array.isArray(options.messages) ? options.messages : [];
    var memberId = options.memberId || (options.member && options.member.id) || '';
    var topic = extractTopic(messages, memberId, now.getTime());
    var useMemory = !!topic && opens % MEMORY_OPEN_INTERVAL === 0;
    var tone = useMemory ? 'memory' : sessionTone(latestActivity(messages, options.lastActivityAt), now.getTime());
    var pool = useMemory ? MEMORY_POOL : poolForTone(tone);
    var template = pickTemplate(pool, prev.templateId, options.random);
    var text = compose(fill(template, name, topic), parts, birthdayValue(options));
    writeRecord(storage, key, { opens: opens, templateId: template.id });
    return displayResult({
      text: text,
      placeholder: template.placeholder,
      tone: tone,
      kind: useMemory ? 'memory' : tone,
      templateId: template.id,
      firstOfDay: tone === 'first',
      firstName: name,
      dateKey: parts.dateKey,
      topic: useMemory ? topic : '',
    });
  }

  return {
    TOPIC_WINDOW_DAYS: TOPIC_WINDOW_DAYS,
    LONG_GAP_DAYS: LONG_GAP_DAYS,
    MEMORY_OPEN_INTERVAL: MEMORY_OPEN_INTERVAL,
    chicagoParts: chicagoParts,
    thanksgivingDay: thanksgivingDay,
    firstNameFromMember: firstNameFromMember,
    birthdayValue: birthdayValue,
    extractAddress: extractAddress,
    extractTopic: extractTopic,
    selectDashboardGreeting: selectDashboardGreeting,
    selectCoachOpening: selectCoachOpening,
  };
});
