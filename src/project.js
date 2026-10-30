import { convertProject } from './convert.js';
import { buildProjectFromBuildDir, BLANK_SVG, BLANK_SVG_ID } from './pack.js';
import { writeExtensions } from './extensions.js';
import { targetAssetFiles, targetDirNames } from './emit.js';
import { toPromiseFs } from './fsAdapter.js';
import { memoryFs, toBytes } from './memoryFs.js';
import { md5hex } from './md5.js';
import { diagnostic } from './diagnostics.js';
import { extensionOf, readProjectMetadata, writeProjectMetadata } from './projectMeta.js';
import { compareProjects } from './projectDiff.js';

export const CUSTOM_ASSETS_DIR = 'assets';
export const ARCHIVE_IGNORED = /^(?:\.git\/|mwp\.json$)/;

const ROOT = '/project';

const hasControlCharacter = (text) =>
  Array.from(text).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });

export function safeProjectPath(p) {
  if (typeof p !== 'string' || hasControlCharacter(p)) return null;
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
  if (!parts.length || /^[A-Za-z]:$/.test(parts[0])) return null;
  if (parts.some((part) => part === '.' || part === '..' || part.startsWith('.'))) return null;
  return parts.join('/');
}

const assetReader = (readAsset) => {
  if (typeof readAsset !== 'function') return async () => null;
  return async (md5ext) => {
    const data = await readAsset(md5ext);
    return data == null ? null : toBytes(data);
  };
};

export function projectAssetPaths(projectJson) {
  const paths = new Map();
  const targets = Array.isArray(projectJson?.targets) ? projectJson.targets : [];
  const dirs = targetDirNames(targets);
  for (const target of targets) {
    for (const [md5ext, rel] of targetAssetFiles(target)) paths.set(`${dirs.get(target)}/${rel}`, md5ext);
  }
  return paths;
}

export async function projectToFiles({ projectJson, readAsset, config = {} } = {}) {
  if (!projectJson || typeof projectJson !== 'object') throw new TypeError('projectToFiles needs a projectJson object');
  const read = assetReader(readAsset);
  const fs = memoryFs();
  const vfs = toPromiseFs(fs);
  const diagnostics = [];
  const report = (code, message, extra = {}) => diagnostics.push(diagnostic(code, message, extra));

  const converted = await convertProject(projectJson, { outDir: ROOT, fs, config });
  diagnostics.push(...converted.diagnostics);
  await writeExtensions(projectJson, ROOT, { fs });

  const targets = Array.isArray(projectJson.targets) ? projectJson.targets : [];
  const dirs = targetDirNames(targets);
  for (const target of targets) {
    for (const [md5ext, rel] of targetAssetFiles(target)) {
      const data = await read(md5ext);
      if (!data) {
        report('FR301', `${target.name}: asset ${md5ext} is missing from the project`, { file: dirs.get(target) });
        continue;
      }
      await vfs.writeFile(`${ROOT}/${dirs.get(target)}/${rel}`, data);
    }
  }

  const customAssets = Array.isArray(projectJson.customAssets) ? projectJson.customAssets : [];
  for (const entry of customAssets) {
    const name = safeProjectPath(entry?.name);
    if (!name) {
      report('FR301', `custom asset ${JSON.stringify(entry?.name)} has an unsafe name, so it was left out`);
      continue;
    }
    const data = typeof entry.md5ext === 'string' ? await read(entry.md5ext) : null;
    if (!data) {
      report('FR301', `custom asset ${JSON.stringify(name)} is missing its file ${entry.md5ext}`);
      continue;
    }
    await vfs.writeFile(`${ROOT}/${CUSTOM_ASSETS_DIR}/${name}`, data);
  }

  const metadata = await writeProjectMetadata({ projectJson, readAsset: read, vfs, dir: ROOT });
  diagnostics.push(...metadata.diagnostics);

  return { files: fs.toMap(ROOT), diagnostics };
}

async function readCustomAssets(vfs, dir, assets) {
  const found = [];
  const walk = async (relative) => {
    const absolute = `${dir}/${CUSTOM_ASSETS_DIR}${relative}`;
    let entries;
    try {
      entries = await vfs.readdir(absolute);
    } catch {
      return;
    }
    for (const entry of [...entries].sort()) {
      if (entry.startsWith('.')) continue;
      const child = `${relative}/${entry}`;
      if (await vfs.isDirectory(`${absolute}/${entry}`)) {
        await walk(child);
        continue;
      }
      const data = toBytes(await vfs.readFile(`${absolute}/${entry}`));
      const name = child.substring(1);
      const md5ext = `${md5hex(data)}.${extensionOf(name)}`;
      assets.set(md5ext, data);
      found.push({ name, md5ext });
    }
  };
  await walk('');
  return found;
}

export async function readProjectExtras({ fs: fsLike, dir, manifest, assets = new Map() }) {
  const vfs = toPromiseFs(fsLike);
  const customAssets = await readCustomAssets(vfs, dir, assets);
  if (customAssets.length) manifest.customAssets = customAssets;
  else delete manifest.customAssets;
  const metadata = await readProjectMetadata({ vfs, dir, manifest, assets });
  return { assets, diagnostics: metadata.diagnostics };
}

const loadFiles = (files) => {
  const entries = new Map();
  const iterable = files instanceof Map ? files : Object.entries(files || {});
  for (const [p, data] of iterable) {
    if (ARCHIVE_IGNORED.test(p)) continue;
    const safe = safeProjectPath(p);
    if (!safe || data == null) continue;
    entries.set(`${ROOT}/${safe}`, data);
  }
  return memoryFs(entries);
};

export async function filesToProject(files, { prune = false } = {}) {
  const fs = loadFiles(files);
  const built = await buildProjectFromBuildDir({ buildDir: ROOT, fs, prune });
  const projectJson = built.manifest;
  const diagnostics = [...(built.diagnostics || [])];
  const assets = new Map();

  for (const [md5ext, rel] of built.assetFiles || []) {
    if (assets.has(md5ext)) continue;
    try {
      assets.set(md5ext, await fs.readFile(`${ROOT}/${rel}`));
    } catch {
      diagnostics.push(diagnostic('FR301', `asset file ${rel} is missing`, { file: rel }));
    }
  }
  const blank = `${BLANK_SVG_ID}.svg`;
  if (!assets.has(blank)) {
    const usesBlank = (projectJson.targets || []).some((target) =>
      (target.costumes || []).some((costume) => costume.md5ext === blank)
    );
    if (usesBlank) assets.set(blank, toBytes(BLANK_SVG));
  }

  const extras = await readProjectExtras({ fs, dir: ROOT, manifest: projectJson, assets });
  diagnostics.push(...extras.diagnostics);

  return { projectJson, assets, diagnostics };
}

export async function verifyProjectFiles({ projectJson, readAsset, config = {} } = {}) {
  const read = assetReader(readAsset);
  const { files, diagnostics: written } = await projectToFiles({ projectJson, readAsset: read, config });
  const rebuilt = await filesToProject(files);
  const differences = await compareProjects(projectJson, rebuilt.projectJson, {
    readBefore: read,
    readAfter: async (md5ext) => rebuilt.assets.get(md5ext) || null,
  });
  return {
    ok: differences.length === 0,
    differences,
    files,
    rebuilt,
    diagnostics: [...written, ...rebuilt.diagnostics],
  };
}
