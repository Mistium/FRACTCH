import * as path from './pathUtils.js';
import { toPromiseFs } from './fsAdapter.js';
import { parseFractch, closestMatch } from './parse.js';
import { checkFractch } from './lint.js';
import { assetSourceRel } from './pack.js';
import { LIST_METHOD_OPS } from './buildBlocks.js';
import { KNOWN_OPCODES, MENU_OPCODES, VALIDATED_NAMESPACES } from './knownOpcodes.js';
import { STDLIB_METHODS, STDLIB_MODULE_META } from './stdlib/index.js';

export async function checkProject({ buildDir, fs: fsLike }) {
  const vfs = toPromiseFs(fsLike);
  const problems = [];
  const sources = new Map();
  if (!(await vfs.exists(buildDir))) {
    return {
      files: 0,
      problems: [
        {
          file: '.',
          line: 0,
          col: 0,
          fatal: true,
          message: `project directory does not exist: ${buildDir}`,
          hint: 'pass the directory that contains target folders such as Stage/',
        },
      ],
      sources,
    };
  }
  if (!(await vfs.isDirectory(buildDir))) {
    return {
      files: 0,
      problems: [
        {
          file: '.',
          line: 0,
          col: 0,
          fatal: true,
          message: `project path is not a directory: ${buildDir}`,
          hint: 'pass a project directory, not a .fractch or .sb3 file',
        },
      ],
      sources,
    };
  }
  const strays = [];
  const files = await collectFractchFiles(vfs, buildDir, [], strays);
  for (const stray of strays) {
    problems.push({
      file: path.relative(buildDir, stray),
      line: 0,
      col: 0,
      message: 'pack ignores .fractch files at the project root',
      hint: 'move it into a target folder such as Stage/',
    });
  }
  if (files.length === 0) {
    return {
      files: 0,
      problems: [
        ...problems,
        {
          file: '.',
          line: 0,
          col: 0,
          fatal: true,
          message: 'project contains no .fractch files in target folders',
          hint: 'add a target script such as Stage/main.fractch',
        },
      ],
      sources,
    };
  }

  const perTarget = new Map();
  const targetState = (name) => {
    if (!perTarget.has(name))
      perTarget.set(name, {
        defs: new Map(),
        calls: [],
        vars: new Set(),
        lists: new Set(),
        methodUses: [],
        packages: {},
      });
    return perTarget.get(name);
  };

  const push = (file, line, col, message, hint = null) => problems.push({ file, line, col, message, hint });
  const pushFatal = (file, line, col, message, hint = null) =>
    problems.push({ file, line, col, message, hint, fatal: true });

  for (const fPath of files) {
    const rel = path.relative(buildDir, fPath);
    const target = rel.split('/')[0];
    let text;
    try {
      text = String(await vfs.readFile(fPath, 'utf8'));
    } catch (e) {
      pushFatal(rel, 0, 0, `unreadable: ${e.message}`);
      continue;
    }
    sources.set(rel, text);

    for (const e of checkFractch(text)) {
      pushFatal(rel, e.line, e.col, e.message.replace(/ \(line \d+, col \d+\)$/, ''));
    }

    let parsed;
    try {
      parsed = parseFractch(text);
    } catch (e) {
      pushFatal(rel, 0, 0, `parse failed: ${e.message}`, e.hint || null);
      continue;
    }
    for (const err of parsed.errors || []) {
      pushFatal(rel, err.line, err.col ?? 0, `skipped unparsable statement: ${err.message}`, err.hint || null);
    }

    const st = targetState(target);
    for (const d of parsed.varDecls || []) (d.isList ? st.lists : st.vars).add(d.name);
    Object.assign(st.packages, parsed.importNamespaces || {});
    for (const script of parsed.scripts || []) {
      const locals = new Set();
      collectScriptFacts(script.calls, rel, st, locals, push);
    }

    for (const decl of [...(parsed.assets?.costumes || []), ...(parsed.assets?.sounds || [])]) {
      const kind = parsed.assets.costumes.includes(decl) ? 'costume' : 'sound';
      const fileRel = String(decl.file || '');
      if (!fileRel) continue;
      const sourceRel = assetSourceRel(target, fileRel);
      if (!sourceRel) {
        push(
          rel,
          decl.line ?? 0,
          0,
          `${kind} "${decl.name}" has an invalid file path: ${fileRel}`,
          'asset paths are relative to the target folder and may not contain .. or hidden segments'
        );
        continue;
      }
      const abs = path.join(buildDir, sourceRel);
      if (!(await vfs.exists(abs))) {
        push(
          rel,
          decl.line ?? 0,
          0,
          `${kind} "${decl.name}" points at a missing file: ${fileRel}`,
          `expected it at ${target}/${fileRel}`
        );
      }
    }
    checkDuplicateAssets(parsed.assets, rel, push);
  }

  const stage = perTarget.get('Stage');
  for (const [, st] of perTarget) {
    for (const u of st.methodUses) {
      const pkgId = st.packages[u.ident];
      const pkgMeta = pkgId && STDLIB_MODULE_META[pkgId];
      if (pkgMeta) {
        if (!pkgMeta.defs.has(`${pkgMeta.defPrefix}${u.method}`)) {
          const methods = [...pkgMeta.defs].map((d) => d.slice(pkgMeta.defPrefix.length));
          const near = closestMatch(u.method, methods, 3);
          push(
            u.file,
            u.line,
            0,
            `package '${u.ident}' has no function '.${u.method}(...)'${near ? ` - did you mean '.${near}'?` : ''}`,
            `${pkgId} exports: ${methods.map((m) => `.${m}`).join(' ')}`
          );
        }
        continue;
      }
      const isList = st.lists.has(u.ident) || stage?.lists.has(u.ident);
      const isVar = st.vars.has(u.ident) || stage?.vars.has(u.ident);
      if (!isList && !isVar && !u.local && VALIDATED_NAMESPACES.has(u.ident)) {
        checkOpcodeUse(`${u.ident}_${u.method}`, u.line, u.file, !!u.stmt, push);
        continue;
      }
      if (isList && !LIST_METHOD_OPS[u.method]) {
        const near = closestMatch(u.method, Object.keys(LIST_METHOD_OPS), 3);
        push(
          u.file,
          u.line,
          0,
          `list '${u.ident}' has no method '.${u.method}(...)'${near ? ` - did you mean '.${near}'?` : ''}`,
          'use list functions: append(list, v), delete(list, i), insert(list, i, v), replace(list, i, v), set(list, i, v), clear(list), get(list, i), item(list, i), hasItem(list, v), indexOf(list, v)'
        );
      } else if (isVar && !isList && !STDLIB_METHODS[u.method] && u.method !== 'letter') {
        const near = closestMatch(u.method, ['letter', ...Object.keys(STDLIB_METHODS)], 3);
        push(
          u.file,
          u.line,
          0,
          `'${u.ident}' is a variable and has no method '.${u.method}(...)'${near ? ` - did you mean '.${near}'?` : ''}`,
          'variables only have .letter(i); string helpers live in packages, e.g. import "fractch/strings" then strings.replace(...)'
        );
      }
    }
    for (const c of st.calls) {
      const def = st.defs.get(c.ident);
      if (!def) {
        const near = closestMatch(c.ident, [...st.defs.keys()], 3);
        push(
          c.file,
          c.line ?? 0,
          0,
          `call to undefined custom block @${c.ident}${near ? ` - did you mean @${near}?` : ''}`,
          near ? null : 'define it with: def @' + c.ident + '(...) { ... }'
        );
        continue;
      }
      if (c.argCount !== def.paramCount) {
        push(
          c.file,
          c.line ?? 0,
          0,
          `@${c.ident} takes ${def.paramCount} argument${def.paramCount === 1 ? '' : 's'} but this call passes ${c.argCount}`,
          `defined in ${def.file}:${def.line || 1} as def @${c.ident}(${def.params.join(', ')})`
        );
      }
    }
  }

  problems.sort((a, b) => (a.file === b.file ? (a.line || 0) - (b.line || 0) : a.file < b.file ? -1 : 1));
  return { files: files.length, problems, sources };
}

const opcodeNamespace = (opcode) => {
  const m = /^([A-Za-z][A-Za-z0-9]*)_/.exec(opcode);
  return m ? m[1] : null;
};

const BARE_VALUE_OPCODE = '__bare_value';

const dottedOpcode = (opcode) => {
  const ns = opcodeNamespace(opcode);
  return ns ? `${ns}.${opcode.slice(ns.length + 1)}` : opcode;
};

function checkOpcodeUse(opcode, line, file, stmt, push) {
  const ns = opcodeNamespace(opcode);
  if (ns && !VALIDATED_NAMESPACES.has(ns)) return;
  if (!KNOWN_OPCODES.has(opcode)) {
    if (opcode === BARE_VALUE_OPCODE) {
      push(
        file,
        line,
        0,
        `this statement is just a value, not a block`,
        'a bare name or expression on its own line is not something Scratch can run - did you mean to assign it, or call a block?'
      );
      return;
    }
    const near = ns
      ? closestMatch(
          opcode.slice(ns.length + 1),
          [...KNOWN_OPCODES].filter((o) => o.startsWith(`${ns}_`)).map((o) => o.slice(ns.length + 1)),
          3
        )
      : closestMatch(opcode, [...KNOWN_OPCODES], 3);
    const suggestion = near ? `, did you mean '${ns ? `${ns}.${near}` : dottedOpcode(near)}'?` : '';
    push(
      file,
      line,
      0,
      `unknown block '${dottedOpcode(opcode)}'${ns ? ` - no ${ns} block has that name` : ''}${suggestion}`,
      'unknown opcodes load as broken red blocks in the editor'
    );
    return;
  }
  if (stmt && MENU_OPCODES.has(opcode)) {
    push(
      file,
      line,
      0,
      `'${dottedOpcode(opcode)}' is a dropdown menu, not a standalone block`,
      `menus only work inside another block's input, like sensing.keypressed(sensing.keyoptions("space")); on its own it becomes a detached floating menu in the editor`
    );
  }
}

function collectScriptFacts(nodes, file, st, locals, push, stmt = true) {
  for (const node of nodes || []) {
    if (!node) continue;
    if (node.type === 'localDecl') {
      if (locals.has(node.name)) {
        push(
          file,
          node.line ?? 0,
          0,
          `local '${node.name}' is declared twice in the same script`,
          'a script has one namespace for locals; drop the second `local` or rename it'
        );
      }
      locals.add(node.name);
      collectFromValue(node.value, file, st, locals, push);
      continue;
    }
    if (node.type === 'procDef') {
      if (st.defs.has(node.ident)) {
        const first = st.defs.get(node.ident);
        push(
          file,
          node.line ?? 0,
          0,
          `custom block @${node.ident} is defined more than once in this sprite`,
          `first definition is at ${first.file}:${first.line || 1}`
        );
      } else {
        st.defs.set(node.ident, {
          paramCount: node.params.length,
          params: node.params.map((p) => p.ident),
          file,
          line: node.line ?? 0,
        });
      }
      const bodyScope = new Set([...locals, ...node.params.map((p) => p.ident)]);
      collectScriptFacts(node.body, file, st, bodyScope, push);
      continue;
    }
    if (node.type !== 'call') continue;
    if (node.callee?.type === 'procedureCall') {
      st.calls.push({ ident: node.callee.name, line: node.callee.line ?? 0, argCount: node.args.length, file });
    }
    if (node.callee?.type === 'identOrMethod') {
      st.methodUses.push({
        ident: node.callee.ident,
        method: node.callee.method,
        line: node.callee.line ?? 0,
        file,
        stmt,
        local: locals.has(node.callee.ident),
      });
    }
    if (node.callee?.type === 'opcode') {
      checkOpcodeUse(node.callee.name, node.callee.line ?? 0, file, stmt, push);
    }
    for (const a of node.args || []) {
      if (a.kind === 'branch') collectScriptFacts(a.body, file, st, locals, push);
      else if (a.kind === 'keyed' || a.kind === 'positional') collectFromValue(a.value, file, st, locals, push);
    }
  }
}

function collectFromValue(v, file, st, locals, push) {
  if (!v) return;
  if (v.type === 'call') collectScriptFacts([v.value], file, st, locals, push, false);
  else if (v.type === 'obscured') {
    collectFromValue(v.active, file, st, locals, push);
    collectFromValue(v.shadow, file, st, locals, push);
  }
}

function checkDuplicateAssets(assets, file, push) {
  for (const [kind, list] of [
    ['costume', assets?.costumes || []],
    ['sound', assets?.sounds || []],
  ]) {
    const seen = new Set();
    for (const d of list) {
      const name = String(d.name ?? '');
      if (seen.has(name)) {
        push(
          file,
          d.line ?? 0,
          0,
          `two ${kind}s are both named "${name}"`,
          'Scratch identifies costumes/sounds by name - rename one'
        );
      }
      seen.add(name);
    }
  }
}

// The files pack reads: target folders only (assets/ and extensions/ at the root are
// reserved), minus *.ignore.fractch and files marked fractch:ignore near the top.
// Other .fractch files at the root are never packed; they're returned as strays.
async function collectFractchFiles(vfs, dir, out = [], strays = [], depth = 0) {
  let entries;
  try {
    entries = (await vfs.readdir(dir)).slice().sort();
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.startsWith('.')) continue;
    const p = path.join(dir, e);
    if (await vfs.isDirectory(p)) {
      if (depth === 0 && (e === 'assets' || e === 'extensions')) continue;
      await collectFractchFiles(vfs, p, out, strays, depth + 1);
    } else if (e.endsWith('.fractch') && !e.endsWith('.ignore.fractch')) {
      if (depth === 0) {
        if (e !== 'index.fractch') strays.push(p);
        continue;
      }
      let head = '';
      try {
        head = String(await vfs.readFile(p, 'utf8')).slice(0, 512);
      } catch {
        head = '';
      }
      if (/\bfractch:ignore\b/.test(head)) continue;
      out.push(p);
    }
  }
  return out;
}
