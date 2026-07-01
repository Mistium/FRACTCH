#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { unpackSb3, packSb3 } from '../src/index.js';

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

const argv = yargs(translateWordSyntax(hideBin(process.argv)))
  .usage(
    'Usage:\n' +
      '  fractch from <project.sb3> [to <dir>]   unpack an .sb3 into .fractch text\n' +
      '  fractch [to] <project.sb3> from <dir>   pack a build dir into an .sb3\n' +
      '  fractch --input <sb3> --out <dir>       flag form (same as `from ... to ...`)'
  )
  .option('input', {
    alias: 'i',
    type: 'string',
    demandOption: false,
    describe: 'Path to .sb3 file',
  })
  .option('out', {
    alias: 'o',
    type: 'string',
    demandOption: false,
    describe: 'Output directory',
  })
  .option('verbose', {
    alias: 'v',
    type: 'boolean',
    default: false,
    describe: 'Verbose logging',
  })
  .option('pack', {
    type: 'boolean',
    default: false,
    describe: 'Pack build directory into an .sb3 (reverse conversion)',
  })
  .option('outSb3', {
    type: 'string',
    describe: 'Output .sb3 path when using --pack',
  })
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

(async () => {
  const verbose = argv.verbose;
  try {
    if (argv.pack) {
      await packSb3({
        buildDir: path.resolve(argv.out),
        outSb3: path.resolve(argv.outSb3 || path.join(process.cwd(), 'out.sb3')),
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
