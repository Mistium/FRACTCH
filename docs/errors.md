# Errors and How to Fix Them

`fractch check <dir>` reports every problem as `file:line:col`, shows the offending source line with a `^` marker, and adds a hint where one helps. Packing prints the same information for anything it has to skip — **a statement the parser can't read is skipped with a warning, never silently dropped.** Exit code 1 means at least one problem.

```txt
Stage/main.fractch:7:10: skipped unparsable statement: 'when flg' is not a known hat - did you mean 'when flag'?
    when flg {
             ^
    hint: valid hats: when flag / when clone / when clicked / when broadcast Name / ...
```

## Parse errors

| Message | Cause & fix |
|---|---|
| `'when X' is not a known hat - did you mean 'when flag'?` | Typo in a hat name. Valid: `flag`, `clone`, `clicked`, `broadcast Name`, `key space`, `backdrop "name"`, or a generic hat call `when ext.hat()`. |
| `expected ',' or ')' after an argument` | Usually a missing `:` between an argument name and its value (`say(MESSAGE 5)` → `MESSAGE: 5`), or a missing comma. |
| `expected ':' after the argument name 'X'` | Arguments are `name: value`. |
| `this string never closes - missing the ending '"'` | Unterminated string. Strings can't contain raw line breaks — write `\n` for a newline, `\"` for a quote. The parser stops the damage at the end of the line, so later statements still parse. |
| `unmatched '}' at the top level` | One `}` too many — usually fallout from an error earlier in that block (fix the first error first). |
| `'x.y' looks like a block but has no (arguments)` | Block calls always take parens: `sensing.timer()`. |
| `lists have no '.append(...)'` | Method typo; statements are `.add .delete .insert .replace .clear .show .hide` (or `lists["x"][i] = v;`), reporters are `[i] .length .contains .indexof`. Suggests the closest name. |
| `sprites have no '.xpos' property` | Property typo; valid: `.x .y .direction .size .volume .costume_number .costume_name .backdrop_number .backdrop_name`, or `.vars["name"]` for that sprite's variables. Suggests the closest name. |
| `expected a value but found ...` | The parser needed an expression: a number, `"string"`, variable name, `vars["..."]`, `lists["..."]`, or a call. Reaching the end of the file here usually means a missing `}` above. |
| `'costume' needs a value` / `expected a "quoted name" after 'sound'` | Statement aliases need their argument: `costume "walk";`, `sound "pop" file "assets/pop.wav";`. |
| `a sound declaration needs 'file' after its name` | Asset declarations are `sound "name" file "path";` — without `file` the parser has no way to know it's a declaration. |

## Project-level problems (`fractch check`)

| Message | Cause & fix |
|---|---|
| `call to undefined custom block @X - did you mean @Y?` | The `@X(...)` call has no matching `def @X` in the same sprite. Fix the typo or add the def. |
| `@X takes N arguments but this call passes M` | Positional call with too many arguments; the hint shows the definition. (Fewer arguments is allowed — missing ones are empty.) |
| `local 'x' is declared twice in the same script` | One `local x = ...` per script; assign with `x = ...` afterwards. |
| `custom block @X is defined more than once in this sprite` | Duplicate `def`; the second silently wins at pack time, so rename one. |
| `costume "x" points at a missing file` | The `file "..."` path doesn't exist under the sprite's folder. Paths are relative to the sprite (`assets/x.png` → `Sprite/assets/x.png`). |
| `two costumes are both named "x"` | Scratch identifies costumes/sounds by name; rename one. |
| `unclosed '(' / mismatched ')' / unterminated string` (lint) | Bracket balance problems, reported with the opening position. Comments (`//`, `/* */`) and string contents are ignored by the balance check. |

## Pack-time warnings

- `skipped unparsable statement: ...` — same messages as above; the statement was left out of the built project. Fix and repack.
- `costume "x": file not found: ... , skipped` — the declaration was dropped because the file is missing.
- `removed N unused costume(s)/sound(s)` (with `--verbose`) — dead-asset pruning; see [assets.md](assets.md). If code picks assets inside extension JavaScript, keep a dynamic reference (e.g. `costume some.reporter();`) so nothing is pruned.

## Tips

- Fix the **first** error in a file before chasing the rest — brace and string errors cascade.
- `fractch check .` in CI (exit code 1 on any problem) keeps broken text from ever reaching an `.sb3`.
- `fractch watch`/`run` print check-style warnings on every save, so mistakes surface the moment you make them.
