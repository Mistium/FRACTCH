import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import AdmZip from 'adm-zip';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeExtensions } from '../src/index.js';
import { checkFractch } from '../src/lint.js';
import { parseFractch } from '../src/parse.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SB3 = 'originv6.0.0.sb3';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fractch-'));
const outDir = path.join(tmp, 'build');
const outSb3 = path.join(tmp, 'repacked.sb3');
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'pipe' });

run(`node ./bin/cli.js --input ${SB3} --out "${outDir}"`);

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

test('build emits manifest, index, and script files', () => {
  assert.ok(fs.existsSync(path.join(outDir, 'manifest.json')));
  assert.ok(fs.existsSync(path.join(outDir, 'index.fractch')));
  assert.ok(walk(outDir).some((f) => f.endsWith('.fractch')));
});

test('pack reconstructs every target purely from parsed DSL text', () => {
  run(`node ./bin/cli.js --pack --out "${outDir}" --outSb3 "${outSb3}"`);
  const a = JSON.parse(new AdmZip(path.join(root, SB3)).readAsText('project.json'));
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
  const scriptDir = path.join(dir, 'Stage', 'event_whenflagclicked');
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.writeFileSync(
    path.join(scriptDir, 'main.fractch'),
    'event_whenflagclicked();\nlooks_say(MESSAGE= "hello from fractch");\n'
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

  const result = await unpackSb3({ input: path.join(root, SB3), outDir: buildDir });
  assert.ok(result.filesWritten > 0);
  assert.ok(fs.existsSync(path.join(buildDir, 'manifest.json')));
  assert.ok(fs.existsSync(path.join(buildDir, 'index.fractch')));

  await packSb3({ buildDir, outSb3: sb3, originSb3: path.join(root, SB3) });
  const project = JSON.parse(new AdmZip(sb3).readAsText('project.json'));
  const orig = JSON.parse(new AdmZip(path.join(root, SB3)).readAsText('project.json'));
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
  const projectJson = JSON.parse(new AdmZip(path.join(root, SB3)).readAsText('project.json'));

  const result = await convertProject(projectJson, { outDir: '/build', fs: memfs });
  assert.ok(result.filesWritten > 0);
  assert.ok((await memfs.promises.readFile('/build/manifest.json', 'utf8')).length > 0);
  assert.ok((await memfs.promises.readFile('/build/index.fractch', 'utf8')).includes('import "'));

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
  const scriptDir = path.join(dir, 'Stage', 'event_whenflagclicked');
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.fractch'), 'import "./Stage/event_whenflagclicked/keep.fractch";\n');
  fs.writeFileSync(path.join(scriptDir, 'keep.fractch'), 'event_whenflagclicked();\nlooks_say(MESSAGE= "keep");\n');
  fs.writeFileSync(path.join(scriptDir, 'drop.fractch'), 'event_whenflagclicked();\nlooks_say(MESSAGE= "drop");\n');
  const sb3 = path.join(dir, 'indexed.sb3');

  run(`node ./bin/cli.js --pack --out "${dir}" --outSb3 "${sb3}"`);

  const project = JSON.parse(new AdmZip(sb3).readAsText('project.json'));
  const stage = project.targets.find((t) => t.name === 'Stage');
  const messages = Object.values(stage.blocks)
    .filter((b) => b.opcode === 'looks_say')
    .map((b) => b.inputs?.MESSAGE?.[1]?.[1]);
  assert.deepStrictEqual(messages, ['keep']);
});

test('all assets (costumes/sounds) round-trip byte-identically', () => {
  // project.json is reconstructed from parsed DSL text (see the pack test
  // above) - only the non-block assets are expected byte-identical here.
  const a = new AdmZip(path.join(root, SB3));
  const b = new AdmZip(outSb3);
  const ea = new Map(a.getEntries().map((e) => [e.entryName, a.readFile(e)]).filter(([name]) => name !== 'project.json'));
  const eb = new Map(b.getEntries().map((e) => [e.entryName, b.readFile(e)]).filter(([name]) => name !== 'project.json'));
  assert.strictEqual(ea.size, eb.size);
  for (const [name, buf] of ea) {
    assert.ok(eb.has(name), `missing ${name}`);
    assert.strictEqual(Buffer.compare(buf, eb.get(name)), 0, `differs ${name}`);
  }
});

test('custom block defs and calls use the @ prefix', () => {
  const procFiles = walk(outDir).filter((f) => f.includes('procedures_definition') && f.endsWith('.fractch'));
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

test('emitted calls use readable colon inputs and explicit field arguments', () => {
  const hasColonInput = walk(outDir).some((f) => {
    if (!f.endsWith('.fractch')) return false;
    const text = fs.readFileSync(f, 'utf8');
    return /mistsutils\.patchcommand2\(A:/.test(text);
  });
  const hasBareFieldRef = walk(outDir).some((f) => {
    if (!f.endsWith('.fractch')) return false;
    const text = fs.readFileSync(f, 'utf8');
    return /(?<!field )BROADCAST_OPTION: broadcast\(/.test(text);
  });
  assert.ok(hasColonInput, 'no readable colon input syntax found');
  assert.ok(hasBareFieldRef, 'no self-classifying field ref syntax found');

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
  assert.strictEqual(bang.args[0].value.value.callee.name, 'sensing_mousedown');
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

test('repack preserves every shadow menu block (opcode histogram parity)', () => {
  const a = JSON.parse(new AdmZip(path.join(root, SB3)).readAsText('project.json'));
  const b = JSON.parse(new AdmZip(outSb3).readAsText('project.json'));
  const hist = (p) => {
    const m = new Map();
    for (const t of p.targets) for (const bl of Object.values(t.blocks || {})) {
      if (bl?.opcode?.includes('menu') || bl?.opcode === 'sensing_keyoptions') m.set(bl.opcode, (m.get(bl.opcode) || 0) + 1);
    }
    return m;
  };
  const ha = hist(a), hb = hist(b);
  for (const [op, n] of ha) {
    assert.ok((hb.get(op) || 0) >= n, `${op}: ${n} -> ${hb.get(op) || 0}`);
  }
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

test('extensions: http url -> .url file, data url -> decoded source', async () => {
  const edir = fs.mkdtempSync(path.join(os.tmpdir(), 'fractch-ext-'));
  const project = {
    extensions: ['httpExt', 'dataExt', 'pen'],
    extensionURLs: {
      httpExt: 'https://example.com/ext.js',
      dataExt: 'data:application/javascript;base64,' + Buffer.from('const x = 1;').toString('base64'),
    },
  };
  await writeExtensions(project, edir);
  assert.strictEqual(fs.readFileSync(path.join(edir, 'extensions', 'httpExt.url'), 'utf8'), 'https://example.com/ext.js');
  assert.strictEqual(fs.readFileSync(path.join(edir, 'extensions', 'dataExt.js'), 'utf8'), 'const x = 1;');
  const index = JSON.parse(fs.readFileSync(path.join(edir, 'extensions', 'index.json'), 'utf8'));
  assert.strictEqual(index.find((e) => e.id === 'pen').kind, 'builtin');
  assert.strictEqual(index.find((e) => e.id === 'httpExt').kind, 'url');
  assert.strictEqual(index.find((e) => e.id === 'dataExt').kind, 'data');
});

test('extensions folder is generated during build', () => {
  assert.ok(fs.existsSync(path.join(outDir, 'extensions', 'index.json')));
});

test('costumes/sounds are extracted to the build (assets + listings)', () => {
  assert.ok(fs.existsSync(path.join(outDir, 'assets')));
  assert.ok(fs.readdirSync(path.join(outDir, 'assets')).length > 0);
  const listings = walk(outDir).filter((f) => path.basename(f) === 'costumes.json');
  assert.ok(listings.length > 0, 'no costumes.json emitted');
  const costumes = JSON.parse(fs.readFileSync(listings[0], 'utf8'));
  assert.ok(Array.isArray(costumes) && costumes.length > 0);
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
