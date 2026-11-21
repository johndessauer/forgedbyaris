// /book used to be a Netlify 302 that forwarded the query string unchanged.
// GHL only stores standard utm_* keys on the contact, so src and ref were
// left on lastAttributionSource.url. This keeps those params and adds the
// matching UTM keys when the caller did not already set them.

const WIDGET = 'https://api.leadconnectorhq.com/widget/booking/JlM6SoqbqCKmDois6PHx';
const MAX = 64;

function sanitize(value) {
  return String(value == null ? '' : value).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, MAX);
}

function bookLocation(search) {
  const raw = String(search || '');
  const query = raw.startsWith('?') ? raw.slice(1) : raw;
  const incoming = new URLSearchParams(query);
  const out = new URLSearchParams(incoming);
  const src = sanitize(incoming.get('src'));
  const ref = sanitize(incoming.get('ref'));
  if (src && !incoming.has('utm_source')) out.set('utm_source', src);
  if (ref && !incoming.has('utm_content')) out.set('utm_content', ref);
  if (ref && !incoming.has('utm_medium')) {
    if (ref.endsWith('-sms')) out.set('utm_medium', 'sms');
    else if (ref.startsWith('nl-d1')) out.set('utm_medium', 'email');
  }
  const next = out.toString();
  return next ? WIDGET + '?' + next : WIDGET;
}

export default async function book(request) {
  const url = new URL(request.url);
  return new Response(null, {
    status: 302,
    headers: {
      Location: bookLocation(url.search),
      'Cache-Control': 'no-store',
    },
  });
}

export const config = {
  path: ['/book', '/book/'],
};

export { WIDGET, bookLocation, sanitize };
