import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { convertProject } from '../src/convert.js';

const projectWithRegions = (regions) => {
  const blocks = {};
  const scripts = {};
  regions.forEach((region, index) => {
    const id = `hat${index}`;
    blocks[id] = {
      opcode: 'event_whenflagclicked',
      next: null,
      parent: null,
      inputs: {},
      fields: {},
      shadow: false,
      topLevel: true,
      x: 0,
      y: index * 100,
    };
    scripts[id] = region;
  });
  const map = `_fractch_map_${JSON.stringify({ version: 1, scripts })}`;
  return {
    targets: [
      {
        isStage: true,
        name: 'Stage',
        variables: {},
        lists: {},
        broadcasts: {},
        blocks: {},
        comments: {},
        currentCostume: 0,
        costumes: [],
        sounds: [],
        volume: 100,
        layerOrder: 0,
        tempo: 60,
        videoTransparency: 50,
        videoState: 'on',
        textToSpeechLanguage: null,
      },
      {
        isStage: false,
        name: 'S',
        variables: {},
        lists: {},
        broadcasts: {},
        blocks,
        comments: { m: { blockId: null, x: 0, y: 0, width: 200, height: 200, minimized: false, text: map } },
        currentCostume: 0,
        costumes: [],
        sounds: [],
        volume: 100,
        layerOrder: 1,
        visible: true,
        x: 0,
        y: 0,
        size: 100,
        direction: 90,
        draggable: false,
        rotationStyle: 'all around',
      },
    ],
    monitors: [],
    extensions: [],
    meta: { semver: '3.0.0', vm: '0.2.0', agent: '' },
  };
};

const listFiles = (dir) => {
  const out = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current)) {
      const full = path.join(current, entry);
      if (fs.statSync(full).isDirectory()) walk(full);
      else out.push(path.relative(dir, full));
    }
  };
  walk(dir);
  return out.sort();
};

test('region names from a project cannot write outside the sprite folder', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fractch-region-paths-'));
  try {
    const outDir = path.join(root, 'out');
    fs.mkdirSync(outDir);
    await convertProject(projectWithRegions(['../../escaped', '/abs/path', 'C:/win', '.hidden', 'ok/nested', 'fine']), {
      outDir,
      fs,
    });
    assert.deepEqual(listFiles(root), [
      'out/S/abs/path.fractch',
      'out/S/fine.fractch',
      'out/S/main.fractch',
      'out/S/ok/nested.fractch',
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
