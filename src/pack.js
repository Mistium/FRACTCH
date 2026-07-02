import * as path from './pathUtils.js';
import { toPromiseFs } from './fsAdapter.js';
import { parseFractch } from './parse.js';
import { buildBlocksFromCalls, mergeIntoManifest, IdGen, synthesizeProccode } from './buildBlocks.js';
import { assertValidFractch } from './lint.js';

export const BLANK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="100%" height="100%" fill="white"/></svg>';
export const BLANK_SVG_ID = 'c3d7ff782edb43ba0e0a79849362613c';

// Packing reconstructs every block purely by parsing the DSL text - there is
// no raw JSON snapshot anywhere to fall back on, so the .fractch files
// themselves are the single source of truth for the round trip.
export async function buildProjectFromBuildDir({ buildDir, fs: fsLike, verbose = false }) {
  const vfs = toPromiseFs(fsLike);
  const manifestPath = path.join(buildDir, 'manifest.json');
  const hasManifest = await vfs.exists(manifestPath);
  let manifest = hasManifest ? JSON.parse(await vfs.readFile(manifestPath, 'utf8')) : null;

  const scriptFiles = await collectScriptFiles(vfs, buildDir, manifest, verbose);
  if (!manifest) manifest = synthesizeManifest(scriptFiles);
  ensureTargetsForScripts(manifest, scriptFiles);

  const targets = new Map(); // manifestTargetName -> { name, stacks: Array<{hatOpcode, calls, topBlockId}> }
  const procArgMaps = new Map(); // targetName -> Map(proccode -> argumentids[])
  const identToProccode = new Map(); // targetName -> Map(ident -> proccode)
  const procMetaMaps = new Map(); // targetName -> Map(proccode -> { warp, customcolor })
  let totalScripts = 0;
  let parsedScripts = 0;

  for (const scriptFile of scriptFiles) {
    const { fPath, targetDir, hatDir } = scriptFile;
    const manifestTarget = findManifestTargetForDir(manifest, targetDir);
    if (!manifestTarget) continue;
    const manifestName = manifestTarget.name;
    const content = await vfs.readFile(fPath, 'utf8');
    totalScripts++;

    const headerInfo = parseHeaderInfo(content);

    try {
      assertValidFractch(content, fPath);
      const calls = parseFractch(content).calls;
      if (!targets.has(manifestName)) targets.set(manifestName, { name: manifestName, stacks: [] });
      const inferredHat = hatDir === 'nohat' ? null : hatDir;
      targets.get(manifestName).stacks.push({
        hatOpcode: headerInfo?.hatOpcode || inferredHat,
        calls,
        topBlockId: headerInfo?.topBlockId,
        x: headerInfo?.x ?? null,
        y: headerInfo?.y ?? null,
      });
      registerProcDefs(procArgMaps, identToProccode, procMetaMaps, manifestName, calls);
      if (!hasManifest) collectNamesIntoManifest(manifestTarget, calls);
      parsedScripts++;
    } catch (e) {
      if (verbose) console.warn(`Skip unparsable file: ${fPath}: ${e.message}`);
      continue;
    }
  }

  // Variable/list names resolve against the target's own dict plus the
  // Stage's globals (Scratch scoping: sprite-local shadows global). Broadcasts
  // are project-wide regardless of which target defines them.
  const stageTarget = (manifest.targets || []).find((t) => t.isStage);
  const stageVarMap = buildNameIdMap(stageTarget?.variables);
  const stageListMap = buildNameIdMap(stageTarget?.lists);
  const broadcastNameToId = new Map();
  for (const t of manifest.targets || []) {
    for (const [name2, id2] of buildNameIdMap(t.broadcasts)) {
      if (!broadcastNameToId.has(name2)) broadcastNameToId.set(name2, id2);
    }
  }

  const builtTargets = [];
  for (const [name, data] of targets) {
    const scripts = [];
    const sharedIdGen = new IdGen(); // Shared ID generator across all scripts in this target
    const manifestTarget = (manifest.targets || []).find((t) => t.name === name);
    const varMap = new Map([...stageVarMap, ...buildNameIdMap(manifestTarget?.variables)]);
    const listMap = new Map([...stageListMap, ...buildNameIdMap(manifestTarget?.lists)]);
    let stackIndex = 0;
    for (const s of data.stacks) {
      const { blocks, topId } = buildBlocksFromCalls(s.calls, {
        hatOpcode: s.hatOpcode,
        proceduresMapForTarget: procArgMaps.get(name),
        identToProccode: identToProccode.get(name),
        procMeta: procMetaMaps.get(name),
        varMap,
        listMap,
        broadcastNameToId,
        idGen: sharedIdGen,
      });
      // Canvas position from the header when present; a simple grid keeps
      // headerless hand-written scripts from stacking on top of each other.
      if (topId && blocks[topId] && blocks[topId].topLevel) {
        blocks[topId].x = s.x ?? (stackIndex % 5) * 500;
        blocks[topId].y = s.y ?? Math.floor(stackIndex / 5) * 700;
      }
      stackIndex++;
      scripts.push({ oldTopId: s.topBlockId || null, blocks, newTopId: topId });
    }
    builtTargets.push({ name, scripts });
  }

  const newManifest = mergeIntoManifest(manifest, builtTargets);
  return { manifest: newManifest, hasManifest, totalScripts, parsedScripts };
}

async function collectScriptFiles(vfs, buildDir, manifest, verbose) {
  const fromIndex = await collectScriptFilesFromIndexes(vfs, buildDir);
  const files = fromIndex.length ? fromIndex : await scanScriptFiles(vfs, buildDir, manifest);
  const unique = [];
  const seen = new Set();
  for (const file of files) {
    const key = path.normalizePath(file.fPath);
    if (seen.has(key)) continue;
    seen.add(key);
    if (await isIgnoredScript(vfs, buildDir, file.fPath)) {
      if (verbose) console.log(`[pack] Ignoring ${path.relative(buildDir, file.fPath)}`);
      continue;
    }
    unique.push(file);
  }
  return unique;
}

async function collectScriptFilesFromIndexes(vfs, buildDir) {
  const rootIndex = path.join(buildDir, 'index.fractch');
  if (await vfs.exists(rootIndex)) {
    const files = await collectImportsFromIndex(vfs, rootIndex, buildDir);
    if (files.length) return files;
  }

  const files = [];
  for (const dirName of await safeListDir(vfs, buildDir)) {
    const tPath = path.join(buildDir, dirName);
    if (!(await vfs.isDirectory(tPath)) || isReservedBuildDir(dirName)) continue;
    const targetIndex = path.join(tPath, 'index.fractch');
    if (await vfs.exists(targetIndex)) files.push(...(await collectImportsFromIndex(vfs, targetIndex, buildDir)));
  }
  return files;
}

async function collectImportsFromIndex(vfs, indexPath, buildDir, seenIndexes = new Set()) {
  const resolvedIndex = path.normalizePath(indexPath);
  if (seenIndexes.has(resolvedIndex)) return [];
  seenIndexes.add(resolvedIndex);

  const files = [];
  const text = await vfs.readFile(indexPath, 'utf8');
  for (const imported of extractImports(text)) {
    const abs = path.resolveFrom(path.dirname(indexPath), imported);
    if (!isInside(abs, buildDir) || !(await vfs.exists(abs)) || !abs.endsWith('.fractch')) continue;
    if (path.basename(abs) === 'index.fractch') {
      files.push(...(await collectImportsFromIndex(vfs, abs, buildDir, seenIndexes)));
      continue;
    }
    const info = scriptPathInfo(buildDir, abs);
    if (info) files.push(info);
  }
  return files;
}

function extractImports(text) {
  const imports = [];
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('import ')) continue;
    const m = /^import\s+["']([^"']+)["']\s*;?/.exec(line);
    if (m) imports.push(m[1]);
  }
  return imports;
}

async function scanScriptFiles(vfs, buildDir, manifest) {
  const files = [];
  for (const dirName of await safeListDir(vfs, buildDir)) {
    const tPath = path.join(buildDir, dirName);
    if (!(await vfs.isDirectory(tPath)) || isReservedBuildDir(dirName)) continue;
    if (manifest && !findManifestTargetForDir(manifest, dirName)) continue;
    for (const hatDir of await safeListDir(vfs, tPath)) {
      const hPath = path.join(tPath, hatDir);
      if (!(await vfs.isDirectory(hPath))) continue;
      for (const file of await safeListDir(vfs, hPath)) {
        if (!file.endsWith('.fractch') || file === 'index.fractch') continue;
        const info = scriptPathInfo(buildDir, path.join(hPath, file));
        if (info) files.push(info);
      }
    }
  }
  return files;
}

function scriptPathInfo(buildDir, fPath) {
  const rel = path.relative(buildDir, fPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const parts = rel.split('/');
  if (parts.length < 3) return null;
  const [targetDir, hatDir] = parts;
  if (!targetDir || !hatDir || isReservedBuildDir(targetDir)) return null;
  return { fPath, targetDir, hatDir };
}

async function isIgnoredScript(vfs, buildDir, fPath) {
  const base = path.basename(fPath);
  if (base.endsWith('.ignore.fractch')) return true;
  const parts = path.relative(buildDir, fPath).split('/');
  if (parts.some((p) => p.startsWith('.'))) return true;
  try {
    const head = String(await vfs.readFile(fPath, 'utf8')).slice(0, 512);
    return /\bfractch:ignore\b/.test(head);
  } catch {
    return false;
  }
}

function isReservedBuildDir(dirName) {
  return dirName === 'assets' || dirName === 'extensions' || dirName.startsWith('.');
}

function isInside(absPath, dir) {
  const rel = path.relative(dir, absPath);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function synthesizeManifest(scriptFiles) {
  const targetNames = [];
  const seen = new Set();
  for (const f of scriptFiles) {
    if (seen.has(f.targetDir)) continue;
    seen.add(f.targetDir);
    targetNames.push(f.targetDir);
  }
  if (seen.has('Stage')) {
    targetNames.sort((a, b) => (a === 'Stage' ? -1 : b === 'Stage' ? 1 : 0));
  } else {
    targetNames.unshift('Stage');
  }

  return {
    targets: targetNames.map((name, index) => makeTarget(name, index)),
    monitors: [],
    extensions: [],
    meta: {
      semver: '3.0.0',
      vm: '0.2.0',
      agent: 'FRACTCH',
    },
  };
}

function ensureTargetsForScripts(manifest, scriptFiles) {
  if (!Array.isArray(manifest.targets)) manifest.targets = [];
  const existing = new Set();
  for (const t of manifest.targets) {
    existing.add(t.name);
    existing.add(sanitize(t.name));
  }
  for (const f of scriptFiles) {
    if (existing.has(f.targetDir)) continue;
    manifest.targets.push(makeTarget(f.targetDir, manifest.targets.length));
    existing.add(f.targetDir);
  }
  if (!manifest.targets.some((t) => t.isStage)) {
    const stage = manifest.targets.find((t) => t.name === 'Stage') || manifest.targets[0];
    if (stage) stage.isStage = true;
  }
}

function makeTarget(name, index) {
  const isStage = name === 'Stage' || index === 0;
  const target = {
    isStage,
    name,
    variables: {},
    lists: {},
    broadcasts: {},
    blocks: {},
    comments: {},
    currentCostume: 0,
    costumes: [defaultCostume(isStage)],
    sounds: [],
    volume: 100,
    layerOrder: index,
  };
  if (isStage) {
    target.tempo = 60;
    target.videoTransparency = 50;
    target.videoState = 'on';
    target.textToSpeechLanguage = null;
  } else {
    Object.assign(target, {
      visible: true,
      x: 0,
      y: 0,
      size: 100,
      direction: 90,
      draggable: false,
      rotationStyle: 'all around',
    });
  }
  return target;
}

function defaultCostume(isStage) {
  return {
    name: isStage ? 'backdrop1' : 'costume1',
    bitmapResolution: 1,
    dataFormat: 'svg',
    assetId: BLANK_SVG_ID,
    md5ext: `${BLANK_SVG_ID}.svg`,
    rotationCenterX: isStage ? 240 : 0,
    rotationCenterY: isStage ? 180 : 0,
  };
}

function collectNamesIntoManifest(target, calls) {
  const vars = new Set();
  const lists = new Set();
  const broadcasts = new Set();
  collectNames(calls, { vars, lists, broadcasts });
  for (const name of vars) ensureDictEntry(target.variables, name, [name, 0]);
  for (const name of lists) ensureDictEntry(target.lists, name, [name, []]);
  for (const name of broadcasts) ensureDictEntry(target.broadcasts, name, name);
}

function collectNames(nodes, out) {
  for (const node of nodes || []) collectNamesFromNode(node, out);
}

function collectNamesFromNode(node, out) {
  if (!node) return;
  if (node.type === 'procDef') {
    collectNames(node.body, out);
    return;
  }
  if (node.type === 'danglingNext') return;
  if (node.type !== 'call') return;

  for (const arg of node.args || []) {
    if (arg.kind === 'branch') {
      collectNames(arg.body, out);
      continue;
    }
    if (arg.kind !== 'keyed') continue;
    if (arg.sep === 'field') {
      if (arg.key === 'VARIABLE') collectFieldName(arg.value, out.vars);
      if (arg.key === 'LIST') collectFieldName(arg.value, out.lists);
      if (arg.key === 'BROADCAST_OPTION') collectFieldName(arg.value, out.broadcasts);
    }
    if (arg.sep === 'input' && arg.key === 'BROADCAST_INPUT') collectBroadcastInputName(arg.value, out.broadcasts);
    collectNamesFromValue(arg.value, out);
  }
}

function collectNamesFromValue(value, out) {
  if (!value) return;
  if (value.type === 'var') out.vars.add(value.name);
  else if (value.type === 'list') out.lists.add(value.name);
  else if (value.type === 'broadcast') out.broadcasts.add(value.name);
  else if (value.type === 'ident') out.vars.add(value.name);
  else if (value.type === 'call') collectNamesFromNode(value.value, out);
}

function collectFieldName(value, set) {
  if (!value) return;
  if (value.type === 'array' && typeof value.value?.[0] === 'string') set.add(value.value[0]);
  else if (value.type === 'string') set.add(value.value);
  else if (value.type === 'ident') set.add(value.name);
}

function collectBroadcastInputName(value, set) {
  if (!value) return;
  if (value.type === 'string') set.add(value.value);
  else if (value.type === 'broadcast') set.add(value.name);
}

function ensureDictEntry(dict, name, value) {
  if (!dict || !name) return;
  for (const entry of Object.values(dict)) {
    const existing = Array.isArray(entry) ? entry[0] : entry;
    if (existing === name) return;
  }
  let id = sanitize(name) || 'item';
  if (!/^[A-Za-z_]/.test(id)) id = `_${id}`;
  let n = 1;
  let finalId = id;
  while (Object.prototype.hasOwnProperty.call(dict, finalId)) finalId = `${id}_${++n}`;
  dict[finalId] = value;
}

// Custom-block definitions carry their own argument ids implicitly (the
// param idents, or the original ids if a call site elsewhere in the same
// build supplied them) - scan every parsed procDef up front so calls to it
// (which may live in an entirely different file) get consistent argument ids.
function registerProcDefs(procArgMaps, identToProccode, procMetaMaps, targetName, calls) {
  if (!(calls.length === 1 && calls[0].type === 'procDef')) return;
  const procDef = calls[0];
  const proccode = procDef.proccode || synthesizeProccode(procDef.ident, procDef.params.length);
  if (!procArgMaps.has(targetName)) procArgMaps.set(targetName, new Map());
  if (!identToProccode.has(targetName)) identToProccode.set(targetName, new Map());
  if (!procMetaMaps.has(targetName)) procMetaMaps.set(targetName, new Map());
  const map = procArgMaps.get(targetName);
  const identMap = identToProccode.get(targetName);
  const metaMap = procMetaMaps.get(targetName);
  if (!identMap.has(procDef.ident)) identMap.set(procDef.ident, proccode);
  if (!map.has(proccode)) map.set(proccode, procDef.params.map((p) => p.ident));
  if (!metaMap.has(proccode)) metaMap.set(proccode, { warp: procDef.warp, customcolor: procDef.customcolor, returns: procDef.returns });
}

function buildNameIdMap(dict) {
  const map = new Map();
  for (const [id, entry] of Object.entries(dict || {})) {
    const name = Array.isArray(entry) ? entry[0] : entry;
    if (typeof name === 'string' && !map.has(name)) map.set(name, id);
  }
  return map;
}

async function safeListDir(vfs, dir) {
  try {
    return await vfs.readdir(dir);
  } catch {
    return [];
  }
}

function findManifestTargetForDir(manifest, dirName) {
  if (!manifest?.targets) return null;
  for (const t of manifest.targets) {
    if (t.name === dirName) return t;
    if (sanitize(t.name) === dirName) return t;
  }
  return null;
}

function sanitize(name) {
  return String(name).replace(/[^a-zA-Z0-9-_]/g, '_');
}

function parseHeaderInfo(text) {
  try {
    if (!String(text || '').startsWith('/**')) return null;
    const headStart = text.indexOf('/**');
    const headEnd = text.indexOf('*/', headStart + 3);
    const head = headStart >= 0 && headEnd > headStart ? text.slice(headStart, headEnd) : text;
    const lines = head.split(/\r?\n/);
    const map = new Map();
    for (const line of lines) {
      const m = /\*\s*([^:]+):\s*(.*)$/.exec(line.trim());
      if (m) map.set(m[1].trim(), m[2].trim());
    }
    const pos = /^(-?\d+),(-?\d+)$/.exec(map.get('pos') || '');
    return {
      hatOpcode: map.get('hatOpcode'),
      topBlockId: map.get('topBlockId'),
      x: pos ? Number(pos[1]) : null,
      y: pos ? Number(pos[2]) : null,
    };
  } catch {
    return null;
  }
}

export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a == null || b == null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqual(a[k], b[k])) return false;
  }
  return true;
}
