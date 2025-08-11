# FRACTCH — Scratch scripts to a custom DSL

This tool converts a Scratch 3 `.sb3` project into a lossless, human-readable DSL called Fractch. The converter is JavaScript (Node.js), but the output is plain `.fractch` text files.

- Input: `originv6.0.0.sb3` (in the repo root)
- Output: `build/` directory with one file per hat/script, grouped by target (sprite/stage) and hat opcode.
- DSL: Each block becomes a call where the function name is the Scratch `opcode`, allowing all extensions to be represented.
- Lossless: All original data is preserved in a header and in `build/manifest.json`.

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
- `manifest.json` capturing the entire Scratch `project.json`

## Fractch DSL overview

- Blocks are encoded as nested calls: `opcode(arg1, arg2, { substack: () => { ... } })`.
- Hats determine folder name; scripts without hats go under `nohat/`.
- Inputs that are reporter blocks nest inline; literal inputs are printed concisely but preserve raw tuples in comments for full fidelity.
- Unknown/extension blocks are fine because the function name is the `opcode`.

Example:

```txt
control_if(operators_equal(10, 10), { substack: () => {
  motion_turnright(degrees: 15)
}})
```

Each `.fractch` file begins with a header comment containing:

- target, targetId
- topBlockId, hatOpcode, threadIndex
- rawLinear: JSON array of the script’s linearized blocks
- rawSubgraph: JSON object of all blocks reachable from the top block

## CLI

```sh
fractch --input ./originv6.0.0.sb3 --out ./build --verbose
```

Options:

- `--input` path to `.sb3`
- `--out` output directory
- `--verbose` extra logs

## Notes

- Read-only conversion; it does not execute projects.
- Multiple hats with same opcode produce separate files by id.
