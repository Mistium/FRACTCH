import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pack } from './helpers/regressions.js';
import { runStage } from './support/scratch-sim.js';

test('stdlib strings.replace finds matches after a partial match', async (t) => {
  const manifest = await pack(t, {
    'Stage/main.fractch':
      'import "fractch/strings";\nwhen flag {\n' +
      '  say strings.replace("abb", "ab", "X");\n' +
      '  say strings.replace("aaa", "aa", "X");\n' +
      '  say strings.replace("a-b-c", "-", " ");\n' +
      '  say strings.replace("abc", "", "X");\n' +
      '}\n',
  });
  assert.deepEqual(runStage(manifest.targets[0]), ['Xb', 'Xa', 'a b c', 'XaXbXc']);
});
