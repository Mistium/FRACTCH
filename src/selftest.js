import AdmZip from 'adm-zip';
import { execSync } from 'child_process';

function assert(cond, msg) {
  if (!cond) {
    console.error(msg);
    process.exit(1);
  }
}

console.log('Selftest: build -> pack (pure DSL round trip, no JSON snapshot involved)');

execSync('npm run build', { stdio: 'inherit' });
execSync('npm run pack', { stdio: 'inherit' });
const originProject = JSON.parse(new AdmZip('originv6.0.0.sb3').readAsText('project.json'));
const repackedProject = JSON.parse(new AdmZip('repacked.sb3').readAsText('project.json'));

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
  // Parsing from pure text can't always distinguish every representational
  // nuance (e.g. Scratch itself can encode "read variable X" as either a
  // real data_variable block or an inline literal - both execute
  // identically). This bounds against wholesale data loss, not byte-exact
  // reconstruction; see scripts/_verify_dsl_roundtrip style deep checks for
  // full structural comparison.
  const ratio = origCount === 0 ? 1 : repackCount / origCount;
  assert(
    ratio > 0.95,
    `Target ${ot.name}: block count dropped too far (${origCount} -> ${repackCount})`
  );
  console.log(`  ${ot.name}: ${origCount} -> ${repackCount} blocks`);
}

console.log('✓ DSL-only round trip reconstructs all targets with no significant block loss');
console.log('Selftest complete');
