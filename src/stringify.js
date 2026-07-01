import { LEGACY_FIELD_KEYS } from './parse.js';

let CTX = {};
export function setContext(c) { CTX = c || {}; }

const PREC = {
  '||': 1, '&&': 2,
  '==': 3, '!=': 3, '<': 3, '>': 3, '<=': 3, '>=': 3,
  '..': 4,
  '+': 5, '-': 5,
  '*': 6, '/': 6, '%': 6,
};
const UNARY_PREC = 7;
const ATOM_PREC = 100;

const REPARSABLE_NUMBER = /^-?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/;

export function stringifyBlockCall(block, subgraph, id, inline = false, cfg = {}) {
  const opcode = block.opcode;
  const jsonMode = cfg?.dsl?.json ?? 'minimal'; // 'none' | 'minimal' | 'full'

  if (opcode === 'procedures_call') {
    const code = block.mutation?.proccode;
    const info = code && CTX.procByCode?.get(code);
    if (info) {
      const args = info.params.map((p) => {
        const inp = block.inputs?.[p.id];
        const val = Array.isArray(inp) ? getInputExpr(inp, subgraph) : 'null';
        return `${p.ident}: ${val}`;
      });
      const call = `@${info.ident}(${args.join(', ')})`;
      return inline ? call : call + ';';
    }
  }

  if (opcode === 'data_variable') {
    const name = block.fields?.VARIABLE?.[0] ?? '';
    // A standalone top-level statement is a dangling orphan reporter with no
    // enclosing script to resolve an identifier against - print the exact
    // original name as a string literal so it round-trips byte-for-byte
    // instead of going through the (lossy, space-stripping) identifier form.
    if (!inline) return `${JSON.stringify(String(name))};`;
    const out = /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(name)) ? String(name) : JSON.stringify(String(name));
    return out;
  }
  if (opcode === 'argument_reporter_string_number' || opcode === 'argument_reporter_boolean') {
    const name = String(block.fields?.VALUE?.[0] ?? '');
    if (!inline) return `${JSON.stringify(name)};`;
    // Inline (referenced from inside a procedure body): must match the
    // identifier the enclosing def signature declared for this param (see
    // emit.js defSignature/procInfoFor and convert.js's dedup in
    // buildProcByCode) so the parser resolves it back to the same scope
    // param instead of a literal, or - when two params' names collide only
    // after cleanIdent (e.g. "X" and "+X") - the wrong param entirely.
    const mapped = CTX.scopeParamNames?.get(name);
    if (mapped) return mapped;
    // No declared param has this exact display name - Scratch allows a
    // custom block's body to keep referencing a param after it's been
    // removed from the definition (an orphaned/unbound reporter). Bare
    // identifier sugar can't distinguish that from a plain variable read,
    // so spell it out explicitly instead of guessing.
    return `arg(${JSON.stringify(name)})`;
  }

  if (opcode === 'control_if' || opcode === 'control_if_else') {
    const condTuple = block.inputs?.CONDITION;
    const condStr = Array.isArray(condTuple) ? getInputExpr(condTuple, subgraph) : 'null';
    const thenId = block.inputs?.SUBSTACK && Array.isArray(block.inputs.SUBSTACK) ? block.inputs.SUBSTACK[1] : null;
    const elseId = block.inputs?.SUBSTACK2 && Array.isArray(block.inputs.SUBSTACK2) ? block.inputs.SUBSTACK2[1] : null;
    const header = `if ${condStr}`;
    const thenBody = thenId ? renderBody(subgraph, thenId) : '';
    if (opcode === 'control_if_else') {
      const elseBody = elseId ? renderBody(subgraph, elseId) : '';
      return `${header} {\n${indent(thenBody)}\n} else {\n${indent(elseBody)}\n}`;
    }
    return `${header} {\n${indent(thenBody)}\n}`;
  }

  if (opcode === 'data_setvariableto') {
    const varName = block.fields?.VARIABLE?.[0] ?? '';
    const value = getInputExpr(block.inputs?.VALUE, subgraph);
    return `vars[${JSON.stringify(varName)}] = ${value};`;
  }
  if (opcode === 'data_changevariableby') {
    const varName = block.fields?.VARIABLE?.[0] ?? '';
    const value = getInputExpr(block.inputs?.VALUE, subgraph);
    return `vars[${JSON.stringify(varName)}] += ${value};`;
  }

  if (opcode === 'control_forever') {
    return `forever ${branch(block, 'SUBSTACK', subgraph)}`;
  }
  if (opcode === 'control_switch') {
    const v = Array.isArray(block.inputs?.VALUE) ? getInputExpr(block.inputs.VALUE, subgraph) : 'null';
    return `switch ${v} ${branch(block, 'SUBSTACK', subgraph)}`;
  }
  if (opcode === 'control_case') {
    const v = Array.isArray(block.inputs?.VALUE) ? getInputExpr(block.inputs.VALUE, subgraph) : 'null';
    return `case ${v} ${branch(block, 'SUBSTACK', subgraph)}`;
  }
  if (opcode === 'control_case_fallthrough') {
    const v = Array.isArray(block.inputs?.VALUE) ? getInputExpr(block.inputs.VALUE, subgraph) : 'null';
    return `case ${v} fallthrough ${branch(block, 'SUBSTACK', subgraph)}`;
  }
  if (opcode === 'control_default') {
    return `default ${branch(block, 'SUBSTACK', subgraph)}`;
  }
  if (opcode === 'control_repeat') {
    const n = getInputExpr(block.inputs?.TIMES, subgraph);
    return `repeat ${n} ${branch(block, 'SUBSTACK', subgraph)}`;
  }
  if (opcode === 'control_repeat_until') {
    const c = Array.isArray(block.inputs?.CONDITION) ? getInputExpr(block.inputs.CONDITION, subgraph) : 'null';
    return `until ${c} ${branch(block, 'SUBSTACK', subgraph)}`;
  }
  if (opcode === 'control_while') {
    const c = Array.isArray(block.inputs?.CONDITION) ? getInputExpr(block.inputs.CONDITION, subgraph) : 'null';
    return `while ${c} ${branch(block, 'SUBSTACK', subgraph)}`;
  }
  if (opcode === 'control_wait') {
    return `wait ${getInputExpr(block.inputs?.DURATION, subgraph)};`;
  }
  if (opcode === 'control_wait_until') {
    const c = Array.isArray(block.inputs?.CONDITION) ? getInputExpr(block.inputs.CONDITION, subgraph) : 'null';
    return `wait_until ${c};`;
  }
  if (opcode === 'control_stop') {
    const opt = block.fields?.STOP_OPTION?.[0] ?? 'all';
    return `stop ${JSON.stringify(opt)};`;
  }
  if (opcode === 'procedures_return' || opcode === 'control_return') {
    const v = block.inputs?.VALUE ? getInputExpr(block.inputs.VALUE, subgraph) : '';
    return `return${v ? ' ' + v : ''};`;
  }
  if (opcode === 'event_broadcast' || opcode === 'event_broadcastandwait') {
    const tuple = block.inputs?.BROADCAST_INPUT;
    const childId = Array.isArray(tuple) ? tuple[1] : null;
    // A literal broadcast name reference doesn't need the broadcast() wrapper
    // here - the statement keyword already says "this is a broadcast".
    const name =
      typeof childId === 'string' && subgraph[childId]
        ? getInputExpr(tuple, subgraph)
        : JSON.stringify(Array.isArray(childId) ? String(childId[1] ?? '') : '');
    const w = opcode === 'event_broadcastandwait' ? 'broadcast_wait' : 'broadcast';
    return `${w} ${name};`;
  }

  const opExpr = tryOperatorInfo(block, subgraph);
  if (opExpr) {
    return inline ? opExpr.text : opExpr.text + ';';
  }

  const inputsStr = stringifyInputs(block, subgraph, /*cLike*/ true);
  const fieldsStr = stringifyFields(block);
  const argParts = [];
  if (inputsStr) argParts.push(inputsStr);
  if (fieldsStr) argParts.push(fieldsStr);
  // Any block reaching this generic fallback that carries a mutation (custom
  // extension quirks, or a procedures_call whose prototype couldn't be
  // resolved to a friendly @name) needs it captured or the mutation is lost
  // outright - dump it as a JSON field, decoded back in buildNode.
  if (block.mutation) {
    argParts.push(`mutation: ${JSON.stringify(block.mutation)}`);
  }
  const call = `${formatOpcodeName(opcode)}(${argParts.join(', ')})`;

  // Extension "C-block" opcodes (custom blocks with a body slot) that aren't
  // one of the hardcoded control-flow keywords above still need their
  // SUBSTACK/SUBSTACK2 bodies represented, or the branch is silently lost.
  const substackKeys = Object.keys(block.inputs || {})
    .filter((k) => k.startsWith('SUBSTACK'))
    .sort();
  if (substackKeys.length) {
    const branches = substackKeys.map((k) => `${branch(block, k, subgraph)}`).join(' ');
    return `${call} ${branches}`;
  }
  return inline ? call : call + ';';
}

function getInputExpr(arr, subgraph) {
  return getInputExprInfo(arr, subgraph).text;
}

function getInputExprInfo(arr, subgraph) {
  if (!Array.isArray(arr) || arr.length < 2) return { text: 'null', prec: ATOM_PREC };
  const payload = arr[1];
  if (typeof payload === 'string' && subgraph[payload]) {
    return blockExprInfo(subgraph[payload], subgraph, payload);
  }
  return { text: formatLiteral(arr), prec: ATOM_PREC };
}

function blockExprInfo(block, subgraph, id) {
  const op = tryOperatorInfo(block, subgraph);
  if (op) return op;
  return { text: stringifyBlockCall(block, subgraph, id, /*inline*/ true), prec: ATOM_PREC };
}

export function stringifyInputs(block, subgraph, cLike = false) {
  if (!block.inputs) return '';
  const args = [];
  for (const [name, val] of Object.entries(block.inputs)) {
    if (name.startsWith('SUBSTACK')) continue; // handled as branch

    const arr = val;
    if (!Array.isArray(arr) || arr.length < 2) {
      args.push(`${formatArgKey(name)}: null`);
      continue;
    }
    const childId = arr[1];

    if (typeof childId === 'string' && subgraph[childId]) {
      const nested = stringifyBlockCall(subgraph[childId], subgraph, childId, /*inline*/ true);
      args.push(`${formatArgKey(name)}: ${nested}`);
    } else {
      args.push(`${formatArgKey(name)}: ${formatLiteral(arr)}`);
    }
  }
  return args.join(', ');
}

function refCall(kind, name, id, map) {
  const needsId = id != null && !(map && map.get(name) === id);
  return needsId ? `${kind}(${JSON.stringify(name)}, ${JSON.stringify(id)})` : `${kind}(${JSON.stringify(name)})`;
}

export function stringifyFields(block) {
  if (!block.fields) return '';
  const kv = Object.entries(block.fields).map(([k, v]) => {
    try {
      const keyLc = String(k).toLowerCase();

      if (Array.isArray(v) && v.length >= 1 && typeof v[0] === 'string') {
        const name = v[0];
        const id = v.length > 1 ? v[1] : undefined;
        if (keyLc.includes('variable')) {
          const prefix = k === 'VARIABLE' ? '' : 'field ';
          return `${prefix}${formatArgKey(k)}: ${refCall('var', name, id, CTX.varMap)}`;
        }
        if (keyLc.includes('list') || keyLc === 'list') {
          const prefix = k === 'LIST' ? '' : 'field ';
          return `${prefix}${formatArgKey(k)}: ${refCall('list', name, id, CTX.listMap)}`;
        }
        if (keyLc.includes('broadcast')) {
          const prefix = k === 'BROADCAST_OPTION' ? '' : 'field ';
          return `${prefix}${formatArgKey(k)}: ${refCall('broadcast', name, id, CTX.broadcastNameToId)}`;
        }
        if (v.length <= 2 && (v.length === 1 || v[1] == null)) {
          return `field ${formatArgKey(k)}: ${JSON.stringify(name)}`;
        }
      }
      return `field ${formatArgKey(k)}: ${JSON.stringify(v)}`;
    } catch {
      return `field ${formatArgKey(k)}: ${JSON.stringify(String(v))}`;
    }
  });
  return kv.join(', ');
}

// Walks a `.next` chain, stopping either at a clean end (cursor falsy) or at
// a *dangling* reference: a non-null id that isn't a real node anywhere in
// the subgraph. The latter happens with corrupted/hand-edited project.json
// files that leave forward references to blocks that were never (or no
// longer) actually serialized - rare, but real ones exist in the wild, and
// silently truncating the chain there would lose that reference for good.
function linearizeWithIds(subgraph, topId) {
  const arr = [];
  let cursor = topId;
  while (cursor) {
    const node = subgraph[cursor];
    if (!node) return { ids: arr, danglingId: cursor };
    arr.push(cursor);
    cursor = node.next;
  }
  return { ids: arr, danglingId: null };
}

// Renders a full `.next` chain as DSL statement text, appending a
// `dangling_next("id")` sentinel when the chain ends in an unresolvable
// forward reference instead of silently dropping it (see linearizeWithIds).
export function renderBody(subgraph, topId, cfg) {
  const { ids, danglingId } = linearizeWithIds(subgraph, topId);
  const lines = ids.map((cid) => stringifyBlockCall(subgraph[cid], subgraph, cid, false, cfg));
  if (danglingId) lines.push(`dangling_next(${JSON.stringify(danglingId)});`);
  return lines.join('\n');
}

function indent(str, spaces = 2) {
  if (!str) return '';
  return str
    .split('\n')
    .map((l) => (l ? ' '.repeat(spaces) + l : l))
    .join('\n');
}

function branch(block, key, subgraph) {
  const arr = block.inputs?.[key];
  const bid = Array.isArray(arr) ? arr[1] : null;
  const body = bid ? renderBody(subgraph, bid) : '';
  return `{\n${indent(body)}\n}`;
}

// Preserve key case exactly: Scratch's own built-in keys are ALL_CAPS (fine
// either way), but custom-block/extension argument ids are often
// lowercase/mixed-case random strings where case is semantically load-bearing
// (must match verbatim between a block's inputs and its own mutation). Only
// bracket+JSON-quote keys that aren't valid bare identifiers at all.
function formatArgKey(name) {
  try {
    const s = String(name);
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) return s;
    return `[${JSON.stringify(s)}]`;
  } catch {
    return `[${JSON.stringify(String(name))}]`;
  }
}

function formatOpcodeName(opcode) {
  const s = String(opcode || '');
  const m = /^([A-Za-z][A-Za-z0-9]*)_(.+)$/.exec(s);
  if (!m) return s;
  const [, namespace, rest] = m;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(rest)) return s;
  return `${namespace}.${rest}`;
}

function formatLiteral(arr) {
  try {
    if (!Array.isArray(arr) || arr.length < 2) return ``;
    const payload = arr[1];

    if (Array.isArray(payload) && payload.length >= 1) {
      const typeCode = payload[0];
      const value = payload[1];
      switch (typeCode) {
        case 10: {
          // string/text - Scratch types most literal slots as text even when
          // the content is a number ("0" in a comparison). Print numeric text
          // bare when the number grammar re-reads the exact same characters;
          // the type code (10 vs 4) is an editor-widget hint with no runtime
          // meaning, and the payload text round-trips verbatim either way.
          const raw = String(value ?? '');
          if (raw !== '' && REPARSABLE_NUMBER.test(raw)) return raw;
          return `${JSON.stringify(raw)}`;
        }
        case 4: // number (as string)
        case 6: // angle/number
        case 7: {
          // list index / numeric - Scratch stores these as free-form text
          // (".25", "007", "", ...), so print the original text verbatim
          // whenever our number grammar can re-parse it exactly, rather
          // than normalizing through Number->String and rewriting it.
          const raw = value == null ? '' : String(value);
          if (raw === '') return '""'; // unfilled default; not "0"
          if (REPARSABLE_NUMBER.test(raw)) return raw;

          const n = Number(raw);
          if (Number.isFinite(n)) return `${String(n)}`;
          return `${JSON.stringify(raw)}`;
        }
        case 11: {
          // broadcast name reference
          const name = String(value ?? '');
          const id = payload.length > 2 ? String(payload[2]) : undefined;
          return refCall('broadcast', name, id, CTX.broadcastNameToId);
        }
        case 12: {
          // variable/parameter reference label -> print as bare identifier when safe
          const name = String(value ?? '');
          if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return name;
          return `vars[${JSON.stringify(name)}]`;
        }
        case 13: {
          // list reference
          const name = String(value ?? '');
          const id = payload.length > 2 ? String(payload[2]) : undefined;
          return refCall('list', name, id, CTX.listMap);
        }
        default: {
          const compact = value != null ? JSON.stringify(value) : 'null';
          return `${compact}`;
        }
      }
    }

    if (typeof payload === 'string') {
      const n = Number(payload);
      if (Number.isFinite(n)) return `${String(n)}`;
      return `${JSON.stringify(payload)}`;
    }
    if (typeof payload === 'number' || typeof payload === 'boolean') {
      return `${String(payload)}`;
    }
  } catch {
    // Handle error
  }
  return ``;
}

const NEGATED_CMP = { operator_equals: '!=', operator_gt: '<=', operator_lt: '>=' };

function tryOperatorInfo(block, subgraph) {
  const op = block?.opcode;
  if (typeof op !== 'string' || !op.startsWith('operator_')) return null;
  const input = (k, alt) => block.inputs?.[k] ?? (alt ? block.inputs?.[alt] : undefined) ?? [3, [10, '']];
  const bin = (sym, k1, k2, a1, a2) =>
    binaryInfo(sym, getInputExprInfo(input(k1, a1), subgraph), getInputExprInfo(input(k2, a2), subgraph));
  switch (op) {
    case 'operator_add':
      return bin('+', 'NUM1', 'NUM2');
    case 'operator_subtract':
      return bin('-', 'NUM1', 'NUM2');
    case 'operator_multiply':
      return bin('*', 'NUM1', 'NUM2');
    case 'operator_divide':
      return bin('/', 'NUM1', 'NUM2');
    case 'operator_mod':
      return bin('%', 'NUM1', 'NUM2');
    case 'operator_round':
      return { text: `round(${getInputExpr(input('NUM'), subgraph)})`, prec: ATOM_PREC };
    case 'operator_mathop': {
      const raw = (block.fields?.OPERATOR?.[0] || 'abs').toLowerCase();
      const fn = raw === 'e ^' ? 'exp' : raw === '10 ^' ? 'exp10' : raw;
      return { text: `${fn}(${getInputExpr(input('NUM'), subgraph)})`, prec: ATOM_PREC };
    }
    case 'operator_join':
      return bin('..', 'STRING1', 'STRING2');
    case 'operator_equals':
      return bin('==', 'OPERAND1', 'OPERAND2', 'NUM1', 'NUM2');
    case 'operator_lt':
      return bin('<', 'OPERAND1', 'OPERAND2', 'NUM1', 'NUM2');
    case 'operator_gt':
      return bin('>', 'OPERAND1', 'OPERAND2', 'NUM1', 'NUM2');
    case 'operator_and':
      return bin('&&', 'OPERAND1', 'OPERAND2');
    case 'operator_or':
      return bin('||', 'OPERAND1', 'OPERAND2');
    case 'operator_not':
      return notInfo(block, subgraph);
    default:
      return null;
  }
}

function binaryInfo(sym, L, R) {
  const p = PREC[sym];
  const lt = L.prec < p ? `(${L.text})` : L.text;
  const rt = R.prec <= p ? `(${R.text})` : R.text;
  return { text: `${lt} ${sym} ${rt}`, prec: p };
}

function notInfo(block, subgraph) {
  const tuple = block.inputs?.OPERAND;
  const childId = Array.isArray(tuple) ? tuple[1] : null;
  const child = typeof childId === 'string' ? subgraph[childId] : null;
  if (child && NEGATED_CMP[child.opcode]) {
    const input = (k, alt) => child.inputs?.[k] ?? child.inputs?.[alt] ?? [3, [10, '']];
    return binaryInfo(
      NEGATED_CMP[child.opcode],
      getInputExprInfo(input('OPERAND1', 'NUM1'), subgraph),
      getInputExprInfo(input('OPERAND2', 'NUM2'), subgraph)
    );
  }
  const inner = Array.isArray(tuple) ? getInputExprInfo(tuple, subgraph) : { text: '""', prec: ATOM_PREC };
  const it = inner.prec < UNARY_PREC ? `(${inner.text})` : inner.text;
  return { text: `!${it}`, prec: UNARY_PREC };
}
