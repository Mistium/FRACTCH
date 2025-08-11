import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir)) {
    const p = path.join(dir, e);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (e.endsWith('.fractch')) out.push(p);
  }
  return out;
}

function parseHeader(text) {
  const s = String(text || '');
  const headStart = s.indexOf('/**');
  const headEnd = s.indexOf('*/', headStart + 3);
  const head = headStart >= 0 && headEnd > headStart ? s.slice(headStart, headEnd) : s;
  const lines = head.split(/\r?\n/);
  const map = new Map();
  for (const line of lines) {
    const m = /\*\s*([^:]+):\s*(.*)$/.exec(line.trim());
    if (m) map.set(m[1].trim(), m[2].trim());
  }
  return { dslBodyHash: map.get('dslBodyHash') || null };
}

function extractBody(text) {
  const s = String(text || '');
  let body = s;
  if (s.startsWith('/**')) {
    const end = s.indexOf('*/');
    if (end >= 0) body = s.slice(end + 2);
  }
  const lines = body.split(/\r?\n/);
  const kept = [];
  for (const line of lines) {
    const trimmed = line.replace(/^\s+/, '');
    if (trimmed.startsWith('import ')) continue;
    kept.push(line);
  }
  let start = 0;
  while (start < kept.length && kept[start].trim() === '') start++;
  let end = kept.length - 1;
  while (end >= start && kept[end].trim() === '') end--;
  const slice = kept.slice(start, end + 1);
  return slice.join('\n');
}

const buildDir = path.resolve('./build');
const files = walk(buildDir);
let withHash = 0,
  matches = 0,
  missing = 0,
  mismatches = [];
for (const f of files) {
  const content = fs.readFileSync(f, 'utf8');
  const { dslBodyHash } = parseHeader(content);
  if (!dslBodyHash) {
    missing++;
    continue;
  }
  withHash++;
  const body = extractBody(content);
  const cur = crypto.createHash('sha256').update(body, 'utf8').digest('hex');
  if (cur === dslBodyHash) matches++;
  else mismatches.push({ f, dslBodyHash, cur });
}
console.log(
  JSON.stringify(
    {
      total: files.length,
      withHash,
      missing,
      matches,
      mismatches: mismatches.slice(0, 25),
    },
    null,
    2
  )
);
