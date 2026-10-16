import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFractch } from '../src/lint.js';
import { parseFractch } from '../src/parse.js';
import { roundTrip, stageTarget, spriteTarget, projectOf, flag, stmt, blocksOf } from './helpers/regressions.js';

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
