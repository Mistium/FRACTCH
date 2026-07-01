import fs from 'fs';
import path from 'path';

function sanitize(name) {
  return String(name).replace(/[^a-zA-Z0-9-_]/g, '_');
}

function decodeDataUrl(u) {
  const comma = u.indexOf(',');
  if (comma < 0) return '';
  const meta = u.slice(5, comma);
  const data = u.slice(comma + 1);
  if (/;base64/i.test(meta)) return Buffer.from(data, 'base64').toString('utf8');
  return decodeURIComponent(data);
}

export function writeExtensions(projectJson, outDir, { verbose = false } = {}) {
  const exts = projectJson.extensions || [];
  const urls = projectJson.extensionURLs || {};
  if (!exts.length) return { count: 0 };

  const dir = path.join(outDir, 'extensions');
  fs.mkdirSync(dir, { recursive: true });

  const index = [];
  for (const id of exts) {
    const url = urls[id] || null;
    const safe = sanitize(id);
    let file = null;
    let kind = 'builtin';
    if (url && url.startsWith('data:')) {
      file = `${safe}.js`;
      fs.writeFileSync(path.join(dir, file), decodeDataUrl(url));
      kind = 'data';
    } else if (url) {
      file = `${safe}.url`;
      fs.writeFileSync(path.join(dir, file), url);
      kind = 'url';
    }
    index.push(kind === 'url' ? { id, kind, file, url } : { id, kind, file });
    if (verbose) console.log(`[ext] ${id} ${kind}`);
  }

  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index, null, 2));
  return { count: exts.length };
}
