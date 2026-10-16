const EXTENDABLE = {
  operator_add: 'NUM',
  operator_subtract: 'NUM',
  operator_multiply: 'NUM',
  operator_divide: 'NUM',
  operator_mod: 'NUM',
  operator_and: 'OPERAND',
  operator_or: 'OPERAND',
  operator_join: 'STRING',
};
const CONSTANTS = { 'mistwarp.pi': 'operator_pi', 'mistwarp.newline': 'operator_newline' };
const PRIMITIVE_OPCODES = {
  4: ['math_number', 'NUM'],
  5: ['math_positive_number', 'NUM'],
  6: ['math_whole_number', 'NUM'],
  7: ['math_integer', 'NUM'],
  8: ['math_angle', 'NUM'],
  9: ['colour_picker', 'COLOUR'],
  10: ['text', 'TEXT'],
  11: ['event_broadcast_menu', 'BROADCAST_OPTION'],
  12: ['data_variable', 'VARIABLE'],
  13: ['data_listcontents', 'LIST'],
};

function itemCount(block) {
  const n = parseInt(block?.mutation?.itemcount, 10);
  return n >= 2 ? n : 2;
}

export function liveTarget(target, sidecars) {
  const blocks = structuredClone(target.blocks || {});
  for (const [id, b] of Object.entries(blocks)) {
    if (!b || Array.isArray(b)) continue;
    for (const [name, tuple] of Object.entries(b.inputs || {})) {
      if (!Array.isArray(tuple)) continue;
      for (let i = 1; i < tuple.length && i <= 2; i++) {
        const p = tuple[i];
        if (Array.isArray(p) && p[0] === 12 && CONSTANTS[p[1]]) {
          const cid = `const:${id}:${name}`;
          blocks[cid] = {
            opcode: CONSTANTS[p[1]],
            next: null,
            parent: id,
            inputs: {},
            fields: {},
            shadow: false,
            topLevel: false,
          };
          tuple[i] = cid;
          if (tuple[0] === 1) tuple[0] = 3;
        }
      }
    }
  }
  const headChild = new Set();
  for (const b of Object.values(blocks)) {
    const prefix = EXTENDABLE[b?.opcode];
    const head = prefix && b.inputs?.[`${prefix}1`];
    if (!Array.isArray(head) || typeof head[1] !== 'string') continue;
    const child = blocks[head[1]];
    if (child && child.opcode === b.opcode && !child.shadow && !child.comment) headChild.add(head[1]);
  }
  for (const [id, block] of Object.entries(blocks)) {
    if (headChild.has(id) || !block || Array.isArray(block) || !EXTENDABLE[block.opcode]) continue;
    const prefix = EXTENDABLE[block.opcode];
    const obscured = [];
    for (;;) {
      const head = block.inputs?.[`${prefix}1`];
      if (!Array.isArray(head) || typeof head[1] !== 'string') break;
      const child = blocks[head[1]];
      if (!child || child.opcode !== block.opcode || child.shadow || child.comment) break;
      const count = itemCount(block);
      const childCount = itemCount(child);
      const inputs = {};
      for (let i = 1; i <= childCount; i++) {
        const t = child.inputs?.[`${prefix}${i}`];
        inputs[`${prefix}${i}`] = t ?? [1, null];
        if (Array.isArray(t)) for (const x of t.slice(1)) if (typeof x === 'string' && blocks[x]) blocks[x].parent = id;
      }
      for (let i = 2; i <= count; i++)
        inputs[`${prefix}${childCount + i - 1}`] = block.inputs?.[`${prefix}${i}`] ?? [1, null];
      const shadow = head[0] === 3 && head.length > 2 ? head[2] : null;
      if (Array.isArray(shadow)) {
        const [opcode, field] = PRIMITIVE_OPCODES[shadow[0]] || ['text', 'TEXT'];
        obscured.push({
          id: `obs:${id}:${obscured.length}`,
          opcode,
          next: null,
          parent: id,
          inputs: {},
          fields: { [field]: [shadow[1]] },
          shadow: true,
          topLevel: false,
        });
      } else if (typeof shadow === 'string' && blocks[shadow]) {
        obscured.push({ id: shadow, ...blocks[shadow], parent: id });
        delete blocks[shadow];
      } else obscured.push(null);
      block.inputs = inputs;
      block.mutation = { tagName: 'mutation', children: [], itemcount: String(childCount + count - 1) };
      delete blocks[head[1]];
    }
    if (obscured.length) sidecars.obscuredShadows[id] = obscured;
  }
  for (const [id, b] of Object.entries(blocks)) {
    if (!b || Array.isArray(b)) continue;
    for (const [name, tuple] of Object.entries(b.inputs || {})) {
      if (!Array.isArray(tuple)) continue;
      for (let i = 1; i < tuple.length && i <= 2; i++) {
        if (!Array.isArray(tuple[i])) continue;
        ((sidecars.primitiveIds[id] ||= {})[name] ||= {})[i === 1 ? 'block' : 'shadow'] = `prim:${id}:${name}:${i}`;
      }
    }
  }
  return {
    ...target,
    id: target.isStage ? 'stage-id' : `id:${target.name}`,
    blocks,
    primitiveIds: sidecars.primitiveIds,
    obscuredShadows: sidecars.obscuredShadows,
  };
}

export function liveContext(project) {
  const targets = (project.targets || []).map((t) => liveTarget(t, { primitiveIds: {}, obscuredShadows: {} }));
  return { form: 'live', targets, monitors: project.monitors || [] };
}

export function applyResult(context, targetId, result) {
  return {
    ...context,
    targets: context.targets.map((t) =>
      t.id === targetId
        ? { ...result.target, primitiveIds: result.primitiveIds, obscuredShadows: result.obscuredShadows }
        : t
    ),
  };
}

export function sortedJson(value) {
  if (Array.isArray(value)) return value.map(sortedJson);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) if (value[k] !== undefined) out[k] = sortedJson(value[k]);
    return out;
  }
  return value;
}
