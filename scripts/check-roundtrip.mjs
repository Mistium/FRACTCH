// Deep structural round-trip check: for every generated .fractch file, parse
// it and rebuild its blocks, then walk the rebuilt tree against the true
// origin subgraph (matched by traversal position, not block id, since fresh
// ids are assigned on rebuild) reporting the first structural mismatch per
// file. This is what actually verifies DSL-only fidelity - unlike
// check-parse.mjs, which only checks that files parse without throwing.
//
// Usage: node scripts/check-roundtrip.mjs [originSb3] [buildDir]
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { verifyRoundtrip } from '../src/roundtripDiff.js';

const defaultOrigin = () => {
  for (const c of [process.env.FRACTCH_ORIGIN, path.join(process.env.HOME || '', 'origin-fractch', 'originv619.sb3'), './originv6.0.0.sb3']) {
    if (c && fs.existsSync(c)) return path.resolve(c);
  }
  return path.resolve('./originv6.0.0.sb3');
};
const originPath = process.argv[2] || defaultOrigin();
const buildDir = process.argv[3] || path.resolve('./build');

const project = JSON.parse(new AdmZip(originPath).readAsText('project.json'));
const { total, ok, failures } = await verifyRoundtrip({ project, buildDir, fs });

console.log(`total=${total} ok=${ok} fail=${failures.length}`);
for (const fl of failures.slice(0, 30)) {
  console.log('---', fl.file);
  console.log('   ', fl.err);
}
if (failures.length) process.exitCode = 1;
