# Project folders and .mwp files

A fractch project is a folder. Every tool that reads or writes one (the CLI, MistWarp's editor, its history and Code mode) uses the same layout, written by `projectToFiles` and read by `filesToProject`.

```txt
my-game/
  Stage/
    main.fractch          backdrops, stage settings, extensions, scripts
    assets/night.svg
  Player/
    main.fractch          sprite settings, variables, costumes, scripts
    movement.fractch      more scripts for the same sprite (optional)
    assets/walk.svg
  assets/                 custom assets the project carries (MistWarp)
    levels/one.json
  fonts/                  custom fonts (TurboWarp and MistWarp)
    Pixel.ttf
  extensions/             code of custom extensions embedded in the project
    myext.js
  fractch.json            editor details that have no fractch syntax
```

## Folders

- Each sprite and the stage get a folder named after them. Characters other than letters, digits, `-` and `_` become `_`. Names that collide (ignoring case) get `_2`, `_3` and so on.
- `assets`, `fonts` and `extensions` are reserved for the project root, so a sprite with one of those names gets a numbered folder such as `assets_2`. The header at the top of each `.fractch` file names its sprite, so the folder name never has to match.
- Files and folders starting with `.` are ignored, so a `.git` folder can sit next to the project.

## Custom assets

Every file under the root `assets/` folder is a custom asset, named by its path inside that folder (`levels/one.json`). Its asset id is the md5 of its contents, worked out when the project is read. There is nothing to declare.

## fractch.json

`fractch.json` keeps the parts of a project that fractch has no syntax for. It is only written when one of them is present.

| Key | Holds |
|---|---|
| `spriteOrder` | the order of sprites in the sprite list |
| `frames` | frames, per target (`_stage_` is the stage); collapsed frames list the scripts inside them |
| `comments` | where comments sit on the workspace, matched back by their text and the script they are on |
| `fonts` | custom fonts: `family`, `fallback`, and either `file` (under `fonts/`) or `system: true` |
| `extensionStorage` | extension storage for the project (`project`) and per target (`targets`) |
| `origin` | `meta.origin` from project.json |

MistWarp used to write the same data to `mistwarp.json`. That name is still read when there is no `fractch.json`.

## .mwp files

A `.mwp` file is a zip of a project folder. MistWarp may also put two things in it:

- `.git/`: the project's history.
- `mwp.json`: MistWarp's manifest (branch, head commit, project id).

Anything that only needs the project ignores both. `fractch from game.mwp to game` extracts the folder, `fractch game.mwp from game` zips one, and `fractch game.sb3 from game.mwp` packs one straight into an `.sb3`. Zipping a folder leaves out dot folders, `node_modules`, and `.sb3` and `.mwp` files at its top level, and never includes history. An `.mwp` that holds only history (no project files) has to be opened in MistWarp and saved again before fractch can read it.

## Checking a round trip

`verifyProjectFiles({ projectJson, readAsset })` writes the project to files, reads it back, and returns every difference that a reader would notice: a lost script, a changed value, a missing costume or font, a moved comment. Differences that do not change the project are ignored: new block ids, inline variable reporters, default values filled in, the blank costume a target with no costumes gets, and blocks that were never visible. MistWarp runs it before the save window adds a version, and lists the differences before saving.
