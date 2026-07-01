import { norm } from './pathUtils.js';

export function toPromiseFs(fsLike) {
  if (!fsLike) {
    throw new Error('an fs implementation is required (node:fs, or a lightning-fs style object in the browser)');
  }
  const impl = fsLike.promises || fsLike;
  if (typeof impl.readFile !== 'function') {
    throw new Error('fs implementation must provide readFile (node:fs or a promises-style fs)');
  }

  async function exists(p) {
    try {
      await impl.stat(p);
      return true;
    } catch {
      return false;
    }
  }

  async function isDirectory(p) {
    try {
      const st = await impl.stat(p);
      return typeof st.isDirectory === 'function' ? st.isDirectory() : st.type === 'dir';
    } catch {
      return false;
    }
  }

  async function mkdirp(dir) {
    const s = norm(dir);
    const parts = s.split('/');
    let cur = s.startsWith('/') ? '/' : '';
    for (const part of parts) {
      if (!part) continue;
      cur = cur === '' ? part : cur === '/' ? `/${part}` : `${cur}/${part}`;
      try {
        await impl.mkdir(cur);
      } catch {
        continue;
      }
    }
    if (!(await exists(s))) throw new Error(`mkdir failed: ${dir}`);
  }

  return {
    readFile: (p, enc) => impl.readFile(p, enc),
    writeFile: (p, data) => impl.writeFile(p, data),
    readdir: (p) => impl.readdir(p),
    stat: (p) => impl.stat(p),
    exists,
    isDirectory,
    mkdirp,
  };
}
