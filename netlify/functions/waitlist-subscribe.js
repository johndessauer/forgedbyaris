// netlify/functions/waitlist-subscribe.js
//
// Pre-launch waitlist capture — forwards the Netlify Forms email submission
// to GoHighLevel instead of EmailOctopus. Uses GHL's contacts/upsert
// endpoint (not plain create) so a repeat submission from the same email
// updates the existing contact rather than erroring or creating a
// duplicate.
//
// Requires two environment variables, set in Netlify:
//   GHL_API_KEY     — a Private Integration Token, generated in GHL under
//                      Settings > Private Integrations. Needs at least
//                      contact write access.
//   GHL_LOCATION_ID — the GHL sub-account (location) ID this waitlist
//                      contact belongs to.
//
// Same fail-open behavior as the original: if the downstream call fails,
// this still returns 200 to the browser so the person doesn't see a
// broken form — the failure is only logged server-side. That's a real
// tradeoff (a form submission can silently fail to land in GHL), so check
// Netlify function logs periodically if waitlist signups seem low.

const https = require('https');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const API_KEY = process.env.GHL_API_KEY;
  const LOCATION_ID = process.env.GHL_LOCATION_ID;

  if (!API_KEY || !LOCATION_ID) {
    console.error('Missing GoHighLevel environment variables');
    return { statusCode: 500, body: JSON.stringify({ error: 'Server configuration error' }) };
  }

  let email;
  try {
    const params = new URLSearchParams(event.body);
    email = params.get('email');
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  if (!email) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Email is required' }) };
  }

  const payload = JSON.stringify({
    email,
    locationId: LOCATION_ID,
    tags: ['waitlist']
  });

  return new Promise((resolve) => {
    const options = {
      hostname: 'services.leadconnectorhq.com',
      path: '/contacts/upsert',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'Version': '2021-07-28',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        console.log('GoHighLevel response:', res.statusCode, data);
        resolve({ statusCode: 200, body: JSON.stringify({ success: true }) });
      });
    });

    req.on('error', (err) => {
      console.error('GoHighLevel request error:', err);
      resolve({ statusCode: 200, body: JSON.stringify({ success: true }) });
    });

    req.write(payload);
    req.end();
  });
};
