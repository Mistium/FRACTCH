import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import { writeCompressedZip } from '../src/writeZip.js';

test('SB3 writer uses stronger compression without changing archive contents', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fractch-zip-'));
  const optimizedPath = path.join(dir, 'optimized.sb3');
  const defaultPath = path.join(dir, 'default.sb3');
  const project = Buffer.from(
    JSON.stringify({
      targets: Array.from({ length: 4000 }, (_, i) => ({
        opcode: 'looks_sayforsecs',
        next: `block-${i + 1}`,
        parent: `block-${i - 1}`,
        inputs: { MESSAGE: [1, [10, `repeated project text ${i % 20}`]], SECS: [1, [4, '2']] },
      })),
    })
  );
  const media = Buffer.from([0, 255, 1, 254, 2, 253]);
  const entries = [
    { name: 'project.json', data: project },
    { name: 'assets/ü.bin', data: media },
  ];

  writeCompressedZip(optimizedPath, entries);
  const defaultZip = new AdmZip();
  for (const entry of entries) defaultZip.addFile(entry.name, entry.data);
  defaultZip.writeZip(defaultPath);

  const result = new AdmZip(optimizedPath);
  assert.deepEqual(result.readFile('project.json'), project);
  assert.deepEqual(result.readFile('assets/ü.bin'), media);
  assert.ok(fs.statSync(optimizedPath).size < fs.statSync(defaultPath).size);
});
