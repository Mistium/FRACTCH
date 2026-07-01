let CTX = {};
export function setContext(c) { CTX = c || {}; }

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
        return `${p.ident}= ${val}`;
      });
      const call = `@${info.ident}(${args.join(', ')})`;
      return inline ? call : call + ';';
    }
  }

  if (opcode === 'data_variable') {
    const name = block.fields?.VARIABLE?.[0] ?? '';
    const out = /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(name)) ? String(name) : JSON.stringify(String(name));
    return inline ? out : out + ';';
  }
  if (opcode === 'argument_reporter_string_number' || opcode === 'argument_reporter_boolean') {
    const name = block.fields?.VALUE?.[0] ?? '';
    const out = /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(name)) ? String(name) : JSON.stringify(String(name));
    return inline ? out : out + ';';
  }

  if (opcode === 'control_if' || opcode === 'control_if_else') {
    const condTuple = block.inputs?.CONDITION;
    const condStr = Array.isArray(condTuple) ? getInputExpr(condTuple, subgraph) : 'null';
    const thenId = block.inputs?.SUBSTACK && Array.isArray(block.inputs.SUBSTACK) ? block.inputs.SUBSTACK[1] : null;
    const elseId = block.inputs?.SUBSTACK2 && Array.isArray(block.inputs.SUBSTACK2) ? block.inputs.SUBSTACK2[1] : null;
    const header = `if ${condStr}`;
    const thenBody = thenId
      ? linearizeWithIds(subgraph, thenId)
          .map((cid) => stringifyBlockCall(subgraph[cid], subgraph, cid))
          .join('\n')
      : '';
    if (opcode === 'control_if_else') {
      const elseBody = elseId
        ? linearizeWithIds(subgraph, elseId)
            .map((cid) => stringifyBlockCall(subgraph[cid], subgraph, cid))
            .join('\n')
        : '';
      return `${header} {\n${indent(thenBody)}\n} else {\n${indent(elseBody)}\n}`;
    }
    return `${header} {\n${indent(thenBody)}\n}`;
  }

  if (opcode === 'data_setvariableto') {
    const varName = block.fields?.VARIABLE?.[0] ?? '';
    const value = getInputExpr(block.inputs?.VALUE, subgraph);
    return `vars[${JSON.stringify(varName)}] = ${value};`;
  }

  if (opcode === 'control_forever') {
    return `forever ${branch(block, 'SUBSTACK', subgraph)}`;
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
    const name = getInputExpr(block.inputs?.BROADCAST_INPUT, subgraph);
    const w = opcode === 'event_broadcastandwait' ? 'broadcast_wait' : 'broadcast';
    return `${w} ${name};`;
  }

  if (opcode === 'mistsutils_patchreporter' || opcode === 'mistsutils_patchcommand') {
    const code = getInputExpr(block.inputs?.a ?? block.inputs?.A, subgraph);
    return inline ? `js(${code})` : `js ${code};`;
  }

  const opExpr = tryOperatorExpression(block, subgraph);
  if (opExpr) {
    return inline ? opExpr : opExpr + ';';
  }

  const inputsStr = stringifyInputs(block, subgraph, /*cLike*/ true);
  const fieldsStr = stringifyFields(block);
  const argParts = [];
  if (inputsStr) argParts.push(inputsStr);
  if (fieldsStr) argParts.push(fieldsStr);
  const call = `${opcode}(${argParts.join(', ')})`;
  return inline ? call : call + ';';
}

function getInputExpr(arr, subgraph) {
  if (!Array.isArray(arr) || arr.length < 2) return 'null';
  const payload = arr[1];
  if (typeof payload === 'string' && subgraph[payload]) {
    return stringifyBlockCall(subgraph[payload], subgraph, payload, /*inline*/ true);
  }
  return formatLiteral(arr);
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
      args.push(`${formatArgKey(name)}${cLike ? '=' : ':'} ${nested}`);
    } else {
      args.push(`${formatArgKey(name)}${cLike ? '=' : ':'} ${formatLiteral(arr)}`);
    }
  }
  return args.join(', ');
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
          return `${formatArgKey(k)}: ${id ? `var(${JSON.stringify(name)}, ${JSON.stringify(id)})` : `var(${JSON.stringify(name)})`}`;
        }
        if (keyLc.includes('list') || keyLc === 'list') {
          return `${formatArgKey(k)}: ${id ? `list(${JSON.stringify(name)}, ${JSON.stringify(id)})` : `list(${JSON.stringify(name)})`}`;
        }
      }
      return `${formatArgKey(k)}: ${JSON.stringify(v)}`;
    } catch {
      return `${formatArgKey(k)}: ${JSON.stringify(String(v))}`;
    }
  });
  return kv.join(', ');
}

function linearizeWithIds(subgraph, topId) {
  const arr = [];
  let cursor = topId;
  while (cursor) {
    const node = subgraph[cursor];
    if (!node) break;
    arr.push(cursor);
    cursor = node.next;
  }
  return arr;
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
  const body = bid
    ? linearizeWithIds(subgraph, bid)
        .map((cid) => stringifyBlockCall(subgraph[cid], subgraph, cid))
        .join('\n')
    : '';
  return `{\n${indent(body)}\n}`;
}

function formatArgKey(name) {
  try {
    const s = String(name);

    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) {
      return s.toLowerCase();
    }
    return `[${JSON.stringify(s)}]`;
  } catch {
    return `[${JSON.stringify(String(name))}]`;
  }
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
          return `${JSON.stringify(String(value ?? ''))}`;
        }
        case 4: // number (as string)
        case 6: // angle/number
        case 7: {
          // list index / numeric
          const n = Number(value);
          if (Number.isFinite(n)) return `${String(n)}`;

          return `${JSON.stringify(String(value ?? ''))}`;
        }
        case 11: {
          // broadcast name
          return `${JSON.stringify(String(value ?? ''))}`;
        }
        case 12: {
          // variable/parameter reference label -> print as bare identifier when safe
          const name = String(value ?? '');
          if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return name;
          return `vars[${JSON.stringify(name)}]`;
        }
        case 13: {
          // list reference (keep as list(name) for now)
          const name = String(value ?? '');
          const id = payload.length > 2 ? String(payload[2]) : undefined;
          return id ? `list(${JSON.stringify(name)}, ${JSON.stringify(id)})` : `list(${JSON.stringify(name)})`;
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

function tryOperatorExpression(block, subgraph) {
  const op = block?.opcode;
  if (typeof op !== 'string' || !op.startsWith('operator_')) return null;
  const read = (k, alt) =>
    getInputExpr(block.inputs?.[k] ?? (alt ? block.inputs?.[alt] : undefined) ?? [3, [10, '']], subgraph);
  switch (op) {
    case 'operator_add':
      return `(${read('NUM1')} + ${read('NUM2')})`;
    case 'operator_subtract':
      return `(${read('NUM1')} - ${read('NUM2')})`;
    case 'operator_multiply':
      return `(${read('NUM1')} * ${read('NUM2')})`;
    case 'operator_divide':
      return `(${read('NUM1')} / ${read('NUM2')})`;
    case 'operator_mod':
      return `(${read('NUM1')} % ${read('NUM2')})`;
    case 'operator_round':
      return `round(${read('NUM')})`;
    case 'operator_mathop': {
      const fn = (block.fields?.OPERATOR?.[0] || 'abs').toLowerCase();
      return `${fn}(${read('NUM')})`;
    }
    case 'operator_join':
      return `(${read('STRING1')} + ${read('STRING2')})`;

    case 'operator_equals':
      return `(${read('OPERAND1', 'NUM1')} == ${read('OPERAND2', 'NUM2')})`;
    case 'operator_lt':
      return `(${read('OPERAND1', 'NUM1')} < ${read('OPERAND2', 'NUM2')})`;
    case 'operator_gt':
      return `(${read('OPERAND1', 'NUM1')} > ${read('OPERAND2', 'NUM2')})`;

    case 'operator_and':
      return `(${read('OPERAND1')} && ${read('OPERAND2')})`;
    case 'operator_or':
      return `(${read('OPERAND1')} || ${read('OPERAND2')})`;
    case 'operator_not':
      return `not(${read('OPERAND')})`;
    default:
      return null;
  }
}
