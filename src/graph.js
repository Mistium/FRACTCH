export function groupTopLevelScripts(target) {
  const blocks = target.blocks || {};
  const scripts = [];
  for (const [id, b] of Object.entries(blocks)) {
    if (!b) continue;

    if (!b.topLevel) continue;
    if (b.shadow) continue;
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
          // Elements from index 1 onward may reference block ids: the primary
          // value/block, and (for INPUT_DIFF_BLOCK_SHADOW tuples) an obscured
          // shadow block hidden behind it. Both must be swept for losslessness.
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
