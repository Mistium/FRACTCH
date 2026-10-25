import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { checkFractch } from '../src/lint.js';
import { md5hex } from '../src/md5.js';
import { parseFractch } from '../src/parse.js';
import { join } from '../src/pathUtils.js';
import { verifyRoundtrip } from '../src/roundtripDiff.js';
import { buildTarget, emitTarget } from '../src/target.js';
import { compareProjects } from './helpers/fidelity.js';
import { liveContext } from './helpers/live-context.js';
import { blocksOf, flag, pack, projectOf, roundTrip, spriteTarget, stageTarget, stmt } from './helpers/regressions.js';

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

test('a local is scoped to its script on both pack and convert', async (t) => {
  const manifest = await pack(t, {
    'Spr/main.fractch': 'sprite "Spr";\nwhen flag { local x = 1; say x; }\nwhen clicked { x = 2; say x; }\n',
  });
  const sets = blocksOf(manifest, 'Spr').filter((b) => b.opcode === 'data_setvariableto');
  assert.deepEqual(sets.map((b) => b.fields.VARIABLE[0]).sort(), ['!local_f_x', 'x']);

  const project = projectOf(
    stageTarget(),
    spriteTarget(
      'Spr',
      {
        h: flag('a'),
        a: stmt('data_setvariableto', 'h', { VALUE: [1, [10, 'q']] }, { VARIABLE: ['!local_flagclicked_x', 'L1'] }),
        h2: { ...flag('c'), y: 300 },
        c: stmt('looks_say', 'h2', { MESSAGE: [3, [12, '!local_flagclicked_x', 'L1'], [10, '']] }),
      },
      { variables: { L1: ['!local_flagclicked_x', 0], G: ['temp', 5] } }
    )
  );
  const { texts, manifest: back } = await roundTrip(t, project);
  assert.match(texts['Spr/main.fractch'], /say vars\["!local_flagclicked_x"\];/);
  assert.deepEqual(compareProjects(project, back), []);
});

test('a global shadowed by a local of the same name is written vars["..."]', async (t) => {
  const manifest = await pack(t, {
    'Stage/main.fractch':
      'var temp = 5;\nwhen flag {\n  local temp = 1;\n  vars["temp"] = 2;\n  temp += 1;\n  say vars["temp"];\n}\n',
  });
  const { texts, manifest: back } = await roundTrip(t, manifest);
  assert.match(
    texts['Stage/main.fractch'],
    /local temp = 1;\n\s*vars\["temp"\] = 2;\n\s*temp \+= 1;\n\s*say vars\["temp"\];/
  );
  assert.deepEqual(compareProjects(manifest, back), []);
});

test('numbered local tags never collide with another script tag', async (t) => {
  const manifest = await pack(t, {
    'Stage/main.fractch':
      'when flag { local x = 1; }\nwhen flag { local x = 2; }\ndef @flagclicked2() { local x = 3; }\n',
  });
  const names = blocksOf(manifest)
    .filter((b) => b.opcode === 'data_setvariableto')
    .map((b) => b.fields.VARIABLE[0]);
  assert.equal(new Set(names).size, 3, names.join(', '));
});

test('nested list loops keep their hidden counters at every depth', async (t) => {
  const manifest = await pack(t, {
    'Stage/main.fractch':
      'var a = [1, 2];\nvar b = [3];\nwhen flag {\n  for x in a {\n    for i in 2 {\n      for y in b {\n        say y;\n      }\n    }\n  }\n}\n',
  });
  const { texts, manifest: back } = await roundTrip(t, manifest);
  assert.match(texts['Stage/main.fractch'], /for x in a \{\n\s*for i in 2 \{\n\s*for y in b \{\n/);
  assert.deepEqual(compareProjects(manifest, back), []);
});

test('variable fields keep their id when the name alone would bind elsewhere', async (t) => {
  const project = projectOf(
    stageTarget({}, { variables: { g1: ['score', 0], g3: ['dup', 1], g4: ['dup', 2] } }),
    spriteTarget(
      'Spr',
      {
        h: flag('a'),
        a: stmt('data_setvariableto', 'h', { VALUE: [1, [10, '5']] }, { VARIABLE: ['score', 'g1'] }, 'b'),
        b: stmt('data_changevariableby', 'a', { VALUE: [1, [4, '1']] }, { VARIABLE: ['dup', 'g4'] }, 'c'),
        c: stmt('data_showvariable', 'b', {}, { VARIABLE: ['dup', 'g4'] }),
      },
      { variables: { v1: ['score', 'mine'] } }
    )
  );
  const { manifest } = await roundTrip(t, project);
  assert.deepEqual(compareProjects(project, manifest), []);
  const fields = blocksOf(manifest, 'Spr')
    .filter((b) => b.fields.VARIABLE)
    .map((b) => b.fields.VARIABLE);
  assert.deepEqual(fields, [
    ['score', 'g1'],
    ['dup', 'g4'],
    ['dup', 'g4'],
  ]);
});

test('a sprite name with */ cannot end the header comment', async (t) => {
  const names = ['x */ when flag { say 1; } /*', 'a\\b*c', 'two\nlines'];
  const project = projectOf(
    stageTarget(),
    ...names.map((name, i) =>
      spriteTarget(
        name,
        { h: flag('s'), s: stmt('looks_say', 'h', { MESSAGE: [1, [10, 'hi']] }) },
        { layerOrder: i + 1 }
      )
    )
  );
  const { manifest, out } = await roundTrip(t, project);
  for (const name of names) {
    const sprite = manifest.targets.find((x) => x.name === name);
    assert.ok(sprite, name);
    assert.equal(Object.keys(sprite.blocks).length, 2, name);
  }
  const result = await verifyRoundtrip({ project, buildDir: out, fs });
  assert.deepEqual(result.failures, []);
});

test('comments attach to hats, the brace owner, and the line below', async (t) => {
  const manifest = await pack(t, {
    'Stage/main.fractch':
      'when flag { // on hat\n  repeat 3 { // on repeat\n    say 1;\n  }\n  // on think\n  think 2;\n}\n' +
      '// on def\ndef @f() {\n  say 2;\n}\n',
  });
  const st = manifest.targets[0];
  const on = (text) => st.blocks[Object.values(st.comments).find((c) => c.text === text).blockId].opcode;
  assert.equal(on('on hat'), 'event_whenflagclicked');
  assert.equal(on('on repeat'), 'control_repeat');
  assert.equal(on('on think'), 'looks_think');
  assert.equal(on('on def'), 'procedures_definition');

  const project = projectOf(
    stageTarget(
      { h: { ...flag('s'), comment: 'c1' }, s: stmt('looks_say', 'h', { MESSAGE: [1, [10, 'hi']] }) },
      { comments: { c1: { blockId: 'h', x: 0, y: 0, width: 200, height: 200, minimized: false, text: 'note' } } }
    )
  );
  const { manifest: back } = await roundTrip(t, project);
  assert.deepEqual(compareProjects(project, back), []);
  const ctx = liveContext(project);
  const id = ctx.targets[0].id;
  const emitted = emitTarget(ctx, id);
  const built = buildTarget(ctx, id, emitted.text.replace('"hi"', '"hey"'), { previous: emitted });
  const [comment] = Object.values(built.target.comments);
  assert.equal(built.target.blocks[comment.blockId].opcode, 'event_whenflagclicked');
});

test('a // comment above a def keeps its calls bound to it', async (t) => {
  const source = '// greets\ndef @greet(who) warp { say who; }\nwhen flag { @greet("bob"); }\n';
  const manifest = await pack(t, { 'Stage/main.fractch': source });
  const call = blocksOf(manifest).find((b) => b.opcode === 'procedures_call');
  assert.equal(call.mutation.proccode, 'greet %s');
  assert.equal(call.mutation.warp, 'true');

  const ctx = liveContext(projectOf(stageTarget()));
  const id = ctx.targets[0].id;
  const built = buildTarget(ctx, id, source, { previous: emitTarget(ctx, id) });
  assert.deepEqual(
    built.diagnostics.filter((d) => d.severity === 'error'),
    []
  );
  assert.equal(
    Object.values(built.target.blocks).find((b) => b.opcode === 'procedures_call').mutation.proccode,
    'greet %s'
  );
});

test('generated ids are unique across variables, lists and broadcasts', async (t) => {
  const manifest = await pack(t, {
    'Stage/main.fractch':
      'var "a b" = 1;\nwhen flag { inv = 5; append(inv, "x"); go = 1; broadcast go; broadcast ""; }\n',
    'Spr/main.fractch': 'sprite "Spr";\nvar a_b = 2;\n',
  });
  const ids = manifest.targets.flatMap((x) =>
    [x.variables, x.lists, x.broadcasts].flatMap((d) => Object.keys(d || {}))
  );
  assert.equal(new Set(ids).size, ids.length, `duplicate ids: ${ids}`);
  const stage = manifest.targets.find((x) => x.isStage);
  assert.ok(Object.values(stage.variables).some(([n]) => n === 'inv'));
  assert.ok(Object.values(stage.lists).some(([n]) => n === 'inv'));
  assert.ok(Object.values(stage.broadcasts).includes(''));
});

test('control_return keeps its own opcode', async (t) => {
  const project = projectOf(stageTarget({ h: flag('r'), r: stmt('control_return', 'h', { VALUE: [1, [10, '5']] }) }));
  const { manifest } = await roundTrip(t, project);
  assert.deepEqual(compareProjects(project, manifest), []);
});

test('md5hex hashes strings as UTF-8 and respects typed-array offsets', () => {
  assert.equal(md5hex('é'), createHash('md5').update('é').digest('hex'));
  const bytes = new Uint8Array([0, 1, 2, 3, 4, 5]);
  assert.equal(md5hex(new DataView(bytes.buffer, 2, 3)), createHash('md5').update(bytes.subarray(2, 5)).digest('hex'));
});

test('pathUtils keeps UNC prefixes but not doubled root slashes', () => {
  assert.equal(join('\\\\server\\share\\proj', 'Stage'), '//server/share/proj/Stage');
  assert.equal(join('/', 'tmp'), '/tmp');
  assert.equal(join('/a', 'b'), '/a/b');
});

test('a header written before escaping still names a sprite with a backslash', async () => {
  const { unescapeHeader } = await import('../src/pack.js');
  assert.equal(unescapeHeader('\\o/'), '\\o/');
  assert.equal(unescapeHeader('a\\*\\/b'), 'a*/b');
  assert.equal(unescapeHeader('x\\ny\\\\z'), 'x\ny\\z');
});
