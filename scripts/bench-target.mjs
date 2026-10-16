import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { emitTarget, buildTarget } from '../src/target.js';
import { liveContext } from '../test/helpers/live-context.js';

const file = process.argv[2] || path.join(os.homedir(), 'collected_sb3', 'Versions', 'originv5.6.2.sb3');
const runs = Number(process.argv[3] || 5);
const project = JSON.parse(new AdmZip(fs.readFileSync(file)).readAsText('project.json'));
const ctx = liveContext(project);

const time = (fn) => {
  const samples = [];
  let value;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    value = fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return { ms: samples[Math.floor(samples.length / 2)], value };
};

const bySize = ctx.targets.map((t) => ({ t, n: Object.keys(t.blocks).length })).sort((a, b) => b.n - a.n);
const picks = [bySize[0]];
const near2000 = bySize.reduce((best, x) => (Math.abs(x.n - 2000) < Math.abs(best.n - 2000) ? x : best));
if (near2000 !== bySize[0]) picks.push(near2000);

for (const { t, n } of picks) {
  const plain = time(() => emitTarget(ctx, t.id, { lockCheck: false }));
  const locked = time(() => emitTarget(ctx, t.id));
  const emitted = locked.value;
  const lockedIds = new Set(emitted.lockedScripts.map((l) => l.topId));
  const scripts = Object.entries(emitted.sourceMap.scripts)
    .filter(([id, r]) => !lockedIds.has(id) && /^(when|def) /.test(emitted.text.slice(r.from, r.from + 5)))
    .sort((a, b) => b[1].to - b[1].from - (a[1].to - a[1].from));
  if (!scripts.length) continue;
  const [, range] = scripts[Math.floor(scripts.length / 2)];
  const scriptText = emitted.text.slice(range.from, range.to);
  const editedScript = scriptText.replace(/\n\}$/, '\n  wait 0;\n}');
  const edited = emitted.text.slice(0, range.from) + editedScript + emitted.text.slice(range.to);
  const opts = { previous: emitted, lockedScripts: emitted.lockedScripts };
  const noEdit = time(() => buildTarget(ctx, t.id, emitted.text, opts));
  const oneEdit = time(() => buildTarget(ctx, t.id, edited, opts));
  const roundTrip = time(() => buildTarget(ctx, t.id, edited, { ...opts, verifyRoundTrip: true }));
  const errors = oneEdit.value.diagnostics.filter((d) => d.severity === 'error').length;
  console.log(
    `${t.name}: ${n} blocks, ${Object.keys(emitted.sourceMap.scripts).length} scripts, ${emitted.lockedScripts.length} locked, ${emitted.text.length} chars`
  );
  console.log(`  emitTarget (no lock check)        ${plain.ms.toFixed(1)} ms`);
  console.log(`  emitTarget + step 0 lock check    ${locked.ms.toFixed(1)} ms`);
  console.log(`  buildTarget, no edit              ${noEdit.ms.toFixed(1)} ms`);
  console.log(
    `  buildTarget, one script edited    ${oneEdit.ms.toFixed(1)} ms (changed ${oneEdit.value.changed.length}, errors ${errors})`
  );
  console.log(`  buildTarget + step 4 round trip   ${roundTrip.ms.toFixed(1)} ms`);
}
