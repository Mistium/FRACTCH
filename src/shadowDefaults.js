// Default shadows for core block inputs, as the editor's palette creates them. A shadow hidden under a reporter
// is only written to the text (`(reporter ?? value)`) when it differs from the default here, and packing
// rebuilds the default when the text has no `??`. Menus without a fixed default (costumes, sounds, broadcasts)
// have `value: null`: their hidden shadow is always written.

const num = (value) => ({ code: 4, value });
const positive = (value) => ({ code: 5, value });
const whole = (value) => ({ code: 6, value });
const integer = (value) => ({ code: 7, value });
const angle = (value) => ({ code: 8, value });
const colour = () => ({ code: 9, value: null });
const text = (value) => ({ code: 10, value });
const menu = (opcode, field, value = null) => ({ menu: opcode, field, value });

const XY = { X: num('0'), Y: num('0') };

export const SHADOW_DEFAULTS = {
  motion_movesteps: { STEPS: num('10') },
  motion_turnright: { DEGREES: num('15') },
  motion_turnleft: { DEGREES: num('15') },
  motion_goto: { TO: menu('motion_goto_menu', 'TO', '_random_') },
  motion_gotoxy: XY,
  motion_glideto: { SECS: num('1'), TO: menu('motion_glideto_menu', 'TO', '_random_') },
  motion_glidesecstoxy: { SECS: num('1'), ...XY },
  motion_pointindirection: { DIRECTION: angle('90') },
  motion_pointtowards: { TOWARDS: menu('motion_pointtowards_menu', 'TOWARDS', '_mouse_') },
  motion_pointtowards_xy: XY,
  motion_pointtowards_xyfrom: { ...XY, FROMX: num('0'), FROMY: num('0') },
  motion_changexby: { DX: num('10') },
  motion_setx: { X: num('0') },
  motion_changeyby: { DY: num('10') },
  motion_sety: { Y: num('0') },
  looks_sayforsecs: { MESSAGE: text('Hello!'), SECS: num('2') },
  looks_say: { MESSAGE: text('Hello!') },
  looks_thinkforsecs: { MESSAGE: text('Hmm...'), SECS: num('2') },
  looks_think: { MESSAGE: text('Hmm...') },
  looks_switchcostumeto: { COSTUME: menu('looks_costume', 'COSTUME') },
  looks_switchbackdropto: { BACKDROP: menu('looks_backdrops', 'BACKDROP') },
  looks_switchbackdroptoandwait: { BACKDROP: menu('looks_backdrops', 'BACKDROP') },
  looks_changesizeby: { CHANGE: num('10') },
  looks_setsizeto: { SIZE: num('100') },
  looks_changeeffectby: { CHANGE: num('25') },
  looks_seteffectto: { VALUE: num('0') },
  looks_goforwardbackwardlayers: { NUM: integer('1') },
  sound_playuntildone: { SOUND_MENU: menu('sound_sounds_menu', 'SOUND_MENU') },
  sound_play: { SOUND_MENU: menu('sound_sounds_menu', 'SOUND_MENU') },
  sound_changeeffectby: { VALUE: num('10') },
  sound_seteffectto: { VALUE: num('100') },
  sound_changevolumeby: { VOLUME: num('-10') },
  sound_setvolumeto: { VOLUME: num('100') },
  event_whengreaterthan: { VALUE: num('10') },
  event_broadcast: { BROADCAST_INPUT: { code: 11, value: null } },
  event_broadcastandwait: { BROADCAST_INPUT: { code: 11, value: null } },
  control_wait: { DURATION: positive('1') },
  control_repeat: { TIMES: whole('10') },
  control_for_each: { VALUE: whole('10') },
  control_switch: { VALUE: text('value') },
  control_case: { VALUE: text('case') },
  control_case_fallthrough: { VALUE: text('case') },
  control_create_clone_of: { CLONE_OPTION: menu('control_create_clone_of_menu', 'CLONE_OPTION', '_myself_') },
  sensing_touchingobject: {
    TOUCHINGOBJECTMENU: menu('sensing_touchingobjectmenu', 'TOUCHINGOBJECTMENU', '_mouse_'),
  },
  sensing_touchingcolor: { COLOR: colour() },
  sensing_coloristouchingcolor: { COLOR: colour(), COLOR2: colour() },
  sensing_distanceto: { DISTANCETOMENU: menu('sensing_distancetomenu', 'DISTANCETOMENU', '_mouse_') },
  sensing_askandwait: { QUESTION: text("What's your name?") },
  sensing_keypressed: { KEY_OPTION: menu('sensing_keyoptions', 'KEY_OPTION', 'space') },
  sensing_of: { OBJECT: menu('sensing_of_object_menu', 'OBJECT', '_stage_') },
  operator_add: { NUM1: num(''), NUM2: num('') },
  operator_subtract: { NUM1: num(''), NUM2: num('') },
  operator_multiply: { NUM1: num(''), NUM2: num('') },
  operator_divide: { NUM1: num(''), NUM2: num('') },
  operator_mod: { NUM1: num(''), NUM2: num('') },
  operator_min: { NUM1: num(''), NUM2: num('') },
  operator_max: { NUM1: num(''), NUM2: num('') },
  operator_clamp: { NUM: num('50'), MIN: num('0'), MAX: num('100') },
  operator_random: { FROM: num('1'), TO: num('10') },
  operator_gt: { OPERAND1: text(''), OPERAND2: text('50') },
  operator_lt: { OPERAND1: text(''), OPERAND2: text('50') },
  operator_equals: { OPERAND1: text(''), OPERAND2: text('50') },
  operator_round: { NUM: num('') },
  operator_mathop: { NUM: num('') },
  operator_join: { STRING1: text('apple'), STRING2: text('banana') },
  operator_letter_of: { LETTER: whole('1'), STRING: text('apple') },
  operator_length: { STRING: text('apple') },
  operator_contains: { STRING1: text('apple'), STRING2: text('a') },
  operator_letters_of: { LETTER1: whole('2'), LETTER2: whole('4'), STRING: text('apple') },
  operator_index_of: { SUBSTRING: text('p'), STRING: text('apple') },
  operator_replace: { SUBSTRING: text('world'), STRING: text('Hello world!'), REPLACE: text('fellow Scratchers') },
  operator_repeat: { STRING: text('apple'), REPEAT: whole('3') },
  operator_change_case: { STRING: text('apple') },
  operator_trim: { STRING: text('apple') },
  data_setvariableto: { VALUE: text('0') },
  data_changevariableby: { VALUE: num('1') },
  data_addtolist: { ITEM: text('thing') },
  data_deleteoflist: { INDEX: integer('1') },
  data_insertatlist: { INDEX: integer('1'), ITEM: text('thing') },
  data_replaceitemoflist: { INDEX: integer('1'), ITEM: text('thing') },
  data_itemoflist: { INDEX: integer('1') },
  data_itemnumoflist: { ITEM: text('thing') },
  data_listcontainsitem: { ITEM: text('thing') },
  procedures_return: { VALUE: text('') },
  assets_load: { ASSET: menu('assets_menu', 'ASSET') },
  assets_unload: { ASSET: menu('assets_menu', 'ASSET') },
  assets_check: { ASSET: menu('assets_menu', 'ASSET') },
  assets_get: { ASSET: menu('assets_menu', 'ASSET') },
  assets_byte: { INDEX: num('1'), ASSET: menu('assets_menu', 'ASSET') },
  assets_set: { ASSET: menu('assets_menu', 'ASSET'), VALUE: text('hello') },
  assets_delete: { ASSET: menu('assets_menu', 'ASSET') },
  assets_infolder: { FOLDER: text('') },
  pen_setPenColorToColor: { COLOR: colour() },
  pen_changePenColorParamBy: { COLOR_PARAM: menu('pen_menu_colorParam', 'colorParam', 'color'), VALUE: num('10') },
  pen_setPenColorParamTo: { COLOR_PARAM: menu('pen_menu_colorParam', 'colorParam', 'color'), VALUE: num('50') },
  pen_changePenSizeBy: { SIZE: num('1') },
  pen_setPenSizeTo: { SIZE: num('1') },
};

function procArgKinds(proccode) {
  return [...String(proccode ?? '').matchAll(/%([snb])/g)].map((m) => m[1]);
}

// The spec for one input: a primitive `{ code, value }`, a menu `{ menu, field, value }`, or null when the
// input has no known default. `value: null` means the default isn't fixed.
export function shadowSpec(opcode, input, mutation) {
  if (opcode === 'procedures_call') {
    let ids = null;
    try {
      ids = JSON.parse(mutation?.argumentids ?? 'null');
    } catch {
      ids = null;
    }
    const at = Array.isArray(ids) ? ids.indexOf(input) : -1;
    if (at < 0) return null;
    return procArgKinds(mutation?.proccode)[at] === 'b' ? null : text('');
  }
  return SHADOW_DEFAULTS[opcode]?.[input] ?? null;
}

function hasFixedValue(spec) {
  return !!spec && spec.value != null;
}

// The hidden shadow packing builds when the text has no `??`: the fixed default, else an empty text shadow
// under a variable (the long-standing form), else none.
export function impliedShadow(spec, activeIsVariable) {
  if (hasFixedValue(spec)) return spec;
  if (activeIsVariable) return text('');
  return null;
}

function shadowValue(shadow, blocks) {
  if (shadow == null) return { kind: 'none' };
  if (Array.isArray(shadow)) {
    if (shadow[0] >= 4 && shadow[0] <= 11) return { kind: 'literal', value: String(shadow[1] ?? ''), shadow };
    return { kind: 'other' };
  }
  const block = typeof shadow === 'string' ? blocks[shadow] : null;
  if (!block || Array.isArray(block) || !block.shadow) return { kind: 'missing' };
  const fields = Object.entries(block.fields || {});
  if (Object.keys(block.inputs || {}).length || block.mutation || fields.length !== 1) return { kind: 'block', block };
  const [field, v] = fields[0];
  if (!Array.isArray(v) || typeof v[0] !== 'string' || (v.length > 1 && v[1] != null)) return { kind: 'block', block };
  return { kind: 'menu', opcode: block.opcode, field, value: v[0], block };
}

function matches(found, spec) {
  if (!spec) return found.kind === 'none';
  if (spec.menu) return found.kind === 'menu' && found.opcode === spec.menu && found.value === spec.value;
  return found.kind === 'literal' && found.value === String(spec.value ?? '');
}

function isEmpty(found) {
  return found.kind === 'none' || ((found.kind === 'literal' || found.kind === 'menu') && found.value === '');
}

// Describes the hidden shadow of an input whose visible value is a reporter or variable, when the text has to
// spell it out. Returns null when packing would rebuild it anyway (the default, or an empty shadow where a
// default exists), or when the text can't express it. Otherwise returns `{ primitive }` for a compressed
// value, `{ menuValue }` for the input's usual menu, or `{ block, id }` for any other shadow block.
export function hiddenShadowToWrite(parent, input, tuple, blocks) {
  if (!Array.isArray(tuple) || (tuple[0] !== 2 && tuple[0] !== 3)) return null;
  const active = tuple[1];
  const activeIsVariable = Array.isArray(active) && (active[0] === 12 || active[0] === 13);
  const activeBlock = typeof active === 'string' ? blocks[active] : null;
  if (!activeIsVariable && !(activeBlock && !Array.isArray(activeBlock) && !activeBlock.shadow)) return null;
  const spec = shadowSpec(parent.opcode, input, parent.mutation);
  const found = shadowValue(tuple[0] === 3 ? tuple[2] : null, blocks);
  if (found.kind === 'missing' || found.kind === 'other') return null;
  if (matches(found, impliedShadow(spec, activeIsVariable))) return null;
  if (isEmpty(found) && (hasFixedValue(spec) || found.kind === 'none')) return null;
  if (found.kind === 'literal') return { primitive: found.shadow };
  if (found.kind === 'menu' && spec?.menu === found.opcode && spec.field === found.field) {
    return { menuValue: found.value };
  }
  return { block: found.block, id: tuple[2] };
}

// True when two results of hiddenShadowToWrite would be written as the same text.
export function sameHiddenShadow(a, b) {
  if (!a || !b) return !a && !b;
  if (a.primitive || b.primitive) {
    return !!a.primitive && !!b.primitive && String(a.primitive[1] ?? '') === String(b.primitive[1] ?? '');
  }
  if (a.menuValue != null || b.menuValue != null) return a.menuValue === b.menuValue;
  const shape = (x) => JSON.stringify([x.block.opcode, x.block.fields || {}, x.block.mutation || null]);
  return (
    shape(a) === shape(b) && !Object.keys(a.block.inputs || {}).length && !Object.keys(b.block.inputs || {}).length
  );
}
