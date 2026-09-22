# Readable syntax

Fractch emits these forms when a Scratch block, or a small block pattern, has an exact representation. The corresponding older aliases and generic opcode calls still parse. If a block has extra fields, inputs, a mutation, or a nonmatching pattern, the source generator uses the generic form so packing keeps its shape.

## Events and control

| Fractch | Scratch meaning |
| --- | --- |
| `on flag { ... }`, `on key space { ... }`, `on message "start" { ... }` | Green flag, key press, and broadcast hats |
| `emit "start";`, `emit "start" and wait;` | Broadcast and broadcast with wait |
| `wait until ready;` | Wait until condition |
| `unless done { ... }` | `if not done` |
| `every 1 seconds { ... }` | Forever loop whose first block waits one second |
| `for value in items { ... }` | Walk a declared list, assigning each item to `value` |
| `for (index, value) in items { ... }` | Walk a declared list and expose its one-based index |

`every` emits only for a `forever` loop with a leading `wait` block. `unless` emits only for an `if` whose condition is an `operator_not` block. The list loops emit only for the exact counter, list length, and item lookup block pattern. The existing `repeat n`, `while condition`, and `until condition` forms remain in use.

## Variables and lists

| Fractch | Scratch meaning |
| --- | --- |
| `score++;`, `score--;` | Change variable by `1` or `-1` |
| `score *= 2;`, `score /= 2;` | Set variable to itself multiplied or divided by a value |
| `items.push(value);` | Add to list |
| `items[index]`, `items.last`, `items.random` | Item of list at one-based index, last, or random |
| `items[index] = value;` | Replace list item |
| `delete items[index];` | Delete list item |
| `items.includes(value)`, `items.indexOf(value)` | Contains item and position of item |
| `items.clear();`, `items.show();`, `items.hide();` | Clear list and toggle its monitor |

The older `append`, `item`, `replace`, `delete`, `hasItem`, and related function forms still parse. `lists["name"]` works when a list name is not a legal identifier or collides with a variable. For string indexing, `text[index]` means a letter of text when `text` is a variable; a declared list with the same name takes precedence, so use `vars["text"].letter(index)` to select the string reporter.

## Sprites, stage, sound, and pen

| Fractch | Scratch meaning |
| --- | --- |
| `self.x = 10;`, `self.y += 5;` | Set or change coordinates |
| `self.position = (10, 20);` | Go to coordinates |
| `self.direction = 90;`, `self.face("Player");` | Point in direction or toward target |
| `self.glideTo(10, 20, 1);` | Glide to coordinates over seconds |
| `self.visible = true;`, `self.visible = false;` | Show and hide |
| `self.size = 100;`, `self.size += 10;` | Set or change size |
| `self.costume = "idle";`, `stage.backdrop = "day";` | Switch costume or backdrop |
| `self.effect.ghost = 50;`, `self.effect.ghost += 10;` | Set or change graphic effect |
| `self.layer = front;`, `self.layer = back;`, `self.layer += 1;` | Layer position and forward movement |
| `sound.play("pop");`, `sound.playUntilDone("pop");` | Play sound, optionally waiting |
| `sound.volume = 50;`, `sound.volume += 10;` | Set or change volume |
| `sound.effect.pitch = 20;` | Set sound effect; `+=` changes it |
| `pen.down();`, `pen.up();`, `pen.clear();` | Pen actions |
| `pen.color = "#ff0000";`, `pen.size = 2;`, `pen.size += 1;` | Pen color and size |

Reporter properties also use this notation: `self.x`, `self.y`, `self.direction`, `self.size`, `self.costume`, `stage.backdrop`, and `sound.volume`. Costume and backdrop properties read their **name**; generic opcode syntax remains available for the number variant. Dropdown and menu blocks are retained when they carry information needed by the editor.

## Sensing, text, and operators

| Fractch | Scratch meaning |
| --- | --- |
| `mouse.x`, `mouse.y`, `mouse.down` | Mouse reporters |
| `key.down("space")` | Key pressed reporter |
| `timer.value`, `timer.reset()` | Timer reporter and reset |
| `self.touching("Player")` | Touching target reporter |
| `text[index]` | Letter of string, one-based |
| `text.includes("x")` | String contains substring |
| `text.trim()`, `text.toUpperCase()`, `text.toLowerCase()` | Text transform reporters |
| `text.replace("old", "new")` | String replace reporter |
| `min(a, b)`, `max(a, b)` | Minimum and maximum reporters |
| `PI`, `NEWLINE` | Constant reporter blocks |
| `` `Score: ${score}` `` | A left-associated chain of Scratch join blocks |

Template strings escape literal backticks, backslashes, newlines, and `${` markers. An ordinary join such as `"a" ++ "b"` remains `++` when a template string would merge two distinct Scratch blocks. Variables named `PI` or `NEWLINE` can be accessed with `vars["PI"]` and `vars["NEWLINE"]`.

The [MistWarp source diffs](../examples/mistwarp-diffs/README.md) show these forms in code generated from public projects and give the structural round-trip results.
