import * as path from './pathUtils.js';
import { toPromiseFs } from './fsAdapter.js';
import { emitMultiScriptFile, emitTargetPrelude, targetDirNames } from './emit.js';
import { groupTopLevelScripts, collectBlocksSubgraph, isMenuShadow } from './graph.js';
import { cleanRelStem, decodeFileStemFromComment } from './fileMarkers.js';
import { STDLIB_MODULES } from './stdlib/index.js';
import { commentText, isMembershipComment, readMembership } from './membership.js';
import { diagnostic } from './diagnostics.js';

export async function convertProject(projectJson, { outDir, fs: fsLike, config = {}, verbose = false } = {}) {
  const vfs = toPromiseFs(fsLike);
  await vfs.mkdirp(outDir);
  const degenerateCounts = new Map();
  const targets = (projectJson.targets || []).map((t) => {
    const { target: normalized, degenerate } = normalizeTargetBlocks(t);
    if (degenerate) degenerateCounts.set(normalized, degenerate);
    return normalized;
  });
  const files = [];
  const diagnostics = [];

  const broadcastMap = new Map();
  const proceduresMap = new Map();
  const procedureDefsByTarget = new Map();
  const procByCode = buildProcByCode(targets);

  for (const target of targets) {
    const pMap = new Map();
    const defIdToProc = new Map();
    const blocks = target.blocks || {};
    for (const [id, b] of Object.entries(blocks)) {
      if (!b || b.opcode !== 'procedures_definition' || b.parent) continue;
      const protoId = b.inputs?.custom_block?.[1];
      const proto = protoId ? blocks[protoId] : undefined;
      const proccode = proto?.mutation?.proccode || proto?.fields?.PROCCODE?.[0] || null;
      if (proccode) {
        pMap.set(proccode, id);
        defIdToProc.set(id, proccode);
      }
    }
    proceduresMap.set(target.name, pMap);
    procedureDefsByTarget.set(target.name, defIdToProc);

    for (const [id, b] of Object.entries(blocks)) {
      if (!b || b.parent) continue;
      if (b.opcode === 'event_whenbroadcastreceived') {
        const name = (b.fields && b.fields.BROADCAST_OPTION && b.fields.BROADCAST_OPTION[0]) || null;
        if (name) {
          if (!broadcastMap.has(name)) broadcastMap.set(name, []);
          broadcastMap.get(name).push({ targetName: target.name, topBlockId: id });
        }
      }
    }
  }

  const stageTarget = targets.find((t) => t.isStage);
  const stageVarMap = nameIdMap(stageTarget?.variables);
  const stageListMap = nameIdMap(stageTarget?.lists);
  const broadcastNameToId = new Map();
  for (const t of targets) {
    for (const [bName, bId] of nameIdMap(t.broadcasts)) {
      if (!broadcastNameToId.has(bName)) broadcastNameToId.set(bName, bId);
    }
  }

  const monitorsByTarget = routeMonitors(projectJson, targets);
  const dirNames = targetDirNames(targets);

  for (const target of targets) {
    const targetDir = dirNames.get(target);
    const tDir = path.join(outDir, targetDir);
    await vfs.mkdirp(tDir);

    const varMap = new Map([...stageVarMap, ...nameIdMap(target.variables)]);
    const listMap = new Map([...stageListMap, ...nameIdMap(target.lists)]);

    const { workspaceComments, blockComments } = routeComments(target);
    const membership = readMembership(target);
    for (const d of membership.diagnostics) diagnostics.push(diagnostic(d.code, d.message, { file: targetDir }));
    const workspaceById = new Map(workspaceComments.map((c) => [c.id, c]));
    const mappedComments = [];
    for (const [id, entry] of membership.comments) {
      const c = workspaceById.get(id);
      if (!c) continue;
      workspaceById.delete(id);
      mappedComments.push({ comment: c, entry });
    }
    const prelude = emitTargetPrelude({
      projectJson,
      target,
      monitors: monitorsByTarget.get(target.name) || [],
      workspaceComments: workspaceComments.filter((c) => workspaceById.has(c.id)),
    });

    const scripts = groupTopLevelScripts(target);
    const subgraphs = new Map();
    const coveredIds = new Set();
    for (const script of scripts) {
      const subgraph = collectBlocksSubgraph(target.blocks, script.topBlockId);
      subgraphs.set(script.topBlockId, subgraph);
      for (const id of Object.keys(subgraph)) coveredIds.add(id);
    }

    const allBlocks = target.blocks || {};
    const degenerateTuples = degenerateCounts.get(target) || 0;
    if (degenerateTuples) {
      diagnostics.push(
        diagnostic(
          'FR306',
          `${target.name}: normalized ${degenerateTuples} empty obscured input(s) to their visible shadow`,
          { file: targetDir }
        )
      );
    }
    const looseShadows = [];
    for (const id of Object.keys(allBlocks)) {
      if (coveredIds.has(id)) continue;

      const entry = allBlocks[id];
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.opcode !== 'string') continue;
      if (isMenuShadow(entry) || (entry.shadow && !entry.topLevel)) {
        looseShadows.push(id);
        continue;
      }
      const subgraph = collectBlocksSubgraph(allBlocks, id);
      const subIds = Object.keys(subgraph);
      if (!subIds.length) continue;
      for (const sid of subIds) coveredIds.add(sid);
      scripts.push({ topBlockId: id, hatOpcode: allBlocks[id]?.opcode || null });
      subgraphs.set(id, subgraph);
    }
    const droppedShadows = looseShadows.filter((id) => !coveredIds.has(id)).length;
    if (droppedShadows) {
      diagnostics.push(
        diagnostic(
          'FR305',
          `${target.name}: dropped ${droppedShadows} floating shadow block(s) left behind by editor corruption; they were never visible and are not emitted`,
          { file: targetDir }
        )
      );
    }

    const groups = new Map();
    const filenameForGroup = new Map();
    const usedNames = new Set(['index.fractch']);
    if (prelude || (target.costumes || []).length || (target.sounds || []).length) {
      groups.set('main', []);
      filenameForGroup.set('main', uniqueFilename('main.fractch', usedNames));
    }
    const stdlibModules = new Set();
    for (const script of scripts) {
      const { topBlockId, hatOpcode } = script;
      const subgraph = subgraphs.get(topBlockId);

      const procLabel =
        hatOpcode === 'procedures_definition' ? procedureDefsByTarget.get(target.name)?.get(topBlockId) || null : null;
      const entry = membership.entryFor(topBlockId);
      if (entry.module && STDLIB_MODULES[entry.module]) {
        stdlibModules.add(entry.module);
        continue;
      }
      const markerStem = cleanRelStem(entry.region);
      const groupKey = markerStem || 'main';
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      if (!filenameForGroup.has(groupKey)) {
        const preferred = markerStem ? `${markerStem}.fractch` : 'main.fractch';
        filenameForGroup.set(groupKey, uniqueFilename(preferred, usedNames));
      }
      groups.get(groupKey).push({ script, subgraph, procLabel });
    }

    for (const { comment, entry } of mappedComments) {
      const groupKey = cleanRelStem(entry.region) || 'main';
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      if (!filenameForGroup.has(groupKey)) {
        filenameForGroup.set(groupKey, uniqueFilename(`${groupKey}.fractch`, usedNames));
      }
      const list = groups.get(groupKey);
      const at = entry.before ? list.findIndex((e) => e.script?.topBlockId === entry.before) : -1;
      if (at >= 0) list.splice(at, 0, { comment });
      else list.push({ comment });
    }

    let finalPrelude = prelude;
    if (stdlibModules.size) {
      const importLines = [...stdlibModules].map((m) => `import ${JSON.stringify(m)};`).join('\n');
      finalPrelude = finalPrelude ? `${importLines}\n\n${finalPrelude}` : importLines;
      if (!groups.has('main')) {
        groups.set('main', []);
        filenameForGroup.set('main', uniqueFilename('main.fractch', usedNames));
      }
    }

    for (const [groupKey, entries] of groups) {
      const filename = filenameForGroup.get(groupKey);
      const filePath = path.join(tDir, filename);
      await vfs.mkdirp(path.dirname(filePath));
      const content = emitMultiScriptFile({
        target,
        entries,
        context: { broadcastMap, proceduresMap, procByCode, varMap, listMap, broadcastNameToId, blockComments },
        cfg: config,
        includeAssets: groupKey === 'main',
        prelude: groupKey === 'main' ? finalPrelude : '',
      });
      await vfs.writeFile(filePath, content);
      const rel = `./${targetDir}/${filename}`;
      const procLabels = entries.map((e) => e.procLabel).filter(Boolean);
      const scriptEntries = entries.filter((e) => e.script);
      files.push({
        target: target.name,
        hatOpcode: scriptEntries.length === 1 ? scriptEntries[0].script.hatOpcode || 'nohat' : 'mixed',
        filePath,
        rel,
        targetRel: `./${filename}`,
        label: procLabels.length === 1 ? procLabels[0] : null,
      });
    }
  }

  if (verbose) {
    diagnostics.push(
      diagnostic('FR308', `${files.length} script files across ${targets.length} targets`, { severity: 'info' })
    );
  }

  return {
    diagnostics,
    filesWritten: files.length,
    manifest: manifestWithoutBlocks(projectJson),
    indexContent: '',
  };
}

export function normalizeTargetBlocks(target) {
  const blocks = target?.blocks;
  if (!blocks || typeof blocks !== 'object') return { target, degenerate: 0 };
  let changed = null;
  let degenerate = 0;
  for (const [id, b] of Object.entries(blocks)) {
    if (Array.isArray(b)) {
      if (b[0] !== 12 && b[0] !== 13) continue;
      changed = changed || { ...blocks };
      changed[id] = topLevelPrimitiveBlock(b);
      continue;
    }
    if (!b || typeof b !== 'object') continue;
    for (const [key, tuple] of Object.entries(b.inputs || {})) {
      if (Array.isArray(tuple) && tuple[0] === 3 && tuple[1] == null && tuple.length > 2 && tuple[2] != null) {
        changed = changed || { ...blocks };
        const cur = changed[id];
        changed[id] = { ...cur, inputs: { ...cur.inputs, [key]: [1, tuple[2]] } };
        degenerate++;
      }
    }
  }
  return { target: changed ? { ...target, blocks: changed } : target, degenerate };
}

export function topLevelPrimitiveBlock(b) {
  const isList = b[0] === 13;
  return {
    opcode: isList ? 'data_listcontents' : 'data_variable',
    next: null,
    parent: null,
    inputs: {},
    fields: { [isList ? 'LIST' : 'VARIABLE']: [b[1], b[2] ?? null] },
    shadow: false,
    topLevel: true,
    x: b[3] ?? 0,
    y: b[4] ?? 0,
  };
}

function manifestWithoutBlocks(projectJson) {
  return {
    ...projectJson,
    targets: (projectJson.targets || []).map((t) => {
      const rest = { ...t };
      delete rest.blocks;
      delete rest.costumes;
      delete rest.sounds;
      return rest;
    }),
  };
}

export function routeMonitors(projectJson, targets) {
  const stageTarget = targets.find((t) => t.isStage);
  const byName = new Map(targets.map((t) => [t.name, t]));
  const out = new Map();
  const push = (targetName, info) => {
    if (!out.has(targetName)) out.set(targetName, []);
    out.get(targetName).push(info);
  };
  for (const m of projectJson.monitors || []) {
    if (!m) continue;
    const isList = m.opcode === 'data_listcontents';
    if (m.opcode !== 'data_variable' && !isList) {
      const builtinOwner = m.spriteName == null ? stageTarget : byName.get(m.spriteName);
      push((builtinOwner || stageTarget)?.name, {
        opcode: m.opcode,
        params: m.params || {},
        isList: false,
        name: null,
        mode: m.mode,
        x: m.x,
        y: m.y,
        width: m.width,
        height: m.height,
        visible: m.visible,
        sliderMin: m.sliderMin,
        sliderMax: m.sliderMax,
        isDiscrete: m.isDiscrete,
        sprite: m.spriteName ?? null,
        id: m.id ?? null,
      });
      continue;
    }
    const name = isList ? m.params?.LIST : m.params?.VARIABLE;
    const owner = m.spriteName == null ? stageTarget : byName.get(m.spriteName);
    let derivedId = null;
    if (owner) {
      derivedId =
        nameIdMap(isList ? owner.lists : owner.variables).get(name) ??
        (stageTarget && owner !== stageTarget
          ? nameIdMap(isList ? stageTarget.lists : stageTarget.variables).get(name)
          : null) ??
        null;
    }
    push((owner || stageTarget)?.name, {
      isList,
      name,
      mode: m.mode,
      x: m.x,
      y: m.y,
      width: m.width,
      height: m.height,
      visible: m.visible,
      sliderMin: m.sliderMin,
      sliderMax: m.sliderMax,
      isDiscrete: m.isDiscrete,
      sprite: owner ? null : (m.spriteName ?? null),
      id: !owner || derivedId !== m.id ? m.id : null,
    });
  }
  return out;
}

function routeComments(target) {
  const workspaceComments = [];
  const blockComments = new Map();
  const fileMarkers = new Map();
  const blocks = target.blocks || {};
  for (const [id, c] of Object.entries(target.comments || {})) {
    if (!c || typeof c !== 'object') continue;
    if (isMembershipComment(c)) continue;
    const markerStem = decodeFileStemFromComment(commentText(c));
    if (markerStem && c.blockId && blocks[c.blockId]) {
      const anchor = statementAnchor(blocks, c.blockId);
      if (anchor) fileMarkers.set(anchor, markerStem);
      continue;
    }
    const decl = {
      id,
      text: commentText(c),
      x: c.x ?? 0,
      y: c.y ?? 0,
      width: c.width ?? 200,
      height: c.height ?? 200,
      minimized: !!c.minimized,
      forId: null,
    };
    const anchor = c.blockId && blocks[c.blockId] ? statementAnchor(blocks, c.blockId) : null;
    if (anchor) {
      if (!blockComments.has(anchor)) blockComments.set(anchor, []);
      blockComments.get(anchor).push(decl);
    } else {
      if (c.blockId) decl.forId = c.blockId;
      workspaceComments.push(decl);
    }
  }
  return { workspaceComments, blockComments, fileMarkers };
}

function statementAnchor(blocks, id) {
  let cur = id;
  for (let guard = 0; guard < 10000; guard++) {
    const b = blocks[cur];
    if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
    const p = b.parent;
    if (!p || !blocks[p] || typeof blocks[p] !== 'object' || Array.isArray(blocks[p])) return cur;
    const pb = blocks[p];
    if (pb.next === cur) return cur;
    for (const [key, tuple] of Object.entries(pb.inputs || {})) {
      if (!Array.isArray(tuple)) continue;
      if (key.startsWith('SUBSTACK') && tuple.slice(1).includes(cur)) return cur;
    }
    cur = p;
  }
  return null;
}

function uniqueFilename(preferred, used) {
  const ext = preferred.endsWith('.fractch') ? '.fractch' : '';
  const base = ext ? preferred.slice(0, -ext.length) : preferred;
  let filename = preferred;
  let counter = 1;
  while (used.has(filename)) filename = `${base}_${counter++}${ext}`;
  used.add(filename);
  return filename;
}

function nameIdMap(dict) {
  const map = new Map();
  for (const [id, entry] of Object.entries(dict || {})) {
    const name = Array.isArray(entry) ? entry[0] : entry;
    if (typeof name === 'string' && !map.has(name)) map.set(name, id);
  }
  return map;
}

export function cleanIdent(label) {
  const stripped = String(label)
    .replace(/%[snb]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  let id = stripped.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (/^[0-9]/.test(id)) id = `_${id}`;
  return id || 'proc';
}

export function buildProcByCode(targets) {
  const map = new Map();

  const usedProcIdents = new Set();
  const prototypes = [];
  const seenCodes = new Set();
  for (const target of targets) {
    const blocks = target.blocks || {};
    for (const b of Object.values(blocks)) {
      if (!b || b.opcode !== 'procedures_prototype') continue;
      const proccode = b.mutation?.proccode;
      if (!proccode || seenCodes.has(proccode)) continue;
      seenCodes.add(proccode);
      prototypes.push(b);
    }
  }
  prototypes.sort((a, b) =>
    a.mutation.proccode < b.mutation.proccode ? -1 : a.mutation.proccode > b.mutation.proccode ? 1 : 0
  );
  {
    for (const b of prototypes) {
      const proccode = b.mutation.proccode;
      let ids = [];
      let names = [];
      try {
        ids = JSON.parse(b.mutation?.argumentids || '[]');
      } catch {
        ids = [];
      }
      try {
        names = JSON.parse(b.mutation?.argumentnames || '[]');
      } catch {
        names = [];
      }

      const seenIdents = new Map();
      const kinds = (proccode.match(/%[snb]/g) || []).map((t) => t[1]);
      const params = ids.map((id, i) => {
        const name = names[i] ?? `arg${i}`;
        const base = cleanIdent(name);
        const count = seenIdents.get(base) || 0;
        seenIdents.set(base, count + 1);
        const ident = count === 0 ? base : `${base}_${count + 1}`;
        return { id, ident, name, kind: kinds[i] === 'b' ? 'b' : 's' };
      });

      let base = cleanIdent(proccode);
      let ident = base;
      let n = 1;
      while (usedProcIdents.has(ident)) ident = `${base}_${++n}`;
      usedProcIdents.add(ident);

      map.set(proccode, { ident, params, label: proccode });
    }
  }

  for (const target of targets) {
    for (const b of Object.values(target.blocks || {})) {
      if (!b || b.opcode !== 'procedures_call' || !b.mutation?.return) continue;
      const info = map.get(b.mutation.proccode);
      if (info && info.returns == null) info.returns = String(b.mutation.return);
    }
  }
  return map;
}
