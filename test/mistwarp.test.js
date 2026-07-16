import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseFractch } from '../src/parse.js';
import { buildBlocksFromCalls } from '../src/buildBlocks.js';
import { stringifyBlockCall } from '../src/stringify.js';
import { buildProjectFromBuildDir } from '../src/pack.js';

const build = (source) => {
  const parsed = parseFractch(source);
  assert.deepStrictEqual(parsed.errors, []);
  return buildBlocksFromCalls(parsed.calls);
};

test('MistWarp JavaScript patching syntax builds each block shape', () => {
  const command = build('js "console.log(1)";');
  assert.strictEqual(command.blocks[command.topId].opcode, 'patching_jscommand');
  assert.strictEqual(command.blocks[command.topId].mutation.itemcount, '1');
  assert.strictEqual(stringifyBlockCall(command.blocks[command.topId], command.blocks, command.topId), 'js "console.log(1)";');

  const reporter = build('looks.say(MESSAGE: js("return 1"));');
  assert.ok(Object.values(reporter.blocks).some((block) => block.opcode === 'patching_jsreporter'));
  assert.strictEqual(stringifyBlockCall(reporter.blocks[reporter.topId], reporter.blocks, reporter.topId), 'say js("return 1");');

  const boolean = build('if js.bool("return true") { show; }');
  assert.ok(Object.values(boolean.blocks).some((block) => block.opcode === 'patching_jsboolean'));
  assert.match(stringifyBlockCall(boolean.blocks[boolean.topId], boolean.blocks, boolean.topId), /^if js\.bool\("return true"\)/);
});

test('MistWarp operator additions and variadic mutations round-trip', () => {
  for (const [source, opcode, count] of [
    ['looks.say(MESSAGE: min(1, 2, 3));', 'operator_min', '3'],
    ['looks.say(MESSAGE: max(1, 2, 3));', 'operator_max', '3'],
    ['looks.say(MESSAGE: clamp(5, 1, 10));', 'operator_clamp', null],
  ]) {
    const built = build(source);
    const block = Object.values(built.blocks).find((candidate) => candidate.opcode === opcode);
    assert.ok(block);
    if (count) assert.strictEqual(block.mutation.itemcount, count);
  }
});

test('file structure survives editor block ID regeneration', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fractch-routing-'));
  try {
    fs.mkdirSync(path.join(dir, 'Stage', 'systems'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'Stage', 'main.fractch'), 'when flag {\n  show;\n}\n');
    fs.writeFileSync(path.join(dir, 'Stage', 'systems', 'ui.fractch'), 'when clicked {\n  hide;\n}\n');
    const { manifest } = await buildProjectFromBuildDir({ buildDir: dir, fs, prune: false });
    const target = manifest.targets.find((item) => item.isStage);
    const marker = Object.values(target.comments).find((comment) => String(comment.text).includes('fractch:file'));
    const markerHat = target.blocks[marker.blockId];
    assert.strictEqual(marker.x, markerHat.x + 250);
    assert.strictEqual(marker.y, markerHat.y);
    const ids = Object.keys(target.blocks);
    const renamed = new Map(ids.map((id, i) => [id, `editor-${i}`]));
    target.blocks = Object.fromEntries(ids.map((id) => {
      const block = structuredClone(target.blocks[id]);
      if (renamed.has(block.next)) block.next = renamed.get(block.next);
      if (renamed.has(block.parent)) block.parent = renamed.get(block.parent);
      for (const tuple of Object.values(block.inputs || {})) {
        if (!Array.isArray(tuple)) continue;
        for (let i = 1; i < tuple.length; i++) if (renamed.has(tuple[i])) tuple[i] = renamed.get(tuple[i]);
      }
      return [renamed.get(id), block];
    }));
    for (const comment of Object.values(target.comments || {})) {
      if (renamed.has(comment.blockId)) comment.blockId = renamed.get(comment.blockId);
    }
    const out = path.join(dir, 'out');
    const { convertProject } = await import('../src/convert.js');
    await convertProject(manifest, { outDir: out, fs });
    assert.ok(fs.existsSync(path.join(out, 'Stage', 'systems', 'ui.fractch')));
    assert.match(fs.readFileSync(path.join(out, 'Stage', 'systems', 'ui.fractch'), 'utf8'), /when clicked/);
    assert.doesNotMatch(fs.readFileSync(path.join(out, 'Stage', 'systems', 'ui.fractch'), 'utf8'), /fractch:file/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('packed project omits redundant block id properties', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fractch-small-'));
  try {
    fs.mkdirSync(path.join(dir, 'Stage'));
    fs.writeFileSync(path.join(dir, 'Stage', 'main.fractch'), 'when flag {\n  show;\n}\n');
    const { manifest } = await buildProjectFromBuildDir({ buildDir: dir, fs, prune: false });
    const blocks = Object.values(manifest.targets[0].blocks);
    assert.ok(blocks.length > 0);
    assert.ok(blocks.every((block) => !Object.hasOwn(block, 'id')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
