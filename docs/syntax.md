# Syntax Reference

A `.fractch` file holds any number of scripts plus asset declarations. Both comment styles, `// line` and `/* block */`, become Scratch comments. A comment **attaches** to the block on the line directly below it (or, when it trails code, to that line's block). At the top level of a file or region, a comment followed by a blank line, or with nothing after it, stays a free workspace comment and keeps its place between scripts. A `/* */` comment's text drops a blank first and last line, a ` * ` gutter when every line has one, and the common indentation, so `/**` doc comments read naturally. Semicolons are optional. Generated files may start with a `/** ... */` header comment carrying routing metadata (`target:`, `targetId:` and similar keys); it is optional, never contains block data and never becomes a Scratch comment.

Strings are `"double-quoted"` with `\" \\ \n \t \r` escapes, or `"""raw triple-quoted"""`; raw strings run to the next `"""` with real newlines and no escape processing (emitted automatically for values containing newlines).

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

Scripts can be grouped into regions. A region is a named group that decides which file a script lives in when the project is stored as a folder of `.fractch` files (git trees use one file per region). A script outside any region belongs to `main`.

```txt
region "Enemies" {
  when broadcast spawn at 400,0 {
    clone "Enemy";
  }
}
```

Regions only hold whole scripts and free comments, and can't be nested. Membership is stored in one hidden comment per sprite whose text starts with `_fractch_map_`; it never appears in the text. It also records which file each free comment is in and which script follows it, so comments stay where they were written, and a region holding only comments keeps its file.

The editor writes `locked script "<top block id>";` for a script it could not show as text. The line keeps that script exactly as it is; delete the line to delete the script.

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

Everything a project needs is declarable in code, no manifest required:

```txt
use "pen";                                        // register an extension
use "mistsutils" from "https://extensions.mistium.com/featured/Mist's Utils.js";
platform "Mistwarp" from "https://warp.mistium.com/";   // meta.platform (stage file)

sprite "Cat!" at 100,-50 size 150 direction 45 hidden rotation "left-right" layer 1;
stage tempo 90 volume 80 video off transparency 0 tts "en";   // in the Stage's file

var score = 0;                                    // this target's variable + initial value
var "Fancy // Name" = "";                         // quoted for non-identifier names
var highscores = ["alice", "bob"];                // a list with initial items
var levels = keep;                                // keep the list's current contents (the editor
                                                  // writes this for lists over 100 items or 4 KB)
var temp = "" id "xK3...";                        // explicit id: several vars/lists may share a
                                                  // display name (converted projects only)
cloud total_plays = 0;                            // cloud variable (stage-owned, "☁ " prefixed;
                                                  // read/write it by its bare name)

watch var "score" at 10,10 range 0,100 hidden;    // variable watcher (monitor)
watch var "speed" slider range -5,5 continuous;   // slider mode
watch list "log" at 0,0 size 260x200;             // list watcher
comment "hello" size 350x170;                     // workspace comment
```

- `use` registers an extension id (plus its source URL for custom extensions). Extensions are also auto-detected from opcodes (`mistsutils.patchcommand(...)` registers `mistsutils`), so `use` is mainly for attaching URLs.
- `sprite` takes an optional quoted display name (folder names are sanitized copies) and attributes: `at x,y`, `size`, `direction`, `visible`/`hidden`, `draggable`, `rotation "all around"|"left-right"|"don't rotate"`, `volume`, `layer`, `costume n` (current costume index). `stage` takes `tempo`, `volume`, `video on|off|"on-flipped"`, `transparency`, `tts "lang"`, `costume n`. A costume declaration can carry `current` instead of the index form.
- `var` in a sprite's file makes a for-this-sprite-only variable; in the Stage's file it's global. Assigning to an undeclared name still creates a variable (value 0) and reports it, with a "Declare var" quick fix; reading a name that was never declared is an error in the editor.
- `var x = keep;` keeps whatever the list (or variable) holds right now. Editing a `var` line's value sets the variable when the code is applied; an unedited line leaves the live value alone.
- `watch` declares a stage-monitor for a variable or list of this target: `at x,y`, `size WxH`, `large`/`slider`, `range min,max`, `continuous` (non-discrete slider), `hidden`/`visible`. Converted projects may carry `sprite "name"`/`id "..."` attributes to preserve watchers of since-deleted sprites verbatim.
- `comment` at the top level of a file is a workspace comment; inside a script body it attaches to the preceding statement's block (or to the hat when it's the first line). Attributes: `at x,y`, `size WxH`, `minimized`, and `for "blockId"` (converted projects only: reproduces a comment whose anchor block no longer exists). `//` and `/* */` are the sugar for the common case: they emit `comment` under the hood, and a comment with default position/size (no `at`/`size`/`minimized`/`for`) re-emits as a `//` line when it has one line, or as a `/* */` block when it has several. Attached comments with a position, comments with a non-default size, minimized comments, and text that can't be written as `//` or `/* */` (for example text containing `*/`) keep the explicit `comment "..."` form, which leaves out `size` when it is the default 200x200. A free (workspace) comment's position is never written: in the editor's Code mode it keeps the position it has in Blocks mode, and when a folder of files is packed, a free comment without `at` goes in a default slot below the scripts (`x` 0, `y` 200 past the lowest script for each comment, in file then text order, `main.fractch` first). A hand-written `at x,y` is still honoured.
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

Lists are referred to by bare name: the function/`.length` syntax is what makes
it a list operation, so no `lists["name"]` is needed (that form stays available
for names that aren't identifiers):

```txt
append(inv, v);       delete(inv, i);      insert(inv, i, v);
replace(inv, i, v);   clear(inv);          showList(inv);   hideList(inv);

item(inv, i)          // the i-th item (1-based); get(inv, i) is the same
inv.length            hasItem(inv, v)      indexOf(inv, v)
lists["inv"]          // the whole-list contents reporter
```

Because the syntax carries the type, a variable and a list may share a name with
no ambiguity: `inv` is the variable, `append(inv, x)` / `inv.length` are the
list. `length(x)` and `contains(a, b)` stay the *string* operators; list length
is `inv.length` and membership is `hasItem(inv, v)`. The legacy
`lists["inv"].add(v)` / `.length` / `[i]` method forms still parse but re-emit as
the function forms. Packages and their namespaces are in [packages.md](packages.md).

## Expressions

Infix with the usual precedence, left-associative: `||` < `&&` < `== != < > <= >=` < `++` (string join) < `+ -` < `* / %`. Prefix `!` negates. `++` and `+` are distinct because Scratch's join and add are different blocks.

For join chains, a template such as `` `Packed ${order} (${position})` `` compiles to the same left-associated `operator_join` blocks. The source generator uses it only when it preserves every join; ordinary `++` remains available. See [High-level abstractions](abstractions.md).

`buffer ++= " ";` compiles to `buffer = buffer ++ " ";`, a `data_setvariableto` containing an `operator_join`. It differs from numeric `buffer += 1;`, which uses Scratch's `data_changevariableby` block.

```txt
if score >= 10 && !sensing.mousedown() {
  say "total: " ++ (score * 2);
}
```

Chains of the same operator such as `a + b + c` or `x ++ y ++ z` are one block in MistWarp (a variadic operator); the text writes them as a chain and the editor builds them back as one block. `+ - * / % ++ && ||` all chain this way.

Functions: `length(s)`, `contains(a, b)`, `random(from, to)`, `clamp(n, min, max)`, `round(n)`, `min(...)`, `max(...)`, and the math ops `abs floor ceiling sqrt sin cos tan asin acos atan ln log exp exp10`. `pi()` and `newline()` are the MistWarp constant blocks.

Reporters with no inputs are written as calls: `xPosition() yPosition() direction() size() volume() costumes() answer() timer() loudness() mouseX() mouseY() mouseDown() username() daysSince2000()`, `costumeNumber() costumeName() backdropNumber() backdropName()`, `currentYear() currentMonth() currentDate() currentDayOfWeek() currentHour() currentMinute() currentSecond()`. Menu reporters: `touching("Sprite") touchingMouse() touchingEdge() distanceTo("Sprite") distanceToMouse() keyPressed("space") touchingColor(c) colorTouchingColor(a, b)`. `not(x)` parses too, but `!x` / `!=` / `<=` / `>=` are preferred. The letter-of-string reporter is a method: `s.letter(i)` (1-based); the legacy `letter(i, s)` function form still parses but re-emits as `s.letter(i)`.

Another sprite's state reads like the list syntax (this is `sensing_of` under the hood):

```txt
sprites["Player"].x            sprites["Player"].y           sprites["Player"].direction
sprites["Player"].size         sprites["Player"].volume
sprites["Player"].costumeNumber    sprites["Player"].costumeName
sprites["_stage_"].backdropNumber  sprites["_stage_"].backdropName
sprites["Player"].vars["hp"]   // that sprite's variable
```

`true` and `false` are usable anywhere a boolean block fits (they pack as `0 == 0` / `0 == 1`).

`null` is an empty input slot, such as the condition of `if null { ... }` or the slot in `not(null)`. It packs as no input at all, the same as a slot you left empty in the editor. Use `""` when you want empty text. Empty text in a boolean slot (`if "" { ... }`) is packed as an empty slot too, because Scratch can't put text there.

Array (and object) literals in expression position are JSON text sugar: `[1, 2, "three"]` packs as the plain string `[1,2,"three"]`, the shape the JSON helper blocks and the stdlib consume. Emission re-sugars any string input holding canonical JSON array/object text. (Legacy raw primitive tuples like `[10, "x"]` (2 to 3 entries, type code first, string second) still pass through verbatim.)

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

Modules are written in fractch itself with vanilla blocks only (reporter custom blocks need TurboWarp/MistWarp `return`; no extensions). At pack time the imported module's `def`s are injected into the target (deduped: a def the target declares itself wins) and marked so converting the `.sb3` folds them back into the `import` line. Using a method without the import auto-injects its module; the import line is for explicitness. Library bodies are pinned: editor edits to injected defs are replaced by the bundled source on the next convert+pack.

Methods: `split`/`join` (`fractch/strings`), `item`/`count`/`push` (`fractch/json`). `value.method(...)` on a bare identifier resolves at pack time: if a variable/local/param of that name exists it's a method call, otherwise it's the extension opcode (`mistsutils.item(C: 1, ...)` keeps working; keyed args always mean an opcode call, and raw `ns_method(...)` is the explicit escape hatch). Scratch caveat: string comparison is case-insensitive, so `split` matches its delimiter case-insensitively.

## Statements

Control flow:

```txt
if c { } else if c2 { } else { }              // else-if chains nest if_else blocks
forever { }              repeat n { }         for i in n { }        break;
every 0.03 seconds { }   // forever with a leading wait block
for value in items { }   // iterate over a declared list
for value in items using index { } // also expose its 1-based index
for ch of message { } // length + letter lookup, with ch reused as counter
for ch of message using index { } // separate 1-based counter
until c { }              while c { }          wait n;          waitUntil c;
switch v { case x { } case y fallthrough { } default { } }
stop all;   stop otherScriptsInSprite;
return;                  // stop this script (works in any script)
return v;                // reporter custom-block return
broadcast Name;          broadcastWait Name;
```

Aliases (each is exactly one Scratch block):

```txt
say e;          say e for n;      think e;      think e for n;    ask e;
move n;         turn n;           turnLeft n;   point n;          gotoXY x, y;
goto "Sprite";  gotoMouse;        gotoRandom;   glideXY s, x, y;  glideTo s, "Sprite";
glide s to "Sprite";              glide s to x, y;
pointTowards "Sprite";            pointTowardsXY x, y;              pointTowardsXYFrom x, y, fromX, fromY;
setX n;  setY n;  changeX n;  changeY n;  setSize n;  changeSize n;   ifOnEdgeBounce;
setEffect ghost to 50;   changeEffect brightness by 25;   clearEffects;
costume "name";  nextCostume;   backdrop "name";  backdropAndWait "name";  nextBackdrop;
clone;  clone "sprite";  deleteClone;
goFront;  goBack;  goForward n;  goBackward n;
show;  hide;  resetTimer;
playSound "pop";  playSoundUntilDone "pop";  stopAllSounds;  clearSoundEffects;
setSoundEffect pitch to 10;  changeSoundEffect pitch by 10;  setVolume n;  changeVolume n;
setRotationStyle "left-right";  setDragMode "draggable";  showVariable score;  hideVariable score;
penUp;  penDown;  penClear;  stamp;  setPenColor c;  setPenSize n;  changePenSize n;
```

The emitted spelling is camelCase. The older snake_case spellings (`set_x`, `go_front`, `glide_to`, `play_sound`, `wait_until`, ...) still parse, so old files keep working, but they are never written.

## Every other block: generic calls

Any block, extensions included, is a call named by its opcode, with the first underscore written as a dot:

```txt
motion.changexby(DX: 10);                          // opcode motion_changexby
mistsutils.patchcommand("console.log(1)");         // extension blocks work the same
mistsutils.replaceall(C: text, A: "a", B: "b");    // keyed form for non-A,B,C input names
```

- Positional arguments map to input names by order: `A`, `B`, `C`, ..., the near-universal extension convention. Blocks whose real input names differ (or that carry fields/mutations) use the keyed form; the converter picks automatically.
- One exception keeps menus unambiguous: an *inline* call with a single plain-string argument (`ns.op("text")` inside a value slot) means a menu shadow, so single-string-input reporters keep their `A:` label there. As a statement, `mistsutils.patchcommand("...")` is always the positional input form.
- `name: value` arguments are Scratch **inputs** (may nest reporters).
- `field name: value` arguments are Scratch **fields** (dropdowns, variable/list/broadcast pickers). Dropdown values are plain strings: `field EFFECT: "COLOR"`. The `field` keyword may be omitted when the key + value shape already identify one: `VARIABLE: var("x")`, `LIST: list("x")`, `BROADCAST_OPTION: broadcast("x")`.
- Extension "C-blocks" take braces after the call: `ext.myloop(N: 3) { ... }`. Several branches follow each other (`ext.ifelse() { ... } { ... }`) and fill `SUBSTACK`, `SUBSTACK2`, `SUBSTACK3`, ... in order. When a block's branch inputs have other names, or one is missing, each brace is labelled with its input name: `ext.conditional(BRANCH: 15) SUBSTACK15 { ... }`.

### Extension calls with signatures

In the MistWarp editor the loaded extensions' `getInfo()` is known, and extension calls use it:

- positional arguments follow the block's argument order: `myext.add(1, 2)` fills the first and second argument, whatever their names are
- argument names match exactly first; a different case is accepted when it folds to exactly one argument of that block
- a string for a menu argument becomes the menu's value, both for dropdown menus and for menus that accept reporters
- a reporter or boolean used as a statement, or a command used as a value, is an error

The editor writes the positional form when every argument is present in order. Without signatures (the CLI, git trees, extensions that aren't loaded) the rules above this section apply and the keyed form is used.

### Project assets

MistWarp's project asset blocks have a built-in signature, so they always use the positional form. The asset name comes first, and a trailing dropdown left at its default is omitted:

```txt
say assets.get("data/level1.txt");         // text of the asset
say assets.get("logo.png", "size");        // text, data uri, base64, url, size, format or folder
assets.set("save.json", "{}");             // as text; add "base64" or "url" for the other formats
assets.load("logo.png");                   // as a costume; "sound" loads it as a sound
if assets.check("logo.png", "is loaded") { assets.unload("logo.png"); }
say assets.byte("data.bin", 1);
say assets.infolder("data");
say assets.allnames();
assets.delete("old.txt");
assets.unloadall();
```

The keyed form (`assets.get(ASSET: assets.menu("a.txt"), field PROPERTY: "text")`) still builds.

### Dropdown menus inside inputs

A menu shadow block is a call with one positional argument; its field takes the name of the enclosing input:

```txt
sensing.keypressed(KEY_OPTION: sensing.keyoptions("space"));
sound.play(SOUND_MENU: sound.sounds_menu("pop"));
```

When the menu's field name differs from the input name, spell it out: `shadow ext.menu_thing(field other_key: "x")`.

### Values hidden under a reporter

When you drop a reporter or variable into a slot, Scratch keeps the value that was there underneath it, and puts it back when you drag the reporter out. The text writes that hidden value after `??`, in parentheses:

```txt
say (answer() ?? "Hello there");          // the say block still holds "Hello there"
costume (costumeName() ?? "walk 2");      // the costume menu under the reporter
setX (x * 2 ?? -30);
x = (`${x}!` ?? "kept");
loops.repeat(TIMES: (@count() ?? 3)) { ... }
goto (answer() ?? shadow sensing.of_object_menu(field OBJECT: "Cat"));
```

The hidden value is only written when it differs from what the block has when you take it from the palette. `say (answer() ?? "Hello!")` is written as `say answer();`, and packing puts `"Hello!"` back under the reporter. An empty hidden value, or none at all, is also left out and comes back as the palette default. For a menu, a plain string means the input's usual menu (`looks.costume` for `costume`); any other shadow block is written out in full. Extension blocks, whose palette defaults aren't known outside the editor, write any hidden value under a reporter, empty text included.

Deleting the `?? value` part sets the slot back to the palette default. Menus whose palette value depends on the project have no default: costumes, backdrops, sounds, assets and broadcasts. Without `??` their slot keeps nothing under the reporter, so it is empty once the reporter is dragged out. The same goes for extension inputs and for slots that have no palette default.

The hidden value is a string, a number, a `broadcast("name")` or a shadow block. A variable, a list or an expression can't be hidden under a reporter, and condition slots (`if`, `until`, `!`, `&&`, `||`, boolean custom block arguments) never hold a hidden value; both are errors. `??` after a plain value, as in `say ("a" ?? "b")`, has nothing to hide under and is ignored with a warning.

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

- `danglingNext("id");` preserves a broken forward reference from a corrupted project rather than dropping it.
- `reporter() ?? value` without parentheses is the older spelling of a hidden value and still parses in any argument position.
- `(@reporter());` on its own in a `script` is a custom block call that sits loose on the workspace in its reporter shape.
- `key= value` legacy input separator and raw `opcode_names` still parse.
