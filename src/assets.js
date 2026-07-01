import fs from 'fs';
import path from 'path';

function sanitize(name) {
  return String(name).replace(/[^a-zA-Z0-9-_]/g, '_');
}

export function writeAssets(zip, projectJson, outDir, { verbose = false } = {}) {
  const assetsDir = path.join(outDir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });

  let count = 0;
  for (const entry of zip.getEntries()) {
    if (entry.entryName === 'project.json') continue;
    if (entry.isDirectory) continue;
    const data = zip.readFile(entry);
    if (!data) continue;
    fs.writeFileSync(path.join(assetsDir, entry.entryName), data);
    count++;
  }

  let costumes = 0;
  let sounds = 0;
  for (const t of projectJson.targets || []) {
    const tDir = path.join(outDir, sanitize(t.name));
    fs.mkdirSync(tDir, { recursive: true });
    if (t.costumes?.length) {
      fs.writeFileSync(path.join(tDir, 'costumes.json'), JSON.stringify(t.costumes, null, 2));
      costumes += t.costumes.length;
    }
    if (t.sounds?.length) {
      fs.writeFileSync(path.join(tDir, 'sounds.json'), JSON.stringify(t.sounds, null, 2));
      sounds += t.sounds.length;
    }
  }

  if (verbose) console.log(`[assets] ${count} files, ${costumes} costumes, ${sounds} sounds`);
  return { assets: count, costumes, sounds };
}
