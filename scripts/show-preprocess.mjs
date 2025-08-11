import fs from 'fs';
import path from 'path';
import { preprocess } from '../src/parse.js';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/show-preprocess.mjs <path-to-fractch>');
  process.exit(2);
}
const p = path.resolve(file);
const s = fs.readFileSync(p, 'utf8');
console.log(preprocess(s));
