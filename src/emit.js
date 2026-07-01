import { stringifyBlockCall, setContext, renderBody } from './stringify.js';
import fs from 'fs';
import path from 'path';

export function emitScriptFile({ target, script, subgraph, index, context }) {
  const { topBlockId, hatOpcode } = script;
  const blocksArr = linearize(subgraph, topBlockId);

  const cfg = readConfig();
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
    body = inner ? `${sig} {\n${indentBlock(inner)}\n}` : `${sig} {}`;
  } else {
    body = renderBody(subgraph, topBlockId, cfg);
  }

  const header =
    `/**\n` +
    ` * target: ${escapeHeader(target.name)}\n` +
    ` * targetId: ${escapeHeader(target.id ?? '')}\n` +
    ` * topBlockId: ${escapeHeader(topBlockId)}\n` +
    ` * hatOpcode: ${escapeHeader(hatOpcode || '')}\n` +
    ` * threadIndex: ${index}\n` +
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
  if (!info) return `def @proc() warp=${warp}`;
  const params = info.params
    .map((p) => (p.name != null && p.name !== p.ident ? `${p.ident}(${JSON.stringify(p.name)})` : p.ident))
    .join(', ');
  const codeLit = code != null ? ` ${JSON.stringify(code)}` : '';
  return `def @${info.ident}(${params})${codeLit} warp=${warp}`;
}

function indentBlock(str, spaces = 2) {
  if (!str) return '';
  return str.split('\n').map((l) => (l ? ' '.repeat(spaces) + l : l)).join('\n');
}

function escapeLabel(s) {
  return String(s).replace(/[\r\n]+/g, ' ');
}

function readConfig() {
  try {
    const cwd = process.cwd();
    const p = path.join(cwd, 'fractch.config.json');
    if (!fs.existsSync(p)) return {};
    const text = fs.readFileSync(p, 'utf8');
    const json = JSON.parse(text || '{}');
    return json || {};
  } catch {
    return {};
  }
}
