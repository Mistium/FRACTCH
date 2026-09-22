# Multi-block source differences on public MistWarp projects

These patches compare real `.fractch` source generated from the same public MistWarp SB3 snapshots. The `a/` side uses FRACTCH commit `8d01efa`; the `b/` side uses this branch. Scratch-style commands such as `when`, `broadcast`, `costume`, `move`, and `wait` keep their existing names. Only recognized **multi-block patterns** become shorter.

| Public project | Project JSON SHA-256 | Blocks | Structurally identical scripts | Patch |
| --- | --- | ---: | ---: | --- |
| [MistWeather](https://mistwarp.org/p1790113566017431000QhrNe7) | `635255eae2890221be9d8dc8976d863415cbbe597197ef9641334465493fcdb0` | 145 | 11/11 | [mistweather.patch](mistweather.patch) |
| [Mario Bros Commercial Remake](https://mistwarp.org/p1790007347770079000Hj9vVZ) | `348b03deec59d8a4d074e9843d498a9fdd82ba283e3450a8918ad8638609189f` | 341 | 57/57 | [mario-bros-commercial.patch](mario-bros-commercial.patch) |
| [Multiplayer Template](https://mistwarp.org/p1788662745700208000eL7hHP) | `c33e1636f11154d820d2b760678fbd2742de8469dd5285c8963c2eb5dd7b7a5b` | 426 | 30/30 | [multiplayer-template.patch](multiplayer-template.patch) |

[The focused code review](READABILITY-REVIEW.md) shows before-and-after excerpts and identifies further compound patterns in these projects. The separate [order fulfilment example](../order-fulfilment/README.md) is a runnable SB3 demonstrating `for value in list` and `for value in list using index`.

`Structurally identical scripts` counts top-level Scratch block trees rebuilt with no mismatch: **98/98** across these three snapshots. The project JSON hashes identify the exact snapshots, since public projects can change.

## Reproduction

Fetch each project's `project.json` from `https://api.mistwarp.org/v1/projects/<id>/project.json` and its content-addressed assets from the `assetsBase` field of `https://api.mistwarp.org/v1/projects/<id>`. Place the JSON and assets at the root of an `.sb3` ZIP. Then run both versions against the same archive:

```sh
node bin/cli.js from project.sb3 to generated
node scripts/check-roundtrip.mjs project.sb3 generated
```

The snapshots were fetched on 22 September 2026. Only source patches are committed; asset blobs are omitted.
