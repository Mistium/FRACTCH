import * as path from './pathUtils.js';
import { toPromiseFs } from './fsAdapter.js';

export function sanitize(name) {
  return String(name).replace(/[^a-zA-Z0-9-_]/g, '_');
}

function decodeBase64(data) {
  if (typeof Buffer !== 'undefined') return Buffer.from(data, 'base64').toString('utf8');
  const bin = atob(data);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function decodeDataUrl(u) {
  const comma = u.indexOf(',');
  if (comma < 0) return '';
  const meta = u.slice(5, comma);
  const data = u.slice(comma + 1);
  if (/;base64/i.test(meta)) return decodeBase64(data);
  return decodeURIComponent(data);
}

export async function writeExtensions(projectJson, outDir, { verbose = false, fs: fsLike } = {}) {
  const exts = projectJson.extensions || [];
  const urls = projectJson.extensionURLs || {};
  const dataExts = exts.filter((id) => String(urls[id] || '').startsWith('data:'));
  if (!dataExts.length) return { count: 0 };

  const vfs = toPromiseFs(fsLike);
  const dir = path.join(outDir, 'extensions');
  await vfs.mkdirp(dir);
  for (const id of dataExts) {
    const file = `${sanitize(id)}.js`;
    await vfs.writeFile(path.join(dir, file), decodeDataUrl(urls[id]));
    if (verbose) console.log(`[ext] extracted ${id} -> extensions/${file}`);
  }
  return { count: dataExts.length };
}
