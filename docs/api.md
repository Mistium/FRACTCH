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
// problems: [{ file, line, message }]
```

## Browser

The package's `browser` export condition resolves to a build with no Node built-ins (also importable explicitly as `fractch/browser`). Every filesystem-touching function takes an `fs` option accepting any node-style or promises-style filesystem — [lightning-fs](https://github.com/isomorphic-git/lightning-fs) works directly:

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

Zip handling stays outside the browser core on purpose — use whatever zip library your app already has. In Node, `unpackSb3`/`packSb3` wrap the same core with adm-zip.

## Lower-level exports

For tools that work on `.fractch` text or Scratch block JSON directly:

| Export | What it does |
|---|---|
| `parseFractch(text)` | text → `{ scripts, calls, assets, errors }` |
| `buildBlocksFromCalls(calls, ctx)` | call tree → Scratch block JSON (`{ topId, blocks }`) |
| `convertProject(projectJson, { outDir, fs })` | project.json → build dir of `.fractch` files |
| `buildProjectFromBuildDir({ buildDir, fs })` | build dir → rebuilt project.json |
| `checkFractch(text)` / `assertValidFractch(text)` | delimiter/string lint |
| `emitScriptFile` / `stringifyBlockCall` / `renderBody` | blocks → DSL text |
| `mergeIntoManifest`, `cleanIdent`, `buildProcByCode`, `synthesizeProccode` | pack plumbing |
| `targetAssetFiles(target)` | md5ext → readable asset filename map |
| `md5hex(bytes)` | the pure-JS md5 used for asset ids |
| `BLANK_SVG`, `BLANK_SVG_ID` | default costume for synthesized projects |
