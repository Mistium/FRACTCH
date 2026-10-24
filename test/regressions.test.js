import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFractch } from '../src/lint.js';
import { parseFractch } from '../src/parse.js';
import { compareProjects } from './helpers/fidelity.js';
import { blocksOf, flag, pack, projectOf, roundTrip, stageTarget, stmt } from './helpers/regressions.js';

test('lint reports the same lines and 1-based columns as the parser, past a header', () => {
  const src = '/**\n * target: Stage\n * targetId: \n */\nwhen flag {\n  foo];\n}\n';
  const [err] = checkFractch(src);
  assert.equal(err.line, 6);
  assert.equal(err.col, 6);
});

test('a UTF-8 BOM does not break parsing, linting or the header', async (t) => {
  const parsed = parseFractch('﻿when flag {\r\n  say "s";\r\n}\r\n');
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(checkFractch('﻿when flag { say 1; }'), []);
  const manifest = await pack(t, {
    'Stage/main.fractch': '﻿/**\n * target: Stage\n */\nwhen flag { say 1; }\n',
    'Spr/main.fractch': '﻿sprite "Hero";\nwhen flag { say 2; }\n',
  });
  assert.deepEqual(manifest.targets.map((x) => x.name).sort(), ['Hero', 'Stage']);
  assert.ok(manifest.targets.every((x) => Object.keys(x.blocks).length === 2));
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
  assert.equal(blocksOf(manifest).find((b) => b.opcode === 'looks_say').inputs.MESSAGE[1][1], value);
  const template = parseFractch('when flag { say `\\u0041${x}\\b`; }');
  assert.deepEqual(template.errors, []);
});

test('a script body cannot hold top-level declarations', async (t) => {
  const { errors } = parseFractch('when flag { var x = 1; say x; }');
  assert.equal(errors[0].code, 'FR124');
  assert.match(errors[0].message, /'var' only works at the top level/);
  const manifest = await pack(t, { 'Stage/main.fractch': 'when flag {\n  costume "c" file "c.svg";\n  say 1;\n}\n' });
  assert.deepEqual(
    blocksOf(manifest).map((b) => b.opcode),
    ['event_whenflagclicked', 'looks_say']
  );
});

test('a """ inside a comment or template does not shift raw-string indentation', async (t) => {
  const withComment = {
    s1: { ...stmt('looks_say', 'f', { MESSAGE: [1, [10, 'hi']] }, {}, 's3'), comment: 'c1' },
  };
  const withTemplate = {
    s1: stmt('looks_say', 'f', { MESSAGE: [3, 'j', [10, '']] }, {}, 's3'),
    j: stmt('operator_join', 's1', { STRING1: [1, [10, 'a """ b ']], STRING2: [3, 'ans', [10, '']] }),
    ans: stmt('sensing_answer', 'j'),
  };
  for (const blocks of [withComment, withTemplate]) {
    const project = projectOf(
      stageTarget(
        {
          h: flag('f'),
          f: stmt('control_forever', 'h', { SUBSTACK: [2, 's1'] }),
          ...blocks,
          s3: stmt('looks_say', 's1', { MESSAGE: [1, [10, 'line1\nline2']] }),
        },
        {
          comments: {
            c1: { blockId: 's1', x: 0, y: 0, width: 200, height: 200, minimized: false, text: 'use """ here' },
          },
        }
      )
    );
    const { manifest } = await roundTrip(t, project);
    assert.deepEqual(compareProjects(project, manifest), []);
  }
});

test('a raw string checked out with CRLF line endings keeps plain newlines', async (t) => {
  const manifest = await pack(t, { 'Stage/main.fractch': 'when flag {\r\n  say """a\r\nb""";\r\n}\r\n' });
  assert.equal(blocksOf(manifest).find((b) => b.opcode === 'looks_say').inputs.MESSAGE[1][1], 'a\nb');
});

test('a loose 0 = 0 reporter stays an operator block', async (t) => {
  const eq = (y, right) => ({
    ...stmt('operator_equals', null, { OPERAND1: [1, [10, '0']], OPERAND2: [1, [10, right]] }),
    topLevel: true,
    x: 0,
    y,
  });
  const project = projectOf(stageTarget({ a: eq(0, '0'), b: eq(200, '1') }));
  const { manifest } = await roundTrip(t, project);
  assert.deepEqual(compareProjects(project, manifest), []);
});

test('broadcasting a variable or list stays a reporter', async (t) => {
  for (const [active, hidden, text] of [
    [[12, 'score', 'vS'], [11, 'go', 'bGo'], /broadcast \(score \?\? broadcast\("go"\)\);/],
    [[12, 'score', 'vS'], [10, ''], /broadcast vars\["score"\];/],
    [[13, 'inv', 'lI'], [11, 'go', 'bGo'], /broadcast \(lists\["inv"\] \?\? broadcast\("go"\)\);/],
  ]) {
    const project = projectOf(
      stageTarget(
        { h: flag('b'), b: stmt('event_broadcast', 'h', { BROADCAST_INPUT: [3, active, hidden] }) },
        { variables: { vS: ['score', 'go'] }, lists: { lI: ['inv', []] }, broadcasts: { bGo: 'go' } }
      )
    );
    const { texts, manifest } = await roundTrip(t, project);
    assert.match(texts['Stage/main.fractch'], text);
    assert.deepEqual(compareProjects(project, manifest), []);
  }
});
