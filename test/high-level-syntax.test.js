import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildProjectFromBuildDir } from '../src/pack.js';
import { convertProject } from '../src/convert.js';
import { verifyRoundtrip } from '../src/roundtripDiff.js';
import { parseFractch } from '../src/parse.js';
import { buildBlocksFromCalls, IdGen } from '../src/buildBlocks.js';
import { stringifyBlockCall } from '../src/stringify.js';

test('multi-block abstractions retain Scratch-style command names', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fractch-abstractions-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'Stage'));
  fs.writeFileSync(
    path.join(root, 'Stage', 'main.fractch'),
    `var items = ["alpha", "beta"];
when flag {
  for value in items using index { say \`\${index}: \${value}\`; }
  every 0.03 seconds { move 1; broadcast tick; }
  if !mouseDown() { costume "idle"; }
  say \`first: \${items.length}\`;
}
when broadcast tick { say "done"; }
`
  );

  const { manifest } = await buildProjectFromBuildDir({ buildDir: root, fs, prune: false });
  const blocks = Object.values(manifest.targets.find((target) => target.isStage).blocks);
  for (const opcode of [
    'control_for_each',
    'data_itemoflist',
    'data_lengthoflist',
    'control_forever',
    'control_wait',
    'operator_join',
  ]) {
    assert.ok(
      blocks.some((block) => block.opcode === opcode),
      `missing ${opcode}`
    );
  }

  const out = path.join(root, 'generated');
  await convertProject(manifest, { outDir: out, fs });
  const generated = fs.readFileSync(path.join(out, 'Stage', 'main.fractch'), 'utf8');
  for (const snippet of [
    'when flag',
    'when broadcast tick',
    'for value in items using index',
    'every 0.03 seconds',
    'move 1;',
    'broadcast tick;',
    'if !mouseDown()',
    'costume "idle";',
    '`first: ${items.length}`',
  ])
    assert.ok(generated.includes(snippet), `missing ${snippet}`);
  assert.doesNotMatch(generated, /\bon flag\b|\bemit\b|self\.|stage\.|sound\.play/);

  const roundtrip = await verifyRoundtrip({ project: manifest, buildDir: out, fs });
  assert.deepEqual(roundtrip.failures, []);
  assert.equal(roundtrip.ok, roundtrip.total);
});

test('templates keep the exact join tree, including an expression at the start', () => {
  for (const [source, expected] of [
    ['say value ++ "°" ++ unit;', 'say `${value}°${unit}`;'],
    ['say "a" ++ "b";', 'say "a" ++ "b";'],
    ['say "" ++ value;', 'say "" ++ value;'],
    ['say value ++ "";', 'say value ++ "";'],
  ]) {
    const parsed = parseFractch(source);
    assert.deepEqual(parsed.errors, []);
    const { blocks, topId } = buildBlocksFromCalls(parsed.calls, { idGen: new IdGen() });
    assert.equal(stringifyBlockCall(blocks[topId], blocks, topId), expected);
  }
});

test('a zero-second wait remains visible inside forever', () => {
  const parsed = parseFractch('forever { wait 0; nextCostume; }');
  assert.deepEqual(parsed.errors, []);
  const { blocks, topId } = buildBlocksFromCalls(parsed.calls, { idGen: new IdGen() });
  const generated = stringifyBlockCall(blocks[topId], blocks, topId);
  assert.match(generated, /^forever \{/);
  assert.match(generated, /wait 0;/);
});

test('character iteration expands to the original counter, length, and letter blocks', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fractch-chars-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'Stage'));
  fs.writeFileSync(
    path.join(root, 'Stage', 'main.fractch'),
    `
var message = "Hi";
var ch = 0;
var index = 0;
when flag {
  for ch of message { say ch; }
  for ch of message using index { say index; say ch; }
}
`
  );
  const { manifest } = await buildProjectFromBuildDir({ buildDir: root, fs, prune: false });
  const blocks = Object.values(manifest.targets[0].blocks);
  assert.equal(blocks.filter((block) => block.opcode === 'control_for_each').length, 2);
  assert.equal(blocks.filter((block) => block.opcode === 'operator_length').length, 2);
  assert.equal(blocks.filter((block) => block.opcode === 'operator_letter_of').length, 2);
  const out = path.join(root, 'generated');
  await convertProject(manifest, { outDir: out, fs });
  const generated = fs.readFileSync(path.join(out, 'Stage', 'main.fractch'), 'utf8');
  assert.match(generated, /for ch of message \{/);
  assert.match(generated, /for ch of message using index \{/);
  const roundtrip = await verifyRoundtrip({ project: manifest, buildDir: out, fs });
  assert.deepEqual(roundtrip.failures, []);
});

test('the earlier chars(...) spelling still parses and generates the of spelling', () => {
  const parsed = parseFractch('for ch in chars(message) { say ch; }');
  assert.deepEqual(parsed.errors, []);
  const { blocks, topId } = buildBlocksFromCalls(parsed.calls, { idGen: new IdGen() });
  assert.match(stringifyBlockCall(blocks[topId], blocks, topId), /^for ch of message \{/);
});

test('character iteration stays explicit when the length and letter receivers differ', () => {
  const parsed = parseFractch('for ch in length(message) { ch = other.letter(ch); say ch; }');
  assert.deepEqual(parsed.errors, []);
  const { blocks, topId } = buildBlocksFromCalls(parsed.calls, { idGen: new IdGen() });
  const generated = stringifyBlockCall(blocks[topId], blocks, topId);
  assert.match(generated, /^for ch in length\(message\) \{/);
  assert.match(generated, /ch = other\.letter\(ch\);/);
});

test('self-join assignment emits ++= and rebuilds the same Scratch blocks', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fractch-concat-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'Stage'));
  fs.writeFileSync(
    path.join(root, 'Stage', 'main.fractch'),
    `
var buffer = "";
var other = "";
var "odd name" = "";
when flag {
  local scratch = "";
  scratch ++= "x";
  buffer = buffer ++ " ";
  vars["odd name"] = vars["odd name"] ++ other;
  other = buffer ++ "x";
  buffer = buffer ++ "a" ++ other;
}
`
  );
  const { manifest } = await buildProjectFromBuildDir({ buildDir: root, fs, prune: false });
  const out = path.join(root, 'generated');
  await convertProject(manifest, { outDir: out, fs });
  const generated = fs.readFileSync(path.join(out, 'Stage', 'main.fractch'), 'utf8');
  assert.match(generated, /buffer \+\+= " ";/);
  assert.match(generated, /vars\["odd name"\] \+\+= other;/);
  assert.match(generated, /scratch \+\+= "x";/);
  assert.doesNotMatch(generated, /other \+\+=/);
  assert.equal((generated.match(/buffer \+\+=/g) || []).length, 1);
  const roundtrip = await verifyRoundtrip({ project: manifest, buildDir: out, fs });
  assert.deepEqual(roundtrip.failures, []);
});
