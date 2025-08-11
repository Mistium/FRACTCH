export function groupTopLevelScripts(target) {
  const blocks = target.blocks || {};
  const scripts = [];
  for (const [id, b] of Object.entries(blocks)) {
    if (!b) continue;

    if (!b.topLevel) continue;
    if (b.shadow) continue; // ignore top-level shadow blocks
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
        if (Array.isArray(val) && val.length >= 2) {
          const childId = val[1];
          if (typeof childId === 'string' && blocks[childId]) {
            stack.push(childId);
          }
        }
      }
    }
  }
  return sub;
}
