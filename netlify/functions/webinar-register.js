// FORGE weekly live webinar registration. Not FWN.
// See netlify/functions/_Lib/webinar-register.js.
const { registerHandler } = require('./_Lib/webinar-register');

exports.handler = function (event) {
  return registerHandler(event);
};
