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
