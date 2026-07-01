import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { buildProjectFromBuildDir, deepEqual, BLANK_SVG, BLANK_SVG_ID } from './pack.js';

export async function packFromBuildDir({ buildDir, outSb3, originSb3, verbose = false, fs: fsLike = fs }) {
  const { manifest: newManifest, hasManifest, totalScripts, parsedScripts } = await buildProjectFromBuildDir({
    buildDir,
    fs: fsLike,
    verbose,
  });

  const zip = new AdmZip();
  const origin = originSb3 ? path.resolve(originSb3) : hasManifest ? findOriginSb3() : null;

  let wroteProject = false;
  try {
    if (origin) {
      const originProject = JSON.parse(new AdmZip(origin).readAsText('project.json'));
      if (deepEqual(originProject, newManifest)) {
        if (verbose) console.log(`[pack] Reconstructed project.json matches origin exactly -> writing original bytes`);
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
      console.log(`[pack] Writing rebuilt project.json (${text.length} bytes); ${parsedScripts}/${totalScripts} scripts parsed`);
    zip.addFile('project.json', Buffer.from(text));
  }

  try {
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
  addMissingAssetFiles(zip, newManifest);
  zip.writeZip(outSb3);
  if (verbose) console.log(`Wrote ${outSb3}`);
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
