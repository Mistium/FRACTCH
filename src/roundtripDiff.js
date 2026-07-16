import * as path from './pathUtils.js';
import { toPromiseFs } from './fsAdapter.js';
import { parseFractch } from './parse.js';
import { buildBlocksFromCalls, IdGen } from './buildBlocks.js';
import { buildProcByCode } from './convert.js';
import { groupTopLevelScripts } from './graph.js';


export function nameIdMap(dict) {
  const m = new Map();
  for (const [id, entry] of Object.entries(dict || {})) {
    const name = Array.isArray(entry) ? entry[0] : entry;
    if (typeof name === 'string' && !m.has(name)) m.set(name, id);
  }
  return m;
}

export function compareTrees(origBlocks, origId, newBlocks, newId, path_ = '$', seen = new Set()) {
  if (origId == null && newId == null) return null;
  if (origId == null || newId == null) return `${path_}: one side null (orig=${origId}, new=${newId})`;
  const key = `${origId}|${newId}`;
  if (seen.has(key)) return null;
  seen.add(key);

  const a = origBlocks[origId];
  const b = newBlocks[newId];
  if (!a && !b) return origId === newId ? null : `${path_}: dangling ref mismatch (orig=${origId}, new=${newId})`;
  if (!a || !b) return `${path_}: missing block node (orig=${origId}, new=${newId})`;
  if (a.opcode !== b.opcode) return `${path_}: opcode ${a.opcode} vs ${b.opcode}`;
  if (a.shadow && b.shadow && a.opcode.startsWith('argument_reporter')) return null;

  const aFields = a.fields || {};
  const bFields = b.fields || {};
  const fKeys = new Set([...Object.keys(aFields), ...Object.keys(bFields)]);
  fKeys.delete('PLUS');
  fKeys.delete('MINUS');
  for (const k of fKeys) {
    const av = aFields[k];
    const bv = bFields[k];
    const aName = Array.isArray(av) ? av[0] : av;
    const bName = Array.isArray(bv) ? bv[0] : bv;
    if (String(aName ?? '') !== String(bName ?? '')) {
      return `${path_}.fields.${k}: ${JSON.stringify(av)} vs ${JSON.stringify(bv)}`;
    }
  }

  const aInputs = a.inputs || {};
  const bInputs = b.inputs || {};
  const activeOf = (tuple) => (tuple[0] === 3 && tuple[1] == null && tuple.length > 2 ? tuple[2] : tuple[1]);
  const compareInputPair = (av, bv, k) => {
    if (!av && !bv) return null;
    if (!av || !bv) {
      if (!av && bv) {
        const val = activeOf(bv);
        const child = typeof val === 'string' ? newBlocks[val] : null;
        if (child && child.shadow) return null;
        if (!child && (val == null || (Array.isArray(val) && String(val[1] ?? '') === ''))) return null;
      }
      if (av && !bv) {
        const val = activeOf(av);
        if (val == null) return null;
      }
      return `${path_}.inputs.${k}: ${JSON.stringify(av)} vs ${JSON.stringify(bv)}`;
    }
    const aVal = activeOf(av);
    const bVal = activeOf(bv);
    const aChild = typeof aVal === 'string' && origBlocks[aVal] ? aVal : null;
    const bChild = typeof bVal === 'string' && newBlocks[bVal] ? bVal : null;
    if (aChild || bChild) {
      return compareTrees(origBlocks, aChild, newBlocks, bChild, `${path_}.inputs.${k}`, seen);
    }
    const aPayload = Array.isArray(aVal) ? aVal[1] : aVal;
    const bPayload = Array.isArray(bVal) ? bVal[1] : bVal;
    if (String(aPayload ?? '') !== String(bPayload ?? '')) {
      return `${path_}.inputs.${k}: literal ${JSON.stringify(av)} vs ${JSON.stringify(bv)}`;
    }
    return null;
  };

  const parseIds = (block) => {
    try {
      const v = JSON.parse(block.mutation?.argumentids ?? 'null');
      return Array.isArray(v) ? v : null;
    } catch {
      return null;
    }
  };
  const aIds = parseIds(a);
  const bIds = parseIds(b);
  if (a.mutation || b.mutation) {
    const aCode = a.mutation?.proccode;
    const bCode = b.mutation?.proccode;
    if (String(aCode ?? '') !== String(bCode ?? '')) {
      return `${path_}: proccode ${JSON.stringify(aCode)} vs ${JSON.stringify(bCode)}`;
    }
  }
  const positional = aIds && bIds ? { a: aIds, b: bIds } : null;
  if (positional && positional.a.length !== positional.b.length) {
    return `${path_}: argument count ${positional.a.length} vs ${positional.b.length}`;
  }

  if (positional) {
    for (let i = 0; i < positional.a.length; i++) {
      const d = compareInputPair(aInputs[positional.a[i]], bInputs[positional.b[i]], `arg${i}(${positional.a[i]})`);
      if (d) return d;
    }
  }

  const iKeys = positional ? [] : new Set([...Object.keys(aInputs), ...Object.keys(bInputs)]);
  for (const k of iKeys) {
    const d = compareInputPair(aInputs[k], bInputs[k], k);
    if (d) return d;
  }

  return compareTrees(origBlocks, a.next, newBlocks, b.next, `${path_}.next`, seen);
}

export function buildRoundtripContext(project) {
  const procByCode = buildProcByCode(project.targets || []);
  const procArgMaps = new Map();
  const identToProccode = new Map();
  for (const t of project.targets || []) {
    const pMap = new Map();
    const iMap = new Map();
    for (const b of Object.values(t.blocks || {})) {
      if (!b || b.opcode !== 'procedures_prototype') continue;
      const proccode = b.mutation?.proccode;
      if (!proccode) continue;
      let ids = [];
      try { ids = JSON.parse(b.mutation?.argumentids || '[]'); } catch {}
      pMap.set(proccode, ids);
      const info = procByCode.get(proccode);
      if (info) iMap.set(info.ident, proccode);
    }
    procArgMaps.set(t.name, pMap);
    identToProccode.set(t.name, iMap);
  }
  const globalArgs = new Map();
  const globalIdents = new Map();
  for (const m of procArgMaps.values()) for (const [k, v] of m) if (!globalArgs.has(k)) globalArgs.set(k, v);
  for (const m of identToProccode.values()) for (const [k, v] of m) if (!globalIdents.has(k)) globalIdents.set(k, v);
  for (const [name, m] of procArgMaps) procArgMaps.set(name, new Map([...globalArgs, ...m]));
  for (const [name, m] of identToProccode) identToProccode.set(name, new Map([...globalIdents, ...m]));

  const stage = (project.targets || []).find((t) => t.isStage);
  const stageVarMap = nameIdMap(stage?.variables);
  const stageListMap = nameIdMap(stage?.lists);
  const broadcastNameToId = new Map();
  for (const t of project.targets || []) {
    for (const [n, id] of nameIdMap(t.broadcasts)) if (!broadcastNameToId.has(n)) broadcastNameToId.set(n, id);
  }
  return { procByCode, procArgMaps, identToProccode, stageVarMap, stageListMap, broadcastNameToId };
}

function parseHeader(text) {
  const headStart = text.indexOf('/**');
  const headEnd = text.indexOf('*/', headStart + 3);
  const head = text.slice(headStart, headEnd);
  const map = new Map();
  for (const line of head.split(/\r?\n/)) {
    const m = /\*\s*([^:]+):\s*(.*)$/.exec(line.trim());
    if (m) map.set(m[1].trim(), m[2].trim());
  }
  return { target: map.get('target'), topBlockId: map.get('topBlockId'), hatOpcode: map.get('hatOpcode') };
}

async function walkFractchFiles(vfs, dir, out = []) {
  let entries;
  try {
    entries = await vfs.readdir(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.startsWith('.')) continue;
    const p = path.join(dir, e);
    if (await vfs.isDirectory(p)) await walkFractchFiles(vfs, p, out);
    else if (e.endsWith('.fractch') && e !== 'index.fractch') out.push(p);
  }
  return out;
}

export async function verifyRoundtrip({ project, buildDir, fs: fsLike }) {
  const vfs = toPromiseFs(fsLike);
  const ctx = buildRoundtripContext(project);
  const files = (await walkFractchFiles(vfs, buildDir)).sort();

  const targetScriptCursor = new Map();
  let total = 0;
  let ok = 0;
  const failures = [];
  for (const f of files) {
    const text = String(await vfs.readFile(f, 'utf8'));
    const h = parseHeader(text);
    const rel = path.relative(buildDir, f).split('/');
    const targetName = h.target || (rel.length >= 2 ? rel[0] : null);
    if (!targetName) continue;
    const t = (project.targets || []).find((x) => sanitizeName(x.name) === targetName || x.name === targetName);
    if (!t) continue;

    let scripts;
    try {
      const parsed = parseFractch(text);
      scripts = h.topBlockId ? [{ calls: parsed.calls, topBlockId: h.topBlockId, hatOpcode: h.hatOpcode }] : parsed.scripts;
    } catch (e) {
      failures.push({ file: f, err: `parse: ${e.message}` });
      continue;
    }

    const originScripts = groupTopLevelScripts(t);
    const sharedIdGen = new IdGen();
    for (const s of scripts || []) {
      const cursor = targetScriptCursor.get(t.name) || 0;
      const expected = s.topBlockId ? { topBlockId: s.topBlockId, hatOpcode: s.hatOpcode } : originScripts[cursor];
      targetScriptCursor.set(t.name, cursor + 1);
      if (!expected?.topBlockId || !t.blocks[expected.topBlockId]) continue;
      total++;

      try {
        const { blocks: newBlocks, topId } = buildBlocksFromCalls(s.calls, {
          hatOpcode: s.kind === 'implicit' ? expected.hatOpcode : null,
          proceduresMapForTarget: ctx.procArgMaps.get(t.name),
          identToProccode: ctx.identToProccode.get(t.name),
          varMap: new Map([...ctx.stageVarMap, ...nameIdMap(t.variables)]),
          listMap: new Map([...ctx.stageListMap, ...nameIdMap(t.lists)]),
          broadcastNameToId: ctx.broadcastNameToId,
          idGen: sharedIdGen,
        });
        const diff = compareTrees(t.blocks, expected.topBlockId, newBlocks, topId);
        if (diff) failures.push({ file: f, err: diff });
        else ok++;
      } catch (e) {
        failures.push({ file: f, err: `build: ${e.message}` });
      }
    }
  }
  return { total, ok, failures };
}

function sanitizeName(name) {
  return String(name).replace(/[^a-zA-Z0-9-_]/g, '_');
}
