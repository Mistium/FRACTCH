import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { convertProject } from '../src/convert.js';
import { buildProjectFromBuildDir } from '../src/pack.js';
import { emitTarget, buildTarget } from '../src/target.js';
import { isMembershipComment, isReservedComment } from '../src/membership.js';
import { liveContext, sortedJson } from './helpers/live-context.js';

const corpusDir = process.env.FRACTCH_CORPUS || path.join(os.homedir(), 'Downloads');
const limit = Number(process.env.FRACTCH_CORPUS_LIMIT ?? 20);
const maxBytes = process.env.FRACTCH_CORPUS_LIMIT ? Infinity : 3e6;

function corpusFiles() {
  if (!fs.existsSync(corpusDir)) return [];
  const files = fs
    .readdirSync(corpusDir)
    .filter((f) => f.endsWith('.sb3'))
    .map((f) => path.join(corpusDir, f))
    .filter((f) => fs.statSync(f).size <= maxBytes)
    .sort((a, b) => fs.statSync(a).size - fs.statSync(b).size);
  if (limit <= 0 || files.length <= limit) return files;
  return Array.from({ length: limit }, (_, i) => files[Math.round((i * (files.length - 1)) / (limit - 1))]);
}

function readProject(file) {
  try {
    return JSON.parse(new AdmZip(file).readAsText('project.json'));
  } catch {
    return null;
  }
}

function textFiles(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.fractch')) out[path.relative(dir, p)] = fs.readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return out;
}

const files = corpusFiles();
const tablePath =
  process.env.FRACTCH_VM_OPCODES ||
  path.join(os.homedir(), 'mistwarp', 'scratch-vm', 'src', 'engine', 'opcodes.generated.json');
const opcodes = fs.existsSync(tablePath) ? JSON.parse(fs.readFileSync(tablePath, 'utf8')) : null;
let totalScripts = 0;
let totalLocked = 0;

for (const file of files) {
  const project = readProject(file);
  if (!project) continue;
  const name = path.basename(file);

  test(`corpus fixed point: ${name}`, async (t) => {
    const dirs = [1, 2, 3].map(() => fs.mkdtempSync(path.join(os.tmpdir(), 'fractch-fixed-')));
    t.after(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
    const before = JSON.stringify(project);
    await convertProject(project, { outDir: dirs[0], fs });
    assert.equal(JSON.stringify(project), before, 'convertProject mutated its input');
    const { manifest: first } = await buildProjectFromBuildDir({ buildDir: dirs[0], fs, prune: false });
    await convertProject(first, { outDir: dirs[1], fs });
    const { manifest: second } = await buildProjectFromBuildDir({ buildDir: dirs[1], fs, prune: false });
    assert.deepEqual(
      second.targets.map((x) => x.blocks),
      first.targets.map((x) => x.blocks),
      'blocks changed after reaching the canonical representation'
    );
    await convertProject(second, { outDir: dirs[2], fs });
    assert.deepEqual(textFiles(dirs[2]), textFiles(dirs[1]), 'text changed after reaching the canonical form');
  });

  test(`corpus identity through emitTarget and buildTarget: ${name}`, () => {
    const ctx = liveContext(project);
    for (const target of ctx.targets) {
      const emitted = emitTarget(ctx, target.id, { opcodes });
      const built = buildTarget(ctx, target.id, emitted.text, {
        previous: emitted,
        lockedScripts: emitted.lockedScripts,
        opcodes,
      });
      const where = `${name} / ${target.name}`;
      assert.deepEqual(
        built.diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.code} ${d.message} @${d.line}`),
        [],
        where
      );
      assert.deepEqual(built.removed.scripts, [], `${where}: scripts removed`);
      assert.deepEqual(built.created.scripts, [], `${where}: scripts created`);
      assert.deepEqual(built.changed, [], `${where}: scripts changed`);
      assert.deepEqual(sortedJson(built.target.blocks), sortedJson(target.blocks), `${where}: blocks`);
      assert.deepEqual(sortedJson(built.target.variables), sortedJson(target.variables), `${where}: variables`);
      assert.deepEqual(sortedJson(built.target.lists), sortedJson(target.lists), `${where}: lists`);
      assert.deepEqual(sortedJson(built.primitiveIds), sortedJson(target.primitiveIds), `${where}: primitive ids`);
      assert.deepEqual(sortedJson(built.obscuredShadows), sortedJson(target.obscuredShadows), `${where}: obscured`);
      const committed = { ...built.target.comments };
      for (const [id, c] of Object.entries(target.comments || {})) if (isReservedComment(c, target)) committed[id] = c;
      const gained = Object.keys(committed).filter((id) => !(id in (target.comments || {})));
      for (const id of gained) assert.ok(isMembershipComment(committed[id]), `${where}: unexpected comment ${id}`);
      for (const id of gained) delete committed[id];
      assert.deepEqual(sortedJson(committed), sortedJson(target.comments || {}), `${where}: comments`);
      totalScripts += Object.keys(emitted.sourceMap.scripts).length;
      totalLocked += emitted.lockedScripts.length;
    }
  });
}

test('corpus identity locked-script count', (t) => {
  t.diagnostic(`${files.length} projects, ${totalScripts} scripts, ${totalLocked} locked`);
  assert.ok(totalLocked <= Math.max(1, totalScripts * 0.05), `${totalLocked} of ${totalScripts} scripts locked`);
});
