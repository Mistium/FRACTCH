import fs from 'fs';
import path from 'path';
import { targetAssetFiles, targetDirNames } from './emit.js';

export function writeAssets(zip, projectJson, outDir) {
  const missing = [];
  let count = 0;
  let costumes = 0;
  let sounds = 0;
  const dirNames = targetDirNames(projectJson.targets || []);
  for (const t of projectJson.targets || []) {
    const tDir = path.join(outDir, dirNames.get(t));
    const fileMap = targetAssetFiles(t);
    if (fileMap.size) fs.mkdirSync(path.join(tDir, 'assets'), { recursive: true });
    for (const [md5ext, rel] of fileMap) {
      const data = zip.readFile(md5ext);
      if (data) {
        fs.writeFileSync(path.join(tDir, ...rel.split('/')), data);
        count++;
      } else {
        missing.push(md5ext);
      }
    }
    costumes += (t.costumes || []).length;
    sounds += (t.sounds || []).length;
  }

  return { assets: count, costumes, sounds, missing };
}
