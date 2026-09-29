# FRACTCH

Write Scratch as text. FRACTCH converts a Scratch 3 / TurboWarp `.sb3` project into a lossless, human-readable DSL (`.fractch` files) and packs it back. The text is the source of truth; the `.sb3` is a build artifact.

- **Lossless.** Blocks, sprite and stage properties, variables, extensions, monitors and comments all live in the text. Packing reparses it and rebuilds `project.json` from scratch. There is no JSON snapshot or manifest on the side.
- **Hand-writable.** A project can be as small as one `Stage/main.fractch`. Headers and manifests are optional.
- **Git-friendly.** One folder per sprite, plain text scripts, assets named after the costume or sound.
- **Browser-safe core.** Runs in Node (CLI and API) and in the browser.

## Install

```sh
npm install -g fractch
```

Requires Node 18+.

## Quick start

Start a new project, check it, and run it in the editor:

```sh
fractch new my-project
cd my-project
fractch check .
fractch run .
```

`run` packs the project, serves it on localhost, opens [MistWarp](https://warp.mistium.com/editor.html), and repacks on every save. Refresh the editor tab to reload.

Bring an existing project across:

```sh
fractch from game.sb3 to ./game
fractch game.sb3 from ./game
```

## The language

Scratch-style commands such as `when flag`, `broadcast`, `move`, and `costume` retain their existing spelling. [Multi-block abstractions](docs/abstractions.md) shorten list and string traversal, timed loops, string joins, and self-concatenation while rebuilding the original Scratch block trees. [Before/after source patches](examples/mistwarp-diffs/README.md) show the changes on real MistWarp projects.

A file holds any number of scripts: `when` for hats, `def` for custom blocks, and `script` for hatless stacks. Each takes an optional `at x,y` canvas position.

```txt
when flag {
  local elapsed = 0;
  score = 0;
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

Costumes and sounds are one-line declarations. The asset id, md5 and format are derived from the file at pack time:

```txt
costume "walk" file "assets/walk.svg";
sound "pop" file "assets/pop.wav";
```

Anything without dedicated sugar is written as a call named after its opcode, with the first underscore shown as a dot, so `motion_changexby` becomes `motion.changexby(DX: 10)`. That is how extension blocks are covered too. The full reference is in [docs/syntax.md](docs/syntax.md).

## Project layout

```txt
my-project/
  Stage/
    main.fractch
  Sprite1/
    main.fractch
    assets/
      walk.svg
```

Each target's `main.fractch` holds its declarations and all of its scripts. Extra `.fractch` files anywhere under a target folder are packed too, and return to the same path when the `.sb3` is unpacked again. To control what gets packed, add an `index.fractch` with `import "./Stage/main.fractch";` lines: unimported targets and their assets are pruned. Exclude a single file with `fractch:ignore` near its top or a `*.ignore.fractch` name.

## CLI

```txt
fractch new <dir>                       scaffold a project
fractch clone <url> [to <dir>]          download a MistWarp project as .fractch text
fractch from <sb3> [to <dir>]           unpack an .sb3
fractch [to] <sb3> from <dir>           pack a directory (--origin <sb3> for non-asset extras)
fractch check <dir>                     parse and lint; file:line errors, exit 1 on problems
fractch fmt <dir>                       rewrite files in canonical syntax
fractch watch <dir> [to <sb3>]          repack on save
fractch run <dir>                       watch, serve and open the editor (--editor <url>)
fractch package <dir|sb3> [to <out>]    standalone .html via the MistWarp packager
```

Packing warns about every statement the parser had to skip, so a typo never silently drops blocks. Run `fractch --help` for all options; details are in [docs/cli.md](docs/cli.md).

## API

```js
import { unpackSb3, packSb3 } from 'fractch';

await unpackSb3({ input: './project.sb3', outDir: './project' });
await packSb3({ buildDir: './project', outSb3: './repacked.sb3' });
```

The package's `browser` export condition (or `fractch/browser`) resolves to a build with no Node built-ins. Every function takes an `fs` option, so an in-memory filesystem such as [lightning-fs](https://github.com/isomorphic-git/lightning-fs) works directly:

```js
import LightningFS from '@isomorphic-git/lightning-fs';
import { convertProject, buildProjectFromBuildDir } from 'fractch';

const fs = new LightningFS('fractch');
await convertProject(projectJson, { outDir: '/project', fs });
const { manifest } = await buildProjectFromBuildDir({ buildDir: '/project', fs });
```

`manifest` is a complete `project.json`; zipping it with the assets is left to the host app. Lower-level pieces (`parseFractch`, `buildBlocksFromCalls`, `checkFractch`, `emitScriptFile`, and others) are exported too. See [docs/api.md](docs/api.md).

## Fidelity

Round-trip fidelity is checked against real projects, not just by parsing:

```sh
npm test
node scripts/check-parse.mjs
node scripts/check-roundtrip.mjs [origin.sb3] [buildDir]
```

`check-roundtrip` does a deep structural diff of every rebuilt script against the original and must stay at 100%. Repacked projects load and run in Scratch and TurboWarp.

One cosmetic gap remains by design: the default text hidden behind an already-plugged-in reporter is not preserved. It has no effect on execution, and the editor regenerates the menu shadows itself.

## Documentation

[Getting started](docs/getting-started.md) · [CLI](docs/cli.md) · [Syntax](docs/syntax.md) · [Abstractions](docs/abstractions.md) · [Assets](docs/assets.md) · [API](docs/api.md) · [Architecture](docs/architecture.md) · [Errors](docs/errors.md) · [Packages](docs/packages.md)

## License

MIT
