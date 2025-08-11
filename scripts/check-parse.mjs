import { parseFractch } from '../src/parse.js';
import fs from 'fs';
import path from 'path';

const root = path.resolve('./build');
if (!fs.existsSync(root)) {
  console.error('build folder not found at', root);
  process.exit(2);
}

/** Recursively collect all .fractch files under a directory */
function* walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile() && p.endsWith('.fractch')) yield p;
  }
}

const files = Array.from(walk(root));
const errors = [];
for (const p of files) {
  const s = fs.readFileSync(p, 'utf8');
  try {
    parseFractch(s);
  } catch (e) {
    errors.push({ file: p, error: e?.message || String(e) });
  }
}
console.log('Total .fractch files:', files.length);
console.log('Parse failures:', errors.length);
if (errors.length) {
  for (const { file, error } of errors.slice(0, 20)) {
    console.log('-', file, '\n ', error);
  }
}
process.exit(errors.length ? 1 : 0);
