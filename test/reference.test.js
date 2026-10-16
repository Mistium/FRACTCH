import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { referenceWithDocs, languageReference } from '../src/reference.js';
import { DIAGNOSTIC_CODES } from '../src/diagnostics.js';

test('every alias in the generated language reference is documented in docs/syntax.md', () => {
  const syntax = fs.readFileSync(new URL('../docs/syntax.md', import.meta.url), 'utf8');
  const missing = referenceWithDocs(syntax)
    .filter((entry) => !entry.doc)
    .map((entry) => entry.name);
  assert.deepEqual(missing, []);
  assert.ok(languageReference().some((entry) => entry.name === 'setX' && entry.parseNames.includes('set_x')));
});

test('every diagnostic code is listed in docs/errors.md', () => {
  const errors = fs.readFileSync(new URL('../docs/errors.md', import.meta.url), 'utf8');
  for (const code of Object.keys(DIAGNOSTIC_CODES)) {
    assert.ok(errors.includes(`<a id="${code.toLowerCase()}"></a>${code}`), `${code} is not documented`);
  }
});
