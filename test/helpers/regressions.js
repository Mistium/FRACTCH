import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProjectFromBuildDir, convertProject } from '../../src/index.js';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const cli = path.join(root, 'bin', 'cli.js');

export function tempDir(t, prefix = 'fractch-reg-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export function writeFiles(dir, files) {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

export async function pack(t, files) {
  const dir = writeFiles(tempDir(t), files);
  return (await buildProjectFromBuildDir({ buildDir: dir, prune: false })).manifest;
}

// project.json -> .fractch -> project.json
export async function roundTrip(t, project) {
  const out = tempDir(t);
  await convertProject(structuredClone(project), { outDir: out });
  const texts = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith('.fractch'))
        texts[path.relative(out, p).split(path.sep).join('/')] = fs.readFileSync(p, 'utf8');
    }
  };
  walk(out);
  const { manifest } = await buildProjectFromBuildDir({ buildDir: out, prune: false });
  return { out, texts, manifest };
}

export const stageTarget = (blocks = {}, extra = {}) => ({
  isStage: true,
  name: 'Stage',
  variables: {},
  lists: {},
  broadcasts: {},
  blocks,
  comments: {},
  currentCostume: 0,
  costumes: [],
  sounds: [],
  volume: 100,
  layerOrder: 0,
  ...extra,
});
export const spriteTarget = (name, blocks = {}, extra = {}) => ({
  ...stageTarget(blocks, extra),
  isStage: false,
  name,
  visible: true,
  x: 0,
  y: 0,
  size: 100,
  direction: 90,
  draggable: false,
  rotationStyle: 'all around',
  layerOrder: 1,
  ...extra,
});
export const projectOf = (...targets) => ({ targets, monitors: [], extensions: [], meta: { semver: '3.0.0' } });
export const flag = (next) => ({
  opcode: 'event_whenflagclicked',
  next,
  parent: null,
  inputs: {},
  fields: {},
  topLevel: true,
  x: 0,
  y: 0,
});
export const stmt = (opcode, parent, inputs = {}, fields = {}, next = null) => ({
  opcode,
  next,
  parent,
  inputs,
  fields,
  shadow: false,
  topLevel: false,
});
export const blocksOf = (manifest, name = 'Stage') =>
  Object.values(manifest.targets.find((t) => t.name === name).blocks);
