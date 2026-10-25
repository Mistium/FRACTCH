import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { convertProject } from '../src/convert.js';
import { indentBlock } from '../src/emit.js';
import { MEMBERSHIP_MAGIC, membershipText, parseMembershipText, readMembership } from '../src/membership.js';
import { buildProjectFromBuildDir } from '../src/pack.js';
import { blockCommentText, parseFractch } from '../src/parse.js';
import { freeCommentText, lineCommentText } from '../src/stringify.js';
import { buildTarget, emitTarget } from '../src/target.js';
import { applyResult, liveContext } from './helpers/live-context.js';
import { flag, projectOf, stageTarget, stmt, tempDir, writeFiles } from './helpers/regressions.js';

const mapOf = (target) => {
  const c = Object.values(target.comments || {}).find((x) => String(x.text).startsWith(MEMBERSHIP_MAGIC));
  return c ? JSON.parse(c.text.slice(MEMBERSHIP_MAGIC.length)) : null;
};
const commentIdByText = (target, text) => Object.entries(target.comments).find(([, c]) => c.text === text)?.[0];
const topIdByOpcode = (target, opcode) =>
  Object.entries(target.blocks).find(([, b]) => b.opcode === opcode && b.topLevel)?.[0];
const errorsOf = (result) => result.diagnostics.filter((d) => d.severity === 'error');

function freshStage() {
  const ctx = liveContext(projectOf(stageTarget()));
  return { ctx, id: ctx.targets[0].id };
}

function applyText(ctx, id, text) {
  const built = buildTarget(ctx, id, text, { previous: emitTarget(ctx, id) });
  assert.deepEqual(errorsOf(built), []);
  return { built, ctx: applyResult(ctx, id, built) };
}

function readTree(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith('.fractch'))
        out[path.relative(dir, p).split(path.sep).join('/')] = fs.readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return out;
}

const bodyOf = (fileText) => fileText.replace(/^\/\*\*[^]*?\*\/\n\n/, '');

test('/* */ comments attach like // and free ones stay at the top level', () => {
  const src = [
    'when flag {',
    '  say 1; /* trailing */',
    '  /*',
    '   * above think',
    '   */',
    '  think 2;',
    '}',
    '',
    '/** free',
    '    note */',
    '',
    '/* above key */',
    'when key space {',
    '  say 3;',
    '}',
    '',
  ].join('\n');
  const parsed = parseFractch(src);
  assert.deepEqual(parsed.errors, []);
  const attached = (i) => parsed.scripts[i].calls.filter((c) => c.type === 'commentDecl');
  assert.deepEqual(
    attached(0).map((c) => [c.text, c.anchor]),
    [
      ['trailing', 'prev'],
      ['above think', 'next'],
    ]
  );
  assert.deepEqual(
    attached(1).map((c) => c.text),
    ['above key']
  );
  assert.deepEqual(
    parsed.comments.map((c) => c.text),
    ['free\nnote']
  );
});

test('block comment text drops presentation and keeps inner blank lines', () => {
  assert.equal(blockCommentText(' one line '), 'one line');
  assert.equal(blockCommentText('*\n * doc\n *\n *   indented\n '), 'doc\n\n  indented');
  assert.equal(blockCommentText('\n    a\n\n      b\n  '), 'a\n\n  b');
  assert.equal(blockCommentText(' first\n     second '), 'first\nsecond');
  assert.equal(blockCommentText('\n * a\n   b\n'), '* a\n  b');
});

test('the generated header is not a comment, but a leading doc comment is', () => {
  const header = '/**\n * target: Stage\n * targetId: abc\n */\n\nwhen flag {\n  say 1;\n}\n';
  const parsed = parseFractch(header);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.comments, []);
  assert.equal(parsed.scripts[0].calls.filter((c) => c.type === 'commentDecl').length, 0);

  const doc = parseFractch('/**\n * starts the game\n */\n\nwhen flag {\n  say 1;\n}\n');
  assert.deepEqual(
    doc.comments.map((c) => c.text),
    ['starts the game']
  );
});

test('an unterminated /* is an error and comment markers inside strings are not comments', () => {
  const src = 'when flag {\n  say 1;\n}\n/* never closed\nsay 2;\n';
  const open = parseFractch(src);
  assert.deepEqual(
    open.errors.map((e) => [e.code, e.from, e.to, e.line, e.region]),
    [['FR125', src.indexOf('/*'), src.indexOf('/*') + 2, 4, { from: src.indexOf('/*'), to: src.length }]]
  );
  assert.deepEqual(open.comments, []);
  assert.equal(open.scripts.length, 1);
  assert.ok(parseFractch('when flag {\n  say 1; /* open\n}\n').errors.some((e) => e.code === 'FR125'));
  const inRegion = parseFractch('region "r" {\n  when flag {\n    say 1;\n  }\n  /* open\n}\n');
  assert.ok(inRegion.errors.some((e) => e.code === 'FR125' && e.line === 5));

  const strings = parseFractch('when flag {\n  say "/* not */ // either";\n  say """raw /* x */""";\n}\n');
  assert.deepEqual(strings.errors, []);
  assert.equal(strings.scripts[0].calls.filter((c) => c.type === 'commentDecl').length, 0);
  assert.deepEqual(strings.comments, []);
});

test('simple comments are written as // or /* */ and read back exactly', () => {
  const simple = (text) => ({ text, x: 0, y: 0, width: 200, height: 200, minimized: false, forId: null });
  assert.equal(lineCommentText(simple('one line')), '// one line');
  assert.equal(lineCommentText(simple('a\n\n  b')), '/*\n * a\n *\n *   b\n */');
  assert.equal(freeCommentText(simple('has */ inside\nline')), 'comment "has */ inside\\nline";');
  assert.match(freeCommentText(simple('trailing \nspace')), /^comment /);
  assert.equal(freeCommentText({ ...simple('moved'), x: 5, y: 6 }), '// moved');
  assert.equal(freeCommentText({ ...simple('big'), width: 300, height: 150 }), 'comment "big" size 300x150;');
  assert.equal(freeCommentText({ ...simple('tiny'), minimized: true, x: 3 }), 'comment "tiny" minimized;');

  const texts = [
    'plain',
    'two\nlines',
    'a\n\n  b\n\tc',
    '* bullet\n* list',
    'ends with star *\n/ starts with slash',
    'code: /* nested?\n// line',
    'x\n   \ny'.replace('   ', ''),
  ];
  for (const text of texts) {
    const written = freeCommentText(simple(text));
    assert.doesNotMatch(written, /^comment /, text);
    const top = parseFractch(`${written}\n`);
    assert.deepEqual(
      top.comments.map((c) => c.text),
      [text],
      `top level: ${JSON.stringify(text)}`
    );
    const nested = parseFractch(`region "r" {\n${indentBlock(written)}\n}\n`);
    assert.deepEqual(
      nested.comments.map((c) => [c.text, c.region]),
      [[text, 'r']],
      `in a region: ${JSON.stringify(text)}`
    );
    const inScript = parseFractch(`when flag {\n${indentBlock(`${written}\nsay 1;`)}\n}\n`);
    assert.deepEqual(
      inScript.scripts[0].calls.filter((c) => c.type === 'commentDecl').map((c) => c.text),
      [text],
      `in a script: ${JSON.stringify(text)}`
    );
  }
});

test('multi-line block comments round-trip through a tree as /* */', async (t) => {
  const project = projectOf(
    stageTarget(
      { h: flag('s'), s: { ...stmt('looks_say', 'h', { MESSAGE: [1, [10, 'hi']] }), comment: 'c1' } },
      {
        comments: {
          c1: { blockId: 's', x: 0, y: 0, width: 200, height: 200, minimized: false, text: 'line 1\nline 2' },
        },
      }
    )
  );
  const out = tempDir(t);
  await convertProject(structuredClone(project), { outDir: out, fs });
  const text = readTree(out)['Stage/main.fractch'];
  assert.match(text, /\/\*\n {3}\* line 1\n {3}\* line 2\n {3}\*\/\n {2}say "hi";/);
  const { manifest } = await buildProjectFromBuildDir({ buildDir: out, fs, prune: false });
  const st = manifest.targets[0];
  const c = Object.values(st.comments).find((x) => x.text === 'line 1\nline 2');
  assert.equal(st.blocks[c.blockId].opcode, 'looks_say');
});

const CODE = [
  'var score = 0;',
  '',
  'when flag {',
  '  say 1;',
  '}',
  '',
  '// between the scripts',
  '',
  'when key space {',
  '  say 2;',
  '}',
  '',
  'region "enemies/boss" {',
  '  /*',
  '   * boss',
  '   * notes',
  '   */',
  '',
  '  when clicked {',
  '    say 3;',
  '  }',
  '',
  '  // end of boss',
  '}',
  '',
  'region "notes" {',
  '  // only a comment',
  '}',
  '',
].join('\n');

test('Code mode keeps free comments in their file and before their script', () => {
  const { ctx, id } = freshStage();
  const first = applyText(ctx, id, CODE);
  const target = first.ctx.targets[0];
  const flagTop = topIdByOpcode(target, 'event_whenflagclicked');
  const keyTop = topIdByOpcode(target, 'event_whenkeypressed');
  const clickTop = topIdByOpcode(target, 'event_whenthisspriteclicked');
  assert.deepEqual(mapOf(target), {
    version: 1,
    scripts: { [flagTop]: 'main', [keyTop]: 'main', [clickTop]: 'enemies/boss' },
    comments: {
      [commentIdByText(target, 'between the scripts')]: { before: keyTop },
      [commentIdByText(target, 'boss\nnotes')]: { region: 'enemies/boss', before: clickTop },
      [commentIdByText(target, 'end of boss')]: { region: 'enemies/boss' },
      [commentIdByText(target, 'only a comment')]: { region: 'notes' },
    },
  });

  const emitted = emitTarget(first.ctx, id);
  assert.equal(emitted.text.replace(/ at -?\d+,-?\d+/g, ''), CODE);
  for (const text of ['between the scripts', 'boss\nnotes', 'end of boss', 'only a comment']) {
    const range = emitted.sourceMap.comments[commentIdByText(target, text)];
    const parsed = parseFractch(emitted.text.slice(range.from, range.to));
    assert.deepEqual(
      parsed.comments.map((c) => c.text),
      [text]
    );
    assert.equal(emitted.text.split('\n')[range.line - 1].trim(), emitted.text.slice(range.from).split('\n')[0]);
  }
  const notes = emitted.sourceMap.regions.notes;
  assert.match(emitted.text.slice(notes.from, notes.to), /^region "notes" \{\n {2}\/\/ only a comment\n\}$/);

  const again = buildTarget(first.ctx, id, emitted.text, { previous: emitted });
  assert.deepEqual(errorsOf(again), []);
  assert.deepEqual(again.created.comments, []);
  assert.deepEqual(again.removed.comments, []);
  assert.deepEqual(again.unchangedScripts.sort(), [flagTop, keyTop, clickTop].sort());
  for (const [cid, c] of Object.entries(target.comments)) {
    if (!c.text.startsWith(MEMBERSHIP_MAGIC)) assert.strictEqual(again.target.comments[cid], c);
  }
  assert.equal(emitTarget(applyResult(first.ctx, id, again), id).text, emitted.text);
});

test('moving a free comment in Blocks mode keeps it as // and keeps the move', () => {
  const { ctx, id } = freshStage();
  const first = applyText(ctx, id, CODE);
  const target = structuredClone(first.ctx.targets[0]);
  const cid = commentIdByText(target, 'between the scripts');
  target.comments[cid] = { ...target.comments[cid], x: 321, y: -45 };
  const moved = { ...first.ctx, targets: [target] };
  const emitted = emitTarget(moved, id);
  assert.match(emitted.text, /\n\/\/ between the scripts\n\nwhen key space/);
  assert.doesNotMatch(emitted.text, /comment "/);
  const built = buildTarget(moved, id, emitted.text, { previous: emitted });
  assert.deepEqual(built.target.comments[cid], target.comments[cid]);

  const edited = buildTarget(moved, id, emitted.text.replace('between the scripts', 'between scripts'), {
    previous: emitted,
  });
  assert.deepEqual(edited.created.comments, []);
  assert.deepEqual(edited.removed.comments, []);
  assert.equal(edited.target.comments[cid].text, 'between scripts');
  assert.equal(edited.target.comments[cid].x, 321);
  assert.equal(edited.target.comments[cid].y, -45);
});

test('a comment whose script was deleted moves to the end of its file', async (t) => {
  const { ctx, id } = freshStage();
  const first = applyText(ctx, id, CODE);
  const target = structuredClone(first.ctx.targets[0]);
  const keyTop = topIdByOpcode(target, 'event_whenkeypressed');
  for (const [bid, b] of Object.entries(target.blocks))
    if (bid === keyTop || b.parent === keyTop) delete target.blocks[bid];
  const deleted = { ...first.ctx, targets: [target] };
  const emitted = emitTarget(deleted, id);
  const mainPart = emitted.text.slice(0, emitted.text.indexOf('region "enemies/boss"'));
  assert.match(mainPart, /\}\n\n\/\/ between the scripts\n\n$/);

  const out = tempDir(t);
  await convertProject(projectOf(target), { outDir: out, fs });
  assert.match(readTree(out)['Stage/main.fractch'], /\}\n\n\/\/ between the scripts\n$/);
});

test('a tree keeps free comments in their files and order', async (t) => {
  const dir = writeFiles(tempDir(t), {
    'Stage/main.fractch': [
      'var score = 0;',
      '',
      '// first',
      '',
      'when flag at 0,0 {',
      '  say 1;',
      '}',
      '',
      '/*',
      ' * second',
      ' *',
      ' * still second',
      ' */',
      '',
      'when key space at 0,200 {',
      '  say 2;',
      '}',
      '',
      '// last in main',
      '',
    ].join('\n'),
    'Stage/enemies/boss.fractch': [
      'comment "sized" size 300x150;',
      '',
      'when clicked at 0,400 {',
      '  say 3;',
      '}',
      '',
    ].join('\n'),
    'Stage/notes.fractch': '// only comments here\n\ncomment "big" size 300x150;\n\n// and here\n',
  });
  const { manifest } = await buildProjectFromBuildDir({ buildDir: dir, fs, prune: false });
  const st = manifest.targets.find((x) => x.isStage);
  const map = mapOf(st);
  const id = (text) => commentIdByText(st, text);
  assert.deepEqual(map.comments, {
    [id('first')]: { before: topIdByOpcode(st, 'event_whenflagclicked') },
    [id('second\n\nstill second')]: { before: topIdByOpcode(st, 'event_whenkeypressed') },
    [id('last in main')]: {},
    [id('sized')]: { region: 'enemies/boss', before: topIdByOpcode(st, 'event_whenthisspriteclicked') },
    [id('only comments here')]: { region: 'notes' },
    [id('big')]: { region: 'notes' },
    [id('and here')]: { region: 'notes' },
  });
  const at = (text) => [st.comments[id(text)].x, st.comments[id(text)].y];
  assert.deepEqual(
    ['first', 'second\n\nstill second', 'last in main', 'sized', 'only comments here', 'big', 'and here'].map(at),
    [
      [0, 544],
      [0, 744],
      [0, 944],
      [0, 1144],
      [0, 1344],
      [0, 1544],
      [0, 1744],
    ]
  );

  const out = tempDir(t);
  await convertProject(manifest, { outDir: out, fs });
  const tree = readTree(out);
  const original = readTree(dir);
  assert.equal(
    bodyOf(tree['Stage/main.fractch'])
      .replace(' id "score"', '')
      .replace(/^costume .*\n\n/m, ''),
    original['Stage/main.fractch']
  );
  assert.equal(bodyOf(tree['Stage/enemies/boss.fractch']), original['Stage/enemies/boss.fractch']);
  assert.equal(bodyOf(tree['Stage/notes.fractch']), original['Stage/notes.fractch']);

  const { manifest: second } = await buildProjectFromBuildDir({ buildDir: out, fs, prune: false });
  const out2 = tempDir(t);
  await convertProject(second, { outDir: out2, fs });
  assert.deepEqual(readTree(out2), tree);
});

test('Code mode text round-trips through a tree with comments in place', async (t) => {
  const { ctx, id } = freshStage();
  const first = applyText(ctx, id, CODE);
  const out = tempDir(t);
  await convertProject(projectOf(structuredClone(first.ctx.targets[0])), { outDir: out, fs });
  const tree = readTree(out);
  assert.deepEqual(Object.keys(tree).sort(), [
    'Stage/enemies/boss.fractch',
    'Stage/main.fractch',
    'Stage/notes.fractch',
  ]);
  assert.match(tree['Stage/main.fractch'], /\}\n\n\/\/ between the scripts\n\nwhen key space/);
  assert.match(tree['Stage/notes.fractch'], /\n\/\/ only a comment\n$/);
  assert.doesNotMatch(Object.values(tree).join('\n'), /comment "/);
  const { manifest } = await buildProjectFromBuildDir({ buildDir: out, fs, prune: false });
  const back = liveContext(manifest);
  const text = emitTarget(back, back.targets[0].id).text;
  assert.equal(text.replace(/ at -?\d+,-?\d+/g, ''), CODE);
});

test('a map without comments still reads, and unmapped comments stay after the declarations', async (t) => {
  const parsed = parseMembershipText(`${MEMBERSHIP_MAGIC}{"version":1,"scripts":{"h":"main"}}`);
  assert.deepEqual([...parsed], [['h', { region: null, module: null }]]);
  assert.equal(parsed.comments.size, 0);

  const mapText = `${MEMBERSHIP_MAGIC}{"version":1,"scripts":{"h":"main","k":"main"}}`;
  const comment = (text) => ({ blockId: null, x: 0, y: 0, width: 200, height: 200, minimized: false, text });
  const project = projectOf(
    stageTarget(
      {
        h: flag('s'),
        s: stmt('looks_say', 'h', { MESSAGE: [1, [10, 'a']] }),
        k: { ...flag('t'), opcode: 'event_whenthisspriteclicked', y: 300 },
        t: stmt('looks_say', 'k', { MESSAGE: [1, [10, 'b']] }),
      },
      { variables: { v: ['score', 0] }, comments: { m: { ...comment(mapText), minimized: true }, old: comment('old') } }
    )
  );
  const membership = readMembership(project.targets[0]);
  assert.equal(membership.authoritative, true);
  assert.equal(membership.commentEntryFor('old'), null);

  const ctx = liveContext(project);
  const emitted = emitTarget(ctx, ctx.targets[0].id);
  assert.match(emitted.text, /^var score = 0;\n\n\/\/ old\n\nwhen flag/);
  const out = tempDir(t);
  await convertProject(structuredClone(project), { outDir: out, fs });
  assert.match(bodyOf(readTree(out)['Stage/main.fractch']), /^var score = 0 id "v";\n\/\/ old\n\nwhen flag/);
});

test('membershipText writes the comments shape exactly', () => {
  const text = membershipText(
    [
      ['top1', { region: null, module: null }],
      ['top2', { region: 'enemies/boss', module: null }],
    ],
    [
      ['c1', { region: 'enemies/boss', before: 'top2' }],
      ['c2', { region: null, before: 'top1' }],
      ['c3', { region: 'main', before: null }],
    ]
  );
  assert.equal(
    text,
    `${MEMBERSHIP_MAGIC}{"version":1,"scripts":{"top1":"main","top2":"enemies/boss"},"comments":{"c1":{"region":"enemies/boss","before":"top2"},"c2":{"before":"top1"},"c3":{}}}`
  );
  const back = parseMembershipText(text);
  assert.deepEqual(
    [...back.comments],
    [
      ['c1', { region: 'enemies/boss', before: 'top2' }],
      ['c2', { region: null, before: 'top1' }],
      ['c3', { region: null, before: null }],
    ]
  );
  assert.equal(membershipText([['top1', { region: null, module: null }]]).includes('comments'), false);
});

test('unsafe comment regions fall back to main in a tree', async (t) => {
  const mapText = `${MEMBERSHIP_MAGIC}{"version":1,"scripts":{"h":"main"},"comments":{"c":{"region":"../escape","before":"h"}}}`;
  const project = projectOf(
    stageTarget(
      { h: flag('s'), s: stmt('looks_say', 'h', { MESSAGE: [1, [10, 'a']] }) },
      {
        comments: {
          m: { blockId: null, x: 0, y: 0, width: 200, height: 200, minimized: true, text: mapText },
          c: { blockId: null, x: 0, y: 0, width: 200, height: 200, minimized: false, text: 'kept' },
        },
      }
    )
  );
  const out = tempDir(t);
  await convertProject(project, { outDir: out, fs });
  const tree = readTree(out);
  assert.deepEqual(Object.keys(tree), ['Stage/main.fractch']);
  assert.match(tree['Stage/main.fractch'], /\/\/ kept\n\nwhen flag/);
});

test('a moved free comment goes through a tree as // and comes back in a default slot', async (t) => {
  const comment = (text, extra = {}) => ({
    blockId: null,
    x: 123,
    y: 456,
    width: 200,
    height: 200,
    minimized: false,
    text,
    ...extra,
  });
  const project = projectOf(
    stageTarget(
      { h: { ...flag('s'), y: 100 }, s: stmt('looks_say', 'h', { MESSAGE: [1, [10, 'a']] }) },
      {
        comments: {
          moved: comment('moved'),
          lines: comment('two\nlines', { x: -50, y: 9 }),
          big: comment('big', { width: 320, height: 90 }),
        },
      }
    )
  );
  const out = tempDir(t);
  await convertProject(structuredClone(project), { outDir: out, fs });
  const text = bodyOf(readTree(out)['Stage/main.fractch']);
  assert.equal(
    text,
    '// moved\n/*\n * two\n * lines\n */\ncomment "big" size 320x90;\n\nwhen flag at 0,100 {\n  say "a";\n}\n'
  );
  const { manifest } = await buildProjectFromBuildDir({ buildDir: out, fs, prune: false });
  const st = manifest.targets[0];
  const at = (text) => {
    const c = st.comments[commentIdByText(st, text)];
    return [c.x, c.y, c.width, c.height];
  };
  assert.deepEqual(at('moved'), [0, 244, 200, 200]);
  assert.deepEqual(at('two\nlines'), [0, 444, 200, 200]);
  assert.deepEqual(at('big'), [0, 644, 320, 90]);
  const again = tempDir(t);
  await convertProject(manifest, { outDir: again, fs });
  assert.equal(
    bodyOf(readTree(again)['Stage/main.fractch']).replace(/^costume .*\n\n/m, ''),
    text.replace(/\n(?=\/\*|comment)/g, '\n\n')
  );
});

test('the explicit comment form leaves out the default size and the parser fills it in', () => {
  const parsed = parseFractch('comment "a */ b\\nc";\ncomment "w" size 300x150 minimized;\n');
  assert.deepEqual(
    parsed.comments.map((c) => [c.text, c.width, c.height, !!c.minimized]),
    [
      ['a */ b\nc', 200, 200, false],
      ['w', 300, 150, true],
    ]
  );
});

test('Code mode leaves positions out of explicit comments and keeps the live ones', () => {
  const big = { blockId: null, x: 77, y: 88, width: 320, height: 90, minimized: false, text: 'big' };
  const ctx = liveContext(projectOf(stageTarget({ h: flag(null) }, { comments: { big } })));
  const id = ctx.targets[0].id;
  const emitted = emitTarget(ctx, id);
  assert.match(emitted.text, /^comment "big" size 320x90;\n/);
  const built = buildTarget(ctx, id, emitted.text, { previous: emitted });
  assert.strictEqual(built.target.comments.big, ctx.targets[0].comments.big);
  const resized = buildTarget(ctx, id, emitted.text.replace('320x90', '300x90'), { previous: emitted });
  assert.deepEqual(
    [resized.target.comments.big.x, resized.target.comments.big.y, resized.target.comments.big.width],
    [77, 88, 300]
  );
});

const HAT_CODE = [
  '// free note',
  '',
  '// boss moves',
  'when key space {',
  '  move 10;',
  '}',
  '',
  'region "enemies" {',
  '  /*',
  '   * spawns',
  '   * enemies',
  '   */',
  '  when flag {',
  '    say 1;',
  '  }',
  '}',
  '',
].join('\n');

test('simple hat comments are written above the when line and attach to the hat', () => {
  const { ctx, id } = freshStage();
  const first = applyText(ctx, id, HAT_CODE);
  const target = first.ctx.targets[0];
  const keyTop = topIdByOpcode(target, 'event_whenkeypressed');
  const flagTop = topIdByOpcode(target, 'event_whenflagclicked');
  assert.equal(target.comments[commentIdByText(target, 'boss moves')].blockId, keyTop);
  assert.equal(target.comments[commentIdByText(target, 'spawns\nenemies')].blockId, flagTop);
  assert.equal(target.comments[commentIdByText(target, 'free note')].blockId, null);
  assert.equal(target.blocks[keyTop].comment, commentIdByText(target, 'boss moves'));

  const emitted = emitTarget(first.ctx, id);
  assert.equal(emitted.text.replace(/ at -?\d+,-?\d+/g, ''), HAT_CODE);
  assert.doesNotMatch(emitted.text, /comment "/);
  const keyRange = emitted.sourceMap.scripts[keyTop];
  assert.ok(emitted.text.slice(keyRange.from, keyRange.to).startsWith('// boss moves\nwhen key space'));
  assert.ok(emitted.text.slice(keyRange.from, keyRange.to).endsWith('}'));
  const flagRange = emitted.sourceMap.scripts[flagTop];
  assert.ok(
    emitted.text.slice(flagRange.from, flagRange.to).startsWith('/*\n   * spawns\n   * enemies\n   */\n  when flag')
  );
  assert.equal(emitted.text.split('\n')[flagRange.line - 1], '  /*');

  const again = buildTarget(first.ctx, id, emitted.text, { previous: emitted });
  assert.deepEqual(errorsOf(again), []);
  assert.deepEqual(again.unchangedScripts.sort(), [keyTop, flagTop].sort());
  assert.deepEqual(again.created.comments, []);
  assert.deepEqual(again.removed.comments, []);
});

test('hat comments that are not simple stay in the body', () => {
  const project = projectOf(
    stageTarget(
      { h: { ...flag('s'), comment: 'c' }, s: stmt('looks_say', 'h', { MESSAGE: [1, [10, 'a']] }) },
      { comments: { c: { blockId: 'h', x: 0, y: 0, width: 300, height: 200, minimized: false, text: 'wide' } } }
    )
  );
  const ctx = liveContext(project);
  const emitted = emitTarget(ctx, ctx.targets[0].id);
  assert.match(emitted.text, /^when flag at 0,0 \{\n {2}comment "wide" size 300x200;\n {2}say "a";\n\}/);
});

test('a tree round trip keeps hat comments above the when line', async (t) => {
  const project = projectOf(
    stageTarget(
      {
        h: { ...flag('s'), opcode: 'event_whenkeypressed', fields: { KEY_OPTION: ['space', null] }, comment: 'c' },
        s: stmt('motion_movesteps', 'h', { STEPS: [1, [4, '10']] }),
        d: { ...flag('t'), y: 300, comment: 'm' },
        t: stmt('looks_say', 'd', { MESSAGE: [1, [10, 'a']] }),
      },
      {
        comments: {
          c: { blockId: 'h', x: 0, y: 0, width: 200, height: 200, minimized: false, text: 'boss moves' },
          m: { blockId: 'd', x: 0, y: 0, width: 200, height: 200, minimized: false, text: 'two\nlines' },
        },
      }
    )
  );
  const out = tempDir(t);
  await convertProject(structuredClone(project), { outDir: out, fs });
  const text = readTree(out)['Stage/main.fractch'];
  assert.doesNotMatch(text, /comment "/);
  assert.match(text, /\n\/\/ boss moves\nwhen key space at 0,0 \{\n {2}move 10;\n\}/);
  assert.match(text, /\n\/\*\n \* two\n \* lines\n \*\/\nwhen flag at 0,300 \{/);
  const { manifest } = await buildProjectFromBuildDir({ buildDir: out, fs, prune: false });
  const st = manifest.targets[0];
  const on = (text) => st.blocks[st.comments[commentIdByText(st, text)].blockId]?.opcode;
  assert.equal(on('boss moves'), 'event_whenkeypressed');
  assert.equal(on('two\nlines'), 'event_whenflagclicked');
  const again = tempDir(t);
  await convertProject(manifest, { outDir: again, fs });
  assert.equal(bodyOf(readTree(again)['Stage/main.fractch']).replace(/^costume .*\n\n/m, ''), bodyOf(text));
});

test('def comments stay as // inside the definition', async (t) => {
  const dir = writeFiles(tempDir(t), { 'Stage/main.fractch': 'def @f() {\n  // on def\n  say 2;\n}\n' });
  const { manifest } = await buildProjectFromBuildDir({ buildDir: dir, fs, prune: false });
  const out = tempDir(t);
  await convertProject(manifest, { outDir: out, fs });
  assert.match(readTree(out)['Stage/main.fractch'], /def @f\(\) at 0,0 \{\n {2}\/\/ on def\n {2}say 2;\n\}/);
});

function attachedProject(extra = {}) {
  const note = { blockId: 's', x: 412, y: -37, width: 200, height: 200, minimized: false, text: 'say it', ...extra };
  const hat = { blockId: 'h', x: 90, y: 15, width: 200, height: 200, minimized: false, text: 'on the hat' };
  return projectOf(
    stageTarget(
      {
        h: { ...flag('s'), comment: 'hc' },
        s: { ...stmt('looks_say', 'h', { MESSAGE: [1, [10, 'hi']] }, {}, 'm'), comment: 'n' },
        m: stmt('motion_movesteps', 's', { STEPS: [1, [4, '10']] }),
      },
      { comments: { n: note, hc: hat } }
    )
  );
}

test('attached comments with a position are written as // and keep their position in Code mode', () => {
  const ctx = liveContext(attachedProject());
  const id = ctx.targets[0].id;
  const live = ctx.targets[0];
  const emitted = emitTarget(ctx, id);
  assert.equal(emitted.text, '// on the hat\nwhen flag at 0,0 {\n  // say it\n  say "hi";\n  move 10;\n}\n');
  assert.deepEqual(emitted.lockedScripts, []);

  const same = buildTarget(ctx, id, emitted.text, { previous: emitted });
  assert.deepEqual(same.unchangedScripts, ['h']);
  assert.strictEqual(same.target.comments.n, live.comments.n);

  const edited = buildTarget(ctx, id, emitted.text.replace('move 10', 'move 20'), { previous: emitted });
  assert.deepEqual(errorsOf(edited), []);
  assert.deepEqual(edited.changed.length, 1);
  assert.deepEqual(
    [edited.target.comments.n.x, edited.target.comments.n.y, edited.target.comments.n.blockId],
    [412, -37, 's']
  );
  assert.deepEqual([edited.target.comments.hc.x, edited.target.comments.hc.y], [90, 15]);

  const retext = buildTarget(ctx, id, emitted.text.replace('// say it', '// say it loudly'), { previous: emitted });
  assert.deepEqual(errorsOf(retext), []);
  assert.deepEqual(
    [retext.target.comments.n.text, retext.target.comments.n.x, retext.target.comments.n.y],
    ['say it loudly', 412, -37]
  );
});

test('a resized attached comment keeps the explicit form without at', () => {
  const ctx = liveContext(attachedProject({ width: 300 }));
  const id = ctx.targets[0].id;
  const emitted = emitTarget(ctx, id);
  assert.match(emitted.text, /\n {2}say "hi";\n {2}comment "say it" size 300x200;\n {2}move 10;/);
  const edited = buildTarget(ctx, id, emitted.text.replace('move 10', 'move 20'), { previous: emitted });
  assert.deepEqual(
    [edited.target.comments.n.x, edited.target.comments.n.y, edited.target.comments.n.width],
    [412, -37, 300]
  );
});

test('attached comments with a position are written as // in trees', async (t) => {
  const out = tempDir(t);
  await convertProject(attachedProject(), { outDir: out, fs });
  const text = bodyOf(readTree(out)['Stage/main.fractch']);
  assert.equal(text, '// on the hat\nwhen flag at 0,0 {\n  // say it\n  say "hi";\n  move 10;\n}\n');
  const { manifest } = await buildProjectFromBuildDir({ buildDir: out, fs, prune: false });
  const st = manifest.targets[0];
  const n = st.comments[commentIdByText(st, 'say it')];
  assert.equal(st.blocks[n.blockId].opcode, 'looks_say');
  assert.deepEqual([n.x, n.y], [null, null]);
});

test('a hand-written at on an attached comment is still read', async (t) => {
  const source = 'when flag {\n  say "hi";\n  comment "placed" at 1,2;\n}\n';
  const dir = writeFiles(tempDir(t), { 'Stage/main.fractch': source });
  const { manifest } = await buildProjectFromBuildDir({ buildDir: dir, fs, prune: false });
  const st = manifest.targets[0];
  const c = st.comments[commentIdByText(st, 'placed')];
  assert.deepEqual([st.blocks[c.blockId].opcode, c.x, c.y], ['looks_say', 1, 2]);

  const { ctx, id } = freshStage();
  const built = applyText(ctx, id, source).built;
  const placed = Object.values(built.target.comments).find((x) => x.text === 'placed');
  assert.deepEqual([placed.x, placed.y], [1, 2]);
});

test('new attached comments have no position so the editor places them', () => {
  const { ctx, id } = freshStage();
  const source = '// on the hat\nwhen flag {\n  // on say\n  say 1;\n  move 10;\n}\n';
  const first = applyText(ctx, id, source);
  const comments = () => Object.values(first.ctx.targets[0].comments).filter((c) => c.blockId);
  assert.deepEqual(
    comments().map((c) => [c.text, c.x, c.y]),
    [
      ['on the hat', null, null],
      ['on say', null, null],
    ]
  );

  const emitted = emitTarget(first.ctx, id);
  assert.equal(emitted.text.replace(/ at -?\d+,-?\d+/, ''), source);
  const again = buildTarget(first.ctx, id, emitted.text, { previous: emitted });
  assert.deepEqual(again.changed, []);
  assert.equal(again.unchangedScripts.length, 1);
  const edited = buildTarget(first.ctx, id, emitted.text.replace('move 10', 'move 20'), { previous: emitted });
  assert.deepEqual(
    Object.values(edited.target.comments)
      .filter((c) => c.blockId)
      .map((c) => [c.x, c.y]),
    [
      [null, null],
      [null, null],
    ]
  );

  const placed = structuredClone(first.ctx.targets[0]);
  const sayNote = Object.keys(placed.comments).find((k) => placed.comments[k].text === 'on say');
  placed.comments[sayNote] = { ...placed.comments[sayNote], x: 250, y: 60 };
  const moved = { ...first.ctx, targets: [placed] };
  const fromBlocks = emitTarget(moved, id);
  const rebuilt = buildTarget(moved, id, fromBlocks.text.replace('move 10', 'move 30'), { previous: fromBlocks });
  assert.deepEqual([rebuilt.target.comments[sayNote].x, rebuilt.target.comments[sayNote].y], [250, 60]);
});

test('packed attached comments have no position unless the text gives one', async (t) => {
  const dir = writeFiles(tempDir(t), {
    'Stage/main.fractch': '// hat note\nwhen flag {\n  say 1;\n  comment "placed" at 5,6;\n}\n\n// free\n',
  });
  const { manifest } = await buildProjectFromBuildDir({ buildDir: dir, fs, prune: false });
  const st = manifest.targets[0];
  const pos = (text) => {
    const c = st.comments[commentIdByText(st, text)];
    return [c.x, c.y];
  };
  assert.deepEqual(pos('hat note'), [null, null]);
  assert.deepEqual(pos('placed'), [5, 6]);
  assert.deepEqual(pos('free'), [0, 144]);
});

test('consecutive // lines make one comment', () => {
  const src = [
    '// first line',
    '//   indented',
    '',
    '// boss',
    '// moves',
    'when key space {',
    '  say 1; // trailing',
    '  // above',
    '  // move',
    '  move 10;',
    '  /* block */',
    '  // line after block',
    '  think 2;',
    '}',
    '',
  ].join('\n');
  const parsed = parseFractch(src);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(
    parsed.comments.map((c) => c.text),
    ['first line\n  indented']
  );
  assert.deepEqual(
    parsed.scripts[0].calls.filter((c) => c.type === 'commentDecl').map((c) => [c.text, c.anchor]),
    [
      ['boss\nmoves', 'next'],
      ['trailing', 'prev'],
      ['above\nmove', 'next'],
      ['block', 'next'],
      ['line after block', 'next'],
    ]
  );
});

test('two // lines above a when become one hat comment and write back as /* */', () => {
  const { ctx, id } = freshStage();
  const first = applyText(ctx, id, '// a\n// b\nwhen flag {\n  say 1; // trailing\n}\n\n// c\n// d\n\n// e\n');
  const target = first.ctx.targets[0];
  const flagTop = topIdByOpcode(target, 'event_whenflagclicked');
  const byText = (text) => target.comments[commentIdByText(target, text)];
  assert.equal(byText('a\nb').blockId, flagTop);
  assert.equal(target.blocks[byText('trailing').blockId].opcode, 'looks_say');
  assert.equal(byText('c\nd').blockId, null);
  assert.equal(byText('e').blockId, null);
  const emitted = emitTarget(first.ctx, id);
  assert.match(emitted.text, /^\/\*\n \* a\n \* b\n \*\/\nwhen flag at 0,0 \{\n {2}\/\/ trailing\n {2}say 1;\n\}/);
  assert.match(emitted.text, /\n\/\*\n \* c\n \* d\n \*\/\n\n\/\/ e\n$/);
});

test('separate comments written next to each other stay separate', async (t) => {
  const plain = (text, extra = {}) => ({
    blockId: null,
    x: 0,
    y: 0,
    width: 200,
    height: 200,
    minimized: false,
    text,
    ...extra,
  });
  const project = projectOf(
    stageTarget(
      {
        h: { ...flag('s'), comment: 'h1' },
        s: { ...stmt('looks_say', 'h', { MESSAGE: [1, [10, 'hi']] }), comment: 'k1' },
        r: { ...stmt('motion_xposition', 's'), comment: 'k2' },
      },
      {
        comments: {
          f1: plain('one'),
          f2: plain('two'),
          f3: plain('has */ in it'),
          f4: plain('four'),
          h1: plain('hat', { blockId: 'h' }),
          k1: plain('on say', { blockId: 's' }),
          k2: plain('on reporter', { blockId: 'r' }),
        },
      }
    )
  );
  project.targets[0].blocks.s.inputs.MESSAGE = [3, 'r', [10, 'hi']];
  const out = tempDir(t);
  await convertProject(structuredClone(project), { outDir: out, fs });
  const text = bodyOf(readTree(out)['Stage/main.fractch']);
  assert.match(text, /^\/\* one \*\/\n\/\/ two\ncomment "has \*\/ in it";\n\/\/ four\n/);
  assert.match(text, /\n {2}\/\* on say \*\/\n {2}\/\/ on reporter\n {2}say /);
  const { manifest } = await buildProjectFromBuildDir({ buildDir: out, fs, prune: false });
  const texts = Object.values(manifest.targets[0].comments)
    .map((c) => c.text)
    .filter((x) => !x.startsWith(MEMBERSHIP_MAGIC))
    .sort();
  assert.deepEqual(texts, ['four', 'has */ in it', 'hat', 'on reporter', 'on say', 'one', 'two']);
});

test('an unclosed /* in Code mode is an error instead of deleting scripts', () => {
  const { ctx, id } = freshStage();
  const first = applyText(ctx, id, 'when key space {\n  move 10;\n}\n\nwhen flag {\n  say 1;\n}\n');
  const emitted = emitTarget(first.ctx, id);
  const broken = emitted.text.replace('when key space', '/* when key space');
  const built = buildTarget(first.ctx, id, broken, { previous: emitted });
  const err = errorsOf(built).find((d) => d.code === 'FR125');
  assert.ok(err, JSON.stringify(built.diagnostics));
  assert.equal(err.line, 1);
});

test('a comment alone in a C-block body attaches to the C-block', async (t) => {
  const source =
    'var x = 0;\nwhen flag {\n  if (x > 1) {\n    /*\n    say 1;\n    */\n  }\n  repeat 2 {\n    // later\n  }\n  think 2;\n}\n';
  const dir = writeFiles(tempDir(t), { 'Stage/main.fractch': source });
  const { manifest } = await buildProjectFromBuildDir({ buildDir: dir, fs, prune: false });
  const st = manifest.targets[0];
  const on = (text) => st.blocks[st.comments[commentIdByText(st, text)].blockId]?.opcode;
  assert.equal(on('say 1;'), 'control_if');
  assert.equal(on('later'), 'control_repeat');

  const { ctx, id } = freshStage();
  const built = applyText(ctx, id, source).built;
  const target = built.target;
  assert.equal(target.blocks[target.comments[commentIdByText(target, 'say 1;')].blockId].opcode, 'control_if');
  assert.equal(
    Object.values(target.comments).filter((c) => !c.blockId && !c.text.startsWith(MEMBERSHIP_MAGIC)).length,
    0
  );

  const nonEmpty = parseFractch('when flag {\n  if (x > 1) {\n    say 1;\n    // after say\n  }\n}\n');
  const { buildBlocksFromCalls, IdGen } = await import('../src/buildBlocks.js');
  const commentsOut = [];
  const { blocks } = buildBlocksFromCalls(nonEmpty.scripts[0].calls, { idGen: new IdGen(), commentsOut });
  assert.equal(blocks[commentsOut[0].blockId].opcode, 'looks_say');
});

test('old dslBodyHash headers are stripped but a user doc comment with pos: is kept', () => {
  const old = parseFractch(
    '/**\n * target: Stage\n * targetId: s\n * dslBodyHash: abc123\n */\n\nwhen flag {\n  say 1;\n}\n'
  );
  assert.deepEqual(old.errors, []);
  assert.deepEqual(old.comments, []);
  assert.equal(old.scripts[0].calls.filter((c) => c.type === 'commentDecl').length, 0);
  const index = parseFractch('/**\n * fractch index for target\n * scripts: 2\n */\n');
  assert.deepEqual(index.comments, []);
  const user = parseFractch('/** pos: 10,20 */\n\nwhen flag {\n  say 1;\n}\n');
  assert.deepEqual(
    user.comments.map((c) => c.text),
    ['pos: 10,20']
  );
});

test('default comment slots go below the bottom of the longest script', async (t) => {
  const long = Array.from({ length: 20 }, (_, i) => `  say ${i};`).join('\n');
  const source = `when flag at 0,0 {\n${long}\n}\n\nwhen key space at 300,100 {\n  say 1;\n}\n\n// note\n`;
  const dir = writeFiles(tempDir(t), { 'Stage/main.fractch': source });
  const { manifest } = await buildProjectFromBuildDir({ buildDir: dir, fs, prune: false });
  const st = manifest.targets[0];
  const note = st.comments[commentIdByText(st, 'note')];
  assert.deepEqual([note.x, note.y], [0, 21 * 48 + 48]);

  const { ctx, id } = freshStage();
  const built = applyText(ctx, id, source).built;
  const codeNote = Object.values(built.target.comments).find((c) => c.text === 'note');
  assert.deepEqual([codeNote.x, codeNote.y], [0, 21 * 48 + 48]);
});

test('a comment-only region keeps its place when a later region has comments', () => {
  const source = [
    'region "a" {',
    '  when flag {',
    '    say 1;',
    '  }',
    '}',
    '',
    'region "notes" {',
    '  // only notes',
    '}',
    '',
    'region "more" {',
    '  // more notes',
    '}',
    '',
    'region "b" {',
    '  // about b',
    '',
    '  when key space {',
    '    say 2;',
    '  }',
    '}',
    '',
  ].join('\n');
  const { ctx, id } = freshStage();
  const first = applyText(ctx, id, source);
  const emitted = emitTarget(first.ctx, id);
  assert.equal(emitted.text.replace(/ at -?\d+,-?\d+/g, ''), source);
  assert.deepEqual(Object.keys(emitted.sourceMap.regions), ['a', 'notes', 'more', 'b']);
});

test('a comment that has to be explicit does not let its neighbours join', async (t) => {
  const plain = (text, blockId) => ({ blockId, x: 0, y: 0, width: 200, height: 200, minimized: false, text });
  const project = projectOf(
    stageTarget(
      {
        h: { ...flag('s'), comment: 'h0' },
        s: { ...stmt('looks_say', 'h', { MESSAGE: [1, [10, 'hi']] }), comment: 's0' },
      },
      {
        comments: {
          h0: plain('h0', 'h'),
          h1: plain('x */ y', 'h'),
          h2: plain('h2', 'h'),
          s0: plain('c0', 's'),
          s1: plain('x */ z', 's'),
          s2: plain('c2', 's'),
        },
      }
    )
  );
  const out = tempDir(t);
  await convertProject(structuredClone(project), { outDir: out, fs });
  const text = bodyOf(readTree(out)['Stage/main.fractch']);
  assert.equal(
    text,
    '/* h0 */\n// h2\nwhen flag at 0,0 {\n  comment "x */ y";\n  /* c0 */\n  // c2\n  say "hi";\n  comment "x */ z";\n}\n'
  );
  const { manifest } = await buildProjectFromBuildDir({ buildDir: out, fs, prune: false });
  const st = manifest.targets[0];
  const on = (text) => st.blocks[st.comments[commentIdByText(st, text)].blockId].opcode;
  assert.deepEqual(['h0', 'x */ y', 'h2'].map(on), [
    'event_whenflagclicked',
    'event_whenflagclicked',
    'event_whenflagclicked',
  ]);
  assert.deepEqual(['c0', 'x */ z', 'c2'].map(on), ['looks_say', 'looks_say', 'looks_say']);
});
