// Read one env value. A caller-supplied env object is used as-is so tests
// stay isolated. The production process.env also checks Netlify.env, which
// is where edge and current function runtimes expose secret values.
function clean(value) {
  return String(value || '').replace(/^\uFEFF/, '').trim();
}

function readRuntimeEnv(env, name) {
  const source = env || process.env;
  const direct = clean(source[name]);
  if (direct || source !== process.env) return direct;
  try {
    const netlify = globalThis.Netlify;
    if (netlify && netlify.env && typeof netlify.env.get === 'function') {
      return clean(netlify.env.get(name));
    }
  } catch (err) {}
  return '';
}

module.exports = { readRuntimeEnv: readRuntimeEnv };
