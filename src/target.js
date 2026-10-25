import { parseFractch, closestMatch, STATEMENT_KEYWORDS } from './parse.js';
import { buildBlocksFromCalls, collapseOperators, IdGen, synthesizeProccode } from './buildBlocks.js';
import { emitScriptBody, varNameToken, varValueText, watchDeclLine, indentBlock } from './emit.js';
import { commentDeclLine, EXTENDABLE_OPERATORS, freeCommentText } from './stringify.js';
import { hiddenShadowToWrite, sameHiddenShadow } from './shadowDefaults.js';
import { buildProcByCode, routeMonitors, topLevelPrimitiveBlock } from './convert.js';
import { groupTopLevelScripts, collectBlocksSubgraph, isMenuShadow } from './graph.js';
import {
  buildNameIdMap,
  collectLocalDeclNames,
  registerProcDefs,
  stackProcDef,
  rewriteIdentOrMethod,
  stackBaseName,
  stdlibRegistry,
  stdlibUsed,
} from './pack.js';
import {
  MEMBERSHIP_COMMENT_ID,
  commentBeforeAnchors,
  commentText,
  isLegacyMarkerComment,
  isMembershipComment,
  isReservedComment,
  membershipText,
  readMembership,
  splitCommentText,
  statementAnchor,
} from './membership.js';
import { STDLIB_MODULES, STDLIB_METHODS, resolveStdlibModules } from './stdlib/index.js';
import { diagnostic, makeLineIndex, rangeExtra } from './diagnostics.js';
import { KNOWN_OPCODES, MENU_OPCODES, VALIDATED_NAMESPACES } from './knownOpcodes.js';
import {
  BUILTIN_SIGNATURES,
  coreSignature,
  isStatementType,
  isValueType,
  normalizeOpcodeTable,
  normalizeSignatures,
  shadowTypeCode,
} from './signatures.js';

const PRIMITIVE_OPCODES = {
  math_number: [4, 'NUM'],
  math_positive_number: [5, 'NUM'],
  math_whole_number: [6, 'NUM'],
  math_integer: [7, 'NUM'],
  math_angle: [8, 'NUM'],
  colour_picker: [9, 'COLOUR'],
  text: [10, 'TEXT'],
  event_broadcast_menu: [11, 'BROADCAST_OPTION'],
  data_variable: [12, 'VARIABLE'],
  data_listcontents: [13, 'LIST'],
};

const BUILTIN_NAMESPACES = new Set([
  'motion',
  'looks',
  'sound',
  'event',
  'control',
  'sensing',
  'operator',
  'data',
  'procedures',
  'argument',
  'math',
  'colour',
  'text',
  'json',
  'patching',
]);

const ASSET_MENUS = {
  looks_costume: { field: 'COSTUME', list: 'costumes', kind: 'costume', stage: false, specials: [] },
  looks_backdrops: {
    field: 'BACKDROP',
    list: 'costumes',
    kind: 'backdrop',
    stage: true,
    specials: ['next backdrop', 'previous backdrop', 'random backdrop'],
  },
  sound_sounds_menu: { field: 'SOUND_MENU', list: 'sounds', kind: 'sound', stage: false, specials: [] },
};

const LIST_KEEP_ITEMS = 100;
const LIST_KEEP_BYTES = 4096;
const LOCAL_RE = /^!local_([A-Za-z0-9]+)_(.+)$/;
const TEMP_PREFIX = '\u0000';

const VALUE_OPCODES = new Set([
  'motion_xposition',
  'motion_yposition',
  'motion_direction',
  'looks_size',
  'looks_costumenumbername',
  'looks_backdropnumbername',
  'sound_volume',
  'sensing_touchingobject',
  'sensing_touchingcolor',
  'sensing_coloristouchingcolor',
  'sensing_distanceto',
  'sensing_answer',
  'sensing_keypressed',
  'sensing_mousedown',
  'sensing_mousex',
  'sensing_mousey',
  'sensing_loudness',
  'sensing_timer',
  'sensing_of',
  'sensing_current',
  'sensing_dayssince2000',
  'sensing_username',
  'data_variable',
  'data_listcontents',
  'data_itemoflist',
  'data_itemnumoflist',
  'data_lengthoflist',
  'data_listcontainsitem',
  'argument_reporter_string_number',
  'argument_reporter_boolean',
]);

export function defaultUid() {
  const soup = '!#%()*+,-./:;=?@[]^_`{|}~ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 20; i++) id += soup[(Math.random() * soup.length) | 0];
  return id;
}

function withContextDefaults(context, opts) {
  return {
    ...opts,
    extensions: opts.extensions ?? context?.extensionSignatures ?? null,
    opcodes: opts.opcodes ?? context?.opcodes ?? null,
  };
}

function contextMonitors(context) {
  const out = [...(context?.monitors || [])];
  const seen = new Set(out.map((m) => m?.id));
  for (const t of contextTargets(context)) {
    for (const m of t?.monitors || []) {
      if (m && !seen.has(m.id)) {
        seen.add(m.id);
        out.push(m);
      }
    }
  }
  return out;
}

export function contextTargets(context) {
  const t = context?.targets;
  if (Array.isArray(t)) return t;
  if (t && typeof t === 'object') return Object.values(t);
  return [];
}

export function findTarget(context, targetId) {
  const targets = contextTargets(context);
  return (
    targets.find((t) => t && t.id != null && t.id === targetId) || targets.find((t) => t && t.name === targetId) || null
  );
}

function targetKey(target) {
  return target?.id ?? target?.name;
}

export function isLiveContext(context) {
  if (context?.form) return context.form === 'live';
  if (context?.primitiveIds || context?.obscuredShadows) return true;
  return contextTargets(context).some((t) => t && (t.primitiveIds || t.obscuredShadows));
}

function compressPrimitive(block) {
  if (!block || typeof block !== 'object' || Array.isArray(block) || block.topLevel) return null;
  const info = PRIMITIVE_OPCODES[block.opcode];
  if (!info) return null;
  const field = block.fields?.[info[1]];
  if (!Array.isArray(field)) return null;
  const prim = [info[0], field[0]];
  if (info[0] >= 11) prim.push(field[1] ?? null);
  return prim;
}

function normalizeObscuredEntry(entry) {
  return Array.isArray(entry) ? entry : null;
}

const viewCache = new WeakMap();

export function targetView(context, target) {
  const cached = target && viewCache.get(target);
  if (cached && cached.context === context) return cached.view;
  const view = computeTargetView(context, target);
  if (target) viewCache.set(target, { context, view });
  return view;
}

function computeTargetView(context, target) {
  const raw = target?.blocks || {};
  const blocks = {};
  const arrayTops = new Set();
  for (const [id, b] of Object.entries(raw)) {
    if (Array.isArray(b)) {
      if (b[0] === 12 || b[0] === 13) {
        blocks[id] = topLevelPrimitiveBlock(b);
        arrayTops.add(id);
      }
      continue;
    }
    if (b && typeof b === 'object') blocks[id] = b;
  }
  const computed = {};
  const consumed = new Set();
  for (const [id, b] of Object.entries(blocks)) {
    if (!b.inputs || consumed.has(id)) continue;
    let inputs = null;
    for (const [name, tuple] of Object.entries(b.inputs)) {
      if (!Array.isArray(tuple)) continue;
      let next = null;
      for (let k = 1; k < tuple.length && k <= 2; k++) {
        const ref = tuple[k];
        if (typeof ref !== 'string') continue;
        const prim = compressPrimitive(blocks[ref]);
        if (!prim) continue;
        next = next || [...tuple];
        next[k] = prim;
        consumed.add(ref);
        ((computed[id] ||= {})[name] ||= {})[k === 1 ? 'block' : 'shadow'] = ref;
      }
      if (next) (inputs ||= { ...b.inputs })[name] = next;
    }
    if (inputs) blocks[id] = { ...b, inputs };
  }
  for (const id of consumed) delete blocks[id];
  const ctxPrim = context?.primitiveIds || {};
  const ownPrim = target?.primitiveIds || {};
  const ctxObs = context?.obscuredShadows || {};
  const ownObs = target?.obscuredShadows || {};
  const primitiveIds = {};
  const obscured = {};
  for (const id of Object.keys(blocks)) {
    const p = ownPrim[id] || ctxPrim[id];
    if (p && !computed[id]) {
      primitiveIds[id] = p;
    } else if (p || computed[id]) {
      primitiveIds[id] = {};
      for (const [name, entry] of Object.entries(p || {})) primitiveIds[id][name] = { ...entry };
      for (const [name, entry] of Object.entries(computed[id])) {
        primitiveIds[id][name] = { ...(primitiveIds[id][name] || {}), ...entry };
      }
    }
    const o = normalizeObscuredEntry(ownObs[id] ?? ctxObs[id]);
    if (o) obscured[id] = o;
  }
  return { target, blocks, primitiveIds, obscured, arrayTops, comments: target?.comments || {} };
}

function nameIdMap(dict) {
  return buildNameIdMap(dict);
}

function stageOf(context) {
  return contextTargets(context).find((t) => t && t.isStage) || null;
}

function broadcastIdMap(context, extra) {
  const map = new Map();
  for (const t of contextTargets(context)) {
    for (const [n, id] of nameIdMap(t?.broadcasts)) if (!map.has(n)) map.set(n, id);
  }
  if (extra) for (const [n, id] of extra) if (!map.has(n)) map.set(n, id);
  return map;
}

const membershipCache = new WeakMap();

function membershipFor(view) {
  if (!membershipCache.has(view)) membershipCache.set(view, readMembership({ ...view.target, blocks: view.blocks }));
  return membershipCache.get(view);
}

const scriptsCache = new WeakMap();

function collectScripts(view) {
  if (!scriptsCache.has(view)) scriptsCache.set(view, computeScripts(view));
  return scriptsCache.get(view);
}

function computeScripts(view) {
  const blocks = view.blocks;
  const scripts = groupTopLevelScripts({ blocks });
  const covered = new Set();
  const out = [];
  for (const s of scripts) {
    const subgraph = collectBlocksSubgraph(blocks, s.topBlockId);
    for (const id of Object.keys(subgraph)) covered.add(id);
    out.push({ ...s, subgraph });
  }
  const orphans = [];
  for (const [id, b] of Object.entries(blocks)) {
    if (covered.has(id)) continue;
    if (!b || typeof b.opcode !== 'string') continue;
    if (isMenuShadow(b) || b.shadow) {
      orphans.push(id);
      continue;
    }
    const subgraph = collectBlocksSubgraph(blocks, id);
    for (const sid of Object.keys(subgraph)) covered.add(sid);
    out.push({ topBlockId: id, hatOpcode: b.opcode || null, subgraph, orphanChain: true });
  }
  return { scripts: out, orphans: orphans.filter((id) => !covered.has(id)) };
}

const procCache = new WeakMap();

function procByCodeFor(context, view) {
  if (!procCache.has(view)) procCache.set(view, computeProcByCode(context, view));
  return procCache.get(view);
}

function computeProcByCode(context, view) {
  const own = buildProcByCode([{ blocks: view.blocks }]);
  const missing = new Set();
  for (const b of Object.values(view.blocks)) {
    if (b?.opcode === 'procedures_call' && b.mutation?.proccode && !own.has(b.mutation.proccode)) {
      missing.add(b.mutation.proccode);
    }
  }
  if (missing.size) {
    const all = buildProcByCode(contextTargets(context).map((t) => targetView(context, t)));
    const used = new Set([...own.values()].map((v) => v.ident));
    for (const code of missing) {
      const info = all.get(code);
      if (!info) continue;
      let ident = info.ident;
      let n = 2;
      while (used.has(ident)) ident = `${info.ident}_${n++}`;
      used.add(ident);
      own.set(code, { ...info, ident });
    }
  }
  return own;
}

function attachedComments(view) {
  const blockComments = new Map();
  const floating = [];
  const blocks = view.blocks;
  for (const [id, c] of Object.entries(view.comments || {})) {
    if (!c || typeof c !== 'object') continue;
    if (isMembershipComment(c) || isReservedComment(c, view.target) || isLegacyMarkerComment(c)) continue;
    const decl = {
      id,
      text: commentText(c),
      x: c.x ?? 0,
      y: c.y ?? 0,
      width: c.width ?? 200,
      height: c.height ?? 200,
      minimized: !!c.minimized,
      forId: null,
    };
    const anchor = c.blockId && blocks[c.blockId] ? statementAnchor(blocks, c.blockId) : null;
    if (anchor) {
      if (!blockComments.has(anchor)) blockComments.set(anchor, []);
      blockComments.get(anchor).push(decl);
    } else {
      if (c.blockId) decl.forId = c.blockId;
      floating.push(decl);
    }
  }
  return { blockComments, floating };
}

function isHiddenVariable(name) {
  return /^!local_[A-Za-z0-9]+_/.test(String(name)) || /^local_\d+_/.test(String(name));
}

function listValueText(value, kept) {
  if (kept || value == null) return 'keep';
  const items = Array.isArray(value) ? value : [];
  if (items.length > LIST_KEEP_ITEMS) return 'keep';
  const text = JSON.stringify(items);
  return text.length > LIST_KEEP_BYTES ? 'keep' : text;
}

function declarationLines(target) {
  const lines = [];
  const varNames = new Map();
  const listNames = new Map();
  for (const entry of Object.values(target.variables || {})) {
    if (Array.isArray(entry)) varNames.set(entry[0], (varNames.get(entry[0]) || 0) + 1);
  }
  for (const entry of Object.values(target.lists || {})) {
    if (Array.isArray(entry)) listNames.set(entry[0], (listNames.get(entry[0]) || 0) + 1);
  }
  for (const [id, entry] of Object.entries(target.variables || {})) {
    if (!Array.isArray(entry)) continue;
    const [name, value, isCloud] = entry;
    if (typeof name !== 'string' || isHiddenVariable(name)) continue;
    const needsId = varNames.get(name) > 1;
    const idSuffix = needsId ? ` id ${JSON.stringify(String(id))}` : '';
    if (isCloud === true && String(name).startsWith('☁ ')) {
      lines.push({
        key: `var:${name}${needsId ? `#${id}` : ''}`,
        id,
        text: `cloud ${varNameToken(String(name).slice(2))} = ${varValueText(value)}${idSuffix};`,
      });
    } else {
      lines.push({
        key: `var:${name}${needsId ? `#${id}` : ''}`,
        id,
        text: `var ${varNameToken(name)} = ${varValueText(value)}${idSuffix};`,
      });
    }
  }
  for (const [id, entry] of Object.entries(target.lists || {})) {
    if (!Array.isArray(entry)) continue;
    const [name, value] = entry;
    if (typeof name !== 'string') continue;
    const kept = !!target.keptLists?.[id];
    const needsId = listNames.get(name) > 1 || (varNames.has(name) && listValueText(value, kept) === 'keep');
    const idSuffix = needsId ? ` id ${JSON.stringify(String(id))}` : '';
    lines.push({
      key: `list:${name}${needsId ? `#${id}` : ''}`,
      id,
      text: `var ${varNameToken(name)} = ${listValueText(value, kept)}${idSuffix};`,
    });
  }
  return lines;
}

function checkMarks(text) {
  let depth = 0;
  for (const m of text.matchAll(MARK_RE)) {
    const c = text.charCodeAt(m.index);
    if (c === 1) depth++;
    else if (c === 3 && --depth < 0) throw new Error('unbalanced source marks');
  }
  if (depth) throw new Error('unbalanced source marks');
}

const MARK_RE = new RegExp(`[${String.fromCharCode(1)}-${String.fromCharCode(3)}]`, 'g');

function extractMarks(text, offset, sink) {
  const parts = [];
  const stack = [];
  let length = 0;
  let last = 0;
  MARK_RE.lastIndex = 0;
  let m;
  while ((m = MARK_RE.exec(text))) {
    const i = m.index;
    if (i > last) {
      parts.push(text.slice(last, i));
      length += i - last;
    }
    const c = text.charCodeAt(i);
    let end = i + 1;
    if (c === 1) {
      const sep = text.indexOf('\u0002', i + 1);
      if (sep < 0) throw new Error('unbalanced source marks');
      stack.push({ id: text.slice(i + 1, sep), from: offset + length });
      end = sep + 1;
    } else if (c === 3) {
      const open = stack.pop();
      if (!open) throw new Error('unbalanced source marks');
      if (!sink[open.id]) sink[open.id] = { from: open.from, to: offset + length };
    } else {
      throw new Error('unbalanced source marks');
    }
    last = end;
    MARK_RE.lastIndex = end;
  }
  if (stack.length) throw new Error('unbalanced source marks');
  if (last < text.length) parts.push(text.slice(last));
  return parts.join('');
}

function addLines(map, index) {
  for (const range of Object.values(map)) {
    range.line = index.position(range.from).line;
    range.endLine = index.position(range.to).line;
  }
}

function fillUnmarked(blocks, ids, ranges) {
  for (const id of ids) {
    if (ranges[id]) continue;
    let cur = blocks[id]?.parent;
    for (let guard = 0; cur && guard < 10000; guard++) {
      if (ranges[cur]) {
        ranges[id] = { ...ranges[cur], via: cur };
        break;
      }
      cur = blocks[cur]?.parent;
    }
  }
}

export function emitTarget(context, targetId, inputOpts = {}) {
  const opts = withContextDefaults(context, inputOpts);
  const target = findTarget(context, targetId);
  if (!target) throw new Error(`no target ${JSON.stringify(targetId)} in this context`);
  const view = targetView(context, target);
  const stage = stageOf(context);
  const sigs = normalizeSignatures(opts.extensions);
  const { blockComments, floating } = attachedComments(view);
  const emitContext = {
    procByCode: procByCodeFor(context, view),
    varMap: new Map([...nameIdMap(stage?.variables), ...nameIdMap(target.variables)]),
    listMap: new Map([...nameIdMap(stage?.lists), ...nameIdMap(target.lists)]),
    broadcastNameToId: broadcastIdMap(context),
    blockComments,
    signatures: sigs.byOpcode,
    marks: true,
  };
  const membership = membershipFor(view);
  const { scripts } = collectScripts(view);

  const modules = [];
  const main = [];
  const regions = new Map();
  const locked = [];
  for (const script of scripts) {
    const entry = membership.entryFor(script.topBlockId);
    if (entry.module && STDLIB_MODULES[entry.module]) {
      if (!modules.includes(entry.module)) modules.push(entry.module);
      continue;
    }
    let body;
    try {
      body = emitScriptBody({ script, subgraph: script.subgraph, context: emitContext });
      checkMarks(body);
    } catch (e) {
      body = `locked script ${JSON.stringify(script.topBlockId)};`;
      locked.push({ topId: script.topBlockId, reason: `fractch could not write this script as text: ${e.message}` });
    }
    const item = { script, body };
    if (entry.region) {
      if (!regions.has(entry.region)) regions.set(entry.region, []);
      regions.get(entry.region).push(item);
    } else {
      main.push(item);
    }
  }

  const floatingById = new Map(floating.map((c) => [c.id, c]));
  const looseComments = [];
  const mappedIds = new Set();
  for (const [id, entry] of membership.comments) {
    const c = floatingById.get(id);
    if (!c || mappedIds.has(id)) continue;
    mappedIds.add(id);
    let list = main;
    if (entry.region) {
      if (!regions.has(entry.region)) regions.set(entry.region, []);
      list = regions.get(entry.region);
    }
    const item = { comment: c, body: freeCommentText(c, { ignorePosition: true }) };
    const at = entry.before ? list.findIndex((it) => it.script?.topBlockId === entry.before) : -1;
    if (at >= 0) list.splice(at, 0, item);
    else list.push(item);
  }
  for (const c of floating) if (!mappedIds.has(c.id)) looseComments.push(c);

  const decls = declarationLines(target);
  const monitors = (
    routeMonitors({ monitors: contextMonitors(context) }, contextTargets(context)).get(target.name) || []
  ).map(watchDeclLine);
  const assemble = () => {
    const sourceMap = { version: 1, scripts: {}, blocks: {}, comments: {}, declarations: {}, regions: {} };
    let text = '';
    const section = (pieceText) => {
      if (text) text += '\n\n';
      const from = text.length;
      text += pieceText;
      return from;
    };
    if (modules.length) section(modules.map((m) => `import ${JSON.stringify(m)};`).join('\n'));
    if (decls.length || monitors.length) {
      section('');
      for (const [i, d] of decls.entries()) {
        if (i) text += '\n';
        sourceMap.declarations[d.key] = { from: text.length, to: text.length + d.text.length, id: d.id };
        text += d.text;
      }
      if (monitors.length) text += (decls.length ? '\n' : '') + monitors.filter(Boolean).join('\n');
    }
    if (looseComments.length) {
      section('');
      looseComments.forEach((c, i) => {
        if (i) text += '\n';
        const line = freeCommentText(c, { ignorePosition: true });
        sourceMap.comments[c.id] = { from: text.length, to: text.length + line.length };
        text += line;
      });
    }
    const placeScript = (item, prefix) => {
      if (item.comment) {
        const body = prefix ? indentBlock(item.body) : item.body;
        const from = text.length + (body.length - body.trimStart().length);
        text += body;
        sourceMap.comments[item.comment.id] = { from, to: text.length };
        return;
      }
      if (prefix) {
        const indented = indentBlock(item.body);
        const startOffset = text.length + (indented.length - indented.trimStart().length);
        const stripped = extractMarks(indented, text.length, sourceMap.blocks);
        sourceMap.scripts[item.script.topBlockId] = { from: startOffset, to: text.length + stripped.length };
        text += stripped;
        return;
      }
      const from = text.length;
      const stripped = extractMarks(item.body, from, sourceMap.blocks);
      sourceMap.scripts[item.script.topBlockId] = { from, to: from + stripped.length };
      text += stripped;
    };
    for (const item of main) {
      section('');
      placeScript(item, false);
    }
    for (const [name, items] of regions) {
      const from = section(`region ${JSON.stringify(name)} {\n`);
      items.forEach((item, i) => {
        if (i) text += '\n\n';
        placeScript(item, true);
      });
      text += '\n}';
      sourceMap.regions[name] = { from, to: text.length };
    }
    text += '\n';
    for (const script of scripts) {
      const range = sourceMap.scripts[script.topBlockId];
      if (!range) continue;
      sourceMap.blocks[script.topBlockId] = sourceMap.blocks[script.topBlockId] || { ...range };
      fillUnmarked(view.blocks, Object.keys(script.subgraph), sourceMap.blocks);
    }
    const index = makeLineIndex(text);
    addLines(sourceMap.scripts, index);
    addLines(sourceMap.blocks, index);
    addLines(sourceMap.comments, index);
    addLines(sourceMap.declarations, index);
    addLines(sourceMap.regions, index);

    return { text, sourceMap };
  };
  let { text, sourceMap } = assemble();
  let parsedText = parseFractch(text);
  if (parsedText.errors.length) {
    const broken = new Set();
    for (const err of parsedText.errors) {
      const pos = err.region?.from ?? err.from ?? 0;
      for (const [top, range] of Object.entries(sourceMap.scripts)) {
        if (pos >= range.from && pos <= range.to) broken.add(top);
      }
    }
    for (const item of [...main, ...[...regions.values()].flat()]) {
      if (!item.script || !broken.has(item.script.topBlockId)) continue;
      item.body = `locked script ${JSON.stringify(item.script.topBlockId)};`;
      locked.push({ topId: item.script.topBlockId, reason: 'fractch could not write this script as valid text' });
    }
    ({ text, sourceMap } = assemble());
    parsedText = parseFractch(text);
  }

  const lockedScripts = locked.map((l) => ({ ...l, ...(sourceMap.scripts[l.topId] || {}) }));
  const owner = new Map();
  const sharing = new Set();
  for (const script of scripts) {
    for (const id of Object.keys(script.subgraph)) {
      const first = owner.get(id);
      if (first == null) owner.set(id, script.topBlockId);
      else if (first !== script.topBlockId) sharing.add(first).add(script.topBlockId);
    }
  }
  for (const top of sharing) {
    if (!sourceMap.scripts[top] || lockedScripts.some((l) => l.topId === top)) continue;
    lockedScripts.push({
      topId: top,
      reason: 'This script shares blocks with another script, so editing it as text would split them',
      ...sourceMap.scripts[top],
    });
  }
  if (opts.lockCheck !== false) {
    const check = buildTarget(context, targetId, text, {
      previous: { text, sourceMap },
      extensions: opts.extensions,
      opcodes: opts.opcodes,
      lockedScripts: lockedScripts.map((l) => ({ topId: l.topId })),
      fastUnchanged: false,
      uid: opts.uid,
      parsed: { text, value: parsedText },
    });
    const unchanged = new Set(check.unchangedScripts);
    for (const script of scripts) {
      const top = script.topBlockId;
      if (!sourceMap.scripts[top] || unchanged.has(top) || lockedScripts.some((l) => l.topId === top)) continue;
      lockedScripts.push({
        topId: top,
        reason: check.differences[top] || "fractch can't convert this script back the same way",
        ...sourceMap.scripts[top],
      });
    }
  }
  return { text, sourceMap, lockedScripts };
}

function normalizeLines(text) {
  return String(text)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

function scriptKindKey(text) {
  const first = String(text).trimStart().split('\n')[0] || '';
  const m = /^(when\s+[A-Za-z_.]+|def\s+@[A-Za-z0-9_]+|script|locked)/.exec(first);
  return m ? m[1] : first.split(/\s/)[0];
}

function lineSet(text) {
  const out = new Set();
  for (const l of String(text).split('\n')) {
    const t = l.trim();
    if (t && t !== '}' && t !== '{') out.add(t);
  }
  return out;
}

function pairScripts(oldScripts, newScripts) {
  const pairs = new Map();
  const usedOld = new Set();
  const byText = new Map();
  oldScripts.forEach((o, i) => {
    if (!byText.has(o.norm)) byText.set(o.norm, []);
    byText.get(o.norm).push(i);
  });
  for (const exactOnly of [true, false]) {
    newScripts.forEach((n, ni) => {
      const list = byText.get(n.norm);
      if (!list || pairs.has(ni)) return;
      let oi = null;
      for (const i of list) {
        if (usedOld.has(i)) continue;
        const d = Math.abs(oldScripts[i].from - n.pos);
        if (exactOnly ? d === 0 : oi == null || d < Math.abs(oldScripts[oi].from - n.pos)) oi = i;
      }
      if (oi == null) return;
      usedOld.add(oi);
      pairs.set(ni, oi);
    });
  }
  const exact = new Map(pairs);
  for (let ni = 0; ni < newScripts.length; ni++) {
    if (pairs.has(ni)) continue;
    const lo = (() => {
      for (let j = ni - 1; j >= 0; j--) if (exact.has(j)) return exact.get(j);
      return -1;
    })();
    const hi = (() => {
      for (let j = ni + 1; j < newScripts.length; j++) if (exact.has(j)) return exact.get(j);
      return oldScripts.length;
    })();
    const monotonic = lo < hi;
    const n = newScripts[ni];
    const nLines = lineSet(n.raw);
    let best = -1;
    let bestScore = 0;
    const candidates = [];
    for (let oi = 0; oi < oldScripts.length; oi++) {
      if (usedOld.has(oi)) continue;
      if (monotonic && (oi <= lo || oi >= hi)) continue;
      candidates.push(oi);
    }
    for (const oi of candidates) {
      const o = oldScripts[oi];
      if (o.kind !== n.kind) continue;
      let score = 0;
      for (const l of lineSet(o.raw)) if (nLines.has(l)) score++;
      if (score > bestScore) {
        bestScore = score;
        best = oi;
      }
    }
    const sameKind = candidates.filter((oi) => oldScripts[oi].kind === n.kind);
    const slotNew = [];
    for (let j = ni; j < newScripts.length && !exact.has(j); j++) if (newScripts[j].kind === n.kind) slotNew.push(j);
    if (best < 0 && sameKind.length === 1 && slotNew.length === 1) best = sameKind[0];
    if (best >= 0) {
      usedOld.add(best);
      pairs.set(ni, best);
    }
  }
  return pairs;
}

function chainIds(blocks, startId) {
  const ids = [];
  const seen = new Set();
  let cur = startId;
  while (typeof cur === 'string' && blocks[cur] && !seen.has(cur)) {
    seen.add(cur);
    ids.push(cur);
    cur = blocks[cur].next;
  }
  return ids;
}

function makeFingerprinter(blocks) {
  const memo = new Map();
  const visiting = new Set();
  const fp = (id) => {
    if (memo.has(id)) return memo.get(id);
    const b = blocks[id];
    if (!b || visiting.has(id)) return '?';
    visiting.add(id);
    let s = `${b.opcode}|${b.shadow ? 1 : 0}|`;
    for (const k of Object.keys(b.fields || {}).sort()) s += `${k}=${JSON.stringify(normFieldValue(b.fields[k]))};`;
    if (b.mutation) s += `m${JSON.stringify(normMutation(b.mutation))}`;
    for (const k of Object.keys(b.inputs || {}).sort()) {
      const t = b.inputs[k];
      if (!Array.isArray(t)) continue;
      s += `(${k}:${t[0]}:`;
      for (let i = 1; i < t.length && i <= 2; i++) {
        const v = t[i];
        if (typeof v === 'string') {
          s += k.startsWith('SUBSTACK') ? chainIds(blocks, v).map(fp).join('>') : fp(v);
        } else s += JSON.stringify(normPrimitive(v));
        s += ',';
      }
      s += ')';
    }
    visiting.delete(id);
    memo.set(id, s);
    return s;
  };
  return fp;
}

function lcsPairs(a, b, eq) {
  const pairs = [];
  let start = 0;
  while (start < a.length && start < b.length && eq(start, start)) {
    pairs.push([start, start]);
    start++;
  }
  let endA = a.length;
  let endB = b.length;
  const tail = [];
  while (endA > start && endB > start && eq(endA - 1, endB - 1)) {
    tail.push([endA - 1, endB - 1]);
    endA--;
    endB--;
  }
  const n = endA - start;
  const m = endB - start;
  if (n && m && n * m <= 250000) {
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = eq(start + i, start + j) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (eq(start + i, start + j)) {
        pairs.push([start + i, start + j]);
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
      else j++;
    }
  }
  pairs.push(...tail.reverse());
  return pairs;
}

export function alignScripts(oldBlocks, oldTop, newBlocks, newTop) {
  const map = new Map();
  const usedOld = new Set();
  const fpOld = makeFingerprinter(oldBlocks);
  const fpNew = makeFingerprinter(newBlocks);
  const pairBlock = (o, n) => {
    if (!o || !n || map.has(n) || usedOld.has(o)) return;
    const ob = oldBlocks[o];
    const nb = newBlocks[n];
    if (!ob || !nb || ob.opcode !== nb.opcode) return;
    map.set(n, o);
    usedOld.add(o);
    for (const [name, nt] of Object.entries(nb.inputs || {})) {
      const ot = ob.inputs?.[name];
      if (!Array.isArray(nt) || !Array.isArray(ot)) continue;
      if (name.startsWith('SUBSTACK')) {
        pairChain(ot[1], nt[1]);
        continue;
      }
      if (typeof nt[1] === 'string' && typeof ot[1] === 'string') pairBlock(ot[1], nt[1]);
      if (typeof nt[2] === 'string' && typeof ot[2] === 'string') pairBlock(ot[2], nt[2]);
    }
  };
  const pairChain = (o, n) => {
    const os = chainIds(oldBlocks, o);
    const ns = chainIds(newBlocks, n);
    if (!os.length || !ns.length) return;
    const fo = os.map(fpOld);
    const fn = ns.map(fpNew);
    const anchors = lcsPairs(fo, fn, (i, j) => fo[i] === fn[j]);
    const all = [];
    let pi = 0;
    let pj = 0;
    for (const [ai, aj] of [...anchors, [os.length, ns.length]]) {
      let oi = pi;
      for (let nj = pj; nj < aj; nj++) {
        let k = oi;
        while (k < ai && oldBlocks[os[k]].opcode !== newBlocks[ns[nj]].opcode) k++;
        if (k < ai) {
          all.push([k, nj]);
          oi = k + 1;
        }
      }
      if (ai < os.length) all.push([ai, aj]);
      pi = ai + 1;
      pj = aj + 1;
    }
    for (const [i, j] of all) pairBlock(os[i], ns[j]);
  };
  pairChain(oldTop, newTop);
  return map;
}

function normFieldValue(v) {
  if (!Array.isArray(v)) return [String(v ?? '')];
  const out = [String(v[0] ?? '')];
  if (v.length > 1 && v[1] != null) out.push(String(v[1]));
  return out;
}

function normMutation(m) {
  if (!m || typeof m !== 'object') return m ?? null;
  const out = {};
  for (const k of Object.keys(m).sort()) {
    const v = m[k];
    if (v === undefined) continue;
    if (k === 'children' && Array.isArray(v) && !v.length) continue;
    out[k] = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
  }
  return out;
}

function normPrimitive(p) {
  if (!Array.isArray(p)) return p ?? null;
  const out = [p[0], String(p[1] ?? '')];
  if (p[0] >= 11 && p.length > 2) out.push(p[2] == null ? null : String(p[2]));
  return out;
}

function localNorm(name) {
  const m = LOCAL_RE.exec(String(name));
  return m && !/^for\d+$/.test(m[1]) ? `!local_${m[2]}` : String(name);
}

function fieldEqual(key, a, b) {
  const av = Array.isArray(a) ? a : [a];
  const bv = Array.isArray(b) ? b : [b];
  if (String(av[0] ?? '') !== String(bv[0] ?? '')) {
    if (key === 'VARIABLE' && localNorm(av[0]) === localNorm(bv[0]) && localNorm(av[0]) !== String(av[0])) return true;
    return false;
  }
  const ai = av.length > 1 ? (av[1] ?? null) : null;
  const bi = bv.length > 1 ? (bv[1] ?? null) : null;
  if (ai === bi) return true;
  if (key === 'VARIABLE' && LOCAL_RE.test(String(av[0]))) return true;
  return false;
}

function primitiveEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return a == null && b == null;
  if (a[0] !== b[0]) return false;
  if (a[0] === 12 && localNorm(a[1]) === localNorm(b[1]) && LOCAL_RE.test(String(a[1]))) return true;
  if (String(a[1] ?? '') !== String(b[1] ?? '')) return false;
  if (a[0] >= 11) return (a[2] ?? null) === (b[2] ?? null);
  return true;
}

function commentKey(c) {
  return JSON.stringify([commentText(c), c.width ?? 200, c.height ?? 200, !!c.minimized]);
}

export function compareScripts(oldSide, newSide, map) {
  const { blocks: ob, top: oTop, comments: oComments } = oldSide;
  const { blocks: nb, top: nTop, comments: nComments } = newSide;
  const oSub = collectBlocksSubgraph(ob, oTop);
  const nSub = collectBlocksSubgraph(nb, nTop);
  const oIds = Object.keys(oSub);
  const nIds = Object.keys(nSub);
  if (oIds.length !== nIds.length) return `block count ${oIds.length} vs ${nIds.length}`;
  const inverse = new Map();
  for (const n of nIds) {
    const o = map.get(n);
    if (!o || !oSub[o]) return `block ${nb[n]?.opcode} has no counterpart`;
    if (inverse.has(o)) return 'two blocks map to one';
    inverse.set(o, n);
  }
  for (const n of nIds) {
    const o = map.get(n);
    const a = ob[o];
    const b = nb[n];
    if (a.opcode !== b.opcode) return `opcode ${a.opcode} vs ${b.opcode}`;
    if (!!a.shadow !== !!b.shadow) return `${a.opcode}: shadow flag differs`;
    const aNext = a.next ?? null;
    const bNext = b.next ?? null;
    if ((aNext == null) !== (bNext == null)) return `${a.opcode}: next differs`;
    if (bNext != null && (nb[bNext] ? map.get(bNext) !== aNext : bNext !== aNext)) return `${a.opcode}: next differs`;
    const fk = new Set([...Object.keys(a.fields || {}), ...Object.keys(b.fields || {})]);
    for (const k of fk) {
      if (!fieldEqual(k, a.fields?.[k], b.fields?.[k])) {
        return `${a.opcode}: field ${k} ${JSON.stringify(a.fields?.[k])} vs ${JSON.stringify(b.fields?.[k])}`;
      }
    }
    if (JSON.stringify(normMutation(a.mutation)) !== JSON.stringify(normMutation(b.mutation))) {
      return `${a.opcode}: mutation differs (${JSON.stringify(normMutation(a.mutation))} vs ${JSON.stringify(normMutation(b.mutation))})`;
    }
    const ik = new Set([...Object.keys(a.inputs || {}), ...Object.keys(b.inputs || {})]);
    for (const k of ik) {
      const at = a.inputs?.[k];
      const bt = b.inputs?.[k];
      if (!Array.isArray(at) || !Array.isArray(bt)) {
        if (Array.isArray(at) !== Array.isArray(bt)) return `${a.opcode}: input ${k} present on one side only`;
        continue;
      }
      if (at[0] !== bt[0] || at.length !== bt.length) {
        return `${a.opcode}: input ${k} shape differs (${JSON.stringify(at)} vs ${JSON.stringify(bt)})`;
      }
      for (let i = 1; i < at.length; i++) {
        const x = at[i];
        const y = bt[i];
        if (typeof x === 'string' || typeof y === 'string') {
          if (typeof x !== 'string' || typeof y !== 'string' || map.get(y) !== x)
            return `${a.opcode}: input ${k} differs`;
        } else if (!primitiveEqual(x, y)) {
          return `${a.opcode}: input ${k} ${JSON.stringify(x)} vs ${JSON.stringify(y)}`;
        }
      }
    }
    if (o === oTop) {
      if (Math.round(a.x ?? 0) !== Math.round(b.x ?? 0) || Math.round(a.y ?? 0) !== Math.round(b.y ?? 0)) {
        return 'script position differs';
      }
    }
    if (!!a.topLevel !== !!b.topLevel) return `${a.opcode}: topLevel differs`;
    const ac = (oComments.get(o) || [])
      .filter((c) => !isLegacyMarkerComment(c))
      .map(commentKey)
      .sort();
    const bc = (nComments.get(n) || []).map(commentKey).sort();
    if (ac.join('\n') !== bc.join('\n')) return `${a.opcode}: attached comments differ`;
  }
  return null;
}

function commentsByBlock(comments) {
  const out = new Map();
  for (const [id, c] of Object.entries(comments || {})) {
    if (!c || !c.blockId) continue;
    if (!out.has(c.blockId)) out.set(c.blockId, []);
    out.get(c.blockId).push({ ...c, id });
  }
  return out;
}

function cloneTuple(t) {
  return Array.isArray(t) ? t.map((x) => (Array.isArray(x) ? [...x] : x)) : t;
}

function numericText(v) {
  const s = String(v ?? '');
  return s === '' || Number.isFinite(Number(s));
}

function staleCallInputs(block) {
  if (block?.opcode !== 'procedures_call') return null;
  try {
    return new Set(JSON.parse(block.mutation?.argumentids || '[]'));
  } catch {
    return new Set();
  }
}

function removeCandidateSubgraph(cand, id) {
  for (const sid of Object.keys(collectBlocksSubgraph(cand.blocks, id))) delete cand.blocks[sid];
}

function holdsHiddenValue(entry) {
  if (entry == null) return false;
  if (Array.isArray(entry)) return !(entry[0] >= 4 && entry[0] <= 10 && String(entry[1] ?? '') === '');
  const block = entry.blocks && typeof entry.id === 'string' ? entry.blocks[entry.id] : entry;
  if (!block || typeof block !== 'object' || !PRIMITIVE_OPCODES[block.opcode]) return true;
  if (Object.keys(block.inputs || {}).length) return true;
  const values = Object.values(block.fields || {});
  return !(values.length === 1 && String((Array.isArray(values[0]) ? values[0][0] : values[0]) ?? '') === '');
}

function dropCandidateShadow(cand, id) {
  if (typeof id !== 'string' || !cand.blocks[id] || cand.carried.has(id)) return;
  for (const sid of Object.keys(collectBlocksSubgraph(cand.blocks, id))) {
    delete cand.blocks[sid];
    cand.map.delete(sid);
  }
}

function dropNullInputs(cand) {
  for (const block of Object.values(cand.blocks)) {
    for (const [name, tuple] of Object.entries(block.inputs || {})) {
      if (cand.nullInputs.has(tuple)) delete block.inputs[name];
    }
  }
}

function carryFromOld(cand, old, map) {
  for (const [n, o] of map) {
    const nb = cand.blocks[n];
    const ob = old.blocks[o];
    if (!nb || !ob) continue;
    for (const name of Object.keys({ ...(nb.inputs || {}), ...(ob.inputs || {}) })) {
      if (name.startsWith('SUBSTACK')) continue;
      const nt = nb.inputs?.[name];
      const ot = ob.inputs?.[name];
      if (nt && cand.nullInputs.has(nt)) {
        if (!ot) {
          delete nb.inputs[name];
        } else if (typeof ot[1] !== 'string') {
          const copy = cloneTuple(ot);
          if (typeof copy[2] === 'string') copyShadow(cand, old, copy[2], n);
          nb.inputs[name] = copy;
        } else if (ot[0] === 3 && ot[2] != null) {
          const shadow = cloneTuple([1, ot[2]]);
          if (typeof shadow[1] === 'string') copyShadow(cand, old, shadow[1], n);
          nb.inputs[name] = shadow;
        }
        continue;
      }
      if (!Array.isArray(nt) || !Array.isArray(ot)) continue;
      const newActiveBlock = typeof nt[1] === 'string' && !cand.blocks[nt[1]]?.shadow;
      const newActiveVar = Array.isArray(nt[1]) && (nt[1][0] === 12 || nt[1][0] === 13);
      if (newActiveBlock || newActiveVar) {
        const written = hiddenShadowToWrite(nb, name, nt, cand.blocks);
        if (!sameHiddenShadow(written, hiddenShadowToWrite(ob, name, ot, old.blocks))) continue;
        if (nt[0] === 3) dropCandidateShadow(cand, nt[2]);
        let shadow;
        if (ot[0] === 3) shadow = ot[2];
        else if (ot[0] === 1 && (typeof ot[1] !== 'string' || old.blocks[ot[1]]?.shadow)) shadow = ot[1];
        else shadow = undefined;
        if (typeof shadow === 'string' && map.get(nt[1]) === shadow) shadow = undefined;
        if (shadow === undefined) {
          nb.inputs[name] = ot[0] === 3 && ot.length > 2 ? [3, nt[1], ot[2] ?? null] : [ot[0] === 1 ? 2 : ot[0], nt[1]];
        } else {
          if (typeof shadow === 'string') copyShadow(cand, old, shadow, n);
          nb.inputs[name] = [3, nt[1], Array.isArray(shadow) ? [...shadow] : shadow];
        }
        continue;
      }
      if (nt[0] === 1 && Array.isArray(nt[1])) {
        const oldLit = ot[0] === 1 && Array.isArray(ot[1]) ? ot[1] : ot[0] === 3 && Array.isArray(ot[2]) ? ot[2] : null;
        const code = oldLit?.[0];
        const lit = nt[1];
        if (code != null && lit[0] >= 4 && lit[0] <= 10 && code >= 4 && code <= 10 && code !== lit[0]) {
          const same = String(lit[1] ?? '') === String(oldLit[1] ?? '');
          if (same || code === 10 || code === 9 || (code <= 8 && numericText(lit[1])))
            nb.inputs[name] = [1, [code, lit[1]]];
        }
      }
    }
    const oldArgs = staleCallInputs(ob);
    for (const [name, ot] of Object.entries(ob.inputs || {})) {
      if (!Array.isArray(ot) || (nb.inputs && name in nb.inputs)) continue;
      const empty = ot[1] == null && (ot.length < 3 || ot[2] == null);
      const stale = oldArgs && !oldArgs.has(name);
      if (!empty && !stale) continue;
      const copy = cloneTuple(ot);
      for (let i = 1; i < copy.length; i++) if (typeof copy[i] === 'string') copyShadow(cand, old, copy[i], n);
      (nb.inputs ||= {})[name] = copy;
    }
    if (nb.opcode === 'procedures_prototype') {
      for (const name of Object.keys(nb.inputs || {})) {
        if (ob.inputs && name in ob.inputs) continue;
        const t = nb.inputs[name];
        if (Array.isArray(t) && typeof t[1] === 'string') removeCandidateSubgraph(cand, t[1]);
        delete nb.inputs[name];
      }
    }
    for (const [key, ov] of Object.entries(ob.fields || {})) {
      const nv = nb.fields?.[key];
      if (nv === undefined) {
        if (key === 'PLUS' || key === 'MINUS') (nb.fields ||= {})[key] = Array.isArray(ov) ? [...ov] : ov;
        continue;
      }
      const a = Array.isArray(ov) ? ov[0] : ov;
      const b = Array.isArray(nv) ? nv[0] : nv;
      if (String(a ?? '') === String(b ?? '')) nb.fields[key] = Array.isArray(ov) ? [...ov] : ov;
    }
    if (
      !!nb.shadow !== !!ob.shadow &&
      (nb.opcode.startsWith('argument_reporter') || nb.opcode === 'procedures_prototype')
    ) {
      nb.shadow = !!ob.shadow;
    }
    if (
      nb.opcode === 'procedures_call' &&
      ob.mutation &&
      nb.mutation &&
      ob.mutation.proccode === nb.mutation.proccode
    ) {
      for (const k of ['warp', 'customcolor']) {
        if (ob.mutation[k] === undefined) delete nb.mutation[k];
        else nb.mutation[k] = ob.mutation[k];
      }
    }
    for (const [name, nt] of Object.entries(nb.inputs || {})) {
      const ot = ob.inputs?.[name];
      if (!Array.isArray(nt) || !Array.isArray(ot)) continue;
      if (typeof nt[1] === 'string' && typeof ot[1] === 'string' && map.get(nt[1]) === ot[1]) {
        const nc = cand.blocks[nt[1]];
        const oc = old.blocks[ot[1]];
        if (nc && oc && nc.shadow && !oc.shadow) {
          nc.shadow = false;
          const copy = cloneTuple(ot);
          copy[1] = nt[1];
          if (typeof copy[2] === 'string') copyShadow(cand, old, copy[2], n);
          nb.inputs[name] = copy;
          continue;
        }
      }
      if (nt[0] === ot[0] && nt.length === ot.length) continue;
      const activeAligned = typeof nt[1] === 'string' && typeof ot[1] === 'string' && map.get(nt[1]) === ot[1];
      const noNewShadow = nt.length < 3 || nt[2] == null;
      const noOldShadow = ot.length < 3 || ot[2] == null;
      if (activeAligned && noNewShadow && noOldShadow)
        nb.inputs[name] = ot.length > 2 ? [ot[0], nt[1], ot[2]] : [ot[0], nt[1]];
    }
    if (o === old.top && !!nb.shadow !== !!ob.shadow) nb.shadow = !!ob.shadow;
    if (o === old.top && !ob.topLevel && nb.topLevel) {
      nb.topLevel = false;
      delete nb.x;
      delete nb.y;
      nb.parent = ob.parent ?? null;
    }
    if ((nb.opcode === 'procedures_prototype' || nb.opcode === 'procedures_call') && ob.mutation && nb.mutation) {
      for (const [k, v] of Object.entries(ob.mutation)) {
        if (!(k in nb.mutation)) nb.mutation[k] = v;
      }
      if (nb.opcode === 'procedures_prototype' && ob.mutation.argumentdefaults != null) {
        nb.mutation.argumentdefaults = ob.mutation.argumentdefaults;
      }
    }
  }
}

function applyShadowTypes(blocks, table, nullInputs) {
  if (!table.provided) return;
  for (const b of Object.values(blocks)) {
    const shadows = table.byOpcode.get(b.opcode)?.shadows;
    if (!shadows) continue;
    for (const [k, t] of Object.entries(b.inputs || {})) {
      const code = shadowTypeCode(shadows[k]);
      if (code == null || !Array.isArray(t) || t[0] !== 1 || !Array.isArray(t[1]) || nullInputs.has(t)) continue;
      const lit = t[1];
      if (lit[0] < 4 || lit[0] > 10 || lit[0] === code) continue;
      if (code === 10 || code === 9 || numericText(lit[1])) b.inputs[k] = [1, [code, lit[1]]];
    }
  }
}

function copyShadow(cand, old, shadowId, parentId) {
  const sub = collectBlocksSubgraph(old.blocks, shadowId);
  for (const [id, b] of Object.entries(sub)) {
    if (cand.blocks[id]) continue;
    cand.blocks[id] = { ...b, id, ...(id === shadowId ? { parent: parentId } : {}) };
    cand.carried.add(id);
    cand.map.set(id, id);
  }
}

function newLocalTag(base, used) {
  const clean = String(base).replace(/[^A-Za-z0-9]/g, '') || 'script';
  let tag = /^for\d+$/.test(clean) ? `${clean}x` : clean;
  let n = 2;
  while (used.has(tag)) tag = `${clean}${n++}`;
  used.add(tag);
  return tag;
}

function scriptLocals(blocks, top) {
  const names = new Map();
  for (const b of Object.values(collectBlocksSubgraph(blocks, top))) {
    const consider = (name) => {
      const m = LOCAL_RE.exec(String(name));
      if (m && !/^for\d+$/.test(m[1]) && !names.has(m[2])) names.set(m[2], String(name));
    };
    if (b.fields?.VARIABLE) consider(b.fields.VARIABLE[0]);
    for (const t of Object.values(b.inputs || {})) {
      if (!Array.isArray(t)) continue;
      for (const x of t.slice(1)) if (Array.isArray(x) && x[0] === 12) consider(x[1]);
    }
  }
  return names;
}

function usedLocalTags(context, target) {
  const tags = new Set();
  const add = (t) => {
    for (const entry of Object.values(t?.variables || {})) {
      const m = Array.isArray(entry) ? LOCAL_RE.exec(String(entry[0])) : null;
      if (m) tags.add(m[1]);
    }
  };
  add(target);
  if (target.isStage) for (const t of contextTargets(context)) add(t);
  else add(stageOf(context));
  return tags;
}

function allBlockIds(context) {
  const ids = new Set();
  for (const t of contextTargets(context)) for (const id of Object.keys(t?.blocks || {})) ids.add(id);
  return ids;
}

function allVariableIds(context) {
  const ids = new Set();
  for (const t of contextTargets(context)) {
    for (const id of Object.keys(t?.variables || {})) ids.add(id);
    for (const id of Object.keys(t?.lists || {})) ids.add(id);
    for (const id of Object.keys(t?.broadcasts || {})) ids.add(id);
  }
  return ids;
}

function declKind(decl, target) {
  if (decl.isList === true) return 'list';
  if (decl.isList === false) return 'var';
  const has = (dict) => Object.values(dict || {}).some((e) => Array.isArray(e) && e[0] === decl.name);
  if (has(target.lists)) return 'list';
  if (has(target.variables)) return 'var';
  return 'list';
}

function declKey(decl, target) {
  return `${declKind(decl, target)}:${declName(decl)}${decl.id ? `#${decl.id}` : ''}`;
}

function declName(decl) {
  return decl.cloud && !String(decl.name).startsWith('☁ ') ? `☁ ${decl.name}` : String(decl.name);
}

function declSignature(decl) {
  return JSON.stringify([decl.keep ? 'keep' : decl.value, !!decl.cloud, decl.id ?? null]);
}

function findDictEntry(dict, decl, name) {
  if (decl.id && dict[decl.id]) return decl.id;
  for (const [id, entry] of Object.entries(dict || {})) if (Array.isArray(entry) && entry[0] === name) return id;
  return null;
}

function referencesOf(context, id, name, kind, ownerTarget) {
  const users = [];
  for (const t of contextTargets(context)) {
    const blocks = t?.blocks || {};
    let found = false;
    for (const b of Object.values(blocks)) {
      if (Array.isArray(b)) {
        if ((b[0] === 12 || b[0] === 13) && b[2] === id) found = true;
        continue;
      }
      if (!b) continue;
      const field = kind === 'list' ? b.fields?.LIST : b.fields?.VARIABLE;
      if (field && field[1] === id) found = true;
      for (const tuple of Object.values(b.inputs || {})) {
        if (!Array.isArray(tuple)) continue;
        for (const x of tuple.slice(1))
          if (Array.isArray(x) && (x[0] === 12 || x[0] === 13) && x[2] === id) found = true;
      }
      if (
        kind === 'var' &&
        !ownerTarget.isStage &&
        b.opcode === 'sensing_of' &&
        String(b.fields?.PROPERTY?.[0] ?? '') === name
      ) {
        const menuId = b.inputs?.OBJECT?.[1];
        const menu = typeof menuId === 'string' ? blocks[menuId] : null;
        if (menu && String(menu.fields?.OBJECT?.[0] ?? '') === ownerTarget.name) found = true;
      }
      if (found) break;
    }
    if (found) users.push(t);
  }
  return users;
}

function spanOfCall(node) {
  return node?.span || node?.value?.span || node?.callee?.span || null;
}

function opcodeNamespace(opcode) {
  const m = /^([A-Za-z][A-Za-z0-9]*)_/.exec(String(opcode));
  return m ? m[1] : null;
}

function statementPositions(blocks, top) {
  const statements = new Set();
  const visitChain = (id) => {
    for (const cid of chainIds(blocks, id)) {
      statements.add(cid);
      for (const [k, t] of Object.entries(blocks[cid].inputs || {})) {
        if (k.startsWith('SUBSTACK') && Array.isArray(t) && typeof t[1] === 'string') visitChain(t[1]);
      }
    }
  };
  visitChain(top);
  return statements;
}

export function buildTarget(context, targetId, text, inputOpts = {}) {
  const opts = withContextDefaults(context, inputOpts);
  const target = findTarget(context, targetId);
  if (!target) throw new Error(`no target ${JSON.stringify(targetId)} in this context`);
  const uid = opts.uid || defaultUid;
  const live = isLiveContext(context);
  const view = targetView(context, target);
  const stage = stageOf(context);
  const sigs = normalizeSignatures(opts.extensions);
  const table = normalizeOpcodeTable(opts.opcodes);
  const signatures = new Map(sigs.byOpcode);
  for (const [opcode, entry] of table.byOpcode) {
    if (signatures.has(opcode)) continue;
    const sig = BUILTIN_SIGNATURES.get(opcode) || coreSignature(entry);
    if (sig) signatures.set(opcode, sig);
  }
  const previous =
    opts.previous ||
    emitTarget(context, targetId, { lockCheck: false, extensions: opts.extensions, opcodes: opts.opcodes });
  const source = String(text ?? '');
  const index = makeLineIndex(source);
  const diagnostics = [];
  const at = (span, fallbackLine = 1) =>
    span ? rangeExtra(index, span[0], span[1]) : { line: fallbackLine, column: 1, endLine: fallbackLine, endColumn: 1 };
  const report = (code, message, extra = {}) => diagnostics.push(diagnostic(code, message, extra));

  const usedBlockIds = allBlockIds(context);
  const usedDeclIds = allVariableIds(context);
  const mint = (used) => {
    let id;
    do id = uid();
    while (used.has(id) || id.startsWith(TEMP_PREFIX));
    used.add(id);
    return id;
  };
  const mintBlockId = () => mint(usedBlockIds);
  const mintDeclId = () => mint(usedDeclIds);

  const parsed = opts.parsed?.text === source ? opts.parsed.value : parseFractch(source);
  for (const err of parsed.errors) {
    diagnostics.push(
      diagnostic(err.code || 'FR100', err.message, {
        hint: err.hint,
        line: err.line,
        column: err.col,
        endLine: err.endLine,
        endColumn: err.endColumn,
        from: err.from,
        to: err.to,
      })
    );
  }
  for (const w of parsed.warnings || []) {
    diagnostics.push(
      diagnostic(w.code, w.message, {
        hint: w.hint,
        line: w.line,
        column: w.col,
        endLine: w.endLine,
        endColumn: w.endColumn,
        from: w.from,
        to: w.to,
      })
    );
  }
  const prevParsed = previous.text === source ? parsed : parseDeclarations(previous.text || '');
  for (const decl of parsed.spriteDecls || []) {
    report(
      'FR223',
      'this line is not applied from code; sprite properties, extensions and assets are edited in the editor',
      {
        ...at(decl.span),
      }
    );
  }

  const created = { variables: [], lists: [], broadcasts: [], scripts: [], comments: [] };
  const valueSets = {};
  const removed = { variables: [], lists: [], scripts: [], comments: [] };
  const outVariables = { ...(target.variables || {}) };
  const outLists = { ...(target.lists || {}) };
  const outBroadcasts = target.isStage ? { ...(target.broadcasts || {}) } : null;

  const prevDecls = new Map();
  for (const d of prevParsed.varDecls) prevDecls.set(declKey(d, target), d);
  const newDeclKeys = new Set();
  for (const d of parsed.varDecls) {
    const kind = declKind(d, target);
    const name = declName(d);
    const key = declKey(d, target);
    if (newDeclKeys.has(key)) {
      report('FR226', `${kind === 'list' ? 'list' : 'variable'} ${JSON.stringify(d.name)} is declared twice`, {
        ...at(d.span, d.line),
        hint: 'delete one of the two lines',
      });
      continue;
    }
    newDeclKeys.add(key);
    if (d.cloud && !target.isStage) {
      report('FR223', 'cloud variables live on the Stage; declare them in the Stage code', { ...at(d.span, d.line) });
      continue;
    }
    const dict = kind === 'list' ? outLists : outVariables;
    const existing = findDictEntry(dict, d, name);
    const prev = prevDecls.get(key);
    const edited = !prev || declSignature(prev) !== declSignature(d);
    if (existing) {
      if (edited && !d.keep) {
        const entry = [...dict[existing]];
        entry[1] = kind === 'list' ? (Array.isArray(d.value) ? d.value : []) : d.value;
        dict[existing] = entry;
        valueSets[existing] = entry[1];
      }
      continue;
    }
    const id = d.id && !usedDeclIds.has(d.id) ? d.id : mintDeclId();
    usedDeclIds.add(id);
    const value = d.keep || d.value == null ? (kind === 'list' ? [] : 0) : d.value;
    dict[id] =
      kind === 'list' ? [name, Array.isArray(value) ? value : []] : d.cloud ? [name, value, true] : [name, value];
    (kind === 'list' ? created.lists : created.variables).push({
      id,
      name,
      owner: targetKey(target),
      cloud: !!d.cloud,
    });
    report('FR222', `creates ${kind === 'list' ? 'list' : 'variable'} ${JSON.stringify(name)}`, {
      ...at(d.span, d.line),
    });
  }
  for (const [key, d] of prevDecls) {
    if (newDeclKeys.has(key)) continue;
    const kind = declKind(d, target);
    const name = declName(d);
    const dict = kind === 'list' ? outLists : outVariables;
    const id = findDictEntry(dict, d, name);
    if (!id) continue;
    const entry = dict[id];
    delete dict[id];
    (kind === 'list' ? removed.lists : removed.variables).push({
      id,
      name,
      owner: targetKey(target),
      cloud: entry[2] === true,
      value: entry[1],
    });
  }

  const cloudAliases = new Map();
  const stageVars = target.isStage ? outVariables : stage?.variables || {};
  for (const entry of Object.values(stageVars)) {
    if (Array.isArray(entry) && entry[2] === true && String(entry[0]).startsWith('☁ ')) {
      cloudAliases.set(String(entry[0]).slice(2), String(entry[0]));
    }
  }
  const varMap = new Map([...(target.isStage ? [] : nameIdMap(stage?.variables)), ...nameIdMap(outVariables)]);
  const listMap = new Map([...(target.isStage ? [] : nameIdMap(stage?.lists)), ...nameIdMap(outLists)]);
  for (const r of removed.variables) if (!varMap.has(r.name)) varMap.set(r.name, r.id);
  for (const r of removed.lists) if (!listMap.has(r.name)) listMap.set(r.name, r.id);
  const newBroadcasts = new Map();
  const broadcastNameToId = broadcastIdMap(context);
  if (outBroadcasts)
    for (const [n, id] of nameIdMap(outBroadcasts)) if (!broadcastNameToId.has(n)) broadcastNameToId.set(n, id);

  const membership = membershipFor(view);
  const { scripts: liveScripts, orphans } = collectScripts(view);
  const liveByTop = new Map(liveScripts.map((s) => [s.topBlockId, s]));
  const oldComments = commentsByBlock(view.comments);

  const lockedIds = new Set(
    (opts.lockedScripts || []).map((l) => (typeof l === 'string' ? l : l.topId)).filter(Boolean)
  );
  const lockedRanges = (opts.lockedScripts || [])
    .filter((l) => l && typeof l === 'object' && l.from != null && l.to != null)
    .map((l) => [l.from, l.to]);
  for (const l of parsed.lockedScripts) lockedIds.add(l.id);
  const insideLockedRange = (span) => span && lockedRanges.some(([a]) => span[0] === a);

  const regionAt = (pos) => {
    for (const r of parsed.regions) if (r.span && pos >= r.span[0] && pos < r.span[1]) return r.name;
    return null;
  };

  const procByCode = procByCodeFor(context, view);
  const procArgMaps = new Map();
  const identToProccode = new Map();
  const procMetaMaps = new Map();
  const T = '__target';
  const textScripts = parsed.scripts.filter((s) => !insideLockedRange(s.span));
  for (const s of textScripts) registerProcDefs(procArgMaps, identToProccode, procMetaMaps, T, s.calls);
  const liveProtoIds = new Map();
  const liveProtoMeta = new Map();
  for (const b of Object.values(view.blocks)) {
    if (b?.opcode !== 'procedures_prototype' || !b.mutation?.proccode) continue;
    let ids = [];
    try {
      ids = JSON.parse(b.mutation.argumentids || '[]');
    } catch {
      ids = [];
    }
    liveProtoIds.set(b.mutation.proccode, ids);
    liveProtoMeta.set(b.mutation.proccode, {
      warp: b.mutation.warp === true || b.mutation.warp === 'true',
      customcolor: b.mutation.customcolor,
      returns: procByCode.get(b.mutation.proccode)?.returns,
    });
  }
  const identMap = new Map();
  for (const info of procByCode.values()) identMap.set(info.ident, null);
  for (const [code, info] of procByCode) identMap.set(info.ident, code);
  for (const [ident, code] of identToProccode.get(T) || []) identMap.set(ident, code);
  const argMap = new Map();
  for (const b of Object.values(view.blocks)) {
    if (b?.opcode !== 'procedures_call' || !b.mutation?.proccode || argMap.has(b.mutation.proccode)) continue;
    try {
      const ids = JSON.parse(b.mutation.argumentids || '[]');
      if (Array.isArray(ids)) argMap.set(b.mutation.proccode, ids);
    } catch {
      continue;
    }
  }
  for (const [code, ids] of liveProtoIds) argMap.set(code, ids);
  for (const [code, idents] of procArgMaps.get(T) || []) {
    if (argMap.has(code) && argMap.get(code).length === idents.length) continue;
    argMap.set(
      code,
      idents.map(() => mintBlockId())
    );
  }
  const metaMap = new Map(liveProtoMeta);
  for (const [code, meta] of procMetaMaps.get(T) || []) metaMap.set(code, meta);
  const textDefCodes = new Set((procArgMaps.get(T) || new Map()).keys());

  const nsMap = {};
  for (const [ns, id] of Object.entries(parsed.importNamespaces || {})) if (STDLIB_MODULES[id]) nsMap[ns] = id;
  const scopeNames = new Set([...varMap.keys(), ...cloudAliases.keys()]);
  const listNames = new Set(listMap.keys());
  for (const s of textScripts) {
    const names = new Set(scopeNames);
    for (const n of collectLocalDeclNames(s.calls)) names.add(n);
    for (const p of stackProcDef(s.calls)?.params || []) names.add(p.ident);
    rewriteIdentOrMethod(s.calls, names, listNames, nsMap, (code, message, extra) =>
      report(code, message, { line: extra?.line ?? 1, severity: extra?.severity })
    );
  }

  const prevScripts = [];
  for (const [topId, range] of Object.entries(previous.sourceMap?.scripts || {})) {
    if (!liveByTop.has(topId)) continue;
    const raw = String(previous.text).slice(range.from, range.to);
    prevScripts.push({ topId, raw, norm: normalizeLines(raw), kind: scriptKindKey(raw), from: range.from });
  }
  prevScripts.sort((a, b) => a.from - b.from);
  const prevText = String(previous.text ?? '');
  let prefixLen = 0;
  while (prefixLen < prevText.length && prevText[prefixLen] === source[prefixLen]) prefixLen++;
  let suffixLen = 0;
  const maxSuffix = Math.min(prevText.length, source.length) - prefixLen;
  while (suffixLen < maxSuffix && prevText[prevText.length - 1 - suffixLen] === source[source.length - 1 - suffixLen])
    suffixLen++;
  const oldOffset = (x) => (x >= source.length - suffixLen ? x - source.length + prevText.length : x);
  const newScripts = textScripts.map((s) => {
    const raw = source.slice(s.span[0], s.span[1]);
    return { script: s, raw, norm: normalizeLines(raw), kind: scriptKindKey(raw), pos: oldOffset(s.span[0]) };
  });
  const pairs = pairScripts(prevScripts, newScripts);
  const prevDeclNames = [...prevDecls.keys()].sort().join('|');
  const declsUnchanged = prevDeclNames === [...newDeclKeys].sort().join('|');
  const fast = opts.fastUnchanged !== false && declsUnchanged;

  const outBlocks = {};
  const builtIds = new Set();
  const outPrimitiveIds = {};
  const outObscured = {};
  const outComments = {};
  const unchangedScripts = [];
  const changed = [];
  const differences = {};
  const membershipEntries = new Map();
  const sourceMap = { version: 1, scripts: {}, blocks: {}, comments: {}, declarations: {}, regions: {} };
  const usedOldIds = new Set();
  const usedTags = usedLocalTags(context, { ...target, variables: outVariables });
  const candIds = new IdGen(TEMP_PREFIX);
  let lowestY = null;
  for (const s of liveScripts) {
    const b = view.blocks[s.topBlockId];
    if (b?.topLevel) lowestY = Math.max(lowestY ?? -Infinity, Math.round(b.y ?? 0));
  }
  let newScriptIndex = 0;

  const carryLive = (topId, entry) => {
    const live = liveByTop.get(topId);
    if (!live) return false;
    for (const id of Object.keys(live.subgraph)) {
      usedOldIds.add(id);
      outBlocks[id] = view.blocks[id];
      if (view.primitiveIds[id]) outPrimitiveIds[id] = view.primitiveIds[id];
      if (view.obscured[id]) outObscured[id] = view.obscured[id];
      for (const c of oldComments.get(id) || []) {
        const { id: cid, ...rest } = c;
        outComments[cid] = target.comments[cid] || rest;
      }
    }
    membershipEntries.set(topId, entry);
    return true;
  };

  const localTagFor = new Map();
  const buildCandidate = (s, pairedTop) => {
    const commentsOut = [];
    const spansOut = new Map();
    const nullInputs = new WeakSet();
    const problemsOut = [];
    const localNames = collectLocalDeclNames(s.calls);
    let localVars = cloudAliases.size ? new Map(cloudAliases) : null;
    if (localNames.size) {
      localVars = localVars || new Map();
      const oldLocals = pairedTop ? scriptLocals(view.blocks, pairedTop) : new Map();
      let tag = null;
      for (const n of localNames) {
        let mangled = oldLocals.get(n);
        if (!mangled) {
          if (!tag) {
            const fromOld = [...oldLocals.values()].map((v) => LOCAL_RE.exec(v)?.[1]).find(Boolean);
            tag = fromOld || localTagFor.get(s) || newLocalTag(stackBaseName({ calls: s.calls }), usedTags);
            localTagFor.set(s, tag);
          }
          mangled = `!local_${tag}_${n}`;
        }
        if (!varMap.has(mangled)) {
          const id = mintDeclId();
          outVariables[id] = [mangled, 0];
          varMap.set(mangled, id);
          created.variables.push({ id, name: mangled, owner: targetKey(target), local: true });
        }
        localVars.set(n, mangled);
      }
    }
    const built = buildBlocksFromCalls(s.calls, {
      hatOpcode: null,
      proceduresMapForTarget: argMap,
      identToProccode: identMap,
      procMeta: metaMap,
      varMap,
      listMap,
      broadcastNameToId,
      localVars,
      idGen: candIds,
      commentsOut,
      spansOut,
      nullInputs,
      problemsOut,
      signatures,
    });
    const blocks = {};
    for (const [id, b] of Object.entries(built.blocks)) blocks[id] = b;
    const top = built.topId;
    if (top && blocks[top]) {
      if (s.x != null) {
        blocks[top].x = s.x;
        blocks[top].y = s.y;
      } else if (blocks[top].topLevel) {
        blocks[top].x = 0;
        blocks[top].y = lowestY == null ? newScriptIndex * 200 : lowestY + 200 * (newScriptIndex + 1);
        newScriptIndex++;
      }
    }
    if (live) collapseOperators(blocks);
    applyShadowTypes(blocks, table, nullInputs);
    return {
      top,
      blocks,
      commentsOut,
      spansOut,
      nullInputs,
      problemsOut,
      carried: new Set(),
      map: new Map(),
    };
  };

  const candidateComments = (cand) => {
    const out = new Map();
    for (const c of cand.commentsOut) {
      if (!c.blockId || !cand.blocks[c.blockId]) continue;
      if (!out.has(c.blockId)) out.set(c.blockId, []);
      out.get(c.blockId).push(c);
    }
    return out;
  };

  const finalizeChanged = (cand, pairedTop, entry) => {
    const rename = new Map();
    for (const id of Object.keys(cand.blocks)) {
      const o = cand.map.get(id);
      if (o && !usedOldIds.has(o)) {
        rename.set(id, o);
        usedOldIds.add(o);
      } else if (cand.carried.has(id) && !usedOldIds.has(id)) {
        rename.set(id, id);
        usedOldIds.add(id);
      } else {
        rename.set(id, mintBlockId());
      }
    }
    const r = (id) => (typeof id === 'string' && rename.has(id) ? rename.get(id) : id);
    for (const [id, b] of Object.entries(cand.blocks)) {
      const fid = rename.get(id);
      const nb = { ...b };
      delete nb.id;
      if (nb.mutation === undefined) delete nb.mutation;
      nb.next = r(nb.next) ?? null;
      nb.parent = r(nb.parent) ?? null;
      if (nb.inputs) {
        const inputs = {};
        for (const [k, t] of Object.entries(nb.inputs)) {
          inputs[k] = Array.isArray(t) ? t.map((x, i) => (i > 0 && typeof x === 'string' ? r(x) : x)) : t;
        }
        nb.inputs = inputs;
      }
      if (!nb.topLevel) {
        delete nb.x;
        delete nb.y;
      }
      delete nb.comment;
      outBlocks[fid] = nb;
      builtIds.add(fid);
      const oldId = cand.map.get(id);
      const oldPrim = oldId ? view.primitiveIds[oldId] : null;
      const oldBlock = oldId ? view.blocks[oldId] : null;
      for (const [k, t] of Object.entries(nb.inputs || {})) {
        if (!Array.isArray(t)) continue;
        for (let i = 1; i < t.length && i <= 2; i++) {
          if (!Array.isArray(t[i])) continue;
          const slot = i === 1 ? 'block' : 'shadow';
          const ot = oldBlock?.inputs?.[k];
          const reuse = ot && Array.isArray(ot[i]) ? oldPrim?.[k]?.[slot] : null;
          const pid = reuse && !usedOldIds.has(reuse) ? reuse : mintBlockId();
          usedOldIds.add(pid);
          ((outPrimitiveIds[fid] ||= {})[k] ||= {})[slot] = pid;
        }
      }
      const prefix = EXTENDABLE_OPERATORS[nb.opcode];
      if (prefix && nb.mutation?.itemcount) {
        const oldObs = oldId ? view.obscured[oldId] : null;
        const sameCount = oldBlock && String(oldBlock.mutation?.itemcount) === String(nb.mutation.itemcount);
        if (oldObs && sameCount) outObscured[fid] = oldObs;
      }
      if (oldId && view.obscured[oldId]?.some(holdsHiddenValue)) {
        const sameCount = oldBlock && String(oldBlock.mutation?.itemcount) === String(nb.mutation?.itemcount);
        if (!sameCount || nb.opcode !== oldBlock.opcode) {
          report('FR221', 'This edit would lose hidden operator values', {
            ...at(cand.spansOut.get(id)),
            hint: 'the operator holds values typed under reporters that were dropped onto it; edit it in Blocks mode, or keep its number of operands',
          });
        }
      }
      const span = cand.spansOut.get(id);
      if (span) sourceMap.blocks[fid] = { from: span[0], to: span[1] };
    }
    for (const oldOp of Object.keys(view.obscured)) {
      if (!pairedTop || !liveByTop.get(pairedTop)?.subgraph[oldOp]) continue;
      if (![...cand.map.values()].includes(oldOp) && view.obscured[oldOp].some(holdsHiddenValue)) {
        report('FR221', 'This edit would lose hidden operator values', {
          ...at(cand.spansOut.get(cand.top)),
          hint: 'an operator that holds hidden values is no longer matched by this text; edit it in Blocks mode instead',
        });
      }
    }
    const reusableComments = new Map();
    if (pairedTop) {
      for (const id of Object.keys(liveByTop.get(pairedTop)?.subgraph || {})) {
        for (const c of oldComments.get(id) || []) {
          if (isLegacyMarkerComment(c)) continue;
          if (!reusableComments.has(id)) reusableComments.set(id, []);
          reusableComments.get(id).push(c.id);
        }
      }
    }
    for (const c of cand.commentsOut) {
      const anchor = c.blockId ? r(c.blockId) : null;
      if (anchor && !outBlocks[anchor] && !view.blocks[anchor]) continue;
      const pool = anchor ? reusableComments.get(anchor) : null;
      const cid = pool?.length
        ? pool.shift()
        : mint(new Set([...Object.keys(target.comments || {}), ...Object.keys(outComments)]));
      outComments[cid] = {
        blockId: anchor,
        x: c.x ?? 0,
        y: c.y ?? 0,
        width: c.width ?? 200,
        height: c.height ?? 200,
        minimized: !!c.minimized,
        ...splitCommentText(c.text),
      };
      if (anchor && outBlocks[anchor]) outBlocks[anchor].comment = cid;
    }
    const finalTop = rename.get(cand.top);
    membershipEntries.set(finalTop, entry);
    return finalTop;
  };

  const validateCandidate = (cand, s) => {
    for (const p of cand.problemsOut) report(p.code, p.message, { ...at(p.span), hint: p.hint });
    const statements = statementPositions(cand.blocks, cand.top);
    for (const [id, b] of Object.entries(cand.blocks)) {
      if (cand.carried.has(id)) continue;
      const span = cand.spansOut.get(id) || s.span;
      const opcode = b.opcode;
      const ns = opcodeNamespace(opcode);
      const sig = sigs.byOpcode.get(opcode);
      const entry = table.byOpcode.get(opcode);
      if (opcode === '__bare_value') {
        const word = String(b.fields?.VALUE?.[0] ?? '');
        const near = /^[A-Za-z_]\w*$/.test(word)
          ? closestMatch(
              word,
              [...STATEMENT_KEYWORDS].filter((k) => !k.includes('_')),
              2
            )
          : null;
        report(
          'FR203',
          near
            ? `'${word}' is not a statement - did you mean '${near}'?`
            : 'this statement is just a value, not a block',
          {
            ...at(span),
            hint: 'did you mean to show it (say ...), or to assign it (name = ...)?',
          }
        );
        continue;
      }
      if (opcode === 'procedures_call' || opcode.startsWith('argument_') || opcode.startsWith('procedures_')) continue;
      const assetMenu = ASSET_MENUS[opcode];
      if (assetMenu) {
        const owner = assetMenu.stage ? stage || target : target;
        const names = (owner?.[assetMenu.list] || []).map((a) => String(a?.name ?? ''));
        const value = String(b.fields?.[assetMenu.field]?.[0] ?? '');
        if (names.length && !names.includes(value) && !assetMenu.specials.includes(value)) {
          const near = closestMatch(value, names, 3);
          report(
            'FR207',
            `there is no ${assetMenu.kind} ${JSON.stringify(value)}${near ? ` - did you mean ${JSON.stringify(near)}?` : ''}`,
            {
              ...at(span),
              severity: 'warning',
              hint: `${assetMenu.kind}s: ${names
                .slice(0, 20)
                .map((x) => JSON.stringify(x))
                .join(', ')}`,
            }
          );
        }
        continue;
      }
      const isExtension = ns && sigs.ids.has(ns) && !table.byOpcode.has(opcode);
      const builtin =
        !isExtension &&
        ns &&
        (BUILTIN_NAMESPACES.has(ns) || VALIDATED_NAMESPACES.has(ns) || table.byOpcode.has(opcode));
      if (builtin || !ns) {
        const known = table.byOpcode.has(opcode) || KNOWN_OPCODES.has(opcode);
        if (!known && VALIDATED_NAMESPACES.has(ns)) {
          const pool = [...(table.provided ? table.byOpcode.keys() : KNOWN_OPCODES)].filter((o) =>
            o.startsWith(`${ns}_`)
          );
          const near = closestMatch(opcode, pool, 3);
          report(
            'FR201',
            `unknown block '${opcode.replace('_', '.')}'${near ? ` - did you mean '${near.replace('_', '.')}'?` : ''}`,
            {
              ...at(span),
              hint: 'unknown opcodes load as broken red blocks in the editor',
            }
          );
          continue;
        }
        if (entry && statements.has(id) && isValueType(entry.shape)) {
          report('FR204', `'${opcode.replace('_', '.')}' reports a value, so it can't be used as a statement`, {
            ...at(span),
            hint: 'show it with say ..., or store it: name = ...;',
          });
        } else if (
          !entry &&
          statements.has(id) &&
          id !== cand.top &&
          (VALUE_OPCODES.has(opcode) || /^operator_/.test(opcode))
        ) {
          report('FR204', `'${opcode.replace('_', '.')}' reports a value, so it can't be used as a statement`, {
            ...at(span),
            hint: 'show it with say ..., or store it: name = ...;',
          });
        }
        if (statements.has(id) && MENU_OPCODES.has(opcode)) {
          report('FR202', `'${opcode.replace('_', '.')}' is a dropdown menu, not a standalone block`, { ...at(span) });
        }
        if (entry?.inputs) {
          for (const k of Object.keys(b.inputs || {})) {
            if (entry.inputs.includes(k) || /^SUBSTACK\d*$/.test(k) || EXTENDABLE_OPERATORS[opcode]) continue;
            if (entry.variadic?.prefix && new RegExp(`^${entry.variadic.prefix}\\d+$`).test(k)) continue;
            const near = closestMatch(k, entry.inputs, 3);
            report(
              'FR205',
              `'${opcode.replace('_', '.')}' has no input named ${k}${near ? ` - did you mean ${near}?` : ''}`,
              {
                ...at(span),
                hint: entry.inputs.length ? `inputs: ${entry.inputs.join(', ')}` : 'this block takes no inputs',
              }
            );
          }
        }
        if (entry?.fields) {
          for (const [k, v] of Object.entries(b.fields || {})) {
            if (!entry.fields.includes(k)) {
              report('FR206', `'${opcode.replace('_', '.')}' has no field named ${k}`, {
                ...at(span),
                hint: entry.fields.length ? `fields: ${entry.fields.join(', ')}` : 'this block has no fields',
              });
              continue;
            }
            const values = entry.menus?.[k];
            if (values && !values.includes(String(v?.[0] ?? ''))) {
              report('FR207', `${JSON.stringify(v?.[0])} is not a valid ${k} value`, {
                ...at(span),
                hint: `valid values: ${values.map((x) => JSON.stringify(x)).join(', ')}`,
              });
            }
          }
        }
        continue;
      }
      if (!sigs.provided) continue;
      if (!sigs.ids.has(ns)) {
        report('FR217', `the extension '${ns}' is not loaded`, {
          ...at(span),
          hint: 'load the extension first, or check the spelling of its id',
        });
        continue;
      }
      if (!sig) {
        const pool = [...sigs.byOpcode.keys()].filter((o) => o.startsWith(`${ns}_`)).map((o) => o.slice(ns.length + 1));
        const near = closestMatch(opcode.slice(ns.length + 1), pool, 3);
        report(
          'FR218',
          `${ns} has no block '${opcode.slice(ns.length + 1)}'${near ? ` - did you mean ${ns}.${near}?` : ''}`,
          {
            ...at(span),
            hint: pool.length ? `blocks: ${pool.map((x) => `${ns}.${x}`).join(', ')}` : null,
          }
        );
        continue;
      }
      if (sig.menu) continue;
      const argNames = sig.args.map((a) => a.name);
      for (const k of [...Object.keys(b.inputs || {}), ...Object.keys(b.fields || {})]) {
        if (/^SUBSTACK\d*$/.test(k) || argNames.includes(k)) continue;
        const near = closestMatch(k, argNames, 3);
        report('FR219', `${sig.label} has no argument ${k}${near ? ` - did you mean ${near}?` : ''}`, {
          ...at(span),
          hint: argNames.length ? `arguments: ${argNames.join(', ')}` : 'this block takes no arguments',
        });
      }
      for (const arg of sig.args) {
        if (arg.kind !== 'field' || !arg.values) continue;
        const v = b.fields?.[arg.name]?.[0];
        if (v != null && !arg.values.includes(String(v))) {
          report('FR207', `${JSON.stringify(v)} is not a valid ${arg.name} value for ${sig.label}`, {
            ...at(span),
            hint: `valid values: ${arg.values.map((x) => JSON.stringify(x)).join(', ')}`,
          });
        }
      }
      if (statements.has(id) && id !== cand.top && isValueType(sig.blockType)) {
        report('FR204', `${sig.label} reports a value, so it can't be used as a statement`, {
          ...at(span),
          hint: `show it with say ${sig.label}(...), or store it: name = ${sig.label}(...);`,
        });
      } else if (!statements.has(id) && isStatementType(sig.blockType)) {
        report('FR225', `${sig.label} is a command block, so it can't be used as a value`, { ...at(span) });
      }
    }
  };

  const checkNames = (s) => {
    const declared = (name) =>
      varMap.has(name) || cloudAliases.has(name) || listMap.has(name) || [...varMap.keys()].includes(name);
    const visitValue = (v, scope, stmtSpan) => {
      if (!v || typeof v !== 'object') return;
      if (v.type === 'ident') {
        if (scope.has(v.name) || declared(v.name)) return;
        const pool = [...varMap.keys(), ...listMap.keys(), ...cloudAliases.keys(), ...scope].filter(
          (n) => !String(n).startsWith('!local_')
        );
        const near = closestMatch(v.name, pool, 2);
        report('FR212', `'${v.name}' is not declared${near ? ` - did you mean ${near}?` : ''}`, {
          ...at(v.span || stmtSpan),
          hint: 'reading a name that was never declared would make a new empty variable',
          fix: declareFix(v.name),
        });
        return;
      }
      if (v.type === 'var' && v.id == null) {
        if (declared(v.name) || scope.has(v.name)) return;
        report('FR212', `variable ${JSON.stringify(v.name)} is not declared`, {
          ...at(v.span || stmtSpan),
          fix: declareFix(v.name),
        });
        return;
      }
      if (v.type === 'call') visitCall(v.value, scope, stmtSpan);
      if (v.type === 'obscured') {
        visitValue(v.active, scope, stmtSpan);
        visitValue(v.shadow, scope, stmtSpan);
      }
    };
    const assignOpcodes = new Set(['data_setvariableto', 'data_changevariableby', 'control_for_each']);
    const visitCall = (node, scope, stmtSpan) => {
      if (!node || typeof node !== 'object') return;
      const span = spanOfCall(node) || stmtSpan;
      if (node.type === 'localDecl') {
        visitValue(node.value, scope, span);
        scope.add(node.name);
        return;
      }
      if (node.type === 'procDef') {
        const inner = new Set(scope);
        for (const p of node.params || []) inner.add(p.ident);
        for (const st of node.body || []) visitCall(st, inner, spanOfCall(st) || span);
        return;
      }
      if (node.type !== 'call') return;
      const spec = node.listIteration;
      if (spec && (spec.forced || listMap.has(spec.listName))) {
        for (const name of [spec.valueName, spec.indexName]) {
          if (scope.has(name) || declared(name)) continue;
          if (name === spec.valueName) {
            report('FR213', `the loop creates a new variable '${name}'`, {
              ...at(span),
              hint: 'declare it at the top of the file to make the intent explicit',
              fix: declareFix(name),
            });
          }
          implicitVars.add(name);
        }
      }
      if (spec) {
        scope.add(spec.valueName);
        scope.add(spec.indexName);
      }
      const opcode = node.callee?.type === 'opcode' ? node.callee.name : null;
      for (const a of node.args || []) {
        if (a.kind === 'branch') {
          for (const st of a.body || []) visitCall(st, scope, spanOfCall(st) || span);
          continue;
        }
        if (a.kind === 'keyed' && a.sep === 'field' && a.key === 'VARIABLE' && a.value?.type === 'ident') {
          const name = a.value.name;
          if (scope.has(name) || declared(name)) continue;
          if (assignOpcodes.has(opcode)) {
            report('FR213', `assigning creates a new variable '${name}'`, {
              ...at(span),
              hint: 'declare it at the top of the file to make the intent explicit',
              fix: declareFix(name),
            });
            scope.add(name);
            implicitVars.add(name);
          }
          continue;
        }
        if (a.kind === 'keyed' && a.sep === 'field' && a.key === 'LIST' && a.value?.type === 'list') {
          if (!listMap.has(a.value.name) && !scope.has(a.value.name)) implicitLists.add(a.value.name);
          continue;
        }
        if (a.kind === 'keyed' && a.sep === 'field') continue;
        visitValue(a.value, scope, span);
      }
    };
    const scope = new Set();
    for (const st of s.calls) visitCall(st, scope, spanOfCall(st) || s.span);
  };
  const implicitVars = new Set();
  const implicitLists = new Set();
  const headerEnd = (() => {
    let end = 0;
    for (const d of parsed.varDecls) if (d.span) end = Math.max(end, d.span[1]);
    for (const d of parsed.importDecls || []) if (d.span) end = Math.max(end, d.span[1]);
    return end;
  })();
  const declareFix = (name) => {
    const insert = headerEnd ? `\nvar ${varNameToken(name)} = 0;` : `var ${varNameToken(name)} = 0;\n\n`;
    return {
      title: `Declare var ${name}`,
      edits: [{ from: headerEnd, to: headerEnd, text: insert, ...rangeExtra(index, headerEnd, headerEnd) }],
    };
  };

  const pairedOld = new Map();
  for (const [ni, oi] of pairs) pairedOld.set(ni, prevScripts[oi].topId);
  const builtScripts = [];
  const lockedSpans = new Map();
  newScripts.forEach((n, ni) => {
    const s = n.script;
    const region = s.region ?? null;
    const entry = { region, module: null };
    const pairedTop = pairedOld.get(ni) || null;
    if (pairedTop && lockedIds.has(pairedTop)) {
      const prev = prevScripts.find((p) => p.topId === pairedTop);
      if (prev && prev.norm !== n.norm) {
        report(
          'FR121',
          "this script is locked: fractch can't convert it back the same way, so it can't be edited as text",
          {
            ...at(s.span),
            hint: 'edit it in Blocks mode, or delete the whole script',
          }
        );
      }
      lockedSpans.set(pairedTop, s.span);
      return;
    }
    const exactPrev = pairedTop ? prevScripts.find((p) => p.topId === pairedTop) : null;
    if (fast && exactPrev && exactPrev.raw === n.raw) {
      carryLive(pairedTop, entry);
      unchangedScripts.push(pairedTop);
      const delta = s.span[0] - exactPrev.from;
      sourceMap.scripts[pairedTop] = { from: s.span[0], to: s.span[1] };
      for (const id of Object.keys(liveByTop.get(pairedTop).subgraph)) {
        const range = previous.sourceMap?.blocks?.[id];
        if (range) sourceMap.blocks[id] = { from: range.from + delta, to: range.to + delta };
      }
      return;
    }
    checkNames(s);
    for (const name of implicitVars) {
      if (varMap.has(name)) continue;
      const id = mintDeclId();
      outVariables[id] = [name, 0];
      varMap.set(name, id);
      created.variables.push({ id, name, owner: targetKey(target), implicit: true });
    }
    for (const name of implicitLists) {
      if (listMap.has(name)) continue;
      const id = mintDeclId();
      outLists[id] = [name, []];
      listMap.set(name, id);
      created.lists.push({ id, name, owner: targetKey(target), implicit: true });
    }
    for (const name of collectBroadcastNames(s.calls)) {
      if (broadcastNameToId.has(name)) continue;
      const id = mintDeclId();
      broadcastNameToId.set(name, id);
      newBroadcasts.set(name, id);
      created.broadcasts.push({ id, name, owner: targetKey(stage || target) });
      const near = closestMatch(
        name,
        [...broadcastNameToId.keys()].filter((n) => n !== name),
        2
      );
      report(
        'FR222',
        `creates broadcast ${JSON.stringify(name)}${near ? ` - did you mean ${JSON.stringify(near)}?` : ''}`,
        {
          ...at(s.span),
        }
      );
    }
    const cand = buildCandidate(s, pairedTop);
    if (!cand.top) return;
    builtScripts.push({ cand, s, pairedTop, entry });
  });

  for (const item of builtScripts) {
    const { cand, s, pairedTop, entry } = item;
    validateCandidate(cand, s);
    if (pairedTop) {
      cand.map = alignScripts(view.blocks, pairedTop, cand.blocks, cand.top);
      carryFromOld(cand, { blocks: view.blocks, top: pairedTop }, cand.map);
    }
    dropNullInputs(cand);
    if (pairedTop) {
      const diff = compareScripts(
        { blocks: view.blocks, top: pairedTop, comments: oldComments },
        { blocks: cand.blocks, top: cand.top, comments: candidateComments(cand) },
        cand.map
      );
      if (!diff) {
        item.unchanged = true;
        if (usedOldIds.has(pairedTop)) {
          membershipEntries.set(pairedTop, entry);
          unchangedScripts.push(pairedTop);
          continue;
        }
        carryLive(pairedTop, entry);
        unchangedScripts.push(pairedTop);
        sourceMap.scripts[pairedTop] = { from: s.span[0], to: s.span[1] };
        for (const [n, o] of cand.map) {
          const span = cand.spansOut.get(n);
          if (span) sourceMap.blocks[o] = { from: span[0], to: span[1] };
        }
        continue;
      }
      differences[pairedTop] = diff || 'the script was rebuilt';
    }
    const finalTop = finalizeChanged(cand, pairedTop, entry);
    sourceMap.scripts[finalTop] = { from: s.span[0], to: s.span[1] };
    if (pairedTop) changed.push({ topId: pairedTop, newTopId: finalTop, reason: differences[pairedTop] });
    else created.scripts.push(finalTop);
  }

  for (const id of lockedIds) {
    if (usedOldIds.has(id)) continue;
    const placeholder = parsed.lockedScripts.find((l) => l.id === id);
    const range = (opts.lockedScripts || []).find((l) => l && typeof l === 'object' && l.topId === id);
    const rangeHit = range?.from != null && parsed.scripts.some((ps) => ps.span?.[0] === range.from);
    const pairedSpan = lockedSpans.get(id);
    const region = placeholder
      ? placeholder.region
      : pairedSpan
        ? regionAt(pairedSpan[0])
        : rangeHit
          ? regionAt(range.from)
          : null;
    if (!liveByTop.has(id)) {
      if (placeholder) {
        report('FR121', `locked script ${JSON.stringify(id)} no longer exists in this sprite`, {
          ...at(placeholder.span, placeholder.line),
          severity: 'warning',
          hint: 'delete this line',
        });
      }
      continue;
    }
    if (!placeholder && !pairedSpan && !rangeHit) continue;
    carryLive(id, { region: region ?? null, module: null });
    unchangedScripts.push(id);
    const lockedSpan = placeholder?.span || pairedSpan;
    if (lockedSpan) sourceMap.scripts[id] = { from: lockedSpan[0], to: lockedSpan[1] };
    else sourceMap.scripts[id] = { from: range.from, to: range.to };
  }

  const userCalls = textScripts.map((s) => s.calls);
  for (const top of unchangedScripts) {
    const live = liveByTop.get(top);
    if (!live) continue;
    for (const b of Object.values(live.subgraph)) {
      if (b?.opcode === 'procedures_call' && b.mutation?.proccode) {
        const info = procByCode.get(b.mutation.proccode);
        if (info) userCalls.push([{ type: 'call', callee: { type: 'procedureCall', name: info.ident }, args: [] }]);
      }
    }
  }
  const importedModules = resolveStdlibModules((parsed.imports || []).filter((m) => STDLIB_MODULES[m]));
  const registry = stdlibRegistry(Object.keys(STDLIB_MODULES));
  const needed = stdlibUsed(userCalls, registry);
  const liveStdlib = new Map();
  for (const s of liveScripts) {
    const entry = membership.entryFor(s.topBlockId);
    if (!entry.module) continue;
    const code = view.blocks[view.blocks[s.topBlockId]?.inputs?.custom_block?.[1]]?.mutation?.proccode;
    const ident = code ? procByCode.get(code)?.ident : null;
    liveStdlib.set(s.topBlockId, { module: entry.module, ident, code });
  }
  const presentIdents = new Set();
  for (const [top, info] of liveStdlib) {
    const keep = (info.ident && needed.has(info.ident)) || importedModules.includes(info.module);
    if (keep && !usedOldIds.has(top)) {
      carryLive(top, { region: null, module: info.module });
      unchangedScripts.push(top);
      if (info.ident) presentIdents.add(info.ident);
    }
  }
  for (const ident of needed) {
    if (presentIdents.has(ident) || textDefCodes.has(identMap.get(ident))) continue;
    const reg = registry.get(ident);
    if (!reg) continue;
    if (identMap.get(ident) && liveProtoIds.has(identMap.get(ident)) && !liveStdlib.size) continue;
    registerProcDefs(procArgMaps, identToProccode, procMetaMaps, T, reg.calls);
    const code = synthesizeProccode(ident, reg.calls[0].params.length);
    identMap.set(ident, code);
    if (!argMap.has(code))
      argMap.set(
        code,
        reg.calls[0].params.map(() => mintBlockId())
      );
    metaMap.set(code, {
      warp: reg.calls[0].warp,
      customcolor: reg.calls[0].customcolor,
      returns: reg.calls[0].returns,
    });
    const cand = buildCandidate({ calls: reg.calls, x: reg.x, y: reg.y, span: null }, null);
    if (!cand.top) continue;
    const finalTop = finalizeChanged(cand, null, { region: null, module: reg.moduleId });
    created.scripts.push(finalTop);
    presentIdents.add(ident);
  }

  for (const s of liveScripts) {
    if (usedOldIds.has(s.topBlockId)) continue;
    removed.scripts.push(s.topBlockId);
  }
  for (const id of orphans) {
    if (outBlocks[id] || usedOldIds.has(id)) continue;
    outBlocks[id] = view.blocks[id];
    if (view.primitiveIds[id]) outPrimitiveIds[id] = view.primitiveIds[id];
  }
  for (const [id, b] of Object.entries(outBlocks)) {
    if (view.arrayTops.has(id) && b === view.blocks[id]) outBlocks[id] = target.blocks[id];
  }

  const floatingNew = parsed.comments || [];
  const liveFloating = new Map();
  for (const [id, c] of Object.entries(view.comments || {})) {
    if (!c || isMembershipComment(c) || isReservedComment(c, target) || isLegacyMarkerComment(c)) continue;
    const anchor = c.blockId && view.blocks[c.blockId] ? statementAnchor(view.blocks, c.blockId) : null;
    if (anchor) continue;
    liveFloating.set(id, c);
  }
  const prevCommentByText = new Map();
  for (const [id, range] of Object.entries(previous.sourceMap?.comments || {})) {
    prevCommentByText.set(id, normalizeLines(String(previous.text).slice(range.from, range.to)));
  }
  const usedComment = new Set();
  const anchorItems = [];
  for (const [topId, range] of Object.entries(sourceMap.scripts)) {
    anchorItems.push({ kind: 'script', at: range.from, file: 0, region: regionAt(range.from), topId });
  }
  for (const c of floatingNew) {
    const raw = c.span ? source.slice(c.span[0], c.span[1]) : commentDeclLine(c);
    const norm = normalizeLines(raw);
    const textValue = String(c.text ?? '');
    const anchorItem = (commentId) => {
      if (c.span) anchorItems.push({ kind: 'comment', at: c.span[0], file: 0, region: c.region ?? null, commentId });
    };
    let match = null;
    for (const [id, t] of prevCommentByText) {
      if (!usedComment.has(id) && liveFloating.has(id) && t === norm) {
        match = id;
        break;
      }
    }
    const fields = {
      blockId: c.forId || null,
      x: c.x ?? 0,
      y: c.y ?? 0,
      width: c.width ?? 200,
      height: c.height ?? 200,
      minimized: !!c.minimized,
    };
    if (!match) {
      for (const [id, lc] of liveFloating) {
        if (usedComment.has(id)) continue;
        if (
          commentText(lc) === textValue &&
          (!c.positioned ||
            (Math.round(lc.x ?? 0) === Math.round(fields.x) && Math.round(lc.y ?? 0) === Math.round(fields.y)))
        ) {
          match = id;
          break;
        }
      }
    }
    if (!match && c.span) {
      const start = oldOffset(c.span[0]);
      for (const [id, range] of Object.entries(previous.sourceMap?.comments || {})) {
        if (!usedComment.has(id) && liveFloating.has(id) && range.from === start) {
          match = id;
          break;
        }
      }
    }
    if (match && !c.positioned) {
      const lc = liveFloating.get(match);
      fields.x = lc.x ?? 0;
      fields.y = lc.y ?? 0;
    } else if (!match && !c.positioned) {
      fields.x = 0;
      fields.y = lowestY == null ? newScriptIndex * 200 : lowestY + 200 * (newScriptIndex + 1);
      newScriptIndex++;
    }
    if (match) {
      usedComment.add(match);
      anchorItem(match);
      const lc = liveFloating.get(match);
      const same =
        commentText(lc) === String(c.text ?? '') &&
        (lc.blockId || null) === fields.blockId &&
        Math.round(lc.x ?? 0) === Math.round(fields.x) &&
        Math.round(lc.y ?? 0) === Math.round(fields.y) &&
        (lc.width ?? 200) === fields.width &&
        (lc.height ?? 200) === fields.height &&
        !!lc.minimized === fields.minimized;
      outComments[match] = same ? lc : { ...fields, ...splitCommentText(c.text) };
      if (c.span) sourceMap.comments[match] = { from: c.span[0], to: c.span[1] };
      continue;
    }
    const cid = mint(new Set([...Object.keys(target.comments || {}), ...Object.keys(outComments)]));
    outComments[cid] = { ...fields, ...splitCommentText(c.text) };
    created.comments.push(cid);
    anchorItem(cid);
    if (c.span) sourceMap.comments[cid] = { from: c.span[0], to: c.span[1] };
  }
  for (const id of liveFloating.keys()) if (!usedComment.has(id)) removed.comments.push(id);
  const commentEntries = commentBeforeAnchors(anchorItems);

  const membershipIds = new Set(membershipEntries.keys());
  const needsMap =
    membership.authoritative ||
    membership.hasLegacy ||
    commentEntries.size > 0 ||
    [...membershipEntries.values()].some((e) => e.region || e.module);
  if (needsMap) {
    const ordered = [...membershipEntries].filter(([id]) => membershipIds.has(id) && outBlocks[id]);
    const mapId = membership.commentId || MEMBERSHIP_COMMENT_ID;
    const old = mapId ? target.comments?.[mapId] : null;
    const textValue = membershipText(ordered, commentEntries);
    outComments[mapId] =
      old && commentText(old) === textValue
        ? old
        : {
            blockId: null,
            x: old?.x ?? 0,
            y: old?.y ?? 0,
            width: old?.width ?? 200,
            height: old?.height ?? 200,
            minimized: true,
            ...splitCommentText(textValue),
          };
  }

  for (const list of [removed.variables, removed.lists]) {
    for (const r of list) {
      const kind = list === removed.lists ? 'list' : 'var';
      const users = referencesOf(
        { targets: contextTargets(context).map((t) => (t === target ? { ...t, blocks: outBlocks } : t)) },
        r.id,
        r.name,
        kind,
        target
      );
      if (users.length) {
        const decl = [...prevDecls.values()].find((d) => declName(d) === r.name && declKind(d, target) === kind);
        report('FR220', `${r.name} is used by ${users.map((u) => u.name).join(', ')}`, {
          line: 1,
          column: 1,
          hint: `put back the line ${decl ? JSON.stringify(previousDeclText(decl)) : `var ${r.name}`}, or remove the blocks that use it first`,
        });
      }
    }
  }

  const defsByCode = new Map();
  for (const b of Object.values(outBlocks)) {
    if (b?.opcode === 'procedures_prototype' && b.mutation?.proccode) {
      let ids = [];
      try {
        ids = JSON.parse(b.mutation.argumentids || '[]');
      } catch {
        ids = [];
      }
      defsByCode.set(b.mutation.proccode, ids);
    }
  }
  for (const item of builtScripts) {
    if (item.unchanged) continue;
    checkProcedureCalls(item.s.calls, defsByCode, identMap, procByCode, report, at);
  }
  for (const top of unchangedScripts) {
    for (const b of Object.values(liveByTop.get(top)?.subgraph || {})) {
      if (b?.opcode !== 'procedures_call' || !b.mutation?.proccode || defsByCode.has(b.mutation.proccode)) continue;
      if (!liveProtoIds.has(b.mutation.proccode)) continue;
      const range = sourceMap.scripts[top];
      report('FR208', `this script calls a custom block that no longer exists: ${b.mutation.proccode}`, {
        ...(range ? rangeExtra(index, range.from, range.from) : { line: 1, column: 1 }),
        hint: 'put the definition back, or remove the call',
      });
    }
  }

  const liveDangling = new Set();
  for (const b of Object.values(view.blocks)) {
    for (const t of Object.values(b?.inputs || {})) {
      if (!Array.isArray(t)) continue;
      for (const x of t.slice(1)) if (typeof x === 'string' && !view.blocks[x]) liveDangling.add(x);
    }
  }
  const integrity = checkIntegrity(outBlocks, outObscured, builtIds, liveDangling);
  if (integrity) report('FR227', `internal error: ${integrity}`, { line: 1, column: 1 });

  if (outBroadcasts) for (const [name, id] of newBroadcasts) outBroadcasts[id] = name;
  const outTarget = { ...target, blocks: outBlocks, comments: outComments, variables: outVariables, lists: outLists };
  delete outTarget.primitiveIds;
  delete outTarget.obscuredShadows;
  if (outBroadcasts) outTarget.broadcasts = outBroadcasts;

  const sourceIndex = index;
  addLines(sourceMap.scripts, sourceIndex);
  addLines(sourceMap.blocks, sourceIndex);
  addLines(sourceMap.comments, sourceIndex);
  for (const d of parsed.varDecls) {
    if (!d.span) continue;
    sourceMap.declarations[declKey(d, target)] = { from: d.span[0], to: d.span[1] };
  }
  for (const r of parsed.regions) if (r.span) sourceMap.regions[r.name] = { from: r.span[0], to: r.span[1] };
  addLines(sourceMap.declarations, sourceIndex);
  addLines(sourceMap.regions, sourceIndex);

  const result = {
    target: outTarget,
    unchangedScripts,
    changed,
    differences,
    created,
    removed,
    diagnostics,
    sourceMap,
    primitiveIds: outPrimitiveIds,
    obscuredShadows: outObscured,
    valueSets,
  };
  if (opts.verifyRoundTrip && !diagnostics.some((d) => d.severity === 'error')) {
    const issue = verifyRoundTrip(context, target, result, opts);
    if (issue) {
      const line = issue.line || 1;
      report('FR224', `This text would not convert back the same way${issue.reason ? `: ${issue.reason}` : ''}`, {
        line,
        column: 1,
        endLine: line,
        endColumn: 1,
        hint: issue.text ? `first differing line: ${issue.text}` : null,
      });
    }
  }
  return result;
}

const declCache = new Map();

function parseDeclarations(text) {
  if (declCache.has(text)) return declCache.get(text);
  const parsed = parseFractch(text);
  const value = { varDecls: parsed.varDecls };
  declCache.set(text, value);
  if (declCache.size > 4) declCache.delete(declCache.keys().next().value);
  return value;
}

function previousDeclText(decl) {
  const head = decl.cloud ? 'cloud' : 'var';
  if (decl.keep) return `${head} ${varNameToken(decl.name)} = keep;`;
  return `${head} ${varNameToken(decl.name)} = ${Array.isArray(decl.value) ? JSON.stringify(decl.value) : varValueText(decl.value)};`;
}

function collectBroadcastNames(calls) {
  const out = new Set();
  const visitValue = (v) => {
    if (!v || typeof v !== 'object') return;
    if (v.type === 'broadcast' && v.id == null) out.add(v.name);
    if (v.type === 'call') visitCall(v.value);
    if (v.type === 'obscured') {
      visitValue(v.active);
      visitValue(v.shadow);
    }
  };
  const visitCall = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'procDef') {
      for (const st of node.body || []) visitCall(st);
      return;
    }
    if (node.type === 'localDecl') {
      visitValue(node.value);
      return;
    }
    const opcode = node.callee?.name;
    for (const a of node.args || []) {
      if (a.kind === 'branch') {
        for (const st of a.body || []) visitCall(st);
        continue;
      }
      if (a.kind === 'keyed' && a.key === 'BROADCAST_OPTION') {
        const v = a.value;
        if (v?.type === 'broadcast' && v.id == null) out.add(v.name);
        else if (v?.type === 'array' && typeof v.value?.[0] === 'string' && v.value.length < 2) out.add(v.value[0]);
        continue;
      }
      if (
        a.kind === 'keyed' &&
        a.key === 'BROADCAST_INPUT' &&
        (opcode === 'event_broadcast' || opcode === 'event_broadcastandwait') &&
        (a.value?.type === 'string' || (a.value?.type === 'obscured' && a.value.shadow?.type === 'string'))
      ) {
        out.add(a.value.type === 'string' ? a.value.value : a.value.shadow.value);
        if (a.value.type === 'obscured') visitValue(a.value.active);
        continue;
      }
      visitValue(a.value);
    }
  };
  for (const c of calls || []) visitCall(c);
  return out;
}

function checkProcedureCalls(calls, defsByCode, identMap, procByCode, report, at) {
  const defs = new Map();
  for (const info of procByCode.values()) if (defsByCode.has(identMap.get(info.ident))) defs.set(info.ident, info);
  for (const [ident, code] of identMap) {
    if (code && defsByCode.has(code) && !defs.has(ident)) {
      defs.set(ident, { ident, params: defsByCode.get(code).map((id, i) => ({ ident: `arg${i + 1}`, id })) });
    }
  }
  const visitValue = (v) => {
    if (!v || typeof v !== 'object') return;
    if (v.type === 'call') visit(v.value);
    if (v.type === 'obscured') {
      visitValue(v.active);
      visitValue(v.shadow);
    }
  };
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'procDef') {
      for (const st of node.body || []) visit(st);
      return;
    }
    if (node.type === 'localDecl') {
      visitValue(node.value);
      return;
    }
    if (node.callee?.type === 'procedureCall') {
      const ident = node.callee.name;
      const code = identMap.get(ident);
      const span = node.span || null;
      if (!code || !defsByCode.has(code)) {
        if (!STDLIB_METHODS_IDENTS.has(ident)) {
          const near = closestMatch(
            ident,
            [...identMap.keys()].filter((k) => defsByCode.has(identMap.get(k))),
            3
          );
          report('FR208', `call to undefined custom block @${ident}${near ? ` - did you mean @${near}?` : ''}`, {
            ...at(span, node.callee.line),
            hint: near ? null : `define it with: def @${ident}(...) { ... }`,
          });
        }
      } else {
        const expected = defsByCode.get(code).length;
        if ((node.args || []).length > expected) {
          const def = defs.get(ident);
          const params = def ? def.params.map((p) => p.ident).join(', ') : '';
          report(
            'FR209',
            `@${ident} takes ${expected} argument${expected === 1 ? '' : 's'} but this call passes ${node.args.length}`,
            { ...at(span, node.callee.line), hint: `defined as def @${ident}(${params})` }
          );
        }
      }
    }
    for (const a of node.args || []) {
      if (a.kind === 'branch') for (const st of a.body || []) visit(st);
      else visitValue(a.value);
    }
  };
  for (const c of calls || []) visit(c);
}

const STDLIB_METHODS_IDENTS = new Set(Object.values(STDLIB_METHODS).map((m) => m.ident));

function checkIntegrity(blocks, obscured, checked, tolerated) {
  for (const [id, b] of Object.entries(blocks)) {
    if (Array.isArray(b) || !checked.has(id)) continue;
    if (!b || typeof b.opcode !== 'string') return `block ${id} has no opcode`;
    for (const [k, t] of Object.entries(b.inputs || {})) {
      if (!Array.isArray(t)) continue;
      for (let i = 1; i < t.length; i++) {
        if (typeof t[i] === 'string' && !blocks[t[i]] && !tolerated.has(t[i])) {
          return `input ${k} of block ${id} points at a missing block`;
        }
      }
    }
    if (b.topLevel && b.parent != null) return `top-level block ${id} has a parent`;
  }
  for (const id of Object.keys(obscured || {})) {
    if (!blocks[id]) return `obscured shadows recorded for missing operator ${id}`;
  }
  for (const start of checked) {
    const seen = new Set();
    let cur = start;
    while (cur != null && !Array.isArray(blocks[cur])) {
      if (seen.has(cur)) return `cycle through block ${cur}`;
      seen.add(cur);
      cur = blocks[cur]?.parent ?? null;
      if (seen.size > 100000) break;
    }
  }
  return null;
}

function verifyRoundTrip(context, target, result, opts) {
  const nextTargets = contextTargets(context).map((t) =>
    t === target ? { ...result.target, primitiveIds: result.primitiveIds, obscuredShadows: result.obscuredShadows } : t
  );
  const nextContext = { ...context, targets: nextTargets };
  delete nextContext.primitiveIds;
  delete nextContext.obscuredShadows;
  if (isLiveContext(context)) nextContext.form = 'live';
  const key = targetKey(target);
  const emitted = emitTarget(nextContext, key, {
    lockCheck: false,
    extensions: opts.extensions,
    opcodes: opts.opcodes,
  });
  const rebuilt = buildTarget(nextContext, key, emitted.text, {
    previous: emitted,
    extensions: opts.extensions,
    opcodes: opts.opcodes,
    lockedScripts: result.unchangedScripts.filter((id) =>
      (opts.lockedScripts || []).some((l) => l === id || l?.topId === id)
    ),
    forceBuild: new Set([...result.changed.map((c) => c.newTopId), ...result.created.scripts]),
    uid: opts.uid,
  });
  const first =
    rebuilt.changed[0] || (rebuilt.created.scripts.length ? { newTopId: rebuilt.created.scripts[0] } : null);
  const removedScripts = rebuilt.removed.scripts;
  if (!first && !removedScripts.length) return null;
  const topId = first?.topId || removedScripts[0];
  const range = emitted.sourceMap.scripts[topId];
  const lineText = range ? emitted.text.slice(range.from).split('\n')[0] : null;
  const line = result.sourceMap.scripts[topId]?.line ?? null;
  return { reason: first?.reason || 'a script went missing', text: lineText, line };
}

export function findInSourceMap(sourceMap, offset) {
  let best = null;
  for (const [kind, map] of [
    ['block', sourceMap?.blocks],
    ['comment', sourceMap?.comments],
    ['script', sourceMap?.scripts],
  ]) {
    for (const [id, r] of Object.entries(map || {})) {
      if (offset < r.from || offset > r.to) continue;
      if (!best || r.to - r.from < best.to - best.from) best = { kind, id, from: r.from, to: r.to };
    }
  }
  return best;
}

export function toReplaceChange(result, { liveScripts } = {}) {
  const target = result.target;
  const keepScripts = result.unchangedScripts.filter((id) => {
    const b = target.blocks[id];
    if (!b || (b.parent && !Array.isArray(b))) return false;
    return !liveScripts || liveScripts.includes(id);
  });
  const comments = {};
  for (const [id, c] of Object.entries(target.comments || {})) {
    if (!isReservedComment(c, target)) comments[id] = c;
  }
  const create = [];
  const valueOf = (dict, id) => (Array.isArray(dict?.[id]) ? dict[id][1] : undefined);
  for (const v of result.created.variables) {
    const entry = { id: v.id, name: v.name, type: '', value: valueOf(target.variables, v.id) ?? 0 };
    if (v.cloud) entry.isCloud = true;
    create.push(entry);
  }
  for (const v of result.created.lists)
    create.push({ id: v.id, name: v.name, type: 'list', value: valueOf(target.lists, v.id) ?? [] });
  for (const b of result.created.broadcasts)
    create.push({ id: b.id, name: b.name, type: 'broadcast_msg', scope: 'stage' });
  const remove = [...result.removed.variables, ...result.removed.lists].map((v) => v.id);
  const set = {};
  const createdIds = new Set(create.map((c) => c.id));
  for (const [id, value] of Object.entries(result.valueSets || {})) if (!createdIds.has(id)) set[id] = value;
  return {
    format: 'sb3',
    blocks: target.blocks,
    primitiveIds: result.primitiveIds,
    obscuredShadows: result.obscuredShadows,
    keepScripts,
    comments,
    variables: { create, delete: remove, set },
  };
}
