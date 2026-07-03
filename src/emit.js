import { stringifyBlockCall, stringifyFields, stringifyInputs, setContext, renderBody, commentDeclLine } from './stringify.js';
import { synthesizeProccode } from './buildBlocks.js';

export function emitScriptFile({ target, script, subgraph, index, context, cfg = {} }) {
  const body = emitScriptBody({ script, subgraph, context, cfg });
  const header = scriptHeader({ target, script, subgraph, index });
  const blocksArr = linearize(subgraph, script.topBlockId);
  const imports = deriveImports(blocksArr, context);

  return `${header}\n${imports}${imports ? '\n' : ''}${body}\n`;
}

export function emitMultiScriptFile({ target, entries, context, cfg = {}, includeAssets = false, prelude = '' }) {
  const header =
    `/**\n` +
    ` * target: ${escapeHeader(target.name)}\n` +
    ` * targetId: ${escapeHeader(target.id ?? '')}\n` +
    ` * scripts: ${entries.length}\n` +
    ` */\n`;
  const assets = includeAssets ? emitAssetDecls(target) : '';
  const bodies = entries.map(({ script, subgraph }) => emitScriptBody({ script, subgraph, context, cfg }));
  return `${header}\n${[prelude, assets, bodies.join('\n\n')].filter(Boolean).join('\n\n')}\n`;
}

// One human-named file per distinct asset: md5ext -> "assets/<name>.<ext>".
// Shared by the asset extractor (assets.js) and the declaration emitter so
// the file on disk and the `file` attribute always agree.
export function targetAssetFiles(target) {
  const used = new Set();
  const map = new Map();
  for (const asset of [...(target.costumes || []), ...(target.sounds || [])]) {
    const md5ext = asset.md5ext || (asset.assetId && `${asset.assetId}.${asset.dataFormat || ''}`);
    if (!md5ext || map.has(md5ext)) continue;
    const ext = asset.dataFormat || String(md5ext).split('.').pop() || 'dat';
    const base = String(asset.name ?? 'asset').replace(/[^a-zA-Z0-9-_]/g, '_') || 'asset';
    let file = `${base}.${ext}`;
    let n = 2;
    while (used.has(file)) file = `${base}_${n++}.${ext}`;
    used.add(file);
    map.set(md5ext, `assets/${file}`);
  }
  return map;
}

function emitAssetDecls(target) {
  const fileMap = targetAssetFiles(target);
  const fileFor = (asset) => {
    const md5ext = asset.md5ext || (asset.assetId && `${asset.assetId}.${asset.dataFormat || ''}`);
    return fileMap.get(md5ext) || `assets/${md5ext || 'missing'}`;
  };
  const lines = [];
  const currentIndex = Number(target.currentCostume) || 0;
  (target.costumes || []).forEach((c, i) => {
    const parts = [`costume ${JSON.stringify(String(c.name ?? ''))}`, `file ${JSON.stringify(fileFor(c))}`];
    parts.push(`center ${numText(c.rotationCenterX)},${numText(c.rotationCenterY)}`);
    if (c.bitmapResolution != null && c.bitmapResolution !== 1) parts.push(`bitmap ${numText(c.bitmapResolution)}`);
    if (i === currentIndex && currentIndex !== 0) parts.push('current');
    lines.push(parts.join(' ') + ';');
  });
  for (const s of target.sounds || []) {
    const parts = [`sound ${JSON.stringify(String(s.name ?? ''))}`, `file ${JSON.stringify(fileFor(s))}`];
    if (s.rate != null) parts.push(`rate ${numText(s.rate)}`);
    if (s.sampleCount != null) parts.push(`samples ${numText(s.sampleCount)}`);
    if (s.format) parts.push(`format ${JSON.stringify(String(s.format))}`);
    lines.push(parts.join(' ') + ';');
  }
  return lines.join('\n');
}

function numText(n) {
  const v = Number(n);
  return Number.isFinite(v) ? String(v) : '0';
}

// Everything manifest.json used to carry, as declarations at the top of the
// target's main.fractch: sprite/stage properties, extension `use` lines,
// platform meta, variable/list initial values, watchers, and workspace
// comments. The DSL text is the only copy - there is no manifest fallback.
export function emitTargetPrelude({ projectJson, target, monitors = [], workspaceComments = [] }) {
  const lines = [];

  if (target.isStage) {
    const attrs = [];
    if (numOr(target.volume, 100) !== 100) attrs.push(`volume ${numText(target.volume)}`);
    if (numOr(target.tempo, 60) !== 60) attrs.push(`tempo ${numText(target.tempo)}`);
    const video = target.videoState ?? 'on';
    if (video !== 'on') attrs.push(`video ${/^[a-z]+$/.test(video) ? video : JSON.stringify(String(video))}`);
    if (numOr(target.videoTransparency, 50) !== 50) attrs.push(`transparency ${numText(target.videoTransparency)}`);
    if (target.textToSpeechLanguage) attrs.push(`tts ${JSON.stringify(String(target.textToSpeechLanguage))}`);
    if (attrs.length) lines.push(`stage ${attrs.join(' ')};`);

    const plat = projectJson?.meta?.platform;
    if (plat?.name) {
      lines.push(`platform ${JSON.stringify(String(plat.name))}${plat.url ? ` from ${JSON.stringify(String(plat.url))}` : ''};`);
    }
    const urls = projectJson?.extensionURLs || {};
    for (const id of projectJson?.extensions || []) {
      lines.push(urls[id] ? `use ${JSON.stringify(id)} from ${JSON.stringify(String(urls[id]))};` : `use ${JSON.stringify(id)};`);
    }
  } else {
    const attrs = [JSON.stringify(String(target.name ?? ''))];
    if (numOr(target.x, 0) !== 0 || numOr(target.y, 0) !== 0) attrs.push(`at ${numText(target.x)},${numText(target.y)}`);
    if (numOr(target.size, 100) !== 100) attrs.push(`size ${numText(target.size)}`);
    if (numOr(target.direction, 90) !== 90) attrs.push(`direction ${numText(target.direction)}`);
    if (target.visible === false) attrs.push('hidden');
    if (target.draggable === true) attrs.push('draggable');
    if (target.rotationStyle && target.rotationStyle !== 'all around') attrs.push(`rotation ${JSON.stringify(String(target.rotationStyle))}`);
    if (numOr(target.volume, 100) !== 100) attrs.push(`volume ${numText(target.volume)}`);
    if (target.layerOrder != null) attrs.push(`layer ${numText(target.layerOrder)}`);
    lines.push(`sprite ${attrs.join(' ')};`);
  }

  // Scratch tolerates duplicate display names across distinct ids, and blocks
  // reference the extras by id. Every member of a name-collision group keeps
  // its id in the declaration so pack recreates each one under the id the
  // block references actually use; unique names stay clean.
  const nameCounts = (dict) => {
    const counts = new Map();
    for (const entry of Object.values(dict || {})) {
      if (!Array.isArray(entry)) continue;
      const n = String(entry[0]);
      counts.set(n, (counts.get(n) || 0) + 1);
    }
    return counts;
  };
  const varCounts = nameCounts(target.variables);
  for (const [id, entry] of Object.entries(target.variables || {})) {
    if (!Array.isArray(entry)) continue;
    const [name, value, isCloud] = entry;
    // `local x = ...` script-locals pack to mangled local_N_x variables;
    // pack regenerates them (same deterministic names) from the `local`
    // statements, so declaring them here would only leak noise.
    if (/^local_\d+_/.test(String(name))) continue;
    const idSuffix = varCounts.get(String(name)) > 1 ? ` id ${JSON.stringify(String(id))}` : '';
    if (isCloud === true && String(name).startsWith('☁ ')) {
      lines.push(`cloud ${varNameToken(String(name).slice(2))} = ${varValueText(value)}${idSuffix};`);
    } else {
      lines.push(`var ${varNameToken(name)} = ${varValueText(value)}${idSuffix};`);
    }
  }
  const listCounts = nameCounts(target.lists);
  for (const [id, entry] of Object.entries(target.lists || {})) {
    if (!Array.isArray(entry)) continue;
    const [name, value] = entry;
    const idSuffix = listCounts.get(String(name)) > 1 ? ` id ${JSON.stringify(String(id))}` : '';
    lines.push(`var ${varNameToken(name)} = ${JSON.stringify(Array.isArray(value) ? value : [])}${idSuffix};`);
  }

  for (const w of monitors) {
    const line = watchDeclLine(w);
    if (line) lines.push(line);
  }

  for (const c of workspaceComments) {
    lines.push(commentDeclLine(c));
  }

  return lines.join('\n');
}

function numOr(v, dflt) {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

const BARE_VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function varNameToken(name) {
  const s = String(name ?? '');
  return BARE_VAR_NAME.test(s) ? s : JSON.stringify(s);
}

function varValueText(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return JSON.stringify(v);
  return JSON.stringify(String(v ?? ''));
}

// w: { isList, name, mode, x, y, width, height, visible, sliderMin,
//      sliderMax, isDiscrete, sprite, id } - sprite/id only for watchers
// whose owner target no longer exists (preserved verbatim).
function watchDeclLine(w) {
  const parts = [`watch ${w.isList ? 'list' : 'var'} ${JSON.stringify(String(w.name ?? ''))}`];
  if (w.mode === 'large' || w.mode === 'slider') parts.push(w.mode);
  if (numOr(w.x, 0) !== 0 || numOr(w.y, 0) !== 0) parts.push(`at ${numText(w.x)},${numText(w.y)}`);
  if (numOr(w.width, 0) !== 0 || numOr(w.height, 0) !== 0) parts.push(`size ${numText(w.width)}x${numText(w.height)}`);
  if (!w.isList) {
    if (numOr(w.sliderMin, 0) !== 0 || numOr(w.sliderMax, 100) !== 100) parts.push(`range ${numText(w.sliderMin)},${numText(w.sliderMax)}`);
    if (w.isDiscrete === false) parts.push('continuous');
  }
  if (w.visible === false) parts.push('hidden');
  if (w.sprite) parts.push(`sprite ${JSON.stringify(String(w.sprite))}`);
  if (w.id) parts.push(`id ${JSON.stringify(String(w.id))}`);
  return parts.join(' ') + ';';
}

function emitScriptBody({ script, subgraph, context, cfg = {} }) {
  const { topBlockId, hatOpcode } = script;

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
    let inner = subgraph[topBlockId]?.next ? renderBody(subgraph, subgraph[topBlockId].next, cfg) : '';
    inner = prependOwnComments(context, topBlockId, inner);
    const at = atText(subgraph[topBlockId]);
    body = inner ? `${sig}${at} {\n${indentBlock(inner)}\n}` : `${sig}${at} {}`;
  } else {
    const top = subgraph[topBlockId];
    const sugar = top ? whenSugarFor(top, context) : null;
    if (sugar) {
      let rest = top.next ? renderBody(subgraph, top.next, cfg) : '';
      rest = prependOwnComments(context, topBlockId, rest);
      body = `when ${sugar}${atText(top)} {\n${indentBlock(rest)}\n}`;
    } else {
      const inner = renderFallbackBody(subgraph, topBlockId, cfg, context);
      body = `script${atText(top)} {\n${indentBlock(inner)}\n}`;
    }
  }

  return body;
}

function scriptHeader({ target, script, subgraph, index }) {
  const { topBlockId, hatOpcode } = script;
  return (
    `/**\n` +
    ` * target: ${escapeHeader(target.name)}\n` +
    ` * targetId: ${escapeHeader(target.id ?? '')}\n` +
    ` * topBlockId: ${escapeHeader(topBlockId)}\n` +
    ` * hatOpcode: ${escapeHeader(hatOpcode || '')}\n` +
    ` * threadIndex: ${index}\n` +
    ` * pos: ${Math.round(subgraph[topBlockId]?.x ?? 0)},${Math.round(subgraph[topBlockId]?.y ?? 0)}\n` +
    ` */\n`
  );
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
      const shortRel = (f.targetRel || f.rel
        .split('/')
        .slice(-2)
        .join('/'))
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

function renderFallbackBody(subgraph, topId, cfg, context) {
  const ids = linearizeIds(subgraph, topId);
  const lines = ids.map((id, index) => {
    const block = subgraph[id];
    let line = index === 0 && needsExplicitTopOpcode(block)
      ? stringifyRawBlockCall(block, subgraph)
      : stringifyBlockCall(block, subgraph, id, false, cfg);
    const attached = context?.blockComments?.get(id);
    if (attached?.length) line += '\n' + attached.map((c) => commentDeclLine(c)).join('\n');
    return line;
  });
  return lines.join('\n');
}

// A comment anchored on the hat/def block itself prints as the first body
// line; the parser re-attaches a leading comment to the enclosing hat.
function prependOwnComments(context, topBlockId, bodyText) {
  const own = context?.blockComments?.get(topBlockId);
  if (!own?.length) return bodyText;
  const lines = own.map((c) => commentDeclLine(c)).join('\n');
  return bodyText ? `${lines}\n${bodyText}` : lines;
}

function linearizeIds(subgraph, topId) {
  const ids = [];
  let cursor = topId;
  while (cursor) {
    const node = subgraph[cursor];
    if (!node) break;
    ids.push(cursor);
    cursor = node.next;
  }
  return ids;
}

function needsExplicitTopOpcode(block) {
  // argument_reporter_string_number is absent: its orphans round-trip via
  // the arg("name") statement sugar instead of the raw opcode form.
  return block && ['argument_reporter_boolean', 'data_variable'].includes(block.opcode);
}

function stringifyRawBlockCall(block, subgraph) {
  const argParts = [];
  const inputsStr = stringifyInputs(block, subgraph, true);
  const fieldsStr = stringifyFields(block);
  if (inputsStr) argParts.push(inputsStr);
  if (fieldsStr) argParts.push(fieldsStr);
  if (block.mutation) argParts.push(`mutation: ${JSON.stringify(block.mutation)}`);
  return `${formatOpcodeName(block.opcode)}(${argParts.join(', ')});`;
}

function formatOpcodeName(opcode) {
  const s = String(opcode || '');
  const m = /^([A-Za-z][A-Za-z0-9]*)_(.+)$/.exec(s);
  if (!m) return s;
  const [, namespace, rest] = m;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(rest)) return s;
  return `${namespace}.${rest}`;
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
  const pad = ' '.repeat(spaces);
  let inRaw = false; // lines inside an open """ raw string stay verbatim
  return str
    .split('\n')
    .map((l) => {
      const out = l && !inRaw ? pad + l : l;
      if (((l.match(/"""/g) || []).length) % 2) inRaw = !inRaw;
      return out;
    })
    .join('\n');
}

function escapeLabel(s) {
  return String(s).replace(/[\r\n]+/g, ' ');
}
