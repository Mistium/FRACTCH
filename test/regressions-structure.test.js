import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { checkProject } from '../src/index.js';
import { join } from '../src/pathUtils.js';
import {
  tempDir,
  writeFiles,
  pack,
  roundTrip,
  stageTarget,
  spriteTarget,
  projectOf,
  flag,
  cli,
} from './helpers/regressions.js';

test('sprite order and chained renames survive', async (t) => {
  const names = ['Zeta', 'Alpha', 'Mid'];
  const project = projectOf(stageTarget(), ...names.map((n, i) => spriteTarget(n, {}, { layerOrder: i + 1 })));
  const { manifest } = await roundTrip(t, project);
  assert.deepEqual(
    manifest.targets.map((x) => x.name),
    ['Stage', ...names]
  );

  const renamed = await pack(t, {
    'Stage/main.fractch': '',
    'A/main.fractch': 'sprite "B";\n',
    'B/main.fractch': 'sprite "C";\n',
  });
  assert.deepEqual(renamed.targets.map((x) => x.name).sort(), ['B', 'C', 'Stage']);
});

test('sprites named like reserved folders survive', async (t) => {
  const project = projectOf(stageTarget(), spriteTarget('assets'), spriteTarget('extensions', {}, { layerOrder: 2 }));
  const { manifest } = await roundTrip(t, project);
  assert.deepEqual(manifest.targets.map((x) => x.name).sort(), ['Stage', 'assets', 'extensions']);
});

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
