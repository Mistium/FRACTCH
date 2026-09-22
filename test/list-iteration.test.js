import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { buildProjectFromBuildDir } from '../src/pack.js';
import { convertProject } from '../src/convert.js';
import { unpackSb3 } from '../src/index.js';
import { verifyRoundtrip } from '../src/roundtripDiff.js';

test('the order fulfilment SB3 emits readable list traversal and preserves every block', async (t) => {
  const sb3 = path.resolve('examples/order-fulfilment.sb3');
  const project = JSON.parse(new AdmZip(sb3).readAsText('project.json'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'fractch-orders-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));

  await unpackSb3({ input: sb3, outDir: out });
  const source = fs.readFileSync(path.join(out, 'Stage', 'main.fractch'), 'utf8');
  assert.match(source, /for order in orders using position \{/);
  assert.match(source, /for order in ready \{/);
  assert.match(source, /\/\/ Example: for order in orders/);

  const roundtrip = await verifyRoundtrip({ project, buildDir: out, fs });
  assert.deepEqual(roundtrip.failures, []);
  assert.equal(roundtrip.ok, roundtrip.total);
});

test('list traversal and scalar counting compile to distinct loops', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fractch-for-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stage = path.join(root, 'Stage');
  fs.mkdirSync(stage);
  fs.writeFileSync(
    path.join(stage, 'main.fractch'),
    'var items = ["a", "b"]; var count = 2;\n' +
      'when flag { for value in items { say value; } for i in count { say i; } }\n'
  );

  const { manifest } = await buildProjectFromBuildDir({ buildDir: root, fs, prune: false });
  const blocks = Object.values(manifest.targets.find((target) => target.isStage).blocks);
  assert.equal(blocks.filter((block) => block.opcode === 'data_itemoflist').length, 1);
  assert.equal(blocks.filter((block) => block.opcode === 'control_for_each').length, 2);

  const out = path.join(root, 'converted');
  await convertProject(manifest, { outDir: out, fs });
  const source = fs.readFileSync(path.join(out, 'Stage', 'main.fractch'), 'utf8');
  assert.match(source, /for value in items \{/);
  assert.match(source, /for i in count \{/);
  const roundtrip = await verifyRoundtrip({ project: manifest, buildDir: out, fs });
  assert.deepEqual(roundtrip.failures, []);
});

test('an iteration value may share its display name with the list', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fractch-for-name-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stage = path.join(root, 'Stage');
  fs.mkdirSync(stage);
  fs.writeFileSync(
    path.join(stage, 'main.fractch'),
    'var entries = ["one"]; when flag { for entries in entries { say entries; } }'
  );
  const { manifest } = await buildProjectFromBuildDir({ buildDir: root, fs, prune: false });
  const target = manifest.targets.find((entry) => entry.isStage);
  assert.ok(Object.values(target.variables).some((entry) => entry[0] === 'entries'));
  assert.ok(Object.values(target.lists).some((entry) => entry[0] === 'entries'));
  const say = Object.values(target.blocks).find((block) => block.opcode === 'looks_say');
  assert.equal(say.inputs.MESSAGE[1][0], 12, 'the body reads the iteration variable');
  const out = path.join(root, 'converted');
  await convertProject(manifest, { outDir: out, fs });
  const roundtrip = await verifyRoundtrip({ project: manifest, buildDir: out, fs });
  assert.deepEqual(roundtrip.failures, []);
});
