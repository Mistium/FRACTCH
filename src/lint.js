export class FractchSyntaxError extends Error {
  constructor(message, line, col) {
    super(`${message} (line ${line}, col ${col})`);
    this.name = 'FractchSyntaxError';
    this.line = line;
    this.col = col;
  }
}

function stripHeader(text) {
  const s = String(text || '');
  if (s.startsWith('/**')) {
    const end = s.indexOf('*/');
    if (end >= 0) return ' '.repeat(end + 2) + s.slice(end + 2);
  }
  return s;
}

export function checkFractch(text) {
  const src = stripHeader(text);
  const errors = [];
  const stack = [];
  const pairs = { ')': '(', ']': '[', '}': '{' };
  let line = 1;
  let col = 0;
  let i = 0;

  const at = () => ({ line, col });
  const adv = () => {
    const ch = src[i++];
    if (ch === '\n') { line++; col = 0; } else { col++; }
    return ch;
  };

  while (i < src.length) {
    const ch = src[i];

    if (ch === '\n' || ch === '\r' || ch === ' ' || ch === '\t') { adv(); continue; }

    if (ch === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') adv(); continue; }

    if (ch === '/' && src[i + 1] === '*') {
      adv();
      adv();
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) adv();
      if (i < src.length) { adv(); adv(); }
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      const start = at();
      adv();
      let closed = false;
      while (i < src.length) {
        const c = adv();
        if (c === '\\') { adv(); continue; }
        if (c === quote) { closed = true; break; }
        if (c === '\n') break;
      }
      if (!closed) errors.push(new FractchSyntaxError('unterminated string', start.line, start.col));
      continue;
    }

    if (ch === '(' || ch === '[' || ch === '{') { stack.push({ ch, ...at() }); adv(); continue; }

    if (ch === ')' || ch === ']' || ch === '}') {
      const pos = at();
      const top = stack.pop();
      if (!top) errors.push(new FractchSyntaxError(`unexpected '${ch}'`, pos.line, pos.col));
      else if (top.ch !== pairs[ch])
        errors.push(new FractchSyntaxError(`mismatched '${ch}' — expected close of '${top.ch}' from line ${top.line}`, pos.line, pos.col));
      adv();
      continue;
    }

    adv();
  }

  for (const open of stack) errors.push(new FractchSyntaxError(`unclosed '${open.ch}'`, open.line, open.col));

  return errors;
}

export function assertValidFractch(text, file = '<fractch>') {
  const errors = checkFractch(text);
  if (errors.length) {
    const msg = errors.map((e) => `${file}: ${e.message}`).join('\n');
    const err = new FractchSyntaxError(errors[0].message, errors[0].line, errors[0].col);
    err.message = msg;
    err.all = errors;
    throw err;
  }
}
