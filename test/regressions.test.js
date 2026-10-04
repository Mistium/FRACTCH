import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProjectFromBuildDir, convertProject, formatProject, checkProject } from '../src/index.js';
import { checkFractch } from '../src/lint.js';
import { parseFractch } from '../src/parse.js';
import { join } from '../src/pathUtils.js';
import { verifyRoundtrip } from '../src/roundtripDiff.js';
import { runStage } from './support/scratch-sim.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin', 'cli.js');

function tempDir(t, prefix = 'fractch-reg-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeFiles(dir, files) {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

async function pack(t, files) {
  const dir = writeFiles(tempDir(t), files);
  return (await buildProjectFromBuildDir({ buildDir: dir, prune: false })).manifest;
}

// project.json -> .fractch -> project.json
async function roundTrip(t, project) {
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

const stageTarget = (blocks = {}, extra = {}) => ({
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
const spriteTarget = (name, blocks = {}, extra = {}) => ({
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
const projectOf = (...targets) => ({ targets, monitors: [], extensions: [], meta: { semver: '3.0.0' } });
const flag = (next) => ({
  opcode: 'event_whenflagclicked',
  next,
  parent: null,
  inputs: {},
  fields: {},
  topLevel: true,
  x: 0,
  y: 0,
});
const stmt = (opcode, parent, inputs = {}, fields = {}, next = null) => ({
  opcode,
  next,
  parent,
  inputs,
  fields,
  shadow: false,
  topLevel: false,
});
const blocksOf = (manifest, name = 'Stage') => Object.values(manifest.targets.find((t) => t.name === name).blocks);

test('lint reports the same lines and 1-based columns as the parser, past a header', () => {
  const src = '/**\n * target: Stage\n * targetId: \n */\nwhen flag {\n  foo];\n}\n';
  const [err] = checkFractch(src);
  assert.equal(err.line, 6);
  assert.equal(err.col, 6);
});

test('lint accepts nested templates and quotes inside interpolations', () => {
  assert.deepEqual(checkFractch("say `Hello ${`${name}'s turn`}`;"), []);
  assert.deepEqual(checkFractch('say `${contains(v, "`")}x`;'), []);
  assert.match(checkFractch('say `a${b')[0].message, /unterminated template/);
});

test('a UTF-8 BOM does not break parsing', () => {
  const parsed = parseFractch('﻿when flag {\r\n  say "s";\r\n}\r\n');
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(checkFractch('﻿when flag { say 1; }'), []);
});

test('JSON escapes the emitter writes (\\u, \\b, \\f) parse back', async (t) => {
  const value = 'A\u0001B\bC\fD';
  const project = projectOf(
    stageTarget(
      { h: flag('s'), s: stmt('looks_say', 'h', { MESSAGE: [1, [10, value]] }) },
      { variables: { v: ['chars', value] } }
    )
  );
  const { manifest } = await roundTrip(t, project);
  assert.deepEqual(manifest.targets[0].variables.v, ['chars', value]);
  const say = blocksOf(manifest).find((b) => b.opcode === 'looks_say');
  assert.equal(say.inputs.MESSAGE[1][1], value);
});

test('a script body cannot hold top-level declarations', () => {
  const { errors } = parseFractch('when flag { var x = 1; say x; }');
  assert.match(errors[0].message, /'var' only works at the top level/);
});

test('stdlib strings.replace finds matches after a partial match', async (t) => {
  const manifest = await pack(t, {
    'Stage/main.fractch':
      'import "fractch/strings";\nwhen flag {\n' +
      '  say strings.replace("abb", "ab", "X");\n' +
      '  say strings.replace("aaa", "aa", "X");\n' +
      '  say strings.replace("a-b-c", "-", " ");\n' +
      '  say strings.replace("abc", "", "X");\n' +
      '}\n',
  });
  assert.deepEqual(runStage(manifest.targets[0]), ['Xb', 'Xa', 'a b c', 'XaXbXc']);
});

test('stdlib json.get_from finds every key and only compares keys', async (t) => {
  const manifest = await pack(t, {
    'Stage/main.fractch':
      'import "fractch/json";\nwhen flag {\n' +
      '  say json.get_from("a", "{\\"a\\":1,\\"b\\":2,\\"c\\":3}");\n' +
      '  say json.get_from("c", "{\\"a\\":1,\\"b\\":2,\\"c\\":3}");\n' +
      '  say json.get_from("x", "{\\"a\\":\\"q\\",\\"b\\":\\"x\\",\\"x\\":\\"y\\"}");\n' +
      '  say json.get_from("missing", "{\\"a\\":1}");\n' +
      '}\n',
  });
  assert.deepEqual(runStage(manifest.targets[0]).map(String), ['1', '3', 'y', '']);
});

test('broadcasting a variable stays a variable reporter', async (t) => {
  const project = projectOf(
    stageTarget(
      {
        h: flag('b'),
        b: stmt('event_broadcast', 'h', { BROADCAST_INPUT: [3, [12, 'score', 'vS'], [11, 'go', 'bGo']] }),
      },
      { variables: { vS: ['score', 'go'] }, broadcasts: { bGo: 'go' } }
    )
  );
  const { texts, manifest } = await roundTrip(t, project);
  assert.match(texts['Stage/main.fractch'], /broadcast vars\["score"\];/);
  const b = blocksOf(manifest).find((x) => x.opcode === 'event_broadcast');
  assert.deepEqual(b.inputs.BROADCAST_INPUT[1], [12, 'score', 'vS']);
});

test('a local is scoped to its script on both pack and convert', async (t) => {
  const manifest = await pack(t, {
    'Spr/main.fractch': 'sprite "Spr";\nwhen flag { local x = 1; say x; }\nwhen clicked { x = 2; say x; }\n',
  });
  const sets = blocksOf(manifest, 'Spr').filter((b) => b.opcode === 'data_setvariableto');
  assert.deepEqual(sets.map((b) => b.fields.VARIABLE[0]).sort(), ['!local_f_x', 'x']);

  const project = projectOf(
    stageTarget(),
    spriteTarget(
      'Spr',
      {
        h: flag('a'),
        a: stmt('data_setvariableto', 'h', { VALUE: [1, [10, 'q']] }, { VARIABLE: ['!local_flagclicked_x', 'L1'] }),
        h2: { ...flag('c'), y: 300 },
        c: stmt('looks_say', 'h2', { MESSAGE: [3, [12, '!local_flagclicked_x', 'L1'], [10, '']] }),
      },
      { variables: { L1: ['!local_flagclicked_x', 0], G: ['temp', 5] } }
    )
  );
  const { texts } = await roundTrip(t, project);
  assert.match(texts['Spr/main.fractch'], /say vars\["!local_flagclicked_x"\];/);
});

test('a global shadowed by a local of the same name is written vars["..."]', async (t) => {
  const dir = writeFiles(tempDir(t), {
    'Stage/main.fractch':
      'var temp = 5;\nwhen flag {\n  local temp = 1;\n  vars["temp"] = 2;\n  temp += 1;\n  say vars["temp"];\n}\n',
  });
  const { manifest } = await buildProjectFromBuildDir({ buildDir: dir, prune: false });
  const { texts } = await roundTrip(t, manifest);
  assert.match(
    texts['Stage/main.fractch'],
    /local temp = 1;\n\s*vars\["temp"\] = 2;\n\s*temp \+= 1;\n\s*say vars\["temp"\];/
  );
});

test('variable fields keep their id when the name alone would bind elsewhere', async (t) => {
  const project = projectOf(
    stageTarget({}, { variables: { g1: ['score', 0], g3: ['dup', 1], g4: ['dup', 2] } }),
    spriteTarget(
      'Spr',
      {
        h: flag('a'),
        a: stmt('data_setvariableto', 'h', { VALUE: [1, [10, '5']] }, { VARIABLE: ['score', 'g1'] }, 'b'),
        b: stmt('data_changevariableby', 'a', { VALUE: [1, [4, '1']] }, { VARIABLE: ['dup', 'g4'] }, 'c'),
        c: stmt('data_showvariable', 'b', {}, { VARIABLE: ['dup', 'g4'] }),
      },
      { variables: { v1: ['score', 'mine'] } }
    )
  );
  const { manifest } = await roundTrip(t, project);
  const fields = blocksOf(manifest, 'Spr')
    .filter((b) => b.fields.VARIABLE)
    .map((b) => b.fields.VARIABLE);
  assert.deepEqual(fields, [
    ['score', 'g1'],
    ['dup', 'g4'],
    ['dup', 'g4'],
  ]);
});

test('a sprite name with */ cannot end the header comment', async (t) => {
  const project = projectOf(
    stageTarget(),
    spriteTarget('x */ when flag { say 1; } /*', {
      h: flag('s'),
      s: stmt('looks_say', 'h', { MESSAGE: [1, [10, 'hi']] }),
    })
  );
  const { manifest } = await roundTrip(t, project);
  const sprite = manifest.targets.find((x) => !x.isStage);
  assert.equal(sprite.name, 'x */ when flag { say 1; } /*');
  assert.equal(Object.keys(sprite.blocks).length, 2);
});

test('comments attach to hats, the brace owner, and the line below', async (t) => {
  const manifest = await pack(t, {
    'Stage/main.fractch':
      'when flag { // on hat\n  repeat 3 { // on repeat\n    say 1;\n  }\n}\n' +
      'def @f() {\n  // on first say\n  say 2;\n}\n',
  });
  const st = manifest.targets[0];
  const on = (text) => st.blocks[Object.values(st.comments).find((c) => c.text === text).blockId].opcode;
  assert.equal(on('on hat'), 'event_whenflagclicked');
  assert.equal(on('on repeat'), 'control_repeat');
  assert.equal(on('on first say'), 'looks_say');

  const project = projectOf(
    stageTarget(
      { h: { ...flag('s'), comment: 'c1' }, s: stmt('looks_say', 'h', { MESSAGE: [1, [10, 'hi']] }) },
      { comments: { c1: { blockId: 'h', x: 0, y: 0, width: 200, height: 200, minimized: false, text: 'note' } } }
    )
  );
  const back = (await roundTrip(t, project)).manifest.targets[0];
  assert.equal(back.blocks[Object.values(back.comments)[0].blockId].opcode, 'event_whenflagclicked');
});

test('a """ inside a comment does not shift raw-string indentation', async (t) => {
  const project = projectOf(
    stageTarget(
      {
        h: flag('f'),
        f: stmt('control_forever', 'h', { SUBSTACK: [2, 's1'] }),
        s1: { ...stmt('looks_say', 'f', { MESSAGE: [1, [10, 'hi']] }, {}, 's2'), comment: 'c1' },
        s2: stmt('looks_say', 's1', { MESSAGE: [1, [10, 'line1\nline2']] }),
      },
      {
        comments: {
          c1: { blockId: 's1', x: 0, y: 0, width: 200, height: 200, minimized: false, text: 'use """ here' },
        },
      }
    )
  );
  const { manifest } = await roundTrip(t, project);
  const says = blocksOf(manifest).filter((b) => b.opcode === 'looks_say');
  assert.deepEqual(says.map((b) => b.inputs.MESSAGE[1][1]).sort(), ['hi', 'line1\nline2']);
});

test('generated ids are unique across variables, lists and broadcasts', async (t) => {
  const manifest = await pack(t, {
    'Stage/main.fractch': 'var "a b" = 1;\nwhen flag { inv = 5; append(inv, "x"); go = 1; broadcast go; }\n',
    'Spr/main.fractch': 'sprite "Spr";\nvar a_b = 2;\n',
  });
  const ids = manifest.targets.flatMap((x) =>
    [x.variables, x.lists, x.broadcasts].flatMap((d) => Object.keys(d || {}))
  );
  assert.equal(new Set(ids).size, ids.length, `duplicate ids: ${ids}`);
  const stage = manifest.targets.find((x) => x.isStage);
  assert.ok(Object.values(stage.variables).some(([n]) => n === 'inv'));
  assert.ok(Object.values(stage.lists).some(([n]) => n === 'inv'));
});

test('a // comment above a def keeps its calls bound to it', async (t) => {
  const manifest = await pack(t, {
    'Stage/main.fractch': '// greets\ndef @greet(who) warp { say who; }\nwhen flag { @greet("bob"); }\n',
  });
  const call = blocksOf(manifest).find((b) => b.opcode === 'procedures_call');
  assert.equal(call.mutation.proccode, 'greet %s');
  assert.equal(call.mutation.warp, 'true');
});

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

test('for i in X counts when X is a parameter, local, or vars["X"]', async (t) => {
  const manifest = await pack(t, {
    'Stage/main.fractch':
      'var items = ["a", "b"];\n' +
      'def @Count(items) { for i in items { say i; } }\n' +
      'when flag { local items = 3; for j in items { say j; } for k in vars["items"] { say k; } }\n',
  });
  assert.equal(blocksOf(manifest).filter((b) => b.opcode === 'data_itemoflist').length, 0);
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

test('cloud variables are reachable by bare name from any target', async (t) => {
  const manifest = await pack(t, {
    'Stage/main.fractch': 'cloud plays = 0;\nwatch var "plays" at 5,5;\n',
    'Spr/main.fractch': 'sprite "Spr";\nwhen flag { plays += 1; }\n',
  });
  const change = blocksOf(manifest, 'Spr').find((b) => b.opcode === 'data_changevariableby');
  assert.equal(change.fields.VARIABLE[0], '☁ plays');
  assert.deepEqual(manifest.targets.find((x) => x.name === 'Spr').variables, {});
  assert.equal(manifest.monitors.length, 1);
});

test('loose variable and list reporters in compact form survive convert', async (t) => {
  const project = projectOf(
    stageTarget(
      { v: [12, 'score', 'g1', 800, 900], l: [13, 'inv', 'l1', 850, 950] },
      { variables: { g1: ['score', 0] }, lists: { l1: ['inv', []] } }
    )
  );
  const { manifest } = await roundTrip(t, project);
  const loose = blocksOf(manifest).map((b) => [b.opcode, b.x, b.y]);
  assert.deepEqual(loose.sort(), [
    ['data_listcontents', 850, 950],
    ['data_variable', 800, 900],
  ]);
});

test('sprites keep their own parameter names for a shared proccode', async (t) => {
  const def = (arg) => ({
    d: {
      opcode: 'procedures_definition',
      next: 's',
      parent: null,
      inputs: { custom_block: [1, 'p'] },
      fields: {},
      shadow: false,
      topLevel: true,
      x: 0,
      y: 0,
    },
    p: {
      opcode: 'procedures_prototype',
      next: null,
      parent: 'd',
      inputs: {},
      fields: {},
      shadow: true,
      topLevel: false,
      mutation: {
        tagName: 'mutation',
        children: [],
        proccode: 'foo %s',
        argumentids: '["a1"]',
        argumentnames: JSON.stringify([arg]),
        argumentdefaults: '[""]',
        warp: 'false',
      },
    },
    s: stmt('looks_say', 'd', { MESSAGE: [3, 'r', [10, '']] }),
    r: stmt('argument_reporter_string_number', 's', {}, { VALUE: [arg, null] }),
  });
  const project = projectOf(stageTarget(), spriteTarget('A', def('a')), spriteTarget('B', def('b'), { layerOrder: 2 }));
  const { texts } = await roundTrip(t, project);
  assert.match(texts['B/main.fractch'], /def @foo\(b\)[^{]*\{\n\s*say b;/);
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
  await formatProject({ buildDir: dir });
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

test('a file with a syntax error is reported, not silently dropped', async (t) => {
  const dir = writeFiles(tempDir(t), { 'Stage/main.fractch': 'when flag {\n  say ("hi";\n}\n' });
  const warnings = [];
  const warn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    await buildProjectFromBuildDir({ buildDir: dir, prune: false });
  } finally {
    console.warn = warn;
  }
  assert.ok(warnings.some((w) => /skipped unparsable file/.test(w)));
});

test('roundtrip verification still passes for the regression fixtures', async (t) => {
  const project = projectOf(
    stageTarget(
      { h: flag('s'), s: stmt('looks_say', 'h', { MESSAGE: [1, [10, 'hi']] }) },
      { variables: { g1: ['score', 0] } }
    )
  );
  const { out } = await roundTrip(t, project);
  const result = await verifyRoundtrip({ project, buildDir: out, fs });
  assert.deepEqual(result.failures, []);
});

test('verifyRoundtrip pairs scripts across files and checks reference kinds', async (t) => {
  const say = (parent, message) => stmt('looks_say', parent, { MESSAGE: message });
  const project = projectOf(
    stageTarget(
      {
        h1: flag('s1'),
        s1: say('h1', [1, [10, 'one']]),
        h2: { ...flag('s2'), y: 300 },
        s2: say('h2', [3, [12, 'score', 'v'], [10, '']]),
      },
      { variables: { v: ['score', 0] } }
    )
  );
  const out = tempDir(t);
  await convertProject(structuredClone(project), { outDir: out });
  const main = path.join(out, 'Stage', 'main.fractch');
  // Move the first script into a file that sorts before main.fractch.
  const text = fs.readFileSync(main, 'utf8');
  const first = /when flag at 0,0 \{\n {2}say "one";\n\}\n/;
  fs.writeFileSync(path.join(out, 'Stage', 'a.fractch'), text.match(first)[0]);
  fs.writeFileSync(main, text.replace(first, ''));
  assert.deepEqual((await verifyRoundtrip({ project, buildDir: out, fs })).failures, []);

  fs.writeFileSync(main, fs.readFileSync(main, 'utf8').replace('say score;', 'say "score";'));
  const { failures } = await verifyRoundtrip({ project, buildDir: out, fs });
  assert.match(failures[0].err, /reference kind/);
});
