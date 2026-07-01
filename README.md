# FRACTCH — Scratch scripts to a custom DSL

This tool converts a Scratch 3 `.sb3` project into a lossless, human-readable DSL called Fractch. The converter is JavaScript (Node.js), but the output is plain `.fractch` text files.

- Input: `originv6.0.0.sb3` (in the repo root)
- Output: `build/` directory with one file per hat/script, grouped by target (sprite/stage) and hat opcode.
- DSL: Each block becomes a call where the function name is the Scratch `opcode`, allowing all extensions to be represented.
- Lossless: every block lives only in its `.fractch` script file, as DSL text — no other copy exists anywhere. There is no raw JSON snapshot in the file headers or in `manifest.json`: packing reparses the DSL body and rebuilds `blocks` from scratch. `build/manifest.json` carries everything else (variables, lists, broadcasts, comments, costumes/sounds metadata, monitors, extensions, meta) but never a target's `blocks`.
- Hand-written projects are supported: headers and `manifest.json` are optional when packing. Without a manifest, Fractch synthesizes a minimal Scratch project and default SVG asset from the target/script directory layout.

## Install

```sh
npm install
```

## Run

```sh
npm run build
```

Outputs will be written to `./build` with:

- `index.fractch` that imports everything
- `<Target>/index.fractch` per target
- `<Target>/<hatOpcode>/<topBlockId>.fractch` script files
- `manifest.json` capturing the Scratch `project.json` minus per-target `blocks` (those live entirely in the `.fractch` files)

## Fractch DSL overview

- Blocks are encoded as calls where the function name is the Scratch `opcode`, with the first underscore shown as a namespace dot for readability: `motion.changexby(DX: 10)` packs as Scratch opcode `motion_changexby`. Plain `name: value` arguments are Scratch inputs and may nest reporter blocks. `field name: value` arguments are Scratch fields, such as dropdowns or variable/list/broadcast references; dropdown values are written as plain strings (`field EFFECT: "COLOR"`). The `field` keyword is optional (and not emitted) when the key + value shape already identify a field: `VARIABLE: var("x")`, `LIST: list("x")`, `BROADCAST_OPTION: broadcast("x")`. The older `name= value` input form and raw underscore opcode names are still accepted for handwritten files.
- Common control-flow blocks get readable sugar instead of the generic call form: `if cond { ... }`, `if cond { ... } else { ... }`, `forever { ... }`, `repeat n { ... }`, `until cond { ... }`, `while cond { ... }`, `switch v { case x { ... } case y fallthrough { ... } default { ... } }`, `wait n;`, `wait_until cond;`, `stop "all";`, `return v;`, `broadcast "name";`, `broadcast_wait "name";`, `vars["name"] = value;`, `vars["name"] += value;`.
- Arithmetic/logic operators are plain infix expressions with the usual precedence (`||` < `&&` < comparisons < `..` < `+ -` < `* / %`, left-associative): `a + b * c`, string concat `a .. b` (deliberately distinct from `+` since `operator_add`/`operator_join` are different opcodes), `a == b`, `a < b`, `a > b`, `a && b`, `a || b`, plus `round(a)` and math-op functions (`abs`, `floor`, `sqrt`, `sin`, `exp`, ...). Parens group as usual, and fully parenthesized old-style text still parses to the identical tree. Since Scratch operator blocks are binary, parens are emitted wherever the tree shape needs them (e.g. `a .. (b .. c)` for a right-nested join).
- Negated comparisons and boolean negation get sugar too: `a != b`, `a <= b`, `a >= b`, and prefix `!cond` — each desugars to the exact `not(...)` block pair Scratch stores (`not(a == b)` etc.), so the round trip is unchanged. `not(a)` is still accepted.
- Custom blocks: `def @Name(param1, param2) "Original Proccode %s %s" warp { ... }` defines a custom block — the quoted string preserves exact fidelity even though `@Name` is a cleaned-up identifier, and is omitted entirely when it's just the name plus `%s` placeholders (the pack step re-derives it). Bare `warp` means warp on; omit it for off (`warp=true`/`warp=false` still parse). Call sites use `@Name(param1: value, param2: value)`. A param whose display name doesn't match its identifier (e.g. contains spaces) is written `ident("Original Name")` in the signature.
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

Generated `.fractch` files begin with a small header comment (target, targetId, topBlockId, hatOpcode, threadIndex) used only to route rebuilt blocks back to the right place in converted projects — it carries no block data. The header is optional when writing files by hand; pack can infer the target and hat from `build/<Target>/<hatOpcode>/<name>.fractch`.

## Hand-written projects

A minimal hand-written project can be packed without first converting an `.sb3`:

```txt
my-project/
  Stage/
    event_whenflagclicked/
      main.fractch
```

```txt
event_whenflagclicked();
looks_say(MESSAGE: "hello from fractch");
```

Pack it with:

```sh
fractch --pack --out ./my-project --outSb3 ./my-project.sb3
```

If `index.fractch` imports one or more scripts, those imports are the pack list. This lets agents keep draft or unwanted top-level scripts in the tree without packaging them:

```txt
import "./Stage/event_whenflagclicked/main.fractch";
```

When no index imports are present, pack scans all `build/<Target>/<hatOpcode>/*.fractch` files. To exclude a scanned file, add `fractch:ignore` near the top of the file or name it `*.ignore.fractch`.

## Verifying round-trip fidelity

- `node scripts/check-parse.mjs` — parses every generated `.fractch` file and reports any that fail to parse at all.
- `node scripts/check-roundtrip.mjs [originSb3] [buildDir]` — deep structural check: parses and rebuilds every script, then walks the rebuilt block tree against the true origin subgraph and reports the first mismatch per file. This is the real fidelity signal (`check-parse.mjs` only proves the grammar didn't choke).
- `npm run selftest` — build → pack → sanity-check that every target's block count round-trips within 5%.

`check-roundtrip.mjs` passes at 100% (every reachable block, including corrupted/dangling forward references, reconstructs structurally identical to the origin). Two purely cosmetic, execution-invisible gaps remain by design: the obscured/hidden shadow block behind an already-plugged-in reporter (what would show if you unplugged it in the editor) and the exact canvas x/y position of top-level blocks are not carried through DSL text.

## CLI

```sh
fractch --input ./originv6.0.0.sb3 --out ./build --verbose
fractch --pack --out ./build --outSb3 ./repacked.sb3 --verbose
```

Options:

- `--input` path to `.sb3`
- `--out` output directory (or build directory to pack, with `--pack`)
- `--pack` reverse conversion: build directory → `.sb3`
- `--outSb3` output `.sb3` path when using `--pack`
- `--verbose` extra logs

## Notes

- Read-only conversion; it does not execute projects.
- Multiple hats with same opcode produce separate files by id.
- Block chains detached from any reachable script (stale/dangling data left over from editor operations) are swept into their own script files too, so nothing in the original `project.json` is silently dropped.
