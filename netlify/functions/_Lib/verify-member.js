// netlify/functions/_lib/verify-member.js
//
// Shared server-side Memberstack verification for CRM functions.
//
// Every CRM function must call verifyMember(event) BEFORE touching Supabase.
// It never trusts a memberstack_id supplied in the request body/query —
// the member ID used for every Supabase query comes only from the verified
// token, so one member can never read or write another member's CRM data
// by sending someone else's ID.
//
// Requires MEMBERSTACK_SECRET_KEY (and optionally MEMBERSTACK_APP_ID for
// audience validation) as Netlify environment variables.

const memberstackAdmin = require('@memberstack/admin');

const memberstack = memberstackAdmin.init(process.env.MEMBERSTACK_SECRET_KEY);

class AuthError extends Error {
  constructor(message, statusCode = 401) {
    super(message);
    this.statusCode = statusCode;
  }
}

/**
 * Verifies the Memberstack Bearer token on an incoming request.
 * @param {object} event - Netlify function event object
 * @returns {Promise<string>} the verified memberstack member ID
 * @throws {AuthError} if the token is missing, malformed, or invalid
 */
async function verifyMember(event) {
  const authHeader = event.headers?.authorization || event.headers?.Authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AuthError('Missing or malformed Authorization header');
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    throw new AuthError('Empty bearer token');
  }

  try {
    const verifyOptions = { token };
    if (process.env.MEMBERSTACK_APP_ID) {
      verifyOptions.audience = process.env.MEMBERSTACK_APP_ID;
    }

    const tokenData = await memberstack.verifyToken(verifyOptions);

    // tokenData shape follows Memberstack's admin package response —
    // the member ID is the token subject.
    const memberId = tokenData?.id || tokenData?.sub;
    if (!memberId) {
      throw new AuthError('Token verified but no member ID present');
    }

    return memberId;
  } catch (err) {
    if (err instanceof AuthError) throw err;
    const msg = String(err?.message || '');
    if (msg.toLowerCase().includes('expired')) {
      throw new AuthError('Session expired, please log in again');
    }
    throw new AuthError('Invalid or unverifiable token');
  }
}

module.exports = { verifyMember, AuthError };
