const STATEMENT_TYPES = new Set(['command', 'conditional', 'loop']);
const VALUE_TYPES = new Set(['reporter', 'Boolean', 'boolean']);
const HAT_TYPES = new Set(['hat', 'event']);
const SKIPPED_ARG_TYPES = new Set(['image']);

const SHADOW_TYPE_CODES = {
  math_number: 4,
  math_positive_number: 5,
  math_whole_number: 6,
  math_integer: 7,
  math_angle: 8,
  colour_picker: 9,
  text: 10,
};

export function shadowTypeCode(shadowOpcode) {
  return SHADOW_TYPE_CODES[shadowOpcode] ?? null;
}

function textPlaceholders(text) {
  const out = [];
  const parts = Array.isArray(text) ? text : [text];
  for (const part of parts) {
    for (const m of String(part ?? '').matchAll(/\[([^\]\s]+)\]/g)) if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

function menuValues(menu) {
  const items = Array.isArray(menu) ? menu : Array.isArray(menu?.items) ? menu.items : null;
  if (!items) return null;
  return items.map((item) => String(item && typeof item === 'object' ? (item.value ?? item.text ?? '') : item));
}

function normalizeExtension(id, info) {
  const out = [];
  const menus = info?.menus || {};
  for (const block of info?.blocks || []) {
    if (!block || typeof block !== 'object' || typeof block.opcode !== 'string') continue;
    if (block.blockType === 'button' || block.blockType === 'label' || block.blockType === 'xml') continue;
    const argDefs = Array.isArray(block.arguments)
      ? Object.fromEntries(block.arguments.filter((a) => a && a.name).map((a) => [a.name, a]))
      : block.arguments || {};
    const order = textPlaceholders(block.text).filter((name) => Object.prototype.hasOwnProperty.call(argDefs, name));
    for (const name of Object.keys(argDefs)) if (!order.includes(name)) order.push(name);
    const args = [];
    for (const name of order) {
      const def = argDefs[name] || {};
      if (SKIPPED_ARG_TYPES.has(def.type)) continue;
      const menuName = typeof def.menu === 'string' ? def.menu : null;
      const menu = menuName ? menus[menuName] : null;
      const acceptReporters = !!(menu && !Array.isArray(menu) && typeof menu === 'object' && menu.acceptReporters);
      const isField = !!menuName && !acceptReporters;
      args.push({
        name,
        kind: isField ? 'field' : 'input',
        type: def.type || 'string',
        menu: menuName,
        menuOpcode: menuName && !isField ? `${id}_menu_${menuName}` : null,
        menuField: menuName,
        values: menu ? menuValues(menu) : null,
      });
    }
    const branches =
      block.blockType === 'conditional' || block.blockType === 'loop' ? Math.max(1, Number(block.branchCount) || 1) : 0;
    out.push({
      opcode: `${id}_${block.opcode}`,
      label: `${id}.${block.opcode}`,
      extension: id,
      blockType: block.blockType || 'command',
      args,
      branches,
    });
  }
  return out;
}

export function normalizeSignatures(extensions) {
  const byOpcode = new Map();
  const ids = new Set();
  if (!extensions) return { byOpcode, ids, provided: false };
  const entries = Array.isArray(extensions)
    ? extensions.map((info) => [info?.id, info])
    : extensions instanceof Map
      ? [...extensions]
      : Object.entries(extensions);
  for (const [id, info] of entries) {
    if (!id) continue;
    ids.add(String(id));
    for (const sig of normalizeExtension(String(id), info)) byOpcode.set(sig.opcode, sig);
    for (const [menuName, menu] of Object.entries(info?.menus || {})) {
      if (!menu || Array.isArray(menu) || typeof menu !== 'object' || !menu.acceptReporters) continue;
      byOpcode.set(`${id}_menu_${menuName}`, {
        opcode: `${id}_menu_${menuName}`,
        label: `${id}.menu_${menuName}`,
        extension: String(id),
        blockType: 'reporter',
        menu: true,
        args: [],
        fields: [menuName],
        values: menuValues(menu),
        branches: 0,
      });
    }
  }
  return { byOpcode, ids, provided: true };
}

function nameList(list) {
  if (!list) return [];
  if (Array.isArray(list)) return list.map((x) => (typeof x === 'string' ? x : x?.name)).filter(Boolean);
  return Object.keys(list);
}

export function normalizeOpcodeTable(table) {
  const byOpcode = new Map();
  if (!table) return { byOpcode, provided: false };
  const source =
    table.opcodes && typeof table.opcodes === 'object' && !Array.isArray(table.opcodes) ? table.opcodes : table;
  if (source instanceof Set || Array.isArray(source)) {
    for (const opcode of source) byOpcode.set(String(opcode), { opcode: String(opcode), known: true });
    return { byOpcode, provided: true };
  }
  for (const [opcode, raw] of source instanceof Map ? source : Object.entries(source)) {
    const info = raw && typeof raw === 'object' ? raw : {};
    const inputs = nameList(info.inputs);
    const fields = nameList(info.fields);
    const shadows = {};
    if (info.inputs && !Array.isArray(info.inputs)) {
      for (const [name, def] of Object.entries(info.inputs)) if (def?.shadow) shadows[name] = def.shadow;
    } else if (Array.isArray(info.inputs)) {
      for (const def of info.inputs) if (def && typeof def === 'object' && def.shadow) shadows[def.name] = def.shadow;
    }
    Object.assign(shadows, info.shadows || {});
    const menus = {};
    const fieldDefs = Array.isArray(info.fields) ? info.fields : Object.entries(info.fields || {});
    for (const def of fieldDefs) {
      const [name, value] = Array.isArray(def) ? def : [def?.name, def];
      const options = value?.options || value?.values;
      if (name && Array.isArray(options)) menus[name] = options.map((o) => String(Array.isArray(o) ? o[1] : o));
    }
    Object.assign(menus, info.menus || {});
    byOpcode.set(String(opcode), {
      opcode: String(opcode),
      known: true,
      inputs: info.inputs ? inputs : null,
      fields: info.fields ? fields : null,
      order: nameList(info.args) || null,
      mutationInputs: info.mutationInputs || null,
      shape: info.shape || info.blockType || (info.hat ? 'hat' : null),
      variadic: info.variadic || null,
      shadows,
      menus,
    });
  }
  return { byOpcode, provided: true };
}

export function coreSignature(entry) {
  if (!entry || !entry.inputs?.length || entry.variadic || entry.mutationInputs) return null;
  const order = entry.order?.length ? entry.order : [...(entry.inputs || []), ...(entry.fields || [])];
  const fieldSet = new Set(entry.fields || []);
  const args = order
    .filter((name) => !/^SUBSTACK\d*$/.test(name))
    .map((name) => ({
      name,
      kind: fieldSet.has(name) ? 'field' : 'input',
      menuOpcode: null,
      menuField: null,
      values: entry.menus?.[name] || null,
    }));
  return {
    opcode: entry.opcode,
    label: entry.opcode.replace('_', '.'),
    blockType: entry.shape || null,
    args,
    core: true,
  };
}

export function isStatementType(blockType) {
  return STATEMENT_TYPES.has(blockType);
}

export function isValueType(blockType) {
  return VALUE_TYPES.has(blockType);
}

export function isHatType(blockType) {
  return HAT_TYPES.has(blockType);
}

export function signatureHash(extensions) {
  const { byOpcode } = normalizeSignatures(extensions);
  let text = '';
  for (const [opcode, sig] of [...byOpcode].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    text += `${opcode}:${sig.blockType}:${sig.args.map((a) => `${a.name}/${a.kind}/${a.menu || ''}`).join(',')};`;
  }
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
