import { STDLIB_METHODS } from './stdlib/index.js';

// Opcodes that are only ever legitimately used as shadow-only blocks
// (literal input defaults / custom-block parameter reporters). Used to
// restore the `shadow` flag for orphan top-level blocks reconstructed from
// DSL text alone (the snapshot path preserves this exactly; this is the
// best-effort text-only fallback).
const SHADOW_ONLY_OPCODES = new Set([
  'math_number', 'math_integer', 'math_whole_number', 'math_positive_number',
  'math_angle', 'text', 'colour_picker', 'note',
  'argument_reporter_string_number', 'argument_reporter_boolean',
]);

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

  // The whole chain/branch is nothing but a preserved dangling reference
  // (e.g. a control_if's SUBSTACK that itself points at a nonexistent
  // block) - reproduce the exact same id, not a real block.
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
      // Comments are not blocks: attach to the preceding statement's block
      // (or the chain's top block when written first). Collected via
      // ctx.commentsOut so nested branch bodies bubble up to the caller.
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
    if (call.type === 'importDecl') continue; // file-level directive, not a block
    if (call.type === 'danglingNext') {
      // Trailing sentinel: real content preceded it, this just restores the
      // broken forward reference at the end of the chain rather than a
      // real block continuing it.
      if (lastId) blocks[lastId].next = call.id;
      else topId = call.id;
      break;
    }
    // Reserve this statement's own id before recursing into its nested
    // values - buildNode may insert child blocks into the shared `blocks`
    // object before this statement's own entry lands, so object key
    // insertion order can't be trusted to recover the top id afterward.
    const id = ids.next();
    const isFirst = topId == null;
    if (isFirst) topId = id;
    const node = buildNode(call, ids, blocks, { ...ctx, asExpression: false }, id);
    if (isFirst && !nested) {
      node.topLevel = true;
      node.parent = null;
      node.x = 0;
      node.y = 0;
      if (hatOpcode) {
        // A dangling orphan reporter (`"name";` from a bare `__bare_value`
        // statement) always carries its name under fields.VALUE; data_variable
        // is the one opcode that expects it under a differently-named key.
        if (hatOpcode === 'data_variable' && node.fields && 'VALUE' in node.fields) {
          const [name] = node.fields.VALUE;
          node.fields = { VARIABLE: [name, (ctx?.varMap && ctx.varMap.get(name)) || null] };
        }
        node.opcode = hatOpcode; // trust directory-derived opcode when provided
      }
      if (SHADOW_ONLY_OPCODES.has(node.opcode)) node.shadow = true;
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

// `ident.method(positional...)` is syntactically ambiguous between stdlib
// method sugar on a variable and an extension block call. Resolve here, where
// scope is known: a variable/local/param named ident wins as the method
// receiver; otherwise it's the opcode `ident_method`. (pack.js pre-resolves
// these the same way before its stdlib-injection scan; this covers direct
// parse+build API users.)
// method name -> [opcode, positional input keys]. Commands and reporters
// alike; the receiver list is passed as a LIST field.
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
  return { ...call, callee: { type: 'opcode', name: `${ident}_${method}` } };
}

function buildNode(call, ids, blocks, ctx, nodeId) {
  if (call.type === 'localDecl') {
    const mangled = (ctx.localVars && ctx.localVars.get(call.name)) || call.name;
    return {
      id: nodeId,
      opcode: 'data_setvariableto',
      next: null,
      parent: null,
      inputs: { VALUE: valueToInput(call.value, ids, blocks, ctx, nodeId, 'VALUE') },
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
    // A call used as an expression is a reporter-style custom block; the
    // editor needs the mutation to say so or the block is statement-shaped
    // and refuses to connect into a value slot.
    if (ctx.asExpression) node.mutation.return = meta.returns === '2' ? '2' : '1';

    const inputs = {};
    for (let i = 0; i < idsList.length; i++) {
      const idName = idsList[i];
      const arg = call.args[i]?.value;
      // A param that was never filled in the original call renders as a bare
      // `null` literal (stringify has no original input to read); Scratch
      // itself omits the key entirely in that case rather than storing an
      // empty default, so mirror that instead of fabricating one.
      if (!arg || arg.type === 'null') continue;
      inputs[idName] = valueToInput(arg, ids, blocks, ctx, nodeId, idName);
    }
    node.inputs = inputs;
    return node;
  }

  let posIndex = 0;
  for (const a of call.args) {
    if (a.kind === 'positional') {
      // Positional arguments map to input names by order: A, B, C, ...
      // (the near-universal extension-block convention). Blocks whose real
      // input names differ are always emitted in keyed form.
      const keyName = String.fromCharCode(65 + posIndex++);
      node.inputs[keyName] = valueToInput(a.value, ids, blocks, ctx, nodeId, keyName);
    } else if (a.kind === 'keyed') {
      const keyName = a.key;
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
            keyName === 'VARIABLE' ? ctx.varMap : keyName === 'LIST' ? ctx.listMap : keyName === 'BROADCAST_OPTION' ? ctx.broadcastNameToId : null;
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
        node.inputs[keyName] = valueToInput(value, ids, blocks, ctx, nodeId, keyName);
      }
    } else if (a.kind === 'branch') {
      const { blocks: sub, topId } = buildBlocksFromCalls(a.body, { ...ctx, idGen: ids, nested: true, asExpression: false });
      Object.assign(blocks, sub);
      if (topId) {
        const wireKey = a.wireKey || a.key.toUpperCase();
        node.inputs[wireKey] = [2, topId];
        if (blocks[topId]) blocks[topId].parent = node.id;
      }
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

function varInput(primitive) {
  return [3, primitive, [10, '']];
}

function valueToInput(val, ids, blocks, ctx, parentId = null, inputKey = null) {
  if (!val) return [1, [10, '']];
  switch (val.type) {
    case 'null':
      return [1, [10, '']];
    case 'obscured': {
      const active = valueToInput(val.active, ids, blocks, ctx, parentId, inputKey);
      const shadowRef = buildShadowRef(val.shadow, ids, blocks, ctx, parentId, inputKey);
      return [3, active[1], shadowRef];
    }
    case 'number':
      // Prefer the literal source text (`raw`) over re-stringifying the
      // parsed Number - Scratch stores numeric inputs as free-form text
      // (".25", "007", "1e3", ...) and re-formatting via Number->String
      // silently rewrites it (".25" -> "0.25").
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
      // Legacy raw primitive tuples ([10, "x"], [12, "name", "id"]) pass
      // through verbatim - but only shapes that really are tuples: 2-3
      // entries, a known type code, string payload. Anything else is an
      // array literal and packs as its JSON text ([1, 2] -> "[1,2]"), the
      // shape the JSON helper blocks consume.
      const isRawTuple =
        Array.isArray(v) &&
        Number.isInteger(v[0]) && v[0] >= 4 && v[0] <= 13 &&
        (v[0] >= 11 ? v.length === 3 : v.length === 2) &&
        typeof v[1] === 'string';
      if (isRawTuple) return [1, v];
      return [1, [10, JSON.stringify(v)]];
    }
    case 'call': {
      const callNode = resolveIdentOrMethod(val.value, ctx);
      // `ns.op("literal")` in a value slot is a visible menu shadow (the
      // dropdown block with the parent input's key as its single field).
      // Only plain string payloads take this path: a single positional
      // non-string (number, variable, nested call) is a real reporter whose
      // first input is named A - see the positional-argument convention in
      // buildNode.
      const positional =
        callNode.callee.type === 'opcode' &&
        callNode.args.length === 1 &&
        callNode.args[0].kind === 'positional' &&
        callNode.args[0].value?.type === 'string' &&
        inputKey;
      if (positional) {
        const childId = ids.next();
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
      // A plain variable read plugs in as Scratch's compact inline literal
      // ([1, [12, name, id]]) - there is no separate data_variable block for
      // it anywhere in a real project.json. Only custom-block parameters
      // (scopeParams) are genuinely their own block (argument_reporter_*).
      if (!(ctx?.scopeParams && ctx.scopeParams.has(val.name))) {
        if (!(ctx?.localVars && ctx.localVars.has(val.name)) && ctx?.listMap && ctx.listMap.has(val.name)) {
          return varInput([13, val.name, ctx.listMap.get(val.name)]);
        }
        const name = (ctx?.localVars && ctx.localVars.get(val.name)) || val.name;
        const id = (ctx?.varMap && ctx.varMap.get(name)) || null;
        return varInput([12, name, id]);
      }
      const childId = ids.next();
      const node = buildIdentReporterNode(val.name, ctx, childId);
      blocks[childId] = { id: childId, ...node, parent: parentId };
      return [2, childId];
    }
    case 'arg': {
      // Explicit `arg("Name")` - an argument-reporter reference written out
      // by name because it can't safely use bare-identifier sugar (either
      // its display name collides with another param after cleanIdent, or
      // it's orphaned: the body still refers to a param that's since been
      // removed from the definition). Build the real reporter block by
      // display name directly, independent of whether it's still declared.
      const childId = ids.next();
      const kind = (ctx?.scopeParams && ctx.scopeParams.get(val.name)?.kind) || 's';
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
    // Body references to custom-block params are real blocks (shadow: false);
    // only the copies inside the procedures_prototype are shadows.
    return { id, opcode, next: null, parent: null, inputs: {}, fields: { VALUE: [displayName ?? name, null] }, shadow: false, topLevel: false };
  }
  const varId = (ctx?.varMap && ctx.varMap.get(name)) || null;
  return { id, opcode: 'data_variable', next: null, parent: null, inputs: {}, fields: { VARIABLE: [name, varId] }, shadow: false, topLevel: false };
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

  const paramNames = procDef.params.map((p) => p.name);
  const proccode = procDef.proccode || synthesizeProccode(procDef.ident, procDef.params.length);
  const typeTokens = extractPlaceholderTypes(proccode, procDef.params.length);
  const argIds = (ctx.proceduresMapForTarget && ctx.proceduresMapForTarget.get(proccode)) || procDef.params.map((p) => p.ident);
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
  // Comments written before the first body statement belong to the def hat
  // itself, not to the first statement the nested chain resolves them to.
  let leadingComments = 0;
  while (procDef.body[leadingComments]?.type === 'commentDecl') leadingComments++;
  const hatComments = procDef.body.slice(0, leadingComments);
  const bodyCalls = procDef.body.slice(leadingComments);
  if (ctx.commentsOut) {
    for (const c of hatComments) ctx.commentsOut.push({ ...c, blockId: c.forId || defId });
  }
  const { blocks: bodyBlocks, topId: bodyTopId } = buildBlocksFromCalls(bodyCalls, { ...bodyCtx, idGen: ids, nested: true });
  Object.assign(blocks, bodyBlocks);
  blocks[defId].next = bodyTopId || null;
  if (bodyTopId && blocks[bodyTopId]) blocks[bodyTopId].parent = defId;

  return { topId: defId, blocks };
}

// Generated ids carry a '~' prefix: scratch-gui's toolbox XML assigns fixed
// readable ids to palette blocks (e.g. the Sensing "of" block gets id "of"),
// and its block init code looks those ids up in the editing target's blocks.
// Bare sequential base62 ids collide with them ("of" = the 3141st block) and
// crash the editor's flyout; the prefix keeps the id space disjoint.
export class IdGen {
  constructor() {
    this.n = 0;
  }
  next() {
    this.n += 1;
    return this.peek();
  }
  peek() {
    return `~${base62(this.n)}`;
  }
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
      // Two phases: run every deletion against the original blocks before any
      // rebuilt subgraph is inserted. Rebuilt ids are freshly generated and
      // can coincide with another script's original topBlockId - interleaving
      // insertions would make that later script's delete pass wipe
      // just-inserted rebuilt blocks instead of the origin ones.
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
