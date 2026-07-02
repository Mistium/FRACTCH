# Fractch Documentation

Fractch converts Scratch 3 / TurboWarp `.sb3` projects into a lossless, human-readable text language (`.fractch` files) and packs them back. The text is the source of truth — the `.sb3` is a build artifact.

- [Getting started](getting-started.md) — install, scaffold, edit, run
- [CLI reference](cli.md) — every command and flag
- [Syntax reference](syntax.md) — the full `.fractch` language
- [Assets](assets.md) — costumes, sounds, and unused-asset pruning
- [Errors](errors.md) — every error message, what it means, how to fix it
- [Programmatic API](api.md) — Node and browser usage
- [Architecture](architecture.md) — how the round trip works, for contributors

## The one-minute version

```sh
npm install -g fractch
fractch new my-game && cd my-game
```

`Stage/main.fractch`:

```txt
when flag {
  local greeting = "hello from fractch";
  say greeting for 2;
}
```

```sh
fractch run .        # opens the MistWarp editor, repacks on every save
fractch my-game.sb3 from .   # or just build the .sb3
```

Existing project? `fractch from game.sb3 to ./game`, commit `./game`, treat the `.sb3` as output.
