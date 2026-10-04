export class FractchSyntaxError extends Error {
  constructor(message, line, col) {
    super(`${message} (line ${line}, col ${col})`);
    this.name = 'FractchSyntaxError';
    this.line = line;
    this.col = col;
  }
}

function stripHeader(text) {
  const s = String(text || '').replace(/^\uFEFF/, '');
  if (s.startsWith('/**')) {
    const end = s.indexOf('*/');
    // Blank the header but keep its newlines so reported lines match the file.
    if (end >= 0) return s.slice(0, end + 2).replace(/[^\n]/g, ' ') + s.slice(end + 2);
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

  // `col` counts consumed characters; report 1-based columns like the parser.
  const at = () => ({ line, col: col + 1 });
  const adv = () => {
    const ch = src[i++];
    if (ch === '\n') {
      line++;
      col = 0;
    } else {
      col++;
    }
    return ch;
  };

  // Scan template text up to its closing backtick, or up to a `${`, whose
  // expression the main loop then scans like any other code (so it may hold
  // strings and nested templates).
  const scanTemplate = (start) => {
    while (i < src.length) {
      const c = adv();
      if (c === '\\') {
        if (i < src.length) adv();
        continue;
      }
      if (c === '`') return;
      if (c === '$' && src[i] === '{') {
        stack.push({ ch: '${', ...at(), template: start });
        adv();
        return;
      }
    }
    errors.push(new FractchSyntaxError('unterminated template string', start.line, start.col));
  };

  while (i < src.length) {
    const ch = src[i];

    if (ch === '\n' || ch === '\r' || ch === ' ' || ch === '\t') {
      adv();
      continue;
    }

    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') adv();
      continue;
    }

    if (ch === '/' && src[i + 1] === '*') {
      adv();
      adv();
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) adv();
      if (i < src.length) {
        adv();
        adv();
      }
      continue;
    }

    if (ch === '"' && src[i + 1] === '"' && src[i + 2] === '"') {
      const start = at();
      adv();
      adv();
      adv();
      let closed = false;
      while (i < src.length) {
        if (src[i] === '"' && src[i + 1] === '"' && src[i + 2] === '"') {
          adv();
          adv();
          adv();
          closed = true;
          break;
        }
        adv();
      }
      if (!closed) errors.push(new FractchSyntaxError('unterminated """ string', start.line, start.col));
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      const start = at();
      adv();
      let closed = false;
      while (i < src.length) {
        const c = adv();
        if (c === '\\') {
          adv();
          continue;
        }
        if (c === quote) {
          closed = true;
          break;
        }
        if (c === '\n') break;
      }
      if (!closed) errors.push(new FractchSyntaxError('unterminated string', start.line, start.col));
      continue;
    }

    if (ch === '`') {
      const start = at();
      adv();
      scanTemplate(start);
      continue;
    }

    if (ch === '(' || ch === '[' || ch === '{') {
      stack.push({ ch, ...at() });
      adv();
      continue;
    }

    if (ch === '}' && stack[stack.length - 1]?.ch === '${') {
      // End of a template interpolation: resume scanning the template's text.
      adv();
      scanTemplate(stack.pop().template);
      continue;
    }

    if (ch === ')' || ch === ']' || ch === '}') {
      const pos = at();
      const top = stack.pop();
      if (!top) errors.push(new FractchSyntaxError(`unexpected '${ch}'`, pos.line, pos.col));
      else if (top.ch !== pairs[ch])
        errors.push(
          new FractchSyntaxError(
            `mismatched '${ch}' — expected close of '${top.ch}' from line ${top.line}`,
            pos.line,
            pos.col
          )
        );
      adv();
      continue;
    }

    adv();
  }

  for (const open of stack) {
    if (open.ch === '${')
      errors.push(new FractchSyntaxError('unterminated template string', open.template.line, open.template.col));
    else errors.push(new FractchSyntaxError(`unclosed '${open.ch}'`, open.line, open.col));
  }

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
