# Architecture

For contributors. Two symmetric pipelines through `bin/cli.js`:

```txt
convert (sb3 -> text):  convert.js -> graph.js -> emit.js -> stringify.js
pack    (text -> sb3):  pack.js -> parse.js -> buildBlocks.js -> packSb3.js
```

## The core invariant

**The DSL text is the only copy of the blocks.** No raw JSON snapshot exists anywhere — not in headers, not in the manifest. Packing reconstructs every block by reparsing the text. Any change to emission (`emit.js` / `stringify.js`) needs a matching change in parsing (`parse.js` / `buildBlocks.js`) or the round trip silently degrades.

The check for this is `scripts/check-roundtrip.mjs`: it parses every generated file, rebuilds its blocks, and walks the rebuilt tree against the original subgraph (paired by position, not id). It must pass 100% after touching either side. `npm test` and `npm run selftest` only bound against wholesale loss.

## Module map

| File | Role |
|---|---|
| `src/convert.js` | orchestrates sb3→text; groups scripts per target into `main.fractch` (or marker-derived files); builds name→id maps |
| `src/graph.js` | finds top-level scripts and walks block subgraphs; sweeps detached/corrupted chains so nothing is dropped |
| `src/emit.js` | renders scripts (`when`/`def`/`script` forms), asset declarations, def signatures, headers |
| `src/stringify.js` | renders individual blocks: statement aliases, list/variable sugar, infix expressions with minimal parens, generic calls |
| `src/parse.js` | hand-written recursive-descent parser; returns `{ scripts, calls, assets, errors }`; keeps every legacy syntax parsing |
| `src/buildBlocks.js` | call tree → Scratch block JSON; ids, shadows, mutations, locals; two-phase manifest merge |
| `src/pack.js` | browser-safe pack core: file scanning, index allow-lists, per-script locals, asset resolution (md5 hashing), unused-asset pruning |
| `src/packSb3.js` | Node zip wrapper: writes the `.sb3`, copies referenced assets, preserves non-asset origin extras |
| `src/fileMarkers.js` | reversible top-block-id markers that remember which extra `.fractch` file a script came from |
| `src/fsAdapter.js`, `src/pathUtils.js`, `src/md5.js` | dependency-injected fs, posix paths, pure-JS md5 — keep the core free of Node built-ins |
| `src/index.js` / `src/browser.js` | Node entry (defaults `fs`, adds zip I/O) / browser entry (core only) |

## Name resolution (the subtle part)

Everything is resolved by name at pack time:

- Variables/lists: target dict + Stage globals (sprite-local shadows global) via `buildNameIdMap`; broadcasts are project-wide. Emission drops `var("x", "id")` id arguments whenever this resolution would return the same id.
- `local x = ...` declarations map to per-script namespaced variables (`local_1_x`) created in the manifest during pack.
- Custom blocks: `@Ident` comes from `cleanIdent(proccode)` with collision dedup (`Ident_2`); call sites resolve back through that identifier, and `registerProcDefs` runs over every parsed def up front because calls can live in other files. Call mutations get `warp`/`customcolor` from the def and `return` (`1` round / `2` boolean via `returns=2`) from expression position.

## Generated ids

`IdGen` produces `~`-prefixed sequential base62 ids. The prefix is load-bearing twice over: scratch-gui's palette assigns readable ids like `"of"` to toolbox blocks and looks them up in the editing target (collision = editor crash), and the two-phase merge in `mergeIntoManifest` must never confuse fresh ids with original ones.

## Editor-fidelity lessons (all empirically verified in a TurboWarp-family editor)

- Reporter-style custom block calls need `mutation.return` or Blockly builds a statement shape that can't connect into value slots.
- Argument reporters in a def body are real blocks (`shadow: false`, tuple code 2); only the prototype's copies are shadows.
- Branch bodies must not mark their first block `topLevel` — the editor renders duplicates and dies on duplicate ids.
- `control_stop` needs `mutation.hasnext` derived from the stop option.
- Visible menu shadows must round-trip (they carry the argument value); *obscured* shadows (hidden behind a plugged reporter) can be dropped — the editor regenerates them on load.
- Variable/list dropdown fields want their ids resolved, not null.

## Deliberate quirks (don't "fix")

- `dangling_next("id")` reproduces broken forward references from corrupted projects exactly.
- Unknown text is never silently eaten: the parser records skipped statements with line numbers, and pack prints them.
- `index.fractch` files are optional; when present, imports are the authoritative pack list and unimported targets (and their assets) are pruned.
- Numeric text literals emit bare only when the number grammar re-reads the identical characters (`.25`, `007` survive verbatim).
