import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { emitTarget, buildTarget } from '../src/target.js';
import { compareProjects, convertAndRebuild } from './helpers/fidelity.js';
import { liveContext } from './helpers/live-context.js';
import { flag, projectOf, spriteTarget, stageTarget, stmt } from './helpers/regressions.js';

const reporter = (opcode, parent, inputs = {}, fields = {}) => ({ ...stmt(opcode, parent, inputs, fields) });
const menuShadow = (opcode, parent, field, value) => ({
  ...stmt(opcode, parent, {}, { [field]: [value, null] }),
  shadow: true,
});
const sprite = (blocks, extra = {}) =>
  projectOf(
    stageTarget({}, { variables: { vx: ['x', 0] }, broadcasts: { bgo: 'go' } }),
    spriteTarget('S', blocks, extra)
  );

async function roundTrip(project) {
  const { manifest, texts } = await convertAndRebuild(project);
  assert.deepEqual(compareProjects(project, manifest), []);
  return { manifest, text: texts['S/main.fractch'], blocks: manifest.targets.find((t) => t.name === 'S').blocks };
}

const find = (blocks, opcode) => Object.values(blocks).find((b) => b.opcode === opcode);

test('a hidden text value under a reporter survives the round trip', async () => {
  const { text, blocks } = await roundTrip(
    sprite({
      hat: flag('say'),
      say: stmt('looks_say', 'hat', { MESSAGE: [3, 'answer', [10, 'Hello there']] }),
      answer: reporter('sensing_answer', 'say'),
    })
  );
  assert.match(text, /say \(answer\(\) \?\? "Hello there"\);/);
  assert.deepEqual(find(blocks, 'looks_say').inputs.MESSAGE.slice(2), [[10, 'Hello there']]);
});

test('a hidden value equal to the palette default is not written and is rebuilt', async () => {
  const { text, blocks } = await roundTrip(
    sprite({
      hat: flag('say'),
      say: stmt('looks_say', 'hat', { MESSAGE: [3, 'answer', [10, 'Hello!']] }, {}, 'join'),
      answer: reporter('sensing_answer', 'say'),
      join: stmt('looks_think', 'say', { MESSAGE: [3, 'j', [10, 'Hmm...']] }),
      j: reporter('operator_join', 'join', { STRING1: [3, [12, 'x', 'vx'], [10, 'apple']], STRING2: [1, [10, '!']] }),
    })
  );
  assert.doesNotMatch(text, /\?\?/);
  assert.match(text, /say answer\(\);\n {2}think `\$\{x\}!`;/);
  assert.deepEqual(find(blocks, 'looks_say').inputs.MESSAGE.slice(2), [[10, 'Hello!']]);
  assert.deepEqual(find(blocks, 'operator_join').inputs.STRING1, [3, [12, 'x', 'vx'], [10, 'apple']]);
});

test('an empty or missing hidden value reads as the default, so packed projects keep their text', async () => {
  const { manifest, texts } = await convertAndRebuild(
    sprite({
      hat: flag('say'),
      say: stmt('looks_say', 'hat', { MESSAGE: [2, 'answer'] }, {}, 'move'),
      answer: reporter('sensing_answer', 'say'),
      move: stmt('motion_movesteps', 'say', { STEPS: [3, [12, 'x', 'vx'], [10, '']] }),
    })
  );
  assert.doesNotMatch(texts['S/main.fractch'], /\?\?/);
  const blocks = manifest.targets.find((t) => t.name === 'S').blocks;
  assert.deepEqual(find(blocks, 'looks_say').inputs.MESSAGE.slice(2), [[10, 'Hello!']]);
  assert.deepEqual(find(blocks, 'motion_movesteps').inputs.STEPS, [3, [12, 'x', 'vx'], [4, '10']]);
});

test('a hidden menu keeps its value, and an unusual menu keeps its opcode', async () => {
  const { text, blocks } = await roundTrip(
    sprite(
      {
        hat: flag('costume'),
        costume: stmt('looks_switchcostumeto', 'hat', { COSTUME: [3, 'name', 'menu'] }, {}, 'goto'),
        name: reporter('looks_costumenumbername', 'costume', {}, { NUMBER_NAME: ['name', null] }),
        menu: menuShadow('looks_costume', 'costume', 'COSTUME', 'walk 2'),
        goto: stmt('motion_goto', 'costume', { TO: [3, 'answer', 'gotoMenu'] }),
        answer: reporter('sensing_answer', 'goto'),
        gotoMenu: menuShadow('sensing_of_object_menu', 'goto', 'OBJECT', 'Cat'),
      },
      { costumes: [] }
    )
  );
  assert.match(text, /costume \(costumeName\(\) \?\? "walk 2"\);/);
  assert.match(text, /\?\? shadow sensing\.of_object_menu\(field OBJECT: "Cat"\)\)/);
  const costume = find(blocks, 'looks_switchcostumeto').inputs.COSTUME;
  assert.equal(blocks[costume[2]].opcode, 'looks_costume');
  assert.deepEqual(blocks[costume[2]].fields.COSTUME, ['walk 2']);
  assert.equal(blocks[costume[2]].shadow, true);
});

test('hidden values inside expressions, custom block calls, broadcasts and extensions round-trip', async () => {
  const proto = {
    ...stmt('procedures_prototype', 'def', {}, {}),
    shadow: true,
    mutation: {
      tagName: 'mutation',
      children: [],
      proccode: 'log %s %b',
      argumentids: '["a1","a2"]',
      argumentnames: '["msg","flag"]',
      argumentdefaults: '["","false"]',
      warp: 'false',
    },
  };
  const call = (parent, next, inputs) => ({
    ...stmt('procedures_call', parent, inputs, {}, next),
    mutation: { tagName: 'mutation', children: [], proccode: 'log %s %b', argumentids: '["a1","a2"]', warp: 'false' },
  });
  await roundTrip(
    sprite({
      def: { ...flag(null), opcode: 'procedures_definition', inputs: { custom_block: [1, 'proto'] }, y: 400 },
      proto,
      hat: flag('setx'),
      setx: stmt('motion_setx', 'hat', { X: [3, 'outer', [4, '-30']] }, {}, 'c1'),
      outer: reporter('operator_add', 'setx', { NUM1: [3, 'inner', [4, '5']], NUM2: [1, [4, '1']] }),
      inner: reporter('operator_multiply', 'outer', { NUM1: [3, [12, 'x', 'vx'], [4, '7']], NUM2: [1, [4, '2']] }),
      c1: call('setx', 'c2', { a1: [3, 'answer1', [10, 'typed']] }),
      answer1: reporter('sensing_answer', 'c1'),
      c2: call('c1', 'bc', { a1: [3, 'answer2', [10, '']] }),
      answer2: reporter('sensing_answer', 'c2'),
      bc: stmt('event_broadcast', 'c2', { BROADCAST_INPUT: [3, 'answer3', [11, 'go', 'bgo']] }, {}, 'ext'),
      answer3: reporter('sensing_answer', 'bc'),
      ext: stmt('someext_store', 'bc', { KEY: [3, 'answer4', [10, 'default key']], VALUE: [3, 'answer5', [10, '']] }),
      answer4: reporter('sensing_answer', 'ext'),
      answer5: reporter('sensing_answer', 'ext'),
    })
  );
});

test('sugar that would swallow a hidden value falls back to plain blocks', async () => {
  const { text } = await roundTrip(
    sprite({
      hat: flag('set'),
      set: stmt('data_setvariableto', 'hat', { VALUE: [3, 'join', [10, 'kept']] }, { VARIABLE: ['x', 'vx'] }),
      join: reporter('operator_join', 'set', { STRING1: [3, [12, 'x', 'vx'], [10, 'apple']], STRING2: [1, [10, '!']] }),
    })
  );
  assert.match(text, /x = \(`\$\{x\}!` \?\? "kept"\);/);
});

test('extension branch inputs keep their names', async () => {
  const { text, blocks } = await roundTrip(
    sprite({
      hat: flag('c'),
      c: stmt('loops_conditional', 'hat', { BRANCH: [1, [4, '15']], SUBSTACK15: [2, 'say1'] }, {}, 'd'),
      say1: stmt('looks_say', 'c', { MESSAGE: [1, [10, 'fifteen']] }),
      d: stmt('loops_conditional', 'c', { SUBSTACK2: [2, 'say2'] }, {}, 'e'),
      say2: stmt('looks_say', 'd', { MESSAGE: [1, [10, 'second']] }),
      e: stmt('loops_three', 'd', { SUBSTACK: [2, 's1'], SUBSTACK2: [2, 's2'], SUBSTACK3: [2, 's3'] }),
      s1: stmt('looks_say', 'e', { MESSAGE: [1, [10, '1']] }),
      s2: stmt('looks_say', 'e', { MESSAGE: [1, [10, '2']] }),
      s3: stmt('looks_say', 'e', { MESSAGE: [1, [10, '3']] }),
    })
  );
  assert.match(text, /loops\.conditional\(BRANCH: 15\) SUBSTACK15 \{/);
  assert.match(text, /loops\.conditional\(\) SUBSTACK2 \{/);
  assert.match(text, /loops\.three\(\) \{\n {4}say 1;\n {2}\} \{\n {4}say 2;\n {2}\} \{\n {4}say 3;\n {2}\}/);
  assert.deepEqual(Object.keys(find(blocks, 'loops_three').inputs), ['SUBSTACK', 'SUBSTACK2', 'SUBSTACK3']);
});

test('a loose custom reporter call keeps its reporter shape', async () => {
  const proto = {
    ...stmt('procedures_prototype', 'def', {}, {}),
    shadow: true,
    mutation: {
      tagName: 'mutation',
      children: [],
      proccode: 'value',
      argumentids: '[]',
      argumentnames: '[]',
      argumentdefaults: '[]',
      warp: 'false',
    },
  };
  const { text, blocks } = await roundTrip(
    sprite({
      def: { ...flag(null), opcode: 'procedures_definition', inputs: { custom_block: [1, 'proto'] } },
      proto,
      call: {
        ...flag(null),
        opcode: 'procedures_call',
        y: 300,
        mutation: {
          tagName: 'mutation',
          children: [],
          proccode: 'value',
          argumentids: '[]',
          warp: 'false',
          return: '1',
        },
      },
      stack: {
        ...flag(null),
        opcode: 'procedures_call',
        y: 600,
        mutation: { tagName: 'mutation', children: [], proccode: 'value', argumentids: '[]', warp: 'false' },
      },
    })
  );
  assert.match(text, /script at 0,300 \{\n {2}\(@value\(\)\);\n\}/);
  assert.match(text, /script at 0,600 \{\n {2}@value\(\);\n\}/);
  const calls = Object.values(blocks).filter((b) => b.opcode === 'procedures_call');
  assert.deepEqual(calls.map((b) => b.mutation.return ?? null).sort(), ['1', null]);
});

test('Code mode applies edits to a hidden value and falls back to the default when it is removed', () => {
  const project = sprite({
    hat: flag('say'),
    say: stmt('looks_say', 'hat', { MESSAGE: [3, 'answer', [10, 'hi']] }),
    answer: reporter('sensing_answer', 'say'),
  });
  const ctx = liveContext(project);
  const id = ctx.targets.find((t) => t.name === 'S').id;
  const emitted = emitTarget(ctx, id);
  assert.match(emitted.text, /say \(answer\(\) \?\? "hi"\);/);
  const hidden = (text) => {
    const built = buildTarget(ctx, id, text, { previous: emitted, verifyRoundTrip: true });
    assert.deepEqual(
      built.diagnostics.filter((d) => d.severity === 'error'),
      []
    );
    const say = find(built.target.blocks, 'looks_say');
    assert.equal(say.inputs.MESSAGE[0], 3);
    return say.inputs.MESSAGE[2][1];
  };
  assert.equal(hidden(emitted.text), 'hi');
  assert.equal(hidden(emitted.text.replace('?? "hi"', '?? "bye"')), 'bye');
  assert.equal(hidden(emitted.text.replace('(answer() ?? "hi")', 'answer()')), 'Hello!');
});

const fixtureDir =
  process.env.FRACTCH_VM_FIXTURES || path.join(os.homedir(), 'mistwarp', 'scratch-vm', 'test', 'fixtures');
const fixtures = [
  'tw-stackframe-op.sb3',
  'tw-add-builtin-extension.sb3',
  'tw-block-stop-thread.sb3',
  'tw-conditional.sb3',
  'tw-rejected-promise-reporter.sb3',
  'tw-beyond-branchCount.sb3',
  'tw-slow-custom-reporter-stack-click.sb3',
  'tw-loop.sb3',
  'tw-hats-and-events.sb3',
  'tw-type-assertions.sb3',
];

for (const name of fixtures) {
  test(`scratch-vm fixture round-trips without losses: ${name}`, async (t) => {
    const file = path.join(fixtureDir, name);
    if (!fs.existsSync(file)) {
      t.skip('scratch-vm fixtures not found');
      return;
    }
    const project = JSON.parse(new AdmZip(file).readAsText('project.json'));
    const { manifest } = await convertAndRebuild(project);
    assert.deepEqual(compareProjects(project, manifest), []);
  });
}
