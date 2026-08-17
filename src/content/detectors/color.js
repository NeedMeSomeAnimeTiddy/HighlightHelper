/**
 * CSS colours — local, no API.
 *
 * Matches #hex, rgb()/rgba() and hsl()/hsla(), shows a swatch, and converts
 * between the three notations.
 *
 * Named colours are deliberately not matched: "orange", "tomato" and "plum"
 * are ordinary words far more often than they are colours.
 */

const MAX_LEN = 60;

const RE_HEX = /^#?([0-9a-f]{3,8})$/i;
const RE_RGB = /^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i;
const RE_HSL = /^hsla?\(\s*([-\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function channel(raw) {
  const s = String(raw).trim();
  return s.endsWith('%')
    ? clamp(Math.round((parseFloat(s) / 100) * 255), 0, 255)
    : clamp(Math.round(parseFloat(s)), 0, 255);
}

function alphaOf(raw) {
  if (raw == null) return 1;
  const s = String(raw).trim();
  return clamp(s.endsWith('%') ? parseFloat(s) / 100 : parseFloat(s), 0, 1);
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r, g, b].map((v) => Math.round((v + m) * 255));
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return [0, 0, Math.round(l * 100)];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [Math.round(h * 60 + 360) % 360, Math.round(s * 100), Math.round(l * 100)];
}

function parseColor(text) {
  const t = text.trim();

  const hex = RE_HEX.exec(t);
  if (hex && t.startsWith('#')) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    return {
      rgb: [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)),
      alpha: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
      source: 'hex'
    };
  }

  const rgb = RE_RGB.exec(t);
  if (rgb) {
    return {
      rgb: [rgb[1], rgb[2], rgb[3]].map(channel),
      alpha: alphaOf(rgb[4]),
      source: 'rgb'
    };
  }

  const hsl = RE_HSL.exec(t);
  if (hsl) {
    return {
      rgb: hslToRgb(parseFloat(hsl[1]), parseFloat(hsl[2]), parseFloat(hsl[3])),
      alpha: alphaOf(hsl[4]),
      source: 'hsl'
    };
  }

  return null;
}

const toHex = ([r, g, b], alpha) => {
  const pair = (n) => n.toString(16).padStart(2, '0');
  const base = `#${pair(r)}${pair(g)}${pair(b)}`;
  return alpha < 1 ? base + pair(Math.round(alpha * 255)) : base;
};

const toRgbString = ([r, g, b], alpha) =>
  alpha < 1 ? `rgba(${r}, ${g}, ${b}, ${+alpha.toFixed(3)})` : `rgb(${r}, ${g}, ${b})`;

const toHslString = (rgb, alpha) => {
  const [h, s, l] = rgbToHsl(...rgb);
  return alpha < 1 ? `hsla(${h}, ${s}%, ${l}%, ${+alpha.toFixed(3)})` : `hsl(${h}, ${s}%, ${l}%)`;
};

/** WCAG relative luminance, for the "reads on black/white" hint. */
function luminance([r, g, b]) {
  const lin = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

const contrast = (l1, l2) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

export default {
  id: 'color',
  title: 'Colour',
  priority: 8,

  matches(text) {
    if (!text || text.length > MAX_LEN) return null;
    const found = parseColor(text);
    return found || null;
  },

  rows({ match }) {
    return [{
      key: 'color',
      icon: 'color',
      label: 'Colour',
      value: toHex(match.rgb, match.alpha),
      detailTitle: 'Colour',
      // Nothing to fetch or compute later — the whole view is known already.
      detail: { kind: 'blocks', blocks: detailBlocks(match) }
    }];
  }
};

function detailBlocks(match) {
  const hex = toHex(match.rgb, match.alpha);
  // The swatch is painted with the rgb() form because it is the one notation
  // every renderer understands, alpha included.
  const css = toRgbString(match.rgb, match.alpha);

  const lum = luminance(match.rgb);
  const onWhite = contrast(lum, 1).toFixed(2);
  const onBlack = contrast(lum, 0).toFixed(2);

  return [
    { type: 'swatch', css, title: hex, sub: `read as ${match.source}` },
    {
      type: 'facts',
      items: [
        { label: 'Hex', value: hex, mono: true },
        { label: 'RGB', value: toRgbString(match.rgb, match.alpha), mono: true },
        { label: 'HSL', value: toHslString(match.rgb, match.alpha), mono: true },
        {
          label: 'Contrast',
          value: `${onWhite}:1 on white · ${onBlack}:1 on black`
        }
      ]
    },
    {
      type: 'buttons',
      items: [{ copy: hex }]
    }
  ];
}
