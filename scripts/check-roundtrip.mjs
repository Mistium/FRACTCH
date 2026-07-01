// Deep structural round-trip check: for every generated .fractch file, parse
// it and rebuild its blocks, then walk the rebuilt tree against the true
// origin subgraph (matched by traversal position, not block id, since fresh
// ids are assigned on rebuild) reporting the first structural mismatch per
// file. This is what actually verifies DSL-only fidelity - unlike
// check-parse.mjs, which only checks that files parse without throwing.
//
// Usage: node scripts/check-roundtrip.mjs [originSb3] [buildDir]
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { parseFractch } from '../src/parse.js';
import { buildBlocksFromCalls, IdGen } from '../src/buildBlocks.js';
import { buildProcByCode } from '../src/convert.js';

const originPath = process.argv[2] || path.resolve('./originv6.0.0.sb3');
const buildDir = process.argv[3] || path.resolve('./build');

const project = JSON.parse(new AdmZip(originPath).readAsText('project.json'));

// ---- build context maps directly from the true origin data ----
// Reuses the real buildProcByCode (same code the actual converter runs) so
// this check resolves `@ident(...)` call sites the same way the real
// pack step does, including its collision-disambiguation (e.g. two
// differently-shaped custom blocks that both clean to "OSL" -> "OSL"/"OSL_2").
const procByCode = buildProcByCode(project.targets);
const procArgMaps = new Map(); // targetName -> Map(proccode -> ids[])
const identToProccode = new Map(); // targetName -> Map(ident -> proccode)
for (const t of project.targets) {
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

function nameIdMap(dict) {
  const m = new Map();
  for (const [id, entry] of Object.entries(dict || {})) {
    const name = Array.isArray(entry) ? entry[0] : entry;
    if (typeof name === 'string' && !m.has(name)) m.set(name, id);
  }
  return m;
}
const stage = project.targets.find((t) => t.isStage);
const stageVarMap = nameIdMap(stage?.variables);
const stageListMap = nameIdMap(stage?.lists);
const broadcastNameToId = new Map();
for (const t of project.targets) for (const [n, id] of nameIdMap(t.broadcasts)) if (!broadcastNameToId.has(n)) broadcastNameToId.set(n, id);

// ---- collect (target, topBlockId) -> file, from generated build dir headers ----
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir)) {
    const p = path.join(dir, e);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (e.endsWith('.fractch') && e !== 'index.fractch') out.push(p);
  }
  return out;
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

function collectSubgraph(blocks, topId) {
  const sub = {};
  const stack = [topId];
  while (stack.length) {
    const id = stack.pop();
    if (!id || sub[id]) continue;
    const node = blocks[id];
    if (!node) continue;
    sub[id] = node;
    if (node.next) stack.push(node.next);
    if (node.inputs) {
      for (const val of Object.values(node.inputs)) {
        if (Array.isArray(val)) {
          for (let i = 1; i < val.length; i++) {
            const c = val[i];
            if (typeof c === 'string' && blocks[c]) stack.push(c);
          }
        }
      }
    }
  }
  return sub;
}

// Structural comparison ignoring block ids: walk both graphs in lockstep.
function compareTrees(origBlocks, origId, newBlocks, newId, path_ = '$', seen = new Set()) {
  if (origId == null && newId == null) return null;
  if (origId == null || newId == null) return `${path_}: one side null (orig=${origId}, new=${newId})`;
  const key = origId + '|' + newId;
  if (seen.has(key)) return null;
  seen.add(key);

  const a = origBlocks[origId];
  const b = newBlocks[newId];
  // A dangling reference (a forward id with no real block behind it - see
  // buildBlocks.js's `dangling_next` sentinel) round-trips correctly when
  // both sides point at the exact same nonexistent id; only flag it when
  // they disagree on *which* id, or when just one side is dangling.
  if (!a && !b) return origId === newId ? null : `${path_}: dangling ref mismatch (orig=${origId}, new=${newId})`;
  if (!a || !b) return `${path_}: missing block node (orig=${origId}, new=${newId})`;
  if (a.opcode !== b.opcode) return `${path_}: opcode ${a.opcode} vs ${b.opcode}`;

  // fields (ignore null vs missing id slot as a soft mismatch, only flag name mismatches)
  const aFields = a.fields || {};
  const bFields = b.fields || {};
  const fKeys = new Set([...Object.keys(aFields), ...Object.keys(bFields)]);
  for (const k of fKeys) {
    const av = aFields[k];
    const bv = bFields[k];
    const aName = Array.isArray(av) ? av[0] : av;
    const bName = Array.isArray(bv) ? bv[0] : bv;
    if (String(aName ?? '') !== String(bName ?? '')) {
      return `${path_}.fields.${k}: ${JSON.stringify(av)} vs ${JSON.stringify(bv)}`;
    }
  }

  // inputs: compare keys, and recurse into block references; compare literal
  // payload values (ignore the shadow/type flag - text form doesn't preserve it).
  const aInputs = a.inputs || {};
  const bInputs = b.inputs || {};
  const iKeys = new Set([...Object.keys(aInputs), ...Object.keys(bInputs)]);
  for (const k of iKeys) {
    const av = aInputs[k];
    const bv = bInputs[k];
    if (!av || !bv) return `${path_}.inputs.${k}: ${JSON.stringify(av)} vs ${JSON.stringify(bv)}`;
    const aChild = typeof av[1] === 'string' && origBlocks[av[1]] ? av[1] : null;
    const bChild = typeof bv[1] === 'string' && newBlocks[bv[1]] ? bv[1] : null;
    if (aChild || bChild) {
      const d = compareTrees(origBlocks, aChild, newBlocks, bChild, `${path_}.inputs.${k}`, seen);
      if (d) return d;
    } else {
      // both literal
      const aPayload = Array.isArray(av[1]) ? av[1][1] : av[1];
      const bPayload = Array.isArray(bv[1]) ? bv[1][1] : bv[1];
      if (String(aPayload ?? '') !== String(bPayload ?? '')) {
        return `${path_}.inputs.${k}: literal ${JSON.stringify(av)} vs ${JSON.stringify(bv)}`;
      }
    }
  }

  // next chain
  return compareTrees(origBlocks, a.next, newBlocks, b.next, `${path_}.next`, seen);
}

const files = walk(buildDir);
let total = 0, ok = 0;
const failures = [];
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  const h = parseHeader(text);
  if (!h.target || !h.topBlockId) continue;
  const t = project.targets.find((x) => x.name === h.target);
  if (!t) continue;
  const origBlock = t.blocks[h.topBlockId];
  if (!origBlock) continue; // orphan-sweep synthetic file etc - skip for this check
  total++;

  let calls;
  try {
    calls = parseFractch(text).calls;
  } catch (e) {
    failures.push({ f, err: 'parse: ' + e.message });
    continue;
  }

  try {
    const { blocks: newBlocks, topId } = buildBlocksFromCalls(calls, {
      hatOpcode: h.hatOpcode,
      proceduresMapForTarget: procArgMaps.get(h.target),
      identToProccode: identToProccode.get(h.target),
      varMap: new Map([...stageVarMap, ...nameIdMap(t.variables)]),
      listMap: new Map([...stageListMap, ...nameIdMap(t.lists)]),
      broadcastNameToId,
      idGen: new IdGen(),
    });
    const diff = compareTrees(t.blocks, h.topBlockId, newBlocks, topId);
    if (diff) {
      failures.push({ f, err: diff });
    } else {
      ok++;
    }
  } catch (e) {
    failures.push({ f, err: 'build: ' + e.message });
  }
}

console.log(`total=${total} ok=${ok} fail=${failures.length}`);
for (const fl of failures.slice(0, 30)) {
  console.log('---', fl.f);
  console.log('   ', fl.err);
}
