export const DIAGNOSTIC_CODES = {
  FR100: { severity: 'error', title: 'Syntax error' },
  FR101: { severity: 'error', title: 'Unknown hat' },
  FR102: { severity: 'error', title: 'Unterminated string' },
  FR103: { severity: 'error', title: "Unmatched '}'" },
  FR104: { severity: 'error', title: "Missing '}'" },
  FR105: { severity: 'error', title: 'Block call without parentheses' },
  FR106: { severity: 'error', title: 'Unknown list method' },
  FR107: { severity: 'error', title: 'Unknown sprite property' },
  FR108: { severity: 'error', title: 'Expected a value' },
  FR109: { severity: 'error', title: "Expected ',' or ')'" },
  FR110: { severity: 'error', title: "Expected ':' after an argument name" },
  FR111: { severity: 'error', title: 'Statement needs a value' },
  FR112: { severity: 'error', title: 'Cloud list' },
  FR113: { severity: 'error', title: 'Sound declaration without file' },
  FR114: { severity: 'error', title: 'Reserved word' },
  FR115: { severity: 'error', title: 'Invalid loop form' },
  FR116: { severity: 'error', title: 'Wrong method argument count' },
  FR117: { severity: 'error', title: 'Unterminated JSON value' },
  FR118: { severity: 'error', title: 'Unterminated template string' },
  FR119: { severity: 'error', title: 'Unbalanced bracket' },
  FR120: { severity: 'error', title: 'Region in the wrong place' },
  FR121: { severity: 'error', title: 'Invalid locked script line' },
  FR201: { severity: 'error', title: 'Unknown block' },
  FR202: { severity: 'error', title: 'Menu used as a statement' },
  FR203: { severity: 'error', title: 'Value used as a statement' },
  FR204: { severity: 'error', title: 'Reporter used as a statement' },
  FR205: { severity: 'error', title: 'Unknown input name' },
  FR206: { severity: 'error', title: 'Unknown field name' },
  FR207: { severity: 'error', title: 'Invalid menu value' },
  FR208: { severity: 'error', title: 'Undefined custom block' },
  FR209: { severity: 'error', title: 'Wrong argument count' },
  FR210: { severity: 'error', title: 'Local declared twice' },
  FR211: { severity: 'error', title: 'Custom block defined twice' },
  FR212: { severity: 'error', title: 'Undeclared name' },
  FR213: { severity: 'info', title: 'Variable created by assignment' },
  FR214: { severity: 'error', title: 'Unknown list method' },
  FR215: { severity: 'error', title: 'Unknown package function' },
  FR216: { severity: 'error', title: 'Unknown variable method' },
  FR217: { severity: 'error', title: 'Extension not loaded' },
  FR218: { severity: 'error', title: 'Unknown extension block' },
  FR219: { severity: 'error', title: 'Unknown extension argument' },
  FR220: { severity: 'error', title: 'Deleted declaration is still used' },
  FR221: { severity: 'error', title: 'Hidden operator values would be lost' },
  FR222: { severity: 'info', title: 'Declaration created' },
  FR223: { severity: 'warning', title: 'Not applied from this text' },
  FR224: { severity: 'error', title: 'Text would not convert back the same way' },
  FR225: { severity: 'error', title: 'Command used as a value' },
  FR226: { severity: 'error', title: 'Declared twice' },
  FR227: { severity: 'error', title: 'Invalid block structure' },
  FR301: { severity: 'warning', title: 'Asset file problem' },
  FR302: { severity: 'error', title: 'Duplicate asset name' },
  FR303: { severity: 'warning', title: 'Watcher for a missing variable' },
  FR304: { severity: 'info', title: 'Unused assets removed' },
  FR305: { severity: 'info', title: 'Floating shadows dropped' },
  FR306: { severity: 'info', title: 'Empty obscured inputs normalized' },
  FR307: { severity: 'info', title: 'Membership map unreadable' },
  FR308: { severity: 'info', title: 'File ignored' },
  FR309: { severity: 'error', title: 'Project directory problem' },
  FR310: { severity: 'error', title: 'Standard library problem' },
  FR311: { severity: 'error', title: 'Unreadable file' },
  FR312: { severity: 'warning', title: 'Package method fell back to an opcode' },
};

export function diagnostic(code, message, extra = {}) {
  const meta = DIAGNOSTIC_CODES[code] || DIAGNOSTIC_CODES.FR100;
  const out = {
    severity: extra.severity || meta.severity,
    code,
    message,
    hint: extra.hint ?? null,
    line: extra.line ?? 0,
    column: extra.column ?? 0,
    endLine: extra.endLine ?? extra.line ?? 0,
    endColumn: extra.endColumn ?? extra.column ?? 0,
  };
  if (extra.from != null) out.from = extra.from;
  if (extra.to != null) out.to = extra.to;
  if (extra.file != null) out.file = extra.file;
  if (extra.fix) out.fix = extra.fix;
  return out;
}

export function makeLineIndex(text) {
  const s = String(text ?? '');
  const starts = [0];
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) starts.push(i + 1);
  const lineOf = (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  return {
    starts,
    position(offset) {
      const o = Math.max(0, Math.min(offset ?? 0, s.length));
      const l = lineOf(o);
      return { line: l + 1, column: o - starts[l] + 1 };
    },
    offset(line, column = 1) {
      const l = Math.max(1, Math.min(line, starts.length)) - 1;
      return Math.min(starts[l] + Math.max(column - 1, 0), s.length);
    },
    lineEnd(line) {
      const l = Math.max(1, Math.min(line, starts.length)) - 1;
      return l + 1 < starts.length ? starts[l + 1] - 1 : s.length;
    },
  };
}

export function rangeExtra(index, from, to) {
  const a = index.position(from);
  const b = index.position(to ?? from);
  return { line: a.line, column: a.column, endLine: b.line, endColumn: b.column, from, to: to ?? from };
}

export function hasErrors(diagnostics) {
  return (diagnostics || []).some((d) => d.severity === 'error');
}

export function formatDiagnostic(d) {
  const loc = d.line ? `:${d.line}${d.column ? ':' + d.column : ''}` : '';
  return `${d.file || ''}${loc}: ${d.severity} ${d.code}: ${d.message}${d.hint ? `\n    hint: ${d.hint}` : ''}`;
}
