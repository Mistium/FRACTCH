const MARKER_RE = /^fractch_h([0-9a-fA-F]+)_fractch_/;

export function markerPrefixForFileStem(relStem) {
  const clean = cleanRelStem(relStem);
  if (!clean || clean === 'main') return null;
  let hex = '';
  for (let i = 0; i < clean.length; i++) {
    hex += clean.charCodeAt(i).toString(16).padStart(4, '0');
  }
  return `fractch_h${hex}_fractch_`;
}

export function decodeFileStemFromTopId(topId) {
  const m = MARKER_RE.exec(String(topId || ''));
  if (!m) return null;
  const hex = m[1];
  if (hex.length % 4 !== 0) return null;
  let out = '';
  for (let i = 0; i < hex.length; i += 4) {
    out += String.fromCharCode(Number.parseInt(hex.slice(i, i + 4), 16));
  }
  return cleanRelStem(out);
}

export function cleanRelStem(relStem) {
  const raw = String(relStem || '')
    .replace(/\\/g, '/')
    .replace(/\.fractch$/i, '')
    .replace(/^\/+|\/+$/g, '');
  if (!raw || raw.startsWith('/') || /^[A-Za-z]:\//.test(raw)) return null;
  const parts = raw.split('/').filter(Boolean);
  if (!parts.length || parts.some((p) => p === '.' || p === '..' || p.startsWith('.'))) return null;
  return parts.join('/');
}

export function idSafeSuffix(id) {
  const suffix = String(id || 'top').replace(/[^A-Za-z0-9_-]/g, '_');
  return suffix || 'top';
}
