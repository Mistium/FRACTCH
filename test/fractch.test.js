import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import AdmZip from 'adm-zip';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { writeExtensions } from '../src/index.js';
import { checkFractch } from '../src/lint.js';
import { parseFractch } from '../src/parse.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SB3 = (() => {
  const candidates = [
    process.env.FRACTCH_ORIGIN,
    path.join(os.homedir(), 'origin-fractch', 'originv619.sb3'),
    'originv6.0.0.sb3',
  ].filter(Boolean);
  for (const c of candidates) {
    const abs = path.isAbsolute(c) ? c : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', c);
    if (fs.existsSync(abs)) return abs;
  }
  throw new Error('no origin sb3 found - set FRACTCH_ORIGIN');
})();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fractch-'));
const outDir = path.join(tmp, 'build');
const outSb3 = path.join(tmp, 'repacked.sb3');
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'pipe' });

run(`node ./bin/cli.js --input "${SB3}" --out "${outDir}"`);

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

test('build emits script files without manifest or indexes', () => {
  assert.ok(!fs.existsSync(path.join(outDir, 'manifest.json')));
  assert.ok(!fs.existsSync(path.join(outDir, 'index.fractch')));
  assert.ok(!walk(outDir).some((f) => path.basename(f) === 'index.fractch'));
  assert.ok(walk(outDir).some((f) => f.endsWith('.fractch')));
});

test('converted output groups each target into main.fractch by default', () => {
  const scriptFiles = walk(outDir).filter((f) => f.endsWith('.fractch') && path.basename(f) !== 'index.fractch');
  assert.ok(scriptFiles.length > 0, 'no generated script files');
  assert.ok(scriptFiles.every((f) => path.relative(outDir, f).split(path.sep).length === 2), 'script file is nested below target');
  assert.ok(scriptFiles.every((f) => path.basename(f) === 'main.fractch'), 'generated a non-main script file without a marker');
  assert.ok(scriptFiles.some((f) => /^when flag /m.test(fs.readFileSync(f, 'utf8'))), 'no when-flag script emitted');
});

test('pack reconstructs every target purely from parsed DSL text', () => {
  run(`node ./bin/cli.js --pack --out "${outDir}" --outSb3 "${outSb3}"`);
  const a = JSON.parse(new AdmZip(SB3).readAsText('project.json'));
  const b = JSON.parse(new AdmZip(outSb3).readAsText('project.json'));
  assert.strictEqual(a.targets.length, b.targets.length);
  for (const ot of a.targets) {
    const rt = b.targets.find((t) => t.name === ot.name);
    assert.ok(rt, `target ${ot.name} missing from repack`);
    const origCount = Object.keys(ot.blocks || {}).length;
    const repackCount = Object.keys(rt.blocks || {}).length;
    // Parsing pure text can't always distinguish every representational
    // nuance (e.g. Scratch can encode "read variable X" as either a real
    // data_variable block or an inline literal - both execute identically).
    // This bounds against wholesale data loss, not byte-exact reconstruction.
    if (origCount > 0) assert.ok(repackCount / origCount > 0.95, `${ot.name}: ${origCount} -> ${repackCount} blocks`);
  }
});

test('pack accepts headerless handwritten projects without a manifest', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fractch-hand-'));
  const scriptDir = path.join(dir, 'Stage');
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.writeFileSync(
    path.join(scriptDir, 'main.fractch'),
    'when flag {\n  say "hello from fractch";\n}\n'
  );
  const sb3 = path.join(dir, 'hand.sb3');

  run(`node ./bin/cli.js --pack --out "${dir}" --outSb3 "${sb3}"`);

  const zip = new AdmZip(sb3);
  const project = JSON.parse(zip.readAsText('project.json'));
  const stage = project.targets.find((t) => t.name === 'Stage');
  assert.ok(stage, 'Stage target missing');
  assert.ok(Object.values(stage.blocks).some((b) => b.opcode === 'event_whenflagclicked'));
  assert.ok(Object.values(stage.blocks).some((b) => b.opcode === 'looks_say'));
  assert.ok(zip.getEntry(stage.costumes[0].md5ext), 'default svg asset missing');
});

test('word syntax: `fractch <sb3> from <dir>` packs a build dir', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fractch-word-'));
  const scriptDir = path.join(dir, 'Stage', 'event_whenflagclicked');
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.writeFileSync(path.join(scriptDir, 'main.fractch'), 'event.whenflagclicked();\nlooks.say(MESSAGE: "word");\n');
  const sb3 = path.join(dir, 'word.sb3');

  run(`node ./bin/cli.js "${sb3}" from "${dir}"`);

  const project = JSON.parse(new AdmZip(sb3).readAsText('project.json'));
  const stage = project.targets.find((t) => t.name === 'Stage');
  assert.ok(Object.values(stage.blocks).some((b) => b.opcode === 'looks_say'));
});

test('programmatic API: unpackSb3/packSb3 round-trip without touching cwd', async () => {
  const { unpackSb3, packSb3 } = await import('../src/index.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fractch-api-'));
  const buildDir = path.join(dir, 'build');
  const sb3 = path.join(dir, 'repacked.sb3');

  const result = await unpackSb3({ input: SB3, outDir: buildDir });
  assert.ok(result.filesWritten > 0);
  assert.ok(!fs.existsSync(path.join(buildDir, 'manifest.json')));
  assert.ok(!fs.existsSync(path.join(buildDir, 'index.fractch')));

  await packSb3({ buildDir, outSb3: sb3, originSb3: SB3 });
  const project = JSON.parse(new AdmZip(sb3).readAsText('project.json'));
  const orig = JSON.parse(new AdmZip(SB3).readAsText('project.json'));
  assert.strictEqual(project.targets.length, orig.targets.length);
});

function makeMemoryFs() {
  const dirs = new Set(['/']);
  const files = new Map();
  const err = (code, p) => Object.assign(new Error(`${code}: ${p}`), { code });
  return {
    promises: {
      async readFile(p, enc) {
        if (!files.has(p)) throw err('ENOENT', p);
        const data = files.get(p);
        return enc ? data.toString() : data;
      },
      async writeFile(p, data) {
        files.set(p, typeof data === 'string' ? data : Buffer.from(data));
      },
      async mkdir(p) {
        if (dirs.has(p)) throw err('EEXIST', p);
        dirs.add(p);
      },
      async readdir(p) {
        const prefix = p === '/' ? '/' : p + '/';
        const names = new Set();
        for (const key of [...dirs, ...files.keys()]) {
          if (key !== p && key.startsWith(prefix)) names.add(key.slice(prefix.length).split('/')[0]);
        }
        return [...names];
      },
      async stat(p) {
        if (files.has(p)) return { type: 'file', isDirectory: () => false };
        if (dirs.has(p)) return { type: 'dir', isDirectory: () => true };
        throw err('ENOENT', p);
      },
    },
  };
}

test('browser entry: convert + pack against an in-memory lightning-fs style fs', async () => {
  const { convertProject, buildProjectFromBuildDir } = await import('../src/browser.js');
  const memfs = makeMemoryFs();
  const projectJson = JSON.parse(new AdmZip(SB3).readAsText('project.json'));

  const result = await convertProject(projectJson, { outDir: '/build', fs: memfs });
  assert.ok(result.filesWritten > 0);
  const mainTarget = projectJson.targets.find((t) => Object.keys(t.blocks || {}).length > 0);
  const sanitized = mainTarget.name.replace(/[^a-zA-Z0-9-_]/g, '_');
  assert.ok((await memfs.promises.readFile(`/build/${sanitized}/main.fractch`, 'utf8')).includes('when '));

  const { manifest } = await buildProjectFromBuildDir({ buildDir: '/build', fs: memfs });
  const origCounts = projectJson.targets.map((t) => Object.keys(t.blocks || {}).length);
  for (let i = 0; i < projectJson.targets.length; i++) {
    const rebuilt = manifest.targets.find((t) => t.name === projectJson.targets[i].name);
    assert.ok(rebuilt, `target ${projectJson.targets[i].name} missing`);
    const rc = Object.keys(rebuilt.blocks || {}).length;
    if (origCounts[i] > 0) assert.ok(rc / origCounts[i] > 0.95, `${rebuilt.name}: ${origCounts[i]} -> ${rc}`);
  }
});

test('index imports choose which top-level scripts are packed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fractch-index-'));
  const scriptDir = path.join(dir, 'Stage');
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.fractch'), 'import "./Stage/keep.fractch";\n');
  fs.writeFileSync(path.join(scriptDir, 'keep.fractch'), 'when flag {\n  say "keep";\n}\n');
  fs.writeFileSync(path.join(scriptDir, 'drop.fractch'), 'when flag {\n  say "drop";\n}\n');
  const sb3 = path.join(dir, 'indexed.sb3');

  run(`node ./bin/cli.js --pack --out "${dir}" --outSb3 "${sb3}"`);

  const project = JSON.parse(new AdmZip(sb3).readAsText('project.json'));
  const stage = project.targets.find((t) => t.name === 'Stage');
  const messages = Object.values(stage.blocks)
    .filter((b) => b.opcode === 'looks_say')
    .map((b) => b.inputs?.MESSAGE?.[1]?.[1]);
  assert.deepStrictEqual(messages, ['keep']);
});

test('human asset declarations derive ids/formats from file bytes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fractch-humanassets-'));
  fs.mkdirSync(path.join(dir, 'Stage', 'assets'), { recursive: true });
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><!--bg--></svg>';
  const wav = Buffer.from('RIFFfakewavdata');
  fs.writeFileSync(path.join(dir, 'Stage', 'assets', 'bg.svg'), svg);
  fs.writeFileSync(path.join(dir, 'Stage', 'assets', 'pop.wav'), wav);
  fs.writeFileSync(
    path.join(dir, 'Stage', 'main.fractch'),
    'costume "bg" file "assets/bg.svg" center 240,180;\n' +
      'sound "pop" file "assets/pop.wav" rate 48000 samples 1123;\n' +
      'when flag {\n  sound.playuntildone(SOUND_MENU: sound.sounds_menu("pop"));\n  say "hi";\n}\n'
  );
  const sb3 = path.join(dir, 'human.sb3');
  run(`node ./bin/cli.js "${sb3}" from "${dir}"`);

  const zip = new AdmZip(sb3);
  const stage = JSON.parse(zip.readAsText('project.json')).targets.find((t) => t.name === 'Stage');
  const svgMd5 = crypto.createHash('md5').update(svg).digest('hex');
  const wavMd5 = crypto.createHash('md5').update(wav).digest('hex');
  assert.deepStrictEqual(stage.costumes[0], {
    name: 'bg',
    bitmapResolution: 1,
    dataFormat: 'svg',
    assetId: svgMd5,
    md5ext: `${svgMd5}.svg`,
    rotationCenterX: 240,
    rotationCenterY: 180,
  });
  assert.deepStrictEqual(stage.sounds[0], {
    name: 'pop',
    assetId: wavMd5,
    dataFormat: 'wav',
    format: '',
    rate: 48000,
    sampleCount: 1123,
    md5ext: `${wavMd5}.wav`,
  });
  assert.ok(zip.getEntry(`${svgMd5}.svg`), 'costume bytes missing from sb3');
  assert.ok(zip.getEntry(`${wavMd5}.wav`), 'sound bytes missing from sb3');
});

test('unused costumes/sounds are pruned; dynamic references keep everything', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fractch-prune-'));
  fs.mkdirSync(path.join(dir, 'Stage', 'assets'), { recursive: true });
  const mk = (n) => fs.writeFileSync(path.join(dir, 'Stage', 'assets', n), `<svg xmlns="http://www.w3.org/2000/svg"><!--${n}--></svg>`);
  mk('a.svg');
  mk('b.svg');
  mk('c.svg');
  fs.writeFileSync(path.join(dir, 'Stage', 'assets', 's1.wav'), 'RIFF1');
  fs.writeFileSync(path.join(dir, 'Stage', 'assets', 's2.wav'), 'RIFF2');
  const decls =
    'costume "a" file "assets/a.svg";\ncostume "b" file "assets/b.svg";\ncostume "c" file "assets/c.svg";\n' +
    'sound "used" file "assets/s1.wav";\nsound "unused" file "assets/s2.wav";\n';

  fs.writeFileSync(
    path.join(dir, 'Stage', 'main.fractch'),
    decls + 'when flag {\n  backdrop "b";\n  sound.play(SOUND_MENU: sound.sounds_menu("used"));\n}\n'
  );
  const sb3 = path.join(dir, 'pruned.sb3');
  run(`node ./bin/cli.js "${sb3}" from "${dir}"`);
  const stage = JSON.parse(new AdmZip(sb3).readAsText('project.json')).targets.find((t) => t.name === 'Stage');
  assert.deepStrictEqual(stage.costumes.map((c) => c.name), ['a', 'b'], 'current + referenced costumes kept');
  assert.strictEqual(stage.currentCostume, 0);
  assert.deepStrictEqual(stage.sounds.map((s) => s.name), ['used']);

  fs.writeFileSync(
    path.join(dir, 'Stage', 'main.fractch'),
    decls + 'when flag {\n  costume sensing.answer();\n}\n'
  );
  run(`node ./bin/cli.js "${sb3}" from "${dir}"`);
  const stage2 = JSON.parse(new AdmZip(sb3).readAsText('project.json')).targets.find((t) => t.name === 'Stage');
  assert.deepStrictEqual(stage2.costumes.map((c) => c.name), ['a', 'b', 'c'], 'dynamic costume keeps all');
});

test('index imports prune unimported target assets from packed sb3', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fractch-assets-'));
  fs.mkdirSync(path.join(dir, 'Stage'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'Sprite'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'Stage', 'assets'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'Sprite', 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.fractch'), 'import "./Stage/main.fractch";\n');
  fs.writeFileSync(
    path.join(dir, 'Stage', 'main.fractch'),
    'costume "backdrop" file "assets/stage.svg";\n' + 'when flag {\n  say "stage";\n}\n'
  );
  fs.writeFileSync(
    path.join(dir, 'Sprite', 'main.fractch'),
    'costume "costume" file "assets/sprite.svg";\n' + 'when flag {\n  say "sprite";\n}\n'
  );
  fs.writeFileSync(path.join(dir, 'Stage', 'assets', 'stage.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><!--stage--></svg>');
  fs.writeFileSync(path.join(dir, 'Sprite', 'assets', 'sprite.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><!--sprite--></svg>');
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({
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
          costumes: [{ name: 'backdrop', assetId: 'stage', dataFormat: 'svg', md5ext: 'stage.svg' }],
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
          name: 'Sprite',
          variables: {},
          lists: {},
          broadcasts: {},
          blocks: {},
          comments: {},
          currentCostume: 0,
          costumes: [{ name: 'costume', assetId: 'sprite', dataFormat: 'svg', md5ext: 'sprite.svg' }],
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
      meta: { semver: '3.0.0', vm: '0.2.0', agent: 'FRACTCH' },
    })
  );
  const sb3 = path.join(dir, 'assets.sb3');

  run(`node ./bin/cli.js --pack --out "${dir}" --outSb3 "${sb3}"`);

  const zip = new AdmZip(sb3);
  const project = JSON.parse(zip.readAsText('project.json'));
  assert.ok(project.targets.some((t) => t.name === 'Stage'));
  assert.ok(!project.targets.some((t) => t.name === 'Sprite'));
  const stageCostume = project.targets.find((t) => t.name === 'Stage').costumes[0];
  assert.match(stageCostume.md5ext, /^[0-9a-f]{32}\.svg$/, 'md5ext not derived from file contents');
  const svgEntries = zip.getEntries().filter((e) => e.entryName.endsWith('.svg')).map((e) => e.entryName);
  assert.deepStrictEqual(svgEntries, [stageCostume.md5ext], 'unimported target asset was packed');
});

test('every repacked asset is byte-identical to its original', () => {
  // Unused assets may be pruned and non-asset extras need --origin, so the
  // repack's asset set is a subset of the origin's - but every asset that IS
  // packed must be byte-for-byte the original.
  const a = new AdmZip(SB3);
  const b = new AdmZip(outSb3);
  const assetShaped = /^[0-9a-f]{32}\.[A-Za-z0-9]+$/;
  const ea = new Map(a.getEntries().map((e) => [e.entryName, a.readFile(e)]));
  const repackAssets = b.getEntries().filter((e) => assetShaped.test(e.entryName));
  assert.ok(repackAssets.length > 0, 'no assets in repack');
  for (const e of repackAssets) {
    assert.ok(ea.has(e.entryName), `unexpected asset ${e.entryName}`);
    assert.strictEqual(Buffer.compare(b.readFile(e), ea.get(e.entryName)), 0, `differs ${e.entryName}`);
  }
});

test('custom block defs and calls use the @ prefix', () => {
  const procFiles = walk(outDir).filter((f) => f.endsWith('.fractch'));
  assert.ok(procFiles.length > 0, 'no procedure files');
  const withDef = procFiles.map((f) => fs.readFileSync(f, 'utf8')).find((t) => /def @[A-Za-z0-9_]+\(/.test(t));
  assert.ok(withDef, 'no `def @Name(` found');
});

test('no trailing-comma noise in emitted calls', () => {
  for (const f of walk(outDir).filter((f) => f.endsWith('.fractch'))) {
    const body = fs.readFileSync(f, 'utf8').split('*/').pop();
    assert.ok(!/,\s*\)/.test(body), `trailing comma in ${path.basename(f)}`);
  }
});

test('emitted calls use positional extension inputs and when sugar', () => {
  // A-B-C-named extension inputs emit positionally (no `A:` labels) ...
  const hasPositional = walk(outDir).some((f) => {
    if (!f.endsWith('.fractch')) return false;
    const text = fs.readFileSync(f, 'utf8');
    return /mistsutils\.patchcommand2\((?!A:)\S/.test(text);
  });
  const hasLabeledABC = walk(outDir).some((f) => {
    if (!f.endsWith('.fractch')) return false;
    return /mistsutils\.patchcommand\(A:/.test(fs.readFileSync(f, 'utf8'));
  });
  const hasWhenSugar = walk(outDir).some((f) => {
    if (!f.endsWith('.fractch')) return false;
    const text = fs.readFileSync(f, 'utf8');
    return /^when broadcast .+ at -?\d+,-?\d+ \{/m.test(text);
  });
  assert.ok(hasPositional, 'no positional extension input syntax found');
  assert.ok(!hasLabeledABC, 'A: labels still emitted for A-named statement inputs');
  assert.ok(hasWhenSugar, 'no when-broadcast sugar found in emitted output');

  const parsed = parseFractch('data_changevariableby(VALUE: 1, field VARIABLE: var("score", "id"));\n').calls[0];
  assert.strictEqual(parsed.args[0].sep, 'input');
  assert.strictEqual(parsed.args[1].sep, 'field');

  const legacy = parseFractch('data_changevariableby(VALUE= 1, VARIABLE: var("score", "id"));\n').calls[0];
  assert.strictEqual(legacy.args[0].sep, 'input');
  assert.strictEqual(legacy.args[1].sep, 'field');
});

test('variable changes render as vars assignment sugar', () => {
  const hit = walk(outDir).some((f) => f.endsWith('.fractch') && /vars\[[^\]]+\] \+= /.test(fs.readFileSync(f, 'utf8')));
  assert.ok(hit, 'no vars += sugar found');

  const parsed = parseFractch('vars["score"] += 1;\n').calls[0];
  assert.strictEqual(parsed.callee.name, 'data_changevariableby');
  assert.strictEqual(parsed.args[0].sep, 'field');
  assert.strictEqual(parsed.args[1].sep, 'input');
});

test('generic opcodes can use dotted namespace aliases', () => {
  const parsed = parseFractch('motion.changexby(DX: (temp2 * 10));\n').calls[0];
  assert.strictEqual(parsed.callee.name, 'motion_changexby');
  assert.strictEqual(parsed.args[0].key, 'DX');
  assert.strictEqual(parsed.args[0].sep, 'input');

  const hit = walk(outDir).some((f) => f.endsWith('.fractch') && /\b[a-zA-Z][A-Za-z0-9]*\.[A-Za-z_][A-Za-z0-9_]*\(/.test(fs.readFileSync(f, 'utf8')));
  assert.ok(hit, 'no dotted opcode alias found in generated DSL');
});

test('infix expressions parse without mandatory parens, left-associative', () => {
  const eq = parseFractch('vars["r"] = a + b * c == d;\n').calls[0].args[1].value.value;
  assert.strictEqual(eq.callee.name, 'operator_equals');
  const add = eq.args[0].value.value;
  assert.strictEqual(add.callee.name, 'operator_add');
  assert.strictEqual(add.args[1].value.value.callee.name, 'operator_multiply');

  const sub = parseFractch('vars["r"] = a - b - c;\n').calls[0].args[1].value.value;
  assert.strictEqual(sub.callee.name, 'operator_subtract');
  assert.strictEqual(sub.args[0].value.value.callee.name, 'operator_subtract');

  const oldStyle = parseFractch('vars["r"] = ((a - b) - c);\n').calls[0].args[1].value.value;
  assert.deepStrictEqual(oldStyle, sub);
});

test('negated comparisons desugar to not() wrapping the opposite operator', () => {
  const cases = { '!=': 'operator_equals', '<=': 'operator_gt', '>=': 'operator_lt' };
  for (const [sym, inner] of Object.entries(cases)) {
    const stmt = parseFractch(`if a ${sym} b { }\n`).calls[0];
    const cond = stmt.args[0].value.value;
    assert.strictEqual(cond.callee.name, 'operator_not');
    assert.strictEqual(cond.args[0].value.value.callee.name, inner);
  }
  const bang = parseFractch('if !sensing.mousedown() { }\n').calls[0].args[0].value.value;
  assert.strictEqual(bang.callee.name, 'operator_not');
  // `sensing.mousedown()` parses as a deferred method call; it resolves to the
  // opcode sensing_mousedown at build (sensing is not a var/list).
  const inner = bang.args[0].value.value.callee;
  assert.strictEqual(inner.type, 'identOrMethod');
  assert.strictEqual(`${inner.ident}_${inner.method}`, 'sensing_mousedown');
});

test('boolean literals use Scratch equality blocks and empty not renders true', async () => {
  const { buildBlocksFromCalls, IdGen } = await import('../src/buildBlocks.js');
  const { stringifyBlockCall } = await import('../src/stringify.js');

  const parsed = parseFractch('if true {\n  say "ok";\n}\n').calls;
  const { blocks, topId } = buildBlocksFromCalls(parsed, { idGen: new IdGen() });
  const condId = blocks[topId].inputs.CONDITION[1];
  assert.strictEqual(blocks[condId].opcode, 'operator_equals');
  assert.deepStrictEqual(blocks[condId].inputs.OPERAND1, [1, [4, '0']]);
  assert.deepStrictEqual(blocks[condId].inputs.OPERAND2, [1, [4, '0']]);

  const truth = {
    opcode: 'operator_equals',
    inputs: { OPERAND1: [1, [4, '0']], OPERAND2: [1, [4, '0']] },
    fields: {},
  };
  assert.strictEqual(stringifyBlockCall(truth, {}, 'truth', true), 'true');

  const emptyNot = { opcode: 'operator_not', inputs: {}, fields: {} };
  assert.strictEqual(stringifyBlockCall(emptyNot, {}, 'not', true), 'true');
});

test('bare broadcast names and stop options parse to the right blocks', () => {
  const b = parseFractch('broadcast LoadFiles;\n').calls[0];
  assert.strictEqual(b.callee.name, 'event_broadcast');
  assert.strictEqual(b.args[0].value.type, 'string');
  assert.strictEqual(b.args[0].value.value, 'LoadFiles');

  const s = parseFractch('stop this_script;\n').calls[0];
  assert.strictEqual(s.callee.name, 'control_stop');
  assert.deepStrictEqual(s.args[0].value.value, ['this script']);

  const quoted = parseFractch('stop "other scripts in sprite";\nbroadcast "Load Files";\n').calls;
  assert.deepStrictEqual(quoted[0].args[0].value.value, ['other scripts in sprite']);
  assert.strictEqual(quoted[1].args[0].value.value, 'Load Files');
});

test('/* */ is stripped; // attaches to the neighbouring block', () => {
  const src = '// header note\nwhen flag {\n  say "hi"; /* block { ( */ // greet\n  move 10;\n}\n';
  const { scripts, errors } = parseFractch(src);
  assert.deepStrictEqual(errors, []);
  const real = scripts[0].calls.filter((c) => c.type !== 'commentDecl');
  assert.deepStrictEqual(
    real.map((c) => c.callee.name),
    ['event_whenflagclicked', 'looks_say', 'motion_movesteps']
  );
  const comments = scripts[0].calls.filter((c) => c.type === 'commentDecl');
  assert.deepStrictEqual(comments.map((c) => c.text), ['header note', 'greet']);
  assert.deepStrictEqual(comments.map((c) => c.anchor), ['next', 'prev']);
  assert.strictEqual(checkFractch(src).length, 0, 'lint should ignore // and /* */ contents');
});

test('// comments pack as attached block comments and re-emit as //', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fractch-linecomment-'));
  fs.mkdirSync(path.join(dir, 'Stage'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'Stage', 'main.fractch'),
    'when flag {\n  // reset the score\n  score = 0;\n  say "hi"; // greeting\n}\n'
  );
  const sb3 = path.join(dir, 'c.sb3');
  run(`node ./bin/cli.js "${sb3}" from "${dir}"`);

  const project = JSON.parse(new AdmZip(sb3).readAsText('project.json'));
  const stage = project.targets.find((t) => t.isStage);
  const byText = Object.fromEntries(Object.values(stage.comments).map((c) => [c.text, c]));
  assert.strictEqual(stage.blocks[byText['reset the score'].blockId].opcode, 'data_setvariableto');
  assert.strictEqual(stage.blocks[byText['greeting'].blockId].opcode, 'looks_say');

  const back = path.join(dir, 'back');
  run(`node ./bin/cli.js from "${sb3}" to "${back}"`);
  const text = fs.readFileSync(path.join(back, 'Stage', 'main.fractch'), 'utf8');
  assert.match(text, /\/\/ reset the score/);
  assert.match(text, /\/\/ greeting/);
  assert.ok(!/comment\s+"/.test(text), 'default-geometry comments should not use comment "..."');
});

test('sprites[] property sugar round-trips through sensing_of', async () => {
  const { buildBlocksFromCalls, IdGen } = await import('../src/buildBlocks.js');
  const src = 'when flag {\n  goto sprites["Ui"].x, sprites["hotbar//h"].y;\n  say sprites["P"].vars["hp"];\n}\n';
  const { scripts, errors } = parseFractch(src);
  assert.deepStrictEqual(errors, []);
  const { blocks } = buildBlocksFromCalls(scripts[0].calls, { idGen: new IdGen() });
  const ofs = Object.values(blocks).filter((b) => b.opcode === 'sensing_of');
  assert.deepStrictEqual(ofs.map((b) => b.fields.PROPERTY[0]), ['x position', 'y position', 'hp']);
  const menus = Object.values(blocks).filter((b) => b.opcode === 'sensing_of_object_menu');
  assert.strictEqual(menus.length, 3);
  assert.ok(menus.every((m) => m.shadow === true));
});

test('custom block calls take positional arguments', () => {
  const src = 'def @add(amount, reason) {\n  score += amount;\n}\n\nwhen flag {\n  @add(10, "bonus");\n}\n';
  const { scripts, errors } = parseFractch(src);
  assert.deepStrictEqual(errors, []);
  const call = scripts[1].calls[1];
  assert.strictEqual(call.callee.type, 'procedureCall');
  assert.strictEqual(call.args.length, 2);
  assert.strictEqual(call.args[0].kind, 'positional');
});

test('project declarations: use/var/cloud/sprite/stage make hand-written projects self-sufficient', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fractch-decls-'));
  fs.mkdirSync(path.join(dir, 'Stage'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'Player'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'Stage', 'main.fractch'),
    'use "custom_ext" from "https://example.com/ext.js";\n' +
      'stage tempo 90 volume 80;\n' +
      'var score = 5;\nvar names = ["a", "b"];\ncloud plays = 0;\n' +
      'when flag {\n  plays += 1;\n  otherExt.dothing(A: 1);\n}\n'
  );
  fs.writeFileSync(
    path.join(dir, 'Player', 'main.fractch'),
    'sprite at 100,-50 size 150 direction 45 hidden rotation "left-right";\n' +
      'var hp = 100;\nwhen flag {\n  hp = 100;\n}\n'
  );
  const sb3 = path.join(dir, 'decls.sb3');
  run(`node ./bin/cli.js "${sb3}" from "${dir}"`);
  const p = JSON.parse(new AdmZip(sb3).readAsText('project.json'));
  const st = p.targets.find((t) => t.isStage);
  const pl = p.targets.find((t) => t.name === 'Player');
  assert.ok(p.extensions.includes('custom_ext') && p.extensions.includes('otherExt'), 'extensions registered');
  assert.strictEqual(p.extensionURLs.custom_ext, 'https://example.com/ext.js');
  assert.strictEqual(st.tempo, 90);
  assert.strictEqual(st.volume, 80);
  const vars = Object.values(st.variables);
  assert.ok(vars.some((v) => v[0] === 'score' && v[1] === 5));
  assert.ok(vars.some((v) => v[0] === '\u2601 plays' && v[2] === true), 'cloud var created');
  assert.ok(!vars.some((v) => v[0] === 'plays'), 'no spurious plain var for cloud alias');
  assert.ok(Object.values(st.lists).some((l) => l[0] === 'names' && l[1].length === 2));
  const change = Object.values(st.blocks).find((b) => b.opcode === 'data_changevariableby');
  assert.strictEqual(change.fields.VARIABLE[0], '\u2601 plays', 'bare cloud name resolves to the cloud var');
  assert.deepStrictEqual(
    { x: pl.x, y: pl.y, size: pl.size, direction: pl.direction, visible: pl.visible, rotationStyle: pl.rotationStyle },
    { x: 100, y: -50, size: 150, direction: 45, visible: false, rotationStyle: 'left-right' }
  );
  assert.ok(Object.values(pl.variables).some((v) => v[0] === 'hp' && v[1] === 100));
});

test('error suite: clear messages with hints and did-you-mean', async () => {
  const { checkProject } = await import('../src/check.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fractch-errors-'));
  fs.mkdirSync(path.join(dir, 'Stage'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'Stage', 'main.fractch'),
    'costume "bg" file "assets/missing.svg";\n' +
      'def @add_score(amount) {\n  score += amount;\n}\n' +
      'when flg {\n}\n' +
      'when flag {\n' +
      '  local hp = 10;\n  local hp = 20;\n' +
      '  @ad_score(1);\n  @add_score(1, 2, 3);\n' +
      '  lists["inv"].append("x");\n  say sprites["P"].xpos;\n' +
      '  looks.say(MESSAGE 5);\n' +
      '}\n'
  );
  const { problems } = await checkProject({ buildDir: dir, fs });
  const all = problems.map((p) => p.message).join('\n');
  assert.match(all, /did you mean 'when flag'/);
  assert.match(all, /did you mean @add_score/);
  assert.match(all, /takes 1 argument but this call passes 3/);
  assert.match(all, /local 'hp' is declared twice/);
  assert.match(all, /missing file: assets\/missing\.svg/);
  assert.match(all, /lists have no '\.append/);
  assert.match(all, /sprites have no '\.xpos'/);
  assert.match(all, /expected ',' or '\)' after an argument/);
  assert.ok(problems.some((p) => p.hint), 'problems carry hints');
  assert.ok(problems.some((p) => p.line > 0 && p.col > 0), 'problems carry positions');
});

test('unterminated strings fail at the line break instead of eating the file', () => {
  const { errors, scripts } = parseFractch('when flag {\n  say "oops;\n  move 10;\n}\n');
  assert.ok(errors.some((e) => /never closes/.test(e.message)));
  assert.ok(scripts[0].calls.some((c) => c.callee.name === 'motion_movesteps'), 'statements after the bad string still parse');
});

test('parse errors carry file line numbers', () => {
  const { calls, errors } = parseFractch('/**\n * target: X\n */\nlooks.say(MESSAGE: "ok");\nlooks.say(MESSAGE: );\n');
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(errors.length, 1);
  assert.strictEqual(errors[0].line, 5);
});

test('def accepts bare warp and omitted proccode', () => {
  const def = parseFractch('def @spin(turns) warp {\n  motion.turnright(DEGREES: turns);\n}\n').calls[0];
  assert.strictEqual(def.type, 'procDef');
  assert.strictEqual(def.warp, true);
  assert.strictEqual(def.proccode, null);
  const legacy = parseFractch('def @spin(turns) "spin %s" warp=false { }\n').calls[0];
  assert.strictEqual(legacy.warp, false);
  assert.strictEqual(legacy.proccode, 'spin %s');
});

test('menu shadows round-trip: positional arg form and ?? obscured form', async () => {
  const { buildBlocksFromCalls, IdGen } = await import('../src/buildBlocks.js');

  const visible = parseFractch('sensing.keypressed(KEY_OPTION: sensing.keyoptions("space"));\n').calls;
  const v = buildBlocksFromCalls(visible, { idGen: new IdGen() });
  const vTop = v.blocks[v.topId];
  assert.strictEqual(vTop.inputs.KEY_OPTION[0], 1);
  const vMenu = v.blocks[vTop.inputs.KEY_OPTION[1]];
  assert.strictEqual(vMenu.opcode, 'sensing_keyoptions');
  assert.strictEqual(vMenu.shadow, true);
  assert.strictEqual(vMenu.parent, v.topId);
  assert.deepStrictEqual(vMenu.fields.KEY_OPTION[0], 'space');

  const obscured = parseFractch('sensing.keypressed(KEY_OPTION: sensing.answer() ?? sensing.keyoptions("any"));\n').calls;
  const o = buildBlocksFromCalls(obscured, { idGen: new IdGen() });
  const oTop = o.blocks[o.topId];
  const tuple = oTop.inputs.KEY_OPTION;
  assert.strictEqual(tuple[0], 3);
  assert.strictEqual(o.blocks[tuple[1]].opcode, 'sensing_answer');
  assert.strictEqual(o.blocks[tuple[2]].opcode, 'sensing_keyoptions');
  assert.strictEqual(o.blocks[tuple[2]].shadow, true);

  const explicit = parseFractch('foo.bar(list: shadow skyhigh173JSON.menu_get_list(field get_list: "L"));\n').calls;
  const e = buildBlocksFromCalls(explicit, { idGen: new IdGen() });
  const eTop = e.blocks[e.topId];
  assert.strictEqual(eTop.inputs.list[0], 1);
  assert.strictEqual(e.blocks[eTop.inputs.list[1]].shadow, true);
  assert.deepStrictEqual(e.blocks[eTop.inputs.list[1]].fields.get_list, ['L']);
});

test('repack preserves every visible shadow menu block', () => {
  // Obscured menu shadows (hidden behind a plugged-in reporter) are
  // intentionally dropped - the editor regenerates them on load. Visible
  // menus carry the block's actual argument and must all survive.
  const a = JSON.parse(new AdmZip(SB3).readAsText('project.json'));
  const b = JSON.parse(new AdmZip(outSb3).readAsText('project.json'));
  const hist = (p) => {
    const m = new Map();
    for (const t of p.targets) {
      const blocks = t.blocks || {};
      for (const bl of Object.values(blocks)) {
        if (!bl || Array.isArray(bl) || !bl.inputs) continue;
        for (const tuple of Object.values(bl.inputs)) {
          if (!Array.isArray(tuple) || typeof tuple[1] !== 'string') continue;
          const child = blocks[tuple[1]];
          if (!child?.opcode) continue;
          if (child.opcode.includes('menu') || child.opcode === 'sensing_keyoptions') {
            m.set(child.opcode, (m.get(child.opcode) || 0) + 1);
          }
        }
      }
    }
    return m;
  };
  const ha = hist(a), hb = hist(b);
  for (const [op, n] of ha) {
    assert.ok((hb.get(op) || 0) >= n, `${op}: ${n} -> ${hb.get(op) || 0}`);
  }
});

test('multiple scripts per file: when/def/script split into separate stacks', () => {
  const src =
    'when flag at 0,0 {\n  say "hi";\n}\n\n' +
    'when broadcast Boot {\n  move 10;\n}\n\n' +
    'def @helper(x) {\n  turn x;\n}\n\n' +
    'script at 5,5 {\n  goto 0, 0;\n}\n';
  const { scripts, errors } = parseFractch(src);
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(scripts.length, 4);
  assert.strictEqual(scripts[0].calls[0].callee.name, 'event_whenflagclicked');
  assert.strictEqual(scripts[0].calls[1].callee.name, 'looks_say');
  assert.strictEqual(scripts[1].calls[0].callee.name, 'event_whenbroadcastreceived');
  assert.strictEqual(scripts[2].kind, 'def');
  assert.strictEqual(scripts[3].calls[0].callee.name, 'motion_gotoxy');
  assert.strictEqual(scripts[3].x, 5);
});

test('statement aliases and bare assignment desugar to real opcodes', () => {
  const src = 'score = 1;\nscore += 2;\nsay score for 2;\ncostume "walk";\nclone;\nshow;\nchange_effect brightness by 25;\nset_effect ghost to 50;\nclear_effects;\n';
  const { calls, errors } = parseFractch(src);
  assert.deepStrictEqual(errors, []);
  assert.deepStrictEqual(
    calls.map((c) => c.callee.name),
    [
      'data_setvariableto',
      'data_changevariableby',
      'looks_sayforsecs',
      'looks_switchcostumeto',
      'control_create_clone_of',
      'looks_show',
      'looks_changeeffectby',
      'looks_seteffectto',
      'looks_cleargraphiceffects',
    ]
  );
  assert.strictEqual(calls[0].args[0].sep, 'field');
  assert.strictEqual(calls[0].args[0].value.name, 'score');
  assert.deepStrictEqual(calls[6].args[1].value.value, ['BRIGHTNESS']);
  assert.deepStrictEqual(calls[7].args[1].value.value, ['GHOST']);
});

test('looks effect blocks render as effect statement sugar', async () => {
  const { buildBlocksFromCalls, IdGen } = await import('../src/buildBlocks.js');
  const { stringifyBlockCall } = await import('../src/stringify.js');
  const { calls } = parseFractch('change_effect brightness by 25;\nset_effect ghost to 50;\nclear_effects;\n');
  const { blocks, topId } = buildBlocksFromCalls(calls, { idGen: new IdGen() });

  assert.strictEqual(stringifyBlockCall(blocks[topId], blocks, topId), 'changeEffect brightness by 25;');
  const secondId = blocks[topId].next;
  assert.strictEqual(stringifyBlockCall(blocks[secondId], blocks, secondId), 'setEffect ghost to 50;');
  const thirdId = blocks[secondId].next;
  assert.strictEqual(stringifyBlockCall(blocks[thirdId], blocks, thirdId), 'clearEffects;');
});

test('nested non-main fractch files are preserved across pack then convert', async () => {
  const { buildProjectFromBuildDir, convertProject } = await import('../src/index.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fractch-folders-'));
  fs.mkdirSync(path.join(dir, 'Stage', 'systems'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Stage', 'main.fractch'), 'when flag {\n  say "main";\n}\n');
  fs.writeFileSync(path.join(dir, 'Stage', 'systems', 'ui.fractch'), 'when broadcast Ping {\n  say "ui";\n}\n');

  const { manifest } = await buildProjectFromBuildDir({ buildDir: dir });
  const out = path.join(dir, 'out');
  await convertProject(manifest, { outDir: out });

  assert.ok(fs.existsSync(path.join(out, 'Stage', 'main.fractch')), 'main.fractch missing after convert');
  assert.ok(fs.existsSync(path.join(out, 'Stage', 'systems', 'ui.fractch')), 'nested side file missing after convert');
  assert.match(fs.readFileSync(path.join(out, 'Stage', 'systems', 'ui.fractch'), 'utf8'), /when broadcast Ping/);
});

test('list sugar desugars to data_* blocks and round-trips through build', async () => {
  const { buildBlocksFromCalls, IdGen } = await import('../src/buildBlocks.js');
  const src =
    'lists["inv"].add("sword");\nlists["inv"][1] = "shield";\nlists["inv"].delete(1);\n' +
    'vars["n"] = lists["inv"].length;\nvars["x"] = lists["inv"][2];\n' +
    'if lists["inv"].contains("bow") {\n  say lists["inv"].indexof("bow");\n}\n';
  const { calls, errors } = parseFractch(src);
  assert.deepStrictEqual(errors, []);
  assert.deepStrictEqual(
    calls.map((c) => c.callee.name).slice(0, 3),
    ['data_addtolist', 'data_replaceitemoflist', 'data_deleteoflist']
  );
  const { blocks } = buildBlocksFromCalls(calls, { idGen: new IdGen() });
  const ops = Object.values(blocks).map((b) => b.opcode);
  for (const op of ['data_lengthoflist', 'data_itemoflist', 'data_listcontainsitem', 'data_itemnumoflist']) {
    assert.ok(ops.includes(op), `${op} missing`);
  }
});

test('local declarations become namespaced variables at pack time', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fractch-local-'));
  const scriptDir = path.join(dir, 'Stage');
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.writeFileSync(
    path.join(scriptDir, 'main.fractch'),
    'when flag {\n  local temp = 10;\n  temp += 1;\n  say temp;\n}\n\nwhen flag {\n  local temp = 20;\n  say temp;\n}\n'
  );
  const sb3 = path.join(dir, 'local.sb3');
  run(`node ./bin/cli.js "${sb3}" from "${dir}"`);
  const project = JSON.parse(new AdmZip(sb3).readAsText('project.json'));
  const stage = project.targets.find((t) => t.name === 'Stage');
  const varNames = Object.values(stage.variables).map((v) => v[0]);
  // Local reals encode the enclosing script (both hats -> `flagclicked`,
  // deduped to `flagclicked2`) instead of a bare counter, so they are
  // deterministic and reversible.
  assert.ok(varNames.includes('!local_flagclicked_temp'), 'first local missing: ' + varNames.join(','));
  assert.ok(varNames.includes('!local_flagclicked2_temp'), 'second local missing: ' + varNames.join(','));
  const sets = Object.values(stage.blocks).filter((b) => b.opcode === 'data_setvariableto');
  assert.ok(sets.every((b) => b.fields.VARIABLE[0].startsWith('!local_')));
  assert.ok(sets.every((b) => b.fields.VARIABLE[1]), 'local variable field ids resolved');
});

test('switch/case blocks render as readable switch statements', () => {
  const hit = walk(outDir).some((f) => {
    if (!f.endsWith('.fractch')) return false;
    const t = fs.readFileSync(f, 'utf8');
    return /switch .+\{/.test(t) && /case .+\{/.test(t);
  });
  assert.ok(hit, 'no readable switch/case rendering found');
});

test('extension opcodes are preserved literally (not renamed)', () => {
  const hit = walk(outDir).some((f) => f.endsWith('.fractch') && /mistsutils\.patchcommand\(/.test(fs.readFileSync(f, 'utf8')));
  assert.ok(hit, 'extension opcode mistsutils.patchcommand not found');
});

test('script files carry no raw JSON block snapshot - DSL text is the only source of truth', () => {
  for (const f of walk(outDir).filter((f) => f.endsWith('.fractch'))) {
    const text = fs.readFileSync(f, 'utf8');
    assert.ok(!/rawSubgraph/.test(text), `${path.basename(f)} still embeds a raw block snapshot`);
  }
});

test('extensions: only data URIs are extracted to extensions/<id>.js; http/builtin stay inline', async () => {
  const edir = fs.mkdtempSync(path.join(os.tmpdir(), 'fractch-ext-'));
  const project = {
    extensions: ['httpExt', 'dataExt', 'pen'],
    extensionURLs: {
      httpExt: 'https://example.com/ext.js',
      dataExt: 'data:application/javascript;base64,' + Buffer.from('const x = 1;').toString('base64'),
    },
  };
  const res = await writeExtensions(project, edir);
  assert.strictEqual(res.count, 1, 'only the data-URI extension is extracted');
  assert.strictEqual(fs.readFileSync(path.join(edir, 'extensions', 'dataExt.js'), 'utf8'), 'const x = 1;');
  assert.ok(!fs.existsSync(path.join(edir, 'extensions', 'httpExt.url')), 'no .url sidecar for http extensions');
  assert.ok(!fs.existsSync(path.join(edir, 'extensions', 'index.json')), 'no sidecar index.json');
});

test('data-URI extension round-trips through extensions/<id>.js', async () => {
  const edir = fs.mkdtempSync(path.join(os.tmpdir(), 'fractch-extrt-'));
  const src = "Scratch.extensions.register(new Ext());\n";
  const project = {
    targets: [{ isStage: true, name: 'Stage', variables: {}, lists: {}, blocks: {}, costumes: [], sounds: [], currentCostume: 0 }],
    extensions: ['myext'],
    extensionURLs: { myext: 'data:application/javascript;base64,' + Buffer.from(src).toString('base64') },
    monitors: [], meta: {},
  };
  const { convertProject, buildProjectFromBuildDir } = await import('../src/index.js');
  await convertProject(project, { outDir: edir });
  await writeExtensions(project, edir);
  const main = fs.readFileSync(path.join(edir, 'Stage', 'main.fractch'), 'utf8');
  assert.match(main, /use "myext" from "extensions\/myext\.js";/);
  assert.strictEqual(fs.readFileSync(path.join(edir, 'extensions', 'myext.js'), 'utf8'), src);
  const { manifest } = await buildProjectFromBuildDir({ buildDir: edir });
  const back = manifest.extensionURLs.myext;
  assert.ok(back.startsWith('data:application/javascript;base64,'), 'repacked to a data URI');
  assert.strictEqual(Buffer.from(back.split(',')[1], 'base64').toString('utf8'), src, 'source survives round-trip');
});

test('costumes/sounds are emitted as target-local assets and code declarations', () => {
  assert.ok(!fs.existsSync(path.join(outDir, 'assets')), 'global assets folder should not be emitted');
  assert.ok(!walk(outDir).some((f) => path.basename(f) === 'costumes.json'), 'costumes.json should not be emitted');
  assert.ok(!walk(outDir).some((f) => path.basename(f) === 'sounds.json'), 'sounds.json should not be emitted');
  const targetAssets = walk(outDir).filter((f) => f.includes(`${path.sep}assets${path.sep}`));
  assert.ok(targetAssets.length > 0, 'no target-local assets emitted');
  const main = walk(outDir).find((f) => path.basename(f) === 'main.fractch');
  assert.match(fs.readFileSync(main, 'utf8'), /^costume ".+" file "assets\//m);
});

test('lint accepts valid fractch and reports balanced-delimiter errors', () => {
  assert.strictEqual(checkFractch('@Foo(a= 1)\nif x { }').length, 0);
  const unbalanced = checkFractch('@Foo(a= 1');
  assert.ok(unbalanced.some((e) => /unclosed/.test(e.message)));
  const badStr = checkFractch('@Foo(a= "oops)');
  assert.ok(badStr.some((e) => /unterminated string/.test(e.message)));
});

test('lint reports mismatched and unexpected delimiters', () => {
  assert.ok(checkFractch('@Foo(a= [1)]').some((e) => /mismatched/.test(e.message)));
  assert.ok(checkFractch('done)').some((e) => /unexpected/.test(e.message)));
});

test('positional extension args map back to A/B/C input names', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fractch-positional-'));
  fs.mkdirSync(path.join(dir, 'Stage'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'Stage', 'main.fractch'),
    'when flag {\n' +
      '  mistsutils.patchcommand("origin.roturLink.queue = []");\n' +
      '  mistsutils.patchcommand2("a", mistsutils.patchreporter2(1, 2));\n' +
      '}\n'
  );
  const sb3 = path.join(dir, 'positional.sb3');
  run(`node ./bin/cli.js "${sb3}" from "${dir}"`);

  const project = JSON.parse(new AdmZip(sb3).readAsText('project.json'));
  const stage = project.targets.find((t) => t.name === 'Stage');
  const blocks = Object.values(stage.blocks);
  const cmd = blocks.find((b) => b.opcode === 'mistsutils_patchcommand');
  assert.deepStrictEqual(cmd.inputs.A[1], [10, 'origin.roturLink.queue = []']);
  const cmd2 = blocks.find((b) => b.opcode === 'mistsutils_patchcommand2');
  assert.deepStrictEqual(Object.keys(cmd2.inputs).sort(), ['A', 'B']);
  const rep2 = blocks.find((b) => b.opcode === 'mistsutils_patchreporter2');
  assert.deepStrictEqual(Object.keys(rep2.inputs).sort(), ['A', 'B']);
  assert.notStrictEqual(rep2.shadow, true, 'positional reporter must not become a menu shadow');
  assert.ok(project.extensions.includes('mistsutils'), 'namespace not auto-registered');
});

test('single-string inline extension call stays a menu shadow, keyed form a reporter', async () => {
  const { buildBlocksFromCalls } = await import('../src/buildBlocks.js');
  const parsed = parseFractch('looks.switchcostumeto(COSTUME: looks.costume("walk"));\nmistsutils.patchcommand(mistsutils.patchreporter(A: "x"));\n');
  assert.strictEqual(parsed.errors.length, 0);
  const { blocks } = buildBlocksFromCalls(parsed.calls, {});
  const menu = Object.values(blocks).find((b) => b.opcode === 'looks_costume');
  assert.strictEqual(menu.shadow, true);
  assert.deepStrictEqual(menu.fields.COSTUME, ['walk']);
  const reporter = Object.values(blocks).find((b) => b.opcode === 'mistsutils_patchreporter');
  assert.notStrictEqual(reporter.shadow, true);
  assert.ok(reporter.inputs.A, 'keyed A input missing');
});

test('else-if chains desugar to nested if_else and re-sugar on stringify', async () => {
  const { buildBlocksFromCalls } = await import('../src/buildBlocks.js');
  const { stringifyBlockCall, setContext } = await import('../src/stringify.js');
  const sugared = 'if a > 1 {\n  say 1;\n} else if a > 2 {\n  say 2;\n} else {\n  say 3;\n}\n';
  const nested = 'if a > 1 {\n  say 1;\n} else {\n  if a > 2 {\n    say 2;\n  } else {\n    say 3;\n  }\n}\n';
  const shape = (text) => {
    const parsed = parseFractch(text);
    assert.strictEqual(parsed.errors.length, 0);
    const { blocks } = buildBlocksFromCalls(parsed.calls, {});
    return Object.values(blocks)
      .map((b) => b.opcode)
      .sort();
  };
  assert.deepStrictEqual(shape(sugared), shape(nested));

  const parsed = parseFractch(sugared);
  const { topId, blocks } = buildBlocksFromCalls(parsed.calls, {});
  setContext({});
  const text = stringifyBlockCall(blocks[topId], blocks, topId, false);
  assert.ok(text.includes('} else if '), `expected re-sugared else-if, got:\n${text}`);
  assert.strictEqual((text.match(/} else \{/g) || []).length, 1, 'final plain else must stay braced');
});

test('else-if packs as Scratch-compatible nested if in else branch', async () => {
  const { buildBlocksFromCalls } = await import('../src/buildBlocks.js');
  const parsed = parseFractch('if cur == "+" {\n  say "plus";\n} else if cur == "-" {\n  say "minus";\n}\n');
  assert.strictEqual(parsed.errors.length, 0);
  const { topId, blocks } = buildBlocksFromCalls(parsed.calls, {});
  const outer = blocks[topId];
  assert.strictEqual(outer.opcode, 'control_if_else');
  const elseId = outer.inputs.SUBSTACK2[1];
  const inner = blocks[elseId];
  assert.strictEqual(inner.opcode, 'control_if');
  assert.strictEqual(inner.parent, outer.id);
  assert.ok(!Object.values(blocks).some((b) => b.opcode === 'control_else_if' || b.opcode === 'else_if'));
});

test('triple-quoted raw strings parse, emit, and round-trip', async () => {
  const { buildBlocksFromCalls } = await import('../src/buildBlocks.js');
  const { stringifyBlockCall, setContext } = await import('../src/stringify.js');
  const { checkFractch } = await import('../src/lint.js');

  const text = 'mistsutils.patchcommand("""const a = 1;\nconst b = "two";\nrun(a, b);""");\n';
  assert.strictEqual(checkFractch(text).length, 0, 'lint must accept triple-quoted strings');
  const parsed = parseFractch(text);
  assert.strictEqual(parsed.errors.length, 0);
  const arg = parsed.calls[0].args[0];
  assert.strictEqual(arg.value.value, 'const a = 1;\nconst b = "two";\nrun(a, b);');

  // Emission: a newline-bearing string input comes back out as a raw block
  // whose interior lines survive indentation untouched.
  const { topId, blocks } = buildBlocksFromCalls(parsed.calls, {});
  setContext({});
  const out = stringifyBlockCall(blocks[topId], blocks, topId, false);
  assert.ok(out.includes('"""const a = 1;\nconst b = "two";\nrun(a, b);"""'), `raw form missing:\n${out}`);
  const reparsed = parseFractch(`${out}\n`);
  assert.strictEqual(reparsed.errors.length, 0);
  assert.strictEqual(reparsed.calls[0].args[0].value.value, arg.value.value);

  // Values that cannot be raw (contain """ or edge quotes) stay escaped.
  const { stringToken } = await import('../src/stringify.js');
  assert.strictEqual(stringToken('a"""b\nc'), JSON.stringify('a"""b\nc'));
  assert.strictEqual(stringToken('ends with quote\n"'), JSON.stringify('ends with quote\n"'));
});

test('orphan argument reporters round-trip via arg("name") statement sugar', async () => {
  const { buildBlocksFromCalls } = await import('../src/buildBlocks.js');
  const { stringifyBlockCall, setContext } = await import('../src/stringify.js');
  const parsed = parseFractch('arg("Max-Scroll-Y");\n');
  assert.strictEqual(parsed.errors.length, 0);
  const { topId, blocks } = buildBlocksFromCalls(parsed.calls, {});
  const node = blocks[topId];
  assert.strictEqual(node.opcode, 'argument_reporter_string_number');
  assert.strictEqual(node.fields.VALUE[0], 'Max-Scroll-Y');
  setContext({});
  assert.strictEqual(stringifyBlockCall(node, blocks, topId, false), 'arg("Max-Scroll-Y");');
});

test('duplicate-named variables and lists survive pack via id declarations', async () => {
  const { buildProjectFromBuildDir } = await import('../src/index.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fractch-dupvars-'));
  fs.mkdirSync(path.join(dir, 'Stage'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'Stage', 'main.fractch'),
    'var temp = "a" id "id_one";\n' +
      'var temp = "b" id "id_two";\n' +
      'var "Split Text" = ["x"] id "list_one";\n' +
      'var "Split Text" = [] id "list_two";\n'
  );
  const { manifest } = await buildProjectFromBuildDir({ buildDir: dir });
  const stage = manifest.targets.find((t) => t.isStage);
  assert.deepStrictEqual(stage.variables.id_one, ['temp', 'a']);
  assert.deepStrictEqual(stage.variables.id_two, ['temp', 'b']);
  assert.deepStrictEqual(stage.lists.list_one, ['Split Text', ['x']]);
  assert.deepStrictEqual(stage.lists.list_two, ['Split Text', []]);
});

test('array literals pack as JSON strings and re-sugar on emission', async () => {
  const { buildBlocksFromCalls } = await import('../src/buildBlocks.js');
  const { stringifyBlockCall, setContext } = await import('../src/stringify.js');
  const parsed = parseFractch('mistsutils.patchreporter([1,2,"three"]);\n');
  assert.strictEqual(parsed.errors.length, 0);
  const { topId, blocks } = buildBlocksFromCalls(parsed.calls, {});
  assert.deepStrictEqual(blocks[topId].inputs.A, [1, [10, '[1,2,"three"]']]);
  setContext({});
  const out = stringifyBlockCall(blocks[topId], blocks, topId, false);
  assert.strictEqual(out, 'mistsutils.patchreporter([1,2,"three"]);');

  // Legacy raw primitive tuples keep passing through verbatim.
  const tuple = parseFractch('mistsutils.patchreporter(A: [10, "hello"]);\n');
  const built = buildBlocksFromCalls(tuple.calls, {});
  assert.deepStrictEqual(built.blocks[built.topId].inputs.A, [1, [10, 'hello']]);
  const badTupleLookalike = parseFractch('mistsutils.patchreporter(A: [10, "hello", "extra"]);\n');
  const badTupleBuilt = buildBlocksFromCalls(badTupleLookalike.calls, {});
  assert.deepStrictEqual(badTupleBuilt.blocks[badTupleBuilt.topId].inputs.A, [1, [10, '[10,"hello","extra"]']]);
  // ...and a string that happens to look like a tuple stays quoted on emit.
  const lookalike = { ...built.blocks[built.topId], inputs: { A: [1, [10, '[10,"x"]']] } };
  assert.ok(stringifyBlockCall(lookalike, {}, 'x', false).includes('"[10,\\"x\\"]"'));
});

test('package namespace calls resolve to defs (not phantom extensions) and round-trip', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fractch-pkg-'));
  fs.mkdirSync(path.join(dir, 'Stage'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'Stage', 'main.fractch'),
    'import "fractch/strings";\nimport "fractch/json" as j;\n' +
      'when flag {\n  say strings.replace("pay", "p", "g");\n  say j.valid(x);\n}\n'
  );
  const sb3 = path.join(dir, 'pkg.sb3');
  run(`node ./bin/cli.js "${sb3}" from "${dir}"`);
  const project = JSON.parse(new AdmZip(sb3).readAsText('project.json'));
  const stage = project.targets.find((t) => t.isStage);
  const opcodes = Object.values(stage.blocks).map((b) => b.opcode);
  assert.ok(!opcodes.includes('strings_replace'), 'strings.replace must not become a phantom extension opcode');
  assert.ok(!opcodes.includes('j_valid'), 'aliased j.valid must not become a phantom extension opcode');
  assert.deepStrictEqual(project.extensions, [], 'no phantom extension registered');
  const calls = Object.values(stage.blocks).filter((b) => b.opcode === 'procedures_call').map((b) => b.mutation.proccode);
  assert.ok(calls.some((c) => c.startsWith('fractch_strings_replace')), 'strings.replace -> its def call');
  assert.ok(calls.some((c) => c.startsWith('fractch_json_valid')), 'aliased j.valid -> the json def call');

  const back = path.join(dir, 'back');
  run(`node ./bin/cli.js from "${sb3}" to "${back}"`);
  const text = fs.readFileSync(path.join(back, 'Stage', 'main.fractch'), 'utf8');
  assert.match(text, /strings\.replace\("pay", "p", "g"\)/, 'package calls re-sugar to namespace form');
});

test('list functions map to list blocks; string ops stay string blocks', () => {
  const src =
    'var inv = [];\n' +
    'when flag {\n' +
    '  append(inv, "a");\n' +
    '  set(inv, 1, "c");\n' +
    '  say get(inv, 1);\n' +
    '  replace(inv, 1, "b");\n' +
    '  say item(inv, 1);\n' +
    '  say inv.length;\n' +
    '  say indexOf(inv, "b");\n' +
    '  if hasItem(inv, "b") { clear(inv); }\n' +
    '  say length("hi");\n' +
    '  if contains("hi", "h") { say "s"; }\n' +
    '}\n';
  const { scripts, errors } = parseFractch(src);
  assert.deepStrictEqual(errors, []);
  const opcodes = JSON.stringify(scripts[0].calls);
  // list ops
  for (const op of ['data_addtolist', 'data_replaceitemoflist', 'data_itemoflist', 'data_lengthoflist', 'data_itemnumoflist', 'data_listcontainsitem', 'data_deletealloflist']) {
    assert.ok(opcodes.includes(op), `expected ${op} from a list function`);
  }
  // string ops stay string ops
  assert.ok(opcodes.includes('operator_length'), 'length("hi") must stay operator_length');
  assert.ok(opcodes.includes('operator_contains'), 'contains(...) must stay operator_contains');
});

test('get/set list functions pack declared lists as valid SB3 list inputs', async () => {
  const { buildProjectFromBuildDir } = await import('../src/index.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fractch-list-getset-'));
  fs.mkdirSync(path.join(dir, 'Stage'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'Stage', 'main.fractch'),
    'var data = [];\n' +
      'when flag {\n' +
      '  local pointer = 1;\n' +
      '  set(data, pointer, get(data, pointer) + 1);\n' +
      '}\n'
  );

  const { manifest } = await buildProjectFromBuildDir({ buildDir: dir });
  const stage = manifest.targets.find((t) => t.isStage);
  assert.deepStrictEqual(stage.lists.data, ['data', []]);
  const blocks = Object.values(stage.blocks);
  assert.ok(blocks.some((b) => b.opcode === 'data_replaceitemoflist'), 'set(...) did not pack as a list replace block');
  assert.ok(blocks.some((b) => b.opcode === 'data_itemoflist'), 'get(...) did not pack as an item-of-list block');
  assert.ok(!JSON.stringify(stage.blocks).includes('[12,"data",null]'), 'list name leaked as an invalid variable primitive');
});

test('list-based json package injects a shared return-stack and folds to import', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fractch-json-'));
  fs.mkdirSync(path.join(dir, 'Stage'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'Stage', 'main.fractch'),
    'import "fractch/json";\n\n' +
      'when flag {\n' +
      '  say json.get_from("user", msg);\n' +
      '  say mistsutils.item(C: 1, A: "x.y", B: ".");\n' + // keyed args stay an extension call
      '}\n'
  );
  const sb3 = path.join(dir, 'json.sb3');
  run(`node ./bin/cli.js "${sb3}" from "${dir}"`);

  const project = JSON.parse(new AdmZip(sb3).readAsText('project.json'));
  const stage = project.targets.find((t) => t.isStage);
  const blocks = Object.values(stage.blocks);
  // The shared parse state is a collision-proof package-owned return stack.
  assert.ok(Object.values(stage.lists).some((l) => l[0] === '!json:stack'), 'return-stack list missing');
  assert.ok(Object.values(stage.variables).some((v) => v[0] === '!json:return'), 'return register var missing');
  // Every variable/list reference resolves to a real id (no null-id refs).
  for (const b of blocks) {
    for (const v of Object.values(b.inputs || {})) {
      const inner = v[1];
      if (Array.isArray(inner) && (inner[0] === 12 || inner[0] === 13)) {
        assert.strictEqual(typeof inner[2], 'string', `unresolved ${inner[0] === 13 ? 'list' : 'var'} ref ${inner[1]}`);
      }
    }
  }
  // Tree-shaken: get_from pulls in only get_data + slice (5 defs), not all 11.
  const defs = blocks.filter((b) => b.opcode === 'procedures_definition');
  assert.strictEqual(defs.length, 3, `expected only get_from's transitive closure, got ${defs.length}`);
  assert.ok(blocks.some((b) => b.opcode === 'mistsutils_item'), 'keyed extension call was hijacked');
  assert.ok(Object.keys(stage.blocks).some((k) => k.startsWith('fractch_h')), 'package defs missing file markers');

  const outDir = path.join(dir, 'back');
  run(`node ./bin/cli.js from "${sb3}" to "${outDir}"`);
  const text = fs.readFileSync(path.join(outDir, 'Stage', 'main.fractch'), 'utf8');
  assert.ok(text.includes('import "fractch/json";'), 'import line missing after convert');
  assert.ok(!text.includes('def @fractch_json_get_data'), 'package def bodies must fold into the import');
  assert.match(text, /json\.get_from\("user", msg\)/, 'package call must re-sugar to namespace form');
  assert.ok(/mistsutils\.item\(/.test(text), 'extension call must stay an opcode call');
});

test('manifest-less declarations round-trip project state', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fractch-decls-'));
  fs.mkdirSync(path.join(dir, 'Stage'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'Cat_'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'Stage', 'main.fractch'),
    'stage video off transparency 0;\n' +
      'platform "Mistwarp" from "https://warp.mistium.com/";\n' +
      'use "mistsutils" from "https://example.com/mist.js";\n' +
      'var "Weird // Name" = "hello";\n' +
      'var plain = 5;\n' +
      'var mylist = [1, "two"];\n' +
      'watch var "plain" at 10,20 range 0,50 hidden;\n' +
      'watch list "mylist" size 200x150;\n' +
      'comment "workspace note" at 50,60 size 350x170;\n' +
      'when flag {\n  say "hi";\n  comment "attached" at 1,2 size 30x40;\n}\n'
  );
  fs.writeFileSync(
    path.join(dir, 'Cat_', 'main.fractch'),
    'sprite "Cat!" at 12,-7 size 150 hidden layer 1;\n' +
      'when flag {\n  plain += 1;\n}\n'
  );
  const sb3 = path.join(dir, 'decls.sb3');
  run(`node ./bin/cli.js "${sb3}" from "${dir}"`);

  const project = JSON.parse(new AdmZip(sb3).readAsText('project.json'));
  const stage = project.targets.find((t) => t.isStage);
  assert.strictEqual(stage.videoState, 'off');
  assert.strictEqual(stage.videoTransparency, 0);
  assert.deepStrictEqual(project.meta.platform, { name: 'Mistwarp', url: 'https://warp.mistium.com/' });
  assert.strictEqual(project.extensionURLs.mistsutils, 'https://example.com/mist.js');

  const varNames = Object.values(stage.variables).map((v) => v[0]);
  assert.ok(varNames.includes('Weird // Name'));
  const plainEntry = Object.values(stage.variables).find((v) => v[0] === 'plain');
  assert.strictEqual(plainEntry[1], 5);
  const listEntry = Object.values(stage.lists).find((v) => v[0] === 'mylist');
  assert.deepStrictEqual(listEntry[1], [1, 'two']);

  const varMonitor = project.monitors.find((m) => m.opcode === 'data_variable');
  assert.strictEqual(varMonitor.params.VARIABLE, 'plain');
  assert.strictEqual(varMonitor.x, 10);
  assert.strictEqual(varMonitor.sliderMax, 50);
  assert.strictEqual(varMonitor.visible, false);
  assert.strictEqual(varMonitor.spriteName, null);
  const listMonitor = project.monitors.find((m) => m.opcode === 'data_listcontents');
  assert.strictEqual(listMonitor.width, 200);

  const comments = Object.values(stage.comments);
  const workspace = comments.find((c) => c.blockId === null);
  assert.strictEqual(workspace.text, 'workspace note');
  assert.strictEqual(workspace.width, 350);
  const attached = comments.find((c) => c.blockId !== null);
  assert.strictEqual(attached.text, 'attached');
  const anchor = stage.blocks[attached.blockId];
  assert.strictEqual(anchor.opcode, 'looks_say');
  assert.strictEqual(anchor.comment, Object.keys(stage.comments).find((k) => stage.comments[k] === attached));

  const cat = project.targets.find((t) => !t.isStage);
  assert.strictEqual(cat.name, 'Cat!');
  assert.strictEqual(cat.x, 12);
  assert.strictEqual(cat.y, -7);
  assert.strictEqual(cat.size, 150);
  assert.strictEqual(cat.visible, false);
  assert.strictEqual(cat.layerOrder, 1);
  // sprite references the stage global instead of spawning a local copy
  assert.ok(!Object.values(cat.variables).some((v) => v[0] === 'plain'), 'stage global duplicated into sprite');
});
