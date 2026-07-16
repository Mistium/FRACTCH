import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkProject } from '../src/check.js';

const project = (source) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fractch-check-'));
  fs.mkdirSync(path.join(dir, 'Stage'));
  fs.writeFileSync(path.join(dir, 'Stage', 'main.fractch'), source);
  return dir;
};

test('check rejects missing, non-directory, and empty project paths with actionable hints', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fractch-path-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const missing = await checkProject({ buildDir: path.join(root, 'missing'), fs });
  assert.match(missing.problems[0].message, /does not exist/);
  assert.match(missing.problems[0].hint, /Stage/);

  const file = path.join(root, 'project.fractch');
  fs.writeFileSync(file, 'when flag {}\n');
  const notDirectory = await checkProject({ buildDir: file, fs });
  assert.match(notDirectory.problems[0].message, /not a directory/);
  assert.ok(notDirectory.problems[0].hint);

  const emptyDir = path.join(root, 'empty');
  fs.mkdirSync(emptyDir);
  const empty = await checkProject({ buildDir: emptyDir, fs });
  assert.match(empty.problems[0].message, /no \.fractch files/);
  assert.match(empty.problems[0].hint, /Stage\/main\.fractch/);
});

test('check reports exact lines for duplicate declarations and both custom-block arity directions', async (t) => {
  const dir = project(
    'costume "same" file "assets/a.svg";\n' +
      'costume "same" file "assets/b.svg";\n' +
      'def @work(first, second) {}\n' +
      'def @work(first, second) {}\n' +
      'when flag {\n' +
      '  local value = 1;\n' +
      '  local value = 2;\n' +
      '  @work(1);\n' +
      '  @work(1, 2, 3);\n' +
      '}\n'
  );
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const { problems } = await checkProject({ buildDir: dir, fs });
  const find = (pattern) => problems.find((problem) => pattern.test(problem.message));

  assert.equal(find(/two costumes/).line, 2);
  assert.equal(find(/defined more than once/).line, 4);
  assert.match(find(/defined more than once/).hint, /main\.fractch:3/);
  assert.equal(find(/local 'value'/).line, 7);

  const arity = problems.filter((problem) => /@work takes 2 arguments/.test(problem.message));
  assert.deepEqual(arity.map((problem) => problem.line), [8, 9]);
  assert.match(arity[0].message, /passes 1/);
  assert.match(arity[1].message, /passes 3/);
  assert.match(arity[0].hint, /main\.fractch:3/);
});
