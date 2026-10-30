const encoder = new TextEncoder();
const decoder = new TextDecoder();

function clean(p) {
  return String(p ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.')
    .join('/');
}

function fsError(code, p) {
  const error = new Error(`${code}: ${p}`);
  error.code = code;
  return error;
}

export function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (typeof data === 'string') return encoder.encode(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  throw new TypeError('file data must be a string, ArrayBuffer or typed array');
}

export function memoryFs(entries) {
  const files = new Map();
  const dirs = new Set(['']);

  const addParents = (p) => {
    const parts = p.split('/');
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
  };

  const put = (p, data) => {
    const key = clean(p);
    if (!key) throw fsError('EISDIR', p);
    if (dirs.has(key)) throw fsError('EISDIR', p);
    addParents(key);
    files.set(key, toBytes(data));
  };

  if (entries) {
    const iterable = entries instanceof Map ? entries : Object.entries(entries);
    for (const [p, data] of iterable) put(p, data);
  }

  const encodingOf = (options) => (typeof options === 'string' ? options : options?.encoding);

  const api = {
    async readFile(p, options) {
      const key = clean(p);
      if (!files.has(key)) throw fsError(dirs.has(key) ? 'EISDIR' : 'ENOENT', p);
      const data = files.get(key);
      return encodingOf(options) ? decoder.decode(data) : data;
    },
    async writeFile(p, data) {
      put(p, data);
    },
    async mkdir(p) {
      const key = clean(p);
      if (dirs.has(key) || files.has(key)) throw fsError('EEXIST', p);
      const parent = key.includes('/') ? key.slice(0, key.lastIndexOf('/')) : '';
      if (!dirs.has(parent)) throw fsError('ENOENT', p);
      dirs.add(key);
    },
    async readdir(p) {
      const key = clean(p);
      if (!dirs.has(key)) throw fsError(files.has(key) ? 'ENOTDIR' : 'ENOENT', p);
      const prefix = key ? `${key}/` : '';
      const names = new Set();
      for (const item of [...dirs, ...files.keys()]) {
        if (!item || !item.startsWith(prefix) || item === key) continue;
        const rest = item.slice(prefix.length);
        if (rest) names.add(rest.split('/')[0]);
      }
      return [...names].sort();
    },
    async stat(p) {
      const key = clean(p);
      if (files.has(key)) {
        const size = files.get(key).byteLength;
        return { type: 'file', size, isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false };
      }
      if (dirs.has(key)) {
        return { type: 'dir', size: 0, isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false };
      }
      throw fsError('ENOENT', p);
    },
    async unlink(p) {
      const key = clean(p);
      if (!files.delete(key)) throw fsError('ENOENT', p);
    },
    async rmdir(p) {
      const key = clean(p);
      if (!dirs.has(key) || !key) throw fsError('ENOENT', p);
      const prefix = `${key}/`;
      for (const item of [...dirs, ...files.keys()]) {
        if (item.startsWith(prefix)) throw fsError('ENOTEMPTY', p);
      }
      dirs.delete(key);
    },
  };
  api.lstat = api.stat;

  api.toMap = (root = '') => {
    const base = clean(root);
    const prefix = base ? `${base}/` : '';
    const out = new Map();
    for (const key of [...files.keys()].sort()) {
      if (prefix && !key.startsWith(prefix)) continue;
      out.set(key.slice(prefix.length), files.get(key));
    }
    return out;
  };

  return api;
}
