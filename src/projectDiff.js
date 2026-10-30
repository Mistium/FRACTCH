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

function compareScripts(before, after, say) {
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
      say('scripts', `The script at ${placeText(script)} would be lost.`, script.opcode);
      continue;
    }
    pairs.push([script, remaining.splice(index, 1)[0]]);
  }
  for (const [a, b] of pairs) {
    if (Array.isArray(before.blocks[a.id]) || Array.isArray(after.blocks[b.id])) {
      if (looseReporterName(before.blocks, a.id) !== looseReporterName(after.blocks, b.id)) {
        say('scripts', `The loose reporter at ${placeText(a)} would change.`, a.opcode);
      }
      continue;
    }
    const difference = compareTrees(before.blocks, a.id, after.blocks, b.id);
    if (difference) say('scripts', `The script at ${placeText(a)} would change.`, `${a.opcode} ${difference}`);
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

function compareVariables(before, after, say) {
  for (const kind of ['variables', 'lists']) {
    const left = namedEntries(before[kind]);
    const right = namedEntries(after[kind]);
    const noun = kind === 'lists' ? 'list' : 'variable';
    for (const [name, entry] of left) {
      const other = right.get(name);
      if (!other) {
        say(kind, `The ${noun} ${JSON.stringify(name)} would be lost.`);
        continue;
      }
      const value = kind === 'lists' ? (entry[1] || []).map(String) : String(entry[1] ?? '');
      const otherValue = kind === 'lists' ? (other[1] || []).map(String) : String(other[1] ?? '');
      if (!deepEqual(value, otherValue)) say(kind, `The ${noun} ${JSON.stringify(name)} would get a different value.`);
      if (kind === 'variables' && Boolean(entry[2]) !== Boolean(other[2])) {
        say(kind, `The variable ${JSON.stringify(name)} would change whether it is a cloud variable.`);
      }
    }
  }
}

async function compareAssets(before, after, say, sameAsset) {
  for (const kind of ['costumes', 'sounds']) {
    const left = before[kind] || [];
    const right = after[kind] || [];
    if (kind === 'costumes' && !left.length) continue;
    const noun = kind === 'costumes' ? 'costume' : 'sound';
    if (left.length !== right.length) {
      say(kind, `It would have ${right.length} ${kind} instead of ${left.length}.`);
      continue;
    }
    for (let i = 0; i < left.length; i++) {
      const a = left[i];
      const b = right[i];
      const sub = `${kind}[${JSON.stringify(String(a.name ?? i))}]`;
      const what = `The ${noun} ${JSON.stringify(String(a.name ?? ''))}`;
      if (String(a.name ?? '') !== String(b.name ?? ''))
        say(sub, `${what} would be renamed to ${JSON.stringify(b.name)}.`);
      if (!(await sameAsset(a.md5ext, b.md5ext))) say(sub, `${what} would get different file contents.`);
      const fields =
        kind === 'costumes'
          ? [
              ['rotationCenterX', 0, 'rotation center'],
              ['rotationCenterY', 0, 'rotation center'],
              ['bitmapResolution', 1, 'bitmap resolution'],
            ]
          : [
              ['rate', null, 'sample rate'],
              ['sampleCount', null, 'length'],
            ];
      const changed = new Set();
      for (const [field, fallback, words] of fields) {
        if (!same(a[field] ?? fallback, b[field] ?? fallback)) changed.add(words);
      }
      for (const words of changed) say(sub, `${what} would get a different ${words}.`);
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

function compareComments(before, after, say) {
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
  const count = changed || Math.abs(left.length - right.length);
  if (count === 1) say('comments', 'A comment would move or change.');
  else if (count) say('comments', `${count} comments would move or change.`);
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

function compareProps(before, after, say) {
  const defaults = before.isStage ? STAGE_DEFAULTS : SPRITE_DEFAULTS;
  for (const [field, fallback] of Object.entries(defaults)) {
    if (!same(before[field] ?? fallback, after[field] ?? fallback)) {
      say(
        '',
        `Its ${PROP_WORDS[field] || field} would change from ${JSON.stringify(before[field])} to ${JSON.stringify(after[field])}.`
      );
    }
  }
  if (!before.isStage && before.layerOrder != null && !same(before.layerOrder, after.layerOrder)) {
    say('', 'Its layer would change.');
  }
  if (!deepEqual(before.extensionStorage ?? null, after.extensionStorage ?? null)) {
    say('', 'Its extension storage would change.');
  }
  if (!deepEqual(framesOf(before), framesOf(after))) say('frames', 'Its frames would change.');
}

const PROP_WORDS = {
  x: 'x position',
  y: 'y position',
  visible: 'visibility',
  draggable: 'draggable setting',
  rotationStyle: 'rotation style',
  currentCostume: 'current costume',
  videoState: 'video setting',
  videoTransparency: 'video transparency',
  textToSpeechLanguage: 'text to speech language',
};

const MONITOR_WORDS = {
  mode: 'style',
  x: 'place',
  y: 'place',
  visible: 'visibility',
  width: 'size',
  height: 'size',
  sliderMin: 'slider range',
  sliderMax: 'slider range',
  isDiscrete: 'slider steps',
};

const monitorName = (monitor) => {
  const name = monitor.params?.VARIABLE ?? monitor.params?.LIST;
  if (typeof name === 'string') return `The monitor for ${JSON.stringify(name)}`;
  return `The ${monitor.opcode} monitor`;
};

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
      report('monitors', `${monitorName(monitor)} would be lost.`);
      continue;
    }
    const changed = new Set();
    for (const [field, fallback] of MONITOR_DEFAULTS) {
      if (!same(monitor[field] ?? fallback, other[field] ?? fallback)) changed.add(MONITOR_WORDS[field] || field);
    }
    for (const words of changed) report('monitors', `${monitorName(monitor)} would change its ${words}.`);
  }
}

const extensionSource = (url) =>
  String(url || '').startsWith('data:') ? decodeDataUrl(String(url)) : String(url || '');

function compareExtensions(before, after, report) {
  const left = new Set(before.extensions || []);
  const right = new Set(after.extensions || []);
  for (const id of left)
    if (!right.has(id)) report('extensions', `The extension ${JSON.stringify(id)} would be removed.`);
  for (const id of right)
    if (!left.has(id)) report('extensions', `The extension ${JSON.stringify(id)} would be added.`);
  const urls = before.extensionURLs || {};
  const otherUrls = after.extensionURLs || {};
  for (const id of Object.keys(urls)) {
    if (!left.has(id)) continue;
    if (extensionSource(urls[id]) !== extensionSource(otherUrls[id]))
      report('extensions', `The extension ${JSON.stringify(id)} would get different code or a different URL.`);
  }
}

async function compareProjectExtras(before, after, report, sameAsset) {
  const fonts = (project) => (Array.isArray(project.customFonts) ? project.customFonts : []);
  const leftFonts = fonts(before);
  const rightFonts = fonts(after);
  if (leftFonts.length !== rightFonts.length)
    report('customFonts', `The project would have ${rightFonts.length} fonts instead of ${leftFonts.length}.`);
  else {
    for (let i = 0; i < leftFonts.length; i++) {
      const a = leftFonts[i];
      const b = rightFonts[i];
      if (
        a.family !== b.family ||
        Boolean(a.system) !== Boolean(b.system) ||
        (a.fallback || '') !== (b.fallback || '')
      ) {
        report('customFonts', `The font ${JSON.stringify(a.family)} would change.`);
      } else if (!a.system && !(await sameAsset(a.md5ext, b.md5ext))) {
        report('customFonts', `The font ${JSON.stringify(a.family)} would get a different file.`);
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
    if (!rightAssets.has(name)) report('customAssets', `The custom asset ${JSON.stringify(name)} would be lost.`);
    else if (!(await sameAsset(md5ext, rightAssets.get(name))))
      report('customAssets', `The custom asset ${JSON.stringify(name)} would get different contents.`);
  }
  for (const name of rightAssets.keys())
    if (!leftAssets.has(name)) report('customAssets', `The custom asset ${JSON.stringify(name)} would be added.`);

  if (!deepEqual(before.extensionStorage ?? null, after.extensionStorage ?? null)) {
    report('extensionStorage', 'The project extension storage would change.');
  }
  if (!deepEqual(before.meta?.platform ?? null, after.meta?.platform ?? null)) {
    report('meta.platform', 'The platform recorded in the project would change.');
  }
  if ((before.meta?.origin ?? null) !== (after.meta?.origin ?? null)) {
    report('meta.origin', 'The origin recorded in the project would change.');
  }
}

export async function compareProjects(before, after, { readBefore, readAfter } = {}) {
  const differences = [];
  const report = (path, message, { target, detail } = {}) => {
    const difference = { path, message };
    if (target !== undefined) difference.target = target;
    if (detail) difference.detail = detail;
    differences.push(difference);
  };
  const sayFor = (where, target) => (sub, message, detail) =>
    report(sub ? `${where}.${sub}` : where, message, { target, detail });
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
    const say = sayFor(where, target.isStage ? 'Stage' : target.name);
    if (!other) {
      say('', target.isStage ? 'The stage would be lost.' : 'The sprite would be lost.');
      continue;
    }
    compareProps(target, other, say);
    compareVariables(target, other, say);
    await compareAssets(target, other, say, sameAsset);
    compareComments(target, other, say);
    compareScripts(target, other, say);
  }
  for (const target of rightTargets) {
    const key = target.isStage ? '\u0000stage' : target.name;
    if (!leftTargets.some((item) => (item.isStage ? '\u0000stage' : item.name) === key)) {
      const where = target.isStage ? 'Stage' : `sprite ${JSON.stringify(target.name)}`;
      sayFor(where, target.isStage ? 'Stage' : target.name)('', 'It would be added.');
    }
  }
  if (!deepEqual(order(leftTargets), order(rightTargets)) && leftTargets.length === rightTargets.length) {
    report('targets', 'The order of the sprites would change.');
  }
  compareMonitors(before, after, report);
  compareExtensions(before, after, report);
  await compareProjectExtras(before, after, report, sameAsset);
  return differences;
}
