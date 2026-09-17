import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline/promises';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
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

const BOOL_FLAGS = ['yes', 'y', 'verbose', 'v', 'options'];
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
    if (raw.trim() === '' || Number.isNaN(n)) throw new Error(`${key} expects a number, got "${raw}"`);
    return n;
  }
  if (key === 'target' && !TARGETS.includes(raw)) {
    throw new Error(`target must be one of: ${TARGETS.join(', ')}`);
  }
  return raw;
}

const STORED_KEYS = {
  framerate: 'framerate',
  turbo: 'turbo',
  interpolation: 'interpolation',
  hq: 'highQualityPen',
  width: 'stageWidth',
  height: 'stageHeight',
  'runtimeOptions.maxClones': 'maxClones',
  'runtimeOptions.miscLimits': 'miscLimits',
  'runtimeOptions.fencing': 'fencing',
  'compilerOptions.enabled': 'compiler.enabled',
  'compilerOptions.warpTimer': 'compiler.warpTimer',
};

export function storedSettings(stageComments = []) {
  const line = stageComments.flatMap((text) => text.split('\n')).find((l) => l.endsWith(' // _twconfig_'));
  if (!line) return {};
  let config;
  try {
    config = JSON.parse(line.slice(0, -' // _twconfig_'.length).replace(/\bInfinity\b/g, '1e999'));
  } catch {
    return {};
  }
  const out = {};
  for (const [from, to] of Object.entries(STORED_KEYS)) {
    const value = getPath(config, from);
    if (typeof value === 'number' || typeof value === 'boolean') out[to] = value;
  }
  return out;
}

function formatFlags(options) {
  return Object.entries(options)
    .map(([k, v]) => `--${k} ${typeof v === 'string' ? JSON.stringify(v) : v}`)
    .join(' ');
}

function listOptions(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? listOptions(v, `${prefix}${k}.`)
      : [`  --${prefix}${k}  (default ${JSON.stringify(v)})`]
  );
}

const CACHE_DIR = path.join(os.homedir(), '.cache', 'fractch', 'packager');

async function loadPackager(flagPath) {
  const gui = path.resolve(
    flagPath || process.env.FRACTCH_PACKAGER || path.join(os.homedir(), 'mistwarp', 'scratch-gui')
  );
  const source = path.join(gui, 'src', 'packager', 'packager');
  if (!fs.existsSync(path.join(source, 'packager.js'))) {
    throw new Error(
      `MistWarp editor checkout not found at ${gui}\n` +
        '  git clone https://github.com/MistWarp/scratch-gui, install + build it,\n' +
        '  then pass --packager <that dir> or set $FRACTCH_PACKAGER'
    );
  }
  const runtimeRoot = path.join(gui, 'build', 'packager-runtime');
  const runtimes = fs.existsSync(runtimeRoot)
    ? fs
        .readdirSync(runtimeRoot)
        .filter((id) => fs.existsSync(path.join(runtimeRoot, id, 'scaffolding-full.js')))
        .sort((a, b) => fs.statSync(path.join(runtimeRoot, b)).mtimeMs - fs.statSync(path.join(runtimeRoot, a)).mtimeMs)
    : [];
  if (!runtimes.length) {
    throw new Error(`no built player runtime in ${runtimeRoot}\n  run the editor build there first (npm run build)`);
  }
  process.env.SCAFFOLDING_BUILD_ID = runtimes[0];
  process.env.FRACTCH_PACKAGER_RUNTIME = path.join(runtimeRoot, runtimes[0]);

  const require = createRequire(path.join(gui, 'package.json'));
  const entry = path.join(CACHE_DIR, 'packager.cjs');
  await require('esbuild').build({
    stdin: {
      contents: fs.readFileSync(fileURLToPath(new URL('./packagerEntry.js', import.meta.url)), 'utf8'),
      resolveDir: source,
      sourcefile: 'fractch-packager-entry.js',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: entry,
    logLevel: 'error',
    loader: { '.png': 'binary', '.svg': 'text' },
    define: { 'import.meta.env.BASE_URL': '""' },
    plugins: [
      {
        name: 'packager-runtime',
        setup(build) {
          build.onResolve({ filter: /^virtual:packager-runtime$/ }, () => ({ path: 'runtime', namespace: 'fractch' }));
          build.onLoad({ filter: /.*/, namespace: 'fractch' }, () => ({
            contents: 'export const buildId = process.env.SCAFFOLDING_BUILD_ID; export const development = false;',
          }));
        },
      },
    ],
  });
  delete require.cache[entry];
  return require(entry);
}

export async function runPackage(args) {
  const early = parsePackageArgs(args).flags;
  const Packager = await loadPackager(early.packager);
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

  let sb3 = input;
  let tmp = null;
  if (fs.statSync(input).isDirectory()) {
    tmp = path.join(os.tmpdir(), `fractch-package-${Date.now()}.sb3`);
    await packFromBuildDir({ buildDir: input, outSb3: tmp, verbose: 'verbose' in flags || 'v' in flags });
    sb3 = tmp;
  }

  try {
    const project = await Packager.loadProject(fs.readFileSync(sb3));
    const stored = storedSettings(project.analysis?.stageComments);
    const chosen = { 'app.windowTitle': name, ...stored };
    if (Object.keys(stored).length) {
      console.log(`[fractch] defaults from the project's stored settings: ${formatFlags(stored)}`);
    }
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

    const packager = new Packager.Packager();
    packager.project = project;
    for (const [key, value] of Object.entries(chosen)) setPath(packager.options, key, value);
    const result = await packager.package();
    const ext = path.extname(result.filename) || (result.type === 'text/html' ? '.html' : '.zip');
    const out = path.resolve(outArg || `${name}${ext}`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, result.data);
    const rel = path.relative(process.cwd(), out);
    console.log(`[fractch] packaged ${rel.startsWith('..') ? out : rel} (${result.data.length} bytes)`);
    if (interactive) {
      console.log(`[fractch] repeat without prompts: fractch package ${words[0] || '.'} ${formatFlags(chosen)} --yes`);
    }
  } finally {
    if (tmp) fs.rmSync(tmp, { force: true });
  }
}
