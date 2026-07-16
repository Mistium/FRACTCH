import { LEGACY_FIELD_KEYS, STATEMENT_KEYWORDS } from './parse.js';
import { STDLIB_PROCCODE_TO_METHOD, STDLIB_DEF_TO_PACKAGE } from './stdlib/index.js';

let CTX = {};
export function setContext(c) {
  CTX = c || {};
}

const LOCAL_VAR_RE = /^!local_[A-Za-z0-9]+_(.+)$/;
export function localBareName(name) {
  const m = LOCAL_VAR_RE.exec(String(name));
  return m ? m[1] : null;
}

const PREC = {
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '<': 3,
  '>': 3,
  '<=': 3,
  '>=': 3,
  '++': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6,
};
const UNARY_PREC = 7;
const ATOM_PREC = 100;

const REPARSABLE_NUMBER = /^-?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/;

const BARE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED_WORDS = new Set([
  'true',
  'false',
  'null',
  'shadow',
  'var',
  'list',
  'broadcast',
  'arg',
  'vars',
  'menu',
  'at',
  'for',
  'fallthrough',
  'else',
  'import',
  'field',
  'warp',
  'color',
  'returns',
  'not',
  'round',
  'raw',
]);

function bareNameOk(name) {
  return BARE_NAME.test(name) && !RESERVED_WORDS.has(name) && !STATEMENT_KEYWORDS.has(name);
}

const SIMPLE_ALIAS_EMIT = {
  looks_show: 'show',
  looks_hide: 'hide',
  looks_nextcostume: 'nextCostume',
  looks_nextbackdrop: 'nextBackdrop',
  looks_cleargraphiceffects: 'clearEffects',
  control_break: 'break',
  control_delete_this_clone: 'deleteClone',
  sensing_resettimer: 'resetTimer',
  motion_ifonedgebounce: 'ifOnEdgeBounce',
  sound_stopallsounds: 'stopAllSounds',
  sound_cleareffects: 'clearSoundEffects',
  pen_penUp: 'penUp',
  pen_penDown: 'penDown',
  pen_clear: 'penClear',
  pen_stamp: 'stamp',
};

const UNARY_ALIAS_EMIT = {
  looks_say: ['say', 'MESSAGE'],
  looks_think: ['think', 'MESSAGE'],
  sensing_askandwait: ['ask', 'QUESTION'],
  motion_movesteps: ['move', 'STEPS'],
  motion_turnright: ['turn', 'DEGREES'],
  motion_turnleft: ['turnLeft', 'DEGREES'],
  motion_pointindirection: ['point', 'DIRECTION'],
  motion_setx: ['setX', 'X'],
  motion_sety: ['setY', 'Y'],
  motion_changexby: ['changeX', 'DX'],
  motion_changeyby: ['changeY', 'DY'],
  looks_setsizeto: ['setSize', 'SIZE'],
  looks_changesizeby: ['changeSize', 'CHANGE'],
  sound_changevolumeby: ['changeVolume', 'VOLUME'],
  sound_setvolumeto: ['setVolume', 'VOLUME'],
};

const MENU_CMD_EMIT = {
  looks_switchcostumeto: { base: 'costume', key: 'COSTUME', menu: 'looks_costume', sentinels: {}, lead: [] },
  looks_switchbackdropto: { base: 'backdrop', key: 'BACKDROP', menu: 'looks_backdrops', sentinels: {}, lead: [] },
  control_create_clone_of: {
    base: 'clone',
    key: 'CLONE_OPTION',
    menu: 'control_create_clone_of_menu',
    sentinels: { _myself_: 'cloneMyself' },
    lead: [],
  },
  motion_goto: {
    base: 'goto',
    key: 'TO',
    menu: 'motion_goto_menu',
    sentinels: { _mouse_: 'gotoMouse', _random_: 'gotoRandom' },
    lead: [],
  },
  motion_pointtowards: {
    base: 'pointTowards',
    key: 'TOWARDS',
    menu: 'motion_pointtowards_menu',
    sentinels: { _mouse_: 'pointTowardsMouse', _random_: 'pointTowardsRandom' },
    lead: [],
  },
  motion_glideto: {
    base: 'glideTo',
    key: 'TO',
    menu: 'motion_glideto_menu',
    sentinels: { _mouse_: 'glideToMouse', _random_: 'glideToRandom' },
    lead: ['SECS'],
  },
  sound_play: { base: 'playSound', key: 'SOUND_MENU', menu: 'sound_sounds_menu', sentinels: {}, lead: [] },
  sound_playuntildone: {
    base: 'playSoundUntilDone',
    key: 'SOUND_MENU',
    menu: 'sound_sounds_menu',
    sentinels: {},
    lead: [],
  },
};

const LIST_STMT_EMIT = {
  data_addtolist: ['append', ['ITEM']],
  data_deleteoflist: ['delete', ['INDEX']],
  data_deletealloflist: ['clear', []],
  data_insertatlist: ['insert', ['INDEX', 'ITEM']],
  data_replaceitemoflist: ['replace', ['INDEX', 'ITEM']],
  data_showlist: ['showList', []],
  data_hidelist: ['hideList', []],
};

export function stringifyBlockCall(block, subgraph, id, inline = false, cfg = {}) {
  const opcode = block.opcode;

  if (opcode === 'patching_jscommand' || opcode === 'patching_jsreporter' || opcode === 'patching_jsboolean') {
    const values = Object.keys(block.inputs || {})
      .filter((key) => /^ARG\d+$/.test(key))
      .sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)))
      .map((key) => inputValueText(block.inputs[key], subgraph, key));
    const args = values.join(', ');
    if (opcode === 'patching_jscommand') return values.length ? `js ${values.join(' ')};` : '';
    if (opcode === 'patching_jsboolean') return `js.bool(${args})`;
    if (opcode === 'patching_jsreporter') return `js(${args})`;
  }

  if (opcode === 'procedures_call') {
    const code = block.mutation?.proccode;
    const info = code && CTX.procByCode?.get(code);
    if (info) {
      let callArgIds = null;
      try {
        const parsed = JSON.parse(block.mutation?.argumentids || 'null');
        if (Array.isArray(parsed) && parsed.length === info.params.length) callArgIds = parsed;
      } catch {
        callArgIds = null;
      }
      const args = info.params.map((p, i) => {
        const key =
          callArgIds && Object.prototype.hasOwnProperty.call(block.inputs || {}, callArgIds[i]) ? callArgIds[i] : p.id;
        const inp = block.inputs?.[key];
        return Array.isArray(inp) ? inputValueText(inp, subgraph, key) : 'null';
      });

      const pkg = STDLIB_DEF_TO_PACKAGE.get(info.ident);
      if (pkg && !STDLIB_PROCCODE_TO_METHOD.has(code)) {
        const call = `${pkg.namespace}.${pkg.method}(${args.join(', ')})`;
        return inline ? call : call + ';';
      }

      const method = STDLIB_PROCCODE_TO_METHOD.get(code);
      if (method && info.params.length >= 1) {
        const recvArr = block.inputs?.[info.params[0].id];
        const recvInfo = Array.isArray(recvArr) ? getInputExprInfo(recvArr, subgraph) : { text: 'null', prec: 0 };
        const recv = recvInfo.prec === ATOM_PREC ? recvInfo.text : `(${recvInfo.text})`;
        const call = `${recv}.${method}(${args.slice(1).join(', ')})`;
        return inline ? call : call + ';';
      }
      const call = `@${info.ident}(${args.join(', ')})`;
      return inline ? call : call + ';';
    }
  }

  if (opcode === 'data_variable') {
    const name = block.fields?.VARIABLE?.[0] ?? '';
    const local = localBareName(name);
    if (local && inline) return local;

    if (!inline) return `${JSON.stringify(String(name))};`;
    const out = /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(name)) ? String(name) : JSON.stringify(String(name));
    return out;
  }
  if (opcode === 'argument_reporter_string_number' || opcode === 'argument_reporter_boolean') {
    const name = String(block.fields?.VALUE?.[0] ?? '');
    if (!inline && opcode === 'argument_reporter_string_number') return `arg(${JSON.stringify(name)});`;
    if (!inline) return `arg(${JSON.stringify(name)}, "boolean");`;

    const mapped = CTX.scopeParamNames?.get(name);
    const declaredKind = CTX.scopeParamKinds?.get(name) || 's';
    const blockKind = opcode === 'argument_reporter_boolean' ? 'b' : 's';
    if (mapped && declaredKind === blockKind && bareNameOk(mapped)) return mapped;

    if (opcode === 'argument_reporter_boolean') return `arg(${JSON.stringify(name)}, "boolean")`;
    return `arg(${JSON.stringify(name)})`;
  }

  if (opcode === 'control_if' || opcode === 'control_if_else') {
    const condTuple = block.inputs?.CONDITION;
    const condStr = Array.isArray(condTuple) ? getInputExpr(condTuple, subgraph) : 'null';
    const thenId = block.inputs?.SUBSTACK && Array.isArray(block.inputs.SUBSTACK) ? block.inputs.SUBSTACK[1] : null;
    const elseId = block.inputs?.SUBSTACK2 && Array.isArray(block.inputs.SUBSTACK2) ? block.inputs.SUBSTACK2[1] : null;
    const header = `if ${condStr}`;
    const thenBody = thenId ? renderBody(subgraph, thenId) : '';
    if (opcode === 'control_if_else') {
      const elseBlock = elseId ? subgraph[elseId] : null;
      if (
        elseBlock &&
        !elseBlock.next &&
        (elseBlock.opcode === 'control_if' || elseBlock.opcode === 'control_if_else') &&
        !CTX.blockComments?.get(elseId)?.length
      ) {
        return `${header} {\n${indent(thenBody)}\n} else ${stringifyBlockCall(elseBlock, subgraph, elseId, false, cfg)}`;
      }
      const elseBody = elseId ? renderBody(subgraph, elseId) : '';
      return `${header} {\n${indent(thenBody)}\n} else {\n${indent(elseBody)}\n}`;
    }
    return `${header} {\n${indent(thenBody)}\n}`;
  }

  if ((opcode === 'data_setvariableto' || opcode === 'data_changevariableby') && !inline) {
    const varName = String(block.fields?.VARIABLE?.[0] ?? '');
    const value = inputValueText(block.inputs?.VALUE, subgraph, 'VALUE');
    const op = opcode === 'data_changevariableby' ? '+=' : '=';
    const local = localBareName(varName);
    if (local) {
      if (op === '=' && !CTX.declaredLocals?.has(local)) {
        CTX.declaredLocals?.add(local);
        return `local ${local} = ${value};`;
      }
      return `${local} ${op} ${value};`;
    }
    if (bareNameOk(varName)) return `${varName} ${op} ${value};`;
    return `vars[${JSON.stringify(varName)}] ${op} ${value};`;
  }

  if (opcode === 'control_forever') {
    return `forever ${branch(block, 'SUBSTACK', subgraph)}`;
  }
  if (opcode === 'control_for_each') {
    const forLoop = tryForLoop(block, subgraph);
    if (forLoop) return forLoop;
  }
  if (opcode === 'control_switch') {
    const v = Array.isArray(block.inputs?.VALUE) ? getInputExpr(block.inputs.VALUE, subgraph) : 'null';
    return `switch ${v} ${branch(block, 'SUBSTACK', subgraph)}`;
  }
  if (opcode === 'control_case') {
    const v = Array.isArray(block.inputs?.VALUE) ? getInputExpr(block.inputs.VALUE, subgraph) : 'null';
    return `case ${v} ${branch(block, 'SUBSTACK', subgraph)}`;
  }
  if (opcode === 'control_case_fallthrough') {
    const v = Array.isArray(block.inputs?.VALUE) ? getInputExpr(block.inputs.VALUE, subgraph) : 'null';
    return `case ${v} fallthrough ${branch(block, 'SUBSTACK', subgraph)}`;
  }
  if (opcode === 'control_default') {
    return `default ${branch(block, 'SUBSTACK', subgraph)}`;
  }
  if (opcode === 'control_repeat') {
    const n = getInputExpr(block.inputs?.TIMES, subgraph);
    return `repeat ${n} ${branch(block, 'SUBSTACK', subgraph)}`;
  }
  if (opcode === 'control_repeat_until') {
    const c = Array.isArray(block.inputs?.CONDITION) ? getInputExpr(block.inputs.CONDITION, subgraph) : 'null';
    return `until ${c} ${branch(block, 'SUBSTACK', subgraph)}`;
  }
  if (opcode === 'control_while') {
    const c = Array.isArray(block.inputs?.CONDITION) ? getInputExpr(block.inputs.CONDITION, subgraph) : 'null';
    return `while ${c} ${branch(block, 'SUBSTACK', subgraph)}`;
  }
  if (opcode === 'control_wait') {
    return `wait ${getInputExpr(block.inputs?.DURATION, subgraph)};`;
  }
  if (opcode === 'control_wait_until') {
    const c = Array.isArray(block.inputs?.CONDITION) ? getInputExpr(block.inputs.CONDITION, subgraph) : 'null';
    return `wait_until ${c};`;
  }
  if (opcode === 'control_stop') {
    const opt = block.fields?.STOP_OPTION?.[0] ?? 'all';
    if (opt === 'this script') return 'return;';
    const bare = { all: 'all', 'other scripts in sprite': 'other_scripts_in_sprite' }[opt];
    return `stop ${bare ?? JSON.stringify(opt)};`;
  }
  if ((opcode === 'procedures_return' || opcode === 'control_return') && block.inputs?.VALUE) {
    return `return ${inputValueText(block.inputs.VALUE, subgraph, 'VALUE')};`;
  }
  if (opcode === 'event_broadcast' || opcode === 'event_broadcastandwait') {
    const tuple = block.inputs?.BROADCAST_INPUT;
    const childId = Array.isArray(tuple) ? tuple[1] : null;

    let name;
    if (typeof childId === 'string' && subgraph[childId]) {
      name = inputValueText(tuple, subgraph, 'BROADCAST_INPUT');
    } else {
      const raw = Array.isArray(childId) ? String(childId[1] ?? '') : '';
      name = BARE_NAME.test(raw) && !RESERVED_WORDS.has(raw) ? raw : JSON.stringify(raw);
    }
    const w = opcode === 'event_broadcastandwait' ? 'broadcastWait' : 'broadcast';
    return `${w} ${name};`;
  }

  if (!inline) {
    const alias = tryStatementAlias(block, subgraph);
    if (alias) return alias;
  }

  const opExpr = tryOperatorInfo(block, subgraph);
  if (opExpr) {
    return inline ? opExpr.text : opExpr.text + ';';
  }

  const rep = tryReporterInfo(block, subgraph);
  if (rep) {
    return inline ? rep.text : rep.text + ';';
  }

  const listExpr = tryListExpr(block, subgraph);
  if (listExpr && (inline || !/\.length$/.test(listExpr.text))) {
    return inline ? listExpr.text : listExpr.text + ';';
  }

  const positionalArgs = tryPositionalArgs(block, subgraph, inline);
  const inputsStr = positionalArgs != null ? positionalArgs : stringifyInputs(block, subgraph, true);
  const fieldsStr = stringifyFields(block);
  const argParts = [];
  if (inputsStr) argParts.push(inputsStr);
  if (fieldsStr) argParts.push(fieldsStr);

  if (block.mutation) {
    argParts.push(`mutation: ${JSON.stringify(block.mutation)}`);
  }
  const opName = formatOpcodeName(opcode);
  const call = opName
    ? `${opName}(${argParts.join(', ')})`
    : `raw(${JSON.stringify(String(opcode))}${argParts.length ? `, ${argParts.join(', ')}` : ''})`;

  const substackKeys = Object.keys(block.inputs || {})
    .filter((k) => k.startsWith('SUBSTACK'))
    .sort();
  if (substackKeys.length) {
    const branches = substackKeys.map((k) => `${branch(block, k, subgraph)}`).join(' ');
    return `${call} ${branches}`;
  }
  return inline ? call : call + ';';
}

function tryPositionalArgs(block, subgraph, inline) {
  if (block.mutation) return null;
  if (block.fields && Object.keys(block.fields).length) return null;
  const keys = Object.keys(block.inputs || {}).filter((k) => !k.startsWith('SUBSTACK'));
  if (!keys.length || keys.length > 26) return null;
  for (let i = 0; i < keys.length; i++) {
    if (keys[i] !== String.fromCharCode(65 + i)) return null;
  }
  for (const k of keys) {
    const arr = block.inputs[k];
    if (!Array.isArray(arr) || arr.length < 2) return null;
  }
  if (inline && keys.length === 1) {
    const arr = block.inputs.A;
    const childId = arr[1];
    const child = typeof childId === 'string' ? subgraph[childId] : null;
    if (!child && Array.isArray(childId) && childId[0] === 10) {
      const printed = formatLiteral(arr);
      if (printed.startsWith('"')) return null;
    }

    if (child && child.shadow) return null;
  }
  return keys.map((k) => inputValueText(block.inputs[k], subgraph, k)).join(', ');
}

function getInputExpr(arr, subgraph) {
  return getInputExprInfo(arr, subgraph).text;
}

function getInputExprInfo(arr, subgraph) {
  if (!Array.isArray(arr) || arr.length < 2) return { text: 'null', prec: ATOM_PREC };
  const payload = arr[1];
  if (typeof payload === 'string' && subgraph[payload]) {
    return blockExprInfo(subgraph[payload], subgraph, payload);
  }
  return { text: formatLiteral(arr), prec: ATOM_PREC };
}

function blockExprInfo(block, subgraph, id) {
  const op = tryOperatorInfo(block, subgraph);
  if (op) return op;
  const le = tryListExpr(block, subgraph);
  if (le) return le;
  const so = trySpriteOf(block, subgraph);
  if (so) return so;
  return { text: stringifyBlockCall(block, subgraph, id, true), prec: ATOM_PREC };
}

const SPRITE_PROP_EMIT = {
  'x position': 'x',
  'y position': 'y',
  direction: 'direction',
  size: 'size',
  volume: 'volume',
  'costume #': 'costume_number',
  'costume name': 'costume_name',
  'backdrop #': 'backdrop_number',
  'backdrop name': 'backdrop_name',
};

const NULLARY_REPORTER_EMIT = {
  motion_xposition: 'xPosition',
  motion_yposition: 'yPosition',
  motion_direction: 'direction',
  looks_size: 'size',
  looks_costumes: 'costumes',
  sound_volume: 'volume',
  sensing_answer: 'answer',
  sensing_timer: 'timer',
  sensing_loudness: 'loudness',
  sensing_mousex: 'mouseX',
  sensing_mousey: 'mouseY',
  sensing_mousedown: 'mouseDown',
  sensing_username: 'username',
  sensing_dayssince2000: 'daysSince2000',
};
const FIELD_REPORTER_EMIT = {
  looks_costumenumbername: ['NUMBER_NAME', { number: 'costumeNumber', name: 'costumeName' }],
  looks_backdropnumbername: ['NUMBER_NAME', { number: 'backdropNumber', name: 'backdropName' }],
  sensing_current: [
    'CURRENTMENU',
    {
      YEAR: 'currentYear',
      MONTH: 'currentMonth',
      DATE: 'currentDate',
      DAYOFWEEK: 'currentDayOfWeek',
      HOUR: 'currentHour',
      MINUTE: 'currentMinute',
      SECOND: 'currentSecond',
    },
  ],
};
const REPORTER_MENU_EMIT = {
  sensing_touchingobject: {
    base: 'touching',
    key: 'TOUCHINGOBJECTMENU',
    menu: 'sensing_touchingobjectmenu',
    sentinels: { _mouse_: 'touchingMouse', _edge_: 'touchingEdge' },
  },
  sensing_distanceto: {
    base: 'distanceTo',
    key: 'DISTANCETOMENU',
    menu: 'sensing_distancetomenu',
    sentinels: { _mouse_: 'distanceToMouse' },
  },
  sensing_keypressed: { base: 'keyPressed', key: 'KEY_OPTION', menu: 'sensing_keyoptions', sentinels: {} },
};
const REPORTER_FUNC_EMIT = {
  sensing_touchingcolor: ['touchingColor', ['COLOR']],
  sensing_coloristouchingcolor: ['colorTouchingColor', ['COLOR', 'COLOR2']],
};

function menuReporterText(block, subgraph, spec) {
  const inputKeys = Object.keys(block.inputs || {});
  if (inputKeys.length !== 1 || !(spec.key in block.inputs)) return null;
  const arr = block.inputs[spec.key];
  const childId = Array.isArray(arr) ? arr[1] : null;
  const child = typeof childId === 'string' ? subgraph[childId] : null;
  if (child && child.shadow) {
    if (child.opcode !== spec.menu) return null;
    const mf = child.fields || {};
    const mk = Object.keys(mf);
    if (Object.keys(child.inputs || {}).length || mk.length !== 1 || mk[0] !== spec.key) return null;
    const val = mf[spec.key];
    if (typeof val[0] !== 'string' || (val.length > 1 && val[1] != null)) return null;
    const value = val[0];
    if (spec.sentinels[value]) return `${spec.sentinels[value]}()`;
    return `${spec.base}(${JSON.stringify(value)})`;
  }
  if (child && !child.shadow) return `${spec.base}(${inputValueText(arr, subgraph, spec.key)})`;
  if (!child && Array.isArray(arr[1])) {
    if (arr[1][0] === 10) return null;
    return `${spec.base}(${inputValueText(arr, subgraph, spec.key)})`;
  }
  return null;
}

function tryReporterInfo(block, subgraph) {
  const op = block?.opcode;
  if (!op || block.mutation) return null;
  const inputKeys = Object.keys(block.inputs || {});
  const fieldKeys = Object.keys(block.fields || {});
  if (NULLARY_REPORTER_EMIT[op] && !inputKeys.length && !fieldKeys.length) {
    return { text: `${NULLARY_REPORTER_EMIT[op]}()`, prec: ATOM_PREC };
  }
  if (FIELD_REPORTER_EMIT[op] && !inputKeys.length && fieldKeys.length === 1) {
    const [fk, map] = FIELD_REPORTER_EMIT[op];
    if (fieldKeys[0] === fk) {
      const name = map[String(block.fields[fk][0])];
      if (name) return { text: `${name}()`, prec: ATOM_PREC };
    }
  }
  if (REPORTER_FUNC_EMIT[op] && !fieldKeys.length) {
    const [name, keys] = REPORTER_FUNC_EMIT[op];
    if (inputKeys.length === keys.length && keys.every((k) => k in block.inputs)) {
      const args = keys.map((k) => inputValueText(block.inputs[k], subgraph, k)).join(', ');
      return { text: `${name}(${args})`, prec: ATOM_PREC };
    }
  }
  if (REPORTER_MENU_EMIT[op] && !fieldKeys.length) {
    const t = menuReporterText(block, subgraph, REPORTER_MENU_EMIT[op]);
    if (t) return { text: t, prec: ATOM_PREC };
  }
  return null;
}

function trySpriteOf(block, subgraph) {
  if (block?.opcode !== 'sensing_of' || block.mutation) return null;
  const fields = block.fields || {};
  const inputs = block.inputs || {};
  if (Object.keys(fields).length !== 1 || !fields.PROPERTY) return null;
  if (Object.keys(inputs).length !== 1 || !Array.isArray(inputs.OBJECT)) return null;
  const menuId = inputs.OBJECT[1];
  const menu = typeof menuId === 'string' ? subgraph[menuId] : null;
  if (!menu || !menu.shadow || menu.opcode !== 'sensing_of_object_menu') return null;
  const mf = menu.fields || {};
  const name = mf.OBJECT?.[0];
  if (typeof name !== 'string' || (mf.OBJECT.length > 1 && mf.OBJECT[1] != null)) return null;
  if (Object.keys(menu.inputs || {}).length) return null;
  const prop = String(fields.PROPERTY[0] ?? '');
  const dot = SPRITE_PROP_EMIT[prop];
  const suffix = dot ? `.${dot}` : `.vars[${JSON.stringify(prop)}]`;
  return { text: `sprites[${JSON.stringify(name)}]${suffix}`, prec: ATOM_PREC };
}

function listFieldName(block) {
  const fields = block.fields || {};
  const keys = Object.keys(fields);
  if (keys.length !== 1 || keys[0] !== 'LIST') return null;
  const v = fields.LIST;
  if (!Array.isArray(v) || typeof v[0] !== 'string') return null;
  const id = v.length > 1 ? v[1] : undefined;
  if (id != null && !(CTX.listMap && CTX.listMap.get(v[0]) === id)) return null;
  return v[0];
}

function listRefText(name) {
  return `lists[${JSON.stringify(name)}]`;
}

function listArgText(name) {
  return bareNameOk(name) ? name : listRefText(name);
}

function effectFieldName(block) {
  const fields = block.fields || {};
  const keys = Object.keys(fields);
  if (keys.length !== 1 || keys[0] !== 'EFFECT') return null;
  const v = fields.EFFECT;
  if (!Array.isArray(v) || typeof v[0] !== 'string') return null;
  if (v[0] !== v[0].replace(/_/g, ' ').toUpperCase()) return null;
  return v[0];
}

function effectNameToken(name) {
  const raw = String(name);
  const normalized = raw.toLowerCase().replace(/\s+/g, '_');
  if (bareNameOk(normalized)) return normalized;
  return JSON.stringify(raw);
}

function tryListExpr(block, subgraph) {
  const op = block?.opcode;
  if (block?.mutation) return null;
  const name = op && op.startsWith('data_') ? listFieldName(block) : null;
  if (name == null) return null;
  const inputKeys = Object.keys(block.inputs || {});
  const one = (k) => inputKeys.length === 1 && inputKeys[0] === k;
  if (op === 'data_itemoflist' && one('INDEX')) {
    return {
      text: `item(${listArgText(name)}, ${inputValueText(block.inputs.INDEX, subgraph, 'INDEX')})`,
      prec: ATOM_PREC,
    };
  }
  if (op === 'data_lengthoflist' && inputKeys.length === 0) {
    return { text: `${listArgText(name)}.length`, prec: ATOM_PREC };
  }
  if (op === 'data_listcontainsitem' && one('ITEM')) {
    return {
      text: `hasItem(${listArgText(name)}, ${inputValueText(block.inputs.ITEM, subgraph, 'ITEM')})`,
      prec: ATOM_PREC,
    };
  }
  if (op === 'data_itemnumoflist' && one('ITEM')) {
    return {
      text: `indexOf(${listArgText(name)}, ${inputValueText(block.inputs.ITEM, subgraph, 'ITEM')})`,
      prec: ATOM_PREC,
    };
  }
  return null;
}

function menuCmdText(block, subgraph, spec) {
  const want = [...spec.lead, spec.key];
  const inputKeys = Object.keys(block.inputs || {});
  if (inputKeys.length !== want.length || !want.every((k) => k in block.inputs)) return null;
  const leadText = spec.lead.map((k) => inputValueText(block.inputs[k], subgraph, k));
  const prefix = (rest) => `${spec.base} ${[...leadText, rest].join(', ')};`;
  const arr = block.inputs[spec.key];
  const childId = Array.isArray(arr) ? arr[1] : null;
  const child = typeof childId === 'string' ? subgraph[childId] : null;
  if (child && child.shadow) {
    if (child.opcode !== spec.menu) return null;
    const mf = child.fields || {};
    const mk = Object.keys(mf);
    if (Object.keys(child.inputs || {}).length || mk.length !== 1 || mk[0] !== spec.key) return null;
    const val = mf[spec.key];
    if (typeof val[0] !== 'string' || (val.length > 1 && val[1] != null)) return null;
    const value = val[0];
    if (spec.sentinels[value]) {
      const name = spec.sentinels[value];
      return leadText.length ? `${name} ${leadText.join(', ')};` : `${name};`;
    }
    return prefix(JSON.stringify(value));
  }
  if (child && !child.shadow) return prefix(inputValueText(arr, subgraph, spec.key));
  if (!child && Array.isArray(arr[1])) {
    if (arr[1][0] === 10) return null;
    return prefix(inputValueText(arr, subgraph, spec.key));
  }
  return null;
}

function tryForLoop(block, subgraph) {
  if (block.mutation) return null;
  const fieldKeys = Object.keys(block.fields || {});
  if (fieldKeys.length !== 1 || fieldKeys[0] !== 'VARIABLE') return null;
  const inputKeys = Object.keys(block.inputs || {});
  if (!inputKeys.includes('VALUE')) return null;
  if (inputKeys.some((k) => k !== 'VALUE' && k !== 'SUBSTACK')) return null;
  const v = block.fields.VARIABLE;
  const name = String(v?.[0] ?? '');
  const id = v.length > 1 ? v[1] : undefined;
  if (!bareNameOk(name)) return null;
  if (id != null && !(CTX.varMap && CTX.varMap.get(name) === id)) return null;
  const count = getInputExpr(block.inputs.VALUE, subgraph);
  return `for ${name} in ${count} ${branch(block, 'SUBSTACK', subgraph)}`;
}

function tryStatementAlias(block, subgraph) {
  const op = String(block.opcode || '');
  if (block.mutation) return null;
  const fields = block.fields || {};
  const inputs = block.inputs || {};
  const fieldKeys = Object.keys(fields);
  const inputKeys = Object.keys(inputs);
  const exactInputs = (...keys) => inputKeys.length === keys.length && keys.every((k) => k in inputs);

  if (SIMPLE_ALIAS_EMIT[op] && !fieldKeys.length && !inputKeys.length) {
    return `${SIMPLE_ALIAS_EMIT[op]};`;
  }
  if (UNARY_ALIAS_EMIT[op]) {
    const [kw, key] = UNARY_ALIAS_EMIT[op];
    if (!fieldKeys.length && exactInputs(key)) {
      return `${kw} ${inputValueText(inputs[key], subgraph, key)};`;
    }
  }
  if (
    (op === 'looks_sayforsecs' || op === 'looks_thinkforsecs') &&
    !fieldKeys.length &&
    exactInputs('MESSAGE', 'SECS')
  ) {
    const kw = op === 'looks_sayforsecs' ? 'say' : 'think';
    return `${kw} ${inputValueText(inputs.MESSAGE, subgraph, 'MESSAGE')} for ${inputValueText(inputs.SECS, subgraph, 'SECS')};`;
  }
  if (op === 'looks_changeeffectby' || op === 'looks_seteffectto') {
    const effect = effectFieldName(block);
    if (effect == null) return null;
    const inputKey = op === 'looks_changeeffectby' ? 'CHANGE' : 'VALUE';
    if (!exactInputs(inputKey)) return null;
    const kw = op === 'looks_changeeffectby' ? 'changeEffect' : 'setEffect';
    const connector = op === 'looks_changeeffectby' ? 'by' : 'to';
    return `${kw} ${effectNameToken(effect)} ${connector} ${inputValueText(inputs[inputKey], subgraph, inputKey)};`;
  }
  if (op === 'sound_changeeffectby' || op === 'sound_seteffectto') {
    const effect = effectFieldName(block);
    if (effect == null || !exactInputs('VALUE')) return null;
    const kw = op === 'sound_changeeffectby' ? 'changeSoundEffect' : 'setSoundEffect';
    const connector = op === 'sound_changeeffectby' ? 'by' : 'to';
    return `${kw} ${effectNameToken(effect)} ${connector} ${inputValueText(inputs.VALUE, subgraph, 'VALUE')};`;
  }
  if (op === 'motion_gotoxy' && !fieldKeys.length && exactInputs('X', 'Y')) {
    return `gotoXY ${inputValueText(inputs.X, subgraph, 'X')}, ${inputValueText(inputs.Y, subgraph, 'Y')};`;
  }
  if (op === 'motion_glidesecstoxy' && !fieldKeys.length && exactInputs('SECS', 'X', 'Y')) {
    return `glideXY ${inputValueText(inputs.SECS, subgraph, 'SECS')}, ${inputValueText(inputs.X, subgraph, 'X')}, ${inputValueText(inputs.Y, subgraph, 'Y')};`;
  }
  if (op === 'motion_pointtowards_xy' && !fieldKeys.length && exactInputs('X', 'Y')) {
    return `pointTowardsXY ${inputValueText(inputs.X, subgraph, 'X')}, ${inputValueText(inputs.Y, subgraph, 'Y')};`;
  }
  if (op === 'motion_pointtowards_xyfrom' && !fieldKeys.length && exactInputs('X', 'Y', 'FROMX', 'FROMY')) {
    return `pointTowardsXYFrom ${inputValueText(inputs.X, subgraph, 'X')}, ${inputValueText(inputs.Y, subgraph, 'Y')}, ${inputValueText(inputs.FROMX, subgraph, 'FROMX')}, ${inputValueText(inputs.FROMY, subgraph, 'FROMY')};`;
  }
  if (op === 'motion_setrotationstyle' && !inputKeys.length && fieldKeys.length === 1 && fieldKeys[0] === 'STYLE') {
    return `setRotationStyle ${JSON.stringify(String(fields.STYLE[0] ?? ''))};`;
  }
  if (op === 'sensing_setdragmode' && !inputKeys.length && fieldKeys.length === 1 && fieldKeys[0] === 'DRAG_MODE') {
    return `setDragMode ${JSON.stringify(String(fields.DRAG_MODE[0] ?? ''))};`;
  }
  if (
    (op === 'data_showvariable' || op === 'data_hidevariable') &&
    !inputKeys.length &&
    fieldKeys.length === 1 &&
    fieldKeys[0] === 'VARIABLE'
  ) {
    const name = String(fields.VARIABLE[0] ?? '');
    const kw = op === 'data_showvariable' ? 'showVariable' : 'hideVariable';
    return `${kw} ${bareNameOk(name) ? name : JSON.stringify(name)};`;
  }
  if (op === 'looks_gotofrontback' && !inputKeys.length && fieldKeys.length === 1 && fieldKeys[0] === 'FRONT_BACK') {
    const v = fields.FRONT_BACK[0];
    if (v === 'front') return 'goFront;';
    if (v === 'back') return 'goBack;';
  }
  if (
    op === 'looks_goforwardbackwardlayers' &&
    exactInputs('NUM') &&
    fieldKeys.length === 1 &&
    fieldKeys[0] === 'FORWARD_BACKWARD'
  ) {
    const v = fields.FORWARD_BACKWARD[0];
    if (v === 'forward') return `goForward ${inputValueText(inputs.NUM, subgraph, 'NUM')};`;
    if (v === 'backward') return `goBackward ${inputValueText(inputs.NUM, subgraph, 'NUM')};`;
  }
  if (MENU_CMD_EMIT[op] && !fieldKeys.length) {
    return menuCmdText(block, subgraph, MENU_CMD_EMIT[op]);
  }
  if (LIST_STMT_EMIT[op]) {
    const name = listFieldName(block);
    if (name == null) return null;
    const [fn, keys] = LIST_STMT_EMIT[op];
    if (!exactInputs(...keys)) return null;
    const args = keys.map((k) => inputValueText(inputs[k], subgraph, k));
    return `${fn}(${[listArgText(name), ...args].join(', ')});`;
  }
  return null;
}

function shadowBlockText(block, subgraph, id, inputName) {
  const op = String(block.opcode || '');
  if (op === 'argument_reporter_string_number' || op === 'argument_reporter_boolean') {
    return stringifyBlockCall(block, subgraph, id, true);
  }
  const fields = block.fields || {};
  const keys = Object.keys(fields);
  const hasInputs = Object.keys(block.inputs || {}).length > 0;
  if (!hasInputs && keys.length === 1 && keys[0] === inputName && !block.mutation) {
    const v = fields[keys[0]];
    if (Array.isArray(v) && typeof v[0] === 'string' && (v.length === 1 || v[1] == null)) {
      const opName = formatOpcodeName(op);
      if (opName) return `${opName}(${JSON.stringify(v[0])})`;
    }
  }
  return `shadow ${stringifyBlockCall(block, subgraph, id, true)}`;
}

export function inputValueText(arr, subgraph, inputName) {
  if (!Array.isArray(arr) || arr.length < 2) return 'null';
  const childId = arr[1];
  const child = typeof childId === 'string' ? subgraph[childId] : null;
  if (child && child.shadow) {
    return shadowBlockText(child, subgraph, childId, inputName);
  }

  return getInputExpr(arr, subgraph);
}

function inputSeparator(name, text) {
  if (!LEGACY_FIELD_KEYS.has(name)) return ': ';
  if (text.startsWith('[') || text.startsWith('{')) return '= ';
  if (name === 'VARIABLE' && text.startsWith('var(')) return '= ';
  if (name === 'LIST' && text.startsWith('list(')) return '= ';
  if (name === 'BROADCAST_OPTION' && text.startsWith('broadcast(')) return '= ';
  return ': ';
}

export function stringifyInputs(block, subgraph) {
  if (!block.inputs) return '';
  const args = [];
  for (const [name, val] of Object.entries(block.inputs)) {
    if (name.startsWith('SUBSTACK')) continue;

    const arr = val;
    if (!Array.isArray(arr) || arr.length < 2) {
      args.push(`${formatArgKey(name)}: null`);
      continue;
    }
    const text = inputValueText(arr, subgraph, name);
    args.push(`${formatArgKey(name)}${inputSeparator(name, text)}${text}`);
  }
  return args.join(', ');
}

function refCall(kind, name, id, map) {
  const needsId = id != null && !(map && map.get(name) === id);
  return needsId ? `${kind}(${JSON.stringify(name)}, ${JSON.stringify(id)})` : `${kind}(${JSON.stringify(name)})`;
}

export function stringifyFields(block) {
  if (!block.fields) return '';
  const entries = Object.entries(block.fields).filter(([k]) => k !== 'PLUS' && k !== 'MINUS');
  const kv = entries.map(([k, v]) => {
    try {
      const keyLc = String(k).toLowerCase();

      if (Array.isArray(v) && v.length >= 1 && typeof v[0] === 'string') {
        const name = v[0];
        const id = v.length > 1 ? v[1] : undefined;
        if (keyLc.includes('variable')) {
          const prefix = k === 'VARIABLE' ? '' : 'field ';
          return `${prefix}${formatArgKey(k)}: ${refCall('var', name, id, CTX.varMap)}`;
        }
        if (keyLc.includes('list') || keyLc === 'list') {
          const prefix = k === 'LIST' ? '' : 'field ';
          return `${prefix}${formatArgKey(k)}: ${refCall('list', name, id, CTX.listMap)}`;
        }
        if (keyLc.includes('broadcast')) {
          const prefix = k === 'BROADCAST_OPTION' ? '' : 'field ';
          return `${prefix}${formatArgKey(k)}: ${refCall('broadcast', name, id, CTX.broadcastNameToId)}`;
        }
        if (v.length <= 2 && (v.length === 1 || v[1] == null)) {
          return `field ${formatArgKey(k)}: ${JSON.stringify(name)}`;
        }
      }
      return `field ${formatArgKey(k)}: ${JSON.stringify(v)}`;
    } catch {
      return `field ${formatArgKey(k)}: ${JSON.stringify(String(v))}`;
    }
  });
  return kv.join(', ');
}

function linearizeWithIds(subgraph, topId) {
  const arr = [];
  let cursor = topId;
  while (cursor) {
    const node = subgraph[cursor];
    if (!node) return { ids: arr, danglingId: cursor };
    arr.push(cursor);
    cursor = node.next;
  }
  return { ids: arr, danglingId: null };
}

export function renderBody(subgraph, topId, cfg) {
  const { ids, danglingId } = linearizeWithIds(subgraph, topId);
  const lines = ids.map((cid) =>
    withAttachedComments(stringifyBlockCall(subgraph[cid], subgraph, cid, false, cfg), CTX.blockComments?.get(cid))
  );
  if (danglingId) lines.push(`dangling_next(${JSON.stringify(danglingId)});`);
  return lines.join('\n');
}

export function isSimpleAttachedComment(c) {
  const text = String(c.text ?? '');
  return (
    (c.x ?? 0) === 0 &&
    (c.y ?? 0) === 0 &&
    (c.width ?? 200) === 200 &&
    (c.height ?? 200) === 200 &&
    !c.minimized &&
    !c.forId &&
    !text.includes('\n') &&
    text === text.trim()
  );
}

export function lineCommentText(c) {
  const text = String(c.text ?? '');
  return text ? `// ${text}` : '//';
}

export function withAttachedComments(line, attached) {
  if (!attached?.length) return line;
  const before = [];
  const after = [];
  for (const c of attached) (isSimpleAttachedComment(c) ? before : after).push(c);
  let out = '';
  if (before.length) out += before.map(lineCommentText).join('\n') + '\n';
  out += line;
  if (after.length) out += '\n' + after.map(commentDeclLine).join('\n');
  return out;
}

export function commentDeclLine(c) {
  const parts = [`comment ${JSON.stringify(String(c.text ?? ''))}`];
  if ((c.x ?? 0) !== 0 || (c.y ?? 0) !== 0) parts.push(`at ${numToken(c.x)},${numToken(c.y)}`);
  parts.push(`size ${numToken(c.width ?? 200)}x${numToken(c.height ?? 200)}`);
  if (c.minimized) parts.push('minimized');
  if (c.forId) parts.push(`for ${JSON.stringify(String(c.forId))}`);
  return parts.join(' ') + ';';
}

function numToken(n) {
  const v = Number(n);
  return Number.isFinite(v) ? String(v) : '0';
}

function tryJsonLiteralText(raw) {
  if (raw.length < 2) return null;
  const first = raw[0];
  if ((first !== '[' && first !== '{') || raw.includes('\\b') || raw.includes('\\f') || raw.includes('\\u'))
    return null;
  let v;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null) return null;
  if (JSON.stringify(v) !== raw) return null;
  const isRawTupleShape =
    Array.isArray(v) &&
    (v.length === 2 || v.length === 3) &&
    Number.isInteger(v[0]) &&
    v[0] >= 4 &&
    v[0] <= 13 &&
    typeof v[1] === 'string';
  if (isRawTupleShape) return null;
  return raw;
}

export function stringToken(raw) {
  const s = String(raw);
  if (s.includes('\n') && !s.includes('"""') && !s.includes('\r') && !s.startsWith('"') && !s.endsWith('"')) {
    return `"""${s}"""`;
  }
  return JSON.stringify(s);
}

function indent(str, spaces = 2) {
  if (!str) return '';
  const pad = ' '.repeat(spaces);
  let inRaw = false;
  return str
    .split('\n')
    .map((l) => {
      const out = l && !inRaw ? pad + l : l;
      if ((l.match(/"""/g) || []).length % 2) inRaw = !inRaw;
      return out;
    })
    .join('\n');
}

function branch(block, key, subgraph) {
  const arr = block.inputs?.[key];
  const bid = Array.isArray(arr) ? arr[1] : null;
  const body = bid ? renderBody(subgraph, bid) : '';
  return `{\n${indent(body)}\n}`;
}

function formatArgKey(name) {
  try {
    const s = String(name);
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) return s;
    return `[${JSON.stringify(s)}]`;
  } catch {
    return `[${JSON.stringify(String(name))}]`;
  }
}

function formatOpcodeName(opcode) {
  const s = String(opcode || '');
  const m = /^([A-Za-z][A-Za-z0-9]*)_(.+)$/.exec(s);
  if (m && /^[A-Za-z_][A-Za-z0-9_]*$/.test(m[2])) return `${m[1]}.${m[2]}`;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) return null;
  return s;
}

function formatLiteral(arr) {
  try {
    if (!Array.isArray(arr) || arr.length < 2) return `null`;
    const payload = arr[1];

    if (Array.isArray(payload) && payload.length >= 1) {
      const typeCode = payload[0];
      const value = payload[1];
      switch (typeCode) {
        case 10: {
          const raw = String(value ?? '');
          if (raw !== '' && REPARSABLE_NUMBER.test(raw)) return raw;
          const arrText = tryJsonLiteralText(raw);
          if (arrText) return arrText;
          return stringToken(raw);
        }
        case 4:
        case 5:
        case 6:
        case 7:
        case 8: {
          const raw = value == null ? '' : String(value);
          if (raw === '') return '""';
          if (REPARSABLE_NUMBER.test(raw)) return raw;

          return `${JSON.stringify(raw)}`;
        }
        case 11: {
          const name = String(value ?? '');
          const id = payload.length > 2 ? String(payload[2]) : undefined;
          return refCall('broadcast', name, id, CTX.broadcastNameToId);
        }
        case 12: {
          const name = String(value ?? '');
          const local = localBareName(name);
          if (local) return local;
          const id = payload.length > 2 && payload[2] != null ? String(payload[2]) : undefined;
          if (id != null && !(CTX.varMap && CTX.varMap.get(name) === id)) {
            return refCall('var', name, id, CTX.varMap);
          }
          const shadowedByParam =
            CTX.scopeParamNames && (CTX.scopeParamNames.has(name) || [...CTX.scopeParamNames.values()].includes(name));
          if (!shadowedByParam && bareNameOk(name)) return name;
          return `vars[${JSON.stringify(name)}]`;
        }
        case 13: {
          const name = String(value ?? '');
          const id = payload.length > 2 ? String(payload[2]) : undefined;
          if (id == null || (CTX.listMap && CTX.listMap.get(name) === id)) return listRefText(name);
          return refCall('list', name, id, CTX.listMap);
        }
        default: {
          const compact = value != null ? JSON.stringify(value) : 'null';
          return `${compact}`;
        }
      }
    }

    if (typeof payload === 'string') {
      const n = Number(payload);
      if (Number.isFinite(n)) return `${String(n)}`;
      return `${JSON.stringify(payload)}`;
    }
    if (typeof payload === 'number' || typeof payload === 'boolean') {
      return `${String(payload)}`;
    }
  } catch {
    return `null`;
  }
  return `null`;
}

const NEGATED_CMP = { operator_equals: '!=', operator_gt: '<=', operator_lt: '>=' };

function tryOperatorInfo(block, subgraph) {
  const op = block?.opcode;
  if (typeof op !== 'string' || !op.startsWith('operator_')) return null;
  const input = (k, alt) => block.inputs?.[k] ?? (alt ? block.inputs?.[alt] : undefined) ?? [3, [10, '']];
  const bin = (sym, k1, k2, a1, a2) =>
    binaryInfo(sym, getInputExprInfo(input(k1, a1), subgraph), getInputExprInfo(input(k2, a2), subgraph));
  switch (op) {
    case 'operator_add':
      return Object.keys(block.inputs || {}).length === 2 ? bin('+', 'NUM1', 'NUM2') : null;
    case 'operator_subtract':
      return Object.keys(block.inputs || {}).length === 2 ? bin('-', 'NUM1', 'NUM2') : null;
    case 'operator_multiply':
      return Object.keys(block.inputs || {}).length === 2 ? bin('*', 'NUM1', 'NUM2') : null;
    case 'operator_divide':
      return Object.keys(block.inputs || {}).length === 2 ? bin('/', 'NUM1', 'NUM2') : null;
    case 'operator_min':
    case 'operator_max': {
      const values = Object.keys(block.inputs || {})
        .filter((key) => /^NUM\d+$/.test(key))
        .sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)))
        .map((key) => getInputExpr(block.inputs[key], subgraph));
      return { text: `${op.slice(9)}(${values.join(', ')})`, prec: ATOM_PREC };
    }
    case 'operator_clamp':
      return {
        text: `clamp(${getInputExpr(input('NUM'), subgraph)}, ${getInputExpr(input('MIN'), subgraph)}, ${getInputExpr(input('MAX'), subgraph)})`,
        prec: ATOM_PREC,
      };
    case 'operator_mod':
      return bin('%', 'NUM1', 'NUM2');
    case 'operator_round':
      return { text: `round(${getInputExpr(input('NUM'), subgraph)})`, prec: ATOM_PREC };
    case 'operator_mathop': {
      const raw = (block.fields?.OPERATOR?.[0] || 'abs').toLowerCase();
      const fn = raw === 'e ^' ? 'exp' : raw === '10 ^' ? 'exp10' : raw;
      return { text: `${fn}(${getInputExpr(input('NUM'), subgraph)})`, prec: ATOM_PREC };
    }
    case 'operator_length':
      return { text: `length(${getInputExpr(input('STRING'), subgraph)})`, prec: ATOM_PREC };
    case 'operator_letter_of': {
      const recv = getInputExprInfo(input('STRING'), subgraph);
      const recvText = recv.prec === ATOM_PREC ? recv.text : `(${recv.text})`;
      return { text: `${recvText}.letter(${getInputExpr(input('LETTER'), subgraph)})`, prec: ATOM_PREC };
    }
    case 'operator_random':
      return {
        text: `random(${getInputExpr(input('FROM'), subgraph)}, ${getInputExpr(input('TO'), subgraph)})`,
        prec: ATOM_PREC,
      };
    case 'operator_contains':
      return {
        text: `contains(${getInputExpr(input('STRING1'), subgraph)}, ${getInputExpr(input('STRING2'), subgraph)})`,
        prec: ATOM_PREC,
      };
    case 'operator_join':
      return bin('++', 'STRING1', 'STRING2');
    case 'operator_equals': {
      const bool = booleanLiteralInfo(block);
      if (bool) return bool;
      return bin('==', 'OPERAND1', 'OPERAND2', 'NUM1', 'NUM2');
    }
    case 'operator_lt':
      return bin('<', 'OPERAND1', 'OPERAND2', 'NUM1', 'NUM2');
    case 'operator_gt':
      return bin('>', 'OPERAND1', 'OPERAND2', 'NUM1', 'NUM2');
    case 'operator_and':
      return bin('&&', 'OPERAND1', 'OPERAND2');
    case 'operator_or':
      return bin('||', 'OPERAND1', 'OPERAND2');
    case 'operator_not':
      return notInfo(block, subgraph);
    default:
      return null;
  }
}

function booleanLiteralInfo(block) {
  const left = literalInputText(block.inputs?.OPERAND1 ?? block.inputs?.NUM1);
  const right = literalInputText(block.inputs?.OPERAND2 ?? block.inputs?.NUM2);
  if (left === '0' && right === '0') return { text: 'true', prec: ATOM_PREC };
  if (left === '0' && right === '1') return { text: 'false', prec: ATOM_PREC };
  return null;
}

function literalInputText(tuple) {
  if (!Array.isArray(tuple) || tuple.length < 2) return null;
  const payload = tuple[1];
  if (!Array.isArray(payload)) return null;
  if (payload[0] === 4 || payload[0] === 6 || payload[0] === 7 || payload[0] === 10) {
    return String(payload[1] ?? '');
  }
  return null;
}

function binaryInfo(sym, L, R) {
  const p = PREC[sym];
  const lt = L.prec < p ? `(${L.text})` : L.text;
  const rt = R.prec <= p ? `(${R.text})` : R.text;
  return { text: `${lt} ${sym} ${rt}`, prec: p };
}

function notInfo(block, subgraph) {
  const tuple = block.inputs?.OPERAND;
  if (isEmptyBooleanInput(tuple)) return { text: 'not(null)', prec: ATOM_PREC };
  const childId = Array.isArray(tuple) ? tuple[1] : null;
  const child = typeof childId === 'string' ? subgraph[childId] : null;
  if (child && NEGATED_CMP[child.opcode]) {
    const input = (k, alt) => child.inputs?.[k] ?? child.inputs?.[alt] ?? [3, [10, '']];
    return binaryInfo(
      NEGATED_CMP[child.opcode],
      getInputExprInfo(input('OPERAND1', 'NUM1'), subgraph),
      getInputExprInfo(input('OPERAND2', 'NUM2'), subgraph)
    );
  }
  const inner = Array.isArray(tuple) ? getInputExprInfo(tuple, subgraph) : { text: '""', prec: ATOM_PREC };
  const it = inner.prec < UNARY_PREC ? `(${inner.text})` : inner.text;
  return { text: `!${it}`, prec: UNARY_PREC };
}

function isEmptyBooleanInput(tuple) {
  if (!Array.isArray(tuple)) return true;
  const payload = tuple[1];
  return Array.isArray(payload) && payload[0] === 10 && String(payload[1] ?? '') === '';
}
