// The fractch standard library: bundled modules of custom-block helpers,
// written in fractch itself and implemented with vanilla blocks only (no
// extensions; reporter custom blocks need TurboWarp/MistWarp `return`).
//
// `import "fractch/strings";` at the top of a target file injects that
// module's defs into the target at pack time (deduped by proccode), and
// `value.split(",")` method sugar desugars to calls of those defs. Using a
// method without the import auto-injects the module too - the import line is
// for explicitness.
//
// Injected defs carry a file marker (STDLIB_STEM_PREFIX + module id) on their
// top block id, so converting an .sb3 back to text folds them into a single
// `import` line instead of re-emitting the library bodies. That makes the
// library version pinned: edits made to the injected defs inside the editor
// are replaced by the bundled source on the next convert+pack cycle.
//
// Data convention: "arrays" are JSON array text (`["a","b"]`), the same shape
// array literals pack to. One vanilla-Scratch caveat applies throughout:
// string comparison in Scratch is case-insensitive, so `split` matches its
// delimiter case-insensitively.

export const STDLIB_STEM_PREFIX = 'fractch_lib/';

// Local copy of buildBlocks' synthesizeProccode (importing it would create a
// parse -> stdlib -> buildBlocks -> parse module cycle). Keep in sync.
function synthesizeProccode(ident, paramCount) {
  const label = String(ident).trim() || 'proc';
  return paramCount ? `${label} ${Array(paramCount).fill('%s').join(' ')}` : label;
}

const JSON_SOURCE = `
// fractch/json - helpers over JSON array text (["a","b"]).

// Number of top-level elements in a JSON array.
def @fractch_json_count(json) returns=1 warp {
  if length(json) < 3 {
    return 0;
  }
  local n = length(json);
  local i = 2;
  local depth = 0;
  local instr = "n";
  local esc = "n";
  local k = 1;
  until i > n - 1 {
    local ch = letter(i, json);
    if instr == "y" {
      if esc == "y" {
        esc = "n";
      } else if ch == "\\\\" {
        esc = "y";
      } else if ch == "\\"" {
        instr = "n";
      }
    } else if ch == "\\"" {
      instr = "y";
    } else if ch == "[" || ch == "{" {
      depth += 1;
    } else if ch == "]" || ch == "}" {
      depth -= 1;
    } else if ch == "," && depth == 0 {
      k += 1;
    }
    i += 1;
  }
  return k;
}

// The index-th (1-based) top-level element of a JSON array. String elements
// come back decoded; numbers, booleans and nested arrays/objects come back as
// their raw JSON text. Out of range returns "".
def @fractch_json_item(json, index) returns=1 warp {
  local n = length(json);
  local i = 2;
  local depth = 0;
  local instr = "n";
  local esc = "n";
  local k = 1;
  local cur = "";
  local done = "n";
  if n < 3 {
    return "";
  }
  until i > n - 1 || done == "y" {
    local ch = letter(i, json);
    if instr == "y" {
      if k == index {
        cur = cur ++ ch;
      }
      if esc == "y" {
        esc = "n";
      } else if ch == "\\\\" {
        esc = "y";
      } else if ch == "\\"" {
        instr = "n";
      }
    } else if ch == "\\"" {
      instr = "y";
      if k == index {
        cur = cur ++ ch;
      }
    } else if ch == "[" || ch == "{" {
      depth += 1;
      if k == index {
        cur = cur ++ ch;
      }
    } else if ch == "]" || ch == "}" {
      depth -= 1;
      if k == index {
        cur = cur ++ ch;
      }
    } else if ch == "," && depth == 0 {
      if k == index {
        done = "y";
      }
      k += 1;
    } else if k == index {
      cur = cur ++ ch;
    }
    i += 1;
  }
  if k < index {
    return "";
  }
  if !(letter(1, cur) == "\\"") {
    return cur;
  }
  local m = length(cur) - 1;
  local r = "";
  local j = 2;
  until j > m {
    local c = letter(j, cur);
    if c == "\\\\" {
      j += 1;
      local e = letter(j, cur);
      if e == "n" {
        r = r ++ "\\n";
      } else if e == "t" {
        r = r ++ "\\t";
      } else if e == "r" {
        r = r ++ "\\r";
      } else {
        r = r ++ e;
      }
    } else {
      r = r ++ c;
    }
    j += 1;
  }
  return r;
}

// A copy of the JSON array with value appended as a string element.
def @fractch_json_push(json, value) returns=1 warp {
  local escd = "";
  local vi = 1;
  local vn = length(value);
  until vi > vn {
    local c = letter(vi, value);
    if c == "\\\\" {
      escd = escd ++ "\\\\\\\\";
    } else if c == "\\"" {
      escd = escd ++ "\\\\\\"";
    } else {
      escd = escd ++ c;
    }
    vi += 1;
  }
  if length(json) < 3 {
    return "[\\"" ++ escd ++ "\\"]";
  }
  local inner = "";
  local i = 2;
  local n = length(json);
  until i > n - 1 {
    inner = inner ++ letter(i, json);
    i += 1;
  }
  return "[" ++ inner ++ ",\\"" ++ escd ++ "\\"]";
}
`;

const STRINGS_SOURCE = `
// fractch/strings - text helpers returning/consuming JSON array text.

// Split text on delim into a JSON array. An empty delim yields the whole
// text as a single element. Delimiter matching is case-insensitive (Scratch
// string comparison).
def @fractch_strings_split(text, delim) returns=1 warp {
  local out = "";
  local cur = "";
  local i = 1;
  local n = length(text);
  local dn = length(delim);
  until i > n {
    local hit = "n";
    if dn > 0 && !(i + dn - 1 > n) {
      hit = "y";
      local j = 1;
      until j > dn {
        if !(letter(i + j - 1, text) == letter(j, delim)) {
          hit = "n";
          j = dn;
        }
        j += 1;
      }
    }
    if hit == "y" {
      if !(out == "") {
        out = out ++ ",";
      }
      out = out ++ "\\"" ++ cur ++ "\\"";
      cur = "";
      i += dn;
    } else {
      local ch = letter(i, text);
      if ch == "\\\\" {
        cur = cur ++ "\\\\\\\\";
      } else if ch == "\\"" {
        cur = cur ++ "\\\\\\"";
      } else {
        cur = cur ++ ch;
      }
      i += 1;
    }
  }
  if !(out == "") {
    out = out ++ ",";
  }
  out = out ++ "\\"" ++ cur ++ "\\"";
  return "[" ++ out ++ "]";
}

// Join a JSON array's elements with delim.
def @fractch_strings_join(json, delim) returns=1 warp {
  local total = @fractch_json_count(json);
  local out = "";
  local i = 1;
  until i > total {
    if i > 1 {
      out = out ++ delim;
    }
    out = out ++ @fractch_json_item(json, i);
    i += 1;
  }
  return out;
}
`;

export const STDLIB_MODULES = {
  'fractch/json': { deps: [], source: JSON_SOURCE },
  'fractch/strings': { deps: ['fractch/json'], source: STRINGS_SOURCE },
};

// value.method(...) sugar -> the stdlib def that implements it. argc counts
// the def's parameters INCLUDING the receiver.
export const STDLIB_METHODS = {
  split: { module: 'fractch/strings', ident: 'fractch_strings_split', argc: 2 },
  join: { module: 'fractch/strings', ident: 'fractch_strings_join', argc: 2 },
  item: { module: 'fractch/json', ident: 'fractch_json_item', argc: 2 },
  count: { module: 'fractch/json', ident: 'fractch_json_count', argc: 1 },
  push: { module: 'fractch/json', ident: 'fractch_json_push', argc: 2 },
};

// proccode -> method name, for re-sugaring procedures_call blocks on emission.
export const STDLIB_PROCCODE_TO_METHOD = new Map(
  Object.entries(STDLIB_METHODS).map(([method, m]) => [synthesizeProccode(m.ident, m.argc), method])
);

// Expand a module list to include dependencies, in injection order.
export function resolveStdlibModules(ids) {
  const out = [];
  const seen = new Set();
  const visit = (id) => {
    if (seen.has(id) || !STDLIB_MODULES[id]) return;
    seen.add(id);
    for (const dep of STDLIB_MODULES[id].deps) visit(dep);
    out.push(id);
  };
  for (const id of ids || []) visit(id);
  return out;
}
