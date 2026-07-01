import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import AdmZip from 'adm-zip';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeExtensions } from '../src/extensions.js';
import { checkFractch } from '../src/lint.js';

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

test('lossless pack reproduces byte-identical project.json', () => {
  run(`node ./bin/cli.js --pack --out "${outDir}" --outSb3 "${outSb3}" --no-preferDSL`);
  const a = new AdmZip(path.join(root, SB3)).readAsText('project.json');
  const b = new AdmZip(outSb3).readAsText('project.json');
  assert.strictEqual(a, b);
});

test('all assets (costumes/sounds) round-trip byte-identically', () => {
  const a = new AdmZip(path.join(root, SB3));
  const b = new AdmZip(outSb3);
  const ea = new Map(a.getEntries().map((e) => [e.entryName, a.readFile(e)]));
  const eb = new Map(b.getEntries().map((e) => [e.entryName, b.readFile(e)]));
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

test('extension opcodes are preserved literally (not renamed)', () => {
  const hit = walk(outDir).some((f) => f.endsWith('.fractch') && /mistsutils_patchcommand\(/.test(fs.readFileSync(f, 'utf8')));
  assert.ok(hit, 'extension opcode mistsutils_patchcommand not found');
});

test('header carries a valid rawSubgraph snapshot for lossless repack', () => {
  const f = walk(outDir).find((f) => f.endsWith('.fractch') && path.basename(f) !== 'index.fractch');
  const text = fs.readFileSync(f, 'utf8');
  const m = /rawSubgraph_b64:\s*([A-Za-z0-9+/=]+)/.exec(text);
  assert.ok(m, 'no rawSubgraph_b64 in header');
  const json = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
  assert.strictEqual(typeof json, 'object');
  assert.ok(Object.keys(json).length > 0, 'empty snapshot');
});

test('extensions: http url -> .url file, data url -> decoded source', () => {
  const edir = fs.mkdtempSync(path.join(os.tmpdir(), 'fractch-ext-'));
  const project = {
    extensions: ['httpExt', 'dataExt', 'pen'],
    extensionURLs: {
      httpExt: 'https://example.com/ext.js',
      dataExt: 'data:application/javascript;base64,' + Buffer.from('const x = 1;').toString('base64'),
    },
  };
  writeExtensions(project, edir);
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
