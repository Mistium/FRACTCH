# Standard library packages

Packages are bundles of custom-block functions shipped with fractch. Import one
and call its functions through its namespace:

```txt
import "fractch/json";
import "fractch/strings" as s;

when flag {
  say json.get_from("name", msg);   // -> the def @fractch_json_get_from
  say s.replace("a-b", "-", " ");
}
```

- `import "pkg"` binds the namespace after the last path segment (`json`,
  `strings`). `import "pkg" as name` binds it under `name` instead, which also
  side-steps a collision with an extension of the same name.
- Only the functions you actually call are packed, plus the functions they call
  transitively — importing a package never dumps its whole body into a project.
- `namespace.fn(...)` is a normal custom-block call; it round-trips back to the
  same form on convert.

## Return stack

Scratch custom blocks can't take or return a list, so packages that work with
list data communicate through a shared, collision-proof **return stack**:

- `!json:stack` — a list holding a function's list-shaped output.
- `!json:return` — a scalar holding a function's string output.

These are package-internal (the `!` prefix keeps them out of the way of your own
names) and are declared automatically when a package that uses them is imported.
Functions that produce list data leave it on `!json:stack`; read it with
`item(...)`/`.length` or fold it to a string with `strings.join(...)`.

## `fractch/json`

A JSON parser/handler operating over real Scratch lists (JSON is never a string
internally). Public functions:

| Call | Result |
|---|---|
| `json.get_from(key, obj)` | the value stored at `key` (reporter) |
| `json.get_keys(obj)` | leaves the object's keys on the return stack |
| `json.get_values(obj)` | leaves the object's values on the return stack |
| `json.has(key, obj)` | `true`/`false` — is `key` present (reporter) |
| `json.valid(obj)` | `true`/`false` — is `obj` valid JSON (reporter) |
| `json.set(key, value, obj)` | a copy of `obj` with `key` set to `value` (reporter) |

`json.get_data(obj)` (the low-level parser) and `json.construct()` (rebuild a
JSON string from the return stack) are available too, along with the string
helpers `json.slice`/`json.replace` the parser uses internally.

```txt
import "fractch/json";
import "fractch/strings";

when flag {
  say json.get_from("user", msg);
  json.get_keys(msg);
  say strings.join(", ");          // "a, b, c" from the keys on the stack
}
```

## `fractch/strings`

Vanilla string helpers.

| Call | Result |
|---|---|
| `strings.replace(text, old, new)` | `text` with every `old` replaced by `new` |
| `strings.slice(text, start, end)` | substring `start..end` (negative `end` counts from the end) |
| `strings.join(delim)` | the return stack joined into one string with `delim` |

## Authoring a package

A package is a JS module under `src/stdlib/` exporting its source as a
`String.raw` template of fractch `def`s, registered in `src/stdlib/index.js`. A
function named `@fractch_<pkg>_<method>` is exposed as `pkg.method(...)`. Keep
per-function scratch variables `local`; use the return stack (or a `!`-prefixed
name) for anything shared between functions.
