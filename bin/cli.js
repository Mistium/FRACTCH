#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { writeExtensions } from '../src/extensions.js';
import { convertProject } from '../src/convert.js';
import { packFromBuildDir } from '../src/pack.js';

const argv = yargs(hideBin(process.argv))
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
  .option('preferDSL', {
    type: 'boolean',
    default: true,
    describe: 'When packing, prefer parsing DSL body over header snapshot (so edits change output)',
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
  if (argv.pack) {
    const outDir = path.resolve(argv.out);
    const outSb3 = path.resolve(argv.outSb3 || path.join(process.cwd(), 'out.sb3'));
    await packFromBuildDir({
      buildDir: outDir,
      outSb3,
      verbose,
      preferDSL: argv.preferDSL,
    });
    process.exit(0);
  }
  const sb3Path = path.resolve(argv.input);
  const outDir = path.resolve(argv.out);

  if (!fs.existsSync(sb3Path)) {
    console.error(`Input not found: ${sb3Path}`);
    process.exit(1);
  }

  fs.mkdirSync(outDir, { recursive: true });

  if (verbose) console.log(`Reading sb3: ${sb3Path}`);
  const zip = new AdmZip(sb3Path);
  const entry = zip.getEntry('project.json');
  if (!entry) {
    console.error('project.json not found inside sb3');
    process.exit(1);
  }
  const projectJson = JSON.parse(zip.readAsText(entry));

  if (verbose) console.log(`Converting project with ${projectJson.targets?.length || 0} targets...`);
  const result = convertProject(projectJson, { outDir, verbose });

  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(result.manifest, null, 2));
  fs.writeFileSync(path.join(outDir, 'index.fractch'), result.indexContent);

  const ext = await writeExtensions(projectJson, outDir, { verbose });
  if (verbose && ext) console.log(`Extensions: ${ext.fetched||0}/${ext.count||0} sources fetched`);

  if (verbose) console.log(`Wrote ${result.filesWritten} files to ${outDir}`);
})();
