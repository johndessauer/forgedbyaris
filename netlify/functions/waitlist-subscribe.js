const https = require('https');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const API_KEY = process.env.EMAILOCTOPUS_API_KEY;
  const LIST_ID = process.env.EMAILOCTOPUS_LIST_ID;

  if (!API_KEY || !LIST_ID) {
    console.error('Missing EmailOctopus environment variables');
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
    api_key: API_KEY,
    email_address: email,
    status: 'SUBSCRIBED',
    tags: ['waitlist']
  });

  return new Promise((resolve) => {
    const options = {
      hostname: 'emailoctopus.com',
      path: `/api/1.6/lists/${LIST_ID}/contacts`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        console.log('EmailOctopus response:', res.statusCode, data);
        resolve({ statusCode: 200, body: JSON.stringify({ success: true }) });
      });
    });

    req.on('error', (err) => {
      console.error('EmailOctopus request error:', err);
      resolve({ statusCode: 200, body: JSON.stringify({ success: true }) });
    });

    req.write(payload);
    req.end();
  });
};
