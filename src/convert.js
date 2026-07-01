import * as path from './pathUtils.js';
import { toPromiseFs } from './fsAdapter.js';
import { emitScriptFile, emitIndex, emitTargetIndex } from './emit.js';
import { groupTopLevelScripts, collectBlocksSubgraph } from './graph.js';

export async function convertProject(projectJson, { outDir, fs: fsLike, config = {}, verbose = false } = {}) {
  const vfs = toPromiseFs(fsLike);
  await vfs.mkdirp(outDir);
  const targets = projectJson.targets || [];
  const files = [];

  const broadcastMap = new Map(); // name -> [{ targetName, topBlockId }]
  const proceduresMap = new Map(); // targetName -> Map(proccode -> defTopBlockId)
  const procedureDefsByTarget = new Map(); // targetName -> Map(defTopBlockId -> proccode)
  const procByCode = buildProcByCode(targets); // proccode -> { ident, params: [{id, ident}] }

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

  for (const target of targets) {
    const tDir = path.join(outDir, sanitize(target.name));
    await vfs.mkdirp(tDir);

    const varMap = new Map([...stageVarMap, ...nameIdMap(target.variables)]);
    const listMap = new Map([...stageListMap, ...nameIdMap(target.lists)]);

    const scripts = groupTopLevelScripts(target);
    const subgraphs = new Map(); // topBlockId -> subgraph
    const coveredIds = new Set();
    for (const script of scripts) {
      const subgraph = collectBlocksSubgraph(target.blocks, script.topBlockId);
      subgraphs.set(script.topBlockId, subgraph);
      for (const id of Object.keys(subgraph)) coveredIds.add(id);
    }

    // Some sb3 projects contain block chains detached from any reachable
    // script (e.g. left over from editor operations, with a parent id that
    // no longer exists). They aren't executable, but they're still present
    // in project.json, so sweep them into their own script files too -
    // otherwise they'd have nowhere to live once manifest.json drops blocks.
    const allBlocks = target.blocks || {};
    for (const id of Object.keys(allBlocks)) {
      if (coveredIds.has(id)) continue;
      // Some corrupted/edited project.json files carry stray dict entries
      // under `blocks` that are actually raw compact-literal tuples (e.g.
      // `[12, "name", "id"]`, the same shape used for inline variable
      // reads) rather than real block objects - skip those, they aren't
      // executable content and have no `opcode` to sweep.
      const entry = allBlocks[id];
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.opcode !== 'string') continue;
      const subgraph = collectBlocksSubgraph(allBlocks, id);
      const subIds = Object.keys(subgraph);
      if (!subIds.length) continue;
      for (const sid of subIds) coveredIds.add(sid);
      scripts.push({ topBlockId: id, hatOpcode: allBlocks[id]?.opcode || null });
      subgraphs.set(id, subgraph);
    }

    let idx = 0;
    const usedNames = new Set();
    for (const script of scripts) {
      const { topBlockId, hatOpcode } = script;
      const subgraph = subgraphs.get(topBlockId);
      const hatDir = path.join(tDir, sanitize(hatOpcode || 'nohat'));
      await vfs.mkdirp(hatDir);

      const procLabel =
        hatOpcode === 'procedures_definition' ? procedureDefsByTarget.get(target.name)?.get(topBlockId) || null : null;
      const baseRaw = procLabel || topBlockId || 'top';
      let base = sanitize(baseRaw);
      let filename = `${base}.fractch`;

      let counter = 1;
      while (usedNames.has(path.join(hatDir, filename))) {
        filename = `${base}_${counter++}.fractch`;
      }
      usedNames.add(path.join(hatDir, filename));
      const filePath = path.join(hatDir, filename);
      const content = emitScriptFile({
        target,
        script,
        subgraph,
        index: idx++,
        context: { broadcastMap, proceduresMap, procByCode, varMap, listMap, broadcastNameToId },
        cfg: config,
      });
      await vfs.writeFile(filePath, content);
      const rel = `./${sanitize(target.name)}/${sanitize(hatOpcode || 'nohat')}/${filename}`;
      const label = procLabel;
      files.push({
        target: target.name,
        hatOpcode: hatOpcode || 'nohat',
        filePath,
        rel,
        label,
      });
    }

    const tIndex = emitTargetIndex(files.filter((f) => f.target === target.name));
    await vfs.writeFile(path.join(tDir, 'index.fractch'), tIndex);
  }

  const indexContent = emitIndex(files);
  const manifest = manifestWithoutBlocks(projectJson);
  await vfs.writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await vfs.writeFile(path.join(outDir, 'index.fractch'), indexContent);
  if (verbose) console.log(`[convert] ${files.length} script files across ${targets.length} targets`);

  return {
    filesWritten: files.length + (targets.length || 0) + 1,
    manifest,
    indexContent,
  };
}

function manifestWithoutBlocks(projectJson) {
  return {
    ...projectJson,
    targets: (projectJson.targets || []).map((t) => {
      const { blocks, ...rest } = t;
      return rest;
    }),
  };
}

function sanitize(name) {
  return String(name).replace(/[^a-zA-Z0-9-_]/g, '_');
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
  const stripped = String(label).replace(/%[snb]/g, ' ').replace(/\s+/g, ' ').trim();
  let id = stripped.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (/^[0-9]/.test(id)) id = `_${id}`; // must be a valid bare identifier (e.g. `def @Ident(...)`)
  return id || 'proc';
}

export function buildProcByCode(targets) {
  const map = new Map();
  // Two unrelated custom blocks can have proccodes that clean to the same
  // identifier (e.g. "OSL // %s .( %s ) %s = %s" and "OSL //  %s . %s  =  %s"
  // both -> "OSL"). Call sites are written as `@ident(...)` and resolved
  // back to a proccode purely by that identifier, so collisions must be
  // disambiguated here or the second proc's calls silently resolve to the
  // first proc's argument shape.
  const usedProcIdents = new Set();
  for (const target of targets) {
    const blocks = target.blocks || {};
    for (const b of Object.values(blocks)) {
      if (!b || b.opcode !== 'procedures_prototype') continue;
      const proccode = b.mutation?.proccode;
      if (!proccode || map.has(proccode)) continue;
      let ids = [];
      let names = [];
      try { ids = JSON.parse(b.mutation?.argumentids || '[]'); } catch {}
      try { names = JSON.parse(b.mutation?.argumentnames || '[]'); } catch {}
      // Two params can have different display names that clean to the same
      // identifier (e.g. "X" and "+X" both -> "X") - body references are
      // resolved by bare identifier, so collisions must be disambiguated
      // here or the second param becomes unreachable/misresolved in the DSL.
      const seenIdents = new Map();
      const params = ids.map((id, i) => {
        const name = names[i] ?? `arg${i}`;
        const base = cleanIdent(name);
        const count = seenIdents.get(base) || 0;
        seenIdents.set(base, count + 1);
        const ident = count === 0 ? base : `${base}_${count + 1}`;
        return { id, ident, name };
      });

      let base = cleanIdent(proccode);
      let ident = base;
      let n = 1;
      while (usedProcIdents.has(ident)) ident = `${base}_${++n}`;
      usedProcIdents.add(ident);

      map.set(proccode, { ident, params, label: proccode });
    }
  }
  return map;
}
