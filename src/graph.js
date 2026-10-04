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

// Scratch saves a loose variable/list reporter on the canvas in compact form,
// [12 or 13, name, id, x, y]. Expand those into ordinary top-level blocks so they
// are emitted like any other script instead of being skipped.
export function expandCompactTopLevel(target) {
  const blocks = target?.blocks;
  if (!blocks || !Object.values(blocks).some((b) => Array.isArray(b) && b.length >= 5)) return target;
  const out = {};
  for (const [id, b] of Object.entries(blocks)) {
    if (Array.isArray(b) && b.length >= 5 && (b[0] === 12 || b[0] === 13)) {
      const isVar = b[0] === 12;
      out[id] = {
        opcode: isVar ? 'data_variable' : 'data_listcontents',
        next: null,
        parent: null,
        inputs: {},
        fields: isVar ? { VARIABLE: [b[1], b[2]] } : { LIST: [b[1], b[2]] },
        shadow: false,
        topLevel: true,
        x: b[3],
        y: b[4],
      };
    } else out[id] = b;
  }
  return { ...target, blocks: out };
}
