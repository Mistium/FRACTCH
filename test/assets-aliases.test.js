import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseFractch } from '../src/parse.js';
import { buildBlocksFromCalls } from '../src/buildBlocks.js';
import { stringifyBlockCall } from '../src/stringify.js';
import { emitTarget, buildTarget } from '../src/target.js';
import { liveContext } from './helpers/live-context.js';
import { packFiles } from './helpers/project.js';

const build = (source) => {
  const parsed = parseFractch(source);
  assert.deepEqual(parsed.errors, []);
  return buildBlocksFromCalls(parsed.calls);
};

const strip = (blocks) =>
  Object.values(blocks)
    .filter((b) => b.opcode !== 'event_whenflagclicked')
    .map((b) => ({
      opcode: b.opcode,
      shadow: !!b.shadow,
      fields: Object.fromEntries(Object.entries(b.fields || {}).map(([k, v]) => [k, v[0]])),
      inputs: Object.fromEntries(
        Object.entries(b.inputs || {}).map(([k, v]) => [
          k,
          v.map((x) => (typeof x === 'string' ? blocks[x].opcode : x)),
        ])
      ),
    }));

test('assets calls take positional arguments with menu shadows and default fields', () => {
  const { blocks } = build('assets.set("data/level1.txt", "hi");');
  assert.deepEqual(strip(blocks), [
    { opcode: 'assets_menu', shadow: true, fields: { ASSET: 'data/level1.txt' }, inputs: {} },
    {
      opcode: 'assets_set',
      shadow: false,
      fields: { FORMAT: 'text' },
      inputs: { ASSET: [1, 'assets_menu'], VALUE: [1, [10, 'hi']] },
    },
  ]);
  const get = build('say assets.get("a.txt", "size");').blocks;
  const reporter = Object.values(get).find((b) => b.opcode === 'assets_get');
  assert.deepEqual(reporter.fields, { PROPERTY: ['size'] });
  assert.equal(get[reporter.inputs.ASSET[1]].opcode, 'assets_menu');
});

test('editor-shaped assets blocks emit the short form and build back the same blocks', () => {
  const blocks = {
    g: {
      opcode: 'assets_get',
      next: null,
      parent: null,
      inputs: { ASSET: [1, 'm'] },
      fields: { PROPERTY: ['text', null] },
      shadow: false,
      topLevel: true,
    },
    m: {
      opcode: 'assets_menu',
      next: null,
      parent: 'g',
      inputs: {},
      fields: { ASSET: ['data/level1.txt', null] },
      shadow: true,
      topLevel: false,
    },
    b: {
      opcode: 'assets_byte',
      next: null,
      parent: null,
      inputs: { INDEX: [1, [4, '2']], ASSET: [3, 'j', 'n'] },
      fields: {},
      shadow: false,
      topLevel: true,
    },
    j: {
      opcode: 'assets_allnames',
      next: null,
      parent: 'b',
      inputs: {},
      fields: {},
      shadow: false,
      topLevel: false,
    },
    n: {
      opcode: 'assets_menu',
      next: null,
      parent: 'b',
      inputs: {},
      fields: { ASSET: ['x.bin', null] },
      shadow: true,
      topLevel: false,
    },
  };
  assert.equal(stringifyBlockCall(blocks.g, blocks, 'g', true), 'assets.get("data/level1.txt")');
  const byte = stringifyBlockCall(blocks.b, blocks, 'b', true);
  assert.equal(byte, 'assets.byte(assets.allnames(), 2)');
  const rebuilt = build(`say ${byte};`).blocks;
  const reporter = Object.values(rebuilt).find((b) => b.opcode === 'assets_byte');
  assert.equal(rebuilt[reporter.inputs.ASSET[1]].opcode, 'assets_allnames');
  assert.deepEqual(reporter.inputs.INDEX, [1, [4, '2']]);
});

test('the old keyed assets form still builds', () => {
  const { blocks } = build('say assets.get(ASSET: assets.menu("a.txt"), field PROPERTY: "url");');
  const reporter = Object.values(blocks).find((b) => b.opcode === 'assets_get');
  assert.deepEqual(reporter.fields, { PROPERTY: ['url'] });
  assert.equal(blocks[reporter.inputs.ASSET[1]].opcode, 'assets_menu');
});

test('assets aliases round-trip through emitTarget and buildTarget with the VM opcode table', async (t) => {
  const tablePath =
    process.env.FRACTCH_VM_OPCODES ||
    path.join(os.homedir(), 'mistwarp', 'scratch-vm', 'src', 'engine', 'opcodes.generated.json');
  const opcodes = fs.existsSync(tablePath) ? JSON.parse(fs.readFileSync(tablePath, 'utf8')) : undefined;
  const source = [
    'when flag at 0,0 {',
    '  assets.set("b.txt", "hi", "base64");',
    '  say assets.get("data/a.txt");',
    '  say assets.infolder("data");',
    '  assets.load("p.png", "sound");',
    '  if assets.check("p.png", "is loaded") {',
    '    assets.unloadall();',
    '  }',
    '  assets.delete("p.png");',
    '}',
    '',
  ].join('\n');
  const ctx = liveContext(await packFiles({ 'Stage/main.fractch': source }));
  const stage = ctx.targets[0];
  const emitted = emitTarget(ctx, stage.id, { opcodes });
  assert.equal(emitted.text.trim(), source.trim());
  const built = buildTarget(ctx, stage.id, emitted.text, { previous: emitted, opcodes, verifyRoundTrip: true });
  assert.deepEqual(
    built.diagnostics.filter((d) => d.severity === 'error'),
    []
  );
  if (!opcodes) t.diagnostic('scratch-vm opcode table not found');
});
