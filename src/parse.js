// Statement keywords that introduce a control construct instead of a plain
// expression-statement.
const STATEMENT_KEYWORDS = new Set([
  'def', 'if', 'forever', 'switch', 'case', 'default', 'repeat', 'until',
  'while', 'wait', 'wait_until', 'stop', 'return', 'broadcast', 'broadcast_wait', 'vars',
  'dangling_next',
]);

// Unary math/logic sugar: `name(x)` desugars to a single-arg operator block.
const UNARY_SUGAR = new Set([
  'round', 'not', 'abs', 'floor', 'ceiling', 'sqrt', 'sin', 'cos', 'tan',
  'asin', 'acos', 'atan', 'ln', 'log', 'exp', 'exp10',
]);
const MATHOP_NAME = { exp: 'e ^', exp10: '10 ^' };

const BRANCH_SUBSTACK_OPCODES = new Set([
  'control_forever', 'control_switch', 'control_case', 'control_case_fallthrough',
  'control_default', 'control_repeat', 'control_repeat_until', 'control_while',
]);

const BINARY_OPS = {
  '||': 1, '&&': 2,
  '==': 3, '!=': 3, '<': 3, '>': 3, '<=': 3, '>=': 3,
  '..': 4,
  '+': 5, '-': 5,
  '*': 6, '/': 6, '%': 6,
};
const TWO_CHAR_OPS = new Set(['==', '!=', '<=', '>=', '&&', '||', '..']);
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
  const calls = parser.parseStatementList(/* stopAtBrace */ false);
  return { calls };
}

export function preprocess(text) {
  return stripHeader(text);
}

function stripHeader(text) {
  const s = String(text || '');
  if (s.startsWith('/**')) {
    const end = s.indexOf('*/');
    if (end >= 0) return s.slice(end + 2);
  }
  return s;
}

class ParseError extends Error {}

class Parser {
  constructor(text) {
    this.s = text;
    this.i = 0;
    this.len = text.length;
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

  expectIdentifier() {
    const id = this.tryIdentifier();
    if (id == null) throw new ParseError('expected identifier');
    return id;
  }

  expectChar(ch) {
    this.skipWS();
    if (this.peek() !== ch) throw new ParseError(`expected '${ch}' got '${this.peek()}'`);
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
      if (stopAtBrace && this.peek() === '}') break;
      const word = this.peekWord();
      if (word === 'import') {
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
      } catch {
        // Malformed statement: skip the offending line and keep going so one
        // bad line doesn't take down the whole file.
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
    if (STATEMENT_KEYWORDS.has(word)) {
      this.tryIdentifier(); // consume keyword
      return this.parseKeywordStatement(word);
    }

    const expr = this.parseExprStatementHead();
    this.tryChar(';');
    return expr;
  }

  parseKeywordStatement(word) {
    switch (word) {
      case 'def':
        return this.parseDef();
      case 'if':
        return this.parseIf();
      case 'forever':
        return this.parseSingleBranch('control_forever');
      case 'switch': {
        const value = this.parseExpr();
        const body = this.parseBraceBody();
        return makeCall('control_switch', [keyedInput('VALUE', value), branchArg('substack', body)]);
      }
      case 'case': {
        const value = this.parseExpr();
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
        const times = this.parseExpr();
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
        const v = this.parseExpr();
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
        const opt = v.type === 'string' ? v.value : String(v.value ?? 'all');
        return makeCall('control_stop', [keyedField('STOP_OPTION', { type: 'array', value: [opt] })]);
      }
      case 'return': {
        this.skipWS();
        let v = null;
        if (this.peek() !== ';' && this.peek() !== '\n' && !this.eof()) {
          v = this.parseExpr();
        }
        this.tryChar(';');
        return makeCall('procedures_return', v ? [keyedInput('VALUE', v)] : []);
      }
      case 'broadcast': {
        const v = this.parseExpr();
        this.tryChar(';');
        return makeCall('event_broadcast', [keyedInput('BROADCAST_INPUT', v)]);
      }
      case 'broadcast_wait': {
        const v = this.parseExpr();
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
          const v = this.parseExpr();
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
      default:
        throw new ParseError(`unhandled keyword ${word}`);
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
    this.skipWS();
    if (this.peekWord() === 'warp') {
      this.tryIdentifier();
      this.skipWS();
      if (this.peek() === '=') {
        this.i++;
        const w = this.tryIdentifier();
        warp = w === 'true';
      } else {
        warp = true;
      }
    }

    const body = this.parseBraceBody();
    return { type: 'procDef', ident, proccode, warp, params, body };
  }

  parseIf() {
    const cond = this.parseExpr();
    const thenBody = this.parseBraceBody();
    this.skipWS();
    const save = this.snapshot();
    if (this.peekWord() === 'else') {
      this.tryIdentifier();
      const elseBody = this.parseBraceBody();
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
    return this.parsePrimary();
  }

  parsePrimary() {
    this.skipWS();
    if (this.eof()) throw new ParseError('unexpected end of input');
    const ch = this.peek();

    if (ch === '(') return this.parseParenExpr();
    if (ch === '"') return { type: 'string', value: this.parseStringLiteral() };
    if (ch === '@') return this.parseProcCallExpr();
    if (ch === '[' || ch === '{') return { type: 'json', value: this.readJSONValue() };
    if (ch === '-' || /[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(this.peek(1)))) return this.parseNumberLiteral();

    const word = this.tryIdentifier();
    if (word == null) throw new ParseError(`unexpected character '${ch}'`);

    if (word === 'true') return { type: 'boolean', value: true };
    if (word === 'false') return { type: 'boolean', value: false };
    if (word === 'null') return { type: 'null' };

    if (word === 'var' || word === 'list' || word === 'broadcast' || word === 'arg') {
      return this.parseNamedRefCall(word);
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

    let callee = word;
    while (this.peek() === '.' && this.peek(1) !== '.') {
      this.i++;
      const part = this.expectIdentifier();
      callee += `_${part}`;
      this.skipWS();
    }

    if (this.peek() === '(') {
      this.i++;
      const args = this.parseKeyedArgs();
      this.expectChar(')');
      return { type: 'call', value: makeCall(callee, args) };
    }

    if (callee !== word) throw new ParseError(`expected call after dotted opcode '${callee.replace(/_/g, '.')}'`);

    return { type: 'ident', name: word };
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
    this.expectChar('@');
    const ident = this.expectIdentifier();
    this.expectChar('(');
    const args = this.parseKeyedArgs();
    this.expectChar(')');
    return { type: 'call', value: { type: 'call', callee: { type: 'procedureCall', name: ident }, args } };
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
    if (!text || text === '-') throw new ParseError('invalid number literal');
    return { type: 'number', value: Number(text), raw: text };
  }

  parseStringLiteral() {
    this.skipWS();
    if (this.peek() !== '"') throw new ParseError('expected string literal');
    this.i++;
    let result = '';
    while (!this.eof() && this.peek() !== '"') {
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
    if (this.peek() !== '"') throw new ParseError('unterminated string literal');
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
      this.skipWS();
      let forceField = false;
      const maybeField = this.snapshot();
      const maybeKeyword = this.tryIdentifier();
      if (maybeKeyword === 'field') {
        const afterField = this.snapshot();
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
      else throw new ParseError(`expected '=' or ':' after key '${key}'`);
      const value = this.parseExpr();
      const sep = forceField || (token === ':' && isLegacyFieldArg(key, value)) ? 'field' : 'input';
      args.push({ kind: 'keyed', sep, key, value });
      this.skipWS();
      if (this.tryChar(',')) continue;
      break;
    }
    return args;
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
    if (this.i === start) throw new ParseError('expected argument key');
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
    throw new ParseError(`unterminated ${open}...${close}`);
  }
}

const BINARY_OPCODES = {
  '+': ['operator_add', 'NUM1', 'NUM2'],
  '-': ['operator_subtract', 'NUM1', 'NUM2'],
  '*': ['operator_multiply', 'NUM1', 'NUM2'],
  '/': ['operator_divide', 'NUM1', 'NUM2'],
  '%': ['operator_mod', 'NUM1', 'NUM2'],
  '..': ['operator_join', 'STRING1', 'STRING2'],
  '==': ['operator_equals', 'OPERAND1', 'OPERAND2'],
  '<': ['operator_lt', 'OPERAND1', 'OPERAND2'],
  '>': ['operator_gt', 'OPERAND1', 'OPERAND2'],
  '&&': ['operator_and', 'OPERAND1', 'OPERAND2'],
  '||': ['operator_or', 'OPERAND1', 'OPERAND2'],
};s
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

function makeCall(opcode, args) {
  return { type: 'call', callee: { type: 'opcode', name: opcode }, args };
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

export { BRANCH_SUBSTACK_OPCODES, LEGACY_FIELD_KEYS };
