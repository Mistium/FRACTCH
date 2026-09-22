import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildProjectFromBuildDir } from '../src/pack.js';
import { convertProject } from '../src/convert.js';
import { verifyRoundtrip } from '../src/roundtripDiff.js';
import { checkFractch } from '../src/lint.js';
import { parseFractch } from '../src/parse.js';
import { buildBlocksFromCalls, IdGen } from '../src/buildBlocks.js';
import { stringifyBlockCall } from '../src/stringify.js';

test('readable syntax builds real blocks and source generation preserves them', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fractch-readable-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'Stage'));
  const source = `
var score = 0;
var message = "  hello  ";
var items = ["one", "two"];
on flag {
  score++;
  score--;
  score *= 3;
  score /= 2;
  items.push("three");
  items[1] = "first";
  delete items[2];
  items.insert(1, "zero");
  items.show();
  items.hide();
  if items.includes("first") { say items.indexOf("first"); }
  say items.last;
  say items.random;
  for (index, value) in items { say \`Item \${index}: \${value}\`; }
  unless mouse.down { wait until key.down("space"); }
  every 1 seconds { emit "tick"; }
  self.x = 10;
  self.y += 2;
  self.position = (10, 20);
  self.direction = 90;
  self.face("mouse-pointer");
  self.glideTo(20, 30, 1);
  self.visible = true;
  self.visible = false;
  self.size = 120;
  self.size += 10;
  self.costume = "costume1";
  stage.backdrop = "backdrop1";
  self.effect.ghost = 50;
  self.effect.ghost += 10;
  self.layer = front;
  self.layer += 1;
  sound.play("pop");
  sound.playUntilDone("pop");
  sound.volume = 50;
  sound.volume += 10;
  sound.effect.pitch = 5;
  pen.down(); pen.up(); pen.clear();
  pen.color = "#ff0000";
  pen.size = 2;
  pen.size += 1;
  say mouse.x; say mouse.y; say timer.value;
  timer.reset();
  if self.touching("mouse-pointer") { say "touch"; }
  say message[1];
  if message.includes("hello") { say message.trim().toUpperCase(); }
  say message.toLowerCase().replace("hello", "hi");
  say min(1, 2); say max(1, 2); say PI; say NEWLINE;
  say \`Score: \${score}\`;
  emit "tick" and wait;
}
on key space { say self.x; }
on message "tick" { say self.costume; say stage.backdrop; }
`;
  fs.writeFileSync(path.join(root, 'Stage', 'main.fractch'), source);
  assert.deepEqual(checkFractch(source), []);

  const { manifest, diagnostics } = await buildProjectFromBuildDir({ buildDir: root, fs, prune: false });
  assert.deepEqual(diagnostics?.filter((entry) => entry.severity === 'error') ?? [], []);
  const blocks = Object.values(manifest.targets.find((target) => target.isStage).blocks);
  for (const opcode of [
    'event_whenflagclicked',
    'event_whenkeypressed',
    'event_whenbroadcastreceived',
    'operator_join',
    'data_itemoflist',
    'data_itemnumoflist',
    'data_listcontainsitem',
    'operator_replace',
    'motion_glidesecstoxy',
    'sound_playuntildone',
    'pen_setPenColorToColor',
  ])
    assert.ok(
      blocks.some((block) => block.opcode === opcode),
      `${opcode} was not built`
    );

  const out = path.join(root, 'generated');
  await convertProject(manifest, { outDir: out, fs });
  const generated = fs.readFileSync(path.join(out, 'Stage', 'main.fractch'), 'utf8');
  for (const snippet of [
    'on flag',
    'score++;',
    'score *= 3;',
    'for (index, value) in items',
    'unless mouse.down',
    'every 1 seconds',
    'self.position = (10, 20);',
    'sound.playUntilDone("pop")',
    'pen.color = "#ff0000";',
    'message.trim().toUpperCase()',
    '`Score: ${score}`',
    'emit tick and wait;',
  ])
    assert.ok(generated.includes(snippet), `missing generated syntax: ${snippet}`);
  const roundtrip = await verifyRoundtrip({ project: manifest, buildDir: out, fs });
  assert.deepEqual(roundtrip.failures, []);
  assert.equal(roundtrip.ok, roundtrip.total);
});

test('template strings preserve each join block and escape literal markers', () => {
  const source = 'say `\\` \\${literal} \\n ${score}${score} end`;';
  assert.deepEqual(checkFractch(source), []);
  const parsed = parseFractch(source);
  assert.deepEqual(parsed.errors, []);
  const { blocks, topId } = buildBlocksFromCalls(parsed.calls, { idGen: new IdGen() });
  const rendered = stringifyBlockCall(blocks[topId], blocks, topId);
  assert.match(rendered, /\\` \\\${literal} \\n/);
  assert.match(rendered, /\${score}\${score}/);

  const literalJoin = parseFractch('say "a" ++ "b";');
  const built = buildBlocksFromCalls(literalJoin.calls, { idGen: new IdGen() });
  assert.equal(stringifyBlockCall(built.blocks[built.topId], built.blocks, built.topId), 'say "a" ++ "b";');

  const joinStatement = parseFractch('score ++ " suffix";');
  assert.deepEqual(joinStatement.errors, []);
  assert.equal(joinStatement.calls[0].callee.name, 'operator_join');
});
