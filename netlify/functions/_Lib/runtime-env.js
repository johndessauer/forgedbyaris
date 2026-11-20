// Netlify.env.get() is checked first. Secret values are available there on
// the current function runtime even when process.env does not have them.
// A caller-supplied env object is used alone so tests stay isolated.
function cleanSecret(value) {
  let text = String(value == null ? '' : value).replace(/^\uFEFF/, '').trim();
  for (let i = 0; i < 2; i++) {
    if (text.length >= 2 && ((text.charAt(0) === '"' && text.charAt(text.length - 1) === '"') || (text.charAt(0) === "'" && text.charAt(text.length - 1) === "'"))) {
      text = text.slice(1, -1).trim();
    }
  }
  return text.replace(/[\s\u200B\u200C\u200D\uFEFF]/g, '');
}

function fromNetlify(name) {
  try {
    const netlify = globalThis.Netlify;
    if (netlify && netlify.env && typeof netlify.env.get === 'function') {
      return cleanSecret(netlify.env.get(name));
    }
  } catch (err) {}
  return '';
}

function readRuntimeEnv(env, name) {
  if (env && env !== process.env) return cleanSecret(env[name]);
  const preferred = fromNetlify(name);
  if (preferred) return preferred;
  return cleanSecret(process.env[name]);
}

function safePrefix(value) {
  return String(value || '').slice(0, 3).replace(/[^A-Za-z0-9_]/g, '?');
}

// Safe to return to the browser. Never includes the secret or its length.
function keyReason(value) {
  if (!value) return 'missing';
  if (value.startsWith('sk_live_') || value.startsWith('rk_live_')) return 'live_key_refused';
  return 'bad_prefix:' + safePrefix(value);
}

module.exports = {
  cleanSecret: cleanSecret,
  readRuntimeEnv: readRuntimeEnv,
  keyReason: keyReason,
};
