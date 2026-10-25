# Errors and How to Fix Them

Every problem fractch reports is a diagnostic with a stable code, a severity, a message in plain words, a hint where one helps, a position (`line`, `column`, `endLine`, `endColumn`, plus `from`/`to` offsets when known) and, where possible, a quick fix (`fix: {title, edits: [{from, to, text}]}`). The codes never change meaning, so editors can link to the rows below (each row has an anchor such as `#fr101`).

`fractch check <dir>` prints every problem as `file:line:col`, shows the offending source line with a `^` marker, and adds the hint. Packing and converting never print anything themselves: `buildProjectFromBuildDir`, `packSb3`, `convertProject` and `unpackSb3` return a `diagnostics` array and the CLI prints it. A file with errors is still packed: only the broken parts are left out.

```txt
Stage/main.fractch:7:10: error FR101: skipped unparsable statement: 'when flg' is not a known hat - did you mean 'when flag'?
    hint: valid hats: when flag / when clone / when clicked / when broadcast Name / ...
```

## How recovery works

The parser never invents scripts. When a statement can't be read, everything up to the end of that line, or up to the matching `}` when the line opened a block, becomes an error region that is left out of the build. When a hat line breaks without opening a block, the statements after it up to the closing `}` are left out too, instead of becoming loose blocks. A missing `}` is reported at the line that opened the block, and parsing resumes at the next `when`, `def` or `script`.

## Codes

| Code | Severity | Title | Cause and fix |
|---|---|---|---|
| <a id="fr100"></a>FR100 | error | Syntax error | The parser expected something else here. The message names what it wanted. |
| <a id="fr101"></a>FR101 | error | Unknown hat | Typo in a hat name. Valid: `flag`, `clone`, `clicked`, `broadcast Name`, `key space`, `backdrop "name"`, `loudness > n`, `timer > n`, or a generic hat call `when ext.hat()`. The script under the broken hat is left out of the build, never turned into loose blocks. |
| <a id="fr102"></a>FR102 | error | Unterminated string | A string never closes. Strings can not contain raw line breaks: write `\n`, or use a `"""raw"""` string. |
| <a id="fr103"></a>FR103 | error | Unmatched '}' | One `}` too many, usually fallout from an earlier error. Loose statements right before it are left out, because they most likely belong to a block whose opening line broke. |
| <a id="fr104"></a>FR104 | error | Missing '}' | A `{` is never closed. The diagnostic points at the opening line that is missing its `}`, not at the end of the file; the broken script is left out and parsing resumes at the next script. |
| <a id="fr105"></a>FR105 | error | Block call without parentheses | Block calls always take parentheses: `sensing.timer()`. |
| <a id="fr106"></a>FR106 | error | Unknown list method | A list method or list function that does not exist, or a list function without a list. The message suggests the closest name. |
| <a id="fr107"></a>FR107 | error | Unknown sprite property | A sprite property that does not exist. Valid: `.x .y .direction .size .volume .costumeNumber .costumeName .backdropNumber .backdropName`, or `.vars["name"]`. |
| <a id="fr108"></a>FR108 | error | Expected a value | A value was expected: a number, a "string", a name, `vars["..."]`, `lists["..."]` or a call. |
| <a id="fr109"></a>FR109 | error | Expected ',' or ')' | Arguments are separated by commas: usually a missing comma or `:`. |
| <a id="fr110"></a>FR110 | error | Expected ':' after an argument name | Keyed arguments are `name: value`. |
| <a id="fr111"></a>FR111 | error | Statement needs a value | Statement aliases need their argument: `costume "walk";`. |
| <a id="fr112"></a>FR112 | error | Cloud list | Only variables can be cloud: `cloud name = 0;`. |
| <a id="fr113"></a>FR113 | error | Sound declaration without file | Sound declarations are `sound "name" file "path";`. |
| <a id="fr114"></a>FR114 | error | Reserved word | A reserved word can not start a statement in this place. |
| <a id="fr115"></a>FR115 | error | Invalid loop form | A `for` loop is written in a form that does not exist; the message says which part. |
| <a id="fr116"></a>FR116 | error | Wrong method argument count | A standard library method was called with the wrong number of arguments. |
| <a id="fr117"></a>FR117 | error | Unterminated JSON value | A JSON array or object literal never closes. |
| <a id="fr118"></a>FR118 | error | Unterminated template string | A template string never closes. |
| <a id="fr119"></a>FR119 | error | Unbalanced bracket | Bracket balance problem found by the lint pass (`(`, `[` or `{`). |
| <a id="fr120"></a>FR120 | error | Region in the wrong place | `region` is only allowed at the top level of a file, around whole scripts. |
| <a id="fr121"></a>FR121 | error | Invalid locked script line | A `locked script` line names a script that does not exist, or is used outside the editor. |
| <a id="fr122"></a>FR122 | error | Invalid hidden value | The part after `??` is not a plain value or a shadow block (for example a variable or an expression), or it sits in a boolean slot, which never holds a hidden value. |
| <a id="fr123"></a>FR123 | warning | Text with no effect | Part of the text is ignored: `??` after a plain value, a branch label used twice, or a loose `(@reporter());` call that isn't alone in its script. |
| <a id="fr124"></a>FR124 | error | Declaration inside a script | A top-level line such as `var`, `costume`, `import`, `def` or `when` was written inside a script body. Move it out of the `{ }` block. |
| <a id="fr125"></a>FR125 | error | Unclosed block comment | A `/*` comment has no closing `*/`, so the rest of the file would be part of it. Nothing after the `/*` is built, and the editor refuses to apply the text. |
| <a id="fr201"></a>FR201 | error | Unknown block | Unknown block opcode, with the closest known one. Unknown opcodes load as red blocks. |
| <a id="fr202"></a>FR202 | error | Menu used as a statement | A dropdown menu block written on its own. Menus only work inside another block's input. |
| <a id="fr203"></a>FR203 | error | Value used as a statement | A line that is only a value. Show it with `say`, or store it with `name = ...`. |
| <a id="fr204"></a>FR204 | error | Reporter used as a statement | A reporter or boolean used as a statement. Show it with `say ...`, or assign it: `name = ...;`. |
| <a id="fr205"></a>FR205 | error | Unknown input name | The block has no input with that name; the hint lists its inputs. |
| <a id="fr206"></a>FR206 | error | Unknown field name | The block has no field with that name; the hint lists its fields. |
| <a id="fr207"></a>FR207 | error | Invalid menu value | A static menu got a value it does not offer; the hint lists the valid values. |
| <a id="fr208"></a>FR208 | error | Undefined custom block | A call to a custom block with no matching `def`, with the closest name. |
| <a id="fr209"></a>FR209 | error | Wrong argument count | A call passes more arguments than the definition takes; the hint shows the definition and its parameters. |
| <a id="fr210"></a>FR210 | error | Local declared twice | `local x` declared twice in one script. |
| <a id="fr211"></a>FR211 | error | Custom block defined twice | Two definitions of the same custom block in one sprite. |
| <a id="fr212"></a>FR212 | error | Undeclared name | A name that was never declared is read. Quick fix: Declare var. In changed scripts this is an error, never a silent new variable. |
| <a id="fr213"></a>FR213 | info | Variable created by assignment | Assigning to an undeclared name creates a variable. Quick fix: Declare var inserts the declaration line. |
| <a id="fr214"></a>FR214 | error | Unknown list method | The list has no such method. |
| <a id="fr215"></a>FR215 | error | Unknown package function | The imported package has no such function. |
| <a id="fr216"></a>FR216 | error | Unknown variable method | The variable has no such method; variable methods come from the standard library. |
| <a id="fr217"></a>FR217 | error | Extension not loaded | The block belongs to an extension that is not loaded. |
| <a id="fr218"></a>FR218 | error | Unknown extension block | The extension has no block with that name, with the closest one. |
| <a id="fr219"></a>FR219 | error | Unknown extension argument | The extension block has no argument with that name. |
| <a id="fr220"></a>FR220 | error | Deleted declaration is still used | A deleted declaration is still used by blocks or by another sprite's `sprites[...]` read. Put the line back or remove the uses first. |
| <a id="fr221"></a>FR221 | error | Hidden operator values would be lost | The edit would drop values hidden under reporters in a chained operator. Edit that operator in Blocks mode, or keep its number of operands. |
| <a id="fr222"></a>FR222 | info | Declaration created | A variable, list or broadcast will be created. |
| <a id="fr223"></a>FR223 | warning | Not applied from this text | Sprite properties, `use`, `platform`, costumes and sounds are edited in the editor, not from code; the line is ignored. |
| <a id="fr224"></a>FR224 | error | Text would not convert back the same way | The text would not convert back to the same blocks. The hint shows the first differing line. |
| <a id="fr225"></a>FR225 | error | Command used as a value | A command block used as a value. |
| <a id="fr226"></a>FR226 | error | Declared twice | The same variable or list is declared twice. |
| <a id="fr227"></a>FR227 | error | Invalid block structure | Internal consistency check of the built blocks failed. Please report it with the text that caused it. |
| <a id="fr230"></a>FR230 | warning | Comment kept as a workspace comment | A `comment ... for "<block id>"` names a block that is in another script, which this edit leaves unchanged. The comment is kept as a workspace comment instead of being dropped; move it into the script that holds the block. |
| <a id="fr301"></a>FR301 | warning | Asset file problem | An asset declaration points at a missing or invalid file; the asset was skipped. |
| <a id="fr302"></a>FR302 | error | Duplicate asset name | Two costumes or two sounds share a name; Scratch identifies them by name. |
| <a id="fr303"></a>FR303 | warning | Watcher for a missing variable | A watcher names a variable or list that does not exist; it was skipped. |
| <a id="fr304"></a>FR304 | info | Unused assets removed | Unused costumes or sounds were removed while packing (see assets.md). |
| <a id="fr305"></a>FR305 | info | Floating shadows dropped | Floating shadow blocks left behind by editor corruption were dropped while converting. |
| <a id="fr306"></a>FR306 | info | Empty obscured inputs normalized | Empty obscured inputs were normalized to their visible shadow while converting. |
| <a id="fr307"></a>FR307 | info | Membership map unreadable | The membership map comment could not be read; membership fell back to legacy markers, then `main`. |
| <a id="fr308"></a>FR308 | info | File ignored | A file was ignored, or a progress note from pack or convert. |
| <a id="fr309"></a>FR309 | error | Project directory problem | The project directory is missing, not a directory, or holds no `.fractch` files. |
| <a id="fr310"></a>FR310 | error | Standard library problem | A bundled standard library module failed to parse (a bug in fractch). |
| <a id="fr311"></a>FR311 | error | Unreadable file | A file could not be read. |
| <a id="fr312"></a>FR312 | warning | Package method fell back to an opcode | A package call did not resolve and was packed as an extension opcode. |

## Tips

- Fix the first error in a file before chasing the rest; brace and string errors cascade.
- `fractch check .` in CI (exit code 1 on any problem) keeps broken text from reaching an `.sb3`.
- `fractch watch`/`run` print the same diagnostics on every save.
