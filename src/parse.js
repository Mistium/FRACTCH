import { STDLIB_METHODS } from './stdlib.js';

// Statement keywords that introduce a control construct instead of a plain
// expression-statement.
function snakeToCamel(s) { return s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase()); }
function camelToSnake(s) { return s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase(); }
function setWithCamel(list) {
  const out = new Set();
  for (const k of list) { out.add(k); const c = snakeToCamel(k); if (c !== k) out.add(c); }
  return out;
}

const STATEMENT_KEYWORDS = setWithCamel([
  'def', 'if', 'forever', 'switch', 'case', 'default', 'repeat', 'until',
  'while', 'wait', 'wait_until', 'stop', 'return', 'broadcast', 'broadcast_wait', 'vars',
  'dangling_next', 'when', 'script', 'lists', 'local', 'sound',
  'use', 'var', 'cloud', 'sprite', 'stage', 'watch', 'comment', 'platform',
  'say', 'think', 'ask', 'show', 'hide', 'move', 'turn', 'turn_left', 'goto', 'glide',
  'gotoXY', 'glideXY', 'changeXY', 'glide_to', 'goto_mouse', 'goto_random', 'glide_to_mouse', 'glide_to_random',
  'point', 'point_towards', 'point_towards_mouse', 'point_towards_random', 'set_x', 'set_y', 'change_x', 'change_y', 'set_size', 'change_size',
  'set_effect', 'change_effect', 'clear_effects', 'if_on_edge_bounce', 'set_rotation_style',
  'costume', 'next_costume', 'backdrop', 'next_backdrop', 'clone', 'clone_myself', 'delete_clone',
  'go_front', 'go_back', 'go_forward', 'go_backward',
  'play_sound', 'play_sound_until_done', 'stop_all_sounds', 'clear_sound_effects',
  'change_sound_effect', 'set_sound_effect', 'change_volume', 'set_volume',
  'set_drag_mode', 'show_variable', 'hide_variable',
  'reset_timer', 'pen_up', 'pen_down', 'pen_clear', 'stamp',
]);

// Zero-argument statement aliases: `show;` -> looks_show().
const SIMPLE_ALIASES = {
  show: 'looks_show', hide: 'looks_hide',
  next_costume: 'looks_nextcostume', next_backdrop: 'looks_nextbackdrop',
  clear_effects: 'looks_cleargraphiceffects',
  delete_clone: 'control_delete_this_clone', reset_timer: 'sensing_resettimer',
  if_on_edge_bounce: 'motion_ifonedgebounce',
  stop_all_sounds: 'sound_stopallsounds', clear_sound_effects: 'sound_cleareffects',
  pen_up: 'pen_penUp', pen_down: 'pen_penDown', pen_clear: 'pen_clear', stamp: 'pen_stamp',
};

// One-argument statement aliases: `move 10;` -> motion_movesteps(STEPS: 10).
const UNARY_ALIASES = {
  say: ['looks_say', 'MESSAGE'], think: ['looks_think', 'MESSAGE'],
  ask: ['sensing_askandwait', 'QUESTION'],
  move: ['motion_movesteps', 'STEPS'],
  turn: ['motion_turnright', 'DEGREES'], turn_left: ['motion_turnleft', 'DEGREES'],
  point: ['motion_pointindirection', 'DIRECTION'],
  set_x: ['motion_setx', 'X'], set_y: ['motion_sety', 'Y'],
  change_x: ['motion_changexby', 'DX'], change_y: ['motion_changeyby', 'DY'],
  set_size: ['looks_setsizeto', 'SIZE'], change_size: ['looks_changesizeby', 'CHANGE'],
  change_volume: ['sound_changevolumeby', 'VOLUME'], set_volume: ['sound_setvolumeto', 'VOLUME'],
};

// Zero-argument aliases that set a fixed dropdown field:
// `go_front;` -> looks_gotofrontback(field FRONT_BACK: "front").
const FIELD_ALIASES = {
  go_front: ['looks_gotofrontback', 'FRONT_BACK', 'front'],
  go_back: ['looks_gotofrontback', 'FRONT_BACK', 'back'],
};

// One-argument aliases with a fixed dropdown field:
// `go_forward 2;` -> looks_goforwardbackwardlayers(NUM: 2, field FORWARD_BACKWARD: "forward").
const UNARY_FIELD_ALIASES = {
  go_forward: ['looks_goforwardbackwardlayers', 'NUM', 'FORWARD_BACKWARD', 'forward'],
  go_backward: ['looks_goforwardbackwardlayers', 'NUM', 'FORWARD_BACKWARD', 'backward'],
};

// Statement aliases whose argument is a dropdown-menu shadow block:
// `costume "walk";` builds looks_switchcostumeto with a looks_costume shadow.
const MENU_ALIASES = {
  costume: ['looks_switchcostumeto', 'COSTUME', 'looks_costume'],
  backdrop: ['looks_switchbackdropto', 'BACKDROP', 'looks_backdrops'],
  clone: ['control_create_clone_of', 'CLONE_OPTION', 'control_create_clone_of_menu'],
  point_towards: ['motion_pointtowards', 'TOWARDS', 'motion_pointtowards_menu'],
  play_sound: ['sound_play', 'SOUND_MENU', 'sound_sounds_menu'],
  play_sound_until_done: ['sound_playuntildone', 'SOUND_MENU', 'sound_sounds_menu'],
};

// `sprites["name"].x` reads another sprite's property via sensing_of.
const SPRITE_PROPS = {
  x: 'x position', y: 'y position', direction: 'direction',
  size: 'size', volume: 'volume',
  costume_number: 'costume #', costume_name: 'costume name',
  backdrop_number: 'backdrop #', backdrop_name: 'backdrop name',
};

// Multi-arg function sugar: `length(x)`, `letter(2, x)`, `random(1, 10)`,
// `contains(a, b)` desugar to their operator blocks.
const FUNC_SUGAR = {
  length: ['operator_length', ['STRING']],
  letter: ['operator_letter_of', ['LETTER', 'STRING']],
  random: ['operator_random', ['FROM', 'TO']],
  contains: ['operator_contains', ['STRING1', 'STRING2']],
};

// Unary math/logic sugar: `name(x)` desugars to a single-arg operator block.
const UNARY_SUGAR = new Set([
  'round', 'not', 'abs', 'floor', 'ceiling', 'sqrt', 'sin', 'cos', 'tan',
  'asin', 'acos', 'atan', 'ln', 'log', 'exp', 'exp10',
]);
const MATHOP_NAME = { exp: 'e ^', exp10: '10 ^' };

// Builtin reporters as function calls: `answer()`, `xPosition()`, `touchingMouse()`.
const REPORTER_NULLARY = {
  xPosition: 'motion_xposition', yPosition: 'motion_yposition', direction: 'motion_direction',
  size: 'looks_size', volume: 'sound_volume',
  answer: 'sensing_answer', timer: 'sensing_timer', loudness: 'sensing_loudness',
  mouseX: 'sensing_mousex', mouseY: 'sensing_mousey', mouseDown: 'sensing_mousedown',
  username: 'sensing_username', daysSince2000: 'sensing_dayssince2000',
};
const REPORTER_FIELD = {
  costumeNumber: ['looks_costumenumbername', 'NUMBER_NAME', 'number'],
  costumeName: ['looks_costumenumbername', 'NUMBER_NAME', 'name'],
  backdropNumber: ['looks_backdropnumbername', 'NUMBER_NAME', 'number'],
  backdropName: ['looks_backdropnumbername', 'NUMBER_NAME', 'name'],
  currentYear: ['sensing_current', 'CURRENTMENU', 'YEAR'],
  currentMonth: ['sensing_current', 'CURRENTMENU', 'MONTH'],
  currentDate: ['sensing_current', 'CURRENTMENU', 'DATE'],
  currentDayOfWeek: ['sensing_current', 'CURRENTMENU', 'DAYOFWEEK'],
  currentHour: ['sensing_current', 'CURRENTMENU', 'HOUR'],
  currentMinute: ['sensing_current', 'CURRENTMENU', 'MINUTE'],
  currentSecond: ['sensing_current', 'CURRENTMENU', 'SECOND'],
};
const REPORTER_MENU_SUGAR = {
  touching: ['sensing_touchingobject', 'TOUCHINGOBJECTMENU', 'sensing_touchingobjectmenu', null],
  touchingMouse: ['sensing_touchingobject', 'TOUCHINGOBJECTMENU', 'sensing_touchingobjectmenu', '_mouse_'],
  touchingEdge: ['sensing_touchingobject', 'TOUCHINGOBJECTMENU', 'sensing_touchingobjectmenu', '_edge_'],
  distanceTo: ['sensing_distanceto', 'DISTANCETOMENU', 'sensing_distancetomenu', null],
  distanceToMouse: ['sensing_distanceto', 'DISTANCETOMENU', 'sensing_distancetomenu', '_mouse_'],
  keyPressed: ['sensing_keypressed', 'KEY_OPTION', 'sensing_keyoptions', null],
};
const REPORTER_FUNC_SUGAR = {
  touchingColor: ['sensing_touchingcolor', ['COLOR']],
  colorTouchingColor: ['sensing_coloristouchingcolor', ['COLOR', 'COLOR2']],
};

const BRANCH_SUBSTACK_OPCODES = new Set([
  'control_forever', 'control_switch', 'control_case', 'control_case_fallthrough',
  'control_default', 'control_repeat', 'control_repeat_until', 'control_while',
]);

const BINARY_OPS = {
  '||': 1, '&&': 2,
  '==': 3, '!=': 3, '<': 3, '>': 3, '<=': 3, '>=': 3,
  '..': 4, '++': 4,
  '+': 5, '-': 5,
  '*': 6, '/': 6, '%': 6,
};
const TWO_CHAR_OPS = new Set(['==', '!=', '<=', '>=', '&&', '||', '..', '++']);
const ONE_CHAR_OPS = new Set(['+', '-', '*', '/', '%', '<', '>']);

const LEGACY_FIELD_KEYS = new Set([
  'AND_WAIT', 'ATTRIBUTE', 'AXIS', 'BROADCAST_OPTION', 'BUTTONS', 'C', 'CLONE_OPTION',
  'COMPRESSIONTYPES', 'CONTROL', 'DISTANCETOMENU', 'DRAG_MODE', 'EFFECT',
  'EFFECTGETMENU', 'EFFECTMENU', 'EFFECTS', 'EXPORT', 'FILETYPE', 'FILE_INFO',
  'FILTER', 'FROM', 'IMG_ATTS', 'INDICES', 'INFO', 'KEYS', 'KEY_OPTION', 'LIST',
  'LOOP', 'METHODS', 'MIPMAPPING', 'ON_OFF', 'OPERATOR', 'PAUSE_UNPAUSE', 'PROP',
  'PROPERTY', 'REMOVE', 'RENDERMODE', 'RGBMenu', 'SRCLIST', 'STOP_OPTION', 'Stype',
  'TO', 'TOUCHINGOBJECTMENU', 'TRANSFORM', 'TYPE', 'Time', 'U', 'V', 'VALUE',
  'VARIABLE', 'VIDEO_STATE', 'WRAP', 'W_H', 'X', 'Y', 'Z', 'blending', 'clearLayers',
  'colorParam', 'compressionLevel', 'culling', 'cursors', 'depthTest', 'enabled',
  'encoding', 'fileType', 'getFileType', 'get_list', 'keys', 'matComponent', 'mic',
  'mouseButton', 'mouseButtons', 'onOff', 'powersOfTwo', 'primitives', 'props',
  'skinAttributes', 'soundProperties', 'state', 'string_types', 'targetMenu',
  'targets', 'types', 'uniformTypes', 'wait', 'writeFileType', 'zipFileType',
  'mutation',
]);

export function parseFractch(content) {
  const text = stripHeader(content);
  const parser = new Parser(text);
  const stmts = parser.parseStatementList(/* stopAtBrace */ false);
  const assets = { costumes: [], sounds: [] };

  // Split the file into scripts: `when ... {}` / `script {}` / `def` each
  // start their own stack; loose statements group into an implicit stack
  // (the classic one-script-per-file format).
  const scripts = [];
  let cur = null;
  const flush = () => {
    if (cur && cur.calls.length) scripts.push(cur);
    cur = null;
  };
  const uses = [];
  const imports = [];
  const varDecls = [];
  const watches = [];
  const comments = [];
  let platform = null;
  let spriteProps = null;
  for (const st of stmts) {
    if (st.type === 'useDecl') {
      uses.push(st);
    } else if (st.type === 'importDecl') {
      imports.push(st.id);
    } else if (st.type === 'varDecl') {
      varDecls.push(st);
    } else if (st.type === 'watchDecl') {
      watches.push(st);
    } else if (st.type === 'commentDecl') {
      // Top-level comment declarations are workspace comments (or orphan
      // block comments via `for "id"`); comments inside script bodies stay
      // in the body and attach to the preceding statement's block.
      comments.push(st);
    } else if (st.type === 'platformDecl') {
      platform = st;
    } else if (st.type === 'spriteDecl') {
      spriteProps = { ...(spriteProps || {}), ...st.props };
    } else if (st.type === 'assetDecl') {
      if (st.kind === 'costume') assets.costumes.push(st.value);
      else if (st.kind === 'sound') assets.sounds.push(st.value);
    } else if (st.type === 'procDef') {
      flush();
      scripts.push({ kind: 'def', calls: [st], x: st.x ?? null, y: st.y ?? null });
    } else if (st.type === 'whenScript') {
      flush();
      scripts.push({ kind: 'explicit', calls: [st.hat, ...st.body], x: st.x, y: st.y });
    } else if (st.type === 'chainScript') {
      flush();
      scripts.push({ kind: 'explicit', calls: st.body, x: st.x, y: st.y });
    } else {
      if (!cur) cur = { kind: 'implicit', calls: [], x: null, y: null };
      cur.calls.push(st);
    }
  }
  flush();

  const calls = scripts.length === 1 ? scripts[0].calls : scripts.flatMap((s) => s.calls);
  return { calls, scripts, assets, uses, imports, varDecls, watches, comments, platform, spriteProps, errors: parser.errors };
}

export function preprocess(text) {
  return stripHeader(text);
}

function stripHeader(text) {
  const s = String(text || '');
  if (s.startsWith('/**')) {
    const end = s.indexOf('*/');
    // Replace the header with an equal number of newlines so reported line
    // numbers still match the file on disk.
    if (end >= 0) {
      const newlines = (s.slice(0, end + 2).match(/\n/g) || []).length;
      return '\n'.repeat(newlines) + s.slice(end + 2);
    }
  }
  return s;
}

class ParseError extends Error {
  constructor(message, hint = null) {
    super(message);
    this.hint = hint;
  }
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[m][n];
}

export function closestMatch(word, candidates, maxDistance = 2) {
  let best = null;
  let bestD = maxDistance + 1;
  for (const c of candidates) {
    const dd = levenshtein(String(word).toLowerCase(), String(c).toLowerCase());
    if (dd < bestD) {
      bestD = dd;
      best = c;
    }
  }
  return best;
}

class Parser {
  constructor(text) {
    this.s = text;
    this.i = 0;
    this.len = text.length;
    this.errors = [];
  }

  fail(message, hint = null) {
    throw new ParseError(message, hint);
  }

  describeHere() {
    if (this.eof()) return 'the end of the file';
    const ch = this.peek();
    if (ch === '\n') return 'the end of the line';
    return `'${ch}'`;
  }

  colAt(pos) {
    let col = 1;
    for (let j = pos - 1; j >= 0 && this.s[j] !== '\n'; j--) col++;
    return col;
  }

  lineAt(pos) {
    let line = 1;
    for (let j = 0; j < pos && j < this.len; j++) if (this.s[j] === '\n') line++;
    return line;
  }

  eof() {
    return this.i >= this.len;
  }
  peek(o = 0) {
    return this.s[this.i + o];
  }
  next() {
    return this.s[this.i++];
  }
  snapshot() {
    return this.i;
  }
  restore(pos) {
    this.i = pos;
  }

  skipWS() {
    for (;;) {
      const ch = this.peek();
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        this.i++;
      } else if (ch === '/' && this.peek(1) === '/') {
        while (!this.eof() && this.peek() !== '\n') this.i++;
      } else if (ch === '/' && this.peek(1) === '*') {
        this.i += 2;
        while (!this.eof() && !(this.peek() === '*' && this.peek(1) === '/')) this.i++;
        if (!this.eof()) this.i += 2;
      } else {
        break;
      }
    }
  }

  skipToEOL() {
    while (!this.eof() && this.peek() !== '\n') this.i++;
    if (!this.eof()) this.i++;
  }

  peekWord() {
    const save = this.i;
    this.skipWS();
    const w = this.tryIdentifier();
    this.i = save;
    return w || '';
  }

  tryIdentifier() {
    this.skipWS();
    const start = this.i;
    if (this.eof() || !/[A-Za-z_]/.test(this.peek())) return null;
    while (!this.eof() && /[A-Za-z0-9_]/.test(this.peek())) this.i++;
    return this.s.slice(start, this.i);
  }

  expectIdentifier(ctx = '') {
    const id = this.tryIdentifier();
    if (id == null) this.fail(`expected a name${ctx ? ` ${ctx}` : ''} but found ${this.describeHere()}`);
    return id;
  }

  expectChar(ch, ctx = '') {
    this.skipWS();
    if (this.peek() !== ch) {
      this.fail(`expected '${ch}'${ctx ? ` ${ctx}` : ''} but found ${this.describeHere()}`);
    }
    this.i++;
  }

  tryChar(ch) {
    this.skipWS();
    if (this.peek() === ch) {
      this.i++;
      return true;
    }
    return false;
  }

  // ---- statements ----

  parseStatementList(stopAtBrace) {
    const stmts = [];
    for (;;) {
      this.skipWS();
      if (this.eof()) break;
      if (this.peek() === '}') {
        if (stopAtBrace) break;
        this.errors.push({
          line: this.lineAt(this.i),
          col: this.colAt(this.i),
          message: "unmatched '}' at the top level",
          hint: 'usually caused by an error earlier in the block above, or one too many closing braces',
        });
        this.i++;
        continue;
      }
      const word = this.peekWord();
      if (word === 'import') {
        // `import "fractch/strings";` in a target file records a stdlib (or
        // future package) import; index.fractch imports are read separately
        // by pack's allow-list scan, so any other import line is inert here.
        const save = this.snapshot();
        this.tryIdentifier();
        this.skipWS();
        if (this.peek() === '"') {
          const id = this.parseStringLiteral();
          this.tryChar(';');
          stmts.push({ type: 'importDecl', id });
          continue;
        }
        this.restore(save);
        this.skipToEOL();
        continue;
      }
      const save = this.snapshot();
      try {
        const stmt = this.parseStatement();
        if (stmt) {
          stmts.push(stmt);
          continue;
        }
      } catch (e) {
        // Malformed statement: skip the offending line and keep going so one
        // bad line doesn't take down the whole file, but record what was
        // skipped so tooling can surface it.
        this.errors.push({
          line: this.lineAt(this.i > save ? this.i : save),
          col: this.colAt(this.i > save ? this.i : save),
          message: e && e.message ? e.message : String(e),
          hint: (e && e.hint) || null,
        });
      }
      this.restore(save);
      this.skipToEOL();
    }
    return stmts;
  }

  parseStatement() {
    this.skipWS();
    if (this.eof()) return null;

    const word = this.peekWord();
    // `sound "name" file ...` is a declaration; `sound.play(...)` is a plain
    // opcode call. Only the string form takes the keyword path.
    let isKeyword = STATEMENT_KEYWORDS.has(word);
    if (word === 'sound' || word === 'use') {
      const save = this.snapshot();
      this.tryIdentifier();
      this.skipWS();
      isKeyword = this.peek() === '"';
      this.restore(save);
    } else if (word === 'var' || word === 'cloud') {
      const save = this.snapshot();
      this.tryIdentifier();
      this.skipWS();
      let named = false;
      if (this.peek() === '"') {
        try {
          this.parseStringLiteral();
          named = true;
        } catch { named = false; }
      } else {
        named = this.tryIdentifier() != null;
      }
      this.skipWS();
      isKeyword = named && this.peek() === '=' && this.peek(1) !== '=';
      this.restore(save);
    } else if (word === 'sprite' || word === 'stage') {
      const save = this.snapshot();
      this.tryIdentifier();
      this.skipWS();
      const attr = this.peekWord();
      isKeyword = this.peek() === '"' ||
        ['at', 'size', 'direction', 'visible', 'hidden', 'draggable', 'rotation', 'volume', 'tempo', 'layer', 'costume', 'video', 'transparency', 'tts'].includes(attr);
      this.restore(save);
    } else if (word === 'watch') {
      const save = this.snapshot();
      this.tryIdentifier();
      this.skipWS();
      const kind = this.peekWord();
      isKeyword = kind === 'var' || kind === 'list';
      this.restore(save);
    } else if (word === 'comment') {
      const save = this.snapshot();
      this.tryIdentifier();
      this.skipWS();
      const next = this.peekWord();
      isKeyword = this.peek() === '"' || ['at', 'size', 'minimized', 'for'].includes(next);
      this.restore(save);
    } else if (word === 'platform') {
      const save = this.snapshot();
      this.tryIdentifier();
      this.skipWS();
      isKeyword = this.peek() === '"';
      this.restore(save);
    }
    if (isKeyword) {
      this.tryIdentifier(); // consume keyword
      return this.parseKeywordStatement(word);
    }

    // Bare assignment sugar: `score = 1;` / `score += 1;` sets a variable by
    // its (identifier-safe) name. `vars["..."]` remains for other names.
    if (word) {
      const save = this.snapshot();
      this.tryIdentifier();
      this.skipWS();
      if (this.peek() === '+' && this.peek(1) === '=') {
        this.i += 2;
        const v = this.parseInputValue();
        this.tryChar(';');
        return makeCall('data_changevariableby', [
          keyedField('VARIABLE', { type: 'ident', name: word }),
          keyedInput('VALUE', v),
        ]);
      }
      // `x -= v` is change-by with the value negated: a literal number
      // negates in place, anything else wraps in `0 - v`.
      if (this.peek() === '-' && this.peek(1) === '=') {
        this.i += 2;
        const v = this.parseInputValue();
        this.tryChar(';');
        const negated =
          v.type === 'number'
            ? { type: 'number', value: -v.value, raw: String(-v.value) }
            : { type: 'call', value: makeCall('operator_subtract', [keyedInput('NUM1', { type: 'number', value: 0, raw: '0' }), keyedInput('NUM2', v)]) };
        return makeCall('data_changevariableby', [
          keyedField('VARIABLE', { type: 'ident', name: word }),
          keyedInput('VALUE', negated),
        ]);
      }
      if (this.peek() === '=' && this.peek(1) !== '=') {
        this.i++;
        const v = this.parseInputValue();
        this.tryChar(';');
        return makeCall('data_setvariableto', [
          keyedField('VARIABLE', { type: 'ident', name: word }),
          keyedInput('VALUE', v),
        ]);
      }
      this.restore(save);
    }

    const expr = this.parseExprStatementHead();
    this.tryChar(';');
    return expr;
  }

  parseAssetDecl(kind, name) {
    const line = this.lineAt(this.i);
    this.tryIdentifier(); // 'file'
    const file = this.parseStringLiteral();
    const value = { name, file, line };
    for (;;) {
      this.skipWS();
      const w = this.peekWord();
      if (w === 'center') {
        this.tryIdentifier();
        this.skipWS();
        value.centerX = this.parseNumberLiteral().value;
        this.tryChar(',');
        this.skipWS();
        value.centerY = this.parseNumberLiteral().value;
      } else if (w === 'bitmap') {
        this.tryIdentifier();
        this.skipWS();
        value.bitmap = this.parseNumberLiteral().value;
      } else if (w === 'rate') {
        this.tryIdentifier();
        this.skipWS();
        value.rate = this.parseNumberLiteral().value;
      } else if (w === 'samples') {
        this.tryIdentifier();
        this.skipWS();
        value.samples = this.parseNumberLiteral().value;
      } else if (w === 'format') {
        this.tryIdentifier();
        this.skipWS();
        value.format = this.parseStringLiteral();
      } else if (w === 'current') {
        // Marks the target's current costume (currentCostume index).
        this.tryIdentifier();
        value.current = true;
      } else {
        break;
      }
    }
    this.tryChar(';');
    return { type: 'assetDecl', kind, value };
  }

  parseNameToken() {
    this.skipWS();
    return this.peek() === '"' ? this.parseStringLiteral() : this.expectIdentifier();
  }

  parseEffectNameToken() {
    this.skipWS();
    return this.peek() === '"' ? this.parseStringLiteral() : parseEffectName(this.expectIdentifier());
  }

  tryAt() {
    this.skipWS();
    if (this.peekWord() !== 'at') return { x: null, y: null };
    this.tryIdentifier();
    this.skipWS();
    const x = this.parseNumberLiteral().value;
    this.tryChar(',');
    this.skipWS();
    const y = this.parseNumberLiteral().value;
    return { x, y };
  }

  parseHatSpec() {
    this.skipWS();
    const word = this.peekWord();
    if (word === 'flag') {
      this.tryIdentifier();
      return makeCall('event_whenflagclicked', []);
    }
    if (word === 'clone' || word === 'cloned') {
      this.tryIdentifier();
      return makeCall('control_start_as_clone', []);
    }
    if (word === 'clicked') {
      this.tryIdentifier();
      return makeCall('event_whenthisspriteclicked', []);
    }
    if (word === 'broadcast' || word === 'receive') {
      this.tryIdentifier();
      const name = this.parseNameToken();
      return makeCall('event_whenbroadcastreceived', [
        keyedField('BROADCAST_OPTION', { type: 'broadcast', name, id: null }),
      ]);
    }
    if (word === 'key') {
      this.tryIdentifier();
      const name = this.parseNameToken();
      return makeCall('event_whenkeypressed', [keyedField('KEY_OPTION', { type: 'array', value: [name] })]);
    }
    if (word === 'backdrop') {
      this.tryIdentifier();
      const name = this.parseNameToken();
      return makeCall('event_whenbackdropswitchesto', [keyedField('BACKDROP', { type: 'array', value: [name] })]);
    }
    if (word === 'loudness' || word === 'timer') {
      const save = this.snapshot();
      this.tryIdentifier();
      this.skipWS();
      if (this.peek() === '>') {
        this.i++;
        const v = this.parseInputValue();
        return makeCall('event_whengreaterthan', [
          keyedField('WHENGREATERTHANMENU', { type: 'array', value: [word.toUpperCase()] }),
          keyedInput('VALUE', v),
        ]);
      }
      this.restore(save);
    }
    if (word && /^[A-Za-z_]+$/.test(word)) {
      const save = this.snapshot();
      this.tryIdentifier();
      this.skipWS();
      if (this.peek() !== '.' && this.peek() !== '(') {
        const near = closestMatch(word, ['flag', 'clone', 'clicked', 'broadcast', 'receive', 'key', 'backdrop']);
        this.fail(`'when ${word}' is not a known hat${near ? ` - did you mean 'when ${near}'?` : ''}`,
          'valid hats: when flag / when clone / when clicked / when broadcast Name / when key space / when backdrop "name" / when some.extension_hat()');
      }
      this.restore(save);
    }
    const e = this.parsePrimary();
    if (e.type === 'call' && e.value.callee.type === 'opcode') return e.value;
    this.fail(`expected a hat after 'when' but found ${this.describeHere()}`,
      'valid hats: when flag / when clone / when clicked / when broadcast Name / when key space / when backdrop "name" / when some.extension_hat()');
  }

  parseKeywordStatement(word) {
    word = camelToSnake(word);
    switch (word) {
      case 'def':
        return this.parseDef();
      case 'if':
        return this.parseIf();
      case 'forever':
        return this.parseSingleBranch('control_forever');
      case 'switch': {
        const value = this.parseInputValue();
        const body = this.parseBraceBody();
        return makeCall('control_switch', [keyedInput('VALUE', value), branchArg('substack', body)]);
      }
      case 'case': {
        const value = this.parseInputValue();
        let fallthrough = false;
        this.skipWS();
        if (this.peekWord() === 'fallthrough') {
          this.tryIdentifier();
          fallthrough = true;
        }
        const body = this.parseBraceBody();
        return makeCall(fallthrough ? 'control_case_fallthrough' : 'control_case', [
          keyedInput('VALUE', value),
          branchArg('substack', body),
        ]);
      }
      case 'default': {
        const body = this.parseBraceBody();
        return makeCall('control_default', [branchArg('substack', body)]);
      }
      case 'repeat': {
        const times = this.parseInputValue();
        const body = this.parseBraceBody();
        return makeCall('control_repeat', [keyedInput('TIMES', times), branchArg('substack', body)]);
      }
      case 'until': {
        const cond = this.parseExpr();
        const body = this.parseBraceBody();
        return makeCall('control_repeat_until', [keyedInput('CONDITION', cond), branchArg('substack', body)]);
      }
      case 'while': {
        const cond = this.parseExpr();
        const body = this.parseBraceBody();
        return makeCall('control_while', [keyedInput('CONDITION', cond), branchArg('substack', body)]);
      }
      case 'wait': {
        const v = this.parseInputValue();
        this.tryChar(';');
        return makeCall('control_wait', [keyedInput('DURATION', v)]);
      }
      case 'wait_until': {
        const v = this.parseExpr();
        this.tryChar(';');
        return makeCall('control_wait_until', [keyedInput('CONDITION', v)]);
      }
      case 'stop': {
        const v = this.parseExpr();
        this.tryChar(';');
        // `stop all;` / `stop this_script;` / `stop other_scripts_in_sprite;`
        // - bare idents map underscores back to the Scratch option names.
        const opt = v.type === 'string' ? v.value : v.type === 'ident' ? v.name.replace(/_/g, ' ') : String(v.value ?? 'all');
        return makeCall('control_stop', [keyedField('STOP_OPTION', { type: 'array', value: [opt] })]);
      }
      case 'return': {
        this.skipWS();
        let v = null;
        if (this.peek() !== ';' && this.peek() !== '\n' && this.peek() !== '}' && !this.eof()) {
          v = this.parseInputValue();
        }
        this.tryChar(';');
        // Bare `return;` is "stop this script" - same behavior in a hat
        // script and inside a custom block. `return value;` is the reporter
        // custom-block return.
        if (!v) return makeCall('control_stop', [keyedField('STOP_OPTION', { type: 'array', value: ['this script'] })]);
        return makeCall('procedures_return', [keyedInput('VALUE', v)]);
      }
      case 'broadcast': {
        const v = broadcastName(this.parseInputValue());
        this.tryChar(';');
        return makeCall('event_broadcast', [keyedInput('BROADCAST_INPUT', v)]);
      }
      case 'broadcast_wait': {
        const v = broadcastName(this.parseInputValue());
        this.tryChar(';');
        return makeCall('event_broadcastandwait', [keyedInput('BROADCAST_INPUT', v)]);
      }
      case 'vars': {
        this.expectChar('[');
        const name = this.parseStringLiteral();
        this.expectChar(']');
        this.skipWS();
        let op = null;
        if (this.peek() === '+' && this.peek(1) === '=') {
          this.i += 2;
          op = '+=';
        } else if (this.peek() === '=' && this.peek(1) !== '=') {
          this.i++;
          op = '=';
        }
        if (op) {
          const v = this.parseInputValue();
          this.tryChar(';');
          return makeCall(op === '+=' ? 'data_changevariableby' : 'data_setvariableto', [
            keyedField('VARIABLE', { type: 'array', value: [name] }),
            keyedInput('VALUE', v),
          ]);
        }
        const expr = this.parseBinaryFrom({ type: 'var', name, id: null }, 1);
        this.tryChar(';');
        if (expr.type === 'call') return expr.value;
        return makeCall('__bare_value', [keyedField('VALUE', toFieldValueNode(expr))]);
      }
      case 'when': {
        const hat = this.parseHatSpec();
        const { x, y } = this.tryAt();
        const body = this.parseBraceBody();
        return { type: 'whenScript', hat, x, y, body };
      }
      case 'script': {
        const { x, y } = this.tryAt();
        const body = this.parseBraceBody();
        return { type: 'chainScript', x, y, body };
      }
      case 'local': {
        const name = this.expectIdentifier();
        this.skipWS();
        this.expectChar('=');
        const v = this.parseInputValue();
        this.tryChar(';');
        return { type: 'localDecl', name, value: v };
      }
      case 'sound': {
        this.skipWS();
        if (this.peek() !== '"') this.fail(`expected a "quoted name" after 'sound' but found ${this.describeHere()}`, 'example: sound "pop" file "assets/pop.wav";');
        const name = this.parseStringLiteral();
        if (this.peekWord() !== 'file') this.fail(`a sound declaration needs 'file' after its name`, 'example: sound "pop" file "assets/pop.wav";');
        return this.parseAssetDecl('sound', name);
      }
      case 'lists': {
        this.expectChar('[');
        const name = this.parseStringLiteral();
        this.expectChar(']');
        const listF = keyedField('LIST', { type: 'list', name, id: null });
        this.skipWS();
        if (this.peek() === '[') {
          this.i++;
          const idx = this.parseExpr();
          this.expectChar(']');
          this.skipWS();
          if (this.peek() === '=' && this.peek(1) !== '=') {
            this.i++;
            const v = this.parseInputValue();
            this.tryChar(';');
            return makeCall('data_replaceitemoflist', [keyedInput('INDEX', idx), keyedInput('ITEM', v), listF]);
          }
          // Bare `lists["x"][i];` - an orphan item-of-list reporter statement.
          this.tryChar(';');
          return makeCall('data_itemoflist', [keyedInput('INDEX', idx), listF]);
        }
        this.expectChar('.');
        const method = this.expectIdentifier();
        this.expectChar('(');
        const args = [];
        this.skipWS();
        while (this.peek() !== ')') {
          args.push(this.parseInputValue());
          this.skipWS();
          if (!this.tryChar(',')) break;
          this.skipWS();
        }
        this.expectChar(')');
        this.tryChar(';');
        switch (method) {
          case 'add':
          case 'push':
            return makeCall('data_addtolist', [keyedInput('ITEM', args[0]), listF]);
          case 'delete':
            return makeCall('data_deleteoflist', [keyedInput('INDEX', args[0]), listF]);
          case 'clear':
            return makeCall('data_deletealloflist', [listF]);
          case 'insert':
            return makeCall('data_insertatlist', [keyedInput('INDEX', args[0]), keyedInput('ITEM', args[1]), listF]);
          case 'replace':
            return makeCall('data_replaceitemoflist', [keyedInput('INDEX', args[0]), keyedInput('ITEM', args[1]), listF]);
          case 'show':
            return makeCall('data_showlist', [listF]);
          case 'hide':
            return makeCall('data_hidelist', [listF]);
          default: {
            const near = closestMatch(method, ['add', 'push', 'delete', 'clear', 'insert', 'replace', 'show', 'hide']);
            this.fail(`lists have no '.${method}(...)' statement${near ? ` - did you mean '.${near}'?` : ''}`,
              'statements: .add(v) .delete(i) .insert(i, v) .replace(i, v) .clear() .show() .hide(); or lists["x"][i] = v;');
          }
        }
      }
      case 'say':
      case 'think': {
        const v = this.parseInputValue();
        this.skipWS();
        if (this.peekWord() === 'for') {
          this.tryIdentifier();
          const secs = this.parseInputValue();
          this.tryChar(';');
          return makeCall(word === 'say' ? 'looks_sayforsecs' : 'looks_thinkforsecs', [
            keyedInput('MESSAGE', v),
            keyedInput('SECS', secs),
          ]);
        }
        this.tryChar(';');
        return makeCall(word === 'say' ? 'looks_say' : 'looks_think', [keyedInput('MESSAGE', v)]);
      }
      case 'goto_mouse':
      case 'goto_random': {
        this.tryChar(';');
        const sentinel = word === 'goto_mouse' ? '_mouse_' : '_random_';
        return makeCall('motion_goto', [keyedInput('TO', menuValueNode('motion_goto_menu', sentinel))]);
      }
      case 'goto_xy': {
        const x = this.parseInputValue();
        this.tryChar(',');
        const y = this.parseInputValue();
        this.tryChar(';');
        return makeCall('motion_gotoxy', [keyedInput('X', x), keyedInput('Y', y)]);
      }
      case 'change_xy': {
        const dx = this.parseInputValue();
        this.tryChar(',');
        const dy = this.parseInputValue();
        this.tryChar(';');
        const rel = (posOpcode, delta) => ({
          type: 'call',
          value: makeCall('operator_add', [
            keyedInput('NUM1', { type: 'call', value: makeCall(posOpcode, []) }),
            keyedInput('NUM2', delta),
          ]),
        });
        return makeCall('motion_gotoxy', [
          keyedInput('X', rel('motion_xposition', dx)),
          keyedInput('Y', rel('motion_yposition', dy)),
        ]);
      }
      case 'goto': {
        const first = this.parseInputValue();
        this.skipWS();
        if (this.peek() === ',') {
          this.tryChar(',');
          const y = this.parseInputValue();
          this.tryChar(';');
          return makeCall('motion_gotoxy', [keyedInput('X', first), keyedInput('Y', y)]);
        }
        this.tryChar(';');
        return makeCall('motion_goto', [keyedInput('TO', menuInputNode('motion_goto_menu', first))]);
      }
      case 'glide_to_mouse':
      case 'glide_to_random': {
        const secs = this.parseInputValue();
        this.tryChar(';');
        const sentinel = word === 'glide_to_mouse' ? '_mouse_' : '_random_';
        return makeCall('motion_glideto', [keyedInput('SECS', secs), keyedInput('TO', menuValueNode('motion_glideto_menu', sentinel))]);
      }
      case 'glide_xy': {
        const secs = this.parseInputValue();
        this.tryChar(',');
        const x = this.parseInputValue();
        this.tryChar(',');
        const y = this.parseInputValue();
        this.tryChar(';');
        return makeCall('motion_glidesecstoxy', [keyedInput('SECS', secs), keyedInput('X', x), keyedInput('Y', y)]);
      }
      case 'glide_to':
      case 'glide': {
        const secs = this.parseInputValue();
        this.skipWS();
        if (word === 'glide_to') this.tryChar(',');
        else if (this.peekWord() === 'to') this.tryIdentifier();
        const first = this.parseInputValue();
        this.skipWS();
        if (this.peek() === ',') {
          this.tryChar(',');
          const y = this.parseInputValue();
          this.tryChar(';');
          return makeCall('motion_glidesecstoxy', [keyedInput('SECS', secs), keyedInput('X', first), keyedInput('Y', y)]);
        }
        this.tryChar(';');
        return makeCall('motion_glideto', [keyedInput('SECS', secs), keyedInput('TO', menuInputNode('motion_glideto_menu', first))]);
      }
      case 'change_effect':
      case 'set_effect': {
        const effect = this.parseEffectNameToken();
        this.skipWS();
        const connector = this.peekWord();
        const expected = word === 'change_effect' ? 'by' : 'to';
        if (connector === expected) this.tryIdentifier();
        const v = this.parseInputValue();
        this.tryChar(';');
        return makeCall(word === 'change_effect' ? 'looks_changeeffectby' : 'looks_seteffectto', [
          keyedInput(word === 'change_effect' ? 'CHANGE' : 'VALUE', v),
          keyedField('EFFECT', { type: 'array', value: [effect] }),
        ]);
      }
      case 'costume':
      case 'backdrop':
      case 'clone':
      case 'point_towards':
      case 'play_sound':
      case 'play_sound_until_done': {
        // `costume "name" file "..."` declares an asset; `costume "name";`
        // is the switch-costume statement. The `file` attribute decides.
        if (word === 'costume' || word === 'backdrop') {
          const save = this.snapshot();
          this.skipWS();
          if (this.peek() === '"') {
            const name = this.parseStringLiteral();
            if (this.peekWord() === 'file') {
              return this.parseAssetDecl('costume', name);
            }
          }
          this.restore(save);
        }
        const [opcode, inputKey, menuOpcode] = MENU_ALIASES[word];
        this.skipWS();
        let v = null;
        if (this.peek() !== ';' && this.peek() !== '}' && !this.eof() && this.peek() !== '\n') {
          v = this.parseInputValue();
        }
        this.tryChar(';');
        if (v == null && word === 'clone') v = { type: 'string', value: '_myself_' };
        if (v == null) this.fail(`'${word}' needs a value`, `example: ${word} "name";`);
        if (v.type === 'string') {
          v = { type: 'call', value: makeCall(menuOpcode, [{ kind: 'positional', value: v }]) };
        }
        return makeCall(opcode, [keyedInput(inputKey, v)]);
      }
      case 'point_towards_mouse':
      case 'point_towards_random': {
        this.tryChar(';');
        const sentinel = word === 'point_towards_mouse' ? '_mouse_' : '_random_';
        return makeCall('motion_pointtowards', [keyedInput('TOWARDS', menuValueNode('motion_pointtowards_menu', sentinel))]);
      }
      case 'clone_myself': {
        this.tryChar(';');
        return makeCall('control_create_clone_of', [keyedInput('CLONE_OPTION', menuValueNode('control_create_clone_of_menu', '_myself_'))]);
      }
      case 'change_sound_effect':
      case 'set_sound_effect': {
        const effect = this.parseEffectNameToken();
        this.skipWS();
        const expected = word === 'change_sound_effect' ? 'by' : 'to';
        if (this.peekWord() === expected) this.tryIdentifier();
        const v = this.parseInputValue();
        this.tryChar(';');
        return makeCall(word === 'change_sound_effect' ? 'sound_changeeffectby' : 'sound_seteffectto', [
          keyedInput('VALUE', v),
          keyedField('EFFECT', { type: 'array', value: [effect] }),
        ]);
      }
      case 'set_rotation_style': {
        const v = this.parseInputValue();
        this.tryChar(';');
        const style = v.type === 'string' ? v.value : String(v.value ?? '');
        return makeCall('motion_setrotationstyle', [keyedField('STYLE', { type: 'array', value: [style] })]);
      }
      case 'set_drag_mode': {
        const v = this.parseInputValue();
        this.tryChar(';');
        const mode = v.type === 'string' ? v.value : String(v.value ?? '');
        return makeCall('sensing_setdragmode', [keyedField('DRAG_MODE', { type: 'array', value: [mode] })]);
      }
      case 'show_variable':
      case 'hide_variable': {
        this.skipWS();
        const name = this.peek() === '"' ? this.parseStringLiteral() : this.expectIdentifier(`after '${word}'`);
        this.tryChar(';');
        return makeCall(word === 'show_variable' ? 'data_showvariable' : 'data_hidevariable', [
          keyedField('VARIABLE', { type: 'array', value: [name] }),
        ]);
      }
      case 'use': {
        const id = this.parseStringLiteral();
        let url = null;
        this.skipWS();
        if (this.peekWord() === 'from') {
          this.tryIdentifier();
          url = this.parseStringLiteral();
        }
        this.tryChar(';');
        return { type: 'useDecl', id, url };
      }
      case 'var':
      case 'cloud': {
        this.skipWS();
        // Quoted names carry declarations for variables whose real names
        // aren't identifier-safe: var "Frame // Interactable" = 0;
        const name = this.peek() === '"' ? this.parseStringLiteral() : this.expectIdentifier(`after '${word}'`);
        this.skipWS();
        this.expectChar('=', `in '${word} ${name} = ...'`);
        this.skipWS();
        let value;
        let isList = false;
        if (this.peek() === '[') {
          value = this.readJSONValue();
          isList = true;
        } else if (this.peek() === '"') {
          value = this.parseStringLiteral();
        } else if (this.peekWord() === 'true' || this.peekWord() === 'false') {
          value = this.tryIdentifier() === 'true';
        } else {
          value = this.parseNumberLiteral().value;
        }
        if (word === 'cloud' && isList) {
          this.fail('cloud lists do not exist in Scratch - only cloud variables', 'use: cloud name = 0;');
        }
        // Optional explicit id: Scratch tolerates several variables/lists
        // sharing one display name (distinct ids). Converted projects carry
        // the id on all but the first same-named declaration so none of them
        // collapse into each other on pack.
        this.skipWS();
        let id = null;
        if (this.peekWord() === 'id') {
          this.tryIdentifier();
          id = this.parseStringLiteral();
        }
        this.tryChar(';');
        return { type: 'varDecl', name, value, isList, cloud: word === 'cloud', id };
      }
      case 'sprite':
      case 'stage': {
        const props = { kind: word };
        this.skipWS();
        // Optional quoted display name (the folder name is a sanitized copy):
        // sprite "My Sprite!" at 0,0 ...
        if (this.peek() === '"') props.name = this.parseStringLiteral();
        for (;;) {
          this.skipWS();
          const attr = this.peekWord();
          if (attr === 'at') {
            const pos = this.tryAt();
            props.x = pos.x;
            props.y = pos.y;
          } else if (attr === 'size' || attr === 'direction' || attr === 'volume' || attr === 'tempo' || attr === 'layer' || attr === 'transparency') {
            this.tryIdentifier();
            this.skipWS();
            props[attr] = this.parseNumberLiteral().value;
          } else if (attr === 'costume') {
            this.tryIdentifier();
            this.skipWS();
            props.currentCostume = this.parseNumberLiteral().value;
          } else if (attr === 'video') {
            this.tryIdentifier();
            this.skipWS();
            props.videoState = this.peek() === '"' ? this.parseStringLiteral() : this.expectIdentifier(`after 'video'`);
          } else if (attr === 'tts') {
            this.tryIdentifier();
            this.skipWS();
            props.tts = this.parseStringLiteral();
          } else if (attr === 'visible' || attr === 'hidden') {
            this.tryIdentifier();
            props.visible = attr === 'visible';
          } else if (attr === 'draggable') {
            this.tryIdentifier();
            props.draggable = true;
          } else if (attr === 'rotation') {
            this.tryIdentifier();
            props.rotationStyle = this.parseStringLiteral();
          } else {
            break;
          }
        }
        this.tryChar(';');
        return { type: 'spriteDecl', props };
      }
      case 'watch': {
        this.skipWS();
        const kindWord = this.expectIdentifier(`after 'watch'`);
        if (kindWord !== 'var' && kindWord !== 'list') {
          this.fail(`'watch' expects 'var' or 'list' but found '${kindWord}'`, 'example: watch var "score" at 10,10;');
        }
        this.skipWS();
        const name = this.parseStringLiteral();
        const decl = {
          type: 'watchDecl', isList: kindWord === 'list', name, mode: null,
          x: null, y: null, width: null, height: null, visible: true,
          sliderMin: null, sliderMax: null, isDiscrete: true, sprite: null, id: null,
        };
        for (;;) {
          this.skipWS();
          const w = this.peekWord();
          if (w === 'at') {
            const pos = this.tryAt();
            decl.x = pos.x;
            decl.y = pos.y;
          } else if (w === 'size') {
            this.tryIdentifier();
            this.skipWS();
            decl.width = this.parseNumberLiteral().value;
            this.expectChar('x');
            decl.height = this.parseNumberLiteral().value;
          } else if (w === 'large' || w === 'slider') {
            this.tryIdentifier();
            decl.mode = w;
          } else if (w === 'range') {
            this.tryIdentifier();
            this.skipWS();
            decl.sliderMin = this.parseNumberLiteral().value;
            this.tryChar(',');
            this.skipWS();
            decl.sliderMax = this.parseNumberLiteral().value;
          } else if (w === 'continuous') {
            this.tryIdentifier();
            decl.isDiscrete = false;
          } else if (w === 'hidden' || w === 'visible') {
            this.tryIdentifier();
            decl.visible = w === 'visible';
          } else if (w === 'sprite') {
            // Watcher owned by a sprite that has no folder in this build
            // (deleted sprite, monitor left behind) - preserved verbatim.
            this.tryIdentifier();
            this.skipWS();
            decl.sprite = this.parseStringLiteral();
          } else if (w === 'id') {
            this.tryIdentifier();
            this.skipWS();
            decl.id = this.parseStringLiteral();
          } else {
            break;
          }
        }
        this.tryChar(';');
        return decl;
      }
      case 'comment': {
        const decl = { type: 'commentDecl', text: '', x: 0, y: 0, width: 200, height: 200, minimized: false, forId: null };
        this.skipWS();
        if (this.peek() === '"') decl.text = this.parseStringLiteral();
        for (;;) {
          this.skipWS();
          const w = this.peekWord();
          if (w === 'at') {
            const pos = this.tryAt();
            decl.x = pos.x;
            decl.y = pos.y;
          } else if (w === 'size') {
            this.tryIdentifier();
            this.skipWS();
            decl.width = this.parseNumberLiteral().value;
            this.expectChar('x');
            decl.height = this.parseNumberLiteral().value;
          } else if (w === 'minimized') {
            this.tryIdentifier();
            decl.minimized = true;
          } else if (w === 'for') {
            // Explicit block-id anchor - only used for orphan comments whose
            // block no longer exists (reproduces the dangling reference).
            this.tryIdentifier();
            this.skipWS();
            decl.forId = this.parseStringLiteral();
          } else {
            break;
          }
        }
        this.skipWS();
        if (!decl.text && this.peek() === '"') decl.text = this.parseStringLiteral();
        this.tryChar(';');
        return decl;
      }
      case 'platform': {
        const name = this.parseStringLiteral();
        let url = null;
        this.skipWS();
        if (this.peekWord() === 'from') {
          this.tryIdentifier();
          url = this.parseStringLiteral();
        }
        this.tryChar(';');
        return { type: 'platformDecl', name, url };
      }
      case 'dangling_next': {
        // Preserves a forward reference to a block id that doesn't actually
        // exist in the source project.json (a corrupted/hand-edited sb3 -
        // see graph.js/buildBlocks.js). Not a real block; a sentinel that
        // reproduces the exact same broken reference on pack.
        this.expectChar('(');
        this.skipWS();
        const id = this.parseStringLiteral();
        this.skipWS();
        this.expectChar(')');
        this.tryChar(';');
        return { type: 'danglingNext', id };
      }
      default: {
        if (SIMPLE_ALIASES[word]) {
          this.tryChar(';');
          return makeCall(SIMPLE_ALIASES[word], []);
        }
        if (UNARY_ALIASES[word]) {
          const [opcode, inputKey] = UNARY_ALIASES[word];
          const v = this.parseInputValue();
          this.tryChar(';');
          return makeCall(opcode, [keyedInput(inputKey, v)]);
        }
        if (FIELD_ALIASES[word]) {
          const [opcode, fieldKey, fieldValue] = FIELD_ALIASES[word];
          this.tryChar(';');
          return makeCall(opcode, [keyedField(fieldKey, { type: 'array', value: [fieldValue] })]);
        }
        if (UNARY_FIELD_ALIASES[word]) {
          const [opcode, inputKey, fieldKey, fieldValue] = UNARY_FIELD_ALIASES[word];
          const v = this.parseInputValue();
          this.tryChar(';');
          return makeCall(opcode, [keyedInput(inputKey, v), keyedField(fieldKey, { type: 'array', value: [fieldValue] })]);
        }
        this.fail(`'${word}' is a reserved word that can't start a statement here`);
      }
    }
  }

  parseDef() {
    this.skipWS();
    this.expectChar('@');
    const ident = this.expectIdentifier();
    this.expectChar('(');
    const params = [];
    this.skipWS();
    if (this.peek() !== ')') {
      for (;;) {
        this.skipWS();
        const paramIdent = this.expectIdentifier();
        this.skipWS();
        // `ident("Original Name")` when the display name isn't itself a
        // clean identifier (spaces, punctuation) - otherwise ident IS the name.
        let name = paramIdent;
        if (this.peek() === '(') {
          this.i++;
          this.skipWS();
          name = this.parseStringLiteral();
          this.skipWS();
          this.expectChar(')');
        }
        params.push({ ident: paramIdent, name });
        this.skipWS();
        if (this.tryChar(',')) continue;
        break;
      }
    }
    this.expectChar(')');

    let proccode = null;
    this.skipWS();
    if (this.peek() === '"') {
      proccode = this.parseStringLiteral();
    }

    let warp = false;
    let customcolor = null;
    let returns = null;
    let x = null;
    let y = null;
    for (;;) {
      this.skipWS();
      const word = this.peekWord();
      if (word === 'warp') {
        this.tryIdentifier();
        this.skipWS();
        if (this.peek() === '=') {
          this.i++;
          const w = this.tryIdentifier();
          warp = w === 'true';
        } else {
          warp = true;
        }
      } else if (word === 'color') {
        this.tryIdentifier();
        this.skipWS();
        if (this.peek() === '=') this.i++;
        customcolor = this.parseStringLiteral();
      } else if (word === 'returns') {
        this.tryIdentifier();
        this.skipWS();
        if (this.peek() === '=') this.i++;
        this.skipWS();
        returns = this.peek() === '"' ? this.parseStringLiteral() : String(this.parseNumberLiteral().value);
      } else if (word === 'at') {
        const pos = this.tryAt();
        x = pos.x;
        y = pos.y;
      } else {
        break;
      }
    }

    const body = this.parseBraceBody();
    return { type: 'procDef', ident, proccode, warp, customcolor, returns, x, y, params, body };
  }

  parseIf() {
    const cond = this.parseExpr();
    const thenBody = this.parseBraceBody();
    this.skipWS();
    const save = this.snapshot();
    if (this.peekWord() === 'else') {
      this.tryIdentifier();
      this.skipWS();
      // `else if cond { ... }` chains sugar an else body holding exactly one
      // nested if statement — identical blocks to the braced nesting.
      let elseBody;
      if (this.peekWord() === 'if') {
        this.tryIdentifier();
        elseBody = [this.parseIf()];
      } else {
        elseBody = this.parseBraceBody();
      }
      return makeCall('control_if_else', [
        keyedInput('CONDITION', cond),
        branchArg('then', thenBody, 'SUBSTACK'),
        branchArg('else', elseBody, 'SUBSTACK2'),
      ]);
    }
    this.restore(save);
    return makeCall('control_if', [keyedInput('CONDITION', cond), branchArg('then', thenBody, 'SUBSTACK')]);
  }

  parseSingleBranch(opcode) {
    const body = this.parseBraceBody();
    return makeCall(opcode, [branchArg('substack', body)]);
  }

  parseBraceBody() {
    this.expectChar('{');
    const stmts = this.parseStatementList(true);
    this.expectChar('}');
    return stmts;
  }

  // Expression appearing at statement position: procedure calls and generic
  // opcode calls parse as nested-call value nodes (for reuse inside
  // expressions) so unwrap them back to bare call statements here. A bare
  // identifier/string/etc at statement position only happens for orphan
  // single-block "shadow" scripts (e.g. `Colour;`) - synthesize a marker
  // call carrying the value so the caller's hatOpcode override still lands
  // it on the right opcode.
  parseExprStatementHead() {
    const e = this.parseExpr();
    if (e.type === 'call') {
      const call = e.value;
      // Extension "C-block" opcodes carry a body slot even though they
      // aren't one of the hardcoded control-flow keywords. Only meaningful
      // for a true statement (not a nested reporter value used as a
      // condition/argument elsewhere), so this only fires here, not in the
      // general parseExpr() value grammar - otherwise it'd eat the body of
      // an enclosing `if genericCall(...) { ... }`.
      if (call.callee.type === 'opcode') {
        const substackKeys = ['SUBSTACK', 'SUBSTACK2'];
        let si = 0;
        while (si < substackKeys.length) {
          this.skipWS();
          if (this.peek() !== '{') break;
          const body = this.parseBraceBody();
          call.args.push(branchArg('substack', body, substackKeys[si]));
          si++;
        }
      }
      return call;
    }
    // `arg("Name");` at statement position: an orphan argument reporter
    // (detached from any definition). Only the string/number kind uses this
    // sugar - a boolean orphan keeps the raw opcode form since the kind
    // isn't recoverable from the name.
    if (e.type === 'arg') {
      return makeCall('argument_reporter_string_number', [keyedField('VALUE', { type: 'array', value: [e.name] })]);
    }
    return makeCall('__bare_value', [keyedField('VALUE', toFieldValueNode(e))]);
  }

  parseExpr() {
    return this.parseBinaryExpr(1);
  }

  parseBinaryExpr(minPrec) {
    return this.parseBinaryFrom(this.parseUnaryExpr(), minPrec);
  }

  parseBinaryFrom(left, minPrec) {
    for (;;) {
      const op = this.peekBinaryOp();
      if (!op || BINARY_OPS[op] < minPrec) break;
      this.i += op.length;
      const right = this.parseBinaryExpr(BINARY_OPS[op] + 1); // left-assoc
      left = combineBinary(left, op, right);
    }
    return left;
  }

  peekBinaryOp() {
    this.skipWS();
    const two = this.s.slice(this.i, this.i + 2);
    if (TWO_CHAR_OPS.has(two)) return two;
    const one = this.peek();
    if (one && ONE_CHAR_OPS.has(one)) return one;
    return null;
  }

  parseUnaryExpr() {
    this.skipWS();
    if (this.peek() === '!' && this.peek(1) !== '=') {
      this.i++;
      const operand = this.parseUnaryExpr();
      return { type: 'call', value: makeCall('operator_not', [keyedInput('OPERAND', operand)]) };
    }
    return this.parsePostfixMethods(this.parsePrimary());
  }

  // Stdlib method sugar: `value.split(",")` desugars to a call of the
  // stdlib def (`@fractch_strings_split(value, ",")`); chains fine
  // (`v.split(",").item(1)`). Only names in the stdlib registry parse this
  // way - anything else after a '.' stays an opcode/property read, and the
  // raw opcode form (`ns_split(...)`) remains the escape hatch for an
  // extension whose block name collides with a method.
  parsePostfixMethods(expr) {
    for (;;) {
      this.skipWS();
      if (this.peek() !== '.' || this.peek(1) === '.') return expr;
      const save = this.snapshot();
      this.i++;
      const name = this.tryIdentifier();
      const m = name && STDLIB_METHODS[name];
      this.skipWS();
      if (!m || this.peek() !== '(') {
        this.restore(save);
        return expr;
      }
      this.i++;
      const args = [{ kind: 'positional', value: expr }];
      this.skipWS();
      if (this.peek() !== ')') {
        for (;;) {
          args.push({ kind: 'positional', value: this.parseInputValue() });
          this.skipWS();
          if (this.tryChar(',')) continue;
          break;
        }
      }
      this.expectChar(')');
      if (args.length !== m.argc) {
        this.fail(`.${name}(...) takes ${m.argc - 1} argument${m.argc === 2 ? '' : 's'} after the receiver`,
          `stdlib method from import "${m.module}"`);
      }
      expr = {
        type: 'call',
        value: { type: 'call', callee: { type: 'procedureCall', name: m.ident, line: this.lineAt(save) }, args },
      };
    }
  }

  parseInputValue() {
    const v = this.parseExpr();
    this.skipWS();
    if (this.peek() === '?' && this.peek(1) === '?') {
      this.i += 2;
      this.skipWS();
      if (this.peekWord() === 'shadow') this.tryIdentifier();
      const sh = this.parseExpr();
      return { type: 'obscured', active: v, shadow: sh };
    }
    return v;
  }

  parsePrimary() {
    this.skipWS();
    if (this.eof()) this.fail('expected a value but reached the end of the file', 'a block above is probably missing its closing }');
    const ch = this.peek();

    if (ch === '(') return this.parseParenExpr();
    if (ch === '"') return { type: 'string', value: this.parseStringLiteral() };
    if (ch === '@') return this.parseProcCallExpr();
    if (ch === '[' || ch === '{') return { type: 'json', value: this.readJSONValue() };
    if (ch === '-' || /[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(this.peek(1)))) return this.parseNumberLiteral();

    const word = this.tryIdentifier();
    if (word == null) this.fail(`expected a value but found ${this.describeHere()}`,
      'values are numbers, "strings", variable names, vars["..."], lists["..."], or block calls like sensing.timer()');

    if (word === 'true') return { type: 'boolean', value: true };
    if (word === 'false') return { type: 'boolean', value: false };
    if (word === 'null') return { type: 'null' };

    if (word === 'shadow') {
      this.skipWS();
      const nx = this.peek();
      if (nx === '@' || (nx && /[A-Za-z_]/.test(nx))) {
        const inner = this.parsePrimary();
        if (inner.type === 'call') return { ...inner, shadow: true };
        return inner;
      }
    }

    if (word === 'var' || word === 'list' || word === 'broadcast' || word === 'arg') {
      return this.parseNamedRefCall(word);
    }
    if (word === 'sprites' && this.peek() === '[') {
      this.i++;
      const name = this.parseStringLiteral();
      this.skipWS();
      this.expectChar(']');
      this.expectChar('.');
      let prop;
      if (this.peekWord() === 'vars') {
        this.tryIdentifier();
        this.expectChar('[');
        prop = this.parseStringLiteral();
        this.skipWS();
        this.expectChar(']');
      } else {
        const ident = this.expectIdentifier();
        prop = SPRITE_PROPS[ident];
        if (!prop) {
          const near = closestMatch(ident, Object.keys(SPRITE_PROPS));
          this.fail(`sprites have no '.${ident}' property${near ? ` - did you mean '.${near}'?` : ''}`,
            'properties: .x .y .direction .size .volume .costume_number .costume_name .backdrop_number .backdrop_name, or .vars["name"] for that sprite\'s variables');
        }
      }
      const menu = {
        type: 'call',
        value: makeCall('sensing_of_object_menu', [{ kind: 'positional', value: { type: 'string', value: name } }]),
      };
      return {
        type: 'call',
        value: makeCall('sensing_of', [keyedInput('OBJECT', menu), keyedField('PROPERTY', { type: 'array', value: [prop] })]),
      };
    }
    if (word === 'lists' && this.peek() === '[') {
      this.i++;
      const name = this.parseStringLiteral();
      this.skipWS();
      this.expectChar(']');
      return this.parseListPostfix(name);
    }
    if (word === 'vars' && this.peek() === '[') {
      // `vars["name"]` as an expression is a bare variable-name literal
      // (Scratch's type-12 dropdown default) - same shape as var("name").
      this.i++;
      const name = this.parseStringLiteral();
      this.skipWS();
      this.expectChar(']');
      return { type: 'var', name, id: null };
    }

    this.skipWS();
    if (FUNC_SUGAR[word] && this.peek() === '(') {
      const [opcode, keys] = FUNC_SUGAR[word];
      this.i++;
      const args = [];
      for (let k = 0; k < keys.length; k++) {
        if (k) this.tryChar(',');
        args.push(keyedInput(keys[k], this.parseExpr()));
      }
      this.skipWS();
      this.expectChar(')');
      return { type: 'call', value: makeCall(opcode, args) };
    }
    if (UNARY_SUGAR.has(word) && this.peek() === '(') {
      this.i++;
      const arg = this.parseExpr();
      this.skipWS();
      this.tryChar(',');
      this.skipWS();
      this.expectChar(')');
      if (word === 'round') return { type: 'call', value: makeCall('operator_round', [keyedInput('NUM', arg)]) };
      if (word === 'not') return { type: 'call', value: makeCall('operator_not', [keyedInput('OPERAND', arg)]) };
      const opName = MATHOP_NAME[word] || word;
      return {
        type: 'call',
        value: makeCall('operator_mathop', [keyedField('OPERATOR', { type: 'array', value: [opName] }), keyedInput('NUM', arg)]),
      };
    }
    if (REPORTER_NULLARY[word] && this.peek() === '(') {
      this.i++;
      this.skipWS();
      this.expectChar(')');
      return { type: 'call', value: makeCall(REPORTER_NULLARY[word], []) };
    }
    if (REPORTER_FIELD[word] && this.peek() === '(') {
      this.i++;
      this.skipWS();
      this.expectChar(')');
      const [opcode, fk, fv] = REPORTER_FIELD[word];
      return { type: 'call', value: makeCall(opcode, [keyedField(fk, { type: 'array', value: [fv] })]) };
    }
    if (REPORTER_MENU_SUGAR[word] && this.peek() === '(') {
      const [opcode, key, menuOpcode, sentinel] = REPORTER_MENU_SUGAR[word];
      this.i++;
      this.skipWS();
      let v;
      if (sentinel != null) {
        v = menuValueNode(menuOpcode, sentinel);
      } else {
        v = menuInputNode(menuOpcode, this.parseExpr());
      }
      this.skipWS();
      this.expectChar(')');
      return { type: 'call', value: makeCall(opcode, [keyedInput(key, v)]) };
    }
    if (REPORTER_FUNC_SUGAR[word] && this.peek() === '(') {
      const [opcode, keys] = REPORTER_FUNC_SUGAR[word];
      this.i++;
      const args = [];
      for (let k = 0; k < keys.length; k++) {
        if (k) this.tryChar(',');
        args.push(keyedInput(keys[k], this.parseExpr()));
      }
      this.skipWS();
      this.expectChar(')');
      return { type: 'call', value: makeCall(opcode, args) };
    }

    let callee = word;
    while (this.peek() === '.' && this.peek(1) !== '.') {
      const dotSave = this.snapshot();
      this.i++;
      const part = this.expectIdentifier();
      // `value.split(...)`: a registry method name after a single bare
      // identifier is ambiguous - method sugar on a variable, or an
      // extension block (`mistsutils.item(...)`). Keyed args settle it as an
      // opcode call immediately; all-positional args defer to pack time,
      // which resolves by whether a variable of that name exists.
      if (callee === word && STDLIB_METHODS[part]) {
        this.skipWS();
        if (this.peek() === '(') {
          this.i++;
          const args = this.parseKeyedArgs();
          this.expectChar(')');
          if (args.some((a) => a.kind !== 'positional')) {
            return { type: 'call', value: makeCall(`${word}_${part}`, args) };
          }
          return {
            type: 'call',
            value: { type: 'call', callee: { type: 'identOrMethod', ident: word, method: part, line: this.lineAt(dotSave) }, args },
          };
        }
      }
      callee += `_${part}`;
      this.skipWS();
    }

    if (this.peek() === '(') {
      this.i++;
      const args = this.parseKeyedArgs();
      this.expectChar(')');
      return { type: 'call', value: makeCall(callee, args) };
    }

    if (callee !== word) this.fail(`'${callee.replace(/_/g, '.')}' looks like a block but has no (arguments)`,
      `write ${callee.replace(/_/g, '.')}(...) - use () even when there are no arguments`);

    return { type: 'ident', name: word };
  }

  parseListPostfix(name) {
    const listF = keyedField('LIST', { type: 'list', name, id: null });
    this.skipWS();
    if (this.peek() === '[') {
      this.i++;
      const idx = this.parseExpr();
      this.expectChar(']');
      return { type: 'call', value: makeCall('data_itemoflist', [keyedInput('INDEX', idx), listF]) };
    }
    if (this.peek() === '.' && this.peek(1) !== '.') {
      this.i++;
      const method = this.expectIdentifier();
      if (method === 'length') {
        this.skipWS();
        if (this.peek() === '(') {
          this.i++;
          this.skipWS();
          this.expectChar(')');
        }
        return { type: 'call', value: makeCall('data_lengthoflist', [listF]) };
      }
      this.expectChar('(');
      const arg = this.parseExpr();
      this.skipWS();
      this.expectChar(')');
      if (method === 'contains') {
        return { type: 'call', value: makeCall('data_listcontainsitem', [keyedInput('ITEM', arg), listF]) };
      }
      if (method === 'indexof') {
        return { type: 'call', value: makeCall('data_itemnumoflist', [keyedInput('ITEM', arg), listF]) };
      }
      if (method === 'item') {
        return { type: 'call', value: makeCall('data_itemoflist', [keyedInput('INDEX', arg), listF]) };
      }
      {
        const near = closestMatch(method, ['length', 'contains', 'indexof', 'item']);
        this.fail(`lists have no '.${method}(...)' reporter${near ? ` - did you mean '.${near}'?` : ''}`,
          'reporters: lists["x"][i], .length, .contains(v), .indexof(v)');
      }
    }
    return { type: 'list', name, id: null };
  }

  parseNamedRefCall(kind) {
    this.expectChar('(');
    this.skipWS();
    const name = this.parseStringLiteral();
    this.skipWS();
    let id = null;
    if (this.tryChar(',')) {
      this.skipWS();
      id = this.parseStringLiteral();
    }
    this.skipWS();
    this.expectChar(')');
    return { type: kind, name, id };
  }

  parseProcCallExpr() {
    const startPos = this.i;
    this.expectChar('@');
    const ident = this.expectIdentifier();
    this.expectChar('(');
    const args = this.parseKeyedArgs();
    this.expectChar(')');
    return {
      type: 'call',
      value: { type: 'call', callee: { type: 'procedureCall', name: ident, line: this.lineAt(startPos) }, args },
    };
  }

  parseParenExpr() {
    this.expectChar('(');
    const e = this.parseExpr();
    this.skipWS();
    this.expectChar(')');
    return e;
  }

  parseNumberLiteral() {
    const start = this.i;
    if (this.peek() === '-') this.i++;
    while (!this.eof() && /[0-9]/.test(this.peek())) this.i++;
    if (this.peek() === '.' && /[0-9]/.test(this.peek(1))) {
      this.i++;
      while (!this.eof() && /[0-9]/.test(this.peek())) this.i++;
    }
    if ((this.peek() === 'e' || this.peek() === 'E') && /[0-9+-]/.test(this.peek(1) || '')) {
      this.i++;
      if (this.peek() === '+' || this.peek() === '-') this.i++;
      while (!this.eof() && /[0-9]/.test(this.peek())) this.i++;
    }
    const text = this.s.slice(start, this.i);
    if (!text || text === '-') this.fail(`expected a number but found ${this.describeHere()}`);
    return { type: 'number', value: Number(text), raw: text };
  }

  parseStringLiteral() {
    this.skipWS();
    if (this.peek() !== '"') this.fail(`expected a "quoted string" but found ${this.describeHere()}`);
    // Triple-quoted raw string: content runs verbatim (real newlines, no
    // escape processing) to the next """.
    if (this.s.startsWith('"""', this.i)) {
      this.i += 3;
      const end = this.s.indexOf('"""', this.i);
      if (end < 0) {
        this.fail('this """ string never closes - missing the ending \'"""\'',
          'triple-quoted strings are raw: no escapes, closed by """');
      }
      const result = this.s.slice(this.i, end);
      this.i = end + 3;
      return result;
    }
    this.i++;
    let result = '';
    while (!this.eof() && this.peek() !== '"') {
      if (this.peek() === '\n') {
        this.fail('this string never closes - missing the ending \'"\' before the end of the line',
          'strings cannot contain raw line breaks; use \\n for a newline character');
      }
      const ch = this.next();
      if (ch === '\\') {
        const nx = this.next();
        if (nx === '"') result += '"';
        else if (nx === '\\') result += '\\';
        else if (nx === 'n') result += '\n';
        else if (nx === 't') result += '\t';
        else if (nx === 'r') result += '\r';
        else result += nx;
      } else {
        result += ch;
      }
    }
    if (this.peek() !== '"') this.fail('this string never closes - missing the ending \'"\'', 'strings use double quotes: "like this"; escape inner quotes as \\"');
    this.i++;
    return result;
  }

  // key (`:` value | `=` value) for inputs; `field key: value` for fields.
  // The old generated syntax used `key: value` for fields and `key= value`
  // for inputs, so known field keys still parse as fields for compatibility.
  parseKeyedArgs() {
    const args = [];
    this.skipWS();
    if (this.peek() === ')') return args;
    for (;;) {
      const argStart = this.snapshot();
      let arg = null;
      try {
        arg = this.parseKeyedArg();
      } catch {
        this.restore(argStart);
        const value = this.parseInputValue();
        arg = { kind: 'positional', value };
      }
      args.push(arg);
      this.skipWS();
      if (this.tryChar(',')) continue;
      if (this.peek() !== ')') {
        this.fail(`expected ',' or ')' after an argument but found ${this.describeHere()}`,
          "arguments look like name: value, separated by commas - did you forget the ':' or a comma?");
      }
      break;
    }
    return args;
  }

  parseKeyedArg() {
    this.skipWS();
    let forceField = false;
    const maybeField = this.snapshot();
    const maybeKeyword = this.tryIdentifier();
    if (maybeKeyword === 'field') {
      this.skipWS();
      if (this.peek() !== ':' && this.peek() !== '=' && this.peek() !== ',' && this.peek() !== ')') {
        forceField = true;
      } else {
        this.restore(maybeField);
      }
    } else {
      this.restore(maybeField);
    }

    const key = this.parseArgKey();
    this.skipWS();
    let token;
    if (forceField) {
      this.expectChar(':');
      token = ':';
    } else if (this.tryChar('=')) token = '=';
    else if (this.tryChar(':')) token = ':';
    else this.fail(`expected ':' after the argument name '${key}' but found ${this.describeHere()}`, `arguments look like ${key}: value`);
    const value = this.parseInputValue();
    const sep = forceField || (token === ':' && isLegacyFieldArg(key, value)) ? 'field' : 'input';
    return { kind: 'keyed', sep, key, value };
  }

  parseArgKey() {
    this.skipWS();
    if (this.peek() === '[') {
      this.i++;
      const s = this.parseStringLiteral();
      this.skipWS();
      this.expectChar(']');
      return s;
    }
    // Unlike opcode/identifier names, argument keys may legitimately be
    // digit-led (custom-block argument idents derived from purely numeric
    // original names, e.g. cleanIdent("1") === "1"). Keys are unambiguous
    // here (always followed by '=' or ':'), so accept a wider token.
    const start = this.i;
    while (!this.eof() && /[A-Za-z0-9_]/.test(this.peek())) this.i++;
    if (this.i === start) this.fail(`expected an argument name but found ${this.describeHere()}`);
    return this.s.slice(start, this.i);
  }

  readJSONValue() {
    const start = this.i;
    this.skipBalancedJSON();
    const text = this.s.slice(start, this.i);
    return JSON.parse(text);
  }

  skipBalancedJSON() {
    const open = this.peek();
    const close = open === '[' ? ']' : '}';
    let depth = 0;
    while (!this.eof()) {
      const ch = this.next();
      if (ch === '"') {
        while (!this.eof() && this.peek() !== '"') {
          if (this.next() === '\\') this.next();
        }
        if (!this.eof()) this.next();
        continue;
      }
      if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) return;
      }
    }
    this.fail(`this ${open === '[' ? 'JSON array' : 'JSON object'} never closes - missing '${close}'`);
  }
}

const BINARY_OPCODES = {
  '+': ['operator_add', 'NUM1', 'NUM2'],
  '-': ['operator_subtract', 'NUM1', 'NUM2'],
  '*': ['operator_multiply', 'NUM1', 'NUM2'],
  '/': ['operator_divide', 'NUM1', 'NUM2'],
  '%': ['operator_mod', 'NUM1', 'NUM2'],
  '..': ['operator_join', 'STRING1', 'STRING2'],
  '++': ['operator_join', 'STRING1', 'STRING2'],
  '==': ['operator_equals', 'OPERAND1', 'OPERAND2'],
  '<': ['operator_lt', 'OPERAND1', 'OPERAND2'],
  '>': ['operator_gt', 'OPERAND1', 'OPERAND2'],
  '&&': ['operator_and', 'OPERAND1', 'OPERAND2'],
  '||': ['operator_or', 'OPERAND1', 'OPERAND2'],
};
const NEGATED_OPCODES = { '!=': '==', '<=': '>', '>=': '<' };

function combineBinary(left, op, right) {
  const negated = NEGATED_OPCODES[op];
  if (negated) {
    const inner = combineBinary(left, negated, right);
    return { type: 'call', value: makeCall('operator_not', [keyedInput('OPERAND', inner)]) };
  }
  const [opcode, k1, k2] = BINARY_OPCODES[op];
  return { type: 'call', value: makeCall(opcode, [keyedInput(k1, left), keyedInput(k2, right)]) };
}

function isLegacyFieldArg(key, value) {
  if (!LEGACY_FIELD_KEYS.has(key)) return false;
  if (value?.type === 'json' || value?.type === 'array') return true;
  if (key === 'VARIABLE') return value?.type === 'var';
  if (key === 'LIST') return value?.type === 'list';
  if (key === 'BROADCAST_OPTION') return value?.type === 'broadcast';
  return false;
}

// `broadcast LoadFiles;` - a bare identifier in broadcast position is the
// broadcast's name, not a variable read.
function broadcastName(v) {
  if (v && v.type === 'ident') return { type: 'string', value: v.name };
  return v;
}

function parseEffectName(name) {
  return String(name).replace(/_/g, ' ').toUpperCase();
}

function makeCall(opcode, args) {
  return { type: 'call', callee: { type: 'opcode', name: opcode }, args };
}
function menuValueNode(menuOpcode, value) {
  return { type: 'call', value: makeCall(menuOpcode, [{ kind: 'positional', value: { type: 'string', value } }]) };
}
function menuInputNode(menuOpcode, node) {
  if (node && node.type === 'string') return menuValueNode(menuOpcode, node.value);
  return node;
}
function keyedInput(key, value) {
  return { kind: 'keyed', sep: 'input', key, value };
}
function keyedField(key, value) {
  return { kind: 'keyed', sep: 'field', key, value };
}
function branchArg(key, body, wireKey) {
  return { kind: 'branch', key, body, wireKey: wireKey || null };
}

function toFieldValueNode(e) {
  switch (e.type) {
    case 'string':
      return { type: 'array', value: [e.value] };
    case 'ident':
      return { type: 'array', value: [e.name] };
    case 'number':
      return { type: 'array', value: [String(e.value)] };
    case 'boolean':
      return { type: 'array', value: [String(e.value)] };
    case 'var':
    case 'list':
    case 'broadcast':
      return { type: 'array', value: [e.name, e.id] };
    case 'json':
      return { type: 'array', value: Array.isArray(e.value) ? e.value : [e.value] };
    default:
      return { type: 'array', value: [''] };
  }
}

export { BRANCH_SUBSTACK_OPCODES, LEGACY_FIELD_KEYS, STATEMENT_KEYWORDS };
