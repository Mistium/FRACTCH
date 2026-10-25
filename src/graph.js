import { MENU_OPCODES } from './knownOpcodes.js';

export function isMenuShadow(b) {
  return Boolean(
    b && b.shadow && typeof b.opcode === 'string' && (MENU_OPCODES.has(b.opcode) || b.opcode.endsWith('_menu'))
  );
}

export function groupTopLevelScripts(target) {
  const blocks = target.blocks || {};
  const scripts = [];
  for (const [id, b] of Object.entries(blocks)) {
    if (!b) continue;

    if (!b.topLevel) continue;
    if (isMenuShadow(b)) continue;
    const hatOpcode = b.opcode || null;
    scripts.push({ topBlockId: id, hatOpcode });
  }
  return scripts;
}

export function collectBlocksSubgraph(blocks, topId) {
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

export const SCRIPT_BLOCK_HEIGHT = 48;

export function scriptsBottom(blocks) {
  const topOf = new Map();
  const findTop = (id) => {
    const seen = [];
    let cur = id;
    for (let guard = 0; guard < 10000; guard++) {
      if (topOf.has(cur)) break;
      const b = blocks[cur];
      if (!b || typeof b !== 'object' || Array.isArray(b)) {
        cur = null;
        break;
      }
      seen.push(cur);
      if (!b.parent || !blocks[b.parent]) break;
      cur = b.parent;
    }
    const top = cur == null ? null : topOf.has(cur) ? topOf.get(cur) : cur;
    for (const s of seen) topOf.set(s, top);
    return top;
  };
  const counts = new Map();
  for (const [id, b] of Object.entries(blocks || {})) {
    if (!b || typeof b !== 'object' || Array.isArray(b) || b.shadow) continue;
    const top = findTop(id);
    if (top != null) counts.set(top, (counts.get(top) || 0) + 1);
  }
  let bottom = null;
  for (const [top, count] of counts) {
    const b = blocks[top];
    if (!b?.topLevel) continue;
    bottom = Math.max(bottom ?? -Infinity, Math.round(b.y ?? 0) + SCRIPT_BLOCK_HEIGHT * count);
  }
  return bottom;
}

export function commentSlotY(bottom, n) {
  return bottom == null ? n * 200 : bottom + SCRIPT_BLOCK_HEIGHT + 200 * n;
}
