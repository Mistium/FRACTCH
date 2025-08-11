import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import AdmZip from 'adm-zip';
import { parseFractch } from './parse.js';
import { buildBlocksFromCalls, mergeIntoManifest, IdGen } from './buildBlocks.js';

export async function packFromBuildDir({ buildDir, outSb3, verbose = false, preferDSL = true }) {
  const manifestPath = path.join(buildDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error('manifest.json not found in build directory');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  const targets = new Map(); // manifestTargetName -> { name, stacks: Array<{hatOpcode, calls?, preblocks?, topBlockId?: string}> }
  let totalScripts = 0;
  let headerScripts = 0;
  for (const dirName of fs.readdirSync(buildDir)) {
    const tPath = path.join(buildDir, dirName);
    if (!fs.statSync(tPath).isDirectory()) continue;
    const manifestTarget = findManifestTargetForDir(manifest, dirName);
    if (!manifestTarget) continue;
    const manifestName = manifestTarget.name;
    for (const hatDir of safeListDir(tPath)) {
      const hPath = path.join(tPath, hatDir);
      if (!fs.statSync(hPath).isDirectory()) continue;
      for (const file of safeListDir(hPath)) {
        if (!file.endsWith('.fractch')) continue;
        const fPath = path.join(hPath, file);
        const content = fs.readFileSync(fPath, 'utf8');
        totalScripts++;

        const headerInfo = parseHeaderInfo(content);

        const currentHash = computeBodyHash(content);
        const headerHash = headerInfo?.dslBodyHash || null;
        const bodyUnchanged = currentHash && headerHash && currentHash === headerHash;

        let fb =
          headerInfo && headerInfo.subgraph && bodyUnchanged
            ? headerInfo
            : !preferDSL
              ? headerInfo && headerInfo.subgraph
                ? headerInfo
                : null
              : null;
        if (fb && fb.subgraph && Object.keys(fb.subgraph).length) {
          headerScripts++;
          if (!targets.has(manifestName)) targets.set(manifestName, { name: manifestName, stacks: [] });
          targets.get(manifestName).stacks.push({
            hatOpcode: fb.hatOpcode || hatDir,
            preblocks: fb.subgraph,
            topBlockId: fb.topBlockId,
          });
          continue;
        }

        try {
          const parsed = parseFractch(content);
          const calls = Array.isArray(parsed) ? parsed : parsed.calls;
          if (!targets.has(manifestName)) targets.set(manifestName, { name: manifestName, stacks: [] });
          const losslessBlocks = parsed && parsed.losslessBlocks ? parsed.losslessBlocks : undefined;

          if (losslessBlocks && Object.keys(losslessBlocks).length) {
            fb = null; // ensure DSL path is taken with exact blocks
          }
          targets.get(manifestName).stacks.push({
            hatOpcode: headerInfo?.hatOpcode || hatDir,
            calls,
            topBlockId: headerInfo?.topBlockId,
            losslessBlocks,
          });
        } catch (e) {
          if (verbose)
            console.warn(`Skip unparsable file (no header snapshot and DSL parse failed): ${fPath}: ${e.message}`);
          continue;
        }
      }
    }
  }

  const procArgMaps = new Map(); // targetName -> Map(proccode -> argumentids[])
  for (const t of manifest.targets || []) {
    const map = new Map();
    const blocks = t.blocks || {};
    for (const [, b] of Object.entries(blocks)) {
      if (!b || b.opcode !== 'procedures_definition' || b.parent) continue;
      const protoId = b.inputs?.custom_block?.[1];
      const proto = protoId ? blocks[protoId] : undefined;
      const proccode = proto?.mutation?.proccode || proto?.fields?.PROCCODE?.[0] || null;
      const idsRaw = proto?.mutation?.argumentids;
      let ids = [];
      try {
        ids = Array.isArray(idsRaw) ? idsRaw : idsRaw ? JSON.parse(idsRaw) : [];
      } catch {
        // Handle error
      }
      if (proccode) map.set(proccode, ids);
    }
    procArgMaps.set(t.name, map);
  }

  const builtTargets = [];
  for (const [name, data] of targets) {
    const scripts = [];
    const sharedIdGen = new IdGen(); // Shared ID generator across all scripts in this target
    for (const s of data.stacks) {
      if (s.preblocks) {
        scripts.push({ oldTopId: s.topBlockId || null, blocks: s.preblocks });
      } else {
        const { blocks, topId } = buildBlocksFromCalls(s.calls, {
          hatOpcode: s.hatOpcode,
          proceduresMapForTarget: procArgMaps.get(name),
          idGen: sharedIdGen,
        });

        const exact = s.losslessBlocks && Object.keys(s.losslessBlocks).length ? s.losslessBlocks : null;
        const chosenBlocks = exact || blocks;
        let newTopId = topId;
        if (exact) {
          if (s.topBlockId && exact[s.topBlockId]) {
            newTopId = s.topBlockId;
          } else {
            const derived = deriveTopId(exact);
            if (derived) newTopId = derived;
          }
        }
        scripts.push({
          oldTopId: s.topBlockId || null,
          blocks: chosenBlocks,
          newTopId,
        });
      }
    }
    builtTargets.push({ name, scripts });
  }

  const newManifest = mergeIntoManifest(manifest, builtTargets);

  const zip = new AdmZip();

  let wroteProject = false;
  try {
    if (headerScripts > 0 && headerScripts === totalScripts && deepEqual(manifest, newManifest)) {
      if (verbose)
        console.log(
          `[pack] All ${headerScripts}/${totalScripts} scripts used header snapshots; manifests equal -> writing original bytes`
        );
      const origin = findOriginSb3();
      if (origin) {
        const srcZip = new AdmZip(origin);
        const entry = srcZip.getEntry('project.json');
        if (entry) {
          const buf = srcZip.readFile(entry);
          if (buf) {
            zip.addFile('project.json', buf);
            wroteProject = true;
          }
        }
      }
    } else if (deepEqual(manifest, newManifest)) {
      if (verbose) console.log('[pack] Manifests structurally equal; writing original bytes');
      const origin = findOriginSb3();
      if (origin) {
        const srcZip = new AdmZip(origin);
        const entry = srcZip.getEntry('project.json');
        if (entry) {
          const buf = srcZip.readFile(entry);
          if (buf) {
            zip.addFile('project.json', buf);
            wroteProject = true;
          }
        }
      }
    }
  } catch {
    // Handle error
  }
  if (!wroteProject) {
    const text = JSON.stringify(newManifest);
    if (verbose)
      console.log(
        `[pack] Writing rebuilt project.json (${text.length} bytes); headerScripts=${headerScripts}, totalScripts=${totalScripts}`
      );
    zip.addFile('project.json', Buffer.from(text));
  }

  try {
    const origin = findOriginSb3();
    if (origin) {
      const srcZip = new AdmZip(origin);
      for (const entry of srcZip.getEntries()) {
        if (entry.entryName === 'project.json') continue;
        const data = srcZip.readFile(entry);
        if (data) zip.addFile(entry.entryName, data);
      }
    }
  } catch {
    // Handle error
  }
  zip.writeZip(outSb3);
  if (verbose) console.log(`Wrote ${outSb3}`);
}

function safeListDir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function findOriginSb3() {
  const cwd = process.cwd();
  const preferred = path.join(cwd, 'originv6.0.0.sb3');
  if (fs.existsSync(preferred)) return preferred;
  const candidates = fs.readdirSync(cwd).filter((f) => f.endsWith('.sb3'));
  if (candidates.length) return path.join(cwd, candidates[0]);
  return null;
}

function findManifestTargetForDir(manifest, dirName) {
  if (!manifest?.targets) return null;
  for (const t of manifest.targets) {
    if (t.name === dirName) return t;
    if (sanitize(t.name) === dirName) return t;
  }
  return null;
}

function sanitize(name) {
  return String(name).replace(/[^a-zA-Z0-9-_]/g, '_');
}

function parseHeaderInfo(text) {
  try {
    const headStart = text.indexOf('/**');
    const headEnd = text.indexOf('*/', headStart + 3);
    const head = headStart >= 0 && headEnd > headStart ? text.slice(headStart, headEnd) : text;
    const lines = head.split(/\r?\n/);
    const map = new Map();
    for (const line of lines) {
      const m = /\*\s*([^:]+):\s*(.*)$/.exec(line.trim());
      if (m) map.set(m[1].trim(), m[2].trim());
    }
    const hatOpcode = map.get('hatOpcode');
    const topBlockId = map.get('topBlockId');
    const dslBodyHash = map.get('dslBodyHash');
    const subB64 = map.get('rawSubgraph_b64');
    const subRaw = map.get('rawSubgraph');
    let jsonText = '';
    if (subB64) {
      try {
        jsonText = Buffer.from(subB64, 'base64').toString('utf8');
      } catch {
        // Handle error
      }
    }
    if (!jsonText && subRaw) jsonText = subRaw.replace(/\s*\*\/\s*$/, '');
    const subgraph = jsonText ? JSON.parse(jsonText) : undefined;
    return { hatOpcode, topBlockId, dslBodyHash, subgraph };
  } catch {
    return null;
  }
}

function computeBodyHash(text) {
  try {
    const body = extractBodyText(text);
    return crypto.createHash('sha256').update(body, 'utf8').digest('hex');
  } catch {
    return null;
  }
}

function extractBodyText(text) {
  const s = String(text || '');
  let body = s;
  if (s.startsWith('/**')) {
    const end = s.indexOf('*/');
    if (end >= 0) body = s.slice(end + 2);
  }

  const lines = body.split(/\r?\n/);
  const kept = [];
  for (const line of lines) {
    const trimmed = line.replace(/^\s+/, '');
    if (trimmed.startsWith('import ')) continue;
    kept.push(line);
  }

  let start = 0;
  while (start < kept.length && kept[start].trim() === '') start++;
  let end = kept.length - 1;
  while (end >= start && kept[end].trim() === '') end--;
  const slice = kept.slice(start, end + 1);

  return slice.join('\n');
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a == null || b == null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqual(a[k], b[k])) return false;
  }
  return true;
}

function deriveTopId(blocks) {
  if (!blocks) return null;

  for (const [id, b] of Object.entries(blocks)) {
    if (b && b.topLevel && b.parent == null) return id;
  }

  const hatPrefix = /^event_|^procedures_definition|^documentevents/i;
  for (const [id, b] of Object.entries(blocks)) {
    if (b && b.parent == null && typeof b.opcode === 'string' && hatPrefix.test(b.opcode)) return id;
  }

  for (const [id, b] of Object.entries(blocks)) {
    if (b && b.parent == null) return id;
  }

  const keys = Object.keys(blocks);
  return keys.length ? keys[0] : null;
}
