# FRACTCH — Scratch scripts to a custom DSL

This tool converts a Scratch 3 `.sb3` project into a lossless, human-readable DSL called Fractch. The converter is JavaScript (Node.js), but the output is plain `.fractch` text files.

- Input: `originv6.0.0.sb3` (in the repo root)
- Output: `build/` directory with one `main.fractch` file per target (sprite/stage), unless a project was intentionally split into extra `.fractch` files or folders.
- DSL: Each block becomes a call where the function name is the Scratch `opcode`, allowing all extensions to be represented.
- Lossless: the whole project lives in `.fractch` text — no other copy exists anywhere. There is no raw JSON snapshot in file headers and no `manifest.json` at all: blocks, sprite/stage properties, variable values, extensions, watchers, and comments are all declarations in code, and packing reparses the DSL and rebuilds `project.json` from scratch. Costume/sound metadata is written as asset declarations, with files kept beside the target under `assets/`.
- Hand-written projects are supported: headers are optional when packing. Fractch synthesizes a minimal Scratch project and default SVG asset from the target/script directory layout, and any declarations fill in the rest. (A `manifest.json` from an older build dir still loads for back-compat.)

## Install

```sh
npm install
```

## Run

```sh
npm run build
```

Outputs will be written to `./build` with:

- `<Target>/main.fractch` containing that target's declarations (sprite/stage properties, variables, watchers, comments, extensions on the Stage) followed by its top-level scripts
- `<Target>/assets/` containing that target's referenced costume/sound files

## Documentation

Full docs live in [`docs/`](docs/README.md): [getting started](docs/getting-started.md), [CLI](docs/cli.md), [syntax reference](docs/syntax.md), [assets](docs/assets.md), [programmatic API](docs/api.md), [architecture](docs/architecture.md).

## Fractch DSL overview

A file holds any number of scripts. Hats are written as `when`, custom blocks as `def`, and hatless stacks as `script`; each takes an optional `at x,y` canvas position:

```txt
when flag at 0,0 {
  local elapsed = 0;          // script-local variable (namespaced on the Scratch side)
  score = 0;                  // plain variables assign by name
  forever {
    elapsed += 1;
    say "score: " ++ score;
    if lists["queue"].length > 0 {
      handle = lists["queue"][1];
      lists["queue"].delete(1);
      broadcast HandleItem;
    }
  }
}

when broadcast HandleItem {
  costume "active";
  move 10;
}

def @reset() {
  lists["queue"].clear();
  goto 0, 0;
}
```

Costumes and sounds are one-line declarations. Only the name and the file are required — the asset id, md5 and data format are derived from the file's bytes at pack time:

```txt
costume "walk" file "assets/walk.svg";
costume "wallpaper" file "assets/wallpaper.png" center 240,180 bitmap 2;
sound "pop" file "assets/pop.wav";
sound "song" file "assets/song.mp3" rate 48000 samples 1123;
```

`center X,Y` sets the rotation center (default `0,0`), `bitmap N` the bitmap resolution (default 1), and `rate` / `samples` / `format "adpcm"` carry sound metadata when you have it. Asset files live next to the code in `<Target>/assets/`, named after the costume/sound rather than a hash. Drop a PNG in, write one `costume` line, done.

`when` sugar covers `flag`, `clone`, `clicked`, `broadcast <name>`, `key <name>`, `backdrop <name>`; any other hat is `when some.extension_hat() { ... }`. Statement aliases: `say E;`, `say E for N;`, `think`, `ask`, `move`, `turn`, `turn_left`, `point`, `goto X, Y;`, `set_x/set_y/change_x/change_y`, `set_size/change_size`, `change_effect brightness by 25;`, `set_effect ghost to 50;`, `clear_effects;`, `costume "name";`, `backdrop "name";`, `next_costume;`, `next_backdrop;`, `clone;` / `clone "sprite";`, `delete_clone;`, `show; hide;`, `reset_timer;`, `pen_up; pen_down; pen_clear; stamp;`. Lists: `lists["x"].add(v)`, `.delete(i)`, `.insert(i, v)`, `.clear()`, `.show()`, `.hide()`, `lists["x"][i]` (read), `lists["x"][i] = v;` (replace), `.length`, `.contains(v)`, `.indexof(v)`, and bare `lists["x"]` for the list-contents reporter. Variables: `name = v;` / `name += v;` for identifier-safe names, `vars["any name"]` for the rest, and `local name = v;` declares a script-scoped variable that packs to a namespaced real variable (`local_1_name`).

- Blocks are encoded as calls where the function name is the Scratch `opcode`, with the first underscore shown as a namespace dot for readability: `motion.changexby(DX: 10)` packs as Scratch opcode `motion_changexby`. Plain `name: value` arguments are Scratch inputs and may nest reporter blocks. `field name: value` arguments are Scratch fields, such as dropdowns or variable/list/broadcast references; dropdown values are written as plain strings (`field EFFECT: "COLOR"`). The `field` keyword is optional (and not emitted) when the key + value shape already identify a field: `VARIABLE: var("x")`, `LIST: list("x")`, `BROADCAST_OPTION: broadcast("x")`. The older `name= value` input form and raw underscore opcode names are still accepted for handwritten files.
- Common control-flow blocks get readable sugar instead of the generic call form: `if cond { ... }`, `if cond { ... } else { ... }`, `forever { ... }`, `repeat n { ... }`, `until cond { ... }`, `while cond { ... }`, `switch v { case x { ... } case y fallthrough { ... } default { ... } }`, `wait n;`, `wait_until cond;`, `stop all;` / `stop other_scripts_in_sprite;`, `return;` (stop this script), `return v;`, `broadcast SomeName;` (quotes only needed when the name isn't a plain identifier), `broadcast_wait name;`, `vars["name"] = value;`, `vars["name"] += value;`. Semicolons are optional.
- Arithmetic/logic operators are plain infix expressions with the usual precedence (`||` < `&&` < comparisons < `++` < `+ -` < `* / %`, left-associative): `a + b * c`, string concat `a ++ b` (legacy `a .. b` still parses) (deliberately distinct from `+` since `operator_add`/`operator_join` are different opcodes), `a == b`, `a < b`, `a > b`, `a && b`, `a || b`, plus `round(a)` and math-op functions (`abs`, `floor`, `sqrt`, `sin`, `exp`, ...). Parens group as usual, and fully parenthesized old-style text still parses to the identical tree. Since Scratch operator blocks are binary, parens are emitted wherever the tree shape needs them (e.g. `a ++ (b ++ c)` for a right-nested join).
- Negated comparisons and boolean negation get sugar too: `a != b`, `a <= b`, `a >= b`, and prefix `!cond` — each desugars to the exact `not(...)` block pair Scratch stores (`not(a == b)` etc.), so the round trip is unchanged. `not(a)` is still accepted.
- Dropdown menu shadow blocks (the editor's default value living inside an input slot) are written as a call with a single positional argument: `sensing.keypressed(KEY_OPTION: sensing.keyoptions("space"))` rebuilds the `sensing_keyoptions` shadow block with `shadow: true` and its field named after the enclosing input. When the menu's field name differs from the input name, the explicit form is `shadow opcode(field name: value)`. Shadows hidden behind a plugged-in reporter (*obscured* shadows — menu or plain default text) are not written out at all: the editor regenerates them on load, so they'd be pure noise. The `reporter() ?? menu("x")` form still parses for files that carry them.
- Custom blocks: `def @Name(param1, param2) "Original Proccode %s %s" warp { ... }` defines a custom block — the quoted string preserves exact fidelity even though `@Name` is a cleaned-up identifier, and is omitted entirely when it's just the name plus `%s` placeholders (the pack step re-derives it). Bare `warp` means warp on; omit it for off (`warp=true`/`warp=false` still parse). Call sites are positional: `@Name(value1, value2)` (named `@Name(param: value)` still parses). A param whose display name doesn't match its identifier (e.g. contains spaces) is written `ident("Original Name")` in the signature.
- Extension "C-block" opcodes (custom blocks with a body slot that aren't one of the hardcoded keywords above) still get their body: `some_extension_opcode(args) { ... }`.
- Variables/lists/broadcasts referenced by name resolve to their real id at pack time via the target's (and Stage's global) variable/list/broadcast tables — `var("name")`, `list("name")`, `broadcast("name")`, or just a bare identifier for the common case (`myVar`). A bare identifier reconstructs Scratch's own compact inline form (there is no separate `data_variable` block in real project.json files), so this is byte-exact, not just behaviorally equivalent.
- Custom-block parameters referenced inside the body are also just a bare identifier (`paramName`) when unambiguous. If a param's display name collides with another param's only after identifier-cleaning (e.g. `"X"` and `"+X"` both clean to `X`), or the body still references a parameter that's since been removed from the definition (Scratch leaves those dangling), it's written explicitly as `arg("Original Name")` instead.
- Unknown/extension blocks are fine because the function name is the `opcode`.
- `dangling_next("id");` is a sentinel, not a real block: some project.json files (hand-edited or corrupted) contain forward references (`next`, `SUBSTACK`, ...) to a block id that was never actually serialized. Rather than silently truncating the chain there, the DSL preserves the exact broken id so packing reproduces the identical dangling reference instead of quietly dropping it.

Example:

```txt
if vars["score"] >= 10 && !sensing.mousedown() {
  motion.turnright(DEGREES: 15);
}
```

Generated `.fractch` files begin with a small header comment used only as routing metadata — it carries no block data. The header is optional when writing files by hand; explicit `when`, `def`, and `script` statements carry the top-level block semantics.

## Using a fractch project as your codebase

The text files are the source of truth; the `.sb3` is a build artifact. A working setup:

```sh
fractch new my-project        # scaffold Stage/main.fractch + .gitignore
cd my-project && git init
fractch check .               # parse + lint every file, errors with file:line, exit 1 on problems
fractch run .                 # pack, open in the MistWarp editor, repack on every save
```

- `fractch watch <dir> [to <sb3>]` repacks on every save (200ms debounce) without opening anything — point your runner at the output `.sb3`.
- `fractch run <dir>` additionally serves the packed project over localhost and opens the editor with `?project_url=` pointing at it; edit files, save, refresh the editor tab to reload. `--editor <url>` switches editors (default `https://warp.mistium.com/editor.html` — any TurboWarp-family editor that supports `project_url` works).
- `fractch check <dir>` reports unterminated strings / unbalanced brackets, statements the parser had to skip (with line numbers), and calls to custom blocks that have no `def`.
- Packing also prints a warning for every statement it skips, so a typo can't silently drop blocks.
- Existing projects: `fractch from game.sb3 to ./game`, commit `./game`, delete the `.sb3`.

## Hand-written projects

A minimal hand-written project can be packed without first converting an `.sb3`:

```txt
my-project/
  Stage/
    main.fractch
```

```txt
when flag {
  say "hello from fractch";
}
```

Pack it with:

```sh
fractch --pack --out ./my-project --outSb3 ./my-project.sb3
```

If `index.fractch` imports one or more scripts, those imports are the pack list. This lets agents keep draft or unwanted top-level scripts in the tree without packaging them, and unimported non-stage targets are pruned so their costumes/sounds are not packed either:

```txt
import "./Stage/main.fractch";
```

When no index imports are present, pack scans all `.fractch` files under each target folder recursively. `main.fractch` is the default file for a target; any other `.fractch` file, including files inside folders like `Stage/ui/buttons.fractch`, is tagged into the rebuilt `.sb3` so a later `fractch from project.sb3` recreates that same separate file path instead of folding it into `main.fractch`. The older `build/<Target>/<hatOpcode>/*.fractch` layout is still accepted for compatibility with implicit opcode-call scripts. To exclude a scanned file, add `fractch:ignore` near the top of the file or name it `*.ignore.fractch`.

## Verifying round-trip fidelity

- `node scripts/check-parse.mjs` — parses every generated `.fractch` file and reports any that fail to parse at all.
- `node scripts/check-roundtrip.mjs [originSb3] [buildDir]` — deep structural check: parses and rebuilds every script, then walks the rebuilt block tree against the true origin subgraph and reports the first mismatch per file. This is the real fidelity signal (`check-parse.mjs` only proves the grammar didn't choke).
- `npm run selftest` — build → pack → sanity-check that every target's block count round-trips within 5%.
- `npm test` — fast, fully self-contained unit, integration, and regression-corpus suite. Test projects and SB3 archives are generated in temporary directories; the suite never scans personal directories or reads external SB3 fixtures.

`check-roundtrip.mjs` passes at 100% (every reachable block, including corrupted/dangling forward references, reconstructs structurally identical to the origin). Repacked projects load and run in the Scratch/TurboWarp editor: menu shadow blocks, reporter-style custom blocks (`returns=2` for boolean shape), `stop` block shapes, variable/list field ids, and top-level canvas positions (via the `pos:` header line) all survive the round trip. One purely cosmetic, execution-invisible gap remains by design: the plain text/number default hidden behind an already-plugged-in reporter (what would show if you unplugged it in the editor) is not carried through DSL text — dropdown-menu defaults are, since the editor requires those.

## CLI

```sh
npm install -g fractch
```

```sh
fractch from project.sb3 to ./project    # unpack .sb3 -> .fractch text
fractch from project.sb3                 # same, defaults to ./project
fractch project.sb3 from ./project      # pack a build dir -> .sb3
fractch to project.sb3 from ./project   # same, if you like symmetry
```

The flag form does the same thing:

```sh
fractch --input ./originv6.0.0.sb3 --out ./build --verbose
fractch --pack --out ./build --outSb3 ./repacked.sb3 --verbose
```

Options:

- `--input` path to `.sb3`
- `--out` output directory (or build directory to pack, with `--pack`)
- `--pack` reverse conversion: build directory → `.sb3`
- `--outSb3` output `.sb3` path when using `--pack`
- `--verbose` extra logs (works with the word syntax too)

## Programmatic use

```sh
npm install fractch
```

```js
import { unpackSb3, packSb3 } from 'fractch';

await unpackSb3({ input: './project.sb3', outDir: './project' });
await packSb3({ buildDir: './project', outSb3: './repacked.sb3' });
```

`packSb3` accepts an optional `originSb3` path to supply referenced non-block
assets (costumes, sounds) that are not present under `assets/`; without it the
current working directory is searched, matching the CLI.

### In the browser

The `fractch` import resolves to a browser-safe build (no `fs`, `path`,
`adm-zip`, or other Node built-ins) via the package's `browser` export
condition; `fractch/browser` imports it explicitly. Every function takes an
`fs` option accepting any node-style or promises-style fs — an in-memory one
like [lightning-fs](https://github.com/isomorphic-git/lightning-fs) works
directly:

```js
import LightningFS from '@isomorphic-git/lightning-fs';
import { convertProject, buildProjectFromBuildDir } from 'fractch';

const fs = new LightningFS('fractch');

// projectJson is the parsed project.json from an .sb3 (unzip with e.g. fflate/jszip)
await convertProject(projectJson, { outDir: '/project', fs });

// ...edit the .fractch files in the in-memory fs...

const { manifest } = await buildProjectFromBuildDir({ buildDir: '/project', fs });
// `manifest` is a complete project.json object - zip it together with the
// assets to produce the .sb3. `BLANK_SVG` / `BLANK_SVG_ID` are exported for
// the default costume that synthesized manifests reference.
```

Zip handling stays outside the browser core on purpose: reading and writing
`.sb3` archives is left to whatever zip library the host app already uses.
In Node, `unpackSb3` / `packSb3` wrap the same core with adm-zip and the real
filesystem.

Lower-level pieces are exported too, for tools that operate on `.fractch` text
or Scratch block JSON directly rather than through the filesystem pipeline:
`parseFractch` (text → call tree), `buildBlocksFromCalls` (call tree → Scratch
block JSON), `convertProject` (project.json → build dir), `checkFractch` /
`assertValidFractch` (lint), `emitScriptFile` / `stringifyBlockCall` (blocks →
DSL text), `mergeIntoManifest`, `cleanIdent`, `buildProcByCode`.

## Notes

- Read-only conversion; it does not execute projects.
- Multiple hats with same opcode produce separate files by id.
- Block chains detached from any reachable script (stale/dangling data left over from editor operations) are swept into their own script files too, so nothing in the original `project.json` is silently dropped.
