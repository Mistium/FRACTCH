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

test('an unterminated /* and comment markers inside strings are not comments', () => {
  const open = parseFractch('when flag {\n  say 1;\n}\n/* never closed\nsay 2;\n');
  assert.deepEqual(open.errors, []);
  assert.deepEqual(open.comments, []);
  assert.equal(open.scripts.length, 1);
  assert.ok(parseFractch('when flag {\n  say 1; /* open\n}\n').errors.length > 0);

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
  assert.equal(freeCommentText({ ...simple('moved'), x: 5, y: 6 }), 'comment "moved" at 5,6;');
  assert.equal(freeCommentText({ ...simple('big'), width: 300, height: 150 }), 'comment "big" size 300x150;');
  assert.equal(
    freeCommentText({ ...simple('tiny'), minimized: true }, { ignorePosition: true }),
    'comment "tiny" minimized;'
  );
  assert.equal(freeCommentText({ ...simple('moved'), x: 5, y: 6 }, { ignorePosition: true }), '// moved');

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
      [0, 600],
      [0, 800],
      [0, 1000],
      [0, 1200],
      [0, 1400],
      [0, 1600],
      [0, 1800],
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
  assert.deepEqual(at('moved'), [0, 300, 200, 200]);
  assert.deepEqual(at('two\nlines'), [0, 500, 200, 200]);
  assert.deepEqual(at('big'), [0, 700, 320, 90]);
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
