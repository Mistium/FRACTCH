import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { convertProject } from '../src/convert.js';
import { checkProject } from '../src/check.js';
import { parseFractch } from '../src/parse.js';
import { BLANK_SVG, buildProjectFromBuildDir } from '../src/pack.js';
import { verifyRoundtrip } from '../src/roundtripDiff.js';

const target = (name, blocks, extra = {}) => ({
  isStage: name === 'Stage',
  name,
  variables: {},
  lists: {},
  broadcasts: {},
  blocks,
  comments: {},
  currentCostume: 0,
  costumes: [],
  sounds: [],
  volume: 100,
  layerOrder: name === 'Stage' ? 0 : 1,
  ...extra,
});

const hat = (next) => ({
  opcode: 'event_whenflagclicked',
  next,
  parent: null,
  inputs: {},
  fields: {},
  topLevel: true,
  shadow: false,
  x: 10,
  y: 20,
});

const projects = [
  {
    name: 'variables, comments, monitors, and unicode',
    project: {
      targets: [
        target(
          'Stage',
          {
            hat: hat('change'),
            change: {
              opcode: 'data_changevariableby',
              next: 'say',
              parent: 'hat',
              inputs: { VALUE: [1, [4, '1']] },
              fields: { VARIABLE: ['☁ score', 'score-id'] },
              topLevel: false,
              shadow: false,
            },
            say: {
              opcode: 'looks_say',
              next: null,
              parent: 'change',
              inputs: { MESSAGE: [1, [10, 'hello 🌍']] },
              fields: {},
              topLevel: false,
              shadow: false,
              comment: 'comment-id',
            },
          },
          {
            variables: { 'score-id': ['☁ score', 0, true] },
            comments: {
              'comment-id': {
                blockId: 'say',
                x: 250,
                y: 20,
                width: 200,
                height: 100,
                minimized: false,
                text: 'visible note',
              },
            },
          }
        ),
      ],
      monitors: [
        {
          id: 'score-id',
          mode: 'slider',
          opcode: 'data_variable',
          params: { VARIABLE: '☁ score' },
          spriteName: null,
          value: 0,
          width: 0,
          height: 0,
          x: 5,
          y: 6,
          visible: true,
          sliderMin: 0,
          sliderMax: 10,
          isDiscrete: true,
        },
      ],
      extensions: [],
      meta: { semver: '3.0.0' },
    },
  },
  {
    name: 'branches and visible menu shadows',
    project: {
      targets: [
        target('Stage', {}),
        target(
          'Player',
          {
            hat: hat('if'),
            if: {
              opcode: 'control_if',
              next: null,
              parent: 'hat',
              inputs: { CONDITION: [2, 'pressed'], SUBSTACK: [2, 'say'] },
              fields: {},
              topLevel: false,
              shadow: false,
            },
            pressed: {
              opcode: 'sensing_keypressed',
              next: null,
              parent: 'if',
              inputs: { KEY_OPTION: [1, 'menu'] },
              fields: {},
              topLevel: false,
              shadow: false,
            },
            menu: {
              opcode: 'sensing_keyoptions',
              next: null,
              parent: 'pressed',
              inputs: {},
              fields: { KEY_OPTION: ['space', null] },
              topLevel: false,
              shadow: true,
            },
            say: {
              opcode: 'looks_sayforsecs',
              next: null,
              parent: 'if',
              inputs: { MESSAGE: [1, [10, 'pressed']], SECS: [1, [4, '2']] },
              fields: {},
              topLevel: false,
              shadow: false,
            },
          },
          { visible: true, x: 0, y: 0, size: 100, direction: 90, draggable: false, rotationStyle: 'all around' }
        ),
      ],
      monitors: [],
      extensions: [],
      meta: { semver: '3.0.0' },
    },
  },
];

const fractchFiles = (dir) => {
  const out = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.fractch')) out.push(full);
    }
  };
  walk(dir);
  return out;
};

for (const { name, project } of projects) {
  test(`self-contained regression corpus: ${name}`, async (t) => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'fractch-corpus-'));
    const stable = fs.mkdtempSync(path.join(os.tmpdir(), 'fractch-corpus-stable-'));
    t.after(() => {
      fs.rmSync(out, { recursive: true, force: true });
      fs.rmSync(stable, { recursive: true, force: true });
    });

    await convertProject(project, { outDir: out, fs });
    const files = fractchFiles(out);
    assert.ok(files.length > 0);
    for (const file of files) {
      const parsed = parseFractch(fs.readFileSync(file, 'utf8'));
      assert.deepEqual(parsed.errors || [], [], `parse errors in ${path.relative(out, file)}`);
    }

    const checked = await checkProject({ buildDir: out, fs });
    assert.deepEqual(checked.problems, []);

    const roundtrip = await verifyRoundtrip({ project, buildDir: out, fs });
    assert.deepEqual(roundtrip.failures, []);
    assert.equal(roundtrip.ok, roundtrip.total);

    const { manifest } = await buildProjectFromBuildDir({ buildDir: out, fs, prune: false });
    await convertProject(manifest, { outDir: stable, fs });

    for (const file of fractchFiles(stable)) {
      const source = fs.readFileSync(file, 'utf8');
      for (const match of source.matchAll(/\bfile\s+"([^"]+\.svg)"/g)) {
        const asset = path.join(path.dirname(file), ...match[1].split('/'));
        fs.mkdirSync(path.dirname(asset), { recursive: true });
        if (!fs.existsSync(asset)) fs.writeFileSync(asset, BLANK_SVG);
      }
    }
    const { manifest: second } = await buildProjectFromBuildDir({ buildDir: stable, fs, prune: false });
    assert.deepEqual(
      second.targets.map((item) => item.blocks),
      manifest.targets.map((item) => item.blocks),
      'blocks changed after reaching the canonical representation'
    );
  });
}
