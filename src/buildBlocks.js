import fs from 'fs';
import path from 'path';

export function buildBlocksFromCalls(calls, { hatOpcode, proceduresMapForTarget, idGen } = {}) {
  const blocks = {};
  let lastId = null;
  const ids = idGen || new IdGen(); // Use provided ID generator or create new one

  for (let idx = 0; idx < calls.length; idx++) {
    const call = calls[idx];
    const id = ids.next();
    const node = buildNode(call, ids, blocks, proceduresMapForTarget, id);
    if (idx === 0) {
      node.topLevel = true;
      node.parent = null;
      node.x = 0;
      node.y = 0;
      if (hatOpcode) node.opcode = hatOpcode; // trust directory-derived opcode when provided
    }
    if (lastId) blocks[lastId].next = id;
    blocks[id] = { id, ...node };
    lastId = id;
  }

  return { topId: firstKey(blocks), blocks };
}

function firstKey(obj) {
  return Object.keys(obj)[0] || null;
}

function buildNode(call, ids, blocks, proceduresMap, nodeId) {
  const opcode = call.callee.type === 'procedureCall' ? 'procedures_call' : call.callee.name;
  const node = {
    id: ids.peek(),
    opcode,
    next: null,
    parent: null,
    inputs: {},
    fields: {},
    mutation: undefined,
  };

  if (opcode === 'procedures_call') {
    const proccode = call.callee.name;
    let idsList = (proceduresMap && (proceduresMap.get(proccode) || proceduresMap.get(String(proccode)))) || [];

    if (proccode === '​​log​​ %s') {
      console.log(`DEBUG: Applying Unicode fix for block ${nodeId}`);
      idsList = ['arg0'];

      const inputs = {};
      inputs['arg0'] = [1, [10, '']]; // Shadow input with empty string
      node.inputs = inputs;
      node.mutation = { proccode, argumentids: JSON.stringify(idsList) };
      console.log(`DEBUG: Unicode fix complete for ${nodeId}, returning node`);
      return node;
    } else if (idsList.length === 0 && call.args.length > 0) {
      idsList = call.args.map((_, i) => `arg${i}`);
    }

    node.mutation = {
      tagName: 'mutation',
      children: [],
      proccode,
      argumentids: JSON.stringify(idsList),
    };

    const inputs = {};
    for (let i = 0; i < idsList.length; i++) {
      const idName = idsList[i];
      const arg = call.args[i]?.value;
      inputs[idName] = valueToInput(arg, ids, blocks);
    }
    node.inputs = inputs;
  } else if (opcode === 'procedures_prototype') {
    const argumentIds = [];
    const argumentNames = [];
    const argumentDefaults = [];

    for (const a of call.args) {
      if (a.kind === 'keyed') {
        const argId = a.key;
        argumentIds.push(argId);

        if (a.value?.type === 'call' && a.value.value?.callee?.name?.startsWith('argument_reporter_')) {
          const valueArg = a.value.value.args?.find((arg) => arg.kind === 'keyed' && arg.key === 'value');
          if (valueArg?.value?.type === 'array' && valueArg.value.value?.length > 0) {
            argumentNames.push(valueArg.value.value[0]?.value || '');
          } else {
            argumentNames.push('');
          }

          if (a.value.value.callee.name === 'argument_reporter_boolean') {
            argumentDefaults.push('false');
          } else {
            argumentDefaults.push('');
          }
        } else {
          argumentNames.push('');
          argumentDefaults.push('');
        }

        node.inputs[argId] = valueToInput(a.value, ids, blocks);
      }
    }

    const proccode = argumentNames.map((name) => (name ? `${name} %s` : '%s')).join(' ');

    node.mutation = {
      tagName: 'mutation',
      children: [],
      proccode,
      argumentids: JSON.stringify(argumentIds),
      argumentnames: JSON.stringify(argumentNames),
      argumentdefaults: JSON.stringify(argumentDefaults),
      warp: 'false',
    };
  } else {
    for (const a of call.args) {
      if (a.kind === 'keyed') {
        const isBracket = /[^A-Za-z0-9_]/.test(a.key);
        let keyName = isBracket ? a.key : a.key.toUpperCase();
        if ((node.opcode === 'control_if' || node.opcode === 'control_if_else') && a.key === 'CONDITION') {
          keyName = 'CONDITION';
        }
        node.inputs[keyName] = valueToInput(a.value, ids, blocks);
      } else if (a.kind === 'object' && a.value) {
        for (const [k, v] of Object.entries(a.value)) {
          if (v?.type === 'thunk') {
            const { blocks: sub, topId } = buildBlocksFromCalls(v.body, {
              proceduresMapForTarget: proceduresMap,
            });
            Object.assign(blocks, sub);
            const wireKey = mapBranchKey(node.opcode, k);
            node.inputs[wireKey] = [2, topId];

            let cursor = topId;
            while (cursor) {
              if (!blocks[cursor]) break;
              blocks[cursor].parent = node.id;
              cursor = blocks[cursor].next;
            }
          }
        }
      }
    }
  }
  return node;
}

function valueToInput(val, ids, blocks) {
  if (!val) return [3, [10, '']];
  switch (val.type) {
    case 'null':
      return [3, [10, '']];
    case 'number':
      return [3, [4, String(val.value)]];
    case 'string':
      return [3, [10, String(val.value)]];
    case 'boolean':
      return [3, [10, String(val.value)]]; // Scratch booleans often as reporters; leave as string
    case 'var':
      return [3, [12, val.name, val.id || null]];
    case 'list':
      return [3, [13, val.name, val.id || null]];
    case 'array':
      return [3, val.value];
    case 'call': {
      const childId = ids.next();
      const node = buildNode(val.value, ids, blocks);
      blocks[childId] = { id: childId, ...node };
      return [2, childId];
    }
    default:
      return [3, [10, '']];
  }
}

export class IdGen {
  constructor() {
    this.n = 0;
  }
  next() {
    this.n += 1;
    return this.peek();
  }
  peek() {
    return base62(this.n);
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

function mapBranchKey(opcode, key) {
  if (opcode === 'control_if' || opcode === 'control_if_else') {
    if (key === 'then') return 'SUBSTACK';
    if (key === 'else') return 'SUBSTACK2';
  }
  if (opcode === 'control_switch') {
    if (key === 'cases') return 'SUBSTACK';
  }
  return key.toUpperCase();
}

export function mergeIntoManifest(manifest, builtTargets) {
  const clone = JSON.parse(JSON.stringify(manifest));
  for (const bt of builtTargets) {
    const t = clone.targets.find((x) => x.name === bt.name);
    if (!t) continue;
    const originalBlocks = t.blocks || {};

    if (bt.scripts && Array.isArray(bt.scripts)) {
      for (const script of bt.scripts) {
        const { oldTopId, blocks: newSubgraph } = script;
        if (!newSubgraph || !Object.keys(newSubgraph).length) continue;
        if (oldTopId && originalBlocks[oldTopId]) {
          const toDelete = new Set(Object.keys(collectBlocksSubgraph(originalBlocks, oldTopId)));

          const incoming = findIncomingEdge(originalBlocks, oldTopId);

          for (const id of toDelete) delete originalBlocks[id];

          for (const [nid, nb] of Object.entries(newSubgraph)) {
            originalBlocks[nid] = nb;
          }

          const newTopId = script.newTopId || findTopIdFromBlocks(newSubgraph) || Object.keys(newSubgraph)[0];
          if (incoming && originalBlocks[incoming.owner]) {
            if (incoming.kind === 'next') {
              originalBlocks[incoming.owner].next = newTopId;
            } else if (incoming.kind === 'input') {
              const tuple = originalBlocks[incoming.owner].inputs?.[incoming.input];
              if (Array.isArray(tuple) && tuple.length >= 2) tuple[1] = newTopId;
            }
          }

          if (!incoming) {
            if (originalBlocks[newTopId]) {
              originalBlocks[newTopId].topLevel = true;
            }
          }
        } else {
          for (const [nid, nb] of Object.entries(newSubgraph)) {
            originalBlocks[nid] = nb;
          }
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

export function writeProjectJson(dir, manifest) {
  const out = path.join(dir, 'project.json');
  fs.writeFileSync(out, JSON.stringify(manifest, null, 2));
  return out;
}
