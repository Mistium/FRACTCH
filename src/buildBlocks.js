import { STDLIB_METHODS } from './stdlib/index.js';
import { BUILTIN_SIGNATURES } from './signatures.js';
import { impliedShadow, shadowSpec } from './shadowDefaults.js';

export function buildBlocksFromCalls(calls, opts = {}) {
  const { hatOpcode, idGen, nested = false, ...ctx } = opts;
  const ids = idGen || new IdGen();

  const procDefs = calls.filter((c) => c.type === 'procDef');
  if (procDefs.length === 1 && calls.every((c) => c.type === 'procDef' || c.type === 'commentDecl')) {
    const result = buildProcDefScript(procDefs[0], ids, ctx);
    if (ctx.commentsOut) {
      for (const c of calls) {
        if (c.type === 'commentDecl') ctx.commentsOut.push({ ...c, blockId: c.forId || result.topId });
      }
    }
    return result;
  }

  if (calls.length === 1 && calls[0].type === 'danglingNext') {
    return { topId: calls[0].id, blocks: {} };
  }

  const blocks = {};
  let lastId = null;
  let topId = null;

  const pendingTopComments = [];
  const pendingNextComments = [];
  for (let idx = 0; idx < calls.length; idx++) {
    const call = calls[idx];
    if (call.type === 'commentDecl') {
      if (ctx.commentsOut) {
        if (call.anchor === 'next' && !call.forId) {
          pendingNextComments.push({ ...call, blockId: null });
        } else {
          const entry = { ...call, blockId: call.forId || lastId };
          ctx.commentsOut.push(entry);
          if (!entry.blockId) pendingTopComments.push(entry);
        }
      }
      continue;
    }
    if (call.type === 'importDecl') continue;
    if (call.type === 'danglingNext') {
      if (lastId) blocks[lastId].next = call.id;
      else topId = call.id;
      break;
    }

    const id = ids.next();
    const isFirst = topId == null;
    if (isFirst) topId = id;
    const loose =
      !!call.asExpression && isFirst && !nested && calls.slice(idx + 1).every((c) => c.type === 'commentDecl');
    const node = buildNode(expandListIteration(call, ctx), ids, blocks, { ...ctx, asExpression: loose }, id);
    if (isFirst && !nested) {
      node.topLevel = true;
      node.parent = null;
      node.x = 0;
      node.y = 0;
      if (hatOpcode) {
        if (hatOpcode === 'data_variable' && node.fields && 'VALUE' in node.fields) {
          const [name] = node.fields.VALUE;
          node.fields = { VARIABLE: [name, (ctx?.varMap && ctx.varMap.get(name)) || null] };
        }
        node.opcode = hatOpcode;
      }
    }
    if (node.opcode === 'control_stop' && !node.mutation) {
      const opt = node.fields?.STOP_OPTION?.[0];
      node.mutation = { tagName: 'mutation', children: [], hasnext: String(opt === 'other scripts in sprite') };
    }
    if (lastId) {
      blocks[lastId].next = id;
      if (blocks[lastId].opcode === 'control_stop') blocks[lastId].mutation.hasnext = 'true';
    }
    blocks[id] = { id, ...node };
    if (lastId) blocks[id].parent = lastId;
    lastId = id;
    if (pendingNextComments.length && ctx.commentsOut) {
      for (const entry of pendingNextComments) {
        entry.blockId = id;
        ctx.commentsOut.push(entry);
      }
      pendingNextComments.length = 0;
    }
  }

  for (const entry of pendingTopComments) entry.blockId = topId;
  for (const entry of pendingNextComments) {
    if (ctx.commentsOut) {
      entry.blockId = lastId || topId || null;
      ctx.commentsOut.push(entry);
    }
  }

  return { topId, blocks };
}

function expandListIteration(call, ctx) {
  const spec = call?.listIteration;
  if (!spec || (!spec.forced && !ctx.listMap?.has(spec.listName))) return call;
  const field = (key, name, type) => ({
    kind: 'keyed',
    sep: 'field',
    key,
    value: { type, name, id: null },
  });
  const input = (key, value) => ({ kind: 'keyed', sep: 'input', key, value });
  const reporter = (opcode, args) => ({
    type: 'call',
    value: { type: 'call', callee: { type: 'opcode', name: opcode }, args },
  });
  const listField = () => field('LIST', spec.listName, 'list');
  const first = {
    type: 'call',
    callee: { type: 'opcode', name: 'data_setvariableto' },
    args: [
      field('VARIABLE', spec.valueName, 'ident'),
      input(
        'VALUE',
        reporter('data_itemoflist', [input('INDEX', { type: 'ident', name: spec.indexName }), listField()])
      ),
    ],
  };
  const body = call.args.find((arg) => arg.kind === 'branch');
  return {
    ...call,
    args: [
      input('VALUE', reporter('data_lengthoflist', [listField()])),
      field('VARIABLE', spec.indexName, 'ident'),
      { ...body, body: [first, ...body.body] },
    ],
    listIteration: undefined,
  };
}

export const LIST_METHOD_OPS = {
  add: ['data_addtolist', ['ITEM']],
  push: ['data_addtolist', ['ITEM']],
  delete: ['data_deleteoflist', ['INDEX']],
  clear: ['data_deletealloflist', []],
  insert: ['data_insertatlist', ['INDEX', 'ITEM']],
  replace: ['data_replaceitemoflist', ['INDEX', 'ITEM']],
  show: ['data_showlist', []],
  hide: ['data_hidelist', []],
  item: ['data_itemoflist', ['INDEX']],
  length: ['data_lengthoflist', []],
  contains: ['data_listcontainsitem', ['ITEM']],
  indexof: ['data_itemnumoflist', ['ITEM']],
};

export function listMethodCall(name, method, args) {
  const spec = LIST_METHOD_OPS[method];
  if (!spec) return null;
  const [opcode, keys] = spec;
  const inputs = keys.map((k, i) => ({ kind: 'keyed', sep: 'input', key: k, value: args[i]?.value }));
  inputs.push({ kind: 'keyed', sep: 'field', key: 'LIST', value: { type: 'list', name, id: null } });
  return { type: 'call', callee: { type: 'opcode', name: opcode }, args: inputs };
}

export function resolveIdentOrMethod(call, ctx) {
  if (call?.callee?.type !== 'identOrMethod') return call;
  const { ident, method } = call.callee;
  if (ctx?.listMap && ctx.listMap.has(ident)) {
    const lm = listMethodCall(ident, method, call.args);
    if (lm) return lm;
    return { ...call, callee: { type: 'opcode', name: `${ident}_${method}` } };
  }
  const isVar =
    (ctx?.localVars && ctx.localVars.has(ident)) ||
    (ctx?.scopeParams && ctx.scopeParams.has(ident)) ||
    (ctx?.varMap && ctx.varMap.has(ident));
  if (isVar && STDLIB_METHODS[method]) {
    return {
      ...call,
      callee: { type: 'procedureCall', name: STDLIB_METHODS[method].ident, line: call.callee.line },
      args: [{ kind: 'positional', value: { type: 'ident', name: ident } }, ...call.args],
    };
  }
  if (isVar && method === 'letter' && call.args.length === 1 && call.args[0].kind === 'positional') {
    return {
      ...call,
      callee: { type: 'opcode', name: 'operator_letter_of' },
      args: [
        { kind: 'keyed', sep: 'input', key: 'LETTER', value: call.args[0].value },
        { kind: 'keyed', sep: 'input', key: 'STRING', value: { type: 'ident', name: ident } },
      ],
    };
  }
  return { ...call, callee: { type: 'opcode', name: `${ident}_${method}` } };
}

function buildNode(call, ids, blocks, ctx, nodeId) {
  const node = buildNodeInputs(call, ids, blocks, ctx, nodeId);
  applyHiddenShadows(node, ids, blocks, ctx);
  return node;
}

const explicitShadows = new WeakMap();

function shadowFromSpec(spec, value, ids, blocks, parentId) {
  if (!spec.menu) return [spec.code, String(value)];
  const id = ids.next();
  blocks[id] = {
    id,
    opcode: spec.menu,
    next: null,
    parent: parentId,
    inputs: {},
    fields: { [spec.field]: [String(value)] },
    shadow: true,
    topLevel: false,
  };
  return id;
}

function applyHiddenShadows(node, ids, blocks, ctx) {
  for (const [name, tuple] of Object.entries(node.inputs || {})) {
    if (!Array.isArray(tuple) || name.startsWith('SUBSTACK')) continue;
    const spec = shadowSpec(node.opcode, name, node.mutation);
    const written = explicitShadows.get(tuple);
    if (written) {
      if (spec && (written.type === 'string' || written.type === 'number')) {
        const value = String(written.type === 'number' ? (written.raw ?? written.value) : written.value);
        tuple[2] =
          spec.code === 11
            ? [11, value, ctx?.broadcastNameToId?.get(value) ?? null]
            : shadowFromSpec(spec, value, ids, blocks, node.id);
      }
      continue;
    }
    const active = tuple[1];
    const isVariable = Array.isArray(active) && (active[0] === 12 || active[0] === 13);
    const isBlock = tuple[0] === 2 && typeof active === 'string' && blocks[active] && !blocks[active].shadow;
    if (!isVariable && !isBlock) continue;
    const implied = impliedShadow(spec, isVariable);
    if (!implied || (isVariable && implied.code === 10 && implied.value === '')) continue;
    node.inputs[name] = [3, active, shadowFromSpec(implied, implied.value, ids, blocks, node.id)];
  }
}

function buildNodeInputs(call, ids, blocks, ctx, nodeId) {
  if (ctx.spansOut && call.span) ctx.spansOut.set(nodeId, call.span);
  if (call.type === 'localDecl') {
    const mangled = (ctx.localVars && ctx.localVars.get(call.name)) || call.name;
    return {
      id: nodeId,
      opcode: 'data_setvariableto',
      next: null,
      parent: null,
      inputs: isEmptyInput(call.value, ctx)
        ? {}
        : { VALUE: valueToInput(call.value, ids, blocks, ctx, nodeId, 'VALUE') },
      fields: { VARIABLE: [mangled, (ctx.varMap && ctx.varMap.get(mangled)) || null] },
      mutation: undefined,
    };
  }
  call = resolveIdentOrMethod(call, ctx);
  const opcode = call.callee.type === 'procedureCall' ? 'procedures_call' : call.callee.name;
  const node = {
    id: nodeId,
    opcode,
    next: null,
    parent: null,
    inputs: {},
    fields: {},
    mutation: undefined,
  };

  if (opcode === 'procedures_call' && call.callee.type === 'procedureCall') {
    const ident = call.callee.name;
    const proccode = (ctx.identToProccode && ctx.identToProccode.get(ident)) || ident;
    let idsList = (ctx.proceduresMapForTarget && ctx.proceduresMapForTarget.get(proccode)) || [];
    if (idsList.length === 0 && call.args.length > 0) {
      idsList = call.args.map((_, i) => `arg${i}`);
    }

    const meta = (ctx.procMeta && ctx.procMeta.get(proccode)) || {};
    node.mutation = {
      tagName: 'mutation',
      children: [],
      proccode,
      argumentids: JSON.stringify(idsList),
      warp: String(!!meta.warp),
    };
    if (meta.customcolor) node.mutation.customcolor = meta.customcolor;

    if (ctx.asExpression) node.mutation.return = meta.returns === '2' ? '2' : '1';

    const inputs = {};
    for (let i = 0; i < idsList.length; i++) {
      const idName = idsList[i];
      const arg = call.args[i]?.value;

      if (!arg || arg.type === 'null') continue;
      inputs[idName] = valueToInput(arg, ids, blocks, ctx, nodeId, idName);
    }
    node.inputs = inputs;
    return node;
  }

  const sig = signatureFor(ctx, opcode);
  let posIndex = 0;
  for (const a of call.args) {
    if (a.kind === 'positional') {
      if (sig) {
        const arg = sig.args[posIndex++];
        if (!arg) {
          ctx.problemsOut?.push({
            code: 'FR209',
            span: a.value?.span || a.value?.value?.span || call.span,
            message: `${sig.label} takes ${sig.args.length} argument${sig.args.length === 1 ? '' : 's'} but this call passes more`,
            hint: sig.args.length ? `arguments: ${sig.args.map((x) => x.name).join(', ')}` : null,
          });
          continue;
        }
        applySignatureArg(node, arg, a.value, ids, blocks, ctx, nodeId);
        continue;
      }
      const keyName = String.fromCharCode(65 + posIndex++);
      if (isEmptyInput(a.value, ctx) || isEmptyBooleanText(opcode, keyName, a.value)) continue;
      node.inputs[keyName] = valueToInput(a.value, ids, blocks, ctx, nodeId, keyName);
    } else if (a.kind === 'keyed') {
      let keyName = a.key;
      const sigArg = sig && keyName !== 'mutation' ? resolveSignatureKey(sig, keyName) : null;
      if (sigArg) {
        keyName = sigArg.name;
        if (sig.extension && (sigArg.kind === 'field' || sigArg.menuOpcode)) {
          applySignatureArg(node, sigArg, a.value, ids, blocks, ctx, nodeId);
          continue;
        }
      }
      if (a.sep === 'field' && keyName === 'mutation' && a.value?.type === 'json') {
        node.mutation = a.value.value;
      } else if (a.sep === 'field') {
        let fieldNode = a.value;
        if (
          keyName === 'VARIABLE' &&
          fieldNode?.type === 'ident' &&
          ctx.localVars &&
          ctx.localVars.has(fieldNode.name)
        ) {
          fieldNode = { type: 'ident', name: ctx.localVars.get(fieldNode.name) };
        }
        const fv = fieldValueFromNode(fieldNode, ctx);
        if (typeof fv[0] === 'string' && (fv.length < 2 || fv[1] == null)) {
          const idMap =
            keyName === 'VARIABLE'
              ? ctx.varMap
              : keyName === 'LIST'
                ? ctx.listMap
                : keyName === 'BROADCAST_OPTION'
                  ? ctx.broadcastNameToId
                  : null;
          const rid = idMap && idMap.get(fv[0]);
          if (rid) node.fields[keyName] = [fv[0], rid];
          else node.fields[keyName] = fv;
        } else {
          node.fields[keyName] = fv;
        }
      } else {
        const isBroadcastRef =
          keyName === 'BROADCAST_INPUT' &&
          (opcode === 'event_broadcast' || opcode === 'event_broadcastandwait') &&
          a.value?.type === 'string';
        const value = isBroadcastRef ? { type: 'broadcast', name: a.value.value, id: null } : a.value;
        if (isEmptyInput(value, ctx) || isEmptyBooleanText(opcode, keyName, value)) continue;
        node.inputs[keyName] = valueToInput(value, ids, blocks, ctx, nodeId, keyName);
      }
    } else if (a.kind === 'branch') {
      const { blocks: sub, topId } = buildBlocksFromCalls(a.body, {
        ...ctx,
        idGen: ids,
        nested: true,
        asExpression: false,
      });
      Object.assign(blocks, sub);
      if (topId) {
        const wireKey = a.wireKey || a.key.toUpperCase();
        node.inputs[wireKey] = [2, topId];
        if (blocks[topId]) blocks[topId].parent = node.id;
      }
    }
  }
  if (sig?.builtin && call.args.every((a) => a.kind === 'positional')) {
    for (const arg of sig.args) {
      if (arg.kind === 'field' && arg.default !== undefined && !node.fields[arg.name])
        node.fields[arg.name] = [arg.default];
    }
  }
  return node;
}

function buildShadowRef(sh, ids, blocks, ctx, parentId, inputKey) {
  if (sh && sh.type === 'call') {
    const tuple = valueToInput({ ...sh, shadow: true }, ids, blocks, ctx, parentId, inputKey);
    return tuple[1];
  }
  const tuple = valueToInput(sh, ids, blocks, ctx, parentId, inputKey);
  return tuple[1];
}

function isEmptyInput(val, ctx) {
  return (!val || val.type === 'null') && !ctx?.nullInputs;
}

const BOOLEAN_SLOTS = {
  control_if: /^CONDITION$/,
  control_if_else: /^CONDITION$/,
  control_wait_until: /^CONDITION$/,
  control_repeat_until: /^CONDITION$/,
  control_while: /^CONDITION$/,
  operator_not: /^OPERAND$/,
  operator_and: /^OPERAND\d+$/,
  operator_or: /^OPERAND\d+$/,
};

function isEmptyBooleanText(opcode, key, val) {
  return val?.type === 'string' && val.value === '' && !!BOOLEAN_SLOTS[opcode]?.test(key);
}

function varInput(primitive) {
  return [3, primitive, [10, '']];
}

function nullInput(ctx) {
  const tuple = [1, [10, '']];
  ctx?.nullInputs?.add(tuple);
  return tuple;
}

function signatureFor(ctx, opcode) {
  return ctx?.signatures?.get(opcode) || BUILTIN_SIGNATURES.get(opcode) || null;
}

function resolveSignatureKey(sig, key) {
  const exact = sig.args.find((arg) => arg.name === key);
  if (exact) return exact;
  const folded = sig.args.filter((arg) => arg.name.toLowerCase() === String(key).toLowerCase());
  return folded.length === 1 ? folded[0] : null;
}

function applySignatureArg(node, arg, value, ids, blocks, ctx, nodeId) {
  if (arg.kind === 'field') {
    if (value?.type === 'string' || value?.type === 'number' || value?.type === 'boolean') {
      node.fields[arg.name] = [value.type === 'number' ? (value.raw ?? String(value.value)) : String(value.value)];
    } else {
      node.fields[arg.name] = fieldValueFromNode(value, ctx);
    }
    return;
  }
  if (arg.menuOpcode && (value?.type === 'string' || value?.type === 'number')) {
    const childId = ids.next();
    if (ctx.spansOut && value.span) ctx.spansOut.set(childId, value.span);
    blocks[childId] = {
      id: childId,
      opcode: arg.menuOpcode,
      next: null,
      parent: nodeId,
      inputs: {},
      fields: { [arg.menuField]: [value.type === 'number' ? (value.raw ?? String(value.value)) : String(value.value)] },
      shadow: true,
      topLevel: false,
    };
    node.inputs[arg.name] = [1, childId];
    return;
  }
  if (isEmptyInput(value, ctx) || isEmptyBooleanText(node.opcode, arg.name, value)) return;
  node.inputs[arg.name] = valueToInput(value, ids, blocks, ctx, nodeId, arg.name);
}

function valueToInput(val, ids, blocks, ctx, parentId = null, inputKey = null) {
  if (!val) return nullInput(ctx);
  switch (val.type) {
    case 'null':
      return nullInput(ctx);
    case 'obscured': {
      const active = valueToInput(val.active, ids, blocks, ctx, parentId, inputKey);
      const plugged =
        (typeof active[1] === 'string' && blocks[active[1]] && !blocks[active[1]].shadow) ||
        (Array.isArray(active[1]) && (active[1][0] === 12 || active[1][0] === 13));
      if (!plugged) return active;
      const tuple = [3, active[1], buildShadowRef(val.shadow, ids, blocks, ctx, parentId, inputKey)];
      explicitShadows.set(tuple, val.shadow || { type: 'null' });
      return tuple;
    }
    case 'number':
      return [1, [4, val.raw ?? String(val.value)]];
    case 'string':
      return [1, [10, String(val.value)]];
    case 'boolean':
      return booleanLiteralInput(Boolean(val.value), ids, blocks, parentId);
    case 'var': {
      const id = val.id || (ctx?.varMap && ctx.varMap.get(val.name)) || null;
      return varInput([12, val.name, id]);
    }
    case 'list': {
      const id = val.id || (ctx?.listMap && ctx.listMap.get(val.name)) || null;
      return varInput([13, val.name, id]);
    }
    case 'broadcast': {
      const id = val.id || (ctx?.broadcastNameToId && ctx.broadcastNameToId.get(val.name)) || null;
      return [1, [11, val.name, id]];
    }
    case 'json': {
      const v = val.value;

      const isRawTuple =
        Array.isArray(v) &&
        Number.isInteger(v[0]) &&
        v[0] >= 4 &&
        v[0] <= 13 &&
        (v[0] >= 11 ? v.length === 3 : v.length === 2) &&
        typeof v[1] === 'string';
      if (isRawTuple) return [1, v];
      return [1, [10, JSON.stringify(v)]];
    }
    case 'call': {
      const callNode = resolveIdentOrMethod(val.value, ctx);

      const positional =
        callNode.callee.type === 'opcode' &&
        !signatureFor(ctx, callNode.callee.name)?.extension &&
        !signatureFor(ctx, callNode.callee.name)?.builtin &&
        callNode.args.length === 1 &&
        callNode.args[0].kind === 'positional' &&
        callNode.args[0].value?.type === 'string' &&
        inputKey;
      if (positional) {
        const childId = ids.next();
        if (ctx?.spansOut && callNode.span) ctx.spansOut.set(childId, callNode.span);
        blocks[childId] = {
          id: childId,
          opcode: callNode.callee.name,
          next: null,
          parent: parentId,
          inputs: {},
          fields: { [inputKey]: fieldValueFromNode(callNode.args[0].value, ctx) },
          shadow: true,
          topLevel: false,
        };
        return [1, childId];
      }
      const childId = ids.next();
      const node = buildNode(callNode, ids, blocks, { ...ctx, asExpression: true }, childId);
      blocks[childId] = { id: childId, ...node, parent: parentId };
      if (val.shadow) {
        blocks[childId].shadow = true;
        blocks[childId].topLevel = false;
        return [1, childId];
      }
      return [2, childId];
    }
    case 'ident': {
      if (!(ctx?.scopeParams && ctx.scopeParams.has(val.name))) {
        if (
          !(ctx?.localVars && ctx.localVars.has(val.name)) &&
          !ctx?.varMap?.has(val.name) &&
          ctx?.listMap?.has(val.name)
        ) {
          return varInput([13, val.name, ctx.listMap.get(val.name)]);
        }
        const name = (ctx?.localVars && ctx.localVars.get(val.name)) || val.name;
        const id = (ctx?.varMap && ctx.varMap.get(name)) || null;
        return varInput([12, name, id]);
      }
      const childId = ids.next();
      if (ctx?.spansOut && val.span) ctx.spansOut.set(childId, val.span);
      const node = buildIdentReporterNode(val.name, ctx, childId);
      blocks[childId] = { id: childId, ...node, parent: parentId };
      return [2, childId];
    }
    case 'arg': {
      const childId = ids.next();
      const kind = val.bool ? 'b' : (ctx?.scopeParams && ctx.scopeParams.get(val.name)?.kind) || 's';
      const opcode = kind === 'b' ? 'argument_reporter_boolean' : 'argument_reporter_string_number';
      blocks[childId] = {
        id: childId,
        opcode,
        next: null,
        parent: parentId,
        inputs: {},
        fields: { VALUE: [val.name, null] },
        shadow: false,
        topLevel: false,
      };
      return [2, childId];
    }
    default:
      return [1, [10, '']];
  }
}

function booleanLiteralInput(value, ids, blocks, parentId) {
  const childId = ids.next();
  blocks[childId] = {
    id: childId,
    opcode: 'operator_equals',
    next: null,
    parent: parentId,
    inputs: {
      OPERAND1: [1, [4, '0']],
      OPERAND2: [1, [4, value ? '0' : '1']],
    },
    fields: {},
    shadow: false,
    topLevel: false,
  };
  return [2, childId];
}

function fieldValueFromNode(v, ctx) {
  if (!v) return [''];
  switch (v.type) {
    case 'var':
      return [v.name, v.id || (ctx?.varMap && ctx.varMap.get(v.name)) || null];
    case 'list':
      return [v.name, v.id || (ctx?.listMap && ctx.listMap.get(v.name)) || null];
    case 'broadcast':
      return [v.name, v.id || (ctx?.broadcastNameToId && ctx.broadcastNameToId.get(v.name)) || null];
    case 'array':
      return v.value;
    case 'json':
      return Array.isArray(v.value) ? v.value : [v.value];
    case 'string':
      return [v.value];
    case 'number':
      return [v.raw ?? String(v.value)];
    case 'ident':
      return [v.name];
    default:
      return [''];
  }
}

function buildIdentReporterNode(name, ctx, id) {
  if (ctx?.scopeParams && ctx.scopeParams.has(name)) {
    const { kind, displayName } = ctx.scopeParams.get(name);
    const opcode = kind === 'b' ? 'argument_reporter_boolean' : 'argument_reporter_string_number';

    return {
      id,
      opcode,
      next: null,
      parent: null,
      inputs: {},
      fields: { VALUE: [displayName ?? name, null] },
      shadow: false,
      topLevel: false,
    };
  }
  const varId = (ctx?.varMap && ctx.varMap.get(name)) || null;
  return {
    id,
    opcode: 'data_variable',
    next: null,
    parent: null,
    inputs: {},
    fields: { VARIABLE: [name, varId] },
    shadow: false,
    topLevel: false,
  };
}

export function synthesizeProccode(ident, paramCount) {
  const label = String(ident).trim() || 'proc';
  return paramCount ? `${label} ${Array(paramCount).fill('%s').join(' ')}` : label;
}

function extractPlaceholderTypes(proccode, count) {
  const tokens = String(proccode || '').match(/%[snb]/g) || [];
  const types = tokens.map((t) => t[1]);
  while (types.length < count) types.push('s');
  return types.slice(0, count);
}

function buildProcDefScript(procDef, ids, ctx) {
  const blocks = {};
  const defId = ids.next();
  const protoId = ids.next();
  if (ctx.spansOut && procDef.span) ctx.spansOut.set(defId, procDef.span);

  const paramNames = procDef.params.map((p) => p.name);
  const proccode = procDef.proccode || synthesizeProccode(procDef.ident, procDef.params.length);
  const typeTokens = extractPlaceholderTypes(proccode, procDef.params.length);
  const argIds =
    (ctx.proceduresMapForTarget && ctx.proceduresMapForTarget.get(proccode)) || procDef.params.map((p) => p.ident);
  const argDefaults = typeTokens.map((t) => (t === 'b' ? 'false' : ''));

  const protoInputs = {};
  for (let i = 0; i < procDef.params.length; i++) {
    const rid = ids.next();
    const isBool = typeTokens[i] === 'b';
    blocks[rid] = {
      id: rid,
      opcode: isBool ? 'argument_reporter_boolean' : 'argument_reporter_string_number',
      next: null,
      parent: protoId,
      inputs: {},
      fields: { VALUE: [paramNames[i], null] },
      shadow: true,
      topLevel: false,
    };
    protoInputs[argIds[i] ?? procDef.params[i].ident] = [1, rid];
  }

  blocks[defId] = {
    id: defId,
    opcode: 'procedures_definition',
    next: null,
    parent: null,
    inputs: { custom_block: [1, protoId] },
    fields: {},
    shadow: false,
    topLevel: true,
    x: 0,
    y: 0,
  };
  blocks[protoId] = {
    id: protoId,
    opcode: 'procedures_prototype',
    next: null,
    parent: defId,
    inputs: protoInputs,
    fields: {},
    shadow: true,
    topLevel: false,
    mutation: {
      tagName: 'mutation',
      children: [],
      proccode,
      argumentids: JSON.stringify(argIds),
      argumentnames: JSON.stringify(paramNames),
      argumentdefaults: JSON.stringify(argDefaults),
      warp: String(!!procDef.warp),
      ...(procDef.customcolor ? { customcolor: procDef.customcolor } : {}),
    },
  };

  const scopeParams = new Map(
    procDef.params.map((p, i) => [p.ident, { kind: typeTokens[i], displayName: p.name ?? p.ident }])
  );
  const bodyCtx = { ...ctx, scopeParams };

  let leadingComments = 0;
  while (procDef.body[leadingComments]?.type === 'commentDecl') leadingComments++;
  const hatComments = procDef.body.slice(0, leadingComments);
  const bodyCalls = procDef.body.slice(leadingComments);
  if (ctx.commentsOut) {
    for (const c of hatComments) ctx.commentsOut.push({ ...c, blockId: c.forId || defId });
  }
  const { blocks: bodyBlocks, topId: bodyTopId } = buildBlocksFromCalls(bodyCalls, {
    ...bodyCtx,
    idGen: ids,
    nested: true,
  });
  Object.assign(blocks, bodyBlocks);
  blocks[defId].next = bodyTopId || null;
  if (bodyTopId && blocks[bodyTopId]) blocks[bodyTopId].parent = defId;

  return { topId: defId, blocks };
}

export class IdGen {
  constructor(prefix = '~') {
    this.n = 0;
    this.prefix = prefix;
  }
  next() {
    this.n += 1;
    return this.peek();
  }
  peek() {
    return `${this.prefix}${base62(this.n)}`;
  }
}

export function collapseOperators(blocks) {
  const headChild = new Set();
  const headOf = (block) => {
    const prefix = EXTENDABLE_PREFIX[block?.opcode];
    if (!prefix) return null;
    const tuple = block.inputs?.[`${prefix}1`];
    return Array.isArray(tuple) && typeof tuple[1] === 'string' ? tuple : null;
  };
  for (const [, block] of Object.entries(blocks)) {
    const head = headOf(block);
    if (!head) continue;
    const child = blocks[head[1]];
    if (child && child.opcode === block.opcode && !child.shadow && !child.comment) headChild.add(head[1]);
  }
  const obscured = new Map();
  for (const [id, block] of Object.entries(blocks)) {
    if (headChild.has(id) || !block || !EXTENDABLE_PREFIX[block.opcode]) continue;
    const prefix = EXTENDABLE_PREFIX[block.opcode];
    const seen = [];
    for (;;) {
      const head = headOf(block);
      if (!head) break;
      const child = blocks[head[1]];
      if (!child || child.opcode !== block.opcode || child.shadow || child.comment) break;
      const count = itemCountOf(block);
      const childCount = itemCountOf(child);
      const inputs = {};
      for (let i = 1; i <= childCount; i++) {
        const tuple = child.inputs?.[`${prefix}${i}`];
        inputs[`${prefix}${i}`] = tuple ?? [1, null];
        if (Array.isArray(tuple)) {
          for (let k = 1; k < tuple.length; k++) {
            if (typeof tuple[k] === 'string' && blocks[tuple[k]]) blocks[tuple[k]].parent = id;
          }
        }
      }
      for (let i = 2; i <= count; i++) {
        const tuple = block.inputs?.[`${prefix}${i}`];
        inputs[`${prefix}${childCount + i - 1}`] = tuple ?? [1, null];
      }
      seen.push(head[0] === 3 && head.length > 2 && head[2] != null ? head[2] : null);
      block.inputs = inputs;
      block.mutation = { tagName: 'mutation', children: [], itemcount: String(childCount + count - 1) };
      delete blocks[head[1]];
    }
    if (seen.length) obscured.set(id, seen);
  }
  return obscured;
}

const EXTENDABLE_PREFIX = {
  operator_add: 'NUM',
  operator_subtract: 'NUM',
  operator_multiply: 'NUM',
  operator_divide: 'NUM',
  operator_mod: 'NUM',
  operator_and: 'OPERAND',
  operator_or: 'OPERAND',
  operator_join: 'STRING',
};

function itemCountOf(block) {
  const n = parseInt(block?.mutation?.itemcount, 10);
  return n >= 2 ? n : 2;
}

function base62(num) {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  let n = num;
  let out = '';
  while (n > 0) {
    out = alphabet[n % 62] + out;
    n = Math.floor(n / 62);
  }
  return out || 'A';
}

export function mergeIntoManifest(manifest, builtTargets) {
  const clone = JSON.parse(JSON.stringify(manifest));
  for (const t of clone.targets || []) {
    if (!t.blocks) t.blocks = {};
  }
  for (const bt of builtTargets) {
    const t = clone.targets.find((x) => x.name === bt.name);
    if (!t) continue;
    const originalBlocks = t.blocks || {};

    if (bt.scripts && Array.isArray(bt.scripts)) {
      const inserts = [];
      for (const script of bt.scripts) {
        const { oldTopId, blocks: newSubgraph } = script;
        if (!newSubgraph || !Object.keys(newSubgraph).length) continue;
        let incoming = null;
        let matched = false;
        if (oldTopId && originalBlocks[oldTopId]) {
          matched = true;
          const toDelete = new Set(Object.keys(collectBlocksSubgraph(originalBlocks, oldTopId)));
          incoming = findIncomingEdge(originalBlocks, oldTopId);
          for (const id of toDelete) delete originalBlocks[id];
        }
        inserts.push({ script, incoming, matched });
      }

      for (const { script, incoming, matched } of inserts) {
        const newSubgraph = script.blocks;
        for (const [nid, nb] of Object.entries(newSubgraph)) {
          originalBlocks[nid] = nb;
        }
        if (!matched) continue;
        const newTopId = script.newTopId || findTopIdFromBlocks(newSubgraph) || Object.keys(newSubgraph)[0];
        if (incoming && originalBlocks[incoming.owner]) {
          if (incoming.kind === 'next') {
            originalBlocks[incoming.owner].next = newTopId;
          } else if (incoming.kind === 'input') {
            const tuple = originalBlocks[incoming.owner].inputs?.[incoming.input];
            if (Array.isArray(tuple) && tuple.length >= 2) tuple[1] = newTopId;
          }
        }
        if (!incoming && originalBlocks[newTopId]) {
          originalBlocks[newTopId].topLevel = true;
        }
      }
      t.blocks = originalBlocks;
      continue;
    }

    const newBlocks = bt.blocks || {};
    for (const [newId, newBlock] of Object.entries(newBlocks)) {
      originalBlocks[newId] = newBlock;
    }
    t.blocks = originalBlocks;
  }
  return clone;
}

function findTopIdFromBlocks(blocks) {
  for (const [id, b] of Object.entries(blocks)) {
    if (b && b.topLevel && b.parent == null) return id;
  }

  for (const [id, b] of Object.entries(blocks)) {
    if (b && b.parent == null) return id;
  }
  return null;
}

function findIncomingEdge(blocks, targetId) {
  for (const [id, b] of Object.entries(blocks)) {
    if (b.next === targetId) return { owner: id, kind: 'next' };
    if (b.inputs) {
      for (const [k, v] of Object.entries(b.inputs)) {
        if (Array.isArray(v) && v[1] === targetId) return { owner: id, kind: 'input', input: k };
      }
    }
  }
  return null;
}

function collectBlocksSubgraph(blocks, topId) {
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
      for (const [, val] of Object.entries(node.inputs)) {
        if (Array.isArray(val)) {
          for (let i = 1; i < val.length; i++) {
            const childId = val[i];
            if (typeof childId === 'string' && blocks[childId]) {
              stack.push(childId);
            }
          }
        }
      }
    }
  }
  return sub;
}
