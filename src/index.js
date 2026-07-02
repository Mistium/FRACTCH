import nodeFs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { convertProject as convertProjectCore } from './convert.js';
import { buildProjectFromBuildDir as buildProjectCore } from './pack.js';
import { writeExtensions as writeExtensionsCore } from './extensions.js';
import { packFromBuildDir } from './packSb3.js';
import { checkProject as checkProjectCore } from './check.js';
import { writeAssets } from './assets.js';

export async function convertProject(projectJson, opts = {}) {
  return convertProjectCore(projectJson, { fs: nodeFs, ...opts });
}

export async function buildProjectFromBuildDir(opts = {}) {
  return buildProjectCore({ fs: nodeFs, ...opts });
}

export async function writeExtensions(projectJson, outDir, opts = {}) {
  return writeExtensionsCore(projectJson, outDir, { fs: nodeFs, ...opts });
}

export async function checkProject(opts = {}) {
  return checkProjectCore({ fs: nodeFs, ...opts });
}

export async function unpackSb3({ input, outDir, verbose = false }) {
  const zip = new AdmZip(path.resolve(input));
  const entry = zip.getEntry('project.json');
  if (!entry) throw new Error(`project.json not found inside ${input}`);
  const projectJson = JSON.parse(zip.readAsText(entry));

  const result = await convertProject(projectJson, { outDir, verbose, config: readCwdConfig() });
  writeAssets(zip, projectJson, outDir, { verbose });
  await writeExtensions(projectJson, outDir, { verbose });
  return result;
}

export async function packSb3({ buildDir, outSb3, originSb3, verbose = false }) {
  return packFromBuildDir({ buildDir, outSb3, originSb3, verbose });
}

function readCwdConfig() {
  try {
    const p = path.join(process.cwd(), 'fractch.config.json');
    if (!nodeFs.existsSync(p)) return {};
    return JSON.parse(nodeFs.readFileSync(p, 'utf8') || '{}') || {};
  } catch {
    return {};
  }
}

export { packFromBuildDir } from './packSb3.js';
export { writeAssets } from './assets.js';
export { BLANK_SVG, BLANK_SVG_ID, deepEqual } from './pack.js';
export { toPromiseFs } from './fsAdapter.js';
export { cleanIdent, buildProcByCode } from './convert.js';
export { parseFractch, preprocess } from './parse.js';
export { buildBlocksFromCalls, mergeIntoManifest, IdGen, synthesizeProccode } from './buildBlocks.js';
export { checkFractch, assertValidFractch, FractchSyntaxError } from './lint.js';
export { emitScriptFile, emitIndex, emitTargetIndex } from './emit.js';
export { stringifyBlockCall, renderBody, setContext } from './stringify.js';
