import * as path from './pathUtils.js';
import { toPromiseFs } from './fsAdapter.js';
import { parseFractch } from './parse.js';
import { buildBlocksFromCalls, mergeIntoManifest, IdGen, synthesizeProccode } from './buildBlocks.js';
import { assertValidFractch } from './lint.js';
import { cleanRelStem, idSafeSuffix, markerPrefixForFileStem } from './fileMarkers.js';
import { md5hex } from './md5.js';

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

  const { files: scriptFiles, fromIndex } = await collectScriptFiles(vfs, buildDir, manifest, verbose);
  if (!manifest) manifest = synthesizeManifest(scriptFiles);
  ensureTargetsForScripts(manifest, scriptFiles);
  if (fromIndex) pruneManifestToScriptTargets(manifest, scriptFiles);

  const targets = new Map(); // manifestTargetName -> { name, stacks: Array<{hatOpcode, calls, topBlockId}> }
  const assetFiles = new Map(); // md5ext -> buildDir-relative source path
  const assetSeenForTarget = new Set();
  const procArgMaps = new Map(); // targetName -> Map(proccode -> argumentids[])
  const identToProccode = new Map(); // targetName -> Map(ident -> proccode)
  const procMetaMaps = new Map(); // targetName -> Map(proccode -> { warp, customcolor })
  const cloudAliasMaps = new Map(); // targetName -> Map(bareName -> '\u2601 name')
  let totalScripts = 0;
  let parsedScripts = 0;

  for (const scriptFile of scriptFiles) {
    const { fPath, targetDir, hatDir, sourceRel } = scriptFile;
    const manifestTarget = findManifestTargetForDir(manifest, targetDir);
    if (!manifestTarget) continue;
    const manifestName = manifestTarget.name;
    const content = await vfs.readFile(fPath, 'utf8');
    totalScripts++;

    const headerInfo = parseHeaderInfo(content);

    try {
      assertValidFractch(content, fPath);
      const parsed = parseFractch(content);
      for (const err of parsed.errors || []) {
        console.warn(`[fractch] ${fPath}:${err.line}${err.col ? ':' + err.col : ''}: skipped unparsable statement: ${err.message}`);
        if (err.hint) console.warn(`[fractch]   hint: ${err.hint}`);
      }
      if (!targets.has(manifestName)) targets.set(manifestName, { name: manifestName, stacks: [] });
      await applyParsedAssets(vfs, buildDir, manifestTarget, parsed.assets, targetDir, assetFiles, assetSeenForTarget);
      applyUses(manifest, parsed.uses);
      if (!cloudAliasMaps.has(manifestName)) cloudAliasMaps.set(manifestName, new Map());
      applyVarDecls(manifest, manifestTarget, parsed.varDecls, cloudAliasMaps.get(manifestName));
      applySpriteProps(manifestTarget, parsed.spriteProps);
      const inferredHat = hatDir && hatDir !== 'nohat' ? hatDir : null;
      const fileScripts = parsed.scripts?.length
        ? parsed.scripts
        : [{ kind: 'implicit', calls: parsed.calls, x: null, y: null }];
      const sourceStem = cleanRelStem(sourceRel);
      const fileMarkerPrefix = sourceStem && sourceStem !== 'main' ? markerPrefixForFileStem(sourceStem) : null;
      fileScripts.forEach((s, i) => {
        targets.get(manifestName).stacks.push({
          hatOpcode: s.kind === 'implicit' && i === 0 ? headerInfo?.hatOpcode || inferredHat : null,
          calls: s.calls,
          topBlockId: i === 0 ? headerInfo?.topBlockId : null,
          x: s.x ?? (i === 0 ? headerInfo?.x ?? null : null),
          y: s.y ?? (i === 0 ? headerInfo?.y ?? null : null),
          fileMarkerPrefix,
        });
        registerProcDefs(procArgMaps, identToProccode, procMetaMaps, manifestName, s.calls);
      });
      if (!hasManifest) collectNamesIntoManifest(manifestTarget, parsed.calls, cloudAliasMaps.get(manifestName));
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
    let localSeq = 0;
    for (const s of data.stacks) {
      // `local name = ...` declarations get a per-script namespaced real
      // variable on the Scratch side while the DSL keeps the short name.
      const cloudAliases = cloudAliasMaps.get(name);
      let localVars = cloudAliases && cloudAliases.size ? new Map(cloudAliases) : null;
      const localNames = collectLocalDeclNames(s.calls);
      if (localNames.size) {
        localVars = localVars || new Map();
        for (const n of localNames) {
          const mangled = `local_${++localSeq}_${n}`;
          const id = ensureDictEntry(manifestTarget?.variables || {}, mangled, [mangled, 0]);
          if (id) varMap.set(mangled, id);
          localVars.set(n, mangled);
        }
      }
      const built = buildBlocksFromCalls(s.calls, {
        hatOpcode: s.hatOpcode,
        proceduresMapForTarget: procArgMaps.get(name),
        identToProccode: identToProccode.get(name),
        procMeta: procMetaMaps.get(name),
        varMap,
        listMap,
        broadcastNameToId,
        localVars,
        idGen: sharedIdGen,
      });
      let { blocks, topId } = built;
      if (topId && s.fileMarkerPrefix) {
        const markedTopId = uniqueBlockId(blocks, `${s.fileMarkerPrefix}${idSafeSuffix(topId)}`);
        renameBlockId(blocks, topId, markedTopId);
        topId = markedTopId;
      }
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
  autoRegisterExtensions(newManifest);
  pruneUnusedAssets(newManifest, verbose);
  return { manifest: newManifest, hasManifest, totalScripts, parsedScripts, assetFiles };
}

function applyUses(manifest, uses) {
  for (const u of uses || []) {
    if (!Array.isArray(manifest.extensions)) manifest.extensions = [];
    if (!manifest.extensions.includes(u.id)) manifest.extensions.push(u.id);
    if (u.url) {
      if (!manifest.extensionURLs) manifest.extensionURLs = {};
      manifest.extensionURLs[u.id] = u.url;
    }
  }
}

// Scratch/TurboWarp built-in opcode namespaces. Anything else in front of the
// first underscore of an opcode is a custom extension id.
const BUILTIN_NAMESPACES = new Set([
  'motion', 'looks', 'sound', 'event', 'control', 'sensing', 'operator', 'data',
  'procedures', 'argument', 'pen', 'music', 'videoSensing', 'text2speech',
  'translate', 'makeymakey', 'microbit', 'ev3', 'boost', 'wedo2', 'gdxfor', 'text',
  'math', 'colour', 'note',
]);

function autoRegisterExtensions(manifest) {
  const found = new Set();
  const declared = (manifest.extensions || []).slice().sort((a, b) => b.length - a.length);
  for (const t of manifest.targets || []) {
    for (const b of Object.values(t.blocks || {})) {
      if (!b || Array.isArray(b) || typeof b.opcode !== 'string') continue;
      const byDecl = declared.find((id) => b.opcode.startsWith(id + '_'));
      if (byDecl) continue;
      const m = /^([A-Za-z][A-Za-z0-9]*)_/.exec(b.opcode);
      if (m && !BUILTIN_NAMESPACES.has(m[1])) found.add(m[1]);
    }
  }
  if (!found.size) return;
  if (!Array.isArray(manifest.extensions)) manifest.extensions = [];
  for (const id of found) {
    if (!manifest.extensions.includes(id)) manifest.extensions.push(id);
  }
}

function applyVarDecls(manifest, target, decls, cloudAliases) {
  for (const d of decls || []) {
    const owner = d.cloud ? (manifest.targets || []).find((t) => t.isStage) || target : target;
    if (!owner) continue;
    if (d.isList) {
      const id = ensureDictEntry(owner.lists, d.name, [d.name, d.value]);
      if (id) owner.lists[id] = [d.name, d.value];
    } else {
      const name = d.cloud && !String(d.name).startsWith('\u2601 ') ? `\u2601 ${d.name}` : d.name;
      const entry = d.cloud ? [name, d.value, true] : [name, d.value];
      const id = ensureDictEntry(owner.variables, name, entry);
      if (id) owner.variables[id] = entry;
      if (d.cloud && cloudAliases) cloudAliases.set(d.name, name);
    }
  }
}

function applySpriteProps(target, props) {
  if (!target || !props) return;
  if (props.x != null) target.x = props.x;
  if (props.y != null) target.y = props.y;
  if (props.size != null) target.size = props.size;
  if (props.direction != null) target.direction = props.direction;
  if (props.visible != null) target.visible = props.visible;
  if (props.draggable != null) target.draggable = props.draggable;
  if (props.rotationStyle != null) target.rotationStyle = props.rotationStyle;
  if (props.volume != null) target.volume = props.volume;
  if (props.tempo != null) target.tempo = props.tempo;
  if (props.layer != null) target.layerOrder = props.layer;
}

// Costumes/sounds the code never references are dropped from the packed
// project. A costume/sound picked by anything non-constant (a reporter
// plugged into the menu slot, next-costume cycling, "random backdrop", ...)
// makes the whole set reachable, so everything is kept for that target.
const COSTUME_MENU_OPCODES = new Set(['looks_costume']);
const BACKDROP_MENU_OPCODES = new Set(['looks_backdrops']);
const SOUND_MENU_OPCODES = new Set(['sound_sounds_menu']);
const BACKDROP_SPECIALS = new Set(['next backdrop', 'previous backdrop', 'random backdrop']);

function pruneUnusedAssets(manifest, verbose) {
  const targets = manifest.targets || [];
  let stageAll = false;
  const stageRefs = new Set();
  const perTarget = new Map();

  for (const t of targets) {
    const st = { all: false, refs: new Set(), allSounds: false, soundRefs: new Set() };
    perTarget.set(t, st);
    const blocks = t.blocks || {};
    for (const b of Object.values(blocks)) {
      if (!b || Array.isArray(b) || typeof b.opcode !== 'string') continue;
      if (b.opcode === 'looks_nextcostume') st.all = true;
      if (b.opcode === 'looks_nextbackdrop') stageAll = true;
      if (b.opcode === 'event_whenbackdropswitchesto') {
        const n = b.fields?.BACKDROP?.[0];
        if (typeof n === 'string') stageRefs.add(n);
      }
      for (const tuple of Object.values(b.inputs || {})) {
        if (!Array.isArray(tuple)) continue;
        const activeId = typeof tuple[1] === 'string' ? tuple[1] : null;
        const ids = tuple.slice(1).filter((x) => typeof x === 'string');
        for (const id of ids) {
          const mb = blocks[id];
          if (!mb || typeof mb.opcode !== 'string') continue;
          const isCostumeMenu = COSTUME_MENU_OPCODES.has(mb.opcode);
          const isBackdropMenu = BACKDROP_MENU_OPCODES.has(mb.opcode);
          const isSoundMenu = SOUND_MENU_OPCODES.has(mb.opcode);
          if (!isCostumeMenu && !isBackdropMenu && !isSoundMenu) continue;
          const constant = activeId === id;
          const value = Object.values(mb.fields || {})[0]?.[0];
          if (isCostumeMenu) {
            if (constant && typeof value === 'string') st.refs.add(value);
            else st.all = true;
          } else if (isBackdropMenu) {
            if (constant && typeof value === 'string') {
              if (BACKDROP_SPECIALS.has(value)) stageAll = true;
              else stageRefs.add(value);
            } else stageAll = true;
          } else if (isSoundMenu) {
            if (constant && typeof value === 'string') st.soundRefs.add(value);
            else st.allSounds = true;
          }
        }
        // A plain text literal typed straight into a known consumer input
        // counts as a constant reference; a reporter there means dynamic.
        if (b.opcode === 'looks_switchcostumeto' || b.opcode === 'looks_switchbackdropto') {
          const isBackdrop = b.opcode === 'looks_switchbackdropto';
          if (activeId && !ids.some((id) => blocks[id] && (COSTUME_MENU_OPCODES.has(blocks[id].opcode) || BACKDROP_MENU_OPCODES.has(blocks[id].opcode)))) {
            if (isBackdrop) stageAll = true;
            else st.all = true;
          } else if (!activeId && Array.isArray(tuple[1]) && typeof tuple[1][1] === 'string') {
            if (isBackdrop) {
              if (BACKDROP_SPECIALS.has(tuple[1][1])) stageAll = true;
              else stageRefs.add(tuple[1][1]);
            } else st.refs.add(tuple[1][1]);
          }
        }
        if ((b.opcode === 'sound_play' || b.opcode === 'sound_playuntildone') && !activeId && Array.isArray(tuple[1]) && typeof tuple[1][1] === 'string') {
          st.soundRefs.add(tuple[1][1]);
        }
        if ((b.opcode === 'sound_play' || b.opcode === 'sound_playuntildone') && activeId && !ids.some((id) => blocks[id] && SOUND_MENU_OPCODES.has(blocks[id].opcode))) {
          st.allSounds = true;
        }
      }
    }
  }

  for (const t of targets) {
    const st = perTarget.get(t);
    if (!st) continue;
    const keepAllCostumes = st.all || (t.isStage && stageAll);
    const costumeRefs = t.isStage ? new Set([...st.refs, ...stageRefs]) : st.refs;
    const costumes = t.costumes || [];
    const currentIdx = Math.min(Math.max(t.currentCostume ?? 0, 0), Math.max(costumes.length - 1, 0));
    if (!keepAllCostumes && costumes.length) {
      const kept = costumes.filter((c, i) => i === currentIdx || costumeRefs.has(String(c.name)));
      if (kept.length !== costumes.length) {
        t.currentCostume = kept.indexOf(costumes[currentIdx]);
        if (verbose) console.log(`[pack] ${t.name}: removed ${costumes.length - kept.length} unused costume(s)`);
        t.costumes = kept;
      }
    }
    const sounds = t.sounds || [];
    if (!st.allSounds && sounds.length) {
      const kept = sounds.filter((s) => st.soundRefs.has(String(s.name)));
      if (kept.length !== sounds.length) {
        if (verbose) console.log(`[pack] ${t.name}: removed ${sounds.length - kept.length} unused sound(s)`);
        t.sounds = kept;
      }
    }
  }
}

async function collectScriptFiles(vfs, buildDir, manifest, verbose) {
  const fromIndex = await collectScriptFilesFromIndexes(vfs, buildDir);
  const usedIndex = fromIndex.length > 0;
  const files = usedIndex ? fromIndex : await scanScriptFiles(vfs, buildDir, manifest);
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
  return { files: unique, fromIndex: usedIndex };
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
    files.push(...(await scanTargetScripts(vfs, buildDir, tPath)));
  }
  return files;
}

async function scanTargetScripts(vfs, buildDir, dir) {
  const files = [];
  for (const entry of await safeListDir(vfs, dir)) {
    const ePath = path.join(dir, entry);
    if (entry.startsWith('.')) continue;
    if (entry.endsWith('.fractch') && entry !== 'index.fractch') {
      const info = scriptPathInfo(buildDir, ePath);
      if (info) files.push(info);
      continue;
    }
    if (await vfs.isDirectory(ePath)) files.push(...(await scanTargetScripts(vfs, buildDir, ePath)));
  }
  return files;
}

function scriptPathInfo(buildDir, fPath) {
  const rel = path.relative(buildDir, fPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const parts = rel.split('/');
  if (parts.length < 2) return null;
  const [targetDir, maybeHatDir] = parts;
  if (!targetDir || isReservedBuildDir(targetDir)) return null;
  const hatDir = parts.length >= 3 ? maybeHatDir : null;
  const sourceRel = parts.slice(1).join('/');
  return { fPath, targetDir, hatDir, sourceRel };
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

function pruneManifestToScriptTargets(manifest, scriptFiles) {
  if (!Array.isArray(manifest.targets)) return;
  const imported = new Set();
  for (const f of scriptFiles) imported.add(f.targetDir);
  manifest.targets = manifest.targets.filter((t) => {
    if (t.isStage) return true;
    return imported.has(t.name) || imported.has(sanitize(t.name));
  });
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

// Asset declarations carry only what a human would write (name, file path,
// centers, ...). Everything Scratch derives from the bytes - assetId, md5ext,
// dataFormat - is computed here by hashing the referenced file.
async function applyParsedAssets(vfs, buildDir, target, assets, targetDir, assetFiles, seenTargets) {
  if (!target || !assets) return;
  const hasAssets = (assets.costumes?.length || 0) || (assets.sounds?.length || 0);
  if (!hasAssets) return;
  if (!seenTargets.has(target.name)) {
    target.costumes = [];
    target.sounds = [];
    seenTargets.add(target.name);
  }
  for (const decl of assets.costumes || []) {
    const resolved = await resolveAssetDecl(vfs, buildDir, targetDir, decl, 'costume');
    if (!resolved) continue;
    target.costumes.push({
      name: String(decl.name ?? ''),
      bitmapResolution: decl.bitmap ?? 1,
      dataFormat: resolved.ext,
      assetId: resolved.assetId,
      md5ext: resolved.md5ext,
      rotationCenterX: decl.centerX ?? 0,
      rotationCenterY: decl.centerY ?? 0,
    });
    assetFiles.set(resolved.md5ext, resolved.sourceRel);
  }
  for (const decl of assets.sounds || []) {
    const resolved = await resolveAssetDecl(vfs, buildDir, targetDir, decl, 'sound');
    if (!resolved) continue;
    const sound = {
      name: String(decl.name ?? ''),
      assetId: resolved.assetId,
      dataFormat: resolved.ext,
      format: decl.format ?? '',
    };
    if (decl.rate != null) sound.rate = decl.rate;
    if (decl.samples != null) sound.sampleCount = decl.samples;
    sound.md5ext = resolved.md5ext;
    target.sounds.push(sound);
    assetFiles.set(resolved.md5ext, resolved.sourceRel);
  }
}

async function resolveAssetDecl(vfs, buildDir, targetDir, decl, kind) {
  const file = String(decl.file || '');
  const ext = (file.split('.').pop() || '').toLowerCase();
  if (!file || !ext || file === `.${ext}`) {
    console.warn(`[fractch] ${kind} "${decl.name}": missing or extension-less file path, skipped`);
    return null;
  }
  const sourceRel = assetSourceRel(targetDir, file);
  if (!sourceRel) {
    console.warn(`[fractch] ${kind} "${decl.name}": invalid file path ${file}, skipped`);
    return null;
  }
  let bytes;
  try {
    bytes = await vfs.readFile(path.join(buildDir, sourceRel));
  } catch {
    console.warn(`[fractch] ${kind} "${decl.name}": file not found: ${sourceRel}, skipped`);
    return null;
  }
  const assetId = md5hex(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  return { assetId, ext, md5ext: `${assetId}.${ext}`, sourceRel };
}

function assetSourceRel(targetDir, file) {
  const rel = String(file || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = rel.split('/').filter(Boolean);
  if (!parts.length || parts.some((p) => p === '.' || p === '..' || p.startsWith('.'))) return null;
  return path.join(targetDir, ...parts);
}

function collectNamesIntoManifest(target, calls, cloudAliases) {
  const vars = new Set();
  const lists = new Set();
  const broadcasts = new Set();
  collectNames(calls, { vars, lists, broadcasts });
  for (const local of collectLocalDeclNames(calls)) vars.delete(local);
  if (cloudAliases) for (const bare of cloudAliases.keys()) vars.delete(bare);
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
  if (node.type === 'localDecl') {
    collectNamesFromValue(node.value, out);
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
  if (!dict || !name) return null;
  for (const [key, entry] of Object.entries(dict)) {
    const existing = Array.isArray(entry) ? entry[0] : entry;
    if (existing === name) return key;
  }
  let id = sanitize(name) || 'item';
  if (!/^[A-Za-z_]/.test(id)) id = `_${id}`;
  let n = 1;
  let finalId = id;
  while (Object.prototype.hasOwnProperty.call(dict, finalId)) finalId = `${id}_${++n}`;
  dict[finalId] = value;
  return finalId;
}

function uniqueBlockId(blocks, preferred) {
  let id = preferred;
  let n = 1;
  while (Object.prototype.hasOwnProperty.call(blocks, id)) id = `${preferred}_${++n}`;
  return id;
}

function renameBlockId(blocks, oldId, newId) {
  if (!oldId || !newId || oldId === newId || !blocks[oldId]) return;
  blocks[newId] = { ...blocks[oldId], id: newId };
  delete blocks[oldId];
  for (const block of Object.values(blocks)) {
    if (!block || typeof block !== 'object') continue;
    if (block.next === oldId) block.next = newId;
    if (block.parent === oldId) block.parent = newId;
    for (const tuple of Object.values(block.inputs || {})) {
      if (!Array.isArray(tuple)) continue;
      for (let i = 1; i < tuple.length; i++) {
        if (tuple[i] === oldId) tuple[i] = newId;
      }
    }
  }
}

function collectLocalDeclNames(calls, out = new Set()) {
  for (const node of calls || []) {
    if (!node) continue;
    if (node.type === 'localDecl') {
      out.add(node.name);
      continue;
    }
    if (node.type === 'procDef') {
      collectLocalDeclNames(node.body, out);
      continue;
    }
    if (node.type !== 'call') continue;
    for (const a of node.args || []) {
      if (a.kind === 'branch') collectLocalDeclNames(a.body, out);
    }
  }
  return out;
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
