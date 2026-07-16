import * as path from './pathUtils.js';
import { toPromiseFs } from './fsAdapter.js';
import { parseFractch } from './parse.js';
import { buildBlocksFromCalls, mergeIntoManifest, IdGen, synthesizeProccode, listMethodCall } from './buildBlocks.js';
import { assertValidFractch } from './lint.js';
import { cleanRelStem, commentMarkerForFileStem, idSafeSuffix, markerPrefixForFileStem } from './fileMarkers.js';
import {
  STDLIB_MODULES,
  STDLIB_METHODS,
  STDLIB_STEM_PREFIX,
  resolveStdlibModules,
  resolvePackageMethod,
} from './stdlib/index.js';
import { md5hex } from './md5.js';

export const BLANK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="100%" height="100%" fill="white"/></svg>';
export const BLANK_SVG_ID = 'c3d7ff782edb43ba0e0a79849362613c';

export async function buildProjectFromBuildDir({ buildDir, fs: fsLike, verbose = false, prune = true }) {
  const vfs = toPromiseFs(fsLike);
  const manifestPath = path.join(buildDir, 'manifest.json');
  const hasManifest = await vfs.exists(manifestPath);
  let manifest = hasManifest ? JSON.parse(await vfs.readFile(manifestPath, 'utf8')) : null;

  const { files: scriptFiles, fromIndex } = await collectScriptFiles(vfs, buildDir, manifest, verbose);
  if (!manifest) manifest = synthesizeManifest(scriptFiles);
  ensureTargetsForScripts(manifest, scriptFiles);
  if (fromIndex) pruneManifestToScriptTargets(manifest, scriptFiles);

  const targets = new Map();
  const assetFiles = new Map();
  const assetSeenForTarget = new Set();
  const procArgMaps = new Map();
  const identToProccode = new Map();
  const procMetaMaps = new Map();
  const cloudAliasMaps = new Map();
  const watchDecls = [];
  const nameCollections = [];
  const stdlibImports = new Map();
  const importNsMaps = new Map();
  const renamePlans = new Map();
  let commentSeq = 0;
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
        console.warn(
          `[fractch] ${fPath}:${err.line}${err.col ? ':' + err.col : ''}: skipped unparsable statement: ${err.message}`
        );
        if (err.hint) console.warn(`[fractch]   hint: ${err.hint}`);
      }
      if (!targets.has(manifestName)) targets.set(manifestName, { name: manifestName, stacks: [] });
      await applyParsedAssets(vfs, buildDir, manifestTarget, parsed.assets, targetDir, assetFiles, assetSeenForTarget);
      await applyUses(manifest, parsed.uses, vfs, buildDir);
      if (!cloudAliasMaps.has(manifestName)) cloudAliasMaps.set(manifestName, new Map());
      applyVarDecls(manifest, manifestTarget, parsed.varDecls, cloudAliasMaps.get(manifestName));
      applySpriteProps(manifestTarget, parsed.spriteProps);

      if (parsed.spriteProps?.name && !hasManifest && parsed.spriteProps.name !== manifestName) {
        renamePlans.set(manifestName, parsed.spriteProps.name);
      }
      for (const w of parsed.watches || []) watchDecls.push({ targetName: manifestName, decl: w });
      for (const c of parsed.comments || []) {
        if (!manifestTarget.comments) manifestTarget.comments = {};
        const cid = uniqueCommentId(manifestTarget.comments, `~c${++commentSeq}`);
        manifestTarget.comments[cid] = {
          blockId: c.forId || null,
          x: c.x ?? 0,
          y: c.y ?? 0,
          width: c.width ?? 200,
          height: c.height ?? 200,
          minimized: !!c.minimized,
          text: String(c.text ?? ''),
        };
      }
      if (parsed.platform) {
        if (!manifest.meta || typeof manifest.meta !== 'object') manifest.meta = {};
        manifest.meta.platform = { name: parsed.platform.name, url: parsed.platform.url ?? null };
      }
      const inferredHat = hatDir && hatDir !== 'nohat' ? hatDir : null;
      const fileScripts = parsed.scripts?.length
        ? parsed.scripts
        : [{ kind: 'implicit', calls: parsed.calls, x: null, y: null }];
      const sourceStem = cleanRelStem(sourceRel);
      const fileMarkerPrefix = sourceStem && sourceStem !== 'main' ? markerPrefixForFileStem(sourceStem) : null;
      const fileMarkerComment = commentMarkerForFileStem(sourceStem);
      fileScripts.forEach((s, i) => {
        targets.get(manifestName).stacks.push({
          hatOpcode: s.kind === 'implicit' && i === 0 ? headerInfo?.hatOpcode || inferredHat : null,
          calls: s.calls,
          topBlockId: i === 0 ? headerInfo?.topBlockId : null,
          x: s.x ?? (i === 0 ? (headerInfo?.x ?? null) : null),
          y: s.y ?? (i === 0 ? (headerInfo?.y ?? null) : null),
          fileMarkerPrefix,
          fileMarkerComment,
        });
        registerProcDefs(procArgMaps, identToProccode, procMetaMaps, manifestName, s.calls);
      });
      if (!hasManifest)
        nameCollections.push({
          target: manifestTarget,
          calls: parsed.calls,
          cloudAliases: cloudAliasMaps.get(manifestName),
        });
      for (const imp of parsed.imports || []) {
        if (!STDLIB_MODULES[imp]) continue;
        if (!stdlibImports.has(manifestName)) stdlibImports.set(manifestName, new Set());
        stdlibImports.get(manifestName).add(imp);
      }
      if (parsed.importNamespaces) {
        if (!importNsMaps.has(manifestName)) importNsMaps.set(manifestName, {});
        const nsMap = importNsMaps.get(manifestName);
        for (const [ns, id] of Object.entries(parsed.importNamespaces)) {
          if (STDLIB_MODULES[id]) nsMap[ns] = id;
        }
      }
      parsedScripts++;
    } catch (e) {
      if (verbose) console.warn(`Skip unparsable file: ${fPath}: ${e.message}`);
      continue;
    }
  }

  const stageTarget = (manifest.targets || []).find((t) => t.isStage);

  nameCollections.sort((a, b) => (b.target.isStage ? 1 : 0) - (a.target.isStage ? 1 : 0));
  for (const { target, calls, cloudAliases } of nameCollections) {
    collectNamesIntoManifest(target, calls, cloudAliases, stageTarget);
  }

  resolveMethodAmbiguity(targets, manifest, stageTarget, importNsMaps);
  injectStdlibModules({ targets, manifest, stdlibImports, procArgMaps, identToProccode, procMetaMaps });

  const globalIdentToProccode = new Map();
  const globalProcArgs = new Map();
  const globalProcMeta = new Map();
  for (const m of identToProccode.values())
    for (const [k, v] of m) if (!globalIdentToProccode.has(k)) globalIdentToProccode.set(k, v);
  for (const m of procArgMaps.values()) for (const [k, v] of m) if (!globalProcArgs.has(k)) globalProcArgs.set(k, v);
  for (const m of procMetaMaps.values()) for (const [k, v] of m) if (!globalProcMeta.has(k)) globalProcMeta.set(k, v);
  const withGlobalFallback = (global, own) => (own && own.size ? new Map([...global, ...own]) : global);

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
    const sharedIdGen = new IdGen();
    const manifestTarget = (manifest.targets || []).find((t) => t.name === name);
    const varMap = new Map([...stageVarMap, ...buildNameIdMap(manifestTarget?.variables)]);
    const listMap = new Map([...stageListMap, ...buildNameIdMap(manifestTarget?.lists)]);
    let stackIndex = 0;
    const localTags = computeLocalTags(data.stacks);
    for (let stackI = 0; stackI < data.stacks.length; stackI++) {
      const s = data.stacks[stackI];

      const cloudAliases = cloudAliasMaps.get(name);
      let localVars = cloudAliases && cloudAliases.size ? new Map(cloudAliases) : null;
      const localNames = collectLocalDeclNames(s.calls);
      if (localNames.size) {
        localVars = localVars || new Map();
        for (const n of localNames) {
          const mangled = `!local_${localTags[stackI]}_${n}`;
          const id = ensureDictEntry(manifestTarget?.variables || {}, mangled, [mangled, 0]);
          if (id) varMap.set(mangled, id);
          localVars.set(n, mangled);
        }
      }
      const commentsOut = [];
      const built = buildBlocksFromCalls(s.calls, {
        hatOpcode: s.hatOpcode,
        proceduresMapForTarget: withGlobalFallback(globalProcArgs, procArgMaps.get(name)),
        identToProccode: withGlobalFallback(globalIdentToProccode, identToProccode.get(name)),
        procMeta: withGlobalFallback(globalProcMeta, procMetaMaps.get(name)),
        varMap,
        listMap,
        broadcastNameToId,
        localVars,
        idGen: sharedIdGen,
        commentsOut,
      });
      let { blocks, topId } = built;
      if (topId && s.fileMarkerPrefix) {
        const markedTopId = uniqueBlockId(blocks, `${s.fileMarkerPrefix}${idSafeSuffix(topId)}`);
        renameBlockId(blocks, topId, markedTopId);
        for (const c of commentsOut) if (c.blockId === topId) c.blockId = markedTopId;
        topId = markedTopId;
      }
      if (topId && blocks[topId] && blocks[topId].topLevel) {
        blocks[topId].x = s.x ?? (stackIndex % 5) * 500;
        blocks[topId].y = s.y ?? Math.floor(stackIndex / 5) * 700;
      }
      if (s.fileMarkerComment && topId) {
        const hat = blocks[topId];
        commentsOut.push({
          text: s.fileMarkerComment,
          blockId: topId,
          x: (hat?.x ?? 0) + 250,
          y: hat?.y ?? 0,
          width: 20,
          height: 20,
          minimized: true,
        });
      }
      if (commentsOut.length && manifestTarget) {
        if (!manifestTarget.comments) manifestTarget.comments = {};
        for (const c of commentsOut) {
          const cid = uniqueCommentId(manifestTarget.comments, `~c${++commentSeq}`);
          manifestTarget.comments[cid] = {
            blockId: c.blockId || null,
            x: c.x ?? 0,
            y: c.y ?? 0,
            width: c.width ?? 200,
            height: c.height ?? 200,
            minimized: !!c.minimized,
            text: String(c.text ?? ''),
          };
          if (c.blockId && blocks[c.blockId]) blocks[c.blockId].comment = cid;
        }
      }
      stackIndex++;
      scripts.push({ oldTopId: s.topBlockId || null, blocks, newTopId: topId });
    }
    builtTargets.push({ name, scripts });
  }

  const newManifest = mergeIntoManifest(manifest, builtTargets);
  validateSb3InputPrimitives(newManifest);
  autoRegisterExtensions(newManifest);
  applyWatchDecls(newManifest, watchDecls, renamePlans);
  for (const [oldName, newName] of renamePlans) {
    const t = (newManifest.targets || []).find((x) => x.name === oldName);
    if (t && !(newManifest.targets || []).some((x) => x.name === newName)) t.name = newName;
  }

  if (prune) pruneUnusedAssets(newManifest, verbose);
  for (const t of newManifest.targets || []) {
    if (!Array.isArray(t.costumes) || t.costumes.length === 0) {
      t.costumes = [defaultCostume(!!t.isStage)];
      t.currentCostume = 0;
    }
    for (const block of Object.values(t.blocks || {})) {
      if (block && typeof block === 'object' && !Array.isArray(block)) delete block.id;
    }
  }
  return { manifest: newManifest, hasManifest, totalScripts, parsedScripts, assetFiles };
}

function validateSb3InputPrimitives(manifest) {
  for (const target of manifest.targets || []) {
    for (const [blockId, block] of Object.entries(target.blocks || {})) {
      if (!block || Array.isArray(block) || typeof block !== 'object') continue;
      for (const [inputKey, tuple] of Object.entries(block.inputs || {})) {
        validateInputTuple(tuple, target.name, blockId, block.opcode, inputKey);
      }
    }
  }
}

function validateInputTuple(tuple, targetName, blockId, opcode, inputKey) {
  if (!Array.isArray(tuple)) return;
  for (let i = 1; i < tuple.length; i++) {
    const value = tuple[i];
    if (!Array.isArray(value)) continue;
    const code = value[0];
    const fail = (message) => {
      throw new Error(
        `[fractch] invalid Scratch input primitive at target "${targetName}", block "${blockId}" (${opcode}), input "${inputKey}": ${message}. ` +
          'Use a declared variable/list/broadcast name, or a valid raw primitive tuple.'
      );
    };
    if (!Number.isInteger(code) || code < 4 || code > 13) {
      fail(`unknown primitive type ${JSON.stringify(code)} in ${JSON.stringify(value)}`);
    }
    const expectedLength = code >= 11 ? 3 : 2;
    if (value.length !== expectedLength) {
      fail(`type ${code} tuple must have ${expectedLength} items, got ${value.length}: ${JSON.stringify(value)}`);
    }
    if (typeof value[1] !== 'string') {
      fail(`type ${code} tuple value must be a string: ${JSON.stringify(value)}`);
    }
    if (code >= 11 && typeof value[2] !== 'string') {
      fail(`type ${code} tuple id must be a string, got ${JSON.stringify(value[2])}: ${JSON.stringify(value)}`);
    }
  }
}

function applyWatchDecls(manifest, watchDecls, renamePlans) {
  if (!watchDecls.length) return;
  if (!Array.isArray(manifest.monitors)) manifest.monitors = [];
  const stage = (manifest.targets || []).find((t) => t.isStage);
  for (const { targetName, decl } of watchDecls) {
    const target = (manifest.targets || []).find((t) => t.name === targetName);
    if (!target) continue;
    const dictKey = decl.isList ? 'lists' : 'variables';
    let id = decl.id || null;
    if (!id) {
      id =
        buildNameIdMap(target[dictKey]).get(decl.name) ||
        (stage && stage !== target ? buildNameIdMap(stage[dictKey]).get(decl.name) : null) ||
        null;
    }
    if (!id) {
      console.warn(
        `[fractch] watch ${decl.isList ? 'list' : 'var'} ${JSON.stringify(decl.name)}: no such ${decl.isList ? 'list' : 'variable'}, skipped`
      );
      continue;
    }
    const finalName = renamePlans.get(targetName) || targetName;
    const ownedByStage =
      !decl.sprite && (target.isStage || (stage && buildNameIdMap(stage[dictKey]).get(decl.name) === id));
    const monitor = {
      id,
      mode: decl.isList ? 'list' : decl.mode === 'large' ? 'large' : decl.mode === 'slider' ? 'slider' : 'default',
      opcode: decl.isList ? 'data_listcontents' : 'data_variable',
      params: decl.isList ? { LIST: decl.name } : { VARIABLE: decl.name },
      spriteName: decl.sprite || (ownedByStage ? null : finalName),
      value: decl.isList ? [] : 0,
      width: decl.width ?? 0,
      height: decl.height ?? 0,
      x: decl.x ?? 0,
      y: decl.y ?? 0,
      visible: !!decl.visible,
    };
    if (!decl.isList) {
      monitor.sliderMin = decl.sliderMin ?? 0;
      monitor.sliderMax = decl.sliderMax ?? 100;
      monitor.isDiscrete = decl.isDiscrete !== false;
    }
    const existing = manifest.monitors.findIndex((m) => m && m.id === id);
    if (existing >= 0) manifest.monitors[existing] = monitor;
    else manifest.monitors.push(monitor);
  }
}

function uniqueCommentId(dict, preferred) {
  let id = preferred;
  let n = 1;
  while (Object.prototype.hasOwnProperty.call(dict, id)) id = `${preferred}_${++n}`;
  return id;
}

async function applyUses(manifest, uses, vfs, buildDir) {
  for (const u of uses || []) {
    if (!Array.isArray(manifest.extensions)) manifest.extensions = [];
    if (!manifest.extensions.includes(u.id)) manifest.extensions.push(u.id);
    if (u.url) {
      if (!manifest.extensionURLs) manifest.extensionURLs = {};
      manifest.extensionURLs[u.id] = await resolveExtensionUrl(u.url, vfs, buildDir);
    }
  }
}

function encodeBase64(text) {
  if (typeof Buffer !== 'undefined') return Buffer.from(text, 'utf8').toString('base64');
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function resolveExtensionUrl(url, vfs, buildDir) {
  const s = String(url);
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) return s;
  if (!vfs || !buildDir) return s;
  try {
    const src = await vfs.readFile(path.join(buildDir, s), 'utf8');
    return `data:application/javascript;base64,${encodeBase64(src)}`;
  } catch {
    return s;
  }
}

const BUILTIN_NAMESPACES = new Set([
  'motion',
  'looks',
  'sound',
  'event',
  'control',
  'sensing',
  'operator',
  'data',
  'procedures',
  'argument',
  'pen',
  'music',
  'videoSensing',
  'text2speech',
  'translate',
  'makeymakey',
  'microbit',
  'ev3',
  'boost',
  'wedo2',
  'gdxfor',
  'text',
  'math',
  'colour',
  'note',
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
      const id = d.id || ensureDictEntry(owner.lists, d.name, [d.name, d.value]);
      if (id) owner.lists[id] = [d.name, d.value];
    } else {
      const name = d.cloud && !String(d.name).startsWith('\u2601 ') ? `\u2601 ${d.name}` : d.name;
      const entry = d.cloud ? [name, d.value, true] : [name, d.value];
      const id = d.id || ensureDictEntry(owner.variables, name, entry);
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
  if (props.currentCostume != null) target.currentCostume = props.currentCostume;
  if (props.videoState != null) target.videoState = props.videoState;
  if (props.transparency != null) target.videoTransparency = props.transparency;
  if (props.tts != null) target.textToSpeechLanguage = props.tts;
}

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

        if (b.opcode === 'looks_switchcostumeto' || b.opcode === 'looks_switchbackdropto') {
          const isBackdrop = b.opcode === 'looks_switchbackdropto';
          if (
            activeId &&
            !ids.some(
              (id) =>
                blocks[id] &&
                (COSTUME_MENU_OPCODES.has(blocks[id].opcode) || BACKDROP_MENU_OPCODES.has(blocks[id].opcode))
            )
          ) {
            if (isBackdrop) stageAll = true;
            else st.all = true;
          } else if (!activeId && Array.isArray(tuple[1]) && typeof tuple[1][1] === 'string') {
            if (isBackdrop) {
              if (BACKDROP_SPECIALS.has(tuple[1][1])) stageAll = true;
              else stageRefs.add(tuple[1][1]);
            } else st.refs.add(tuple[1][1]);
          }
        }
        if (
          (b.opcode === 'sound_play' || b.opcode === 'sound_playuntildone') &&
          !activeId &&
          Array.isArray(tuple[1]) &&
          typeof tuple[1][1] === 'string'
        ) {
          st.soundRefs.add(tuple[1][1]);
        }
        if (
          (b.opcode === 'sound_play' || b.opcode === 'sound_playuntildone') &&
          activeId &&
          !ids.some((id) => blocks[id] && SOUND_MENU_OPCODES.has(blocks[id].opcode))
        ) {
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

async function applyParsedAssets(vfs, buildDir, target, assets, targetDir, assetFiles, seenTargets) {
  if (!target || !assets) return;
  const hasAssets = assets.costumes?.length || 0 || assets.sounds?.length || 0;
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
    if (decl.current) target.currentCostume = target.costumes.length - 1;
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
  const rel = String(file || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  const parts = rel.split('/').filter(Boolean);
  if (!parts.length || parts.some((p) => p === '.' || p === '..' || p.startsWith('.'))) return null;
  return path.join(targetDir, ...parts);
}

function collectNamesIntoManifest(target, calls, cloudAliases, stage) {
  const vars = new Set();
  const lists = new Set();
  const broadcasts = new Set();
  collectNames(calls, { vars, lists, broadcasts });
  for (const local of collectLocalDeclNames(calls)) vars.delete(local);
  if (cloudAliases) for (const bare of cloudAliases.keys()) vars.delete(bare);
  const globals = stage && stage !== target ? stage : null;

  const listNames = new Set([
    ...lists,
    ...Object.values(target.lists || {}).map((e) => (Array.isArray(e) ? e[0] : null)),
    ...(stage ? Object.values(stage.lists || {}).map((e) => (Array.isArray(e) ? e[0] : null)) : []),
  ]);
  for (const name of vars) {
    if (listNames.has(name)) continue;
    if (globals && buildNameIdMap(globals.variables).has(name)) continue;
    ensureDictEntry(target.variables, name, [name, 0]);
  }
  for (const name of lists) {
    if (globals && buildNameIdMap(globals.lists).has(name)) continue;
    ensureDictEntry(target.lists, name, [name, []]);
  }

  const broadcastOwner = stage || target;
  for (const name of broadcasts) ensureDictEntry(broadcastOwner.broadcasts, name, name);
}

function collectNames(nodes, out) {
  for (const node of nodes || []) collectNamesFromNode(node, out);
}

function collectNamesFromNode(node, out) {
  if (!node) return;
  if (node.type === 'procDef') {
    const bodyVars = new Set();
    collectNames(node.body, { vars: bodyVars, lists: out.lists, broadcasts: out.broadcasts });
    for (const p of node.params || []) bodyVars.delete(p.ident);
    for (const v of bodyVars) out.vars.add(v);
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
    if (arg.kind === 'positional') {
      collectNamesFromValue(arg.value, out);
      continue;
    }
    if (arg.kind !== 'keyed') continue;
    if (arg.sep === 'field') {
      if (arg.key === 'VARIABLE') collectFieldName(arg.value, out.vars);
      if (arg.key === 'LIST') collectFieldName(arg.value, out.lists);
      if (arg.key === 'BROADCAST_OPTION') collectFieldName(arg.value, out.broadcasts);
      continue;
    }
    if (arg.key === 'BROADCAST_INPUT') collectBroadcastInputName(arg.value, out.broadcasts);
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
  else if (value.type === 'var' || value.type === 'list' || value.type === 'broadcast') set.add(value.name);
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

function stackBaseName(s) {
  const c0 = s.calls?.[0];
  if (c0?.type === 'procDef') return c0.ident;
  const hat = s.hatOpcode || (c0?.callee?.type === 'opcode' ? c0.callee.name : null);
  if (hat) return String(hat).replace(/^event_when|^control_/, '');
  return 'script';
}

function computeLocalTags(stacks) {
  const sanitized = stacks.map((s) => String(stackBaseName(s)).replace(/[^A-Za-z0-9]/g, '') || 'script');
  const prefixes = sanitized.map((name, i) => {
    for (let len = 1; len <= name.length; len++) {
      const pre = name.slice(0, len);
      if (sanitized.every((other, j) => j === i || !other.startsWith(pre))) return pre;
    }
    return name;
  });
  const seen = new Map();
  return prefixes.map((t) => {
    const n = (seen.get(t) || 0) + 1;
    seen.set(t, n);
    return n === 1 ? t : `${t}${n}`;
  });
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

function resolveMethodAmbiguity(targets, manifest, stageTarget, importNsMaps = new Map()) {
  for (const [name, data] of targets) {
    const manifestTarget = (manifest.targets || []).find((t) => t.name === name);
    const nsMap = importNsMaps.get(name) || {};
    const globalNames = new Set([
      ...Object.values(manifestTarget?.variables || {}).map((e) => (Array.isArray(e) ? String(e[0]) : null)),
      ...Object.values(stageTarget?.variables || {}).map((e) => (Array.isArray(e) ? String(e[0]) : null)),
    ]);
    const listNames = new Set([
      ...Object.values(manifestTarget?.lists || {}).map((e) => (Array.isArray(e) ? String(e[0]) : null)),
      ...Object.values(stageTarget?.lists || {}).map((e) => (Array.isArray(e) ? String(e[0]) : null)),
    ]);
    for (const s of data.stacks) {
      const scopeNames = new Set(globalNames);
      for (const n of collectLocalDeclNames(s.calls)) scopeNames.add(n);
      if (s.calls.length === 1 && s.calls[0].type === 'procDef') {
        for (const p of s.calls[0].params || []) scopeNames.add(p.ident);
      }
      rewriteIdentOrMethod(s.calls, scopeNames, listNames, nsMap);
    }
  }
}

function rewriteIdentOrMethod(calls, scopeNames, listNames = new Set(), nsMap = {}) {
  const visitValue = (v) => {
    if (!v || typeof v !== 'object') return;
    if (v.type === 'call') v.value = visitCall(v.value);
    if (v.type === 'obscured') {
      visitValue(v.active);
      visitValue(v.shadow);
    }
  };
  const visitCall = (call) => {
    if (!call || typeof call !== 'object') return call;
    if (call.type === 'procDef') {
      call.body = (call.body || []).map(visitCall);
      return call;
    }
    if (call.type === 'localDecl') {
      visitValue(call.value);
      return call;
    }
    for (const a of call.args || []) {
      if (a.kind === 'branch') a.body = (a.body || []).map(visitCall);
      else visitValue(a.value);
    }
    if (call.callee?.type === 'identOrMethod') {
      const { ident, method } = call.callee;
      const pkg = nsMap[ident] ? resolvePackageMethod(nsMap, ident, method) : null;
      const lm = !pkg && listNames.has(ident) ? listMethodCall(ident, method, call.args) : null;
      if (pkg) {
        if (pkg.ident) {
          call.callee = { type: 'procedureCall', name: pkg.ident, line: call.callee.line };
        } else {
          console.warn(
            `[fractch] package '${ident}' has no function '.${method}(...)' - packed as extension opcode ${ident}_${method}; run 'fractch check' for details`
          );
          call.callee = { type: 'opcode', name: `${ident}_${method}` };
        }
      } else if (lm) {
        call.callee = lm.callee;
        call.args = lm.args;
      } else if (scopeNames.has(ident) && STDLIB_METHODS[method]) {
        call.callee = { type: 'procedureCall', name: STDLIB_METHODS[method].ident, line: call.callee.line };
        call.args = [{ kind: 'positional', value: { type: 'ident', name: ident } }, ...call.args];
      } else if (
        scopeNames.has(ident) &&
        method === 'letter' &&
        (call.args || []).length === 1 &&
        call.args[0].kind === 'positional'
      ) {
        call.callee = { type: 'opcode', name: 'operator_letter_of' };
        call.args = [
          { kind: 'keyed', sep: 'input', key: 'LETTER', value: call.args[0].value },
          { kind: 'keyed', sep: 'input', key: 'STRING', value: { type: 'ident', name: ident } },
        ];
      } else {
        if (listNames.has(ident)) {
          console.warn(
            `[fractch] list '${ident}' has no method '.${method}(...)' - packed as extension opcode ${ident}_${method}; run 'fractch check' for details`
          );
        } else if (scopeNames.has(ident)) {
          console.warn(
            `[fractch] '${ident}' is a variable with no method '.${method}(...)' - packed as extension opcode ${ident}_${method}; run 'fractch check' for details`
          );
        }
        call.callee = { type: 'opcode', name: `${ident}_${method}` };
      }
    }
    return call;
  };
  for (let i = 0; i < calls.length; i++) calls[i] = visitCall(calls[i]);
}

function injectStdlibModules({ targets, manifest, stdlibImports, procArgMaps, identToProccode, procMetaMaps }) {
  for (const [name, data] of targets) {
    const modules = resolveStdlibModules([...(stdlibImports.get(name) || [])]);
    if (!modules.length) continue;

    const registry = new Map();
    for (const moduleId of modules) {
      const parsed = parseFractch(STDLIB_MODULES[moduleId].source, { attachLineComments: false });
      for (const err of parsed.errors || []) {
        console.warn(`[fractch] stdlib ${moduleId}: skipped unparsable statement: ${err.message}`);
      }
      const markerStem = STDLIB_STEM_PREFIX + moduleId;
      const marker = markerPrefixForFileStem(markerStem);
      const markerComment = commentMarkerForFileStem(markerStem);
      for (const s of parsed.scripts || []) {
        const ident = s.calls[0]?.type === 'procDef' ? s.calls[0].ident : null;
        if (ident && !registry.has(ident))
          registry.set(ident, { calls: s.calls, marker, markerComment, x: s.x, y: s.y });
      }
    }
    const known = new Set(registry.keys());

    const used = new Set();
    const queue = [];
    for (const s of data.stacks) collectProcCallIdents(s.calls, known, queue);
    while (queue.length) {
      const ident = queue.shift();
      if (used.has(ident) || !registry.has(ident)) continue;
      used.add(ident);
      collectProcCallIdents(registry.get(ident).calls, known, queue);
    }

    const injectedCalls = [];
    for (const ident of used) {
      if (identToProccode.get(name)?.has(ident)) continue;
      const { calls, marker, markerComment, x, y } = registry.get(ident);
      data.stacks.push({
        hatOpcode: null,
        calls,
        topBlockId: null,
        x: x ?? null,
        y: y ?? null,
        fileMarkerPrefix: marker,
        fileMarkerComment: markerComment,
      });
      registerProcDefs(procArgMaps, identToProccode, procMetaMaps, name, calls);
      injectedCalls.push(...calls);
    }
    if (injectedCalls.length) {
      const manifestTarget = (manifest.targets || []).find((t) => t.name === name);
      const stageTarget = (manifest.targets || []).find((t) => t.isStage);
      if (manifestTarget) collectNamesIntoManifest(manifestTarget, injectedCalls, null, stageTarget);
    }
  }
}

function collectProcCallIdents(calls, known, out) {
  const visitValue = (v) => {
    if (!v || typeof v !== 'object') return;
    if (v.type === 'call') visitCall(v.value);
    if (v.type === 'obscured') {
      visitValue(v.active);
      visitValue(v.shadow);
    }
  };
  const visitCall = (call) => {
    if (!call || typeof call !== 'object') return;
    if (call.type === 'procDef') {
      for (const st of call.body || []) visitCall(st);
      return;
    }
    if (call.type === 'localDecl') {
      visitValue(call.value);
      return;
    }
    if (call.callee?.type === 'procedureCall' && known.has(call.callee.name)) out.push(call.callee.name);
    for (const a of call.args || []) {
      if (a.kind === 'branch') for (const st of a.body || []) visitCall(st);
      else visitValue(a.value);
    }
  };
  for (const c of calls || []) visitCall(c);
}

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
  if (!map.has(proccode))
    map.set(
      proccode,
      procDef.params.map((p) => p.ident)
    );
  if (!metaMap.has(proccode))
    metaMap.set(proccode, { warp: procDef.warp, customcolor: procDef.customcolor, returns: procDef.returns });
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
