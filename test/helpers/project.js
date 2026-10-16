import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildProjectFromBuildDir } from '../../src/pack.js';

export async function packFiles(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fractch-fixture-'));
  try {
    for (const [rel, text] of Object.entries(files)) {
      const p = path.join(dir, ...rel.split('/'));
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, text);
    }
    const { manifest } = await buildProjectFromBuildDir({ buildDir: dir, fs, prune: false });
    return manifest;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
