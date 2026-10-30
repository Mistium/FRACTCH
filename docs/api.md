# Programmatic API

```sh
npm install fractch
```

## Node

```js
import { unpackSb3, packSb3, checkProject } from 'fractch';

await unpackSb3({ input: './project.sb3', outDir: './project' });

await packSb3({
  buildDir: './project',
  outSb3: './out.sb3',
  originSb3: './project.sb3', // optional: source for non-asset extras
  verbose: true,
});

const { files, problems } = await checkProject({ buildDir: './project' });
// problems: [{ severity, code, file, line, column, message, hint }]
```

## Browser

The package's `browser` export condition resolves to a build with no Node built-ins (also importable explicitly as `fractch/browser`). Every filesystem-touching function takes an `fs` option accepting any node-style or promises-style filesystem; [lightning-fs](https://github.com/isomorphic-git/lightning-fs) works directly:

```js
import LightningFS from '@isomorphic-git/lightning-fs';
import { convertProject, buildProjectFromBuildDir } from 'fractch';

const fs = new LightningFS('fractch');

// projectJson = parsed project.json from an .sb3 (unzip with fflate/jszip/...)
await convertProject(projectJson, { outDir: '/project', fs });

// ...edit the .fractch files in the in-memory fs...

const { manifest, assetFiles } = await buildProjectFromBuildDir({ buildDir: '/project', fs });
// `manifest` is a complete project.json object; zip it with the asset files
// (assetFiles maps md5ext -> buildDir-relative source path).
```

Zip handling stays outside the browser core on purpose: use whatever zip library your app already has. In Node, `unpackSb3`/`packSb3` wrap the same core with adm-zip.

## Whole projects

`projectToFiles` and `filesToProject` turn a project into the files of a project folder and back, in memory, with no filesystem or zip library. They cover everything in [projects.md](projects.md): scripts, costumes and sounds, embedded extensions, custom assets, fonts and `fractch.json`. They work the same in Node and the browser.

```js
import { projectToFiles, filesToProject, verifyProjectFiles } from 'fractch';

// readAsset(md5ext) returns the asset's bytes (or a promise of them), or null
const { files, diagnostics } = await projectToFiles({ projectJson, readAsset });
// files: Map<'Player/main.fractch' | 'Player/assets/walk.svg' | ..., Uint8Array>

const { projectJson: rebuilt, assets } = await filesToProject(files);
// assets: Map<md5ext, Uint8Array>, every file the rebuilt project.json refers to

const { ok, differences } = await verifyProjectFiles({ projectJson, readAsset });
// differences: [{ target: 'Player', path: 'sprite "Player".scripts', message: 'The script at 40, 80 would change.', detail }]
```

`filesToProject` skips unsafe paths (`..`, absolute paths, dot folders) and the `.git/` folder and `mwp.json` of an `.mwp`, so a zip's entries can be passed straight in. `compareProjects(before, after, { readBefore, readAfter })` is the comparison `verifyProjectFiles` uses, for any two project.json objects. `projectAssetPaths(projectJson)` maps each costume and sound file path to its md5ext without reading any bytes. `memoryFs(entries)` is the in-memory filesystem behind them, usable with every function that takes an `fs`.

In Node, `readArchive(path)` returns a zip's entries as a `Map`, and `unpackSb3`/`packSb3` accept `.mwp` files on either side.

## Lower-level exports

For tools that work on `.fractch` text or Scratch block JSON directly:

| Export | What it does |
|---|---|
| `parseFractch(text)` | text → `{ scripts, calls, assets, errors }` |
| `buildBlocksFromCalls(calls, ctx)` | call tree → Scratch block JSON (`{ topId, blocks }`) |
| `convertProject(projectJson, { outDir, fs })` | project.json → build dir of `.fractch` files |
| `buildProjectFromBuildDir({ buildDir, fs })` | build dir → rebuilt project.json |
| `checkFractch(text)` / `assertValidFractch(text)` | delimiter/string lint |
| `emitScriptFile` / `stringifyBlockCall` / `renderBody` / `createStringifier(context)` | blocks → DSL text (no module state; pass the context) |
| `mergeIntoManifest`, `cleanIdent`, `buildProcByCode`, `synthesizeProccode` | pack plumbing |
| `targetAssetFiles(target)` | md5ext → readable asset filename map |
| `md5hex(bytes)` | the pure-JS md5 used for asset ids |
| `BLANK_SVG`, `BLANK_SVG_ID` | default costume for synthesized projects |

## Diagnostics

Nothing in the core prints. `convertProject`, `buildProjectFromBuildDir`, `packSb3` and `unpackSb3` return `diagnostics`, and `buildTarget` returns them per apply. Each one is `{severity, code, message, hint, line, column, endLine, endColumn, from?, to?, file?, fix?}` with a stable code listed in [errors.md](errors.md). `fix` is `{title, edits: [{from, to, text}]}`. `formatDiagnostic(d)` gives the CLI form, `hasErrors(list)` checks for errors.

## Per-target API (MistWarp Code mode)

These work on one target of a live project, never touch a filesystem, never mutate their input and keep no module state.

```js
import { emitTarget, buildTarget, toReplaceChange } from 'fractch';

const context = vm.getFractchContext();
const { text, sourceMap, lockedScripts } = emitTarget(context, targetId);
const result = buildTarget(context, targetId, editedText, {
  previous: { text, sourceMap },
  lockedScripts,
  verifyRoundTrip: true,
});
if (!result.diagnostics.some((d) => d.severity === 'error')) {
  vm.replaceTargetScripts(targetId, toReplaceChange(result));
}
```

### Context

`context` is what `vm.getFractchContext()` returns: `{targets: [...], extensionSignatures?, monitors?}`. Each target is in sb3 form (`blocks`, `variables`, `lists`, `broadcasts`, `comments`, plus `id`, `name`, `isStage`) with MistWarp's live form left in place: `operator_pi`/`operator_newline` blocks and collapsed variadic operators (`mutation.itemcount`). Two sidecars ride along, per target or at the top level: `primitiveIds[parentId][inputName] = {block, shadow}` gives the ids of compressed primitives, and `obscuredShadows[operatorId]` lists the shadows a collapsed operator set aside, outermost first, as `{id, blocks}` or `null`. `keptLists[listId]` marks lists that arrived as `[name, null]`; they are written as `var x = keep;`. Plain sb3 project JSON also works: without sidecars or `form: 'live'` operators are built binary.

`extensionSignatures` is `{extId: {blocks: [{opcode, blockType, text, branchCount, arguments: [{name, type, menu}]}], menus: {name: {acceptReporters, items}}}}` (a `getInfo()` shape); pass `extensions` in the options to override it. `opcodes` (option or `context.opcodes`) is the core opcode table, `{opcodes: {opcode: {inputs, fields, hat, variadic?, mutationInputs?}}}`, as generated by scratch-vm.

### emitTarget(context, targetId, options?)

Returns `{text, sourceMap, lockedScripts}`.

- `text`: `import` lines, the target's `var`/`cloud`/`watch` lines, floating comments that the membership map does not place, then scripts and regions with their free comments. Sprite properties, costumes, sounds, `use` lines, reserved comments (`_twconfig_`, `WORKSPACE_BOOKMARKS:`, `_gamepad_`) and the membership map comment are never in it.
- `sourceMap`: `{scripts, blocks, comments, declarations, regions}`, each a map from id (or `var:name`/`list:name`, or region name) to `{from, to, line, endLine}`. Blocks that are written as part of a larger form map to their nearest written ancestor (`via`). `findInSourceMap(sourceMap, offset)` gives the innermost entry at an offset.
- `lockedScripts`: `[{topId, reason, from, to, line, endLine}]` for every script that would not come back structurally equal (the step 0 lock check, which builds the text once). `{lockCheck: false}` skips it. A script that can't be written at all becomes a `locked script "<id>";` line.

### buildTarget(context, targetId, text, options?)

Options: `previous: {text, sourceMap}` (the pair the text was edited from; defaults to a fresh emit), `lockedScripts` (top ids or `{topId, from, to}`), `extensions`, `opcodes`, `uid` (id generator, defaults to a Blockly-style 20 character uid), `verifyRoundTrip` (step 4: emit the result, build it again and refuse with FR224 when anything would change), `fastUnchanged` (default true: a script whose text is byte-identical to its previous text is carried without rebuilding, as long as no declaration line was added or removed).

Returns `{target, unchangedScripts, changed, differences, created, removed, diagnostics, sourceMap, primitiveIds, obscuredShadows, valueSets}`:

- `target`: the complete target in the same sb3 form as the context: blocks, comments (without reserved comments, with the membership map comment), variables and lists (and broadcasts on the Stage). Unchanged and locked scripts are the live block objects, ids and all.
- `unchangedScripts`: top ids carried as they are. `changed`: `[{topId, newTopId, reason}]` for paired scripts that were rebuilt. Rebuilt scripts reuse the old id of every block, shadow and primitive the alignment matches; everything else gets a fresh id.
- `created`/`removed`: `{variables, lists, broadcasts, scripts, comments}`; `valueSets` maps variable ids to values from edited `var` lines.
- `primitiveIds`, `obscuredShadows`: sidecars for the output, same shape as the input.

### toReplaceChange(result)

Maps a result onto `vm.replaceTargetScripts(targetId, change)`: `{format: 'sb3', blocks, primitiveIds, obscuredShadows, keepScripts, comments, variables: {create, delete, set}}`. `keepScripts` are the unchanged top-level scripts, `comments` every non-reserved comment of the result, `variables.create` entries are `{id, name, type: '' | 'list' | 'broadcast_msg', value, isCloud?, scope?}`.

### Membership map

Which file (region) or stdlib module a script belongs to lives in one comment per target with `blockId: null` whose text is `_fractch_map_` followed by JSON `{version: 1, scripts: {topId: region | "main"}, modules?: {topId: moduleId}, comments?: {commentId: {region?, before?}}}`. A `comments` entry places a free comment: `region` is omitted for `main`, and `before` is the top block id of the script that follows it in the same file, omitted when the comment ends its file. A comment whose `before` script is gone goes at the end of its file; a comment with no entry goes after the declarations in `main`. Comments longer than 8000 characters are split into `text` plus `extraText`, and every reader joins them. A present map is authoritative; without one, the 0.9 markers (`fractch:file:` hat comments and `fractch_h..._fractch_` top ids) are read. Pack writes the map and no longer writes the old markers.

### Reference data

`languageReference()` lists every alias the parser knows (emitted camelCase name, parse-only spellings, opcode, arguments); `referenceWithDocs(syntaxMarkdown)` attaches the matching line of `docs/syntax.md`.
