# Syntax Reference

A `.fractch` file holds any number of scripts plus asset declarations. Two comment styles: `// line` **attaches** to the block on the line directly below it (or, when it trails code, to that line's block) and round-trips as a Scratch block comment; `/* block */` is pure formatting and never attaches. Use `//` for notes you want in the project, `/* */` for notes you don't. Semicolons are optional. Generated files may start with a `/** ... */` header comment carrying routing metadata — it is optional and never contains block data.

Strings are `"double-quoted"` with `\" \\ \n \t \r` escapes, or `"""raw triple-quoted"""` — raw strings run to the next `"""` with real newlines and no escape processing (emitted automatically for values containing newlines).

## Scripts

```txt
when flag at 0,0 {          // hat scripts; `at x,y` (optional) is the canvas position
  ...
}

def @Name(a, b) {           // custom blocks
  ...
}

script at 100,200 {         // a top-level stack with no hat
  ...
}
```

`when` sugar:

| Form | Scratch hat |
|---|---|
| `when flag` | green flag clicked |
| `when clone` | when I start as a clone |
| `when clicked` | when this sprite clicked |
| `when broadcast Name` / `when broadcast "a b"` | when I receive |
| `when key space` / `when key "up arrow"` | when key pressed |
| `when backdrop "name"` | when backdrop switches to |
| `when any.extension_hat(...)` | any other hat block |

## Project declarations

Everything a project needs is declarable in code — no manifest required:

```txt
use "pen";                                        // register an extension
use "mistsutils" from "https://extensions.mistium.com/featured/Mist's Utils.js";
platform "Mistwarp" from "https://warp.mistium.com/";   // meta.platform (stage file)

sprite "Cat!" at 100,-50 size 150 direction 45 hidden rotation "left-right" layer 1;
stage tempo 90 volume 80 video off transparency 0 tts "en";   // in the Stage's file

var score = 0;                                    // this target's variable + initial value
var "Fancy // Name" = "";                         // quoted for non-identifier names
var highscores = ["alice", "bob"];                // a list with initial items
var temp = "" id "xK3...";                        // explicit id: several vars/lists may share a
                                                  // display name (converted projects only)
cloud total_plays = 0;                            // cloud variable (stage-owned, "☁ " prefixed;
                                                  // read/write it by its bare name)

watch var "score" at 10,10 range 0,100 hidden;    // variable watcher (monitor)
watch var "speed" slider range -5,5 continuous;   // slider mode
watch list "log" at 0,0 size 260x200;             // list watcher
comment "hello" at 50,50 size 350x170;            // workspace comment
```

- `use` registers an extension id (plus its source URL for custom extensions). Extensions are also auto-detected from opcodes (`mistsutils.patchcommand(...)` registers `mistsutils`), so `use` is mainly for attaching URLs.
- `sprite` takes an optional quoted display name (folder names are sanitized copies) and attributes: `at x,y`, `size`, `direction`, `visible`/`hidden`, `draggable`, `rotation "all around"|"left-right"|"don't rotate"`, `volume`, `layer`, `costume n` (current costume index). `stage` takes `tempo`, `volume`, `video on|off|"on-flipped"`, `transparency`, `tts "lang"`, `costume n`. A costume declaration can carry `current` instead of the index form.
- `var` in a sprite's file makes a for-this-sprite-only variable; in the Stage's file it's global. Variables also spring into existence on first assignment (value 0) — `var` is for initial values and lists.
- `watch` declares a stage-monitor for a variable or list of this target: `at x,y`, `size WxH`, `large`/`slider`, `range min,max`, `continuous` (non-discrete slider), `hidden`/`visible`. Converted projects may carry `sprite "name"`/`id "..."` attributes to preserve watchers of since-deleted sprites verbatim.
- `comment` at the top level of a file is a workspace comment; inside a script body it attaches to the preceding statement's block (or to the hat when it's the first line). Attributes: `at x,y`, `size WxH`, `minimized`, and `for "blockId"` (converted projects only: reproduces a comment whose anchor block no longer exists). A `//` comment is the sugar for the common case: it emits `comment` under the hood, and a block comment with default position/size (no `at`/`size`/`minimized`/`for`) re-emits as a `//` line above its block. Positioned or minimized comments keep the explicit `comment "..."` form.
- `platform` sets `meta.platform` in the packed project (MistWarp writes this).

## Variables

```txt
score = 0;                  // set (identifier-safe names)
score += 1;                 // change by
score -= 1;                 // change by the negation
say score;                  // bare reads
vars["Fancy Name!"] = 1;    // any name at all
local temp = 10;            // script-local: packs to a namespaced real
temp += 1;                  // variable (local_1_temp), invisible to other scripts
```

`local` names shadow globals within their script; `vars["name"]` always means the global.

## Lists

```txt
lists["inv"].add(v);        lists["inv"].delete(i);    lists["inv"].insert(i, v);
lists["inv"][i] = v;        lists["inv"].clear();
lists["inv"].show();        lists["inv"].hide();

lists["inv"][i]             // item (expression)
lists["inv"].length         lists["inv"].contains(v)   lists["inv"].indexof(v)
lists["inv"]                // the list-contents reporter
```

## Expressions

Infix with the usual precedence, left-associative: `||` < `&&` < `== != < > <= >=` < `++` (string join) < `+ -` < `* / %`. Prefix `!` negates. `++` and `+` are distinct because Scratch's join and add are different blocks.

```txt
if score >= 10 && !sensing.mousedown() {
  say "total: " ++ (score * 2);
}
```

Functions: `length(s)`, `letter(i, s)`, `contains(a, b)`, `random(from, to)`, `round(n)`, and the math ops `abs floor ceiling sqrt sin cos tan asin acos atan ln log exp exp10`. `not(x)` parses too, but `!x` / `!=` / `<=` / `>=` are preferred.

Another sprite's state reads like the list syntax (this is `sensing_of` under the hood):

```txt
sprites["Player"].x            sprites["Player"].y           sprites["Player"].direction
sprites["Player"].size         sprites["Player"].volume
sprites["Player"].costume_number   sprites["Player"].costume_name
sprites["_stage_"].backdrop_number sprites["_stage_"].backdrop_name
sprites["Player"].vars["hp"]   // that sprite's variable
```

`true` and `false` are usable anywhere a boolean block fits (they pack as `0 == 0` / `0 == 1`).

Array (and object) literals in expression position are JSON text sugar: `[1, 2, "three"]` packs as the plain string `[1,2,"three"]` — the shape the JSON helper blocks and the stdlib consume. Emission re-sugars any string input holding canonical JSON array/object text. (Legacy raw primitive tuples like `[10, "x"]` — 2–3 entries, type-code first, string second — still pass through verbatim.)

## Standard library

```txt
import "fractch/strings";        // at the top of a target's file

when flag {
  parts = "a,b,c".split(",");    // -> ["a","b","c"]   (JSON array text)
  say parts.item(2);             // "b" (1-based; strings decoded)
  say parts.count();             // 3
  parts = parts.push("d");       // ["a","b","c","d"]
  say parts.join(" - ");         // "a - b - c - d"
}
```

Modules are written in fractch itself with vanilla blocks only (reporter custom blocks need TurboWarp/MistWarp `return`; no extensions). At pack time the imported module's `def`s are injected into the target (deduped — a def the target declares itself wins) and marked so converting the `.sb3` folds them back into the `import` line. Using a method without the import auto-injects its module; the import line is for explicitness. Library bodies are pinned: editor edits to injected defs are replaced by the bundled source on the next convert+pack.

Methods: `split`/`join` (`fractch/strings`), `item`/`count`/`push` (`fractch/json`). `value.method(...)` on a bare identifier resolves at pack time: if a variable/local/param of that name exists it's a method call, otherwise it's the extension opcode (`mistsutils.item(C: 1, ...)` keeps working; keyed args always mean an opcode call, and raw `ns_method(...)` is the explicit escape hatch). Scratch caveat: string comparison is case-insensitive, so `split` matches its delimiter case-insensitively.

## Statements

Control flow:

```txt
if c { } else if c2 { } else { }              // else-if chains nest if_else blocks
forever { }              repeat n { }         for i in n { }        break;
until c { }              while c { }          wait n;          wait_until c;
switch v { case x { } case y fallthrough { } default { } }
stop all;   stop other_scripts_in_sprite;
return;                  // stop this script (works in any script)
return v;                // reporter custom-block return
broadcast Name;          broadcast_wait Name;
```

Aliases (each is exactly one Scratch block):

```txt
say e;          say e for n;      think e;      think e for n;    ask e;
move n;         turn n;           turn_left n;  point n;          goto x, y;
pointTowardsXY x, y;              pointTowardsXYFrom x, y, fromX, fromY;
set_x n;  set_y n;  change_x n;  change_y n;  set_size n;  change_size n;
set_effect ghost to 50;   change_effect brightness by 25;   clear_effects;
costume "name";  next_costume;   backdrop "name";  next_backdrop;
clone;  clone "sprite";  delete_clone;
go_front;  go_back;  go_forward n;  go_backward n;
show;  hide;  reset_timer;  pen_up;  pen_down;  pen_clear;  stamp;
```

## Every other block: generic calls

Any block — extensions included — is a call named by its opcode, with the first underscore written as a dot:

```txt
motion.changexby(DX: 10);                          // opcode motion_changexby
mistsutils.patchcommand("console.log(1)");         // extension blocks work the same
mistsutils.replaceall(C: text, A: "a", B: "b");    // keyed form for non-A,B,C input names
```

- Positional arguments map to input names by order: `A`, `B`, `C`, ... — the near-universal extension convention. Blocks whose real input names differ (or that carry fields/mutations) use the keyed form; the converter picks automatically.
- One exception keeps menus unambiguous: an *inline* call with a single plain-string argument (`ns.op("text")` inside a value slot) means a menu shadow, so single-string-input reporters keep their `A:` label there. As a statement, `mistsutils.patchcommand("...")` is always the positional input form.
- `name: value` arguments are Scratch **inputs** (may nest reporters).
- `field name: value` arguments are Scratch **fields** (dropdowns, variable/list/broadcast pickers). Dropdown values are plain strings: `field EFFECT: "COLOR"`. The `field` keyword may be omitted when the key + value shape already identify one: `VARIABLE: var("x")`, `LIST: list("x")`, `BROADCAST_OPTION: broadcast("x")`.
- Extension "C-blocks" take braces after the call: `ext.myloop(N: 3) { ... }`.

### Dropdown menus inside inputs

A menu shadow block is a call with one positional argument; its field takes the name of the enclosing input:

```txt
sensing.keypressed(KEY_OPTION: sensing.keyoptions("space"));
sound.play(SOUND_MENU: sound.sounds_menu("pop"));
```

When the menu's field name differs from the input name, spell it out: `shadow ext.menu_thing(field other_key: "x")`. A reporter plugged over a menu just replaces it — the editor regenerates the hidden default on load.

## Custom blocks

```txt
def @Spin(turns) warp {
  turn turns * 360;
}

when flag {
  @Spin(2);
}
```

Attributes after the parameter list, any order: quoted proccode (only needed when it isn't just the name + `%s` placeholders), `warp` (bare = on), `returns=2` (boolean-shaped reporter custom block; round reporters are inferred from being called in expression position), `color="#hex"`, `at x,y`. A param whose display name isn't a clean identifier is written `ident("Display Name")`; body references use the identifier, or `arg("Display Name")` for names that can't be identifiers.

## Assets

See [assets.md](assets.md):

```txt
costume "walk" file "assets/walk.svg" center 48,50;
sound "pop" file "assets/pop.wav";
```

## Escape hatches you'll see in converted projects

- `dangling_next("id");` — preserves a broken forward reference from a corrupted project rather than dropping it.
- `reporter() ?? menu("x")` — obsolete obscured-shadow form; still parses, no longer emitted.
- `key= value` legacy input separator and raw `opcode_names` — still parse.
