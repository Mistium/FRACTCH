import fs from 'fs';
import path from 'path';
import { emitScriptFile, emitIndex, emitTargetIndex } from './emit.js';
import { groupTopLevelScripts, collectBlocksSubgraph } from './graph.js';

export function convertProject(projectJson, { outDir }) {
  const targets = projectJson.targets || [];
  const files = [];

  const broadcastMap = new Map(); // name -> [{ targetName, topBlockId }]
  const proceduresMap = new Map(); // targetName -> Map(proccode -> defTopBlockId)
  const procedureDefsByTarget = new Map(); // targetName -> Map(defTopBlockId -> proccode)
  const procByCode = buildProcByCode(targets); // proccode -> { ident, params: [{id, ident}] }

  for (const target of targets) {
    const pMap = new Map();
    const defIdToProc = new Map();
    const blocks = target.blocks || {};
    for (const [id, b] of Object.entries(blocks)) {
      if (!b || b.opcode !== 'procedures_definition' || b.parent) continue;
      const protoId = b.inputs?.custom_block?.[1];
      const proto = protoId ? blocks[protoId] : undefined;
      const proccode = proto?.mutation?.proccode || proto?.fields?.PROCCODE?.[0] || null;
      if (proccode) {
        pMap.set(proccode, id);
        defIdToProc.set(id, proccode);
      }
    }
    proceduresMap.set(target.name, pMap);
    procedureDefsByTarget.set(target.name, defIdToProc);

    for (const [id, b] of Object.entries(blocks)) {
      if (!b || b.parent) continue;
      if (b.opcode === 'event_whenbroadcastreceived') {
        const name = (b.fields && b.fields.BROADCAST_OPTION && b.fields.BROADCAST_OPTION[0]) || null;
        if (name) {
          if (!broadcastMap.has(name)) broadcastMap.set(name, []);
          broadcastMap.get(name).push({ targetName: target.name, topBlockId: id });
        }
      }
    }
  }

  for (const target of targets) {
    const tDir = path.join(outDir, sanitize(target.name));
    fs.mkdirSync(tDir, { recursive: true });

    const scripts = groupTopLevelScripts(target);
    let idx = 0;
    const usedNames = new Set();
    for (const script of scripts) {
      const { topBlockId, hatOpcode } = script;
      const top = target.blocks?.[topBlockId];
      if (top?.shadow) continue; // safety: skip any top-level shadow
      const subgraph = collectBlocksSubgraph(target.blocks, topBlockId);
      const hatDir = path.join(tDir, sanitize(hatOpcode || 'nohat'));
      fs.mkdirSync(hatDir, { recursive: true });

      const procLabel =
        hatOpcode === 'procedures_definition' ? procedureDefsByTarget.get(target.name)?.get(topBlockId) || null : null;
      const baseRaw = procLabel || topBlockId || 'top';
      let base = sanitize(baseRaw);
      let filename = `${base}.fractch`;

      let counter = 1;
      while (usedNames.has(path.join(hatDir, filename))) {
        filename = `${base}_${counter++}.fractch`;
      }
      usedNames.add(path.join(hatDir, filename));
      const filePath = path.join(hatDir, filename);
      const content = emitScriptFile({
        target,
        script,
        subgraph,
        index: idx++,
        context: { broadcastMap, proceduresMap, procByCode },
      });
      fs.writeFileSync(filePath, content);
      const rel = `./${sanitize(target.name)}/${sanitize(hatOpcode || 'nohat')}/${filename}`;
      const label = procLabel;
      files.push({
        target: target.name,
        hatOpcode: hatOpcode || 'nohat',
        filePath,
        rel,
        label,
      });
    }

    const tIndex = emitTargetIndex(files.filter((f) => f.target === target.name));
    fs.writeFileSync(path.join(tDir, 'index.fractch'), tIndex);
  }

  const indexContent = emitIndex(files);

  return {
    filesWritten: files.length + (targets.length || 0) + 1,
    manifest: projectJson,
    indexContent,
  };
}

function sanitize(name) {
  return String(name).replace(/[^a-zA-Z0-9-_]/g, '_');
}

function cleanIdent(label) {
  const stripped = String(label).replace(/%[snb]/g, ' ').replace(/\s+/g, ' ').trim();
  const id = stripped.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return id || 'proc';
}

export function buildProcByCode(targets) {
  const map = new Map();
  for (const target of targets) {
    const blocks = target.blocks || {};
    for (const b of Object.values(blocks)) {
      if (!b || b.opcode !== 'procedures_prototype') continue;
      const proccode = b.mutation?.proccode;
      if (!proccode || map.has(proccode)) continue;
      let ids = [];
      let names = [];
      try { ids = JSON.parse(b.mutation?.argumentids || '[]'); } catch {}
      try { names = JSON.parse(b.mutation?.argumentnames || '[]'); } catch {}
      const params = ids.map((id, i) => ({ id, ident: cleanIdent(names[i] ?? `arg${i}`) }));
      map.set(proccode, { ident: cleanIdent(proccode), params, label: proccode });
    }
  }
  return map;
}
