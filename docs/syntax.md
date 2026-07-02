# Syntax Reference

A `.fractch` file holds any number of scripts plus asset declarations. Comments are `// line` and `/* block */`. Semicolons are optional. Generated files may start with a `/** ... */` header comment carrying routing metadata — it is optional and never contains block data.

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

## Variables

```txt
score = 0;                  // set (identifier-safe names)
score += 1;                 // change by
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

## Statements

Control flow:

```txt
if c { } else { }        forever { }          repeat n { }
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
mistsutils.patchcommand(A: "console.log(1)");      // extension blocks work the same
```

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
