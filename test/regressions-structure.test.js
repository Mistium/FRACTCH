import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { buildProjectFromBuildDir, checkProject } from '../src/index.js';
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
  stmt,
  blocksOf,
  cli,
} from './helpers/regressions.js';

test('pruning keeps assets reached by index, specials, or switch-and-wait', async (t) => {
  const svg = (c) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect fill="${c}" width="2" height="2"/></svg>`;
  const dir = writeFiles(tempDir(t), {
    'Stage/main.fractch':
      'costume "bg1" file "a.svg";\ncostume "bg2" file "b.svg";\ncostume "bg3" file "c.svg";\n' +
      'when flag { looks.switchbackdroptoandwait(BACKDROP: "bg" ++ 3); }\n',
    'Stage/a.svg': svg('red'),
    'Stage/b.svg': svg('green'),
    'Stage/c.svg': svg('blue'),
    'Spr/main.fractch':
      'sprite "Spr";\ncostume "a" file "a.svg";\ncostume "b" file "b.svg";\ncostume "c" file "c.svg";\n' +
      'when flag { costume 3; }\n',
    'Spr/a.svg': svg('red'),
    'Spr/b.svg': svg('green'),
    'Spr/c.svg': svg('blue'),
  });
  const { manifest } = await buildProjectFromBuildDir({ buildDir: dir });
  for (const target of manifest.targets) assert.equal(target.costumes.length, 3, target.name);
});

test('extension C-blocks keep every branch position', async (t) => {
  const project = projectOf(
    stageTarget({
      h: flag('x'),
      x: stmt('myext_tri', 'h', { SUBSTACK2: [2, 'b'], SUBSTACK3: [2, 'c'] }),
      b: stmt('looks_say', 'x', { MESSAGE: [1, [10, 'two']] }),
      c: stmt('looks_say', 'x', { MESSAGE: [1, [10, 'three']] }),
    })
  );
  const { manifest } = await roundTrip(t, project);
  const tri = blocksOf(manifest).find((b) => b.opcode === 'myext_tri');
  assert.deepEqual(Object.keys(tri.inputs).sort(), ['SUBSTACK2', 'SUBSTACK3']);
});

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

test('fmt carries assets to their canonical paths and removes moved files', async (t) => {
  const dir = writeFiles(tempDir(t), {
    'Stage/main.fractch': 'costume "bg" file "./art/bg.svg";\nwhen flag { say 1; }\n',
    'Stage/art/bg.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>',
    'Player/main.fractch': 'sprite "Hero";\nwhen flag { say 2; }\n',
  });
  execFileSync(process.execPath, [cli, 'fmt', dir], { stdio: 'pipe' });
  assert.ok(fs.existsSync(path.join(dir, 'Stage', 'assets', 'bg.svg')));
  assert.ok(fs.existsSync(path.join(dir, 'Hero', 'main.fractch')));
  assert.ok(!fs.existsSync(path.join(dir, 'Player', 'main.fractch')));
  const { problems } = await checkProject({ buildDir: dir, fs });
  assert.deepEqual(problems, []);
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
