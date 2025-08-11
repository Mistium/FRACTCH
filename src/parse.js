export function parseFractch(content) {
  const preprocessed = preprocess(content);
  const { text, lossless } = extractLossless(preprocessed);
  const parser = new Parser(text);
  const calls = [];
  const losslessBlocks = {};

  parser.skipWS();
  while (!parser.eof()) {
    const word = parser.peekWord();
    if (word === 'import' || word === '') {
      parser.skipToEOL();
      parser.skipWS();
      continue;
    }

    const snap = parser.snapshot();
    const embedded = parser.parseEmbeddedLossless();
    if (embedded) {
      losslessBlocks[embedded.id] = embedded.json;

      continue;
    }
    parser.restore(snap);

    try {
      const call = parser.parseCall();
      if (call) calls.push(call);
    } catch {
      parser.skipToEOL();
    }
    parser.skipWS();
  }

  try {
    const collector = new Parser(text);
    const found = collector.collectAllEmbeddedLossless();
    for (const e of found) {
      if (e && e.id && e.json) losslessBlocks[e.id] = e.json;
    }
  } catch {
    // Handle error
  }

  const finalLossless = Object.keys(losslessBlocks).length ? losslessBlocks : lossless;
  return { calls, losslessBlocks: finalLossless };
}

class Parser {
  constructor(text) {
    this.s = text;
    this.i = 0;
    this.len = this.s.length;
  }

  eof() {
    return this.i >= this.len;
  }
  peek() {
    return this.s[this.i];
  }
  next() {
    return this.s[this.i++];
  }
  snapshot() {
    return { i: this.i };
  }
  restore(st) {
    if (st && typeof st.i === 'number') this.i = st.i;
  }

  skipWS() {
    while (!this.eof()) {
      const ch = this.peek();
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        this.i++;
      } else if (ch === '/' && this.s[this.i + 1] === '/') {
        while (!this.eof() && this.peek() !== '\n') this.i++;
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
    this.skipWS();
    let j = this.i;
    let word = '';
    while (j < this.len && /[A-Za-z_]/.test(this.s[j])) {
      word += this.s[j];
      j++;
    }
    return word;
  }

  parseCall() {
    this.skipWS();
    if (this.eof()) return null;

    const name = this.parseIdentifier();
    if (!name) return null;

    let callee;
    if (name === 'procedures') {
      this.skipWS();
      if (this.peek() !== '[') return null;
      this.i++; // skip '['
      const procName = this.parseStringLiteral();
      this.skipWS();
      if (this.peek() !== ']') return null;
      this.i++; // skip ']'
      callee = { type: 'procedureCall', name: procName };
    } else {
      callee = { type: 'opcode', name };
    }

    this.skipWS();
    if (this.peek() !== '(') return null;
    this.i++; // skip '('

    const args = this.parseSimpleArgs();

    this.skipWS();
    if (this.peek() === ')') this.i++;

    return { type: 'call', callee, args };
  }

  parseEmbeddedLossless() {
    this.skipWS();
    const start = this.i;

    if (this.s.slice(this.i, this.i + 6) === 'block.') {
      this.i += 6;
    }
    const opcode = this.parseIdentifier();
    if (!opcode) {
      this.i = start;
      return null;
    }
    this.skipWS();
    if (this.peek() !== '<') {
      this.i = start;
      return null;
    }
    this.i++;

    let id = '';
    if (this.peek() === '"') {
      id = this.parseStringLiteral();
    } else {
      while (!this.eof() && this.peek() !== '>') {
        id += this.next();
      }
    }
    if (this.peek() !== '>') {
      this.i = start;
      return null;
    }
    this.i++;
    this.skipWS();
    if (this.peek() !== '(') {
      this.i = start;
      return null;
    }
    this.i++;
    let depth = 1;
    let found = false;
    let jsonObj = undefined;
    while (!this.eof() && depth > 0) {
      this.skipWS();

      if (this.s.slice(this.i, this.i + 6) === '$json:') {
        this.i += 6;
        this.skipWS();

        if (this.peek() !== '{') {
          this.i = start;
          return null;
        }
        const obj = this.readJSONObject();
        jsonObj = obj;
        found = true;

        this.skipWS();
      } else {
        const ch = this.next();
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        else if (ch === '"') {
          while (!this.eof() && this.peek() !== '"') {
            if (this.next() === '\\') this.next();
          }
          if (!this.eof()) this.next();
        } else if (ch === '{') {
          let bd = 1;
          while (!this.eof() && bd > 0) {
            const c2 = this.next();
            if (c2 === '{') bd++;
            else if (c2 === '}') bd--;
            else if (c2 === '"') {
              while (!this.eof() && this.peek() !== '"') {
                if (this.next() === '\\') this.next();
              }
              if (!this.eof()) this.next();
            }
          }
        }
      }
    }
    if (!found) {
      this.i = start;
      return null;
    }
    return { id, opcode, json: jsonObj };
  }

  collectAllEmbeddedLossless() {
    const results = [];
    while (!this.eof()) {
      const snap = this.snapshot();
      const e = this.parseEmbeddedLossless();
      if (e) {
        results.push(e);

        continue;
      }
      this.restore(snap);
      this.i += 1; // advance one char and retry
    }
    return results;
  }

  parseIdentifier() {
    this.skipWS();
    const start = this.i;

    if (this.eof() || !/[A-Za-z_]/.test(this.peek())) return null;

    while (!this.eof() && /[A-Za-z0-9_]/.test(this.peek())) {
      this.i++;
    }

    return this.s.slice(start, this.i);
  }

  parseStringLiteral() {
    this.skipWS();
    if (this.peek() !== '"') return '';

    this.i++; // skip opening quote
    let result = '';

    while (!this.eof() && this.peek() !== '"') {
      const ch = this.next();
      if (ch === '\\') {
        const next = this.next();
        if (next === '"') result += '"';
        else if (next === '\\') result += '\\';
        else if (next === 'n') result += '\n';
        else if (next === 't') result += '\t';
        else if (next === 'r') result += '\r';
        else result += next;
      } else {
        result += ch;
      }
    }

    if (this.peek() === '"') this.i++; // skip closing quote
    return result;
  }

  parseSimpleArgs() {
    let depth = 1;

    while (!this.eof() && depth > 0) {
      const ch = this.next();
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (ch === '"') {
        while (!this.eof() && this.peek() !== '"') {
          if (this.next() === '\\') this.next(); // skip escaped char
        }
        if (!this.eof()) this.next(); // skip closing quote
      }
    }

    return []; // Return empty args for now
  }

  readJSONObject() {
    const start = this.i;
    let depth = 0;
    let i = this.i;
    while (i < this.len) {
      const ch = this.s[i++];
      if (ch === '"') {
        while (i < this.len) {
          const c = this.s[i++];
          if (c === '"') break;
          if (c === '\\') i++; // skip escaped char
        }
      } else if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    const json = this.s.slice(start, i);
    this.i = i;
    return JSON.parse(json);
  }
}

export function preprocess(text) {
  const s = String(text || '');
  if (s.startsWith('/**')) {
    const end = s.indexOf('*/');
    if (end >= 0) return s.slice(end + 2);
  }
  return s;
}

function extractLossless(text) {
  const s = String(text || '');
  const begin = s.indexOf('// LOSSLESS-BLOCKS BEGIN');
  const end = s.indexOf('// LOSSLESS-BLOCKS END');
  if (begin === -1 || end === -1 || end < begin) {
    return { text: s, lossless: undefined };
  }
  const body = s.slice(0, begin);
  const section = s.slice(begin, end);
  const lines = section.split(/\r?\n/);
  const map = {};
  for (const line of lines) {
    const m = /^\s*block\s+("[^"]*"|[^\s=]+)\s*=\s*(\{.*\})\s*$/.exec(line.trim());
    if (!m) continue;
    try {
      const id = JSON.parse(m[1]);
      const obj = JSON.parse(m[2]);
      map[id] = obj;
    } catch {
      // Handle error
    }
  }
  return { text: body, lossless: Object.keys(map).length ? map : undefined };
}
