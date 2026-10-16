import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFractch } from '../src/lint.js';
import { parseFractch } from '../src/parse.js';
import { pack, roundTrip, stageTarget, spriteTarget, projectOf, flag, stmt, blocksOf } from './helpers/regressions.js';

test('lint reports the same lines and 1-based columns as the parser, past a header', () => {
  const src = '/**\n * target: Stage\n * targetId: \n */\nwhen flag {\n  foo];\n}\n';
  const [err] = checkFractch(src);
  assert.equal(err.line, 6);
  assert.equal(err.col, 6);
});

test('lint accepts nested templates and quotes inside interpolations', () => {
  assert.deepEqual(checkFractch("say `Hello ${`${name}'s turn`}`;"), []);
  assert.deepEqual(checkFractch('say `${contains(v, "`")}x`;'), []);
  assert.match(checkFractch('say `a${b')[0].message, /unterminated template/);
});

test('a UTF-8 BOM does not break parsing', () => {
  const parsed = parseFractch('\uFEFFwhen flag {\r\n  say "s";\r\n}\r\n');
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(checkFractch('\uFEFFwhen flag { say 1; }'), []);
});

test('JSON escapes the emitter writes (\\u, \\b, \\f) parse back', async (t) => {
  const value = 'A\u0001B\bC\fD';
  const project = projectOf(
    stageTarget(
      { h: flag('s'), s: stmt('looks_say', 'h', { MESSAGE: [1, [10, value]] }) },
      { variables: { v: ['chars', value] } }
    )
  );
  const { manifest } = await roundTrip(t, project);
  assert.deepEqual(manifest.targets[0].variables.v, ['chars', value]);
  const say = blocksOf(manifest).find((b) => b.opcode === 'looks_say');
  assert.equal(say.inputs.MESSAGE[1][1], value);
});

test('a script body cannot hold top-level declarations', () => {
  const { errors } = parseFractch('when flag { var x = 1; say x; }');
  assert.match(errors[0].message, /'var' only works at the top level/);
});

test('a sprite name with */ cannot end the header comment', async (t) => {
  const project = projectOf(
    stageTarget(),
    spriteTarget('x */ when flag { say 1; } /*', {
      h: flag('s'),
      s: stmt('looks_say', 'h', { MESSAGE: [1, [10, 'hi']] }),
    })
  );
  const { manifest } = await roundTrip(t, project);
  const sprite = manifest.targets.find((x) => !x.isStage);
  assert.equal(sprite.name, 'x */ when flag { say 1; } /*');
  assert.equal(Object.keys(sprite.blocks).length, 2);
});

test('comments attach to hats, the brace owner, and the line below', async (t) => {
  const manifest = await pack(t, {
    'Stage/main.fractch':
      'when flag { // on hat\n  repeat 3 { // on repeat\n    say 1;\n  }\n}\n' +
      'def @f() {\n  // on first say\n  say 2;\n}\n',
  });
  const st = manifest.targets[0];
  const on = (text) => st.blocks[Object.values(st.comments).find((c) => c.text === text).blockId].opcode;
  assert.equal(on('on hat'), 'event_whenflagclicked');
  assert.equal(on('on repeat'), 'control_repeat');
  assert.equal(on('on first say'), 'procedures_definition');

  const project = projectOf(
    stageTarget(
      { h: { ...flag('s'), comment: 'c1' }, s: stmt('looks_say', 'h', { MESSAGE: [1, [10, 'hi']] }) },
      { comments: { c1: { blockId: 'h', x: 0, y: 0, width: 200, height: 200, minimized: false, text: 'note' } } }
    )
  );
  const back = (await roundTrip(t, project)).manifest.targets[0];
  assert.equal(back.blocks[Object.values(back.comments)[0].blockId].opcode, 'event_whenflagclicked');
});

test('text written by the previous emitter keeps its comment attachment', async (t) => {
  const manifest = await pack(t, {
    'Stage/main.fractch':
      'when flag at 0,0 {\n  // on hat\n  // on first\n  say "one";\n  // on second\n  say "two";\n}\n\n' +
      'def @f() at 0,400 {\n  // first in def\n  say 3;\n}\n',
  });
  const st = manifest.targets[0];
  const on = (text) => {
    const b = st.blocks[Object.values(st.comments).find((c) => c.text === text).blockId];
    return [b.opcode, b.inputs.MESSAGE?.[1]?.[1] ?? null];
  };
  assert.deepEqual(on('on hat'), ['looks_say', 'one']);
  assert.deepEqual(on('on first'), ['looks_say', 'one']);
  assert.deepEqual(on('on second'), ['looks_say', 'two']);
  assert.deepEqual(on('first in def'), ['procedures_definition', null]);
});

test('comments on hats, defs, their first statements and later statements round-trip', async (t) => {
  const say = (parent, text, next = null, comment) => ({
    ...stmt('looks_say', parent, { MESSAGE: [1, [10, text]] }, {}, next),
    ...(comment ? { comment } : {}),
  });
  const def = (id, proccode, next, comment, y) => ({
    [id]: {
      opcode: 'procedures_definition',
      next,
      parent: null,
      inputs: { custom_block: [1, `${id}p`] },
      fields: {},
      shadow: false,
      topLevel: true,
      x: 0,
      y,
      comment,
    },
    [`${id}p`]: {
      opcode: 'procedures_prototype',
      next: null,
      parent: id,
      inputs: {},
      fields: {},
      shadow: true,
      topLevel: false,
      mutation: {
        tagName: 'mutation',
        children: [],
        proccode,
        argumentids: '[]',
        argumentnames: '[]',
        argumentdefaults: '[]',
        warp: 'false',
      },
    },
  });
  const note = (blockId, text) => ({ blockId, x: 0, y: 0, width: 200, height: 200, minimized: false, text });
  const project = projectOf(
    stageTarget(
      {
        h: { ...flag('s1'), comment: 'c1' },
        s1: say('h', 'one', 's2', 'c2'),
        s2: say('s1', 'two', null, 'c3'),
        ...def('d', 'f', 'd1', 'c4', 400),
        d1: say('d', 'three', 'd2', 'c5'),
        d2: say('d1', 'four', null, 'c6'),
        ...def('e', 'g', 'e1', 'c7', 800),
        e1: { ...stmt('control_repeat', 'e', { TIMES: [1, [6, '3']], SUBSTACK: [2, 'e2'] }), comment: 'c8' },
        e2: say('e1', 'five', null, 'c9'),
      },
      {
        comments: {
          c1: note('h', 'on hat'),
          c2: note('s1', 'on first'),
          c3: note('s2', 'on second'),
          c4: note('d', 'on def'),
          c5: note('d1', 'on first in def'),
          c6: note('d2', 'on second in def'),
          c7: note('e', 'on def g'),
          c8: note('e1', 'on repeat'),
          c9: note('e2', 'in repeat'),
        },
      }
    )
  );
  const attachment = (target) =>
    Object.fromEntries(
      Object.values(target.comments).map((c) => {
        const b = target.blocks[c.blockId];
        return [c.text, `${b.opcode} ${b.inputs.MESSAGE?.[1]?.[1] ?? ''}`.trim()];
      })
    );
  const { manifest } = await roundTrip(t, project);
  assert.deepEqual(attachment(manifest.targets[0]), attachment(project.targets[0]));
});

test('a """ inside a comment does not shift raw-string indentation', async (t) => {
  const project = projectOf(
    stageTarget(
      {
        h: flag('f'),
        f: stmt('control_forever', 'h', { SUBSTACK: [2, 's1'] }),
        s1: { ...stmt('looks_say', 'f', { MESSAGE: [1, [10, 'hi']] }, {}, 's2'), comment: 'c1' },
        s2: stmt('looks_say', 's1', { MESSAGE: [1, [10, 'line1\nline2']] }),
      },
      {
        comments: {
          c1: { blockId: 's1', x: 0, y: 0, width: 200, height: 200, minimized: false, text: 'use """ here' },
        },
      }
    )
  );
  const { manifest } = await roundTrip(t, project);
  const says = blocksOf(manifest).filter((b) => b.opcode === 'looks_say');
  assert.deepEqual(says.map((b) => b.inputs.MESSAGE[1][1]).sort(), ['hi', 'line1\nline2']);
});

test('a // comment above a def keeps its calls bound to it', async (t) => {
  const manifest = await pack(t, {
    'Stage/main.fractch': '// greets\ndef @greet(who) warp { say who; }\nwhen flag { @greet("bob"); }\n',
  });
  const call = blocksOf(manifest).find((b) => b.opcode === 'procedures_call');
  assert.equal(call.mutation.proccode, 'greet %s');
  assert.equal(call.mutation.warp, 'true');
});
