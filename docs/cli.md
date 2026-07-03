# CLI Reference

```txt
fractch new <dir>                       scaffold a fresh fractch project
fractch from <project.sb3> [to <dir>]   unpack an .sb3 into .fractch text
fractch [to] <project.sb3> from <dir>   pack a project dir into an .sb3
fractch check <dir>                     parse + lint every .fractch file
fractch fmt <dir>                       rewrite files in canonical (current) syntax
fractch watch <dir> [to <sb3>]          repack automatically on change
fractch run <dir>                       pack, open in the editor, repack on save
fractch --input <sb3> --out <dir>       flag form (same as `from ... to ...`)
```

## Commands

### `fractch new <dir>`

Scaffolds `Stage/main.fractch` and a `.gitignore` that excludes `*.sb3`. Refuses to run in a non-empty directory.

### `fractch from <sb3> [to <dir>]`

Unpack. Without `to`, the output directory is derived from the sb3 name (`game.sb3` → `./game`). Produces per-target folders with `main.fractch`, target-local `assets/`, and an `extensions/` folder listing custom extension sources.

### `fractch <out.sb3> from <dir>` (also `fractch to <out.sb3> from <dir>`)

Pack. Options:

- `--origin <sb3>` — copy non-asset extras (e.g. a `git.json` MistWarp keeps in the archive) from this sb3. Asset files always come from the project folder first. Without the flag, pack looks for an `.sb3` in the current directory.
- `--verbose` — logs skipped statements, asset pruning, and write details.

Every statement the parser has to skip is warned as `file:line: skipped unparsable statement: ...` — a typo can't silently drop blocks.

### `fractch check <dir>`

Parses and lints every `.fractch` file. Reports, with `file:line`:

- unbalanced brackets / unterminated strings
- statements the parser had to skip
- calls to custom blocks with no `def`

Exit code 1 when anything is wrong — usable in CI.

### `fractch fmt <dir>`

Canonicalizes every `.fractch` file in place: rebuilds the project in memory through the pack pipeline, then re-emits it in the current emission style. Legacy syntax parses forever but files never modernize on their own — `fmt` is the one-command upgrade. It refuses to run while `check` reports problems (a skipped statement would be silently dropped by the rewrite), keeps unused costumes/sounds (no pack-style pruning), and is idempotent: a second run changes nothing.

### `fractch watch <dir> [to <sb3>]`

Initial pack plus a filesystem watcher (200ms debounce). Default output: `./<dirname>.sb3`.

### `fractch run <dir>`

`watch` + a localhost server + opens the editor with `?project_url=` pointing at the packed sb3. Edit, save, refresh the tab.

- `--editor <url>` — editor to open (default `https://warp.mistium.com/editor.html`; any TurboWarp-family editor supporting `project_url` works).

## Index files as allow-lists

Generated projects have no `index.fractch`. If you create one (at the root or inside a target) its `import "...";` lines become the pack allow-list: unimported script files are skipped, and unimported non-stage targets are pruned along with their assets. Alternative per-file opt-outs: put `fractch:ignore` near the top of a file, or name it `*.ignore.fractch`.
