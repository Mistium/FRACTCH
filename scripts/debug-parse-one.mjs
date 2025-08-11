import { parseFractch, preprocess } from '../src/parse.js';
import fs from 'fs';
const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/debug-parse-one.mjs <file>');
  process.exit(2);
}
const s = fs.readFileSync(file, 'utf8');
try {
  parseFractch(s);
  console.log('OK');
} catch (e) {
  console.error('ERR:', e.message);
  const pre = preprocess(s);
  // extract around position from message if present
  const m = /at (\d+)/.exec(e.message || '');
  if (m) {
    const pos = Number(m[1]);
    console.log('Context around', pos);
    console.log(pre.slice(Math.max(0, pos - 120), pos + 120).replace(/\n/g, '\n'));
  } else {
    console.log(pre);
  }
}
