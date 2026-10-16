import { test } from 'node:test';
import assert from 'node:assert';
import { buildBlocksFromCalls } from '../src/buildBlocks.js';
import { parseFractch } from '../src/parse.js';

test('stop blocks with a following block expose a next connection', () => {
  const { blocks, topId } = buildBlocksFromCalls(parseFractch('stop all;\nbroadcast "next";\n').calls);

  assert.ok(blocks[topId].next);
  assert.strictEqual(blocks[topId].mutation.hasnext, 'true');
});

test('empty inputs written as null are left out instead of becoming text', () => {
  const source = 'if null {\n  stop all;\n}\nwait_until null;\nuntil null {}\nwhile null {}\nif not(null) {}\n';
  const { blocks } = buildBlocksFromCalls(parseFractch(source).calls);
  const byOpcode = (opcode) => Object.values(blocks).filter((b) => b.opcode === opcode);

  for (const opcode of ['control_wait_until', 'control_repeat_until', 'control_while']) {
    assert.strictEqual(byOpcode(opcode)[0].inputs.CONDITION, undefined, opcode);
  }
  const [emptyIf, notIf] = byOpcode('control_if');
  assert.strictEqual(emptyIf.inputs.CONDITION, undefined);
  assert.ok(emptyIf.inputs.SUBSTACK);
  assert.ok(notIf.inputs.CONDITION);
  assert.deepStrictEqual(byOpcode('operator_not')[0].inputs, {});
});
