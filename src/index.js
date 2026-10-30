import nodeFs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { convertProject as convertProjectCore } from './convert.js';
import { buildProjectFromBuildDir as buildProjectCore } from './pack.js';
import { writeExtensions as writeExtensionsCore } from './extensions.js';
import { packFromBuildDir } from './packSb3.js';
import { checkProject as checkProjectCore } from './check.js';
import { writeCompressedZip } from './writeZip.js';
import { projectToFiles, filesToProject, safeProjectPath, ARCHIVE_IGNORED } from './project.js';
import { diagnostic } from './diagnostics.js';

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

const isFractchSource = (name) => name.endsWith('.fractch');

export function readArchive(input) {
  const zip = new AdmZip(path.resolve(input));
  const entries = new Map();
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    entries.set(entry.entryName, new Uint8Array(zip.readFile(entry) || []));
  }
  return entries;
}

function projectTreeEntries(entries) {
  const tree = new Map();
  for (const [name, data] of entries) {
    if (ARCHIVE_IGNORED.test(name)) continue;
    const safe = safeProjectPath(name);
    if (safe) tree.set(safe, data);
  }
  return tree;
}

function writeFileMap(files, outDir) {
  for (const [rel, data] of files) {
    const target = path.join(outDir, ...rel.split('/'));
    nodeFs.mkdirSync(path.dirname(target), { recursive: true });
    nodeFs.writeFileSync(target, data);
  }
}

function readFileMap(dir) {
  const files = new Map();
  const walk = (current, rel) => {
    for (const entry of nodeFs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) walk(child, childRel);
      else if (entry.isFile()) files.set(childRel, new Uint8Array(nodeFs.readFileSync(child)));
    }
  };
  walk(path.resolve(dir), '');
  return files;
}

function projectArchiveEntries(projectJson, assets) {
  const entries = [{ name: 'project.json', data: Buffer.from(JSON.stringify(projectJson)) }];
  for (const [name, data] of assets) entries.push({ name, data: Buffer.from(data) });
  return entries;
}

export async function unpackSb3({ input, outDir, verbose = false }) {
  const entries = readArchive(input);
  if (!entries.has('project.json')) {
    const tree = projectTreeEntries(entries);
    if (![...tree.keys()].some(isFractchSource)) {
      const historyOnly = [...entries.keys()].some((name) => name.startsWith('.git/'));
      throw new Error(
        historyOnly
          ? `${input} only holds project history; open it in MistWarp and save it again to get the project files`
          : `project.json not found inside ${input}`
      );
    }
    writeFileMap(tree, outDir);
    return { diagnostics: [], filesWritten: tree.size };
  }
  const projectJson = JSON.parse(new TextDecoder().decode(entries.get('project.json')));
  const { files, diagnostics } = await projectToFiles({
    projectJson,
    readAsset: (name) => entries.get(name) || null,
    config: readCwdConfig(),
  });
  writeFileMap(files, outDir);
  if (verbose) {
    diagnostics.push(diagnostic('FR308', `${files.size} files written`, { severity: 'info' }));
  }
  return { diagnostics, filesWritten: [...files.keys()].filter(isFractchSource).length };
}

export async function packSb3({ buildDir, outSb3, originSb3 }) {
  const fromArchive = /\.mwp$/i.test(buildDir) && nodeFs.existsSync(buildDir) && nodeFs.statSync(buildDir).isFile();
  if (/\.mwp$/i.test(outSb3)) {
    const files = fromArchive ? projectTreeEntries(readArchive(buildDir)) : readFileMap(buildDir);
    const checked = await filesToProject(files);
    writeCompressedZip(
      outSb3,
      [...files].map(([name, data]) => ({ name, data: Buffer.from(data) }))
    );
    return { diagnostics: checked.diagnostics };
  }
  if (fromArchive) {
    const { projectJson, assets, diagnostics } = await filesToProject(projectTreeEntries(readArchive(buildDir)));
    writeCompressedZip(outSb3, projectArchiveEntries(projectJson, assets));
    return { diagnostics };
  }
  return packFromBuildDir({ buildDir, outSb3, originSb3 });
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
export { emitScriptFile, emitMultiScriptFile, emitIndex, emitTargetIndex } from './emit.js';
export { stringifyBlockCall, renderBody, createStringifier } from './stringify.js';
export {
  emitTarget,
  buildTarget,
  toReplaceChange,
  findInSourceMap,
  alignScripts,
  compareScripts,
  defaultUid,
} from './target.js';
export { DIAGNOSTIC_CODES, diagnostic, formatDiagnostic, hasErrors, makeLineIndex } from './diagnostics.js';
export { MEMBERSHIP_MAGIC, readMembership, membershipText, commentText, splitCommentText } from './membership.js';
export { normalizeSignatures, normalizeOpcodeTable, signatureHash } from './signatures.js';
export { languageReference, referenceWithDocs } from './reference.js';
export {
  projectToFiles,
  filesToProject,
  verifyProjectFiles,
  projectAssetPaths,
  safeProjectPath,
  CUSTOM_ASSETS_DIR,
} from './project.js';
export { compareProjects } from './projectDiff.js';
export { METADATA_FILE, LEGACY_METADATA_FILES, FONTS_DIR } from './projectMeta.js';
export { memoryFs } from './memoryFs.js';
export { RESERVED_ROOT_DIRS, targetDirNames } from './emit.js';
export { md5hex } from './md5.js';
