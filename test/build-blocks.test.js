import { test } from 'node:test';
import assert from 'node:assert';
import { buildBlocksFromCalls } from '../src/buildBlocks.js';
import { parseFractch } from '../src/parse.js';

test('stop blocks with a following block expose a next connection', () => {
  const { blocks, topId } = buildBlocksFromCalls(parseFractch('stop all;\nbroadcast "next";\n').calls);

  assert.ok(blocks[topId].next);
  assert.strictEqual(blocks[topId].mutation.hasnext, 'true');
});
