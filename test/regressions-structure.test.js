import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from '../src/pathUtils.js';

test('pathUtils keeps UNC prefixes but not doubled root slashes', () => {
  assert.equal(join('\\\\server\\share\\proj', 'Stage'), '//server/share/proj/Stage');
  assert.equal(join('/', 'tmp'), '/tmp');
});
