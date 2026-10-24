import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFractch } from '../src/lint.js';
import { parseFractch } from '../src/parse.js';
import { pack } from './helpers/regressions.js';

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
