import AdmZip from 'adm-zip';
import { execSync } from 'child_process';

function assert(cond, msg) {
  if (!cond) {
    console.error(msg);
    process.exit(1);
  }
}

console.log('Selftest: build -> pack (pure DSL round trip, no JSON snapshot involved)');

import os from 'os';
import fs from 'fs';
import path from 'path';

const origin = [
  process.env.FRACTCH_ORIGIN,
  path.join(os.homedir(), 'origin-fractch', 'originv619.sb3'),
  'originv6.0.0.sb3',
]
  .filter(Boolean)
  .map((c) => path.resolve(c))
  .find((c) => fs.existsSync(c));
if (!origin) {
  console.error('no origin sb3 found - set FRACTCH_ORIGIN');
  process.exit(1);
}
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'fractch-selftest-'));
const buildDir = path.join(work, 'build');
const repacked = path.join(work, 'repacked.sb3');
execSync(`node ./bin/cli.js --input "${origin}" --out "${buildDir}"`, { stdio: 'inherit' });
execSync(`node ./bin/cli.js --pack --out "${buildDir}" --outSb3 "${repacked}" --origin "${origin}"`, {
  stdio: 'inherit',
});
const originProject = JSON.parse(new AdmZip(origin).readAsText('project.json'));
const repackedProject = JSON.parse(new AdmZip(repacked).readAsText('project.json'));

assert(
  JSON.stringify(Object.keys(originProject).sort()) === JSON.stringify(Object.keys(repackedProject).sort()),
  'Top-level keys mismatch'
);
assert(
  Array.isArray(originProject.targets) &&
    Array.isArray(repackedProject.targets) &&
    originProject.targets.length === repackedProject.targets.length,
  'Targets length mismatch'
);

for (let i = 0; i < originProject.targets.length; i++) {
  const ot = originProject.targets[i];
  const rt = repackedProject.targets.find((t) => t.name === ot.name);
  assert(rt, `Target ${ot.name} missing from repack`);
  const origCount = Object.keys(ot.blocks || {}).length;
  const repackCount = Object.keys(rt.blocks || {}).length;

  const ratio = origCount === 0 ? 1 : repackCount / origCount;
  assert(ratio > 0.95, `Target ${ot.name}: block count dropped too far (${origCount} -> ${repackCount})`);
  console.log(`  ${ot.name}: ${origCount} -> ${repackCount} blocks`);
}

console.log('✓ DSL-only round trip reconstructs all targets with no significant block loss');
console.log('Selftest complete');
