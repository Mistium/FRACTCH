import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { convertProject } from '../src/convert.js';
import { buildProjectFromBuildDir } from '../src/pack.js';
import { verifyRoundtrip } from '../src/roundtripDiff.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fractch-pattern-'));

const target = (name, blocks, extra = {}) => ({
  isStage: name === 'Stage',
  name,
  blocks,
  variables: {},
  lists: {},
  broadcasts: {},
  comments: {},
  costumes: [],
  sounds: [],
  ...extra,
});

const projectOf = (...targets) => {
  if (!targets.some((t) => t.isStage)) targets.unshift(target('Stage', {}));
  return { targets, monitors: [], extensions: [], meta: {} };
};

const roundtrip = async (project) => {
  const outDir = tmp();
  try {
    await convertProject(project, { outDir, fs });
    const { total, ok, failures } = await verifyRoundtrip({ project, buildDir: outDir, fs });
    assert.deepStrictEqual(failures.map((f) => f.err), [], 'structural divergence');
    assert.ok(total > 0, 'no scripts were verified');
    assert.strictEqual(ok, total);
    const { manifest } = await buildProjectFromBuildDir({ buildDir: outDir, fs, prune: false });
    return manifest;
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
};

const packedBlocks = (manifest, name) => {
  const t = (manifest.targets || []).find((x) => x.name === name);
  assert.ok(t, `packed project has no target ${name}`);
  return Object.fromEntries(Object.entries(t.blocks || {})
    .filter(([, b]) => b && typeof b === 'object' && !Array.isArray(b) && typeof b.opcode === 'string'));
};

const hat = (next) => ({ opcode: 'event_whenflagclicked', next, parent: null, inputs: {}, fields: {}, topLevel: true, x: 0, y: 0 });

test('obscured shadow: active reporter survives, shadow value is regenerable', async () => {
  const manifest = await roundtrip(projectOf(target('main', {
    hat: hat('move'),
    move: { opcode: 'motion_movesteps', next: null, parent: 'hat', inputs: { STEPS: [3, 'add', 'shadow1'] }, fields: {} },
    add: { opcode: 'operator_add', next: null, parent: 'move', inputs: { NUM1: [1, [4, '1']], NUM2: [1, [4, '2']] }, fields: {} },
    shadow1: { opcode: 'math_number', next: null, parent: 'move', inputs: {}, fields: { NUM: ['10', null] }, shadow: true },
  })));
  const packed = packedBlocks(manifest, 'main');
  assert.ok(Object.values(packed).some((b) => b.opcode === 'operator_add'), 'plugged reporter survived');
});

test('degenerate [3, null, shadow] input emits its visible shadow', async () => {
  const manifest = await roundtrip(projectOf(target('main', {
    hat: hat('wait'),
    wait: { opcode: 'control_wait_until', next: null, parent: 'hat', inputs: { CONDITION: [2, 'key'] }, fields: {} },
    key: { opcode: 'sensing_keypressed', next: null, parent: 'wait', inputs: { KEY_OPTION: [3, null, 'menu1'] }, fields: {} },
    menu1: { opcode: 'sensing_keyoptions', next: null, parent: 'key', inputs: {}, fields: { KEY_OPTION: ['space', null] }, shadow: true },
  })));
  const packed = packedBlocks(manifest, 'main');
  const menu = Object.values(packed).find((b) => b.opcode === 'sensing_keyoptions');
  assert.ok(menu, 'menu shadow survived');
  assert.strictEqual(menu.fields.KEY_OPTION[0], 'space');
});

test('empty if condition still parses and keeps the if block', async () => {
  const manifest = await roundtrip(projectOf(target('main', {
    hat: hat('iff'),
    iff: { opcode: 'control_if', next: null, parent: 'hat', inputs: { SUBSTACK: [2, 'say'] }, fields: {} },
    say: { opcode: 'looks_say', next: null, parent: 'iff', inputs: { MESSAGE: [1, [10, 'hi']] }, fields: {} },
  })));
  const packed = packedBlocks(manifest, 'main');
  assert.ok(Object.values(packed).some((b) => b.opcode === 'control_if'), 'if survived');
  assert.ok(Object.values(packed).some((b) => b.opcode === 'looks_say'), 'body survived');
});

test('empty not <> keeps the operator_not block', async () => {
  const manifest = await roundtrip(projectOf(target('main', {
    hat: hat('iff'),
    iff: { opcode: 'control_if', next: null, parent: 'hat', inputs: { CONDITION: [2, 'not1'], SUBSTACK: [2, 'say'] }, fields: {} },
    not1: { opcode: 'operator_not', next: null, parent: 'iff', inputs: {}, fields: {} },
    say: { opcode: 'looks_say', next: null, parent: 'iff', inputs: { MESSAGE: [1, [10, 'hi']] }, fields: {} },
  })));
  const packed = packedBlocks(manifest, 'main');
  assert.ok(Object.values(packed).some((b) => b.opcode === 'operator_not'), 'operator_not survived');
});

test('extension input named BROADCAST_OPTION stays an input, not a field', async () => {
  const manifest = await roundtrip(projectOf(target('main', {
    hat: hat('ext'),
    ext: {
      opcode: 'lmsMoreEvents_broadcastData', next: null, parent: 'hat',
      inputs: {
        BROADCAST_OPTION: [1, [11, 'MyEvent', 'bcast-id']],
        DATA: [1, [10, 'payload']],
      },
      fields: {},
    },
  }, { broadcasts: { 'bcast-id': 'MyEvent' } })));
  const packed = packedBlocks(manifest, 'main');
  const ext = Object.values(packed).find((b) => b.opcode === 'lmsMoreEvents_broadcastData');
  assert.ok(ext, 'extension block survived');
  assert.ok(ext.inputs.BROADCAST_OPTION, 'BROADCAST_OPTION still an input');
  assert.ok(!ext.fields.BROADCAST_OPTION, 'not converted to a field');
  assert.strictEqual(ext.inputs.BROADCAST_OPTION[1][1], 'MyEvent');
});

test('same proccode in two sprites with different argument ids', async () => {
  const spriteBlocks = (argId) => ({
    def: { opcode: 'procedures_definition', next: null, parent: null, inputs: { custom_block: [1, 'proto'] }, fields: {}, topLevel: true, x: 0, y: 0 },
    proto: {
      opcode: 'procedures_prototype', next: null, parent: 'def', inputs: { [argId]: [1, 'argrep'] }, fields: {}, shadow: true,
      mutation: { tagName: 'mutation', children: [], proccode: 'do thing %s', argumentids: JSON.stringify([argId]), argumentnames: '["x"]', argumentdefaults: '[""]', warp: 'false' },
    },
    argrep: { opcode: 'argument_reporter_string_number', next: null, parent: 'proto', inputs: {}, fields: { VALUE: ['x', null] }, shadow: true },
    hat: hat('call'),
    call: {
      opcode: 'procedures_call', next: null, parent: 'hat', inputs: { [argId]: [1, [10, 'v']] }, fields: {},
      mutation: { tagName: 'mutation', children: [], proccode: 'do thing %s', argumentids: JSON.stringify([argId]), warp: 'false' },
    },
  });
  const manifest = await roundtrip(projectOf(
    target('spriteA', spriteBlocks('arg-a')),
    target('spriteB', spriteBlocks('arg-b'))
  ));
  for (const name of ['spriteA', 'spriteB']) {
    const packed = packedBlocks(manifest, name);
    const call = Object.values(packed).find((b) => b.opcode === 'procedures_call');
    const ids = JSON.parse(call.mutation.argumentids);
    const arg = call.inputs[ids[0]];
    assert.ok(arg, `${name} call kept its argument`);
    assert.strictEqual(arg[1][1], 'v', `${name} argument value survived`);
  }
});

test('call whose own argumentids differ from the prototype still keeps its value', async () => {
  const manifest = await roundtrip(projectOf(target('main', {
    def: { opcode: 'procedures_definition', next: null, parent: null, inputs: { custom_block: [1, 'proto'] }, fields: {}, topLevel: true, x: 0, y: 0 },
    proto: {
      opcode: 'procedures_prototype', next: null, parent: 'def', inputs: { 'proto-arg': [1, 'argrep'] }, fields: {}, shadow: true,
      mutation: { tagName: 'mutation', children: [], proccode: 'sized %s', argumentids: '["proto-arg"]', argumentnames: '["n"]', argumentdefaults: '[""]', warp: 'false' },
    },
    argrep: { opcode: 'argument_reporter_string_number', next: null, parent: 'proto', inputs: {}, fields: { VALUE: ['n', null] }, shadow: true },
    hat: hat('call'),
    call: {
      opcode: 'procedures_call', next: null, parent: 'hat', inputs: { 'stale-arg': [1, [10, '42']] }, fields: {},
      mutation: { tagName: 'mutation', children: [], proccode: 'sized %s', argumentids: '["stale-arg"]', warp: 'false' },
    },
  })));
  const packed = packedBlocks(manifest, 'main');
  const call = Object.values(packed).find((b) => b.opcode === 'procedures_call');
  const ids = JSON.parse(call.mutation.argumentids);
  assert.strictEqual(call.inputs[ids[0]][1][1], '42', 'divergent-signature call kept its argument value');
});

test('cross-sprite call to a def that only exists in another sprite', async () => {
  const manifest = await roundtrip(projectOf(
    target('owner', {
      def: { opcode: 'procedures_definition', next: null, parent: null, inputs: { custom_block: [1, 'proto'] }, fields: {}, topLevel: true, x: 0, y: 0 },
      proto: {
        opcode: 'procedures_prototype', next: null, parent: 'def', inputs: { a1: [1, 'argrep'] }, fields: {}, shadow: true,
        mutation: { tagName: 'mutation', children: [], proccode: 'shared %s', argumentids: '["a1"]', argumentnames: '["x"]', argumentdefaults: '[""]', warp: 'false' },
      },
      argrep: { opcode: 'argument_reporter_string_number', next: null, parent: 'proto', inputs: {}, fields: { VALUE: ['x', null] }, shadow: true },
    }),
    target('caller', {
      hat: hat('call'),
      call: {
        opcode: 'procedures_call', next: null, parent: 'hat', inputs: { a1: [1, [10, 'hello']] }, fields: {},
        mutation: { tagName: 'mutation', children: [], proccode: 'shared %s', argumentids: '["a1"]', warp: 'false' },
      },
    })
  ));
  const packed = packedBlocks(manifest, 'caller');
  const call = Object.values(packed).find((b) => b.opcode === 'procedures_call');
  assert.strictEqual(call.mutation.proccode, 'shared %s', 'cross-sprite call resolved to the real proccode');
  const ids = JSON.parse(call.mutation.argumentids);
  assert.strictEqual(call.inputs[ids[0]][1][1], 'hello');
});

test('variable named text: .letter() resolves to operator_letter_of', async () => {
  const manifest = await roundtrip(projectOf(
    target('Stage', {}, { variables: { vtext: ['text', 'abc'] } }),
    target('main', {
      hat: hat('say'),
      say: { opcode: 'looks_say', next: null, parent: 'hat', inputs: { MESSAGE: [3, 'letter', [10, '']] }, fields: {} },
      letter: {
        opcode: 'operator_letter_of', next: null, parent: 'say',
        inputs: { LETTER: [1, [6, '1']], STRING: [3, [12, 'text', 'vtext'], [10, '']] }, fields: {},
      },
    })
  ));
  const packed = packedBlocks(manifest, 'main');
  assert.ok(Object.values(packed).some((b) => b.opcode === 'operator_letter_of'), 'letter block survived');
  assert.ok(!Object.values(packed).some((b) => b.opcode === 'text_letter'), 'no bogus text_letter opcode');
});

test('dangling next reference is preserved verbatim', async () => {
  const manifest = await roundtrip(projectOf(target('main', {
    hat: hat('say'),
    say: { opcode: 'looks_say', next: 'gone-forever', parent: 'hat', inputs: { MESSAGE: [1, [10, 'hi']] }, fields: {} },
  })));
  const packed = packedBlocks(manifest, 'main');
  const say = Object.values(packed).find((b) => b.opcode === 'looks_say');
  assert.strictEqual(say.next, 'gone-forever', 'dangling forward reference kept its exact id');
});

test('shared tail between two scripts duplicates rather than dropping', async () => {
  const manifest = await roundtrip(projectOf(target('main', {
    hatA: { ...hat('shared'), x: 0 },
    hatB: { opcode: 'event_whenthisspriteclicked', next: 'shared', parent: null, inputs: {}, fields: {}, topLevel: true, x: 200, y: 0 },
    shared: { opcode: 'looks_say', next: null, parent: 'hatA', inputs: { MESSAGE: [1, [10, 'tail']] }, fields: {} },
  })));
  const packed = packedBlocks(manifest, 'main');
  const says = Object.values(packed).filter((b) => b.opcode === 'looks_say');
  assert.strictEqual(says.length, 2, 'both scripts keep the shared tail behavior');
});

test('floating shadow is dropped, never re-emitted', async () => {
  const manifest = await roundtrip(projectOf(target('main', {
    hat: hat('say'),
    say: { opcode: 'looks_say', next: null, parent: 'hat', inputs: { MESSAGE: [1, [10, 'hi']] }, fields: {} },
    floater: { opcode: 'math_number', next: null, parent: null, inputs: {}, fields: { NUM: ['9', null] }, shadow: true, topLevel: true, x: 5, y: 5 },
  })));
  const packed = packedBlocks(manifest, 'main');
  for (const [id, b] of Object.entries(packed)) {
    assert.ok(!(b.shadow && b.topLevel), `floating shadow ${id} in packed output`);
  }
  assert.ok(!Object.values(packed).some((b) => b.opcode === 'math_number' && b.fields.NUM?.[0] === '9'), 'floater gone');
});

test('cloud variable declaration round-trips', async () => {
  const manifest = await roundtrip(projectOf(
    target('Stage', {}, { variables: { cv: ['☁ highscore', '0', true] } }),
    target('main', {
      hat: hat('set'),
      set: { opcode: 'data_setvariableto', next: null, parent: 'hat', inputs: { VALUE: [1, [10, '5']] }, fields: { VARIABLE: ['☁ highscore', 'cv'] } },
    })
  ));
  const stage = (manifest.targets || []).find((t) => t.isStage);
  const entry = Object.values(stage.variables).find((v) => Array.isArray(v) && v[0] === '☁ highscore');
  assert.ok(entry, 'cloud variable exists on stage');
  assert.strictEqual(entry[2], true, 'cloud flag survived');
});

test('unicode variable and sprite names round-trip', async () => {
  const manifest = await roundtrip(projectOf(
    target('Stage', {}, { variables: { uv: ['ちから 力', '3'] } }),
    target('スプライト', {
      hat: hat('set'),
      set: { opcode: 'data_setvariableto', next: null, parent: 'hat', inputs: { VALUE: [1, [10, '7']] }, fields: { VARIABLE: ['ちから 力', 'uv'] } },
    })
  ));
  const packed = packedBlocks(manifest, 'スプライト');
  const set = Object.values(packed).find((b) => b.opcode === 'data_setvariableto');
  assert.strictEqual(set.fields.VARIABLE[0], 'ちから 力');
});

test('variables named like DSL keywords need vars[...] and survive', async () => {
  const names = ['shadow', 'var', 'list', 'true', 'null', 'broadcast', 'if'];
  const variables = Object.fromEntries(names.map((n, i) => [`id${i}`, [n, String(i)]]));
  const blocks = { hat: hat('s0') };
  names.forEach((n, i) => {
    blocks[`s${i}`] = {
      opcode: 'data_setvariableto', next: i + 1 < names.length ? `s${i + 1}` : null,
      parent: i === 0 ? 'hat' : `s${i - 1}`,
      inputs: { VALUE: [1, [10, `v${i}`]] }, fields: { VARIABLE: [n, `id${i}`] },
    };
  });
  const manifest = await roundtrip(projectOf(target('Stage', blocks, { variables })));
  const packed = packedBlocks(manifest, 'Stage');
  const setNames = Object.values(packed).filter((b) => b.opcode === 'data_setvariableto').map((b) => b.fields.VARIABLE[0]);
  assert.deepStrictEqual(setNames.sort(), [...names].sort());
});

test('switch/case with fallthrough and default round-trips', async () => {
  const manifest = await roundtrip(projectOf(target('main', {
    hat: hat('sw'),
    sw: { opcode: 'control_switch', next: null, parent: 'hat', inputs: { VALUE: [1, [10, 'a']], SUBSTACK: [2, 'c1'] }, fields: {} },
    c1: { opcode: 'control_case_fallthrough', next: 'c2', parent: 'sw', inputs: { VALUE: [1, [10, 'a']], SUBSTACK: [2, 'say1'] }, fields: {} },
    say1: { opcode: 'looks_say', next: null, parent: 'c1', inputs: { MESSAGE: [1, [10, 'one']] }, fields: {} },
    c2: { opcode: 'control_case', next: 'c3', parent: 'sw', inputs: { VALUE: [1, [10, 'b']], SUBSTACK: [2, 'say2'] }, fields: {} },
    say2: { opcode: 'looks_say', next: null, parent: 'c2', inputs: { MESSAGE: [1, [10, 'two']] }, fields: {} },
    c3: { opcode: 'control_default', next: null, parent: 'sw', inputs: { SUBSTACK: [2, 'say3'] }, fields: {} },
    say3: { opcode: 'looks_say', next: null, parent: 'c3', inputs: { MESSAGE: [1, [10, 'other']] }, fields: {} },
  })));
  const packed = packedBlocks(manifest, 'main');
  for (const opcode of ['control_switch', 'control_case_fallthrough', 'control_case', 'control_default']) {
    assert.ok(Object.values(packed).some((b) => b.opcode === opcode), `${opcode} survived`);
  }
});

test('stop other scripts keeps hasnext mutation and its next block', async () => {
  const manifest = await roundtrip(projectOf(target('main', {
    hat: hat('stop1'),
    stop1: {
      opcode: 'control_stop', next: 'say', parent: 'hat', inputs: {}, fields: { STOP_OPTION: ['other scripts in sprite', null] },
      mutation: { tagName: 'mutation', children: [], hasnext: 'true' },
    },
    say: { opcode: 'looks_say', next: null, parent: 'stop1', inputs: { MESSAGE: [1, [10, 'after']] }, fields: {} },
  })));
  const packed = packedBlocks(manifest, 'main');
  const stop = Object.values(packed).find((b) => b.opcode === 'control_stop');
  assert.strictEqual(String(stop.mutation.hasnext), 'true');
  assert.ok(stop.next, 'stop kept its next block');
});

test('workspace and block comments round-trip', async () => {
  const manifest = await roundtrip(projectOf(target('main', {
    hat: hat('say'),
    say: { opcode: 'looks_say', next: null, parent: 'hat', inputs: { MESSAGE: [1, [10, 'hi']] }, fields: {}, comment: 'bc' },
  }, {
    comments: {
      wc: { blockId: null, x: 10, y: 20, width: 220, height: 100, minimized: false, text: 'standalone "note" with\nnewline' },
      bc: { blockId: 'say', x: 40, y: 50, width: 200, height: 80, minimized: true, text: 'attached' },
    },
  })));
  const packed = (manifest.targets || []).find((t) => t.name === 'main');
  const texts = Object.values(packed.comments || {}).map((c) => c.text).sort();
  assert.deepStrictEqual(texts, ['attached', 'standalone "note" with\nnewline']);
});

test('variable and list monitors with sliders round-trip', async () => {
  const outDir = tmp();
  try {
    const project = projectOf(
      target('Stage', {}, { variables: { v1: ['score', '0'] }, lists: { l1: ['queue', []] } })
    );
    project.monitors = [
      { id: 'v1', mode: 'slider', opcode: 'data_variable', params: { VARIABLE: 'score' }, spriteName: null, value: 0, x: 5, y: 6, width: 0, height: 0, visible: true, sliderMin: -5, sliderMax: 50, isDiscrete: false },
      { id: 'l1', mode: 'list', opcode: 'data_listcontents', params: { LIST: 'queue' }, spriteName: null, value: [], x: 7, y: 8, width: 120, height: 200, visible: false },
    ];
    await convertProject(project, { outDir, fs });
    const { manifest } = await buildProjectFromBuildDir({ buildDir: outDir, fs, prune: false });
    const byOpcode = Object.fromEntries((manifest.monitors || []).map((m) => [m.opcode, m]));
    assert.ok(byOpcode.data_variable, 'variable monitor survived');
    assert.strictEqual(byOpcode.data_variable.mode, 'slider');
    assert.strictEqual(byOpcode.data_variable.sliderMin, -5);
    assert.strictEqual(byOpcode.data_variable.sliderMax, 50);
    assert.ok(byOpcode.data_listcontents, 'list monitor survived');
    assert.strictEqual(byOpcode.data_listcontents.visible, false);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test('literal fidelity: leading-zero, exponent, empty and unicode strings', async () => {
  const values = ['007', '.25', '1e3', '-0', '', 'با متن', '"quoted"', '{not json'];
  const blocks = { hat: hat('s0') };
  values.forEach((v, i) => {
    blocks[`s${i}`] = {
      opcode: 'looks_say', next: i + 1 < values.length ? `s${i + 1}` : null,
      parent: i === 0 ? 'hat' : `s${i - 1}`,
      inputs: { MESSAGE: [1, [10, v]] }, fields: {},
    };
  });
  const manifest = await roundtrip(projectOf(target('main', blocks)));
  const packed = packedBlocks(manifest, 'main');
  const got = Object.values(packed).filter((b) => b.opcode === 'looks_say').map((b) => String(b.inputs.MESSAGE[1][1]));
  assert.deepStrictEqual(got.sort(), [...values].sort());
});

test('orphan argument reporter at top level stays a real block, not a shadow', async () => {
  const manifest = await roundtrip(projectOf(target('main', {
    orphan: { opcode: 'argument_reporter_string_number', next: null, parent: null, inputs: {}, fields: { VALUE: ['ghost param', null] }, topLevel: true, x: 12, y: 34 },
  })));
  const packed = packedBlocks(manifest, 'main');
  const rep = Object.values(packed).find((b) => b.opcode === 'argument_reporter_string_number');
  assert.ok(rep, 'orphan reporter survived');
  assert.strictEqual(rep.fields.VALUE[0], 'ghost param');
  assert.notStrictEqual(rep.shadow, true, 'must not become a floating shadow');
});

test('boolean literal true/false packs as the 0==0 idiom and survives', async () => {
  const manifest = await roundtrip(projectOf(target('main', {
    hat: hat('iff'),
    iff: { opcode: 'control_if', next: null, parent: 'hat', inputs: { CONDITION: [2, 'eq'], SUBSTACK: [2, 'say'] }, fields: {} },
    eq: { opcode: 'operator_equals', next: null, parent: 'iff', inputs: { OPERAND1: [1, [4, '0']], OPERAND2: [1, [4, '0']] }, fields: {} },
    say: { opcode: 'looks_say', next: null, parent: 'iff', inputs: { MESSAGE: [1, [10, 'yes']] }, fields: {} },
  })));
  const packed = packedBlocks(manifest, 'main');
  const eq = Object.values(packed).find((b) => b.opcode === 'operator_equals');
  assert.ok(eq, 'boolean literal rebuilt as operator_equals');
});
