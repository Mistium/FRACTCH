import { stringifyBlockCall, setContext, renderBody } from './stringify.js';
import { synthesizeProccode } from './buildBlocks.js';

export function emitScriptFile({ target, script, subgraph, index, context, cfg = {} }) {
  const { topBlockId, hatOpcode } = script;
  const blocksArr = linearize(subgraph, topBlockId);

  setContext(context);

  let body;
  if (hatOpcode === 'procedures_definition' && context?.procByCode) {
    const sig = defSignature(subgraph[topBlockId], subgraph, context);
    // Two params can share a display name that only collides after
    // cleanIdent strips punctuation (e.g. "X" and "+X" both -> "X") -
    // buildProcByCode already disambiguates them for the signature
    // (X, X_2); body references must resolve to the SAME per-param ident
    // (matched by exact original display name), or the second param's
    // reporter blocks render as the first param's identifier instead.
    const info = procInfoFor(subgraph[topBlockId], subgraph, context);
    if (info) {
      const scopeParamNames = new Map(info.params.map((p) => [p.name, p.ident]));
      setContext({ ...context, scopeParamNames });
    }
    const inner = subgraph[topBlockId]?.next ? renderBody(subgraph, subgraph[topBlockId].next, cfg) : '';
    const at = atText(subgraph[topBlockId]);
    body = inner ? `${sig}${at} {\n${indentBlock(inner)}\n}` : `${sig}${at} {}`;
  } else {
    const top = subgraph[topBlockId];
    const sugar = top ? whenSugarFor(top, context) : null;
    if (sugar) {
      const rest = top.next ? renderBody(subgraph, top.next, cfg) : '';
      body = `when ${sugar}${atText(top)} {\n${indentBlock(rest)}\n}`;
    } else {
      body = renderBody(subgraph, topBlockId, cfg);
    }
  }

  const header =
    `/**\n` +
    ` * target: ${escapeHeader(target.name)}\n` +
    ` * targetId: ${escapeHeader(target.id ?? '')}\n` +
    ` * topBlockId: ${escapeHeader(topBlockId)}\n` +
    ` * hatOpcode: ${escapeHeader(hatOpcode || '')}\n` +
    ` * threadIndex: ${index}\n` +
    ` * pos: ${Math.round(subgraph[topBlockId]?.x ?? 0)},${Math.round(subgraph[topBlockId]?.y ?? 0)}\n` +
    ` */\n`;

  const imports = deriveImports(blocksArr, context);

  return `${header}\n${imports}${imports ? '\n' : ''}${body}\n`;
}

export function emitIndex(files) {
  const header = `/**\n * fractch index for all targets and scripts\n * count: ${files.length}\n */\n`;
  const imports = files
    .map((f) => {
      const base = `import "${f.rel.replace(/\\.js$/i, '.fractch')}";`;
      if (f.hatOpcode === 'procedures_definition' && f.label) {
        return `${base} // ${escapeLabel(f.label)}`;
      }
      return base;
    })
    .join('\n');
  return `${header}\n${imports}\n`;
}

export function emitTargetIndex(targetFiles) {
  const header = `/**\n * fractch index for target\n * scripts: ${targetFiles.length}\n */\n`;
  const imports = targetFiles
    .map((f) => {
      const shortRel = f.rel
        .split('/')
        .slice(-2)
        .join('/')
        .replace(/\\.js$/i, '.fractch');
      const base = `import "${shortRel}";`;
      if (f.hatOpcode === 'procedures_definition' && f.label) {
        return `${base} // ${escapeLabel(f.label)}`;
      }
      return base;
    })
    .join('\n');
  return `${header}\n${imports}\n`;
}

function linearize(subgraph, topId) {
  const arr = [];
  let cursor = topId;
  while (cursor) {
    const node = subgraph[cursor];
    if (!node) break;
    arr.push(node);
    cursor = node.next;
  }
  return arr;
}

function escapeHeader(s) {
  return String(s).replace(/\*/g, '\\*');
}

function deriveImports(blocksArr, context) {
  if (!context) return '';
  const lines = new Set();

  for (const b of blocksArr) {
    if (b.opcode === 'procedures_call') {
      const code = b.mutation?.proccode;
      if (code) {
        const procName = code;
        lines.add(`import "../procedures_definition/${sanitize(procName)}.fractch";`);
      }
    }
    if (b.opcode === 'event_broadcast' || b.opcode === 'event_broadcastandwait') {
      const name = b.inputs?.BROADCAST_INPUT?.[1] && b.inputs.BROADCAST_INPUT[1];
      if (typeof name === 'string') {
        const listeners = context.broadcastMap.get(name) || [];
        for (const l of listeners) {
          lines.add(`import "../event_whenbroadcastreceived/${sanitize(l.topBlockId)}.fractch";`);
        }
      }
    }
  }
  return Array.from(lines).join('\n');
}

function sanitize(name) {
  return String(name).replace(/[^a-zA-Z0-9-_]/g, '_');
}

function procInfoFor(defBlock, subgraph, context) {
  const protoId = defBlock?.inputs?.custom_block?.[1];
  const proto = protoId ? subgraph[protoId] : undefined;
  const code = proto?.mutation?.proccode;
  return code && context.procByCode?.get(code);
}

function defSignature(defBlock, subgraph, context) {
  const protoId = defBlock?.inputs?.custom_block?.[1];
  const proto = protoId ? subgraph[protoId] : undefined;
  const code = proto?.mutation?.proccode;
  const info = procInfoFor(defBlock, subgraph, context);
  const warp = proto?.mutation?.warp === true || proto?.mutation?.warp === 'true';
  const warpLit = warp ? ' warp' : '';
  if (!info) return `def @proc()${warpLit}`;
  const params = info.params
    .map((p) => (p.name != null && p.name !== p.ident ? `${p.ident}(${JSON.stringify(p.name)})` : p.ident))
    .join(', ');
  const derivable =
    code != null &&
    code === synthesizeProccode(info.ident, info.params.length) &&
    info.params.every((p) => p.name === p.ident);
  const codeLit = code != null && !derivable ? ` ${JSON.stringify(code)}` : '';
  const color = proto?.mutation?.customcolor;
  const colorLit = color ? ` color=${JSON.stringify(String(color))}` : '';
  // returns=1 (round reporter) is derived from expression position at pack
  // time; only the boolean shape needs to be spelled out.
  const returnsLit = info.returns === '2' ? ' returns=2' : '';
  return `def @${info.ident}(${params})${codeLit}${warpLit}${returnsLit}${colorLit}`;
}

function atText(block) {
  if (!block || !block.topLevel) return '';
  return ` at ${Math.round(block.x ?? 0)},${Math.round(block.y ?? 0)}`;
}

const BARE_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function nameToken(name) {
  return BARE_NAME_RE.test(name) && name !== 'at' ? name : JSON.stringify(name);
}

// Hat blocks with a `when` sugar spelling. Anything not here (extension
// hats, orphan chains) keeps the plain call-chain format, which the parser
// still accepts - and hand-written files can use `when <any.call()> { }`.
function whenSugarFor(block, context) {
  const op = block.opcode;
  const fields = block.fields || {};
  const inputs = Object.keys(block.inputs || {});
  if (inputs.length || block.mutation) return null;
  const fieldKeys = Object.keys(fields);
  if (op === 'event_whenflagclicked' && !fieldKeys.length) return 'flag';
  if (op === 'control_start_as_clone' && !fieldKeys.length) return 'clone';
  if (op === 'event_whenthisspriteclicked' && !fieldKeys.length) return 'clicked';
  if (op === 'event_whenbroadcastreceived' && fieldKeys.length === 1 && fieldKeys[0] === 'BROADCAST_OPTION') {
    const [name, id] = fields.BROADCAST_OPTION;
    if (typeof name !== 'string') return null;
    if (id != null && !(context?.broadcastNameToId && context.broadcastNameToId.get(name) === id)) return null;
    return `broadcast ${nameToken(name)}`;
  }
  if (op === 'event_whenkeypressed' && fieldKeys.length === 1 && fieldKeys[0] === 'KEY_OPTION') {
    const name = fields.KEY_OPTION[0];
    if (typeof name !== 'string') return null;
    return `key ${nameToken(name)}`;
  }
  if (op === 'event_whenbackdropswitchesto' && fieldKeys.length === 1 && fieldKeys[0] === 'BACKDROP') {
    const name = fields.BACKDROP[0];
    if (typeof name !== 'string') return null;
    return `backdrop ${nameToken(name)}`;
  }
  return null;
}

function indentBlock(str, spaces = 2) {
  if (!str) return '';
  return str.split('\n').map((l) => (l ? ' '.repeat(spaces) + l : l)).join('\n');
}

function escapeLabel(s) {
  return String(s).replace(/[\r\n]+/g, ' ');
}
