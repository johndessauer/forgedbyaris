// High-resolution SVG previews for marketing pieces. Drawn at print
// proportions. Brand color is an accent only. Sample names and addresses
// are obvious placeholders. Nothing here is a vendor mark or a live postage.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ForgeMarketingMailer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const SERIF = 'Source Serif 4, Georgia, Times New Roman, serif';
  const SANS = 'Inter, Arial, Helvetica, sans-serif';
  const SCRIPT = 'Great Vibes, Segoe Script, cursive';
  const DISPLAY = 'Bebas Neue, Impact, sans-serif';
  const HAND = {
    'hi-clarice': 'Great Vibes, Segoe Script, cursive',
    'shopping-list': 'Caveat, Segoe Print, cursive',
    'normal-print': 'Patrick Hand, Segoe Print, sans-serif',
  };
  const INCH = 48;

  function n(value) {
    return Math.round(Number(value) * 10) / 10;
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function hex(value) {
    return /^#[0-9a-fA-F]{6}$/.test(String(value || '')) ? String(value) : '';
  }

  function who(brand) {
    const name = String(brand && brand.name || '').trim() || 'Your Name';
    const phone = String(brand && brand.phone || '').trim() || '(555) 555-0100';
    const address = String(brand && brand.address || '').trim();
    const bits = address ? address.split(',') : ['123 Main St', ' Anytown, ST 00000'];
    return {
      name: name.slice(0, 32),
      phone: phone.slice(0, 22),
      line1: (bits[0] || '123 Main St').trim().slice(0, 36),
      line2: (bits.slice(1).join(',') || 'Anytown, ST 00000').trim().slice(0, 40) || 'Anytown, ST 00000',
      accent: hex(brand && brand.primary),
      initials: name.split(/\s+/).filter(Boolean).slice(0, 2).map(function (part) { return part[0]; }).join('').toUpperCase() || 'YN',
    };
  }

  function copyOf(angle, commercial) {
    const row = angle || {};
    const paragraphs = (row.paragraphs && row.paragraphs.length) ? row.paragraphs.slice(0, 4) : [row.opener || 'A short call is enough.', row.alt || 'There is no cost to talk.'];
    if (paragraphs[0] && /I buy houses in this area|looking to buy a home in your neighborhood|looking to buy a property in your area/.test(paragraphs[0])) {
      paragraphs[0] = commercial
        ? "I'm looking to buy a property in your area, and I can make the next step simple."
        : "I'm looking to buy a home in your neighborhood, and I can make the next step simple.";
    }
    return {
      kicker: row.kicker || 'CASH OFFER',
      headline: row.mailHeadline || row.card || 'A cash offer. As-is.',
      sub: row.mailSub || row.opener || 'No repairs. No agent fees.',
      bullets: (row.bullets && row.bullets.length) ? row.bullets.slice(0, 3) : ['As-is', 'Your timeline', 'No agent fees'],
      paragraphs: paragraphs,
      ps: row.ps || 'P.S. A short call is enough.',
    };
  }

  function theme(template, brand, finish) {
    const layout = (template && template.layout) || 'classic';
    const person = who(brand);
    const color = finish !== 'bw';
    const palettes = {
      classic: { paper: '#f6f3ec', ink: '#1c2430', muted: '#5c6b7a', accent: '#1e3a5f', soft: '#e4dccf', sky: '#b7c9dc', roof: '#3c4c5e', siding: '#f7f4ee', lawn: '#7d9a68', trim: '#f3efe6' },
      bold: { paper: '#14181e', ink: '#f6f3ec', muted: '#d9d2c6', accent: '#e23d32', soft: '#2a313a', sky: '#243140', roof: '#12161b', siding: '#f4f0e8', lawn: '#35543c', trim: '#1c222b' },
      friendly: { paper: '#fff7f0', ink: '#3c2b22', muted: '#8d684f', accent: '#c56a3a', soft: '#f3e1d0', sky: '#f0d2ae', roof: '#8d5a3c', siding: '#fffaf5', lawn: '#8eaa72', trim: '#fff3e8' },
      minimal: { paper: '#ffffff', ink: '#171717', muted: '#6a6a6a', accent: '#171717', soft: '#ececec', sky: '#e6e6e6', roof: '#2c2c2c', siding: '#fafafa', lawn: '#d0d0d0', trim: '#f7f7f7' },
      photo: { paper: '#f3f1eb', ink: '#1c2430', muted: '#4d5c55', accent: '#1c4d3a', soft: '#e3eee6', sky: '#9eb6c8', roof: '#3d4a44', siding: '#f7f4ee', lawn: '#6e9464', trim: '#f7f5f0' },
      script: { paper: '#fffdf8', ink: '#1c3d6e', muted: '#5d6e84', accent: '#1d4e89', soft: '#e6eef6', sky: '#d5e4f2', roof: '#4d6078', siding: '#ffffff', lawn: '#b7c9b0', trim: '#f8fbfe' },
    };
    const look = Object.assign({}, palettes[layout] || palettes.classic);
    look.layout = layout;
    look.color = color;
    look.who = person;
    if (!color) {
      look.accent = '#2c2c2c';
      look.sky = '#d5d5d5';
      look.roof = '#4a4a4a';
      look.siding = '#f5f5f5';
      look.lawn = '#cfcfcf';
      look.soft = '#e8e8e8';
      look.ink = '#222222';
      look.muted = '#555555';
      look.paper = '#f7f7f5';
    } else if (person.accent) {
      look.accent = person.accent;
    } else if (finish === 'color') {
      look.accent = '#2f6f86';
    }
    return look;
  }

  function T(text, x, y, size, fill, family, weight, anchor, tracking) {
    return '<text x="' + n(x) + '" y="' + n(y) + '" fill="' + fill + '" font-family="' + family + '" font-size="' + n(size) + '" font-weight="' + (weight || 400) + '"' +
      (anchor ? ' text-anchor="' + anchor + '"' : '') +
      (tracking ? ' letter-spacing="' + tracking + '"' : '') +
      '>' + esc(text) + '</text>';
  }

  function wrap(text, max) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    words.forEach(function (word) {
      const next = line ? line + ' ' + word : word;
      if (line && next.length > max) {
        lines.push(line);
        line = word;
      } else line = next;
    });
    if (line) lines.push(line);
    return lines;
  }

  function lines(text, x, y, width, size, fill, family, weight, maxLines, leading, anchor) {
    const chars = Math.max(8, Math.floor(width / (size * (anchor === 'middle' ? 0.48 : 0.52))));
    const rows = wrap(text, chars).slice(0, maxLines || 4);
    const step = size * (leading || 1.35);
    return {
      svg: rows.map(function (row, index) {
        return T(row, x, y + index * step, size, fill, family, weight || 400, anchor || '');
      }).join(''),
      height: Math.max(step, rows.length * step),
    };
  }

  function shadow(w, h, rx) {
    return '<rect x="3" y="4" width="' + n(w) + '" height="' + n(h) + '" rx="' + n(rx || 2) + '" fill="#1b2430" opacity="0.16"/>';
  }

  function sheet(w, h, fill, stroke, rx) {
    return '<rect width="' + n(w) + '" height="' + n(h) + '" rx="' + n(rx || 2) + '" fill="' + fill + '" stroke="' + (stroke || '#ddd4c6') + '" stroke-width="1"/>';
  }

  function svgWrap(w, h, body) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n(w) + ' ' + n(h) + '" width="' + n(w) + '" height="' + n(h) + '" focusable="false" aria-hidden="true" preserveAspectRatio="xMidYMid meet">' + body + '</svg>';
  }

  function compose(faces, swatch) {
    if (swatch) {
      const face = faces[0];
      return svgWrap(face.w, face.h, '<g data-face="' + esc(face.name) + '">' + face.inner + '</g>');
    }
    const gap = 28;
    const pad = 16;
    const labelH = 18;
    let x = pad;
    let maxH = 0;
    let body = '';
    faces.forEach(function (face) {
      body += T(face.label, x, pad + 12, 11, '#6d645b', SANS, 700, 'start', '1.4');
      body += '<g data-face="' + esc(face.name) + '" transform="translate(' + n(x) + ' ' + n(pad + labelH) + ')">' + face.inner + '</g>';
      maxH = Math.max(maxH, face.h);
      x += face.w + gap;
    });
    return svgWrap(x - gap + pad, pad + labelH + maxH + pad, '<rect width="100%" height="100%" fill="#e7e1d6"/>' + body);
  }

  const HOUSE_PHOTOS = [
    '/assets/marketing/stock/house-two-story.webp',
    '/assets/marketing/stock/house-bungalow.webp',
    '/assets/marketing/stock/house-side.webp',
  ];
  const APARTMENT_PHOTOS = [
    '/assets/marketing/stock/apt-brick.webp',
    '/assets/marketing/stock/apt-garden.webp',
    '/assets/marketing/stock/apt-midrise.webp',
  ];
  let activePhoto = HOUSE_PHOTOS[0];

  function pickPhoto(template, commercial, channelId) {
    const list = commercial ? APARTMENT_PHOTOS : HOUSE_PHOTOS;
    const slot = { classic: 0, bold: 1, friendly: 2, minimal: 2, photo: 0, script: 1 }[(template && template.layout) || 'classic'] || 0;
    const shift = channelId === 'door-hanger' || channelId === 'letter' ? 1 : (channelId === 'jumbo-postcard' ? 2 : 0);
    return list[(slot + shift) % list.length];
  }

  function sampleDate(now) {
    const date = now || new Date();
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return months[date.getMonth()] + ' ' + date.getDate() + ', ' + date.getFullYear();
  }

  function house(w, h, look, id, overlay) {
    const clip = 'photo-' + id;
    const shade = 'shade-' + id;
    let body = '<defs><clipPath id="' + clip + '"><rect width="' + n(w) + '" height="' + n(h) + '"/></clipPath>';
    if (overlay) {
      body += '<linearGradient id="' + shade + '" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0" stop-color="#0d1b2a" stop-opacity="0.08"/>' +
        '<stop offset="0.45" stop-color="#0d1b2a" stop-opacity="0.05"/>' +
        '<stop offset="1" stop-color="#0d1b2a" stop-opacity="0.62"/>' +
        '</linearGradient>';
    }
    body += '</defs><g clip-path="url(#' + clip + ')">' +
      '<image href="' + esc(activePhoto) + '" x="0" y="0" width="' + n(w) + '" height="' + n(h) + '" preserveAspectRatio="xMidYMid slice"/>';
    if (overlay) body += '<rect width="' + n(w) + '" height="' + n(h) + '" fill="url(#' + shade + ')"/>';
    return body + '</g>';
  }

  function bullets(items, x, y, size, look) {
    return items.map(function (item, index) {
      const yy = y + index * size * 1.7;
      return '<circle cx="' + n(x) + '" cy="' + n(yy - size * 0.32) + '" r="' + n(size * 0.28) + '" fill="' + look.accent + '"/>' +
        T(item, x + size * 0.9, yy, size, look.ink, SANS, 600);
    }).join('');
  }

  function logo(x, y, s, look) {
    return '<rect x="' + n(x) + '" y="' + n(y) + '" width="' + n(s) + '" height="' + n(s) + '" rx="' + n(s * 0.16) + '" fill="' + look.accent + '"/>' +
      T(look.who.initials, x + s / 2, y + s * 0.68, s * 0.38, '#ffffff', SANS, 700, 'middle');
  }

  function headshot(cx, cy, r, look) {
    return '<circle cx="' + n(cx) + '" cy="' + n(cy) + '" r="' + n(r) + '" fill="' + look.soft + '" stroke="' + look.accent + '" stroke-width="1.4"/>' +
      '<circle cx="' + n(cx) + '" cy="' + n(cy - r * 0.18) + '" r="' + n(r * 0.28) + '" fill="' + look.muted + '"/>' +
      '<path d="M' + n(cx - r * 0.55) + ' ' + n(cy + r * 0.95) + ' Q' + n(cx) + ' ' + n(cy + r * 0.15) + ' ' + n(cx + r * 0.55) + ' ' + n(cy + r * 0.95) + '" fill="' + look.muted + '"/>';
  }

  function qr(x, y, size) {
    const cell = size / 9;
    let body = '<rect x="' + n(x) + '" y="' + n(y) + '" width="' + n(size) + '" height="' + n(size) + '" fill="#ffffff" stroke="#1c2430" stroke-width="0.8"/>';
    function finder(fx, fy) {
      return '<rect x="' + n(x + fx * cell) + '" y="' + n(y + fy * cell) + '" width="' + n(cell * 3) + '" height="' + n(cell * 3) + '" fill="#1c2430"/>' +
        '<rect x="' + n(x + (fx + 0.4) * cell) + '" y="' + n(y + (fy + 0.4) * cell) + '" width="' + n(cell * 2.2) + '" height="' + n(cell * 2.2) + '" fill="#ffffff"/>' +
        '<rect x="' + n(x + (fx + 0.9) * cell) + '" y="' + n(y + (fy + 0.9) * cell) + '" width="' + n(cell * 1.2) + '" height="' + n(cell * 1.2) + '" fill="#1c2430"/>';
    }
    body += finder(0.4, 0.4) + finder(5.4, 0.4) + finder(0.4, 5.4);
    const dots = [[4, 4], [5, 5], [6, 4], [4, 6], [7, 6], [6, 7], [5, 3], [3, 5]];
    dots.forEach(function (dot) {
      body += '<rect x="' + n(x + dot[0] * cell) + '" y="' + n(y + dot[1] * cell) + '" width="' + n(cell * 0.8) + '" height="' + n(cell * 0.8) + '" fill="#1c2430"/>';
    });
    return body;
  }

  function barcode(x, y, w, h) {
    let cursor = x;
    let body = '';
    const unit = w / 78;
    for (let i = 0; i < 42; i += 1) {
      const width = (i % 5 === 0 ? 2.4 : (i % 3 === 0 ? 1.5 : 0.8)) * unit;
      if (i % 2 === 0) {
        body += '<rect x="' + n(cursor) + '" y="' + n(y) + '" width="' + n(Math.max(0.6, width)) + '" height="' + n(h) + '" fill="#1c2430"/>';
      }
      cursor += width + unit * 0.35;
    }
    return body;
  }

  function indicia(x, y, w, h, look) {
    const cx = x + w / 2;
    return '<rect x="' + n(x) + '" y="' + n(y) + '" width="' + n(w) + '" height="' + n(h) + '" fill="#fff" stroke="' + look.ink + '" stroke-width="1.2"/>' +
      T('PRSRT STD', cx, y + h * 0.28, Math.max(7, h * 0.16), look.ink, SANS, 700, 'middle', '0.4') +
      T('U.S. POSTAGE PAID', cx, y + h * 0.5, Math.max(6, h * 0.12), look.ink, SANS, 500, 'middle') +
      T('ANYTOWN ST', cx, y + h * 0.7, Math.max(6, h * 0.12), look.ink, SANS, 600, 'middle') +
      T('PERMIT NO. 1', cx, y + h * 0.88, Math.max(6, h * 0.11), look.muted, SANS, 500, 'middle');
  }

  function stamp(x, y, w, h) {
    return '<rect x="' + n(x) + '" y="' + n(y) + '" width="' + n(w) + '" height="' + n(h) + '" fill="#f4efe4" stroke="#8d3b32" stroke-width="1" stroke-dasharray="1.5 1.2"/>' +
      '<rect x="' + n(x + 3) + '" y="' + n(y + 3) + '" width="' + n(w - 6) + '" height="' + n(h - 6) + '" fill="#9c4034"/>' +
      '<circle cx="' + n(x + w / 2) + '" cy="' + n(y + h * 0.42) + '" r="' + n(Math.min(w, h) * 0.18) + '" fill="none" stroke="#f6e4dc" stroke-width="0.8"/>' +
      T('SAMPLE', x + w / 2, y + h * 0.78, Math.max(6, w * 0.13), '#f6e4dc', SANS, 700, 'middle', '0.4');
  }

  function cardSize(kind) {
    const table = { '4x6': [6, 4], '6x9': [9, 6], '6x11': [11, 6], jumbo: [12, 9] };
    const pair = table[kind] || table['4x6'];
    return { w: pair[0] * INCH, h: pair[1] * INCH, label: kind === 'jumbo' ? '9 × 12' : kind.replace('x', ' × ') };
  }

  function postcardFront(size, look, copy, id) {
    const w = size.w;
    const h = size.h;
    const layout = look.layout;
    const pad = Math.max(14, w * 0.045);
    let inner = shadow(w, h, 3) + sheet(w, h, look.paper, layout === 'bold' ? '#0e1216' : '#e0d8cc', 3);
    if (layout === 'bold') {
      inner += '<rect width="' + n(w) + '" height="' + n(h * 0.08) + '" fill="' + look.accent + '"/>';
      inner += T(copy.kicker, pad, h * 0.2, h * 0.05, look.accent, SANS, 700, 'start', '1.6');
      const head = lines(copy.headline, pad, h * 0.34, w * 0.5, h * 0.085, look.ink, SANS, 800, 2, 1.12);
      inner += head.svg;
      const sub = lines(copy.sub, pad, h * 0.34 + head.height + h * 0.04, w * 0.5, h * 0.04, look.muted, SANS, 500, 2, 1.3);
      inner += sub.svg;
      inner += '<g transform="translate(' + n(w * 0.58) + ' ' + n(h * 0.16) + ')">' + house(w * 0.36, h * 0.48, look, id) + '</g>';
      inner += '<rect y="' + n(h * 0.78) + '" width="' + n(w) + '" height="' + n(h * 0.22) + '" fill="' + look.accent + '"/>';
      inner += T(copy.cta || 'Call or text', pad, h * 0.88, h * 0.04, '#fff', SANS, 600);
      inner += T(look.who.phone, pad, h * 0.95, h * 0.055, '#fff', SANS, 800);
    } else if (layout === 'friendly') {
      inner += '<rect x="' + n(pad * 0.6) + '" y="' + n(pad * 0.6) + '" width="' + n(w - pad * 1.2) + '" height="' + n(h - pad * 1.2) + '" fill="none" stroke="' + look.accent + '" stroke-width="1.2" rx="8"/>';
      inner += T(copy.kicker, w / 2, h * 0.14, h * 0.055, look.accent, SCRIPT, 500, 'middle');
      const head = lines(copy.headline, w / 2, h * 0.26, w * 0.8, h * 0.065, look.ink, SERIF, 600, 2, 1.15, 'middle');
      inner += head.svg;
      inner += '<g transform="translate(' + n(w * 0.34) + ' ' + n(h * 0.36) + ')">' + house(w * 0.32, h * 0.32, look, id) + '</g>';
      inner += T(look.who.phone, w / 2, h * 0.84, h * 0.06, look.accent, SCRIPT, 500, 'middle');
      inner += T(look.who.name, w / 2, h * 0.92, h * 0.04, look.muted, SANS, 600, 'middle');
    } else if (layout === 'minimal') {
      inner += T(copy.kicker, pad, h * 0.16, h * 0.035, look.muted, SANS, 600, 'start', '2');
      const head = lines(copy.headline, pad, h * 0.3, w * 0.55, h * 0.065, look.ink, SERIF, 600, 2, 1.12);
      inner += head.svg;
      inner += '<rect x="' + n(pad) + '" y="' + n(h * 0.3 + head.height + 6) + '" width="' + n(w * 0.16) + '" height="1.5" fill="' + look.accent + '"/>';
      const sub = lines(copy.sub, pad, h * 0.3 + head.height + h * 0.08, w * 0.55, h * 0.036, look.muted, SANS, 400, 2, 1.3);
      inner += sub.svg;
      inner += '<g transform="translate(' + n(w * 0.62) + ' ' + n(h * 0.48) + ')">' + house(w * 0.28, h * 0.28, look, id) + '</g>';
      inner += T(look.who.phone, pad, h * 0.88, h * 0.05, look.ink, SANS, 600);
    } else if (layout === 'photo') {
      inner += '<g transform="translate(0 0)">' + house(w, h * 0.62, look, id, true) + '</g>';
      inner += '<rect y="' + n(h * 0.58) + '" width="' + n(w) + '" height="' + n(h * 0.42) + '" fill="' + look.paper + '"/>';
      inner += T(copy.kicker, pad, h * 0.68, h * 0.032, look.accent, SANS, 700, 'start', '1.5');
      const head = lines(copy.headline, pad, h * 0.78, w * 0.62, h * 0.055, look.ink, SANS, 750, 2, 1.12);
      inner += head.svg;
      inner += T(look.who.phone, w - pad, h * 0.9, h * 0.045, look.ink, SANS, 700, 'end');
    } else if (layout === 'script') {
      const head = lines(copy.headline, pad, h * 0.24, w * 0.6, h * 0.08, look.ink, SCRIPT, 500, 2, 1.15);
      inner += head.svg;
      const note = lines(copy.sub, pad, h * 0.24 + head.height + h * 0.06, w * 0.58, h * 0.042, look.accent, HAND['hi-clarice'], 400, 3, 1.35);
      inner += note.svg;
      inner += '<g transform="translate(' + n(w * 0.68) + ' ' + n(h * 0.18) + ')">' + house(w * 0.26, h * 0.42, look, id) + '</g>';
      inner += T(look.who.phone, pad, h * 0.86, h * 0.05, look.ink, SANS, 600);
      inner += T(look.who.name, pad, h * 0.93, h * 0.035, look.muted, SANS, 500);
    } else {
      inner += '<g transform="translate(0 0)">' + house(w * 0.42, h, look, id) + '</g>';
      inner += '<rect x="' + n(w * 0.42) + '" width="' + n(w * 0.58) + '" height="' + n(h) + '" fill="' + look.paper + '"/>';
      const tx = w * 0.46;
      inner += T(copy.kicker, tx, h * 0.16, h * 0.04, look.accent, SANS, 700, 'start', '1.4');
      const head = lines(copy.headline, tx, h * 0.3, w * 0.48, h * 0.075, look.ink, SERIF, 650, 2, 1.15);
      inner += head.svg;
      const sub = lines(copy.sub, tx, h * 0.3 + head.height + h * 0.04, w * 0.48, h * 0.038, look.muted, SANS, 400, 2, 1.3);
      inner += sub.svg;
      inner += bullets(copy.bullets, tx + 4, h * 0.62, h * 0.038, look);
      inner += '<rect y="' + n(h - h * 0.16) + '" width="' + n(w) + '" height="' + n(h * 0.16) + '" fill="' + look.accent + '"/>';
      inner += T('Call or text  ' + look.who.phone, tx, h - h * 0.06, h * 0.045, '#fff', SANS, 700);
    }
    return { name: 'front', label: 'FRONT', w: w, h: h, inner: inner };
  }

  function postcardBack(size, look, copy) {
    const w = size.w;
    const h = size.h;
    const pad = Math.max(12, w * 0.04);
    const split = w * 0.58;
    const ink = '#1c2430';
    const muted = '#5c6b7a';
    let inner = shadow(w, h, 3) + sheet(w, h, '#f7f4ee', '#e0d8cc', 3);
    inner += T(look.who.name, pad, pad + h * 0.06, h * 0.04, ink, SERIF, 650);
    inner += T(look.who.line1, pad, pad + h * 0.13, h * 0.032, muted, SANS, 500);
    inner += T(look.who.line2, pad, pad + h * 0.19, h * 0.032, muted, SANS, 500);
    inner += indicia(w - pad - w * 0.22, pad, w * 0.22, h * 0.28, { ink: ink, muted: muted });
    inner += '<line x1="' + n(split) + '" y1="' + n(h * 0.34) + '" x2="' + n(split) + '" y2="' + n(h - pad) + '" stroke="#e0d8cc" stroke-width="1"/>';
    const message = lines(copy.paragraphs[0], pad, h * 0.42, split - pad * 2, h * 0.038, ink, SERIF, 400, 4, 1.35);
    inner += message.svg;
    inner += T(look.who.name, pad, h * 0.42 + message.height + h * 0.08, h * 0.055, look.accent, SCRIPT, 500);
    inner += qr(pad, h - pad - h * 0.2, h * 0.16);
    inner += T('Alex Homeowner', split + pad, h * 0.5, h * 0.04, ink, SERIF, 650);
    inner += T('456 Oak Ave', split + pad, h * 0.58, h * 0.034, ink, SANS, 500);
    inner += T('Anytown, ST 00000', split + pad, h * 0.65, h * 0.034, ink, SANS, 500);
    inner += barcode(split + pad, h * 0.78, w * 0.32, h * 0.08);
    return { name: 'back', label: 'BACK', w: w, h: h, inner: inner };
  }

  function envelope(finish, plain, look) {
    const w = 9.5 * INCH;
    const h = 4.125 * INCH;
    const ink = '#243246';
    let inner = shadow(w, h, 2) + sheet(w, h, '#f4f1ea', '#ddd6cb', 2);
    inner += '<path d="M1 1 L' + n(w / 2) + ' ' + n(h * 0.42) + ' L' + n(w - 1) + ' 1" fill="none" stroke="#e5ddd2" stroke-width="1"/>';
    inner += T(look.who.name, 28, 36, 13, ink, SERIF, 650);
    inner += T(look.who.line1, 28, 52, 11, '#5c6b7a', SANS, 500);
    inner += T(look.who.line2, 28, 66, 11, '#5c6b7a', SANS, 500);
    if (plain) {
      inner += stamp(w - 86, 22, 58, 70);
      inner += T('Alex Homeowner', w * 0.38, h * 0.48, 16, ink, SERIF, 650);
      inner += T('456 Oak Ave', w * 0.38, h * 0.58, 13, ink, SANS, 500);
      inner += T('Anytown, ST 00000', w * 0.38, h * 0.68, 13, ink, SANS, 500);
    } else {
      inner += indicia(w - 150, 18, 122, 62, { ink: ink, muted: '#5c6b7a' });
      inner += '<rect x="36" y="78" width="210" height="46" rx="2" fill="#fbfcfe" stroke="#c5d0dc"/>';
      inner += T(look.who.name, 46, 96, 11, finish === 'color' ? look.accent : ink, SANS, 700);
      inner += T(look.who.line1, 46, 112, 10, '#5c6b7a', SANS, 500);
      inner += '<rect x="36" y="136" width="280" height="52" rx="2" fill="#fbfcfe" stroke="#c5d0dc"/>';
      inner += T('Alex Homeowner', 48, 156, 13, ink, SERIF, 650);
      inner += T('456 Oak Ave, Anytown, ST 00000', 48, 174, 11, ink, SANS, 500);
    }
    return { name: 'envelope', label: 'ENVELOPE', w: w, h: h, inner: inner };
  }

  function letterhead(look, copy, id) {
    const w = 8.5 * INCH;
    const h = 11 * INCH;
    const pad = 36;
    const layout = look.layout;
    let inner = shadow(w, h, 2) + sheet(w, h, look.paper, '#e0d8cc', 2);
    if (layout === 'bold') {
      inner += '<rect width="' + n(w) + '" height="18" fill="' + look.accent + '"/>';
    } else if (layout === 'minimal') {
      inner += '<rect x="' + n(pad) + '" y="28" width="42" height="2" fill="' + look.accent + '"/>';
    } else {
      inner += '<rect width="' + n(w) + '" height="6" fill="' + look.accent + '"/>';
    }
    inner += logo(pad, 28, 36, look);
    inner += T(look.who.name, pad + 46, 46, 16, look.ink, layout === 'bold' ? SANS : SERIF, 700);
    inner += T(look.who.phone, pad + 46, 64, 11, look.muted, SANS, 500);
    inner += T(look.who.line1, w - pad, 44, 11, look.muted, SANS, 500, 'end');
    inner += T(look.who.line2, w - pad, 60, 11, look.muted, SANS, 500, 'end');
    inner += '<rect x="' + n(pad) + '" y="84" width="' + n(w - pad * 2) + '" height="1" fill="' + look.soft + '"/>';
    if (layout === 'photo') {
      inner += '<g transform="translate(' + n(w - pad - 120) + ' 100)">' + house(120, 78, look, id) + '</g>';
    }
    inner += T(sampleDate(), pad, 112, 12, look.muted, SANS, 500);
    inner += T('Dear Homeowner,', pad, 142, 15, look.ink, SERIF, 600);
    let y = 172;
    copy.paragraphs.forEach(function (paragraph) {
      const block = lines(paragraph, pad, y, (layout === 'photo' ? w - pad * 2 - 130 : w - pad * 2), 13, look.ink, SERIF, 400, 3, 1.4);
      inner += block.svg;
      y += block.height + 12;
    });
    inner += T(look.who.name, pad, y + 28, 28, look.accent, SCRIPT, 500);
    inner += headshot(w - pad - 28, y + 10, 26, look);
    inner += T(look.who.name, pad, y + 52, 12, look.ink, SANS, 700);
    inner += T(copy.ps, pad, h - 48, 12, look.ink, SERIF, 500);
    return { name: 'letter', label: 'LETTER', w: w, h: h, inner: inner };
  }

  function yellowPage(look, copy, hand, ink) {
    const w = 8.5 * INCH;
    const h = 11 * INCH;
    const font = look.layout === 'bold' ? HAND['shopping-list'] : (look.layout === 'minimal' ? HAND['normal-print'] : (HAND[hand] || HAND['hi-clarice']));
    const color = ink === 'black' ? '#1c2430' : (look.layout === 'bold' ? '#1a1a1a' : '#1d4e89');
    const pad = look.layout === 'minimal' ? 72 : 42;
    const paper = look.layout === 'friendly' ? '#ffe9a8' : '#ffe56a';
    let inner = shadow(w, h, 1) + sheet(w, h, paper, '#e2c84a', 1);
    if (look.layout === 'bold') inner += '<rect width="' + n(w) + '" height="28" fill="#1a1a1a"/>' + T(copy.kicker, w / 2, 20, 14, '#ffe56a', SANS, 800, 'middle', '1.4');
    if (look.layout === 'friendly') inner += '<rect x="18" y="18" width="' + n(w - 36) + '" height="' + n(h - 36) + '" fill="none" stroke="#c4784a" stroke-width="1.4" rx="10"/>';
    if (look.layout === 'photo') {
      inner += '<g transform="translate(' + n(pad) + ' 36)">' + house(160, 100, look, 'yellow') + '</g>';
    }
    const headSize = look.layout === 'bold' ? 28 : (look.layout === 'minimal' ? 20 : 22);
    const head = lines(copy.headline, pad, look.layout === 'photo' ? 160 : 78, w - pad * 2, headSize, color, font, 500, 2, 1.2);
    inner += head.svg;
    let y = (look.layout === 'photo' ? 160 : 78) + head.height + 18;
    copy.paragraphs.forEach(function (paragraph) {
      if (y > h - 90) return;
      const block = lines(paragraph, pad, y, w - pad * 2, 16, color, font, 400, 3, 1.4);
      if (y + block.height > h - 70) return;
      inner += block.svg;
      y += block.height + 14;
    });
    if (y < h - 36) inner += T(look.who.phone, pad, y + 28, 22, color, font, 500);
    return { name: 'letter', label: 'LETTER', w: w, h: h, inner: inner };
  }

  function offerPage(look, copy) {
    const w = 8.5 * INCH;
    const h = 11 * INCH;
    const pad = 32;
    let inner = shadow(w, h, 2) + sheet(w, h, '#fbf8f2', '#e0d8cc', 2);
    inner += '<rect width="' + n(w) + '" height="8" fill="' + look.accent + '"/>';
    inner += T('SAMPLE — NOT A CHECK', w / 2, 36, 12, look.accent, SANS, 700, 'middle', '1.2');
    inner += '<rect x="' + n(pad) + '" y="52" width="' + n(w - pad * 2) + '" height="168" rx="4" fill="#fff" stroke="' + look.accent + '" stroke-width="1.4"/>';
    inner += logo(pad + 12, 66, 32, look);
    inner += T(look.who.name, pad + 54, 82, 14, look.ink, SERIF, 700);
    inner += T(look.who.line1, pad + 54, 100, 11, look.muted, SANS, 500);
    inner += T('DATE', w - pad - 120, 78, 9, look.muted, SANS, 700);
    inner += T(sampleDate(), w - pad - 120, 96, 12, look.ink, SANS, 600);
    inner += T('PAY TO THE ORDER OF', pad + 16, 140, 9, look.muted, SANS, 700, 'start', '0.6');
    inner += T('Alex Homeowner', pad + 16, 160, 16, look.ink, SERIF, 650);
    inner += '<rect x="' + n(pad + 16) + '" y="168" width="' + n(w - pad * 2 - 150) + '" height="1" fill="' + look.soft + '"/>';
    inner += '<rect x="' + n(w - pad - 110) + '" y="142" width="94" height="28" fill="' + look.soft + '"/>';
    inner += T('$ ——', w - pad - 63, 162, 14, look.ink, SANS, 700, 'middle');
    inner += T(copy.headline, pad + 16, 196, 12, look.ink, SANS, 500);
    inner += T(look.who.name, w - pad - 20, 200, 18, look.accent, SCRIPT, 500, 'end');
    inner += barcode(pad + 16, 206, 180, 8);
    inner += T('Dear Homeowner,', pad, 258, 15, look.ink, SERIF, 600);
    let y = 286;
    copy.paragraphs.slice(0, 3).forEach(function (paragraph) {
      const block = lines(paragraph, pad, y, w - pad * 2, 13, look.ink, SERIF, 400, 2, 1.35);
      inner += block.svg;
      y += block.height + 10;
    });
    inner += T(copy.ps, pad, h - 48, 12, look.ink, SERIF, 500);
    return { name: 'letter', label: 'OFFER', w: w, h: h, inner: inner };
  }

  function noteCard(look, copy, hand, ink) {
    const w = 5.5 * INCH;
    const h = 4.25 * INCH;
    const font = HAND[hand] || HAND['hi-clarice'];
    const color = ink === 'black' ? '#1c2430' : '#1d4e89';
    const pad = look.layout === 'minimal' ? 36 : 22;
    let inner = shadow(w, h, 3) + sheet(w, h, look.layout === 'friendly' ? '#fff6ea' : '#fffdf8', '#e4ddd2', 3);
    inner += '<rect width="' + n(w * 0.08) + '" height="' + n(h) + '" fill="' + look.soft + '"/>';
    if (look.layout === 'photo') {
      inner += '<g transform="translate(' + n(w - 120) + ' 16)">' + house(100, 70, look, 'note') + '</g>';
    }
    inner += T(copy.headline, pad + 8, 48, look.layout === 'bold' ? 26 : 22, color, font, 500);
    const block = lines(copy.paragraphs[0], pad + 8, 84, w - pad * 2 - (look.layout === 'photo' ? 90 : 10), 16, color, font, 400, 4, 1.4);
    inner += block.svg;
    inner += T(look.who.phone, pad + 8, h - 28, 16, color, font, 500);
    return { name: 'front', label: 'NOTE', w: w, h: h, inner: inner };
  }

  function handPostcard(size, look, copy, hand, ink, id) {
    const w = size.w;
    const h = size.h;
    const font = HAND[hand] || HAND['hi-clarice'];
    const color = ink === 'black' ? '#1c2430' : '#1d4e89';
    const pad = Math.max(16, w * 0.06);
    let inner = shadow(w, h, 3) + sheet(w, h, '#fffdf8', '#e4ddd2', 3);
    if (look.layout === 'photo' || look.layout === 'classic') {
      inner += '<g transform="translate(' + n(w * 0.62) + ' ' + n(h * 0.12) + ')">' + house(w * 0.3, h * 0.55, look, id) + '</g>';
    }
    inner += T(copy.headline, pad, h * 0.22, h * 0.09, color, font, 500);
    const block = lines(copy.paragraphs[0], pad, h * 0.38, w * (look.layout === 'photo' ? 0.55 : 0.72), h * 0.055, color, font, 400, 4, 1.35);
    inner += block.svg;
    inner += T(look.who.phone, pad, h * 0.88, h * 0.06, color, font, 500);
    return { name: 'front', label: 'FRONT', w: w, h: h, inner: inner };
  }

  function noteEnvelope(look) {
    const w = 7.25 * INCH;
    const h = 5.25 * INCH;
    let inner = shadow(w, h, 2) + sheet(w, h, '#f7f3ea', '#e0d8cc', 2);
    inner += T(look.who.name, 24, 36, 14, '#1c2430', SERIF, 650);
    inner += T(look.who.line1, 24, 54, 12, '#5c6b7a', SANS, 500);
    inner += T(look.who.line2, 24, 70, 12, '#5c6b7a', SANS, 500);
    inner += stamp(w - 92, 22, 64, 78);
    inner += T('Alex Homeowner', w * 0.32, h * 0.48, 16, '#1c2430', SERIF, 650);
    inner += T('456 Oak Ave', w * 0.32, h * 0.58, 13, '#1c2430', SANS, 500);
    inner += T('Anytown, ST 00000', w * 0.32, h * 0.68, 13, '#1c2430', SANS, 500);
    return { name: 'back', label: 'ENVELOPE', w: w, h: h, inner: inner };
  }

  function doorHanger(design, look, copy, id) {
    const size = design && design.hangerSize === '3.5x8.5' ? [3.5, 8.5] : (design && design.hangerSize === '4.25x14' ? [4.25, 14] : [4.25, 11]);
    const w = size[0] * INCH;
    const h = size[1] * INCH;
    const hole = Math.min(w, h) * 0.07;
    const top = hole * 3.2;
    const d = 'M' + n(w * 0.22) + ' ' + n(top) +
      ' V' + n(hole * 2.1) +
      ' C' + n(w * 0.22) + ' ' + n(hole * 0.4) + ' ' + n(w * 0.78) + ' ' + n(hole * 0.4) + ' ' + n(w * 0.78) + ' ' + n(hole * 2.1) +
      ' V' + n(top) +
      ' H' + n(w) +
      ' V' + n(h - w * 0.12) +
      ' Q' + n(w) + ' ' + n(h) + ' ' + n(w - w * 0.12) + ' ' + n(h) +
      ' H' + n(w * 0.12) +
      ' Q0 ' + n(h) + ' 0 ' + n(h - w * 0.12) +
      ' V' + n(top) +
      ' H' + n(w * 0.22) +
      ' Z M' + n(w / 2 - hole) + ' ' + n(hole * 1.7) +
      ' a' + n(hole) + ' ' + n(hole) + ' 0 1 0 ' + n(hole * 2) + ' 0 a' + n(hole) + ' ' + n(hole) + ' 0 1 0 -' + n(hole * 2) + ' 0 Z';
    const gloss = design && design.hangerFinish === 'uv';
    let inner = shadow(w, h, 8);
    inner += '<path d="' + d + '" fill="' + look.paper + '" stroke="' + (look.layout === 'bold' ? '#0e1216' : '#d9d0c4') + '" stroke-width="1.2" fill-rule="evenodd"/>';
    if (gloss) inner += '<path d="' + d + '" fill="#ffffff" opacity="0.18" fill-rule="evenodd"/>';
    const pad = w * 0.1;
    const y0 = top + hole;
    if (look.layout === 'photo' || look.layout === 'classic') {
      inner += '<g transform="translate(' + n(pad) + ' ' + n(y0) + ')">' + house(w - pad * 2, h * 0.28, look, id) + '</g>';
    }
    const headY = look.layout === 'photo' || look.layout === 'classic' ? y0 + h * 0.32 : y0 + h * 0.08;
    const headFont = look.layout === 'script' || look.layout === 'friendly' ? SCRIPT : (look.layout === 'bold' ? SANS : SERIF);
    inner += T(copy.kicker, w / 2, headY, w * 0.065, look.accent, SANS, 700, 'middle', '0.8');
    const head = lines(copy.headline, w / 2, headY + w * 0.12, w - pad * 2.4, w * 0.08, look.ink, headFont, 700, 3, 1.15, 'middle');
    inner += head.svg;
    inner += bullets(copy.bullets, pad + 8, headY + w * 0.46, w * 0.055, look);
    inner += '<rect x="' + n(pad) + '" y="' + n(h - h * 0.16) + '" width="' + n(w - pad * 2) + '" height="' + n(h * 0.1) + '" rx="4" fill="' + look.accent + '"/>';
    inner += T(look.who.phone, w / 2, h - h * 0.095, w * 0.07, '#fff', SANS, 800, 'middle');
    return { name: 'hanger', label: 'HANGER', w: w, h: h, inner: inner };
  }

  function yardSign(template, brand) {
    const tpl = template || { lines: ['CASH', 'OFFER'], fill: '#f7f7f5', ink: '#1a1a1a', band: '#c1121f', layout: 'stack' };
    const person = who(brand);
    const w = 420;
    const h = 560;
    const signW = 250;
    const signH = 300;
    const x = (w - signW) / 2;
    const y = 36;
    const cx = w / 2;
    const font = tpl.layout === 'marker' ? HAND['shopping-list'] : DISPLAY;
    const lineset = (tpl.lines && tpl.lines.length) ? tpl.lines : ['CASH', 'OFFER'];
    let face = '<rect width="' + signW + '" height="22" fill="' + (tpl.band || tpl.ink) + '"/>';
    if (tpl.layout === 'sold') {
      face += T('SOLD', signW / 2, 170, 92, tpl.ink, font, 700, 'middle');
    } else if (tpl.layout === 'phone') {
      face += T(lineset[0] || 'CALL', signW / 2, 90, 42, tpl.ink, font, 700, 'middle');
      face += T('555', signW / 2, 170, 64, tpl.ink, DISPLAY, 700, 'middle');
      face += T('0100', signW / 2, 240, 64, tpl.ink, DISPLAY, 700, 'middle');
    } else if (tpl.layout === 'marker') {
      face += T(lineset[0] || 'No repairs', 28, 130, 40, tpl.ink, font, 500);
      face += T(lineset[1] || 'No fees', 28, 190, 40, tpl.ink, font, 500);
      face += T(person.phone, signW / 2, 260, 28, tpl.ink, font, 500, 'middle');
    } else {
      face += T(lineset[0], signW / 2, 120, 54, tpl.ink, font, 700, 'middle');
      if (lineset[1]) face += T(lineset[1], signW / 2, 180, 54, tpl.ink, font, 700, 'middle');
      face += T(person.phone, signW / 2, 250, 26, tpl.ink, SANS, 700, 'middle');
    }
    const inner = '<rect width="' + w + '" height="' + h + '" fill="#d7e6f2"/>' +
      '<path d="M0 390 Q120 360 210 400 T420 380 V560 H0 Z" fill="#7eaa62"/>' +
      '<line x1="' + cx + '" y1="' + (y + signH) + '" x2="' + cx + '" y2="470" stroke="#5c5346" stroke-width="4"/>' +
      '<path d="M' + cx + ' 470 l-28 26 M' + cx + ' 470 l28 26" stroke="#5c5346" stroke-width="4" data-stake="step-in"/>' +
      '<g transform="translate(' + x + ' ' + y + ')">' +
      '<rect x="4" y="6" width="' + signW + '" height="' + signH + '" fill="#1b2430" opacity="0.15"/>' +
      '<rect width="' + signW + '" height="' + signH + '" fill="' + tpl.fill + '" stroke="' + (tpl.band || tpl.ink) + '" stroke-width="3"/>' +
      face + '</g>';
    return { name: 'sign', label: 'SIGN', w: w, h: h, inner: inner };
  }

  function render(ctx) {
    const input = ctx || {};
    const id = String(input.id || '');
    const design = input.design || {};
    const look = theme(input.template, input.brand, id === 'letter' && input.choice === 'color' ? 'color' : (id === 'letter' ? 'bw' : ''));
    const copy = copyOf(input.angle, !!input.commercial);
    activePhoto = pickPhoto(input.template, !!input.commercial, id);
    const swatch = !!input.swatch;
    const salt = id + '-' + ((input.template && input.template.id) || 'classic');
    if (id === 'yard-sign') return compose([yardSign(input.template, input.brand)], swatch);
    if (id === 'door-hanger') return compose([doorHanger(design, look, copy, salt)], swatch);
    if (id === 'yellow-letter') {
      return compose([
        yellowPage(look, copy, input.hand, design.ink),
        noteEnvelope(look),
      ], swatch);
    }
    if (id === 'offer-letter') {
      return compose([
        offerPage(look, copy),
        envelope('color', false, look),
      ], swatch);
    }
    if (id === 'letter') {
      const finish = input.choice === 'color' ? 'color' : 'bw';
      return compose([
        envelope(finish, design.envelope === 'plain', look),
        letterhead(look, copy, salt),
      ], swatch);
    }
    if (id === 'handwritten' && input.choice !== '4x6' && input.choice !== '6x9') {
      return compose([
        noteCard(look, copy, input.hand, design.ink),
        noteEnvelope(look),
      ], swatch);
    }
    if (id === 'handwritten') {
      const size = cardSize(input.choice === '6x9' ? '6x9' : '4x6');
      return compose([
        handPostcard(size, look, copy, input.hand, design.ink, salt),
        postcardBack(size, look, copy),
      ], swatch);
    }
    const size = cardSize(id === 'jumbo-postcard' ? 'jumbo' : (input.choice || '4x6'));
    return compose([
      postcardFront(size, look, copy, salt),
      postcardBack(size, look, copy),
    ], swatch);
  }

  return { render: render };
});
