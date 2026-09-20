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
  assert.deepEqual(
    arity.map((problem) => problem.line),
    [8, 9]
  );
  assert.match(arity[0].message, /passes 1/);
  assert.match(arity[1].message, /passes 3/);
  assert.match(arity[0].hint, /main\.fractch:3/);
});

test('check flags unknown namespace-less blocks and bare value statements', async (t) => {
  const dir = project('when flag {\n  florbulate 3;\n  say frobnicate(1);\n  move 10;\n  say text;\n}\n');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const { problems } = await checkProject({ buildDir: dir, fs });
  const bare = problems.find((p) => /just a value, not a block/.test(p.message));
  assert.ok(bare, 'bare value statement was not reported');
  assert.equal(bare.line, 2);

  const unknown = problems.find((p) => /unknown block 'frobnicate'/.test(p.message));
  assert.ok(unknown, 'unknown reporter was not reported');
  assert.equal(unknown.line, 3);

  assert.ok(
    !problems.some((p) => /unknown block 'text'/.test(p.message)),
    "'text' is a real namespace-less opcode and must not be flagged"
  );
});

test('only content-losing problems are fatal, so fmt can still format a lint-clean-but-imperfect project', async (t) => {
  const advisory = project('when flag {\n  @nope();\n}\n');
  t.after(() => fs.rmSync(advisory, { recursive: true, force: true }));
  const a = await checkProject({ buildDir: advisory, fs });
  assert.ok(a.problems.length > 0, 'expected the undefined custom block to be reported');
  assert.ok(
    a.problems.every((p) => !p.fatal),
    'an undefined custom block round trips fine and must not block formatting'
  );

  const broken = project('when flag {\n  move 10;\n');
  t.after(() => fs.rmSync(broken, { recursive: true, force: true }));
  const b = await checkProject({ buildDir: broken, fs });
  assert.ok(
    b.problems.some((p) => p.fatal),
    'an unparsable file must be fatal so fmt refuses to rewrite it'
  );
});
