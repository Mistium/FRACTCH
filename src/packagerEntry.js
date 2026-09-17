import fs from 'fs';
import path from 'path';
import Packager from './packager';
import { downloadProject } from './download-project';
import { setAdapter } from './adapter';
import defaultIcon from './images/default-icon.png';

const toArrayBuffer = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);

class Image {
  constructor(mimeType, buffer) {
    this.mimeType = mimeType;
    this.buffer = buffer;
  }
}

setAdapter({
  async getCachedAsset(asset) {
    if (asset.useBuildId) {
      const name = path.basename(Array.isArray(asset.src) ? asset.src[0] : asset.src);
      return fs.promises.readFile(path.join(process.env.FRACTCH_PACKAGER_RUNTIME, name), 'utf8');
    }
    const cached = path.join(__dirname, 'large-assets', asset.sha256);
    if (fs.existsSync(cached)) return toArrayBuffer(fs.readFileSync(cached));
    let lastError;
    for (const url of [].concat(asset.src)) {
      try {
        console.log(`[fractch] downloading ${url} (cached afterwards)`);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${res.status} from ${url}`);
        const data = Buffer.from(await res.arrayBuffer());
        fs.mkdirSync(path.dirname(cached), { recursive: true });
        fs.writeFileSync(cached, data);
        return toArrayBuffer(data);
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError;
  },
  async cacheAsset() {},
  async getAppIcon(file) {
    if (!file) return toArrayBuffer(defaultIcon);
    if (file instanceof Image && file.mimeType === 'image/png') return toArrayBuffer(file.buffer);
    throw new Error('icon must be a png');
  },
  readAsURL(file) {
    return `data:${file.mimeType};base64,${Buffer.from(file.buffer).toString('base64')}`;
  },
  async fetchExtensionScript(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} fetching extension ${url}`);
    return res.text();
  },
});

export { Packager, Image, downloadProject as loadProject };
