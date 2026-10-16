import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProjectFromBuildDir } from '../src/index.js';
import {
  tempDir,
  writeFiles,
  pack,
  roundTrip,
  stageTarget,
  spriteTarget,
  projectOf,
  flag,
  stmt,
  blocksOf,
} from './helpers/regressions.js';

test('broadcasting a variable stays a variable reporter', async (t) => {
  const project = projectOf(
    stageTarget(
      {
        h: flag('b'),
        b: stmt('event_broadcast', 'h', { BROADCAST_INPUT: [3, [12, 'score', 'vS'], [11, 'go', 'bGo']] }),
      },
      { variables: { vS: ['score', 'go'] }, broadcasts: { bGo: 'go' } }
    )
  );
  const { texts, manifest } = await roundTrip(t, project);
  assert.match(texts['Stage/main.fractch'], /broadcast vars\["score"\];/);
  const b = blocksOf(manifest).find((x) => x.opcode === 'event_broadcast');
  assert.deepEqual(b.inputs.BROADCAST_INPUT[1], [12, 'score', 'vS']);
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
  const { texts } = await roundTrip(t, project);
  assert.match(texts['Spr/main.fractch'], /say vars\["!local_flagclicked_x"\];/);
});

test('a global shadowed by a local of the same name is written vars["..."]', async (t) => {
  const dir = writeFiles(tempDir(t), {
    'Stage/main.fractch':
      'var temp = 5;\nwhen flag {\n  local temp = 1;\n  vars["temp"] = 2;\n  temp += 1;\n  say vars["temp"];\n}\n',
  });
  const { manifest } = await buildProjectFromBuildDir({ buildDir: dir, prune: false });
  const { texts } = await roundTrip(t, manifest);
  assert.match(
    texts['Stage/main.fractch'],
    /local temp = 1;\n\s*vars\["temp"\] = 2;\n\s*temp \+= 1;\n\s*say vars\["temp"\];/
  );
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
  const fields = blocksOf(manifest, 'Spr')
    .filter((b) => b.fields.VARIABLE)
    .map((b) => b.fields.VARIABLE);
  assert.deepEqual(fields, [
    ['score', 'g1'],
    ['dup', 'g4'],
    ['dup', 'g4'],
  ]);
});

test('generated ids are unique across variables, lists and broadcasts', async (t) => {
  const manifest = await pack(t, {
    'Stage/main.fractch': 'var "a b" = 1;\nwhen flag { inv = 5; append(inv, "x"); go = 1; broadcast go; }\n',
    'Spr/main.fractch': 'sprite "Spr";\nvar a_b = 2;\n',
  });
  const ids = manifest.targets.flatMap((x) =>
    [x.variables, x.lists, x.broadcasts].flatMap((d) => Object.keys(d || {}))
  );
  assert.equal(new Set(ids).size, ids.length, `duplicate ids: ${ids}`);
  const stage = manifest.targets.find((x) => x.isStage);
  assert.ok(Object.values(stage.variables).some(([n]) => n === 'inv'));
  assert.ok(Object.values(stage.lists).some(([n]) => n === 'inv'));
});

test('for i in X counts when X is a parameter, local, or vars["X"]', async (t) => {
  const manifest = await pack(t, {
    'Stage/main.fractch':
      'var items = ["a", "b"];\n' +
      'def @Count(items) { for i in items { say i; } }\n' +
      'when flag { local items = 3; for j in items { say j; } for k in vars["items"] { say k; } }\n',
  });
  assert.equal(blocksOf(manifest).filter((b) => b.opcode === 'data_itemoflist').length, 0);
});
