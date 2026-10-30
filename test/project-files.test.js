import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import AdmZip from 'adm-zip';
import {
  projectToFiles,
  filesToProject,
  verifyProjectFiles,
  compareProjects,
  memoryFs,
  md5hex,
  projectAssetPaths,
  METADATA_FILE,
} from '../src/index.js';
import { cli, flag, projectOf, spriteTarget, stageTarget, stmt, tempDir } from './helpers/regressions.js';

const text = (bytes) => new TextDecoder().decode(bytes);
const bytes = (value) => new TextEncoder().encode(value);

const SVG = bytes('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"></svg>');
const FONT = bytes('font bytes');
const DATA = bytes('{"level": 3}');
const svgId = `${md5hex(SVG)}.svg`;
const fontId = `${md5hex(FONT)}.ttf`;
const dataId = `${md5hex(DATA)}.json`;
const store = new Map([
  [svgId, SVG],
  [fontId, FONT],
  [dataId, DATA],
]);

const costume = (name) => ({
  name,
  assetId: svgId.split('.')[0],
  md5ext: svgId,
  dataFormat: 'svg',
  rotationCenterX: 1,
  rotationCenterY: 1,
});

const sample = () => {
  const project = projectOf(
    stageTarget({}, { costumes: [costume('backdrop')], extensionStorage: { demo: { seen: 2 } } }),
    spriteTarget(
      'Hero',
      {
        hat: { ...flag('say'), x: 40, y: 80 },
        say: stmt('looks_say', 'hat', { MESSAGE: [1, [10, 'hi']] }),
      },
      {
        costumes: [costume('idle')],
        comments: { c1: { blockId: 'say', x: 300, y: 90, width: 200, height: 200, minimized: false, text: 'greet' } },
        frames: { f1: { title: 'Intro', x: 0, y: 0, width: 400, height: 300, collapsed: false } },
      }
    ),
    spriteTarget('Enemy', {}, { costumes: [costume('idle')], layerOrder: 2 })
  );
  project.customFonts = [
    { system: false, family: 'Pixel', fallback: 'monospace', md5ext: fontId },
    { system: true, family: 'Arial', fallback: 'sans-serif' },
  ];
  project.customAssets = [{ name: 'levels/one.json', md5ext: dataId }];
  project.meta.origin = 'mistwarp.org';
  return project;
};

const readAsset = (name) => store.get(name) || null;

test('projectToFiles writes scripts, assets, fonts, custom assets and the metadata file', async () => {
  const { files, diagnostics } = await projectToFiles({ projectJson: sample(), readAsset });
  assert.deepEqual(
    diagnostics.filter((d) => d.severity !== 'info'),
    []
  );
  for (const name of [
    'Stage/main.fractch',
    'Stage/assets/backdrop.svg',
    'Hero/main.fractch',
    'Hero/assets/idle.svg',
    'Enemy/main.fractch',
    'assets/levels/one.json',
    'fonts/Pixel.ttf',
    METADATA_FILE,
  ]) {
    assert.ok(files.has(name), `${name} is written`);
  }
  const metadata = JSON.parse(text(files.get(METADATA_FILE)));
  assert.deepEqual(metadata.spriteOrder, ['Hero', 'Enemy']);
  assert.equal(metadata.origin, 'mistwarp.org');
  assert.deepEqual(metadata.fonts[0], { family: 'Pixel', fallback: 'monospace', file: 'fonts/Pixel.ttf' });
});

test('filesToProject rebuilds everything projectToFiles wrote', async () => {
  const project = sample();
  const result = await verifyProjectFiles({ projectJson: project, readAsset });
  assert.deepEqual(result.differences, []);
  const rebuilt = result.rebuilt.projectJson;
  assert.deepEqual(
    rebuilt.targets.map((t) => t.name),
    ['Stage', 'Hero', 'Enemy']
  );
  assert.deepEqual(rebuilt.customAssets, [{ name: 'levels/one.json', md5ext: dataId }]);
  assert.equal(rebuilt.customFonts[0].md5ext, fontId);
  assert.deepEqual(rebuilt.extensionStorage, undefined);
  assert.deepEqual(rebuilt.targets[0].extensionStorage, { demo: { seen: 2 } });
  const comment = Object.values(rebuilt.targets[1].comments).find((c) => c.text === 'greet');
  assert.deepEqual([comment.x, comment.y], [300, 90]);
  assert.equal(Object.values(rebuilt.targets[1].frames)[0].title, 'Intro');
  assert.ok(result.rebuilt.assets.has(fontId));
  assert.ok(result.rebuilt.assets.has(dataId));
});

test('filesToProject still reads the old mistwarp.json name', async () => {
  const { files } = await projectToFiles({ projectJson: sample(), readAsset });
  const legacy = new Map(files);
  legacy.set('mistwarp.json', legacy.get(METADATA_FILE));
  legacy.delete(METADATA_FILE);
  const { projectJson } = await filesToProject(legacy);
  assert.equal(projectJson.meta.origin, 'mistwarp.org');
  assert.equal(projectJson.customFonts.length, 2);
});

test('filesToProject ignores the history and manifest inside an .mwp', async () => {
  const { files } = await projectToFiles({ projectJson: sample(), readAsset });
  const archive = new Map(files);
  archive.set('.git/HEAD', bytes('ref: refs/heads/main\n'));
  archive.set('mwp.json', bytes('{"format":"mistwarp-project"}'));
  archive.set('../escape.fractch', bytes('when flag {}'));
  const { projectJson } = await filesToProject(archive);
  assert.deepEqual(
    projectJson.targets.map((t) => t.name),
    ['Stage', 'Hero', 'Enemy']
  );
});

test('sprites named like the root folders get their own folder', async () => {
  const project = projectOf(
    stageTarget(),
    spriteTarget('assets', { hat: flag(null) }),
    spriteTarget('Fonts', { hat: flag(null) }),
    spriteTarget('extensions', { hat: flag(null) })
  );
  const result = await verifyProjectFiles({ projectJson: project, readAsset });
  assert.deepEqual(result.differences, []);
  const folders = [...result.files.keys()].filter((p) => p.endsWith('/main.fractch')).map((p) => p.split('/')[0]);
  assert.deepEqual(folders.sort(), ['Fonts_2', 'assets_2', 'extensions_2']);
});

test('orphaned shadow blocks are dropped instead of becoming visible scripts', async () => {
  const project = projectOf(
    stageTarget(),
    spriteTarget('S', {
      hat: flag(null),
      lost: { ...stmt('argument_reporter_string_number', 'gone', {}, { VALUE: ['n', null] }), shadow: true },
    })
  );
  const { files, diagnostics } = await projectToFiles({ projectJson: project });
  assert.ok(diagnostics.some((d) => d.code === 'FR305'));
  assert.doesNotMatch(text(files.get('S/main.fractch')), /arg\(/);
});

test('compareProjects reports what a change would lose', async () => {
  const before = sample();
  const after = structuredClone(before);
  delete after.targets[1].blocks.hat;
  delete after.targets[1].blocks.say;
  after.targets[2].name = 'Boss';
  after.customFonts.pop();
  const differences = await compareProjects(before, after);
  const paths = differences.map((d) => d.path);
  assert.ok(paths.includes('sprite "Hero".scripts'));
  assert.ok(paths.includes('sprite "Enemy"'));
  assert.ok(paths.includes('customFonts'));
});

test('memoryFs behaves like a small promises filesystem', async () => {
  const fs = memoryFs({ 'a/b.txt': 'hello' });
  assert.deepEqual(await fs.readdir('/a'), ['b.txt']);
  assert.equal(await fs.readFile('a/b.txt', 'utf8'), 'hello');
  assert.ok((await fs.stat('a')).isDirectory());
  await assert.rejects(fs.readFile('missing'), { code: 'ENOENT' });
  await assert.rejects(fs.rmdir('a'), { code: 'ENOTEMPTY' });
  await fs.unlink('a/b.txt');
  await fs.rmdir('a');
  assert.deepEqual(await fs.readdir(''), []);
});

test('the CLI writes, reads and packs .mwp project files', async (t) => {
  const dir = tempDir(t);
  const sb3 = path.join(dir, 'in.sb3');
  const zip = new AdmZip();
  zip.addFile('project.json', Buffer.from(JSON.stringify(sample())));
  for (const [name, data] of store) zip.addFile(name, Buffer.from(data));
  zip.writeZip(sb3);

  const unpacked = path.join(dir, 'tree');
  execFileSync('node', [cli, 'from', sb3, 'to', unpacked]);
  assert.ok(fs.existsSync(path.join(unpacked, 'fonts', 'Pixel.ttf')));
  assert.ok(fs.existsSync(path.join(unpacked, 'assets', 'levels', 'one.json')));

  const mwp = path.join(dir, 'project.mwp');
  execFileSync('node', [cli, mwp, 'from', unpacked]);
  const entries = new AdmZip(mwp).getEntries().map((e) => e.entryName);
  assert.ok(entries.includes('Hero/main.fractch'));
  assert.ok(entries.includes(METADATA_FILE));

  const fromMwp = path.join(dir, 'tree2');
  execFileSync('node', [cli, 'from', mwp, 'to', fromMwp]);
  assert.ok(fs.existsSync(path.join(fromMwp, 'Hero', 'main.fractch')));

  const out = path.join(dir, 'out.sb3');
  execFileSync('node', [cli, out, 'from', mwp]);
  const packed = new AdmZip(out);
  const projectJson = JSON.parse(packed.readAsText('project.json'));
  assert.equal(projectJson.customFonts[0].md5ext, fontId);
  assert.ok(packed.getEntry(dataId));
  assert.deepEqual(await compareProjects(sample(), projectJson), []);

  const historyOnly = path.join(dir, 'history.mwp');
  const history = new AdmZip();
  history.addFile('.git/HEAD', Buffer.from('ref: refs/heads/main\n'));
  history.addFile('mwp.json', Buffer.from('{}'));
  history.writeZip(historyOnly);
  assert.throws(
    () => execFileSync('node', [cli, 'from', historyOnly, 'to', path.join(dir, 'tree3')], { stdio: 'pipe' }),
    /only holds project history/
  );
});

test('projectAssetPaths names the file each costume and sound is written to', async () => {
  const project = sample();
  const paths = projectAssetPaths(project);
  assert.equal(paths.get('Hero/assets/idle.svg'), svgId);
  const { files } = await projectToFiles({ projectJson: project, readAsset });
  for (const p of paths.keys()) assert.ok(files.has(p), `${p} is written`);
});
