import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFractch } from '../src/lint.js';

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
