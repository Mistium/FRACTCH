import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { convertProject } from '../../src/convert.js';
import { buildProjectFromBuildDir } from '../../src/pack.js';

const PRIMITIVE_BLOCKS = {
  math_number: 'NUM',
  math_positive_number: 'NUM',
  math_whole_number: 'NUM',
  math_integer: 'NUM',
  math_angle: 'NUM',
  colour_picker: 'COLOUR',
  text: 'TEXT',
};

export async function convertAndRebuild(project) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fractch-fidelity-'));
  try {
    await convertProject(structuredClone(project), { outDir: dir, fs });
    const texts = {};
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.fractch'))
          texts[path.relative(dir, p).split(path.sep).join('/')] = fs.readFileSync(p, 'utf8');
      }
    };
    walk(dir);
    const { manifest } = await buildProjectFromBuildDir({ buildDir: dir, fs, prune: false });
    return { manifest, texts };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function fieldValue(v) {
  return Array.isArray(v) ? String(v[0] ?? '') : String(v ?? '');
}

function argumentIds(block) {
  try {
    const ids = JSON.parse(block?.mutation?.argumentids ?? 'null');
    return Array.isArray(ids) ? ids : null;
  } catch {
    return null;
  }
}

function canonValue(blocks, ref, seen) {
  if (ref == null) return null;
  if (Array.isArray(ref)) {
    if (ref[0] === 11) return `broadcast:${ref[1]}`;
    if (ref[0] === 12) return `var:${ref[1]}`;
    if (ref[0] === 13) return `list:${ref[1]}`;
    return `lit:${ref[1] ?? ''}`;
  }
  const block = blocks[ref];
  if (!block || Array.isArray(block)) return `missing:${ref}`;
  const prim = PRIMITIVE_BLOCKS[block.opcode];
  if (prim && block.shadow && !Object.keys(block.inputs || {}).length) return `lit:${fieldValue(block.fields?.[prim])}`;
  return canonBlock(blocks, ref, seen);
}

function canonInput(blocks, tuple, seen) {
  if (!Array.isArray(tuple)) return { value: null };
  if (tuple[0] === 1) return { value: canonValue(blocks, tuple[1], seen) };
  return {
    value: canonValue(blocks, tuple[1], seen),
    hidden: tuple[0] === 3 && tuple.length > 2 ? canonValue(blocks, tuple[2], seen) : null,
  };
}

function canonBlock(blocks, id, seen) {
  if (seen.has(id)) return `cycle:${id}`;
  seen.add(id);
  const block = blocks[id];
  const out = { opcode: block.opcode };
  if (block.shadow && block.opcode !== 'procedures_prototype') out.shadow = true;
  const fields = {};
  for (const [k, v] of Object.entries(block.fields || {})) fields[k] = fieldValue(v);
  if (Object.keys(fields).length) out.fields = fields;
  const inputs = {};
  const argIds = block.opcode === 'procedures_call' ? argumentIds(block) : null;
  for (const [k, tuple] of Object.entries(block.inputs || {})) {
    const at = argIds ? argIds.indexOf(k) : -1;
    const key = at >= 0 ? `arg${at}` : k;
    if (/^SUBSTACK/.test(k) && Array.isArray(tuple) && typeof tuple[1] === 'string' && blocks[tuple[1]]) {
      inputs[key] = { branch: canonChain(blocks, tuple[1], seen) };
    } else if (block.opcode !== 'procedures_prototype') {
      const input = canonInput(blocks, tuple, seen);
      if (input.value != null || input.hidden != null) inputs[key] = input;
    }
  }
  if (Object.keys(inputs).length) out.inputs = inputs;
  if (
    block.mutation &&
    !(block.opcode === 'control_stop' && Object.keys(block.mutation).join() === 'tagName,children,hasnext')
  ) {
    const m = {};
    for (const [k, v] of Object.entries(block.mutation)) {
      if (k === 'tagName' || k === 'children' || k === 'argumentids') continue;
      m[k] = typeof v === 'string' ? v : JSON.stringify(v);
    }
    if (Object.keys(m).length) out.mutation = m;
  }
  return out;
}

function canonChain(blocks, id, seen) {
  const chain = [];
  let cur = id;
  while (cur && blocks[cur] && !Array.isArray(blocks[cur]) && !seen.has(cur)) {
    chain.push(canonBlock(blocks, cur, seen));
    cur = blocks[cur].next;
  }
  return chain;
}

export function scriptsOf(target) {
  const blocks = target.blocks || {};
  const scripts = [];
  for (const [id, b] of Object.entries(blocks)) {
    if (Array.isArray(b)) {
      if (b[0] === 12 || b[0] === 13)
        scripts.push({ at: `${Math.round(b[3])},${Math.round(b[4])}`, chain: [canonValue(blocks, b, new Set())] });
      continue;
    }
    if (!b || !b.topLevel || b.parent || (b.shadow && b.opcode !== 'procedures_definition' && !b.next)) continue;
    const ref = { data_variable: ['VARIABLE', 'var'], data_listcontents: ['LIST', 'list'] }[b.opcode];
    if (ref && !b.next && !Object.keys(b.inputs || {}).length) {
      scripts.push({
        at: `${Math.round(b.x ?? 0)},${Math.round(b.y ?? 0)}`,
        chain: [`${ref[1]}:${fieldValue(b.fields?.[ref[0]])}`],
      });
      continue;
    }
    scripts.push({ at: `${Math.round(b.x ?? 0)},${Math.round(b.y ?? 0)}`, chain: canonChain(blocks, id, new Set()) });
  }
  return scripts;
}

function isEmptyHidden(v) {
  if (v == null) return true;
  if (typeof v === 'string') return v === 'lit:';
  const values = Object.values(v.fields || {});
  return !!v.shadow && !v.inputs && values.length === 1 && values[0] === '';
}

function compareValue(a, b, where, out) {
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${where}: ${JSON.stringify(a)} became ${JSON.stringify(b)}`);
    return;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    out.push(`${where}: shape changed`);
    return;
  }
  if (Array.isArray(a)) {
    if (a.length !== b.length) out.push(`${where}: ${a.length} blocks became ${b.length}`);
    for (let i = 0; i < Math.min(a.length, b.length); i++) compareValue(a[i], b[i], `${where}[${i}]`, out);
    return;
  }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (k === 'hidden' && isEmptyHidden(a[k])) continue;
    compareValue(a[k], b[k], `${where}.${k}`, out);
  }
}

// Compares every script of every target, ignoring block ids. A hidden shadow that was empty or missing in the
// original may come back as the editor default; everything else (opcodes, fields, inputs, obscured shadows,
// mutations, positions) has to match.
export function compareProjects(original, rebuilt) {
  const problems = [];
  for (const target of original.targets || []) {
    const other = (rebuilt.targets || []).find((t) => t.name === target.name);
    if (!other) {
      problems.push(`${target.name}: target missing`);
      continue;
    }
    const left = scriptsOf(target);
    const right = scriptsOf(other);
    const rest = [...right];
    for (const script of left) {
      const opcode = script.chain[0]?.opcode ?? script.chain[0];
      let i = rest.findIndex((s) => s.at === script.at && JSON.stringify(s.chain) === JSON.stringify(script.chain));
      if (i < 0) i = rest.findIndex((s) => s.at === script.at && (s.chain[0]?.opcode ?? s.chain[0]) === opcode);
      if (i < 0) {
        problems.push(`${target.name}: script ${opcode} at ${script.at} is missing`);
        continue;
      }
      const diffs = [];
      compareValue(script.chain, rest[i].chain, `${target.name} ${opcode}@${script.at}`, diffs);
      problems.push(...diffs);
      rest.splice(i, 1);
    }
    for (const s of rest) problems.push(`${target.name}: extra script ${s.chain[0]?.opcode ?? s.chain[0]} at ${s.at}`);
  }
  return problems;
}
