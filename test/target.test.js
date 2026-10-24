import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emitTarget, buildTarget, toReplaceChange, findInSourceMap } from '../src/target.js';
import { convertProject } from '../src/convert.js';
import { buildProjectFromBuildDir } from '../src/pack.js';
import { parseFractch } from '../src/parse.js';
import { liveContext, applyResult, sortedJson } from './helpers/live-context.js';
import { packFiles } from './helpers/project.js';

const CAT = [
  'sprite "Cat";',
  'var hp = 3;',
  'import "fractch/strings";',
  'when broadcast ab at 0,0 {',
  '  local t = 1;',
  '  say t;',
  '}',
  'when flag at 0,300 {',
  '  local t = 2;',
  '  say t + hp + 1;',
  '  say strings.chr(65);',
  '}',
  'def @f(x) at 0,600 {',
  '  say x;',
  '}',
  '',
].join('\n');

async function catContext() {
  const manifest = await packFiles({
    'Stage/main.fractch': 'var score = 0;\nwhen flag {\n  score = 1;\n}\n',
    'Cat/main.fractch': CAT,
    'Cat/systems/ui.fractch': 'when clicked {\n  hide;\n}\n',
  });
  const ctx = liveContext(manifest);
  return { ctx, cat: ctx.targets.find((t) => t.name === 'Cat') };
}

function scriptIds(blocks, top) {
  const out = new Set();
  const stack = [top];
  while (stack.length) {
    const id = stack.pop();
    if (!id || out.has(id) || !blocks[id]) continue;
    out.add(id);
    const b = blocks[id];
    if (b.next) stack.push(b.next);
    for (const t of Object.values(b.inputs || {})) for (const x of t.slice(1)) if (typeof x === 'string') stack.push(x);
  }
  return out;
}

function topOf(text, sourceMap, needle) {
  const at = text.indexOf(needle);
  return Object.entries(sourceMap.scripts).find(([, r]) => at >= r.from && at < r.to)?.[0];
}

function stripSidecars(target) {
  const out = { ...target };
  delete out.primitiveIds;
  delete out.obscuredShadows;
  return out;
}

function errors(result) {
  return result.diagnostics.filter((d) => d.severity === 'error');
}

test('an unedited target comes back identical through emitTarget and buildTarget', async () => {
  const { ctx, cat } = await catContext();
  const emitted = emitTarget(ctx, cat.id);
  assert.deepEqual(emitted.lockedScripts, []);
  assert.match(emitted.text, /^import "fractch\/strings";/);
  assert.match(emitted.text, /region "systems\/ui" \{/);
  assert.doesNotMatch(emitted.text, /_fractch_map_|sprite "Cat"/);
  const built = buildTarget(ctx, cat.id, emitted.text, { previous: emitted });
  assert.deepEqual(errors(built), []);
  assert.deepEqual(sortedJson(built.target.blocks), sortedJson(cat.blocks));
  assert.deepEqual(sortedJson(built.target.comments), sortedJson(cat.comments));
  assert.deepEqual(sortedJson(built.target.variables), sortedJson(cat.variables));
  assert.deepEqual(sortedJson(built.primitiveIds), sortedJson(cat.primitiveIds));
  assert.deepEqual(built.changed, []);
  assert.deepEqual(built.created.scripts, []);
  assert.deepEqual(built.removed.scripts, []);
});

test('an edit to one script changes ids only in that script and keeps every local tag', async () => {
  const { ctx, cat } = await catContext();
  const emitted = emitTarget(ctx, cat.id);
  const flagTop = topOf(emitted.text, emitted.sourceMap, 'when flag');
  const abTop = topOf(emitted.text, emitted.sourceMap, 'when broadcast ab');
  const edited =
    emitted.text.replace('say t + hp + 1;', 'say t + hp + 2;') + '\nwhen broadcast a {\n  local t = 5;\n  say t;\n}\n';
  const built = buildTarget(ctx, cat.id, edited, { previous: emitted });
  assert.deepEqual(errors(built), []);
  assert.deepEqual(
    built.changed.map((c) => c.topId),
    [flagTop]
  );
  assert.equal(built.created.scripts.length, 1);
  for (const [id, block] of Object.entries(cat.blocks)) {
    if (scriptIds(cat.blocks, flagTop).has(id)) continue;
    assert.strictEqual(built.target.blocks[id], block, `untouched block ${id} was rebuilt`);
  }
  assert.ok(built.target.blocks[flagTop], 'the edited script keeps its top id');
  const oldFlag = scriptIds(cat.blocks, flagTop);
  const newFlag = scriptIds(built.target.blocks, flagTop);
  const kept = [...newFlag].filter((id) => oldFlag.has(id));
  assert.ok(kept.length >= oldFlag.size - 1, 'most ids of the edited script are reused');
  const localNames = (blocks, top) => {
    const names = new Set();
    for (const id of scriptIds(blocks, top)) {
      const v = blocks[id].fields?.VARIABLE?.[0];
      if (String(v).startsWith('!local_')) names.add(v);
      for (const t of Object.values(blocks[id].inputs || {})) {
        for (const x of t.slice(1)) if (Array.isArray(x) && String(x[1]).startsWith('!local_')) names.add(x[1]);
      }
    }
    return names;
  };
  assert.deepEqual(localNames(built.target.blocks, abTop), localNames(cat.blocks, abTop));
  assert.deepEqual(localNames(built.target.blocks, flagTop), localNames(cat.blocks, flagTop));
  const newTop = built.created.scripts[0];
  const fresh = [...localNames(built.target.blocks, newTop)];
  assert.equal(fresh.length, 1);
  assert.ok(!localNames(built.target.blocks, abTop).has(fresh[0]));
  assert.ok(!localNames(built.target.blocks, flagTop).has(fresh[0]));
  const ids = new Map();
  for (const [id, entry] of Object.entries(built.target.variables)) {
    if (!String(entry[0]).startsWith('!local_') || /^!local_for\d+_/.test(entry[0])) continue;
    assert.ok(!ids.has(entry[0]), `local ${entry[0]} is declared twice`);
    ids.set(entry[0], id);
  }
});

test('stdlib imports and regions survive an edit, and moving a script out of a region moves it', async () => {
  const { ctx, cat } = await catContext();
  const emitted = emitTarget(ctx, cat.id);
  const edited = emitted.text.replace('say t;', 'say t + 1;');
  const built = buildTarget(ctx, cat.id, edited, { previous: emitted });
  assert.deepEqual(errors(built), []);
  const map = Object.values(built.target.comments).find((c) => c.text.startsWith('_fractch_map_'));
  const data = JSON.parse(map.text.slice('_fractch_map_'.length));
  assert.ok(Object.values(data.scripts).includes('systems/ui'));
  assert.ok(Object.values(data.modules).includes('fractch/strings'));
  const next = applyResult(ctx, cat.id, built);
  const again = emitTarget(next, cat.id);
  assert.match(again.text, /^import "fractch\/strings";/);
  assert.match(again.text, /region "systems\/ui"/);

  const moved = again.text.replace(/region "systems\/ui" \{\n {2}(when clicked[^]*?\n {2}\})\n\}/, (m, body) =>
    body.replace(/\n {2}/g, '\n')
  );
  assert.doesNotMatch(moved, /region/);
  const movedBuild = buildTarget(next, cat.id, moved, { previous: again, verifyRoundTrip: true });
  assert.deepEqual(errors(movedBuild), []);
  assert.deepEqual(movedBuild.changed, []);
  const final = applyResult(next, cat.id, movedBuild);
  assert.doesNotMatch(emitTarget(final, cat.id).text, /region/);

  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'fractch-region-'));
  try {
    await convertProject({ targets: final.targets.map(stripSidecars) }, { outDir: out, fs });
    assert.ok(!fs.existsSync(path.join(out, 'Cat', 'systems', 'ui.fractch')));
    assert.match(fs.readFileSync(path.join(out, 'Cat', 'main.fractch'), 'utf8'), /when clicked/);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('the git tree from convertProject is unchanged for untouched targets', async () => {
  const { ctx, cat } = await catContext();
  const strip = (c) => ({ targets: c.targets.map(stripSidecars) });
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'fractch-git-a-'));
  const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'fractch-git-b-'));
  try {
    await convertProject(strip(ctx), { outDir: dirA, fs });
    const emitted = emitTarget(ctx, cat.id);
    const built = buildTarget(ctx, cat.id, emitted.text.replace('say x;', 'say x + 1;'), { previous: emitted });
    await convertProject(strip(applyResult(ctx, cat.id, built)), { outDir: dirB, fs });
    assert.equal(
      fs.readFileSync(path.join(dirA, 'Stage', 'main.fractch'), 'utf8'),
      fs.readFileSync(path.join(dirB, 'Stage', 'main.fractch'), 'utf8')
    );
    assert.equal(
      fs.readFileSync(path.join(dirA, 'Cat', 'systems', 'ui.fractch'), 'utf8'),
      fs.readFileSync(path.join(dirB, 'Cat', 'systems', 'ui.fractch'), 'utf8')
    );
    for (const file of [path.join(dirB, 'Cat', 'main.fractch'), path.join(dirB, 'Stage', 'main.fractch')]) {
      const text = fs.readFileSync(file, 'utf8');
      assert.doesNotMatch(text, /_fractch_map_|fractch:file/);
    }
  } finally {
    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });
  }
});

function operatorProject() {
  const block = (opcode, next, parent, inputs, extra = {}) => ({
    opcode,
    next,
    parent,
    inputs,
    fields: {},
    shadow: false,
    topLevel: false,
    ...extra,
  });
  return {
    targets: [
      {
        isStage: true,
        name: 'Stage',
        variables: { v: ['x', 0] },
        lists: {},
        broadcasts: {},
        comments: {},
        blocks: {
          hat: block('event_whenflagclicked', 'say', null, {}, { topLevel: true, x: 0, y: 0 }),
          say: block('looks_say', 'think', 'hat', { MESSAGE: [3, 'outer', [10, 'hi']] }),
          outer: block('operator_add', null, 'say', { NUM1: [3, 'inner', [4, '7']], NUM2: [1, [4, '5']] }),
          inner: block('operator_add', null, 'outer', { NUM1: [3, [12, 'x', 'v'], [4, '1']], NUM2: [1, [4, '2']] }),
          think: block('looks_think', null, 'say', { MESSAGE: [1, [10, 'before']] }),
        },
      },
    ],
  };
}

test('a collapsed operator keeps its hidden head value through an edit to another part of the script', () => {
  const ctx = liveContext(operatorProject());
  const stage = ctx.targets[0];
  assert.equal(stage.blocks.outer.mutation.itemcount, '3');
  assert.equal(stage.obscuredShadows.outer.length, 1);
  const emitted = emitTarget(ctx, stage.id);
  assert.match(emitted.text, /say \(\(x \?\? 1\) \+ 2 \+ 5 \?\? "hi"\);/);
  const built = buildTarget(ctx, stage.id, emitted.text.replace('"before"', '"after"'), { previous: emitted });
  assert.deepEqual(errors(built), []);
  assert.equal(built.changed.length, 1);
  assert.deepEqual(built.obscuredShadows.outer, stage.obscuredShadows.outer);
  assert.equal(built.target.blocks.outer.mutation.itemcount, '3');

  const lossy = buildTarget(ctx, stage.id, emitted.text.replace('(x ?? 1) + 2 + 5', '(x ?? 1) + 2'), {
    previous: emitted,
  });
  assert.ok(lossy.diagnostics.some((d) => d.code === 'FR221'));
});

test('variadic chains typed as text are built collapsed', () => {
  const ctx = liveContext(operatorProject());
  const stage = ctx.targets[0];
  const emitted = emitTarget(ctx, stage.id);
  const text = emitted.text.replace('  think "before";', '  say 1 ++ 2 ++ 3 ++ 4;\n  think "before";');
  const built = buildTarget(ctx, stage.id, text, { previous: emitted, verifyRoundTrip: true });
  assert.deepEqual(errors(built), []);
  const join = Object.values(built.target.blocks).find((b) => b.opcode === 'operator_join');
  assert.equal(join.mutation.itemcount, '4');
  assert.deepEqual(Object.keys(join.inputs), ['STRING1', 'STRING2', 'STRING3', 'STRING4']);
});

test('a locked script is carried by id through an edit to another script', () => {
  const project = operatorProject();
  const stage = project.targets[0];
  stage.blocks.hat2 = {
    opcode: 'event_whenthisspriteclicked',
    next: 'sayB',
    parent: null,
    inputs: {},
    fields: {},
    shadow: false,
    topLevel: true,
    x: 0,
    y: 400,
  };
  stage.blocks.sayB = {
    opcode: 'looks_say',
    next: null,
    parent: 'hat2',
    inputs: { MESSAGE: [3, 'rep', [10, '']] },
    fields: {},
    shadow: false,
    topLevel: false,
  };
  stage.blocks.rep = {
    opcode: 'motion_xposition',
    next: null,
    parent: 'sayB',
    inputs: {},
    fields: {},
    shadow: false,
    topLevel: false,
    comment: 'c1',
  };
  stage.comments.c1 = {
    blockId: 'rep',
    x: 10,
    y: 10,
    width: 200,
    height: 200,
    minimized: false,
    text: 'on a reporter',
  };
  const ctx = liveContext(project);
  const live = ctx.targets[0];
  const emitted = emitTarget(ctx, live.id);
  assert.deepEqual(
    emitted.lockedScripts.map((l) => l.topId),
    ['hat2']
  );
  const built = buildTarget(ctx, live.id, emitted.text.replace('"before"', '"after"'), {
    previous: emitted,
    lockedScripts: emitted.lockedScripts,
  });
  assert.deepEqual(errors(built), []);
  for (const id of ['hat2', 'sayB', 'rep']) assert.strictEqual(built.target.blocks[id], live.blocks[id]);
  assert.strictEqual(built.target.comments.c1, live.comments.c1);
  const placeholder = emitted.text.replace(/when clicked[^]*?\n\}/, 'locked script "hat2";');
  const viaPlaceholder = buildTarget(ctx, live.id, placeholder, { previous: emitted });
  assert.deepEqual(errors(viaPlaceholder), []);
  assert.strictEqual(viaPlaceholder.target.blocks.sayB, live.blocks.sayB);
});

test('an edit to the first of two identical scripts lands on that script', async () => {
  const script = 'when flag at 0,0 {\n  say 1;\n}\n';
  const manifest = await packFiles({ 'Stage/main.fractch': `${script}\n${script}` });
  const ctx = liveContext(manifest);
  const stage = ctx.targets[0];
  const emitted = emitTarget(ctx, stage.id);
  const [first, second] = Object.entries(emitted.sourceMap.scripts)
    .sort((a, b) => a[1].from - b[1].from)
    .map(([id]) => id);
  for (const [edited, other, text] of [
    [first, second, emitted.text.replace('say 1;', 'say 2;')],
    [second, first, emitted.text.replace(/say 1;(?![^]*say 1;)/, 'say 2;')],
  ]) {
    const built = buildTarget(ctx, stage.id, text, { previous: emitted });
    assert.deepEqual(errors(built), []);
    assert.deepEqual(
      built.changed.map((c) => c.topId),
      [edited]
    );
    assert.deepEqual(built.created.scripts, []);
    assert.deepEqual(built.unchangedScripts, [other]);
    for (const id of scriptIds(stage.blocks, other)) assert.strictEqual(built.target.blocks[id], stage.blocks[id]);
    assert.equal(built.sourceMap.scripts[edited].from, emitted.sourceMap.scripts[edited].from);
  }
});

test('variadic opcodes from the opcode table accept every numbered input', async () => {
  const opcodes = {
    opcodes: {
      event_whenflagclicked: { inputs: [], fields: [], hat: true },
      looks_say: { inputs: ['MESSAGE'], fields: [] },
      patching_jscommand: { inputs: ['ARG1'], fields: [], variadic: { prefix: 'ARG', minItems: 1, collapsed: false } },
    },
  };
  const manifest = await packFiles({ 'Stage/main.fractch': 'when flag {\n  say 1;\n}\n' });
  const ctx = liveContext(manifest);
  const id = ctx.targets[0].id;
  const emitted = emitTarget(ctx, id, { opcodes });
  const built = buildTarget(ctx, id, emitted.text.replace('say 1;', 'js "a" 1 "b";'), { previous: emitted, opcodes });
  assert.deepEqual(errors(built), []);
  const js = Object.values(built.target.blocks).find((b) => b.opcode === 'patching_jscommand');
  assert.deepEqual(Object.keys(js.inputs), ['ARG1', 'ARG2', 'ARG3']);
  const bad = buildTarget(ctx, id, emitted.text.replace('say 1;', 'looks.say(MESAGE: 1);'), {
    previous: emitted,
    opcodes,
  });
  assert.ok(bad.diagnostics.some((d) => d.code === 'FR205'));
});

test('scripts that share blocks are locked', () => {
  const block = (opcode, next, parent, inputs, extra = {}) => ({
    opcode,
    next,
    parent,
    inputs,
    fields: {},
    shadow: false,
    topLevel: false,
    ...extra,
  });
  const cond = { CONDITION: [2, null] };
  const ctx = liveContext({
    targets: [
      {
        isStage: true,
        name: 'Stage',
        variables: {},
        lists: {},
        broadcasts: {},
        comments: {},
        blocks: {
          hatA: block('event_whenflagclicked', 'ifA', null, {}, { topLevel: true, x: 0, y: 0 }),
          ifA: block('control_if', null, 'hatA', { ...cond, SUBSTACK: [2, 'shared'] }),
          hatB: block('event_whenthisspriteclicked', 'ifB', null, {}, { topLevel: true, x: 0, y: 300 }),
          ifB: block('control_if', null, 'hatB', { ...cond, SUBSTACK: [2, 'shared'] }),
          shared: block('looks_say', null, 'ifA', { MESSAGE: [1, [10, 'hi']] }),
          hatC: block('event_whenstageclicked', 'sayC', null, {}, { topLevel: true, x: 0, y: 600 }),
          sayC: block('looks_say', null, 'hatC', { MESSAGE: [1, [10, 'alone']] }),
        },
      },
    ],
  });
  const stage = ctx.targets[0];
  const emitted = emitTarget(ctx, stage.id);
  assert.deepEqual(emitted.lockedScripts.map((l) => l.topId).sort(), ['hatA', 'hatB']);
  assert.match(emitted.lockedScripts[0].reason, /shares blocks/);
  const built = buildTarget(ctx, stage.id, emitted.text.replace('"alone"', '"edited"'), {
    previous: emitted,
    lockedScripts: emitted.lockedScripts,
  });
  assert.deepEqual(errors(built), []);
  for (const id of ['hatA', 'ifA', 'hatB', 'ifB', 'shared'])
    assert.strictEqual(built.target.blocks[id], stage.blocks[id]);
});

test('legacy file markers are read, and moving a legacy script to main passes the round trip', () => {
  const ctx = liveContext({
    targets: [
      {
        isStage: true,
        name: 'Stage',
        variables: {},
        lists: {},
        broadcasts: {},
        comments: {
          m: {
            blockId: 'fractch_h0075_fractch_top',
            x: 0,
            y: 0,
            width: 20,
            height: 20,
            minimized: true,
            text: '⁣fractch:file:0075',
          },
        },
        blocks: {
          fractch_h0075_fractch_top: {
            opcode: 'event_whenflagclicked',
            next: 'h',
            parent: null,
            inputs: {},
            fields: {},
            shadow: false,
            topLevel: true,
            x: 0,
            y: 0,
            comment: 'm',
          },
          h: {
            opcode: 'looks_hide',
            next: null,
            parent: 'fractch_h0075_fractch_top',
            inputs: {},
            fields: {},
            shadow: false,
            topLevel: false,
          },
        },
      },
    ],
  });
  const stage = ctx.targets[0];
  const emitted = emitTarget(ctx, stage.id);
  assert.match(emitted.text, /region "u" \{/);
  const identity = buildTarget(ctx, stage.id, emitted.text, { previous: emitted });
  assert.deepEqual(sortedJson(identity.target.blocks), sortedJson(stage.blocks));
  const map = Object.values(identity.target.comments).find((c) => c.text.startsWith('_fractch_map_'));
  assert.deepEqual(JSON.parse(map.text.slice('_fractch_map_'.length)).scripts, { fractch_h0075_fractch_top: 'u' });

  const moved = emitted.text.replace(/region "u" \{\n {2}([^]*?)\n\}/, (m, body) => body.replace(/\n {2}/g, '\n'));
  const built = buildTarget(ctx, stage.id, moved, { previous: emitted, verifyRoundTrip: true });
  assert.deepEqual(errors(built), []);
  assert.doesNotMatch(emitTarget(applyResult(ctx, stage.id, built), stage.id).text, /region/);
});

test('a long membership map is split over text and extraText and read back by convert and pack', async () => {
  const scripts = [];
  for (let i = 0; i < 500; i++) scripts.push(`when broadcast m${i} at 0,${i * 100} {\n  hide;\n}`);
  const text = `region "systems/long" {\n${scripts.slice(0, 250).join('\n')}\n}\n${scripts.slice(250).join('\n')}\n`;
  const ctx = liveContext({
    targets: [{ isStage: true, name: 'Stage', variables: {}, lists: {}, broadcasts: {}, comments: {}, blocks: {} }],
  });
  const built = buildTarget(ctx, ctx.targets[0].id, text, { previous: { text: '', sourceMap: { scripts: {} } } });
  assert.deepEqual(errors(built), []);
  const map = Object.values(built.target.comments).find((c) => String(c.text).startsWith('_fractch_map_'));
  assert.ok(map.extraText && map.text.length === 8000);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'fractch-long-'));
  try {
    await convertProject({ targets: [built.target] }, { outDir: out, fs });
    const long = fs.readFileSync(path.join(out, 'Stage', 'systems', 'long.fractch'), 'utf8');
    assert.equal((long.match(/when broadcast/g) || []).length, 250);
    const { manifest } = await buildProjectFromBuildDir({ buildDir: out, fs, prune: false });
    const packedMap = Object.values(manifest.targets[0].comments).find((c) =>
      String(c.text).startsWith('_fractch_map_')
    );
    assert.ok(packedMap.extraText);
    assert.ok(!Object.values(manifest.targets[0].comments).some((c) => String(c.text).includes('fractch:file')));
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('a commented hat keeps its comment when moved into a region and out again', async () => {
  const manifest = await packFiles({ 'Stage/main.fractch': 'when flag {\n  // greet\n  say "hi";\n}\n' });
  let ctx = liveContext(manifest);
  const id = ctx.targets[0].id;
  let emitted = emitTarget(ctx, id);
  const into = emitted.text.replace(/(when flag[^]*?\n\})/, (m) => `region "r" {\n  ${m.replace(/\n/g, '\n  ')}\n}`);
  let built = buildTarget(ctx, id, into, { previous: emitted });
  assert.deepEqual(built.changed, []);
  ctx = applyResult(ctx, id, built);
  emitted = emitTarget(ctx, id);
  assert.match(emitted.text, /region "r"/);
  built = buildTarget(
    ctx,
    id,
    into.replace(/region "r" \{\n {2}([^]*?)\n\}/, (m, b) => b.replace(/\n {2}/g, '\n')),
    {
      previous: emitted,
    }
  );
  assert.deepEqual(built.changed, []);
  const texts = Object.values(built.target.comments).map((c) => c.text);
  assert.ok(texts.includes('greet'));
});

test('declarations: unedited lines keep live values, edited lines set them, keep keeps big lists', () => {
  const big = Array.from({ length: 150 }, (_, i) => i);
  const ctx = liveContext({
    targets: [
      {
        isStage: true,
        name: 'Stage',
        variables: { a: ['lives', 3], b: ['speed', 1] },
        lists: { l: ['levels', big] },
        broadcasts: {},
        comments: {},
        blocks: {},
      },
    ],
  });
  const stage = ctx.targets[0];
  const emitted = emitTarget(ctx, stage.id);
  assert.match(emitted.text, /var levels = keep;/);
  const live = { ...ctx, targets: [{ ...stage, variables: { a: ['lives', 9], b: ['speed', 1] } }] };
  const built = buildTarget(live, stage.id, emitted.text.replace('var speed = 1;', 'var speed = 4;'), {
    previous: emitted,
  });
  assert.deepEqual(errors(built), []);
  assert.deepEqual(built.target.variables.a, ['lives', 9]);
  assert.deepEqual(built.target.variables.b, ['speed', 4]);
  assert.strictEqual(built.target.lists.l[1], big);
  assert.deepEqual(built.valueSets, { b: 4 });
  const change = toReplaceChange(built);
  assert.deepEqual(change.variables.set, { b: 4 });
  assert.equal(change.format, 'sb3');

  const kept = { ...ctx, targets: [{ ...stage, lists: { l: ['levels', null] }, keptLists: { l: { length: 150 } } }] };
  assert.match(emitTarget(kept, stage.id).text, /var levels = keep;/);
});

test('deleting a declaration that blocks still use is refused', async () => {
  const manifest = await packFiles({ 'Stage/main.fractch': 'var lives = 3;\nwhen flag {\n  say lives;\n}\n' });
  const ctx = liveContext(manifest);
  const id = ctx.targets[0].id;
  const emitted = emitTarget(ctx, id);
  const built = buildTarget(ctx, id, emitted.text.replace('var lives = 3;\n', ''), { previous: emitted });
  assert.ok(built.diagnostics.some((d) => d.code === 'FR220' && /lives is used by Stage/.test(d.message)));
});

test('undeclared reads are errors with a Declare var quick fix; assignments create variables', async () => {
  const manifest = await packFiles({ 'Stage/main.fractch': 'var score = 0;\nwhen flag {\n  say score;\n}\n' });
  const ctx = liveContext(manifest);
  const id = ctx.targets[0].id;
  const emitted = emitTarget(ctx, id);
  const text = emitted.text.replace('say score;', 'say scroe;\n  total = 1;');
  const built = buildTarget(ctx, id, text, { previous: emitted });
  const read = built.diagnostics.find((d) => d.code === 'FR212');
  assert.match(read.message, /did you mean score/);
  assert.equal(read.fix.title, 'Declare var scroe');
  const fixed = text.slice(0, read.fix.edits[0].from) + read.fix.edits[0].text + text.slice(read.fix.edits[0].to);
  assert.match(fixed, /var scroe = 0;/);
  const assigned = built.diagnostics.find((d) => d.code === 'FR213');
  assert.equal(assigned.severity, 'info');
  assert.ok(built.created.variables.some((v) => v.name === 'total'));
});

test('reporters as statements and wrong argument counts are reported with their definition', async () => {
  const manifest = await packFiles({
    'Stage/main.fractch': 'def @go(a, b) {\n  say a;\n}\nwhen flag {\n  @go(1, 2);\n}\n',
  });
  const ctx = liveContext(manifest);
  const id = ctx.targets[0].id;
  const emitted = emitTarget(ctx, id);
  const built = buildTarget(ctx, id, emitted.text.replace('@go(1, 2);', '@go(1, 2, 3);\n  xPosition();\n  @gp(1);'), {
    previous: emitted,
  });
  const codes = built.diagnostics.map((d) => d.code);
  assert.ok(codes.includes('FR204'));
  const count = built.diagnostics.find((d) => d.code === 'FR209');
  assert.match(count.hint, /def @go\(a, b\)/);
  assert.match(built.diagnostics.find((d) => d.code === 'FR208').message, /did you mean @go/);
});

test('an injected opcode table validates input names, menu values and every script shape', async () => {
  const opcodes = {
    opcodes: {
      event_whenflagclicked: { inputs: [], fields: [], hat: true },
      control_if_else: { inputs: ['CONDITION', 'SUBSTACK', 'SUBSTACK2'], fields: [] },
      control_repeat: { inputs: ['TIMES', 'SUBSTACK'], fields: [] },
      control_forever: { inputs: ['SUBSTACK'], fields: [] },
      control_stop: {
        inputs: [],
        fields: [{ name: 'STOP_OPTION', options: ['all', 'this script', 'other scripts in sprite'] }],
      },
      operator_add: { inputs: ['NUM1', 'NUM2'], fields: [], variadic: { prefix: 'NUM', minItems: 2, collapsed: true } },
      operator_gt: { inputs: ['OPERAND1', 'OPERAND2'], fields: [] },
      looks_say: { inputs: ['MESSAGE'], fields: [] },
      motion_movesteps: { inputs: ['STEPS'], fields: [] },
      procedures_call: { inputs: [], fields: [], mutationInputs: 'argumentids' },
      procedures_definition: { inputs: ['custom_block'], fields: [] },
      procedures_prototype: { inputs: [], fields: [] },
      argument_reporter_string_number: { inputs: [], fields: ['VALUE'] },
    },
  };
  const manifest = await packFiles({ 'Stage/main.fractch': 'def @f(a) {\n  say a;\n}\nwhen flag {\n  say 1;\n}\n' });
  const ctx = liveContext(manifest);
  const id = ctx.targets[0].id;
  const emitted = emitTarget(ctx, id, { opcodes });
  const body = [
    'when flag {',
    '  if 1 > 2 {',
    '    say 1 + 2 + 3;',
    '  } else {',
    '    repeat 3 {',
    '      @f(1);',
    '    }',
    '  }',
    '  forever {',
    '    stop all;',
    '  }',
    '}',
  ].join('\n');
  const good = buildTarget(ctx, id, emitted.text.replace(/when flag[^]*?\n\}/, body), { previous: emitted, opcodes });
  assert.deepEqual(errors(good), []);
  const bad = buildTarget(
    ctx,
    id,
    emitted.text.replace('say 1;', 'motion.movesteps(STPES: 1);\n  control.stop(field STOP_OPTION: "everything");'),
    { previous: emitted, opcodes }
  );
  assert.match(bad.diagnostics.find((d) => d.code === 'FR205').message, /did you mean STEPS/);
  assert.match(bad.diagnostics.find((d) => d.code === 'FR207').hint, /"all"/);
  const positional = buildTarget(ctx, id, emitted.text.replace('say 1;', 'motion.movesteps(10);'), {
    previous: emitted,
    opcodes,
  });
  assert.ok(Object.values(positional.target.blocks).some((b) => b.opcode === 'motion_movesteps' && b.inputs.STEPS));
});

const EXTENSIONS = {
  myext: {
    blocks: [
      { opcode: 'double', blockType: 'reporter', text: 'double [N]', arguments: [{ name: 'N', type: 'number' }] },
      {
        opcode: 'add',
        blockType: 'reporter',
        text: '[LEFT] plus [RIGHT]',
        arguments: [
          { name: 'LEFT', type: 'number' },
          { name: 'RIGHT', type: 'number' },
        ],
      },
      {
        opcode: 'paint',
        blockType: 'command',
        text: 'paint [COLOR] with [TOOL]',
        arguments: [
          { name: 'COLOR', type: 'string', menu: 'colors' },
          { name: 'TOOL', type: 'string', menu: 'tools' },
        ],
      },
    ],
    menus: {
      colors: { acceptReporters: true, items: ['red', 'blue'] },
      tools: { acceptReporters: false, items: ['brush', 'pen'] },
    },
  },
};

test('extension calls use getInfo signatures for positional, case-folded and menu arguments', async () => {
  const manifest = await packFiles({ 'Stage/main.fractch': 'when flag {\n  say 1;\n}\n' });
  const ctx = { ...liveContext(manifest), extensionSignatures: EXTENSIONS };
  const id = ctx.targets[0].id;
  const emitted = emitTarget(ctx, id);
  const text = emitted.text.replace(
    'say 1;',
    'say myext.double(4);\n  say myext.add(1, 2);\n  myext.paint("red", "pen");\n  say myext.double(n: 5);'
  );
  const built = buildTarget(ctx, id, text, { previous: emitted, verifyRoundTrip: true });
  assert.deepEqual(errors(built), []);
  const blocks = Object.values(built.target.blocks);
  assert.ok(blocks.filter((b) => b.opcode === 'myext_double').every((b) => b.inputs.N));
  const add = blocks.find((b) => b.opcode === 'myext_add');
  assert.deepEqual(Object.keys(add.inputs), ['LEFT', 'RIGHT']);
  const paint = blocks.find((b) => b.opcode === 'myext_paint');
  assert.deepEqual(paint.fields.TOOL, ['pen']);
  const menu = built.target.blocks[paint.inputs.COLOR[1]];
  assert.equal(menu.opcode, 'myext_menu_colors');
  assert.deepEqual(menu.fields.colors, ['red']);

  const next = applyResult(ctx, id, built);
  const again = emitTarget(next, id);
  assert.match(again.text, /say myext\.add\(1, 2\);/);
  assert.match(again.text, /myext\.paint\("red", "pen"\);/);
  const keyed = buildTarget(next, id, again.text.replace('myext.add(1, 2)', 'myext.add(LEFT: 1, RIGHT: 2)'), {
    previous: again,
  });
  assert.deepEqual(keyed.changed, []);

  const wrong = buildTarget(
    ctx,
    id,
    emitted.text.replace('say 1;', 'say myext.tripple(1);\n  say other.thing();\n  myext.double(1);'),
    {
      previous: emitted,
    }
  );
  const codes = wrong.diagnostics.map((d) => d.code);
  assert.ok(codes.includes('FR218'));
  assert.ok(codes.includes('FR217'));
  assert.ok(codes.includes('FR204'));
});

test('source maps point at statements and expressions in both directions', async () => {
  const { ctx, cat } = await catContext();
  const emitted = emitTarget(ctx, cat.id);
  const at = emitted.text.indexOf('say x;');
  const hit = findInSourceMap(emitted.sourceMap, at + 1);
  assert.equal(cat.blocks[hit.id].opcode, 'looks_say');
  const range = emitted.sourceMap.blocks[hit.id];
  assert.equal(emitted.text.slice(range.from, range.to), 'say x;');
  const built = buildTarget(ctx, cat.id, emitted.text, { previous: emitted, fastUnchanged: false });
  assert.deepEqual(built.sourceMap.blocks[hit.id].from, range.from);
});

test('toReplaceChange maps a build result onto replaceTargetScripts', async () => {
  const { ctx, cat } = await catContext();
  const emitted = emitTarget(ctx, cat.id);
  const built = buildTarget(ctx, cat.id, emitted.text.replace('say x;', 'say x + 1;\n  newVar = 1;'), {
    previous: emitted,
  });
  const change = toReplaceChange(built);
  assert.equal(change.format, 'sb3');
  assert.ok(change.keepScripts.length >= 3);
  assert.ok(!change.keepScripts.includes(built.changed[0].topId));
  assert.ok(change.variables.create.some((v) => v.name === 'newVar' && v.type === ''));
  assert.ok(Object.values(change.comments).some((c) => c.text.startsWith('_fractch_map_')));
});

test('parse recovery never invents scripts and points a missing brace at its opening line', () => {
  const broken = parseFractch(
    'when flg {\n  say 1;\n}\nwhen flag\n  say 2;\n  say 3;\n}\nwhen clicked {\n  hide;\n}\n'
  );
  assert.equal(broken.scripts.length, 1);
  assert.deepEqual(
    broken.errors.map((e) => e.code),
    ['FR101', 'FR100']
  );
  const missing = parseFractch('when flag {\n  if x {\n    say 1;\n  move 2;\n}\nwhen clicked {\n  hide;\n}\n');
  assert.equal(missing.scripts.length, 1);
  const err = missing.errors.find((e) => e.code === 'FR104');
  assert.equal(err.line, 2);
  const region = parseFractch(
    'region "x" {\n  say 1;\n  when flag { hide; }\n}\nvar a = keep;\nlocked script "abc";\n'
  );
  assert.equal(region.scripts[0].region, 'x');
  assert.ok(region.errors.some((e) => e.code === 'FR120'));
  assert.equal(region.varDecls[0].keep, true);
  assert.equal(region.lockedScripts[0].id, 'abc');
});

test('the generated VM opcode table validates real scripts without false errors', async (t) => {
  const tablePath =
    process.env.FRACTCH_VM_OPCODES ||
    path.join(os.homedir(), 'mistwarp', 'scratch-vm', 'src', 'engine', 'opcodes.generated.json');
  if (!fs.existsSync(tablePath)) {
    t.skip('scratch-vm opcode table not found');
    return;
  }
  const opcodes = JSON.parse(fs.readFileSync(tablePath, 'utf8'));
  const { ctx, cat } = await catContext();
  const emitted = emitTarget(ctx, cat.id, { opcodes });
  const body = [
    'when flag at 0,300 {',
    '  local t = 2;',
    '  if t > 1 {',
    '    say t + hp + 1 + 4;',
    '  } else {',
    '    repeat 3 {',
    '      @f(t);',
    '      move 10;',
    '    }',
    '  }',
    '  until mouseDown() {',
    '    changeX 1;',
    '  }',
    '  forever {',
    '    stop all;',
    '  }',
    '}',
  ].join('\n');
  const built = buildTarget(ctx, cat.id, emitted.text.replace(/when flag at 0,300 \{[^]*?\n\}/, body), {
    previous: emitted,
    opcodes,
    verifyRoundTrip: true,
  });
  assert.deepEqual(errors(built), []);
});

test('buildTarget and emitTarget never mutate the context and leave reserved comments out', async () => {
  const { ctx, cat } = await catContext();
  const stage = ctx.targets.find((x) => x.isStage);
  stage.comments.cfg = {
    blockId: null,
    x: 0,
    y: 0,
    width: 200,
    height: 200,
    minimized: false,
    text: 'x // _twconfig_ {}',
  };
  const before = JSON.stringify(ctx);
  const emitted = emitTarget(ctx, stage.id);
  assert.doesNotMatch(emitted.text, /_twconfig_/);
  const built = buildTarget(ctx, stage.id, emitted.text.replace('score = 1;', 'score = 2;'), { previous: emitted });
  assert.ok(!('cfg' in built.target.comments));
  buildTarget(ctx, cat.id, emitTarget(ctx, cat.id).text.replace('say x;', 'say x + 1;'));
  assert.equal(JSON.stringify(ctx), before);
});

test('did you mean suggestions cover statements, costumes and broadcasts', async () => {
  const manifest = await packFiles({
    'Stage/main.fractch': 'when flag {\n  say 1;\n}\nwhen broadcast ready {\n  hide;\n}\n',
  });
  const ctx = liveContext(manifest);
  const stage = ctx.targets[0];
  stage.costumes = [{ name: 'night' }, { name: 'day' }];
  const emitted = emitTarget(ctx, stage.id);
  const built = buildTarget(
    ctx,
    stage.id,
    emitted.text.replace('say 1;', 'sya 1;\n  backdrop "nite";\n  broadcast redy;'),
    {
      previous: emitted,
    }
  );
  const messages = built.diagnostics.map((d) => d.message);
  assert.ok(messages.some((m) => /'sya' is not a statement - did you mean 'say'/.test(m)));
  assert.ok(messages.some((m) => /no backdrop "nite" - did you mean "night"/.test(m)));
  assert.ok(messages.some((m) => /creates broadcast "redy" - did you mean "ready"/.test(m)));
});

test('pack returns diagnostics instead of skipping a file with a bracket error', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fractch-pack-diag-'));
  try {
    fs.mkdirSync(path.join(dir, 'Stage'));
    fs.writeFileSync(
      path.join(dir, 'Stage', 'main.fractch'),
      'when flag {\n  say (1;\n}\nwhen clicked {\n  hide;\n}\n'
    );
    const { manifest, diagnostics } = await buildProjectFromBuildDir({ buildDir: dir, fs, prune: false });
    assert.ok(diagnostics.some((d) => d.severity === 'error' && d.file === 'Stage/main.fractch' && d.line === 2));
    const opcodes = Object.values(manifest.targets[0].blocks).map((b) => b.opcode);
    assert.ok(opcodes.includes('looks_hide'));
    assert.ok(opcodes.includes('event_whenflagclicked'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('empty conditions stay empty in live rebuilds', async () => {
  const { ctx, cat } = await catContext();
  const emitted = emitTarget(ctx, cat.id);
  const edited = emitted.text
    .replace('  say x;\n', '  if null {\n    say x;\n  }\n')
    .replace('  local t = 1;\n', '  if hp > 1 {\n    hide;\n  }\n  local t = 1;\n');
  const first = buildTarget(ctx, cat.id, edited, { previous: emitted });
  assert.deepEqual(errors(first), []);
  const conditions = (result) =>
    Object.values(result.target.blocks)
      .filter((b) => b.opcode === 'control_if')
      .map((b) => b.inputs.CONDITION?.[0] ?? null)
      .filter((code) => code !== 2);
  assert.deepEqual(conditions(first), [null]);

  const next = applyResult(ctx, cat.id, first);
  const second = emitTarget(next, cat.id);
  assert.equal((second.text.match(/if null \{/g) || []).length, 1);
  const cleared = buildTarget(next, cat.id, second.text.replace('if hp > 1 {', 'if null {'), { previous: second });
  assert.deepEqual(errors(cleared), []);
  assert.deepEqual(conditions(cleared), [null, null]);
});

function shadowContext(blocks) {
  const sprite = {
    isStage: false,
    name: 'S',
    variables: {},
    lists: {},
    broadcasts: {},
    blocks,
    comments: {},
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
  };
  const stage = { ...sprite, isStage: true, name: 'Stage', blocks: {}, layerOrder: 0 };
  const ctx = liveContext({ targets: [stage, sprite], monitors: [], extensions: ['pen'], meta: { semver: '3.0.0' } });
  return { ctx, id: ctx.targets.find((t) => t.name === 'S').id };
}

const stackBlock = (opcode, inputs, extra) => ({
  opcode,
  next: null,
  parent: null,
  inputs,
  fields: {},
  shadow: false,
  topLevel: false,
  ...extra,
});

test('the opcode table does not turn null inputs into typed empty literals', () => {
  const { ctx, id } = shadowContext({
    hat: stackBlock('event_whenflagclicked', {}, { next: 'pen', topLevel: true, x: 0, y: 0 }),
    pen: stackBlock('pen_setPenColorToColor', { COLOR: [1, null] }, { parent: 'hat' }),
  });
  const opcodes = {
    opcodes: {
      motion_movesteps: { inputs: { STEPS: { shadow: 'math_number' } } },
      pen_setPenColorToColor: { inputs: { COLOR: { shadow: 'colour_picker' } } },
    },
  };
  const emitted = emitTarget(ctx, id, { opcodes });
  const text = `${emitted.text.replace(/\}\s*$/, '  say 1;\n}\n')}\nwhen flag {\n  motion_movesteps(STEPS: null);\n  pen_setPenColorToColor(COLOR: null);\n}\n`;
  const built = buildTarget(ctx, id, text, { previous: emitted, opcodes });
  assert.deepEqual(errors(built), []);
  const pens = Object.values(built.target.blocks).filter((b) => b.opcode === 'pen_setPenColorToColor');
  assert.deepEqual(pens.map((b) => b.inputs.COLOR ?? null).sort(), [[1, null], null]);
  const move = Object.values(built.target.blocks).find((b) => b.opcode === 'motion_movesteps');
  assert.deepEqual(move.inputs, {});
});

test('replacing a reporter with null falls back to its shadow', () => {
  const { ctx, id } = shadowContext({
    hat: stackBlock('event_whenflagclicked', {}, { next: 'say', topLevel: true, x: 0, y: 0 }),
    say: stackBlock('looks_say', { MESSAGE: [3, 'add', [10, 'hello']] }, { parent: 'hat' }),
    add: stackBlock('operator_add', { NUM1: [1, [4, '1']], NUM2: [1, [4, '2']] }, { parent: 'say' }),
  });
  const emitted = emitTarget(ctx, id);
  const built = buildTarget(ctx, id, emitted.text.replace('say (1 + 2 ?? "hello");', 'say null;'), {
    previous: emitted,
  });
  assert.deepEqual(errors(built), []);
  const say = Object.values(built.target.blocks).find((b) => b.opcode === 'looks_say');
  assert.deepEqual(say.inputs.MESSAGE, [1, [10, 'hello']]);
  assert.ok(!Object.values(built.target.blocks).some((b) => b.opcode === 'operator_add'));
});
