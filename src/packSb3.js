import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { buildProjectFromBuildDir, deepEqual, BLANK_SVG, BLANK_SVG_ID } from './pack.js';
import { writeCompressedZip } from './writeZip.js';
import { diagnostic } from './diagnostics.js';
import { readProjectExtras } from './project.js';

export async function packFromBuildDir({ buildDir, outSb3, originSb3, fs: fsLike = fs }) {
  const {
    manifest: newManifest,
    hasManifest,
    totalScripts,
    parsedScripts,
    assetFiles,
    diagnostics,
  } = await buildProjectFromBuildDir({
    buildDir,
    fs: fsLike,
  });
  const info = (message) => diagnostics.push(diagnostic('FR308', message, { severity: 'info' }));
  const extras = await readProjectExtras({ fs: fsLike, dir: buildDir, manifest: newManifest });
  diagnostics.push(...extras.diagnostics);

  const zip = new AdmZip();
  const origin = originSb3 ? path.resolve(originSb3) : hasManifest ? findOriginSb3() : null;

  let wroteProject = false;
  try {
    if (origin) {
      const originProject = JSON.parse(new AdmZip(origin).readAsText('project.json'));
      if (deepEqual(originProject, newManifest)) {
        info('reconstructed project.json matches the origin exactly, writing the original bytes');
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
    wroteProject = false;
  }
  if (!wroteProject) {
    const text = JSON.stringify(newManifest);
    info(`wrote rebuilt project.json (${text.length} bytes); ${parsedScripts}/${totalScripts} script files parsed`);
    zip.addFile('project.json', Buffer.from(text));
  }

  const referencedAssets = assetNamesForManifest(newManifest);
  copyAssetsFromBuildDir(zip, buildDir, referencedAssets, assetFiles, fsLike);
  try {
    if (origin) {
      const srcZip = new AdmZip(origin);
      const assetShaped = /^[0-9a-f]{32}\.[A-Za-z0-9]+$/;
      for (const entry of srcZip.getEntries()) {
        if (entry.entryName === 'project.json') continue;

        if (assetShaped.test(entry.entryName) && !referencedAssets.has(entry.entryName)) continue;
        if (zip.getEntry(entry.entryName)) continue;
        const data = srcZip.readFile(entry);
        if (data) zip.addFile(entry.entryName, data);
      }
    }
  } catch {
    zip.getEntries();
  }
  for (const [name, data] of extras.assets) {
    if (!zip.getEntry(name)) zip.addFile(name, Buffer.from(data));
  }
  addMissingAssetFiles(zip, newManifest);
  const entries = zip.getEntries().map((entry) => ({
    name: entry.entryName,
    data: zip.readFile(entry) || Buffer.alloc(0),
  }));
  writeCompressedZip(outSb3, entries);
  info(`wrote ${outSb3}`);
  return { diagnostics };
}

function assetNamesForManifest(manifest) {
  const names = new Set();
  for (const t of manifest.targets || []) {
    for (const asset of [...(t.costumes || []), ...(t.sounds || [])]) {
      const name = asset.md5ext || (asset.assetId && `${asset.assetId}.${asset.dataFormat || ''}`);
      if (name) names.add(name);
    }
  }
  return names;
}

function copyAssetsFromBuildDir(zip, buildDir, names, assetFiles, fsLike) {
  for (const name of names) {
    if (zip.getEntry(name)) continue;
    const rel = assetFiles?.get(name) || path.join('assets', name);
    const p = path.join(buildDir, rel);
    try {
      if (fsLike.existsSync && fsLike.readFileSync && fsLike.existsSync(p)) {
        zip.addFile(name, fsLike.readFileSync(p));
      }
    } catch {
      continue;
    }
  }
}

function addMissingAssetFiles(zip, manifest) {
  const present = new Set(zip.getEntries().map((e) => e.entryName));
  for (const t of manifest.targets || []) {
    for (const costume of t.costumes || []) {
      const name = costume.md5ext || (costume.assetId && `${costume.assetId}.${costume.dataFormat || 'svg'}`);
      if (!name || present.has(name)) continue;
      if (name === `${BLANK_SVG_ID}.svg`) {
        zip.addFile(name, Buffer.from(BLANK_SVG));
        present.add(name);
      }
    }
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
