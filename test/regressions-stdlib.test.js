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

test('stdlib json.get_from finds every key and only compares keys', async (t) => {
  const manifest = await pack(t, {
    'Stage/main.fractch':
      'import "fractch/json";\nwhen flag {\n' +
      '  say json.get_from("a", "{\\"a\\":1,\\"b\\":2,\\"c\\":3}");\n' +
      '  say json.get_from("c", "{\\"a\\":1,\\"b\\":2,\\"c\\":3}");\n' +
      '  say json.get_from("x", "{\\"a\\":\\"q\\",\\"b\\":\\"x\\",\\"x\\":\\"y\\"}");\n' +
      '  say json.get_from("missing", "{\\"a\\":1}");\n' +
      '  say json.get_from("1", "{\\"a\\":1,\\"1\\":\\"z\\"}");\n' +
      '}\n',
  });
  assert.deepEqual(runStage(manifest.targets[0]).map(String), ['1', '3', 'y', '', 'z']);
});
