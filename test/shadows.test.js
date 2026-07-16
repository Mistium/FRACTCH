import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildBlocksFromCalls } from '../src/buildBlocks.js';
import { parseFractch } from '../src/parse.js';
import { convertProject } from '../src/convert.js';
import { checkProject } from '../src/check.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fractch-shadow-'));

const minimalProject = (blocks) => ({
  targets: [
    {
      isStage: true,
      name: 'Stage',
      blocks: {},
      variables: {},
      lists: {},
      broadcasts: {},
      comments: {},
      costumes: [],
      sounds: [],
    },
    {
      isStage: false,
      name: 'main',
      blocks,
      variables: {},
      lists: {},
      broadcasts: {},
      comments: {},
      costumes: [],
      sounds: [],
    },
  ],
  monitors: [],
  extensions: [],
  meta: {},
});

test('convert drops floating shadows instead of emitting them as scripts', async () => {
  const outDir = tmp();
  const blocks = {
    hat: {
      opcode: 'event_whenflagclicked',
      next: 'move',
      parent: null,
      inputs: {},
      fields: {},
      topLevel: true,
      x: 0,
      y: 0,
    },
    move: {
      opcode: 'motion_movesteps',
      next: null,
      parent: 'hat',
      inputs: { STEPS: [3, 'plugged', 'obscured'] },
      fields: {},
    },
    plugged: {
      opcode: 'operator_add',
      next: null,
      parent: 'move',
      inputs: { NUM1: [1, [4, '1']], NUM2: [1, [4, '2']] },
      fields: {},
    },
    obscured: {
      opcode: 'math_number',
      next: null,
      parent: 'move',
      inputs: {},
      fields: { NUM: ['10', null] },
      shadow: true,
    },
    floating: {
      opcode: 'math_number',
      next: null,
      parent: null,
      inputs: {},
      fields: { NUM: ['42', null] },
      shadow: true,
      topLevel: true,
      x: 5,
      y: 5,
    },
    orphanMenu: {
      opcode: 'sensing_keyoptions',
      next: null,
      parent: null,
      inputs: {},
      fields: { KEY_OPTION: ['space', null] },
      shadow: true,
    },
  };
  await convertProject(minimalProject(blocks), { outDir, fs });

  const text = fs.readFileSync(path.join(outDir, 'main', 'main.fractch'), 'utf8');
  assert.ok(text.includes('when flag'), 'real script survives');
  assert.ok(!text.includes('42'), 'floating topLevel shadow is not emitted');
  assert.ok(!/^\s*script\b[\s\S]*keyoptions/m.test(text), 'orphan menu shadow is not emitted as a script');
});

test('pack never marks a top-level block as a shadow', () => {
  const { blocks, topId } = buildBlocksFromCalls(parseFractch('sensing.keyoptions("space");\n').calls);
  assert.strictEqual(blocks[topId].topLevel, true);
  assert.notStrictEqual(blocks[topId].shadow, true);
});

test('check reports unknown builtin opcodes and menus at statement position', async () => {
  const buildDir = tmp();
  fs.mkdirSync(path.join(buildDir, 'main'));
  fs.writeFileSync(
    path.join(buildDir, 'main', 'main.fractch'),
    [
      'when flag at 0,0 {',
      '  looks.sayy("hi");',
      '  sensing.keyoptions("space");',
      '  if sensing.keypressed(sensing.keyoptions("space")) {',
      '    say "ok";',
      '  }',
      '}',
      '',
    ].join('\n')
  );

  const { problems } = await checkProject({ buildDir, fs });
  const messages = problems.map((p) => `${p.line}: ${p.message}`);
  assert.ok(
    messages.some((m) => m.startsWith('2:') && m.includes("unknown block 'looks.sayy'") && m.includes('looks.say')),
    `typo flagged with suggestion: ${messages}`
  );
  assert.ok(
    messages.some((m) => m.startsWith('3:') && m.includes('dropdown menu')),
    `statement menu flagged: ${messages}`
  );
  assert.strictEqual(problems.length, 2, `nested menu use stays legal: ${messages}`);
});
