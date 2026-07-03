#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import { spawn } from 'child_process';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { unpackSb3, packSb3, checkProject, buildProjectFromBuildDir, convertProject } from '../src/index.js';

const USAGE =
  'Usage:\n' +
  '  fractch new <dir>                       scaffold a fresh fractch project\n' +
  '  fractch from <project.sb3> [to <dir>]   unpack an .sb3 into .fractch text\n' +
  '  fractch [to] <project.sb3> from <dir>   pack a project dir into an .sb3\n' +
  '                                          (--origin <sb3> copies non-asset extras from it)\n' +
  '  fractch check <dir>                     parse + lint every .fractch file\n' +
  '  fractch fmt <dir>                       rewrite files in canonical (current) syntax\n' +
  '  fractch watch <dir> [to <sb3>]          repack automatically on change\n' +
  '  fractch run <dir>                       pack, open in the editor, repack on save\n' +
  '                                          (--editor <url> to override, default MistWarp)\n' +
  '  fractch --input <sb3> --out <dir>       flag form (same as `from ... to ...`)';

const rawArgs = hideBin(process.argv);
const words = [];
for (let i = 0; i < rawArgs.length; i++) {
  if (rawArgs[i] === '--editor' || rawArgs[i] === '--origin') {
    i++; // skip its value
    continue;
  }
  if (!rawArgs[i].startsWith('-')) words.push(rawArgs[i]);
}
const command = ['new', 'check', 'fmt', 'watch', 'run'].includes(words[0]) ? words[0] : null;

const DEFAULT_EDITOR = 'https://warp.mistium.com/editor.html';

function translateWordSyntax(args) {
  const flags = [];
  const words = [];
  for (const a of args) (a.startsWith('-') ? flags : words).push(a);
  if (!words.length) return args;

  if (words[0] === 'from' && words[1]) {
    const input = words[1];
    const out =
      words[2] === 'to' && words[3]
        ? words[3]
        : path.join('.', path.basename(input).replace(/\.sb3$/i, '') || 'build');
    return ['--input', input, '--out', out, ...flags];
  }

  const sb3At = words[0] === 'to' ? 1 : 0;
  if (words[sb3At] && words[sb3At + 1] === 'from' && words[sb3At + 2]) {
    return ['--pack', '--outSb3', words[sb3At], '--out', words[sb3At + 2], ...flags];
  }

  return args;
}

function defaultSb3For(dir) {
  return path.join('.', (path.basename(path.resolve(dir)) || 'project') + '.sb3');
}

async function runCheck(dir) {
  const buildDir = path.resolve(dir || '.');
  const { files, problems, sources } = await checkProject({ buildDir, fs });
  for (const p of problems) {
    const loc = p.line ? `:${p.line}${p.col ? ':' + p.col : ''}` : '';
    console.log(`${p.file}${loc}: ${p.message}`);
    const src = sources?.get(p.file);
    if (src && p.line) {
      const lineText = src.split('\n')[p.line - 1];
      if (lineText !== undefined && lineText.trim()) {
        console.log(`    ${lineText}`);
        if (p.col) console.log(`    ${' '.repeat(Math.max(p.col - 1, 0))}^`);
      }
    }
    if (p.hint) console.log(`    hint: ${p.hint}`);
  }
  console.log(`${files} file${files === 1 ? '' : 's'} checked, ${problems.length} problem${problems.length === 1 ? '' : 's'}`);
  process.exit(problems.length ? 1 : 0);
}

// Canonicalize every .fractch file: rebuild the project in memory through the
// pack pipeline, then re-emit it over the same directory with the current
// emission style. Legacy syntax parses forever, so this is the one-command way
// to modernize a build dir. Refuses to run while check reports problems -
// parse-skipped statements would be silently dropped by the rewrite.
async function runFmt(dir, verbose) {
  const buildDir = path.resolve(dir || '.');
  const { problems } = await checkProject({ buildDir, fs });
  if (problems.length) {
    for (const p of problems) {
      const loc = p.line ? `:${p.line}${p.col ? ':' + p.col : ''}` : '';
      console.error(`${p.file}${loc}: ${p.message}`);
    }
    console.error(`[fractch] fmt refused: fix the ${problems.length} problem${problems.length === 1 ? '' : 's'} above first`);
    process.exit(1);
  }
  const { manifest } = await buildProjectFromBuildDir({ buildDir, verbose, prune: false });
  const result = await convertProject(manifest, { outDir: buildDir, verbose });
  console.log(`[fractch] fmt: rewrote ${result.filesWritten} file${result.filesWritten === 1 ? '' : 's'} in ${buildDir}`);
}

async function runWatch(dir, outSb3, verbose, onPacked) {
  const buildDir = path.resolve(dir || '.');
  const target = path.resolve(outSb3 || defaultSb3For(buildDir));

  let packing = false;
  let queued = false;
  const repack = async (reason) => {
    if (packing) {
      queued = true;
      return;
    }
    packing = true;
    const started = Date.now();
    try {
      await packSb3({ buildDir, outSb3: target, verbose });
      console.log(`[fractch] ${reason}: packed ${path.basename(target)} in ${Date.now() - started}ms`);
      if (onPacked) onPacked(target);
    } catch (e) {
      console.error(`[fractch] pack failed: ${e.message}`);
    }
    packing = false;
    if (queued) {
      queued = false;
      repack('change');
    }
  };

  await repack('initial');
  let timer = null;
  fs.watch(buildDir, { recursive: true }, (event, file) => {
    if (!file || (!file.endsWith('.fractch') && !file.endsWith('manifest.json'))) return;
    clearTimeout(timer);
    timer = setTimeout(() => repack('change'), 200);
  });
  console.log(`[fractch] watching ${buildDir} -> ${target} (ctrl-c to stop)`);
  return target;
}

async function runRun(dir, editorFlagValue) {
  const buildDir = path.resolve(dir || '.');
  const tmpSb3 = path.join(os.tmpdir(), `fractch-run-${Date.now()}.sb3`);
  const editor = editorFlagValue || DEFAULT_EDITOR;

  await runWatch(buildDir, tmpSb3, false);

  const server = http.createServer((req, res) => {
    if (req.url.split('?')[0] !== '/project.sb3' || !fs.existsSync(tmpSb3)) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(fs.readFileSync(tmpSb3));
  });
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    const url = `${editor}?project_url=${encodeURIComponent(`http://127.0.0.1:${port}/project.sb3`)}`;
    console.log(`[fractch] serving project at http://127.0.0.1:${port}/project.sb3`);
    console.log(`[fractch] opening ${url}`);
    console.log('[fractch] edit .fractch files and refresh the editor tab to reload');
    openInBrowser(url);
  });
}

function openInBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    spawn(cmd, [url], { detached: true, stdio: 'ignore', shell: process.platform === 'win32' }).unref();
  } catch {
    console.log(`[fractch] open manually: ${url}`);
  }
}

function runNew(dir) {
  if (!dir) {
    console.error('usage: fractch new <dir>');
    process.exit(1);
  }
  const root = path.resolve(dir);
  const scriptDir = path.join(root, 'Stage');
  if (fs.existsSync(root) && fs.readdirSync(root).length) {
    console.error(`refusing to scaffold into non-empty directory: ${root}`);
    process.exit(1);
  }
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.writeFileSync(
    path.join(scriptDir, 'main.fractch'),
    'when flag {\n' +
      '  local greeting = "hello from fractch";\n' +
      '  say greeting for 2;\n' +
      '}\n' +
      '\n' +
      'when broadcast Ping {\n' +
      '  say "pong";\n' +
      '}\n'
  );
  fs.writeFileSync(path.join(root, '.gitignore'), '*.sb3\n');
  const name = path.basename(root);
  console.log(`Created ${name}/Stage/main.fractch`);
  console.log('');
  console.log('Next steps:');
  console.log(`  fractch check ${dir}`);
  console.log(`  fractch ${name}.sb3 from ${dir}`);
  console.log(`  fractch watch ${dir}      # repack on every save`);
}

(async () => {
  try {
    if (!rawArgs.length) {
      console.log(USAGE);
      return;
    }
    if (command === 'new') {
      runNew(words[1]);
      return;
    }
    if (command === 'check') {
      await runCheck(words[1]);
      return;
    }
    if (command === 'fmt') {
      await runFmt(words[1], rawArgs.includes('--verbose') || rawArgs.includes('-v'));
      return;
    }
    if (command === 'watch') {
      const out = words[2] === 'to' ? words[3] : words[2];
      await runWatch(words[1], out, rawArgs.includes('--verbose') || rawArgs.includes('-v'));
      return; // keeps the process alive via fs.watch
    }
    if (command === 'run') {
      const editorIdx = rawArgs.indexOf('--editor');
      await runRun(words[1], editorIdx >= 0 ? rawArgs[editorIdx + 1] : null);
      return; // keeps the process alive via the http server
    }

    const argv = yargs(translateWordSyntax(rawArgs))
      .usage(USAGE)
      .wrap(null)
      .option('input', { alias: 'i', type: 'string', describe: 'Path to .sb3 file' })
      .option('out', { alias: 'o', type: 'string', describe: 'Output directory' })
      .option('verbose', { alias: 'v', type: 'boolean', default: false, describe: 'Verbose logging' })
      .option('pack', { type: 'boolean', default: false, describe: 'Pack build directory into an .sb3 (reverse conversion)' })
      .option('outSb3', { type: 'string', describe: 'Output .sb3 path when using --pack' })
      .check((argv) => {
        if (argv.pack) {
          if (!argv.out) throw new Error('--out (build directory) is required when using --pack');
        } else {
          if (!argv.input) throw new Error('--input is required');
          if (!argv.out) throw new Error('--out is required');
        }
        return true;
      })
      .help().argv;

    const verbose = argv.verbose;
    const originIdx = rawArgs.indexOf('--origin');
    if (argv.pack) {
      await packSb3({
        buildDir: path.resolve(argv.out),
        outSb3: path.resolve(argv.outSb3 || path.join(process.cwd(), 'out.sb3')),
        originSb3: originIdx >= 0 ? path.resolve(rawArgs[originIdx + 1]) : undefined,
        verbose,
      });
      process.exit(0);
    }

    const sb3Path = path.resolve(argv.input);
    if (!fs.existsSync(sb3Path)) {
      console.error(`Input not found: ${sb3Path}`);
      process.exit(1);
    }
    if (verbose) console.log(`Reading sb3: ${sb3Path}`);
    const result = await unpackSb3({ input: sb3Path, outDir: path.resolve(argv.out), verbose });
    if (verbose) console.log(`Wrote ${result.filesWritten} files to ${argv.out}`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
})();
