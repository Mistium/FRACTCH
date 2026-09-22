# Source generator differences on public MistWarp projects

These patches are actual `.fractch` source generated from three public MistWarp projects. The `a/` lines come from FRACTCH commit `8d01efa` (before the readable syntax changes); the `b/` lines come from this change. Each side was generated from the **same project snapshot**. Assets and project JSON are absent from the patches because the comparison is only about generated Fractch text.

[Read the focused before/after review](READABILITY-REVIEW.md) for representative project code and the next exact syntax opportunities found in the generated files.

| Public project | Project JSON SHA-256 | Blocks | Top-level scripts | Round trip | Patch |
| --- | --- | ---: | ---: | ---: | --- |
| [MistWeather](https://mistwarp.org/p1790113566017431000QhrNe7) | `635255eae2890221be9d8dc8976d863415cbbe597197ef9641334465493fcdb0` | 145 | 11 | 11/11 | [mistweather.patch](mistweather.patch) |
| [TOP 10](https://mistwarp.org/p1790047691691549000NM6ZP1) | `0635438600d83c876668cc8634168701e725835d5358a815507ff06159b9780d` | 142 | 15 | 15/15 | [top-10.patch](top-10.patch) |
| [Mario Bros Commercial Remake](https://mistwarp.org/p1790007347770079000Hj9vVZ) | `348b03deec59d8a4d074e9843d498a9fdd82ba283e3450a8918ad8638609189f` | 341 | 57 | 57/57 | [mario-bros-commercial.patch](mario-bros-commercial.patch) |

`Round trip` counts top-level scripts whose Scratch block trees rebuild with no structural difference. It covers all 83 scripts in these snapshots. The [order fulfilment example](../order-fulfilment/README.md) is a separate runnable `.sb3` with list iteration and block comments containing short Fractch snippets.

For example, MistWeather now emits:

```fractch
on message cancel {
  stage.backdrop = "cancel";
  pen.clear();
  sound.playUntilDone("Disconnect");
  stop all;
}
```

TOP 10 changes `glideXY 0.6, 0, -14;` into `self.glideTo(0, -14, 0.6);`, and Mario Bros Commercial Remake changes broadcast, position, size, and costume blocks into the corresponding `emit` and `self` forms. Some costume menu calls remain generic because they carry editor-specific menu data; the source generator preserves that data.

## Reproduction

Fetch each project's `project.json` from `https://api.mistwarp.org/v1/projects/<id>/project.json` and its content-addressed assets from the `assetsBase` field of `https://api.mistwarp.org/v1/projects/<id>`. Place the JSON and assets at the root of an `.sb3` ZIP. Then run both versions of the CLI against the same archive:

```sh
node bin/cli.js from project.sb3 to generated
node scripts/check-roundtrip.mjs project.sb3 generated
```

The source was fetched on 22 September 2026. Public projects can change after that date; the JSON hashes above identify the exact snapshots used here.
