import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline/promises';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { packFromBuildDir } from './packSb3.js';

const ALIASES = {
  title: 'app.windowTitle',
  width: 'stageWidth',
  height: 'stageHeight',
  fps: 'framerate',
  flag: 'controls.greenFlag.enabled',
  stop: 'controls.stopAll.enabled',
  fullscreen: 'controls.fullscreen.enabled',
  pause: 'controls.pause.enabled',
};

const BOOL_FLAGS = ['yes', 'y', 'verbose', 'v', 'options', 'rebuild'];
const OWN_FLAGS = ['packager', ...BOOL_FLAGS];
const BOOL_RE = /^(true|false|yes|no|y|n|1|0|on|off)$/i;

const TARGETS = [
  'html',
  'zip',
  'zip-one-asset',
  'electron-win32',
  'electron-win64',
  'electron-win-arm',
  'electron-mac',
  'electron-linux64',
  'electron-linux-arm32',
  'electron-linux-arm64',
  'webview-mac',
  'nwjs-win32',
  'nwjs-win64',
  'nwjs-mac',
  'nwjs-linux-x64',
];

const PROMPTS = [
  ['target', 'Output target (html, zip, electron-win64, electron-mac, ...)'],
  ['app.windowTitle', 'Title'],
  ['stageWidth', 'Stage width'],
  ['stageHeight', 'Stage height'],
  ['framerate', 'Framerate'],
  ['turbo', 'Turbo mode'],
  ['interpolation', 'Interpolation'],
  ['highQualityPen', 'High quality pen'],
  ['autoplay', 'Autoplay'],
  ['controls.greenFlag.enabled', 'Show green flag button'],
  ['controls.stopAll.enabled', 'Show stop button'],
  ['controls.fullscreen.enabled', 'Show fullscreen button'],
  ['controls.pause.enabled', 'Show pause button'],
];

export function parsePackageArgs(args, defaults = {}) {
  const words = [];
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('-')) {
      words.push(a);
      continue;
    }
    let key = a.replace(/^--?/, '');
    let value;
    const eq = key.indexOf('=');
    if (eq >= 0) {
      value = key.slice(eq + 1);
      key = key.slice(0, eq);
    } else if (key.startsWith('no-')) {
      key = key.slice(3);
      value = 'false';
    }
    key = ALIASES[key] || key;
    const isBool = BOOL_FLAGS.includes(key) || typeof getPath(defaults, key) === 'boolean';
    const next = args[i + 1];
    if (value === undefined && next !== undefined && (isBool ? BOOL_RE.test(next) : !next.startsWith('--'))) {
      value = args[++i];
    }
    flags[key] = value === undefined ? 'true' : value;
  }
  return { words, flags };
}

function getPath(obj, dotted) {
  return dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function setPath(obj, dotted, value) {
  const keys = dotted.split('.');
  const last = keys.pop();
  keys.reduce((o, k) => o[k], obj)[last] = value;
}

export function coerceOption(defaults, key, raw) {
  const current = getPath(defaults, key);
  if (current === undefined || (current !== null && typeof current === 'object')) {
    throw new Error(`unknown packager option: ${key} (see fractch package --options)`);
  }
  if (typeof current === 'boolean') {
    if (BOOL_RE.test(raw)) return /^(true|yes|y|1|on)$/i.test(raw);
    throw new Error(`${key} expects true or false, got "${raw}"`);
  }
  if (typeof current === 'number') {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`${key} expects a number, got "${raw}"`);
    return n;
  }
  if (key === 'target' && !TARGETS.includes(raw)) {
    throw new Error(`target must be one of: ${TARGETS.join(', ')}`);
  }
  return raw;
}

function listOptions(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? listOptions(v, `${prefix}${k}.`)
      : [`  --${prefix}${k}  (default ${JSON.stringify(v)})`]
  );
}

const CACHE_DIR = path.join(os.homedir(), '.cache', 'fractch', 'packager');
const SCAFFOLDING_BASE = 'https://packager.warp.mistium.com/scaffolding/';
const SCAFFOLDING_FILES = ['scaffolding-min.js', 'scaffolding-full.js', 'addons.js'];

async function buildPackager(flagPath) {
  const checkout = path.resolve(
    flagPath || process.env.FRACTCH_PACKAGER || path.join(os.homedir(), 'mistwarp', 'packager')
  );
  const webpack = path.join(checkout, 'node_modules', 'webpack', 'bin', 'webpack.js');
  if (!fs.existsSync(webpack)) {
    throw new Error(
      `MistWarp packager checkout not found at ${checkout}\n` +
        '  git clone https://github.com/MistWarp/packager && cd packager && npm ci\n' +
        '  then pass --packager <that dir> or set $FRACTCH_PACKAGER (only needed once; the build is cached)'
    );
  }
  console.log(`[fractch] building the MistWarp packager from ${checkout} (one time)`);
  const config = fileURLToPath(new URL('./packagerWebpack.cjs', import.meta.url));
  const built = spawnSync(process.execPath, [webpack, '--config', config], {
    cwd: checkout,
    env: { ...process.env, FRACTCH_PACKAGER_OUT: CACHE_DIR },
    encoding: 'utf8',
  });
  if (built.status !== 0) throw new Error(`packager build failed:\n${built.stdout}${built.stderr}`);

  fs.mkdirSync(path.join(CACHE_DIR, 'scaffolding'), { recursive: true });
  for (const file of SCAFFOLDING_FILES) {
    const res = await fetch(SCAFFOLDING_BASE + file);
    if (!res.ok) throw new Error(`${res.status} fetching ${SCAFFOLDING_BASE}${file}`);
    fs.writeFileSync(path.join(CACHE_DIR, 'scaffolding', file), Buffer.from(await res.arrayBuffer()));
  }
}

async function loadPackager(flagPath, rebuild) {
  const entry = path.join(CACHE_DIR, 'packager.js');
  const scaffolding = path.join(CACHE_DIR, 'scaffolding', SCAFFOLDING_FILES[0]);
  if (rebuild || !fs.existsSync(entry) || !fs.existsSync(scaffolding)) await buildPackager(flagPath);
  const size = fs.statSync(scaffolding).size;
  const tail = Buffer.alloc(Math.min(200, size));
  const fd = fs.openSync(scaffolding, 'r');
  fs.readSync(fd, tail, 0, tail.length, size - tail.length);
  fs.closeSync(fd);
  const id = /(\S+) =\^\.\.\^=\s*$/.exec(tail.toString('utf8'));
  if (id) process.env.SCAFFOLDING_BUILD_ID = id[1];
  return createRequire(import.meta.url)(entry);
}

export async function runPackage(args) {
  const early = parsePackageArgs(args).flags;
  const Packager = await loadPackager(early.packager, 'rebuild' in early);
  const defaults = Packager.Packager.DEFAULT_OPTIONS();
  const { words, flags } = parsePackageArgs(args, defaults);

  if (flags.options) {
    console.log(listOptions(defaults).join('\n'));
    console.log(
      'aliases: ' +
        Object.entries(ALIASES)
          .map(([a, k]) => `--${a} = --${k}`)
          .join(', ')
    );
    return;
  }

  const input = path.resolve(words[0] || '.');
  if (!fs.existsSync(input)) throw new Error(`Input not found: ${input}`);
  const name = path.basename(input).replace(/\.sb3$/i, '') || 'project';
  const outArg = words[1] === 'to' ? words[2] : words[1];

  const chosen = { 'app.windowTitle': name };
  for (const [key, raw] of Object.entries(flags)) {
    if (!OWN_FLAGS.includes(key)) chosen[key] = coerceOption(defaults, key, raw);
  }

  const interactive = process.stdin.isTTY && !flags.yes && !flags.y;
  if (interactive) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      for (const [key, label] of PROMPTS) {
        if (key in flags) continue;
        const fallback = key in chosen ? chosen[key] : getPath(defaults, key);
        for (;;) {
          const answer = (await rl.question(`${label} [${fallback}]: `)).trim();
          if (!answer) break;
          try {
            chosen[key] = coerceOption(defaults, key, answer);
            break;
          } catch (e) {
            console.log(`  ${e.message}`);
          }
        }
      }
    } finally {
      rl.close();
    }
  }

  let sb3 = input;
  let tmp = null;
  if (fs.statSync(input).isDirectory()) {
    tmp = path.join(os.tmpdir(), `fractch-package-${Date.now()}.sb3`);
    await packFromBuildDir({ buildDir: input, outSb3: tmp, verbose: 'verbose' in flags || 'v' in flags });
    sb3 = tmp;
  }

  try {
    const packager = new Packager.Packager();
    packager.project = await Packager.loadProject(fs.readFileSync(sb3));
    for (const [key, value] of Object.entries(chosen)) setPath(packager.options, key, value);
    const result = await packager.package();
    const ext = path.extname(result.filename) || (result.type === 'text/html' ? '.html' : '.zip');
    const out = path.resolve(outArg || `${name}${ext}`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, result.data);
    const rel = path.relative(process.cwd(), out);
    console.log(`[fractch] packaged ${rel.startsWith('..') ? out : rel} (${result.data.length} bytes)`);
    const replay = Object.entries(chosen).map(([k, v]) => `--${k} ${JSON.stringify(v)}`);
    if (interactive)
      console.log(`[fractch] repeat without prompts: fractch package ${words[0] || '.'} ${replay.join(' ')} --yes`);
  } finally {
    if (tmp) fs.rmSync(tmp, { force: true });
  }
}
