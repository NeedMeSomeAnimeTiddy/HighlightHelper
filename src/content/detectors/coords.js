/**
 * Geographic coordinates — local, no API.
 *
 * Recognises decimal pairs ("37.7749, -122.4194"), hemisphere-suffixed pairs
 * ("37.7749N 122.4194W") and degrees/minutes/seconds, then converts between
 * the two notations.
 *
 * The map buttons open a new tab, which hands the coordinates to a third
 * party, so they are explicit buttons rather than anything automatic and the
 * labels name the service. OpenStreetMap is listed first: it needs no account
 * and does not tie the lookup to a profile.
 */

const MAX_LEN = 80;

const DEC = String.raw`[+-]?\d{1,3}(?:\.\d+)?`;
const HEMI_LAT = '[NnSs]';
const HEMI_LON = '[EeWw]';

// 37.7749, -122.4194   |   37.7749 -122.4194
const RE_DECIMAL = new RegExp(`^(${DEC})\\s*[,;]?\\s+(${DEC})$`);
// 37.7749° N, 122.4194° W
const RE_DECIMAL_HEMI = new RegExp(
  `^(${DEC})\\s*°?\\s*(${HEMI_LAT})[,;]?\\s*(${DEC})\\s*°?\\s*(${HEMI_LON})$`
);
// 37°46'29.6"N 122°25'9.8"W
const DMS = String.raw`(\d{1,3})\s*[°d]\s*(?:(\d{1,2})\s*['′m]\s*(?:([\d.]+)\s*["″s]?\s*)?)?`;
const RE_DMS = new RegExp(`^${DMS}(${HEMI_LAT})[,;]?\\s*${DMS}(${HEMI_LON})$`);

const num = (s) => (s == null ? 0 : Number(s));

function fromDms(deg, min, sec, hemi) {
  const value = num(deg) + num(min) / 60 + num(sec) / 3600;
  return /[SsWw]/.test(hemi) ? -value : value;
}

function parse(text) {
  const t = text.trim().replace(/\s+/g, ' ');

  const dms = RE_DMS.exec(t);
  if (dms) {
    return {
      lat: fromDms(dms[1], dms[2], dms[3], dms[4]),
      lon: fromDms(dms[5], dms[6], dms[7], dms[8]),
      source: 'DMS'
    };
  }

  const hemi = RE_DECIMAL_HEMI.exec(t);
  if (hemi) {
    const lat = Math.abs(Number(hemi[1])) * (/[Ss]/.test(hemi[2]) ? -1 : 1);
    const lon = Math.abs(Number(hemi[3])) * (/[Ww]/.test(hemi[4]) ? -1 : 1);
    return { lat, lon, source: 'decimal' };
  }

  const dec = RE_DECIMAL.exec(t);
  if (dec) return { lat: Number(dec[1]), lon: Number(dec[2]), source: 'decimal' };

  return null;
}

function toDms(value, [pos, neg]) {
  const hemi = value < 0 ? neg : pos;
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  const min = Math.floor(minFloat);
  const sec = (minFloat - min) * 60;
  return `${deg}°${String(min).padStart(2, '0')}'${sec.toFixed(1).padStart(4, '0')}"${hemi}`;
}

function openTab(url) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

export default {
  id: 'coords',
  title: 'Coordinates',
  priority: 11,

  matches(text) {
    if (!text || text.length > MAX_LEN) return null;
    if (!/\d/.test(text)) return null;
    const found = parse(text);
    if (!found) return null;
    // A pair of ordinary numbers is not a location.
    if (!Number.isFinite(found.lat) || !Number.isFinite(found.lon)) return null;
    if (Math.abs(found.lat) > 90 || Math.abs(found.lon) > 180) return null;
    // "0, 0" is null island and almost always a false positive.
    if (found.lat === 0 && found.lon === 0) return null;
    return found;
  },

  rows({ match }) {
    // The row shows whichever notation the selection wasn't written in, so the
    // answer is the half you couldn't already read.
    const decimal = `${match.lat.toFixed(5)}, ${match.lon.toFixed(5)}`;
    return [{
      key: 'coords',
      icon: 'pin',
      label: 'Coordinates',
      value: match.source === 'DMS' ? decimal : toDms(match.lat, ['N', 'S']),
      detailTitle: 'Coordinates',
      detail: { kind: 'blocks', blocks: detailBlocks(match) }
    }];
  }
};

function detailBlocks(match) {
  // A finer rounding than the menu row: this is the view you copy out of.
  const decimal = `${match.lat.toFixed(6)}, ${match.lon.toFixed(6)}`;
  const dms = `${toDms(match.lat, ['N', 'S'])} ${toDms(match.lon, ['E', 'W'])}`;

  const osm = `https://www.openstreetmap.org/?mlat=${match.lat}&mlon=${match.lon}#map=13/${match.lat}/${match.lon}`;
  const google = `https://www.google.com/maps/search/?api=1&query=${match.lat},${match.lon}`;

  return [
    { type: 'headline', text: decimal },
    { type: 'sub', text: `read as ${match.source}` },
    {
      type: 'facts',
      items: [
        { label: 'Decimal', value: decimal, mono: true },
        { label: 'DMS', value: dms, mono: true }
      ]
    },
    {
      // `run` is a callback, not a node, so the buttons stay describable: a
      // native renderer draws its own and calls back in to open the tab.
      type: 'buttons',
      items: [
        { label: 'OpenStreetMap', icon: 'pin', run: () => openTab(osm) },
        { label: 'Google Maps', icon: 'pin', run: () => openTab(google) },
        { copy: decimal }
      ]
    }
  ];
}
