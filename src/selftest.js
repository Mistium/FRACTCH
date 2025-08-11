import AdmZip from 'adm-zip';
import { execSync } from 'child_process';

function assert(cond, msg) {
  if (!cond) {
    console.error(msg);
    process.exit(1);
  }
}

console.log('Selftest: build -> pack:lossless -> pack');

execSync('npm run build', { stdio: 'inherit' });

execSync('npm run pack:lossless', { stdio: 'inherit' });
const originText = new AdmZip('originv6.0.0.sb3').readAsText('project.json');
const repackedLosslessText = new AdmZip('repacked.sb3').readAsText('project.json');
assert(originText === repackedLosslessText, 'Lossless repack project.json mismatch');
console.log('✓ Lossless identical');

execSync('npm run pack', { stdio: 'inherit' });
const repackedDslText = new AdmZip('repacked.sb3').readAsText('project.json');
const a = JSON.parse(originText);
const b = JSON.parse(repackedDslText);
assert(JSON.stringify(Object.keys(a)) === JSON.stringify(Object.keys(b)), 'Top-level keys mismatch');
assert(
  Array.isArray(a.targets) && Array.isArray(b.targets) && a.targets.length === b.targets.length,
  'Targets length mismatch'
);
console.log('✓ DSL pack structural check');

console.log('Selftest complete');
