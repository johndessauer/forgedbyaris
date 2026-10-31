// FORGE Live attendance link: /webinar/join?e=<contact id>&s=<YYYY-MM-DD>.
// Tags webinar-joined-<date> in FORGE GHL, then 302s to WEBINAR_JOIN_URL.
// See netlify/functions/_Lib/webinar-register.js.
const { joinHandler } = require('./_Lib/webinar-register');

exports.handler = function (event) {
  return joinHandler(event);
};
