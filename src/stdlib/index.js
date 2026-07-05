import { JSON_SOURCE } from './json.js';
import { STRINGS_SOURCE } from './strings.js';

export const STDLIB_STEM_PREFIX = 'fractch_lib/';

// Local copy of buildBlocks' synthesizeProccode (importing it would create a
// parse -> stdlib -> buildBlocks -> parse module cycle). Keep in sync.
function synthesizeProccode(ident, paramCount) {
  const label = String(ident).trim() || 'proc';
  return paramCount ? `${label} ${Array(paramCount).fill('%s').join(' ')}` : label;
}

export const STDLIB_MODULES = {
  'fractch/json': { deps: [], source: JSON_SOURCE },
  'fractch/strings': { deps: [], source: STRINGS_SOURCE },
};

export const STDLIB_METHODS = {};

// proccode -> method name, for re-sugaring procedures_call blocks on emission.
export const STDLIB_PROCCODE_TO_METHOD = new Map(
  Object.entries(STDLIB_METHODS).map(([method, m]) => [synthesizeProccode(m.ident, m.argc), method])
);

// Package namespace metadata: `import "fractch/json"` binds the namespace
// `json`, whose defs are named `fractch_json_<method>`. `json.get_from(...)`
// resolves to the def `fractch_json_get_from`. Def idents are scraped from the
// source (regex, not a parse - importing parse here would cycle).
function moduleDefIdents(source) {
  const out = new Set();
  const re = /def\s+@([A-Za-z0-9_]+)/g;
  let m;
  while ((m = re.exec(source))) out.add(m[1]);
  return out;
}

export const STDLIB_MODULE_META = Object.fromEntries(
  Object.entries(STDLIB_MODULES).map(([id, mod]) => [id, {
    namespace: id.split('/').pop(),
    defPrefix: id.replace(/\//g, '_') + '_',
    defs: moduleDefIdents(mod.source),
  }])
);

// def ident -> { namespace, method }, for re-sugaring a package def's
// procedures_call back to `namespace.method(...)` on emission.
export const STDLIB_DEF_TO_PACKAGE = new Map();
for (const [, meta] of Object.entries(STDLIB_MODULE_META)) {
  for (const ident of meta.defs) {
    if (ident.startsWith(meta.defPrefix)) {
      STDLIB_DEF_TO_PACKAGE.set(ident, { namespace: meta.namespace, method: ident.slice(meta.defPrefix.length) });
    }
  }
}

// Resolve a `namespace.method(...)` call against imported packages. `imports`
// maps a namespace (import alias or last path segment) to a module id. Returns
// the target def ident when the package exports that method, else null.
export function resolvePackageMethod(imports, namespace, method) {
  const moduleId = imports && imports[namespace];
  if (!moduleId) return null;
  const meta = STDLIB_MODULE_META[moduleId];
  if (!meta) return null;
  const ident = `${meta.defPrefix}${method}`;
  return meta.defs.has(ident) ? { moduleId, ident } : { moduleId, ident: null };
}

// Expand a module list to include dependencies, in injection order.
export function resolveStdlibModules(ids) {
  const out = [];
  const seen = new Set();
  const visit = (id) => {
    if (seen.has(id) || !STDLIB_MODULES[id]) return;
    seen.add(id);
    for (const dep of STDLIB_MODULES[id].deps) visit(dep);
    out.push(id);
  };
  for (const id of ids || []) visit(id);
  return out;
}
