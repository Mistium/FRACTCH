import { decodeFileStemFromComment, decodeFileStemFromTopId } from './fileMarkers.js';
import { STDLIB_MODULES, STDLIB_STEM_PREFIX } from './stdlib/index.js';

export const MEMBERSHIP_MAGIC = '_fractch_map_';
export const MEMBERSHIP_COMMENT_ID = 'fractch-membership';
export const COMMENT_TEXT_LIMIT = 8000;

export function commentText(comment) {
  if (!comment || typeof comment !== 'object') return '';
  return String(comment.text ?? '') + (typeof comment.extraText === 'string' ? comment.extraText : '');
}

export function splitCommentText(text) {
  const s = String(text ?? '');
  if (s.length <= COMMENT_TEXT_LIMIT) return { text: s };
  return { text: s.slice(0, COMMENT_TEXT_LIMIT), extraText: s.slice(COMMENT_TEXT_LIMIT) };
}

export function isMembershipComment(comment) {
  return (
    !!comment && typeof comment === 'object' && !comment.blockId && commentText(comment).startsWith(MEMBERSHIP_MAGIC)
  );
}

export function isReservedComment(comment, target) {
  if (!comment || typeof comment !== 'object' || comment.blockId || (target && !target.isStage)) return false;
  const text = commentText(comment);
  return text.includes(' // _twconfig_') || text.includes(' // _gamepad_') || text.startsWith('WORKSPACE_BOOKMARKS:');
}

export function isLegacyMarkerComment(comment) {
  return !!comment && decodeFileStemFromComment(commentText(comment)) != null;
}

export function findMembershipComment(target) {
  for (const [id, comment] of Object.entries(target?.comments || {})) {
    if (isMembershipComment(comment)) return { id, comment };
  }
  return null;
}

export function parseMembershipText(text) {
  const body = String(text ?? '').slice(MEMBERSHIP_MAGIC.length);
  const data = JSON.parse(body);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('membership map is not an object');
  const scripts = data.scripts && typeof data.scripts === 'object' ? data.scripts : {};
  const modules = data.modules && typeof data.modules === 'object' ? data.modules : {};
  const map = new Map();
  for (const [topId, region] of Object.entries(scripts)) {
    if (typeof region === 'string') map.set(topId, { region: region === 'main' ? null : region, module: null });
  }
  for (const [topId, moduleId] of Object.entries(modules)) {
    if (typeof moduleId === 'string') map.set(topId, { region: null, module: moduleId });
  }
  map.comments = parseCommentEntries(data.comments);
  return map;
}

function parseCommentEntries(raw) {
  const out = new Map();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [commentId, entry] of Object.entries(raw)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const region = typeof entry.region === 'string' && entry.region && entry.region !== 'main' ? entry.region : null;
    const before = typeof entry.before === 'string' && entry.before ? entry.before : null;
    out.set(commentId, { region, before });
  }
  return out;
}

export function membershipText(entries, commentEntries = []) {
  const scripts = {};
  const modules = {};
  for (const [topId, entry] of entries) {
    if (entry.module) modules[topId] = entry.module;
    else scripts[topId] = entry.region || 'main';
  }
  const data = { version: 1, scripts };
  if (Object.keys(modules).length) data.modules = modules;
  const comments = {};
  for (const [commentId, entry] of commentEntries) {
    const out = {};
    if (entry?.region && entry.region !== 'main') out.region = entry.region;
    if (entry?.before) out.before = entry.before;
    comments[commentId] = out;
  }
  if (Object.keys(comments).length) data.comments = comments;
  return MEMBERSHIP_MAGIC + JSON.stringify(data);
}

export function commentBeforeAnchors(items) {
  const out = new Map();
  const sorted = [...items].sort((a, b) => (a.file || 0) - (b.file || 0) || a.at - b.at);
  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i];
    if (item.kind !== 'comment') continue;
    let before = null;
    for (let j = i + 1; j < sorted.length; j++) {
      const next = sorted[j];
      if (next.kind === 'script' && next.file === item.file && (next.region ?? null) === (item.region ?? null)) {
        before = next.topId;
        break;
      }
    }
    out.set(item.commentId, { region: item.region ?? null, before });
  }
  return out;
}

export function statementAnchor(blocks, id) {
  let cur = id;
  for (let guard = 0; guard < 10000; guard++) {
    const b = blocks[cur];
    if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
    const p = b.parent;
    if (!p || !blocks[p] || typeof blocks[p] !== 'object' || Array.isArray(blocks[p])) return cur;
    const pb = blocks[p];
    if (pb.next === cur) return cur;
    for (const [key, tuple] of Object.entries(pb.inputs || {})) {
      if (!Array.isArray(tuple)) continue;
      if (key.startsWith('SUBSTACK') && tuple.slice(1).includes(cur)) return cur;
    }
    cur = p;
  }
  return null;
}

function stemToEntry(stem) {
  if (!stem) return null;
  if (stem.startsWith(STDLIB_STEM_PREFIX)) {
    const moduleId = stem.slice(STDLIB_STEM_PREFIX.length);
    if (STDLIB_MODULES[moduleId]) return { region: null, module: moduleId };
  }
  return { region: stem, module: null };
}

export function readMembership(target) {
  const blocks = target?.blocks || {};
  const found = findMembershipComment(target);
  const diagnostics = [];
  let map = null;
  if (found) {
    try {
      map = parseMembershipText(commentText(found.comment));
    } catch (e) {
      diagnostics.push({
        code: 'FR307',
        message: `the membership map of ${target?.name ?? 'a target'} is unreadable: ${e.message}`,
      });
      map = null;
    }
  }
  const legacy = new Map();
  let hasLegacy = false;
  for (const comment of Object.values(target?.comments || {})) {
    const stem = decodeFileStemFromComment(commentText(comment));
    if (!stem || !comment.blockId || !blocks[comment.blockId]) continue;
    const anchor = statementAnchor(blocks, comment.blockId);
    if (anchor) {
      legacy.set(anchor, stemToEntry(stem));
      hasLegacy = true;
    }
  }
  for (const id of Object.keys(blocks)) {
    const stem = decodeFileStemFromTopId(id);
    if (stem) {
      hasLegacy = true;
      if (!legacy.has(id)) legacy.set(id, stemToEntry(stem));
    }
  }
  const authoritative = map != null;
  const comments = map?.comments || new Map();
  return {
    authoritative,
    comments,
    commentEntryFor(commentId) {
      return comments.get(commentId) || null;
    },
    commentId: found?.id ?? null,
    hasLegacy,
    diagnostics,
    entryFor(topId) {
      if (authoritative) return map.get(topId) || { region: null, module: null };
      return legacy.get(topId) || { region: null, module: null };
    },
    map,
    legacy,
  };
}
