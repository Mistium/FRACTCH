import { LEGACY_FIELD_KEYS, STATEMENT_KEYWORDS } from './parse.js';

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

const BARE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED_WORDS = new Set(['true', 'false', 'null', 'shadow', 'var', 'list', 'broadcast', 'arg', 'vars', 'menu', 'at', 'for', 'fallthrough', 'else', 'import', 'field', 'warp', 'color', 'returns', 'not', 'round']);

function bareNameOk(name) {
  return BARE_NAME.test(name) && !RESERVED_WORDS.has(name) && !STATEMENT_KEYWORDS.has(name);
}

const SIMPLE_ALIAS_EMIT = {
  looks_show: 'show', looks_hide: 'hide',
  looks_nextcostume: 'next_costume', looks_nextbackdrop: 'next_backdrop',
  control_delete_this_clone: 'delete_clone', sensing_resettimer: 'reset_timer',
  pen_penUp: 'pen_up', pen_penDown: 'pen_down', pen_clear: 'pen_clear', pen_stamp: 'stamp',
};

const UNARY_ALIAS_EMIT = {
  looks_say: ['say', 'MESSAGE'], looks_think: ['think', 'MESSAGE'],
  sensing_askandwait: ['ask', 'QUESTION'],
  motion_movesteps: ['move', 'STEPS'],
  motion_turnright: ['turn', 'DEGREES'], motion_turnleft: ['turn_left', 'DEGREES'],
  motion_pointindirection: ['point', 'DIRECTION'],
  motion_setx: ['set_x', 'X'], motion_sety: ['set_y', 'Y'],
  motion_changexby: ['change_x', 'DX'], motion_changeyby: ['change_y', 'DY'],
  looks_setsizeto: ['set_size', 'SIZE'], looks_changesizeby: ['change_size', 'CHANGE'],
};

const MENU_ALIAS_EMIT = {
  looks_switchcostumeto: ['costume', 'COSTUME', 'looks_costume'],
  looks_switchbackdropto: ['backdrop', 'BACKDROP', 'looks_backdrops'],
  control_create_clone_of: ['clone', 'CLONE_OPTION', 'control_create_clone_of_menu'],
};

const LIST_STMT_EMIT = {
  data_addtolist: ['add', ['ITEM']],
  data_deleteoflist: ['delete', ['INDEX']],
  data_deletealloflist: ['clear', []],
  data_insertatlist: ['insert', ['INDEX', 'ITEM']],
  data_replaceitemoflist: ['replace', ['INDEX', 'ITEM']],
  data_showlist: ['show', []],
  data_hidelist: ['hide', []],
};

export function stringifyBlockCall(block, subgraph, id, inline = false, cfg = {}) {
  const opcode = block.opcode;
  const jsonMode = cfg?.dsl?.json ?? 'minimal'; // 'none' | 'minimal' | 'full'

  if (opcode === 'procedures_call') {
    const code = block.mutation?.proccode;
    const info = code && CTX.procByCode?.get(code);
    if (info) {
      const args = info.params.map((p) => {
        const inp = block.inputs?.[p.id];
        const val = Array.isArray(inp) ? inputValueText(inp, subgraph, p.id) : 'null';
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

  if (opcode === 'data_setvariableto' || opcode === 'data_changevariableby') {
    const varName = String(block.fields?.VARIABLE?.[0] ?? '');
    const value = inputValueText(block.inputs?.VALUE, subgraph, 'VALUE');
    const op = opcode === 'data_changevariableby' ? '+=' : '=';
    if (bareNameOk(varName)) return `${varName} ${op} ${value};`;
    return `vars[${JSON.stringify(varName)}] ${op} ${value};`;
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
    const bare = { all: 'all', 'this script': 'this_script', 'other scripts in sprite': 'other_scripts_in_sprite' }[opt];
    return `stop ${bare ?? JSON.stringify(opt)};`;
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
    let name;
    if (typeof childId === 'string' && subgraph[childId]) {
      name = inputValueText(tuple, subgraph, 'BROADCAST_INPUT');
    } else {
      const raw = Array.isArray(childId) ? String(childId[1] ?? '') : '';
      name = BARE_NAME.test(raw) && !RESERVED_WORDS.has(raw) ? raw : JSON.stringify(raw);
    }
    const w = opcode === 'event_broadcastandwait' ? 'broadcast_wait' : 'broadcast';
    return `${w} ${name};`;
  }

  if (!inline) {
    const alias = tryStatementAlias(block, subgraph);
    if (alias) return alias;
  }

  const opExpr = tryOperatorInfo(block, subgraph);
  if (opExpr) {
    return inline ? opExpr.text : opExpr.text + ';';
  }

  const listExpr = tryListExpr(block, subgraph);
  if (listExpr) {
    return inline ? listExpr.text : listExpr.text + ';';
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
  const le = tryListExpr(block, subgraph);
  if (le) return le;
  return { text: stringifyBlockCall(block, subgraph, id, /*inline*/ true), prec: ATOM_PREC };
}

function listFieldName(block) {
  const fields = block.fields || {};
  const keys = Object.keys(fields);
  if (keys.length !== 1 || keys[0] !== 'LIST') return null;
  const v = fields.LIST;
  if (!Array.isArray(v) || typeof v[0] !== 'string') return null;
  const id = v.length > 1 ? v[1] : undefined;
  if (id != null && !(CTX.listMap && CTX.listMap.get(v[0]) === id)) return null;
  return v[0];
}

function listRefText(name) {
  return `lists[${JSON.stringify(name)}]`;
}

function tryListExpr(block, subgraph) {
  const op = block?.opcode;
  if (block?.mutation) return null;
  const name = op && op.startsWith('data_') ? listFieldName(block) : null;
  if (name == null) return null;
  const inputKeys = Object.keys(block.inputs || {});
  const one = (k) => inputKeys.length === 1 && inputKeys[0] === k;
  if (op === 'data_itemoflist' && one('INDEX')) {
    return { text: `${listRefText(name)}[${inputValueText(block.inputs.INDEX, subgraph, 'INDEX')}]`, prec: ATOM_PREC };
  }
  if (op === 'data_lengthoflist' && inputKeys.length === 0) {
    return { text: `${listRefText(name)}.length`, prec: ATOM_PREC };
  }
  if (op === 'data_listcontainsitem' && one('ITEM')) {
    return { text: `${listRefText(name)}.contains(${inputValueText(block.inputs.ITEM, subgraph, 'ITEM')})`, prec: ATOM_PREC };
  }
  if (op === 'data_itemnumoflist' && one('ITEM')) {
    return { text: `${listRefText(name)}.indexof(${inputValueText(block.inputs.ITEM, subgraph, 'ITEM')})`, prec: ATOM_PREC };
  }
  return null;
}

function tryStatementAlias(block, subgraph) {
  const op = String(block.opcode || '');
  if (block.mutation) return null;
  const fields = block.fields || {};
  const inputs = block.inputs || {};
  const fieldKeys = Object.keys(fields);
  const inputKeys = Object.keys(inputs);
  const exactInputs = (...keys) => inputKeys.length === keys.length && keys.every((k) => k in inputs);

  if (SIMPLE_ALIAS_EMIT[op] && !fieldKeys.length && !inputKeys.length) {
    return `${SIMPLE_ALIAS_EMIT[op]};`;
  }
  if (UNARY_ALIAS_EMIT[op]) {
    const [kw, key] = UNARY_ALIAS_EMIT[op];
    if (!fieldKeys.length && exactInputs(key)) {
      return `${kw} ${inputValueText(inputs[key], subgraph, key)};`;
    }
  }
  if ((op === 'looks_sayforsecs' || op === 'looks_thinkforsecs') && !fieldKeys.length && exactInputs('MESSAGE', 'SECS')) {
    const kw = op === 'looks_sayforsecs' ? 'say' : 'think';
    return `${kw} ${inputValueText(inputs.MESSAGE, subgraph, 'MESSAGE')} for ${inputValueText(inputs.SECS, subgraph, 'SECS')};`;
  }
  if (op === 'motion_gotoxy' && !fieldKeys.length && exactInputs('X', 'Y')) {
    return `goto ${inputValueText(inputs.X, subgraph, 'X')}, ${inputValueText(inputs.Y, subgraph, 'Y')};`;
  }
  if (MENU_ALIAS_EMIT[op] && !fieldKeys.length) {
    const [kw, key, menuOpcode] = MENU_ALIAS_EMIT[op];
    if (exactInputs(key)) {
      const arr = inputs[key];
      const childId = Array.isArray(arr) ? arr[1] : null;
      const child = typeof childId === 'string' ? subgraph[childId] : null;
      if (child && child.shadow && child.opcode === menuOpcode) {
        const mf = child.fields || {};
        const mk = Object.keys(mf);
        if (!Object.keys(child.inputs || {}).length && mk.length === 1 && mk[0] === key && typeof mf[key][0] === 'string' && (mf[key].length === 1 || mf[key][1] == null)) {
          const value = mf[key][0];
          if (kw === 'clone' && value === '_myself_') return 'clone;';
          return `${kw} ${JSON.stringify(value)};`;
        }
        return null;
      }
      if (child && !child.shadow) {
        return `${kw} ${inputValueText(arr, subgraph, key)};`;
      }
    }
    return null;
  }
  if (LIST_STMT_EMIT[op]) {
    const name = listFieldName(block);
    if (name == null) return null;
    const [method, keys] = LIST_STMT_EMIT[op];
    if (!exactInputs(...keys)) return null;
    const args = keys.map((k) => inputValueText(inputs[k], subgraph, k)).join(', ');
    return `${listRefText(name)}.${method}(${args});`;
  }
  return null;
}

function shadowBlockText(block, subgraph, id, inputName) {
  const op = String(block.opcode || '');
  if (op === 'argument_reporter_string_number' || op === 'argument_reporter_boolean') {
    return stringifyBlockCall(block, subgraph, id, /*inline*/ true);
  }
  const fields = block.fields || {};
  const keys = Object.keys(fields);
  const hasInputs = Object.keys(block.inputs || {}).length > 0;
  if (!hasInputs && keys.length === 1 && keys[0] === inputName && !block.mutation) {
    const v = fields[keys[0]];
    if (Array.isArray(v) && typeof v[0] === 'string' && (v.length === 1 || v[1] == null)) {
      return `${formatOpcodeName(op)}(${JSON.stringify(v[0])})`;
    }
  }
  return `shadow ${stringifyBlockCall(block, subgraph, id, /*inline*/ true)}`;
}

export function inputValueText(arr, subgraph, inputName) {
  if (!Array.isArray(arr) || arr.length < 2) return 'null';
  const childId = arr[1];
  const child = typeof childId === 'string' ? subgraph[childId] : null;
  if (child && child.shadow) {
    return shadowBlockText(child, subgraph, childId, inputName);
  }
  const active = getInputExpr(arr, subgraph);
  const sh = arr.length > 2 ? arr[2] : null;
  if (sh != null) {
    if (typeof sh === 'string' && subgraph[sh]) {
      return `${active} ?? ${shadowBlockText(subgraph[sh], subgraph, sh, inputName)}`;
    }
    if (Array.isArray(sh) && sh[0] === 11) {
      return `${active} ?? ${formatLiteral([1, sh])}`;
    }
  }
  return active;
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
    args.push(`${formatArgKey(name)}: ${inputValueText(arr, subgraph, name)}`);
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
          // string/text
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
          if (bareNameOk(name)) return name;
          return `vars[${JSON.stringify(name)}]`;
        }
        case 13: {
          // list reference
          const name = String(value ?? '');
          const id = payload.length > 2 ? String(payload[2]) : undefined;
          if (id == null || (CTX.listMap && CTX.listMap.get(name) === id)) return listRefText(name);
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
