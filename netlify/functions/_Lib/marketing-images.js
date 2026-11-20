// Image checks for the Brand Kit. No image library: PNG and JPEG sizes come
// from the file headers, and SVG is cleaned as text before it is stored.
const LOOKALIKE = /\b(irs|h\.?\s*u\.?\s*d\.?|fha|usps|u\.s\. postal|united states postal|county clerk|superior court|circuit court|district court|sheriff|department of|federal government|official notice|lender seal|wells fargo|bank of america|jpmorgan|chase bank)\b/i;

const LOGO_MAX_BYTES = 5 * 1024 * 1024;
const HEADSHOT_MAX_BYTES = 5 * 1024 * 1024;
const LOGO_MIN_WIDTH = 600;
const HEADSHOT_MIN_WIDTH = 800;

function decodeBase64(input) {
  const raw = String(input || '').trim();
  const payload = raw.replace(/^data:[^,]*,/i, '').replace(/\s/g, '');
  if (!payload) {
    const err = new Error('The file was empty.');
    err.statusCode = 400;
    throw err;
  }
  const buf = Buffer.from(payload, 'base64');
  if (!buf.length || buf.toString('base64').replace(/=+$/, '') !== payload.replace(/=+$/, '')) {
    const err = new Error('The file could not be read.');
    err.statusCode = 400;
    throw err;
  }
  return buf;
}

function sniff(buf) {
  if (!buf || buf.length < 12) return 'unknown';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'gif';
  const head = buf.slice(0, Math.min(buf.length, 400)).toString('utf8').replace(/^\uFEFF/, '').trim().toLowerCase();
  if (head.startsWith('<svg') || head.startsWith('<?xml') && head.includes('<svg')) return 'svg';
  if (head.includes('<svg')) return 'svg';
  return 'unknown';
}

function pngSize(buf) {
  if (sniff(buf) !== 'png' || buf.length < 24) return null;
  if (buf.slice(12, 16).toString('ascii') !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function pngAnimated(buf) {
  return buf.indexOf(Buffer.from('acTL')) !== -1;
}

function jpegSize(buf) {
  if (sniff(buf) !== 'jpeg') return null;
  let i = 2;
  while (i + 8 < buf.length) {
    if (buf[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = buf[i + 1];
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
    }
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (i + 4 > buf.length) break;
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) break;
    i += 2 + len;
  }
  return null;
}

function safeFileName(name) {
  const base = String(name || 'upload').split(/[/\\]/).pop().replace(/[^\w.\- ()]+/g, '').trim();
  return (base || 'upload').slice(0, 120);
}

function looksAlikeBrand(text) {
  return LOOKALIKE.test(String(text || ''));
}

function cleanSvg(input) {
  const original = Buffer.isBuffer(input) ? input.toString('utf8') : String(input || '');
  if (!/<\s*svg[\s>]/i.test(original)) {
    const err = new Error('Logo files must be a PNG or an SVG.');
    err.statusCode = 400;
    throw err;
  }
  if (/<\s*(animate|animateTransform|animateMotion|set)\b/i.test(original)) {
    const err = new Error('Animated files are not allowed.');
    err.statusCode = 400;
    throw err;
  }
  let svg = original.replace(/<!DOCTYPE[^>]*>/gi, '').replace(/<\?xml[^>]*\?>/gi, '');
  svg = svg.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  svg = svg.replace(/<script\b[^>]*\/>/gi, '');
  svg = svg.replace(/<foreignObject\b[^>]*>[\s\S]*?<\/foreignObject>/gi, '');
  svg = svg.replace(/<foreignObject\b[^>]*\/>/gi, '');
  svg = svg.replace(/\s(?:on[a-z]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  svg = svg.replace(/\s(?:href|xlink:href)\s*=\s*("([^"]*)"|'([^']*)')/gi, function (full, quoted, a, b) {
    const url = String(a || b || '').trim();
    if (url.startsWith('#')) return full;
    return '';
  });
  svg = svg.replace(/javascript\s*:/gi, '');
  if (/<script\b|foreignObject|javascript\s*:/i.test(svg)) {
    const err = new Error('This SVG includes content that cannot be stored.');
    err.statusCode = 400;
    throw err;
  }
  return svg;
}

function svgPixelSize(svg) {
  const width = String(svg).match(/\bwidth\s*=\s*["']?\s*(\d+(?:\.\d+)?)(?:px)?/i);
  const height = String(svg).match(/\bheight\s*=\s*["']?\s*(\d+(?:\.\d+)?)(?:px)?/i);
  if (!width) return null;
  return { width: Math.round(Number(width[1])), height: height ? Math.round(Number(height[1])) : null };
}

function hexToRgb(hex) {
  const raw = String(hex || '').trim().replace('#', '');
  const full = raw.length === 3 ? raw.split('').map(function (c) { return c + c; }).join('') : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function normalizeHex(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return '';
  const part = function (n) { return n.toString(16).padStart(2, '0'); };
  return '#' + part(rgb.r) + part(rgb.g) + part(rgb.b);
}

function luminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const channel = function (value) {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

function contrastRatio(a, b) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function readableTextColor(background) {
  const bg = normalizeHex(background) || '#1F3348';
  const onDark = contrastRatio(bg, '#F7F5F2');
  const onLight = contrastRatio(bg, '#1A1A1A');
  if (onDark >= 4.5 && onDark >= onLight) return '#F7F5F2';
  if (onLight >= 4.5) return '#1A1A1A';
  return onDark >= onLight ? '#F7F5F2' : '#1A1A1A';
}

function pickSwatches(samples) {
  const unique = [];
  (samples || []).forEach(function (sample) {
    const hex = normalizeHex(sample);
    if (!hex) return;
    const tooClose = unique.some(function (have) { return contrastRatio(have, hex) < 1.4; });
    if (!tooClose) unique.push(hex);
  });
  return unique.slice(0, 3);
}

function svgSwatches(svg) {
  const found = String(svg || '').match(/#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g) || [];
  return pickSwatches(found);
}

function validateImage(input) {
  const kind = input && input.kind === 'headshot' ? 'headshot' : 'logo';
  const fileName = safeFileName(input && input.fileName);
  const buf = decodeBase64(input && input.dataBase64);
  const max = kind === 'headshot' ? HEADSHOT_MAX_BYTES : LOGO_MAX_BYTES;
  if (buf.length > max) {
    const err = new Error('This file is over 5 MB. Use a smaller PNG or SVG.');
    err.statusCode = 400;
    throw err;
  }
  const type = sniff(buf);
  if (type === 'gif' || (type === 'png' && pngAnimated(buf))) {
    const err = new Error('Animated files are not allowed.');
    err.statusCode = 400;
    throw err;
  }
  const warnings = [];
  let stored;
  let contentType;
  let size = null;
  if (kind === 'logo') {
    if (type !== 'png' && type !== 'svg') {
      const err = new Error('Logo files must be a PNG or an SVG.');
      err.statusCode = 400;
      throw err;
    }
    if (type === 'svg') {
      const svg = cleanSvg(buf);
      stored = Buffer.from(svg, 'utf8');
      contentType = 'image/svg+xml';
      size = svgPixelSize(svg);
      if (!size || !size.width) warnings.push('Could not read a pixel width. A PNG at least 600 pixels wide prints more sharply.');
      else if (size.width < LOGO_MIN_WIDTH) warnings.push('This logo is under 600 pixels wide. It may look soft in print. You can still use it.');
    } else {
      size = pngSize(buf);
      stored = buf;
      contentType = 'image/png';
      if (!size) warnings.push('Could not read the logo size. A PNG at least 600 pixels wide prints more sharply.');
      else if (size.width < LOGO_MIN_WIDTH) warnings.push('This logo is under 600 pixels wide. It may look soft in print. You can still use it.');
    }
  } else {
    if (type !== 'png' && type !== 'jpeg') {
      const err = new Error('Headshots must be a JPG or a PNG.');
      err.statusCode = 400;
      throw err;
    }
    size = type === 'png' ? pngSize(buf) : jpegSize(buf);
    stored = buf;
    contentType = type === 'png' ? 'image/png' : 'image/jpeg';
    if (!size) warnings.push('Could not read the headshot size. Use a square image at least 800 pixels wide.');
    else {
      if (size.width < HEADSHOT_MIN_WIDTH || size.height < HEADSHOT_MIN_WIDTH) {
        warnings.push('This headshot is under 800 pixels. It may look soft in print. You can still use it.');
      }
      if (size.width !== size.height) warnings.push('Crop the headshot to a square so it sits cleanly on the piece.');
    }
  }
  const flagged = looksAlikeBrand(fileName) || (type === 'svg' && looksAlikeBrand(stored.toString('utf8')));
  if (flagged) warnings.push('This file was flagged for review because the name or artwork looks like another organization. It is saved, and only John reviews flags.');
  return {
    kind: kind,
    fileName: fileName,
    contentType: contentType,
    bytes: stored,
    width: size && size.width || null,
    height: size && size.height || null,
    warnings: warnings,
    flagged: flagged,
    swatches: type === 'svg' ? svgSwatches(stored.toString('utf8')) : [],
  };
}

module.exports = {
  LOOKALIKE: LOOKALIKE,
  LOGO_MAX_BYTES: LOGO_MAX_BYTES,
  HEADSHOT_MAX_BYTES: HEADSHOT_MAX_BYTES,
  decodeBase64: decodeBase64,
  sniff: sniff,
  pngSize: pngSize,
  jpegSize: jpegSize,
  cleanSvg: cleanSvg,
  normalizeHex: normalizeHex,
  contrastRatio: contrastRatio,
  readableTextColor: readableTextColor,
  pickSwatches: pickSwatches,
  svgSwatches: svgSwatches,
  looksAlikeBrand: looksAlikeBrand,
  validateImage: validateImage,
};
