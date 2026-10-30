import { compareTrees } from './roundtripDiff.js';
import { deepEqual } from './pack.js';
import { decodeDataUrl } from './extensions.js';
import { MEMBERSHIP_MAGIC } from './membership.js';
import { md5hex } from './md5.js';
import { isMenuShadow } from './graph.js';
import { decodeFileStemFromComment } from './fileMarkers.js';

const LOCAL_VARIABLE = /^(?:!local_[A-Za-z0-9]+_|local_\d+_)/;

const SPRITE_DEFAULTS = {
  x: 0,
  y: 0,
  size: 100,
  direction: 90,
  visible: true,
  draggable: false,
  rotationStyle: 'all around',
  volume: 100,
  currentCostume: 0,
};

const STAGE_DEFAULTS = {
  volume: 100,
  tempo: 60,
  videoState: 'on',
  videoTransparency: 50,
  textToSpeechLanguage: null,
  currentCostume: 0,
};

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const same = (a, b) => {
  if (typeof a === 'number' || typeof b === 'number') {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
  }
  return deepEqual(a ?? null, b ?? null);
};

const commentText = (comment) =>
  String(comment?.text || '') + (typeof comment?.extraText === 'string' ? comment.extraText : '');

function topLevelScripts(blocks) {
  const scripts = [];
  for (const [id, block] of Object.entries(blocks || {})) {
    if (Array.isArray(block)) {
      if (block.length >= 5 && (block[0] === 12 || block[0] === 13)) {
        scripts.push({ id, opcode: block[0] === 12 ? 'data_variable' : 'data_listcontents', x: block[3], y: block[4] });
      }
    } else if (block && block.topLevel && !block.parent && !(block.shadow && isMenuShadow(block))) {
      scripts.push({ id, opcode: block.opcode, x: block.x, y: block.y });
    }
  }
  return scripts;
}

const placeText = (script) => `${Math.round(Number(script.x) || 0)}, ${Math.round(Number(script.y) || 0)}`;

const placeKey = (script) =>
  `${script.opcode}@${Math.round(Number(script.x) || 0)},${Math.round(Number(script.y) || 0)}`;

const looseReporterName = (blocks, id) => {
  const block = blocks[id];
  if (Array.isArray(block)) return String(block[1] ?? '');
  if (block?.opcode === 'data_variable' && !block.next) return String(block.fields?.VARIABLE?.[0] ?? '');
  if (block?.opcode === 'data_listcontents' && !block.next) return String(block.fields?.LIST?.[0] ?? '');
  return null;
};

function compareScripts(before, after, report, where) {
  const left = topLevelScripts(before.blocks);
  const right = topLevelScripts(after.blocks);
  const unmatched = new Map();
  for (const script of right) {
    const key = placeKey(script);
    if (!unmatched.has(key)) unmatched.set(key, []);
    unmatched.get(key).push(script);
  }
  const leftovers = [];
  const pairs = [];
  for (const script of left) {
    const queue = unmatched.get(placeKey(script));
    if (queue && queue.length) pairs.push([script, queue.shift()]);
    else leftovers.push(script);
  }
  const remaining = [...unmatched.values()].flat();
  for (const script of leftovers) {
    const index = remaining.findIndex((candidate) => candidate.opcode === script.opcode);
    if (index < 0) {
      report(`${where}.scripts`, `would lose the script at ${placeText(script)}`, script.opcode);
      continue;
    }
    pairs.push([script, remaining.splice(index, 1)[0]]);
  }
  for (const [a, b] of pairs) {
    if (Array.isArray(before.blocks[a.id]) || Array.isArray(after.blocks[b.id])) {
      if (looseReporterName(before.blocks, a.id) !== looseReporterName(after.blocks, b.id)) {
        report(`${where}.scripts`, `would change the loose reporter at ${placeText(a)}`, a.opcode);
      }
      continue;
    }
    const difference = compareTrees(before.blocks, a.id, after.blocks, b.id);
    if (difference)
      report(`${where}.scripts`, `would change the script at ${placeText(a)}`, `${a.opcode} ${difference}`);
  }
}

function namedEntries(dict) {
  const out = new Map();
  for (const entry of Object.values(dict || {})) {
    if (!Array.isArray(entry) || typeof entry[0] !== 'string') continue;
    const name = entry[0];
    if (LOCAL_VARIABLE.test(name)) continue;
    out.set(name, entry);
  }
  return out;
}

function compareVariables(before, after, report, where) {
  for (const kind of ['variables', 'lists']) {
    const left = namedEntries(before[kind]);
    const right = namedEntries(after[kind]);
    for (const [name, entry] of left) {
      const other = right.get(name);
      if (!other) {
        report(`${where}.${kind}`, `lost ${JSON.stringify(name)}`);
        continue;
      }
      const value = kind === 'lists' ? (entry[1] || []).map(String) : String(entry[1] ?? '');
      const otherValue = kind === 'lists' ? (other[1] || []).map(String) : String(other[1] ?? '');
      if (!deepEqual(value, otherValue)) report(`${where}.${kind}`, `${JSON.stringify(name)} changed its value`);
      if (kind === 'variables' && Boolean(entry[2]) !== Boolean(other[2])) {
        report(`${where}.${kind}`, `${JSON.stringify(name)} changed whether it is a cloud variable`);
      }
    }
  }
}

async function compareAssets(before, after, report, where, sameAsset) {
  for (const kind of ['costumes', 'sounds']) {
    const left = before[kind] || [];
    const right = after[kind] || [];
    if (kind === 'costumes' && !left.length) continue;
    if (left.length !== right.length) {
      report(`${where}.${kind}`, `has ${left.length} before and ${right.length} after`);
      continue;
    }
    for (let i = 0; i < left.length; i++) {
      const a = left[i];
      const b = right[i];
      const label = `${where}.${kind}[${JSON.stringify(String(a.name ?? i))}]`;
      if (String(a.name ?? '') !== String(b.name ?? '')) report(label, `was renamed to ${JSON.stringify(b.name)}`);
      if (!(await sameAsset(a.md5ext, b.md5ext))) report(label, 'has different file contents');
      const fields =
        kind === 'costumes'
          ? [
              ['rotationCenterX', 0],
              ['rotationCenterY', 0],
              ['bitmapResolution', 1],
            ]
          : [
              ['rate', null],
              ['sampleCount', null],
            ];
      for (const [field, fallback] of fields) {
        if (!same(a[field] ?? fallback, b[field] ?? fallback)) report(label, `changed ${field}`);
      }
    }
  }
}

function commentsOf(target) {
  return Object.values(target.comments || {})
    .filter(
      (comment) =>
        isPlainObject(comment) &&
        !commentText(comment).startsWith(MEMBERSHIP_MAGIC) &&
        !decodeFileStemFromComment(commentText(comment))
    )
    .map((comment) => ({
      text: commentText(comment),
      attached: Boolean(comment.blockId),
      x: Math.round(Number(comment.x) || 0),
      y: Math.round(Number(comment.y) || 0),
      width: Math.round(Number(comment.width) || 200),
      height: Math.round(Number(comment.height) || 200),
      minimized: Boolean(comment.minimized),
    }))
    .map((comment) => JSON.stringify(comment))
    .sort();
}

function compareComments(before, after, report, where) {
  const left = commentsOf(before);
  const right = commentsOf(after);
  const counts = new Map();
  for (const item of right) counts.set(item, (counts.get(item) || 0) + 1);
  let changed = 0;
  for (const item of left) {
    const count = counts.get(item) || 0;
    if (count) counts.set(item, count - 1);
    else changed++;
  }
  if (changed || left.length !== right.length) {
    report(
      `${where}.comments`,
      `${changed || Math.abs(left.length - right.length)} comment(s) changed text, place or size`
    );
  }
}

function framesOf(target) {
  return Object.values(isPlainObject(target.frames) ? target.frames : {})
    .filter(isPlainObject)
    .map((frame) =>
      JSON.stringify({
        title: String(frame.title ?? ''),
        x: Math.round(Number(frame.x) || 0),
        y: Math.round(Number(frame.y) || 0),
        width: Math.round(Number(frame.width) || 0),
        height: Math.round(Number(frame.height) || 0),
        collapsed: Boolean(frame.collapsed),
        members: frame.collapsed && Array.isArray(frame.blocks) ? frame.blocks.length : 0,
      })
    )
    .sort();
}

function compareProps(before, after, report, where) {
  const defaults = before.isStage ? STAGE_DEFAULTS : SPRITE_DEFAULTS;
  for (const [field, fallback] of Object.entries(defaults)) {
    if (!same(before[field] ?? fallback, after[field] ?? fallback)) {
      report(where, `changed ${field} from ${JSON.stringify(before[field])} to ${JSON.stringify(after[field])}`);
    }
  }
  if (!before.isStage && before.layerOrder != null && !same(before.layerOrder, after.layerOrder)) {
    report(where, 'changed its layer');
  }
  if (!deepEqual(before.extensionStorage ?? null, after.extensionStorage ?? null)) {
    report(where, 'changed its extension storage');
  }
  if (!deepEqual(framesOf(before), framesOf(after))) report(`${where}.frames`, 'changed');
}

const MONITOR_DEFAULTS = [
  ['mode', 'default'],
  ['x', 0],
  ['y', 0],
  ['visible', true],
  ['width', 0],
  ['height', 0],
  ['sliderMin', 0],
  ['sliderMax', 100],
  ['isDiscrete', true],
];

const monitorKey = (monitor) =>
  JSON.stringify([
    monitor.opcode,
    monitor.spriteName ?? null,
    monitor.params?.VARIABLE ?? monitor.params?.LIST ?? monitor.params ?? null,
  ]);

function compareMonitors(before, after, report) {
  const right = new Map((after.monitors || []).filter(Boolean).map((monitor) => [monitorKey(monitor), monitor]));
  for (const monitor of (before.monitors || []).filter(Boolean)) {
    const other = right.get(monitorKey(monitor));
    if (!other) {
      report('monitors', `lost the ${monitor.opcode} monitor`);
      continue;
    }
    for (const [field, fallback] of MONITOR_DEFAULTS) {
      if (!same(monitor[field] ?? fallback, other[field] ?? fallback)) {
        report('monitors', `the ${monitor.opcode} monitor changed ${field}`);
      }
    }
  }
}

const extensionSource = (url) =>
  String(url || '').startsWith('data:') ? decodeDataUrl(String(url)) : String(url || '');

function compareExtensions(before, after, report) {
  const left = new Set(before.extensions || []);
  const right = new Set(after.extensions || []);
  for (const id of left) if (!right.has(id)) report('extensions', `lost ${JSON.stringify(id)}`);
  for (const id of right) if (!left.has(id)) report('extensions', `gained ${JSON.stringify(id)}`);
  const urls = before.extensionURLs || {};
  const otherUrls = after.extensionURLs || {};
  for (const id of Object.keys(urls)) {
    if (!left.has(id)) continue;
    if (extensionSource(urls[id]) !== extensionSource(otherUrls[id]))
      report('extensions', `${JSON.stringify(id)} changed its code or URL`);
  }
}

async function compareProjectExtras(before, after, report, sameAsset) {
  const fonts = (project) => (Array.isArray(project.customFonts) ? project.customFonts : []);
  const leftFonts = fonts(before);
  const rightFonts = fonts(after);
  if (leftFonts.length !== rightFonts.length)
    report('customFonts', `has ${leftFonts.length} before and ${rightFonts.length} after`);
  else {
    for (let i = 0; i < leftFonts.length; i++) {
      const a = leftFonts[i];
      const b = rightFonts[i];
      if (
        a.family !== b.family ||
        Boolean(a.system) !== Boolean(b.system) ||
        (a.fallback || '') !== (b.fallback || '')
      ) {
        report('customFonts', `${JSON.stringify(a.family)} changed`);
      } else if (!a.system && !(await sameAsset(a.md5ext, b.md5ext))) {
        report('customFonts', `${JSON.stringify(a.family)} has a different file`);
      }
    }
  }

  const customAssets = (project) =>
    new Map(
      (Array.isArray(project.customAssets) ? project.customAssets : []).map((asset) => [asset.name, asset.md5ext])
    );
  const leftAssets = customAssets(before);
  const rightAssets = customAssets(after);
  for (const [name, md5ext] of leftAssets) {
    if (!rightAssets.has(name)) report('customAssets', `lost ${JSON.stringify(name)}`);
    else if (!(await sameAsset(md5ext, rightAssets.get(name))))
      report('customAssets', `${JSON.stringify(name)} has different contents`);
  }
  for (const name of rightAssets.keys())
    if (!leftAssets.has(name)) report('customAssets', `gained ${JSON.stringify(name)}`);

  if (!deepEqual(before.extensionStorage ?? null, after.extensionStorage ?? null)) {
    report('extensionStorage', 'changed');
  }
  if (!deepEqual(before.meta?.platform ?? null, after.meta?.platform ?? null)) report('meta.platform', 'changed');
  if ((before.meta?.origin ?? null) !== (after.meta?.origin ?? null)) report('meta.origin', 'changed');
}

export async function compareProjects(before, after, { readBefore, readAfter } = {}) {
  const differences = [];
  const report = (path, message, detail) => differences.push(detail ? { path, message, detail } : { path, message });
  const sameAsset = async (a, b) => {
    if (a === b) return true;
    if (typeof readBefore !== 'function' || typeof readAfter !== 'function') return false;
    const left = await readBefore(a);
    if (!left) return true;
    const right = await readAfter(b);
    if (!right) return false;
    if (left.byteLength !== right.byteLength) return false;
    return md5hex(left) === md5hex(right);
  };

  const leftTargets = before.targets || [];
  const rightTargets = after.targets || [];
  const byName = new Map(rightTargets.map((target) => [target.isStage ? '\u0000stage' : target.name, target]));
  const order = (targets) => targets.map((target) => (target.isStage ? '\u0000stage' : target.name));
  for (const target of leftTargets) {
    const key = target.isStage ? '\u0000stage' : target.name;
    const other = byName.get(key);
    const where = target.isStage ? 'Stage' : `sprite ${JSON.stringify(target.name)}`;
    if (!other) {
      report(where, 'is missing');
      continue;
    }
    compareProps(target, other, report, where);
    compareVariables(target, other, report, where);
    await compareAssets(target, other, report, where, sameAsset);
    compareComments(target, other, report, where);
    compareScripts(target, other, report, where);
  }
  for (const target of rightTargets) {
    const key = target.isStage ? '\u0000stage' : target.name;
    if (!leftTargets.some((item) => (item.isStage ? '\u0000stage' : item.name) === key)) {
      report(target.isStage ? 'Stage' : `sprite ${JSON.stringify(target.name)}`, 'was added');
    }
  }
  if (!deepEqual(order(leftTargets), order(rightTargets)) && leftTargets.length === rightTargets.length) {
    report('targets', 'the sprite order changed');
  }
  compareMonitors(before, after, report);
  compareExtensions(before, after, report);
  await compareProjectExtras(before, after, report, sameAsset);
  return differences;
}
