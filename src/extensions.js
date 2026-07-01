import * as path from './pathUtils.js';
import { toPromiseFs } from './fsAdapter.js';

function sanitize(name) {
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
  const vfs = toPromiseFs(fsLike);
  const exts = projectJson.extensions || [];
  const urls = projectJson.extensionURLs || {};
  if (!exts.length) return { count: 0 };

  const dir = path.join(outDir, 'extensions');
  await vfs.mkdirp(dir);

  const index = [];
  for (const id of exts) {
    const url = urls[id] || null;
    const safe = sanitize(id);
    let file = null;
    let kind = 'builtin';
    if (url && url.startsWith('data:')) {
      file = `${safe}.js`;
      await vfs.writeFile(path.join(dir, file), decodeDataUrl(url));
      kind = 'data';
    } else if (url) {
      file = `${safe}.url`;
      await vfs.writeFile(path.join(dir, file), url);
      kind = 'url';
    }
    index.push(kind === 'url' ? { id, kind, file, url } : { id, kind, file });
    if (verbose) console.log(`[ext] ${id} ${kind}`);
  }

  await vfs.writeFile(path.join(dir, 'index.json'), JSON.stringify(index, null, 2));
  return { count: exts.length };
}
