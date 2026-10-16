import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { checkProject } from '../src/index.js';
import { join } from '../src/pathUtils.js';
import { tempDir, writeFiles, pack, flag, cli } from './helpers/regressions.js';

test('check skips files pack ignores and flags root-level files', async (t) => {
  const dir = writeFiles(tempDir(t), {
    'Stage/main.fractch': 'when flag { say 1; }\n',
    'Stage/notes.ignore.fractch': 'this is ((',
    'Stage/skip.fractch': '// fractch:ignore\nwhen flg {',
    'stray.fractch': 'when flag {}',
  });
  const { problems } = await checkProject({ buildDir: dir, fs });
  assert.deepEqual(
    problems.map((p) => p.message),
    ['pack ignores .fractch files at the project root']
  );
});

test('pathUtils keeps UNC prefixes but not doubled root slashes', () => {
  assert.equal(join('\\\\server\\share\\proj', 'Stage'), '//server/share/proj/Stage');
  assert.equal(join('/', 'tmp'), '/tmp');
});

test('the CLI refuses a missing project dir and accepts flags before word syntax', async (t) => {
  const dir = tempDir(t);
  const runCli = (...args) => execFileSync(process.execPath, [cli, ...args], { cwd: dir, stdio: 'pipe' });
  assert.throws(() => runCli('game.sb3', 'from', 'missing'), /project directory not found/);
  assert.ok(!fs.existsSync(path.join(dir, 'game.sb3')));

  writeFiles(dir, { 'proj/Stage/main.fractch': 'when flag { say 1; }\n' });
  runCli('first.sb3', 'from', 'proj');
  runCli('--origin', 'first.sb3', 'second.sb3', 'from', 'proj');
  assert.ok(fs.existsSync(path.join(dir, 'second.sb3')));
  runCli('from', 'first.sb3', '--out', 'unpacked');
  assert.ok(fs.existsSync(path.join(dir, 'unpacked', 'Stage', 'main.fractch')));
});
