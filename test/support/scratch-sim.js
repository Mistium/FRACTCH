// A tiny Scratch 3 interpreter for the block subset the stdlib packages compile to
// (all warp, so no yielding). Text comparison is case-insensitive like Scratch's.

const isWhitespace = (v) => typeof v === 'string' && v.trim() === '';
const num = (v) => {
  if (typeof v === 'number') return Number.isNaN(v) ? 0 : v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = Number(v);
  return Number.isNaN(n) || isWhitespace(v) ? 0 : n;
};
const str = (v) => String(v);
const bool = (v) =>
  typeof v === 'boolean' ? v : typeof v === 'string' ? !(v === '' || v === '0' || v.toLowerCase() === 'false') : !!v;

function compare(a, b) {
  let n1 = Number(a);
  let n2 = Number(b);
  if (n1 === 0 && isWhitespace(a)) n1 = NaN;
  else if (n2 === 0 && isWhitespace(b)) n2 = NaN;
  if (Number.isNaN(n1) || Number.isNaN(n2)) {
    const s1 = str(a).toLowerCase();
    const s2 = str(b).toLowerCase();
    return s1 < s2 ? -1 : s1 > s2 ? 1 : 0;
  }
  return n1 - n2;
}

class Return {
  constructor(value) {
    this.value = value;
  }
}

// Runs every green-flag script of the stage and returns what was said, in order.
export function runStage(target) {
  const blocks = target.blocks;
  const vars = Object.fromEntries(Object.entries(target.variables).map(([id, [, v]]) => [id, v]));
  const lists = Object.fromEntries(Object.entries(target.lists).map(([id, [, v]]) => [id, [...v]]));
  const procs = {};
  for (const b of Object.values(blocks)) {
    if (b.opcode !== 'procedures_definition') continue;
    const proto = blocks[b.inputs.custom_block[1]];
    procs[proto.mutation.proccode] = { def: b, argNames: JSON.parse(proto.mutation.argumentnames) };
  }
  const said = [];
  const listOf = (b) => lists[b.fields.LIST[1]];
  const input = (b, name, frame) => {
    const value = b.inputs[name]?.[1];
    if (typeof value === 'string') return evaluate(blocks[value], frame);
    if (Array.isArray(value)) {
      if (value[0] === 12) return vars[value[2]];
      if (value[0] === 13) return lists[value[2]].join(' ');
      return value[1];
    }
    return '';
  };
  const call = (b, frame) => {
    const proc = procs[b.mutation.proccode];
    if (!proc) throw new Error(`no definition for ${b.mutation.proccode}`);
    const ids = JSON.parse(b.mutation.argumentids);
    const args = {};
    proc.argNames.forEach((n, k) => (args[n] = input(b, ids[k], frame)));
    try {
      run(proc.def.next, args);
    } catch (e) {
      if (e instanceof Return) return e.value;
      throw e;
    }
    return '';
  };
  function evaluate(b, frame) {
    const I = (n) => input(b, n, frame);
    switch (b.opcode) {
      case 'argument_reporter_string_number':
        return frame[b.fields.VALUE[0]] ?? '';
      case 'data_variable':
        return vars[b.fields.VARIABLE[1]];
      case 'operator_add':
        return num(I('NUM1')) + num(I('NUM2'));
      case 'operator_subtract':
        return num(I('NUM1')) - num(I('NUM2'));
      case 'operator_multiply':
        return num(I('NUM1')) * num(I('NUM2'));
      case 'operator_divide':
        return num(I('NUM1')) / num(I('NUM2'));
      case 'operator_mod': {
        const n = num(I('NUM1'));
        const m = num(I('NUM2'));
        let r = n % m;
        if (r / m < 0) r += m;
        return r;
      }
      case 'operator_equals':
        return compare(I('OPERAND1'), I('OPERAND2')) === 0;
      case 'operator_lt':
        return compare(I('OPERAND1'), I('OPERAND2')) < 0;
      case 'operator_gt':
        return compare(I('OPERAND1'), I('OPERAND2')) > 0;
      case 'operator_and':
        return bool(I('OPERAND1')) && bool(I('OPERAND2'));
      case 'operator_or':
        return bool(I('OPERAND1')) || bool(I('OPERAND2'));
      case 'operator_not':
        return !bool(I('OPERAND'));
      case 'operator_join':
        return str(I('STRING1')) + str(I('STRING2'));
      case 'operator_length':
        return str(I('STRING')).length;
      case 'operator_letter_of': {
        const i = num(I('LETTER')) - 1;
        const s = str(I('STRING'));
        return i < 0 || i >= s.length ? '' : s[i];
      }
      case 'data_itemoflist': {
        const l = listOf(b);
        const n = Math.floor(num(I('INDEX')));
        return n < 1 || n > l.length ? '' : l[n - 1];
      }
      case 'data_lengthoflist':
        return listOf(b).length;
      case 'data_itemnumoflist': {
        const l = listOf(b);
        const v = I('ITEM');
        return l.findIndex((x) => compare(x, v) === 0) + 1;
      }
      case 'procedures_call':
        return call(b, frame);
      default:
        throw new Error(`unsupported reporter ${b.opcode}`);
    }
  }
  function run(id, frame) {
    while (id) {
      const b = blocks[id];
      const I = (n) => input(b, n, frame);
      const index = () => Math.floor(num(I('INDEX')));
      switch (b.opcode) {
        case 'data_setvariableto':
          vars[b.fields.VARIABLE[1]] = I('VALUE');
          break;
        case 'data_changevariableby':
          vars[b.fields.VARIABLE[1]] = num(vars[b.fields.VARIABLE[1]]) + num(I('VALUE'));
          break;
        case 'data_addtolist':
          listOf(b).push(I('ITEM'));
          break;
        case 'data_deletealloflist':
          listOf(b).length = 0;
          break;
        case 'data_deleteoflist': {
          const l = listOf(b);
          const n = index();
          if (n >= 1 && n <= l.length) l.splice(n - 1, 1);
          break;
        }
        case 'data_insertatlist': {
          const l = listOf(b);
          const n = index();
          if (n >= 1 && n <= l.length + 1) l.splice(n - 1, 0, I('ITEM'));
          break;
        }
        case 'data_replaceitemoflist': {
          const l = listOf(b);
          const n = index();
          if (n >= 1 && n <= l.length) l[n - 1] = I('ITEM');
          break;
        }
        case 'control_if':
          if (bool(I('CONDITION'))) run(b.inputs.SUBSTACK?.[1], frame);
          break;
        case 'control_if_else':
          run(bool(I('CONDITION')) ? b.inputs.SUBSTACK?.[1] : b.inputs.SUBSTACK2?.[1], frame);
          break;
        case 'control_repeat': {
          const n = Math.round(num(I('TIMES')));
          for (let k = 0; k < n; k++) run(b.inputs.SUBSTACK?.[1], frame);
          break;
        }
        case 'control_repeat_until': {
          for (let guard = 0; !bool(I('CONDITION')); guard++) {
            if (guard > 1e6) throw new Error('runaway loop');
            run(b.inputs.SUBSTACK?.[1], frame);
          }
          break;
        }
        case 'procedures_return':
          throw new Return(I('VALUE'));
        case 'procedures_call':
          call(b, frame);
          break;
        case 'looks_say':
          said.push(I('MESSAGE'));
          break;
        default:
          throw new Error(`unsupported statement ${b.opcode}`);
      }
      id = b.next;
    }
  }
  for (const b of Object.values(blocks)) if (b.opcode === 'event_whenflagclicked') run(b.next, {});
  return said;
}
