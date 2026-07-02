import * as path from './pathUtils.js';
import { toPromiseFs } from './fsAdapter.js';
import { parseFractch, closestMatch } from './parse.js';
import { checkFractch } from './lint.js';

export async function checkProject({ buildDir, fs: fsLike }) {
  const vfs = toPromiseFs(fsLike);
  const problems = [];
  const files = await collectFractchFiles(vfs, buildDir);
  const sources = new Map();

  const perTarget = new Map();
  const targetState = (name) => {
    if (!perTarget.has(name)) perTarget.set(name, { defs: new Map(), calls: [] });
    return perTarget.get(name);
  };

  const push = (file, line, col, message, hint = null) => problems.push({ file, line, col, message, hint });

  for (const fPath of files) {
    const rel = path.relative(buildDir, fPath);
    const target = rel.split('/')[0];
    let text;
    try {
      text = String(await vfs.readFile(fPath, 'utf8'));
    } catch (e) {
      push(rel, 0, 0, `unreadable: ${e.message}`);
      continue;
    }
    sources.set(rel, text);

    for (const e of checkFractch(text)) {
      push(rel, e.line, e.col, e.message.replace(/ \(line \d+, col \d+\)$/, ''));
    }

    let parsed;
    try {
      parsed = parseFractch(text);
    } catch (e) {
      push(rel, 0, 0, `parse failed: ${e.message}`, e.hint || null);
      continue;
    }
    for (const err of parsed.errors || []) {
      push(rel, err.line, err.col ?? 0, `skipped unparsable statement: ${err.message}`, err.hint || null);
    }

    const st = targetState(target);
    for (const script of parsed.scripts || []) {
      const locals = new Set();
      collectScriptFacts(script.calls, rel, st, locals, push);
    }

    for (const decl of [...(parsed.assets?.costumes || []), ...(parsed.assets?.sounds || [])]) {
      const kind = parsed.assets.costumes.includes(decl) ? 'costume' : 'sound';
      const fileRel = String(decl.file || '');
      const abs = path.join(buildDir, target, ...fileRel.split('/').filter(Boolean));
      if (!fileRel) continue; // parse already complains
      if (!(await vfs.exists(abs))) {
        push(rel, decl.line ?? 0, 0, `${kind} "${decl.name}" points at a missing file: ${fileRel}`, `expected it at ${target}/${fileRel}`);
      }
    }
    checkDuplicateAssets(parsed.assets, rel, push);
  }

  for (const [, st] of perTarget) {
    for (const c of st.calls) {
      const def = st.defs.get(c.ident);
      if (!def) {
        const near = closestMatch(c.ident, [...st.defs.keys()], 3);
        push(c.file, c.line ?? 0, 0, `call to undefined custom block @${c.ident}${near ? ` - did you mean @${near}?` : ''}`,
          near ? null : 'define it with: def @' + c.ident + '(...) { ... }');
        continue;
      }
      if (c.argCount > def.paramCount) {
        push(c.file, c.line ?? 0, 0,
          `@${c.ident} takes ${def.paramCount} argument${def.paramCount === 1 ? '' : 's'} but this call passes ${c.argCount}`,
          `defined in ${def.file} as def @${c.ident}(${def.params.join(', ')})`);
      }
    }
  }

  problems.sort((a, b) => (a.file === b.file ? (a.line || 0) - (b.line || 0) : a.file < b.file ? -1 : 1));
  return { files: files.length, problems, sources };
}

function collectScriptFacts(nodes, file, st, locals, push) {
  for (const node of nodes || []) {
    if (!node) continue;
    if (node.type === 'localDecl') {
      if (locals.has(node.name)) {
        push(file, 0, 0, `local '${node.name}' is declared twice in the same script`,
          'a script has one namespace for locals; drop the second `local` or rename it');
      }
      locals.add(node.name);
      collectFromValue(node.value, file, st, locals, push);
      continue;
    }
    if (node.type === 'procDef') {
      if (st.defs.has(node.ident)) {
        push(file, 0, 0, `custom block @${node.ident} is defined more than once in this sprite`,
          `first definition in ${st.defs.get(node.ident).file}`);
      } else {
        st.defs.set(node.ident, { paramCount: node.params.length, params: node.params.map((p) => p.ident), file });
      }
      collectScriptFacts(node.body, file, st, locals, push);
      continue;
    }
    if (node.type !== 'call') continue;
    if (node.callee?.type === 'procedureCall') {
      st.calls.push({ ident: node.callee.name, line: node.callee.line ?? 0, argCount: node.args.length, file });
    }
    for (const a of node.args || []) {
      if (a.kind === 'branch') collectScriptFacts(a.body, file, st, locals, push);
      else if (a.kind === 'keyed' || a.kind === 'positional') collectFromValue(a.value, file, st, locals, push);
    }
  }
}

function collectFromValue(v, file, st, locals, push) {
  if (!v) return;
  if (v.type === 'call') collectScriptFacts([v.value], file, st, locals, push);
  else if (v.type === 'obscured') {
    collectFromValue(v.active, file, st, locals, push);
    collectFromValue(v.shadow, file, st, locals, push);
  }
}

function checkDuplicateAssets(assets, file, push) {
  for (const [kind, list] of [['costume', assets?.costumes || []], ['sound', assets?.sounds || []]]) {
    const seen = new Set();
    for (const d of list) {
      const name = String(d.name ?? '');
      if (seen.has(name)) {
        push(file, 0, 0, `two ${kind}s are both named "${name}"`, 'Scratch identifies costumes/sounds by name - rename one');
      }
      seen.add(name);
    }
  }
}

async function collectFractchFiles(vfs, dir, out = []) {
  let entries;
  try {
    entries = await vfs.readdir(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.startsWith('.')) continue;
    const p = path.join(dir, e);
    if (await vfs.isDirectory(p)) {
      if (e === 'assets' || e === 'extensions') continue;
      await collectFractchFiles(vfs, p, out);
    } else if (e.endsWith('.fractch')) {
      out.push(p);
    }
  }
  return out;
}
