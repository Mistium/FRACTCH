import * as path from './pathUtils.js';
import { toPromiseFs } from './fsAdapter.js';
import { buildProjectFromBuildDir, BLANK_SVG, BLANK_SVG_ID } from './pack.js';
import { convertProject } from './convert.js';
import { targetAssetFiles, targetDirNames } from './emit.js';

// Rewrite a project directory in canonical syntax. Converting re-derives folder and
// asset file names, so this also carries assets over to their canonical paths and
// removes the source files whose content moved to a differently named file.
export async function formatProject({ buildDir, fs: fsLike, verbose = false }) {
  const vfs = toPromiseFs(fsLike);
  const { manifest, parsedFiles, assetFiles } = await buildProjectFromBuildDir({
    buildDir,
    fs: fsLike,
    verbose,
    prune: false,
  });
  const result = await convertProject(manifest, { outDir: buildDir, fs: fsLike, verbose });

  const dirNames = targetDirNames(manifest.targets || []);
  let assetsCopied = 0;
  for (const target of manifest.targets || []) {
    const tDir = path.join(buildDir, dirNames.get(target));
    for (const [md5ext, rel] of targetAssetFiles(target)) {
      const dest = path.join(tDir, ...rel.split('/'));
      if (await vfs.exists(dest)) continue;
      const sourceRel = assetFiles.get(md5ext);
      let data = null;
      if (sourceRel) data = await vfs.readFile(path.join(buildDir, sourceRel));
      else if (md5ext === `${BLANK_SVG_ID}.svg`) data = BLANK_SVG;
      if (data == null) continue;
      await vfs.mkdirp(path.dirname(dest));
      await vfs.writeFile(dest, data);
      assetsCopied++;
    }
  }

  const written = new Set(result.writtenFiles.map((f) => path.normalizePath(f)));
  let filesRemoved = 0;
  for (const f of parsedFiles) {
    if (written.has(path.normalizePath(f))) continue;
    await vfs.unlink(f);
    filesRemoved++;
  }

  return { filesWritten: result.filesWritten, filesRemoved, assetsCopied };
}
