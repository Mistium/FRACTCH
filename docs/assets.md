# Assets

Costumes and sounds are declared in code and stored per target:

```txt
my-game/
  Player/
    main.fractch
    assets/
      walk.svg
      jump.wav
```

```txt
costume "walk" file "assets/walk.svg" center 48,50;
sound "jump" file "assets/jump.wav";
```

There are no sidecar JSON files and no global asset folder. Declarations appear at the top of the target's `main.fractch` (or any of its `.fractch` files); declaration order is costume order, and the stage's costumes are its backdrops (`backdrop "night" file "..."` also works there).

## Attributes

Only the name and `file` are required. Everything Scratch derives from the bytes — the asset id, md5 filename, data format — is computed at pack time by hashing the file.

| Attribute | Applies to | Meaning | Default |
|---|---|---|---|
| `file "path"` | both | path relative to the target folder | required |
| `center X,Y` | costume | rotation center | `0,0` |
| `bitmap N` | costume | bitmap resolution (PNG art is usually 2) | `1` |
| `rate N` | sound | sample rate | omitted |
| `samples N` | sound | sample count | omitted |
| `format "adpcm"` | sound | compressed format marker | `""` |

Adding art is: drop the file in `assets/`, write one line. A missing or unreadable file is a pack-time warning and the declaration is skipped.

## Unused assets are pruned

Packing removes costumes and sounds the code never references:

- **Constant references count**: `costume "walk";`, `backdrop "night";`, a menu like `sound.sounds_menu("pop")`, a literal string typed into a switch-costume input, `when backdrop "x"` hats.
- **Dynamic use keeps everything**: a reporter plugged into a costume/backdrop/sound slot, `next_costume;`, `next_backdrop;`, or the `"next/previous/random backdrop"` menu specials make every costume (or sound) of that target reachable, so nothing is removed.
- The costume at the target's current-costume index is always kept (it's what the sprite is wearing), and the index is remapped after pruning.
- Backdrop references from *any* sprite protect the Stage's costumes.

`--verbose` on pack logs each removal. Caveat: code that picks costumes/sounds inside extension JavaScript (strings passed to eval-style extension blocks) is invisible to this analysis — if you do that, keep a dynamic reference (e.g. `costume some.reporter();`) or the asset will be treated as unused.

## Round trips

Unpacking an `.sb3` writes each asset once under a readable name (`assets/<costume-name>.<ext>`, deduplicated) and emits matching declarations. Packing hashes those files back to the exact original asset ids, so convert → pack reproduces the original archive's assets byte-for-byte.
