import * as path from './pathUtils.js';
import { toPromiseFs } from './fsAdapter.js';
import { parseFractch } from './parse.js';
import { checkFractch } from './lint.js';

export async function checkProject({ buildDir, fs: fsLike }) {
  const vfs = toPromiseFs(fsLike);
  const problems = [];
  const files = await collectFractchFiles(vfs, buildDir);

  const defs = new Set();
  const calls = [];

  for (const fPath of files) {
    const rel = path.relative(buildDir, fPath);
    let text;
    try {
      text = String(await vfs.readFile(fPath, 'utf8'));
    } catch (e) {
      problems.push({ file: rel, line: 0, message: `unreadable: ${e.message}` });
      continue;
    }
    for (const e of checkFractch(text)) {
      problems.push({ file: rel, line: e.line, message: e.message.replace(/ \(line \d+, col \d+\)$/, '') });
    }
    let parsed;
    try {
      parsed = parseFractch(text);
    } catch (e) {
      problems.push({ file: rel, line: 0, message: `parse failed: ${e.message}` });
      continue;
    }
    for (const err of parsed.errors || []) {
      problems.push({ file: rel, line: err.line, message: `skipped unparsable statement: ${err.message}` });
    }
    collectProcUsage(parsed.calls, rel, defs, calls);
  }

  for (const c of calls) {
    if (!defs.has(c.ident)) {
      problems.push({ file: c.file, line: 0, message: `call to undefined custom block @${c.ident}` });
    }
  }

  problems.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
  return { files: files.length, problems };
}

function collectProcUsage(nodes, file, defs, calls) {
  for (const node of nodes || []) {
    if (!node) continue;
    if (node.type === 'procDef') {
      defs.add(node.ident);
      collectProcUsage(node.body, file, defs, calls);
      continue;
    }
    if (node.type !== 'call') continue;
    if (node.callee?.type === 'procedureCall') calls.push({ ident: node.callee.name, file });
    for (const a of node.args || []) {
      if (a.kind === 'branch') collectProcUsage(a.body, file, defs, calls);
      else if (a.kind === 'keyed' || a.kind === 'positional') collectFromValue(a.value, file, defs, calls);
    }
  }
}

function collectFromValue(v, file, defs, calls) {
  if (!v) return;
  if (v.type === 'call') collectProcUsage([v.value], file, defs, calls);
  else if (v.type === 'obscured') {
    collectFromValue(v.active, file, defs, calls);
    collectFromValue(v.shadow, file, defs, calls);
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
