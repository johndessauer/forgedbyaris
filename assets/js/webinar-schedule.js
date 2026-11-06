/* Public non-FWN live webinar cadence.
 * Tuesdays at 8:00 PM America/Chicago, except Monday, November 30, 2026
 * (that week is not Tuesday, December 1).
 *
 * This list is the schedule the homepage banner reads. Registration still
 * pins a single next date with WEBINAR_NEXT_DATE (default: the first date
 * here) and does not auto-advance. The banner ignores a pin that is not in
 * this list, or that has already ended, so a stale env date cannot put an
 * expired session or a skipped Tuesday back on the public page.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof root !== 'undefined') root.ForgeWebinarSchedule = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var TIME_ZONE = 'America/Chicago';
  var TIME_LABEL = '8:00 PM CT';
  var START_HOUR = 20;
  var DURATION_MS = 2 * 60 * 60 * 1000;
  // Explicit dates. Do not generate these from "every Tuesday" — 2026-11-30
  // is the Monday exception and must not be replaced by 2026-12-01.
  var DATES = [
    '2026-11-17',
    '2026-11-24',
    '2026-11-30',
    '2026-12-08',
    '2026-12-15',
    '2027-01-05'
  ];

  function weekdayOf(date) {
    return new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  }

  function longDateOf(date) {
    return new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC'
    });
  }

  // 8:00 PM on the calendar date in America/Chicago, as a UTC instant.
  function zonedStart(date) {
    var hh = String(START_HOUR).padStart(2, '0');
    var utcGuess = new Date(date + 'T' + hh + ':00:00Z');
    var fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: TIME_ZONE,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    function asUtc(instant) {
      var map = {};
      fmt.formatToParts(instant).forEach(function (p) {
        if (p.type !== 'literal') map[p.type] = p.value;
      });
      return Date.UTC(+map.year, +map.month - 1, +map.day, +map.hour, +map.minute, +map.second);
    }
    var offset = asUtc(utcGuess) - utcGuess.getTime();
    var start = new Date(utcGuess.getTime() - offset);
    var offset2 = asUtc(start) - start.getTime();
    if (offset2 !== offset) start = new Date(utcGuess.getTime() - offset2);
    return start;
  }

  function sessions() {
    return DATES.map(function (date) {
      var startsAt = zonedStart(date);
      return {
        date: date,
        weekday: weekdayOf(date),
        longDate: longDateOf(date),
        startsAt: startsAt,
        endsAt: new Date(startsAt.getTime() + DURATION_MS)
      };
    });
  }

  // The session the public banner should name. A registration pin wins only
  // when it is one of the approved dates and that session has not ended.
  function featuredSession(now, pinnedDate) {
    var list = sessions();
    var t = now instanceof Date ? now.getTime() : new Date(now).getTime();
    if (pinnedDate) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].date === pinnedDate && list[i].endsAt.getTime() > t) return list[i];
      }
    }
    for (var j = 0; j < list.length; j++) {
      if (list[j].endsAt.getTime() > t) return list[j];
    }
    return null;
  }

  function whenLabel(session) {
    return session.weekday + ', ' + session.longDate + ' at ' + TIME_LABEL;
  }

  function bannerText(now, pinnedDate) {
    var list = sessions();
    var session = featuredSession(now, pinnedDate);
    if (!session) return 'Live Weekly Webinars, Tuesdays at ' + TIME_LABEL + '.';
    var when = whenLabel(session);
    var t = now instanceof Date ? now.getTime() : new Date(now).getTime();
    if (session.date === list[0].date && t < session.startsAt.getTime()) {
      return 'Live Weekly Webinars start ' + when + '.';
    }
    if (t >= session.startsAt.getTime() && t < session.endsAt.getTime()) {
      return 'Live Weekly Webinar: ' + when + '.';
    }
    return 'Next Live Weekly Webinar: ' + when + '.';
  }

  return {
    TIME_ZONE: TIME_ZONE,
    TIME_LABEL: TIME_LABEL,
    DATES: DATES.slice(),
    FIRST_DATE: DATES[0],
    sessions: sessions,
    featuredSession: featuredSession,
    bannerText: bannerText,
    weekdayOf: weekdayOf
  };
});
