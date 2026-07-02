# Getting Started

## Install

```sh
npm install -g fractch
```

(Or use it from a checkout: `node ./bin/cli.js ...` — every example below accepts either form.)

## Start a new project

```sh
fractch new my-game
cd my-game
git init
```

This scaffolds:

```txt
my-game/
  .gitignore            # ignores *.sb3 - the text is the source of truth
  Stage/
    main.fractch
```

Every folder directly under the project root is a sprite (the `Stage` folder is the stage). A target's code lives in `main.fractch` by default, but you can add as many `.fractch` files and subfolders as you like — `Stage/systems/ui.fractch` works and survives round trips.

## Convert an existing project

```sh
fractch from game.sb3 to ./game
```

You get one folder per sprite, each with a `main.fractch` containing all of its scripts in `when`/`def` form, plus an `assets/` folder with the costumes and sounds under readable names.

## The edit loop

```sh
fractch run .
```

packs the project, serves it on localhost, and opens the MistWarp editor pointed at it (`--editor <url>` for any TurboWarp-family editor). Edit `.fractch` files, save, refresh the editor tab. Every save repacks in milliseconds and prints any parse problems with `file:line`.

Without a browser:

```sh
fractch watch . to my-game.sb3    # repack on save
fractch check .                   # lint + parse everything, exit 1 on problems
fractch my-game.sb3 from .        # one-off build
```

## A taste of the language

```txt
costume "player" file "assets/player.svg" center 48,50;
sound "jump" file "assets/jump.wav";

when flag {
  score = 0;
  goto 0, -100;
  forever {
    if sensing.keypressed(KEY_OPTION: sensing.keyoptions("space")) {
      sound.play(SOUND_MENU: sound.sounds_menu("jump"));
      change_y 40;
      score += 1;
      say "score: " ++ score;
    }
  }
}

when broadcast GameOver {
  say "final: " ++ score for 3;
  stop all;
}

def @reset() {
  lists["obstacles"].clear();
  goto 0, -100;
}
```

See the [syntax reference](syntax.md) for everything else.
