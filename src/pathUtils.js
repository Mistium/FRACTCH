export const sep = '/';

export function norm(p) {
  return String(p ?? '').replace(/\\/g, '/');
}

export function isAbsolute(p) {
  const s = norm(p);
  return s.startsWith('/') || /^[A-Za-z]:(\/|$)/.test(s);
}

export function normalizePath(p) {
  const s = norm(p);
  let prefix = '';
  let rest = s;
  const drive = /^([A-Za-z]:)(\/|$)/.exec(s);
  if (drive) {
    prefix = drive[1] + '/';
    rest = s.slice(drive[1].length + 1);
  } else if (s.startsWith('/')) {
    prefix = '/';
    rest = s.slice(1);
  }
  const out = [];
  for (const part of rest.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop();
      else if (!prefix) out.push('..');
      continue;
    }
    out.push(part);
  }
  const body = out.join('/');
  if (prefix) return prefix + body;
  return body || '.';
}

export function join(...parts) {
  const joined = parts
    .map(norm)
    .filter((p) => p !== '')
    .join('/');
  return normalizePath(joined);
}

export function dirname(p) {
  const s = normalizePath(p);
  const i = s.lastIndexOf('/');
  if (i < 0) return '.';
  if (i === 0) return '/';
  if (/^[A-Za-z]:$/.test(s.slice(0, i))) return s.slice(0, i + 1);
  return s.slice(0, i);
}

export function basename(p) {
  const s = norm(p).replace(/\/+$/, '');
  const i = s.lastIndexOf('/');
  return i < 0 ? s : s.slice(i + 1);
}

export function resolveFrom(base, p) {
  return isAbsolute(p) ? normalizePath(p) : normalizePath(join(base, p));
}

export function relative(from, to) {
  const f = normalizePath(from).split('/').filter((x) => x && x !== '.');
  const t = normalizePath(to).split('/').filter((x) => x && x !== '.');
  let i = 0;
  while (i < f.length && i < t.length && f[i] === t[i]) i++;
  return [...Array(f.length - i).fill('..'), ...t.slice(i)].join('/');
}
