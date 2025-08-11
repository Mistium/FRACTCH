import { stringifyBlockCall } from './stringify.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export function emitScriptFile({ target, script, subgraph, index, context }) {
  const { topBlockId, hatOpcode } = script;
  const blocksArr = linearize(subgraph, topBlockId);

  const bodyLines = [];
  const cfg = readConfig();
  for (const id of idsFromLinear(subgraph, topBlockId)) {
    bodyLines.push(stringifyBlockCall(subgraph[id], subgraph, id, /*inline*/ false, cfg));
  }

  const body = bodyLines.join('\n');

  const dslBodyHash = sha256(body);
  const header =
    `/**\n` +
    ` * target: ${escapeHeader(target.name)}\n` +
    ` * targetId: ${escapeHeader(target.id ?? '')}\n` +
    ` * topBlockId: ${escapeHeader(topBlockId)}\n` +
    ` * hatOpcode: ${escapeHeader(hatOpcode || '')}\n` +
    ` * dslBodyHash: ${dslBodyHash}\n` +
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

function idsFromLinear(subgraph, topId) {
  const arr = [];
  let cursor = topId;
  while (cursor) {
    const node = subgraph[cursor];
    if (!node) break;
    arr.push(cursor);
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

function escapeLabel(s) {
  return String(s).replace(/[\r\n]+/g, ' ');
}

function sha256(text) {
  try {
    return crypto
      .createHash('sha256')
      .update(text || '', 'utf8')
      .digest('hex');
  } catch {
    return '';
  }
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
