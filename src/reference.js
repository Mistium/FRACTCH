import { ALIAS_TABLES, snakeToCamel } from './parse.js';

const KEYWORD_STATEMENTS = [
  ['if', 'control_if / control_if_else', 'if c { } else { }'],
  ['forever', 'control_forever', 'forever { }'],
  ['every', 'control_forever + control_wait', 'every n seconds { }'],
  ['repeat', 'control_repeat', 'repeat n { }'],
  ['until', 'control_repeat_until', 'until c { }'],
  ['while', 'control_while', 'while c { }'],
  ['for', 'control_for_each', 'for i in n { }'],
  ['switch', 'control_switch', 'switch v { case x { } default { } }'],
  ['wait', 'control_wait', 'wait n;'],
  ['waitUntil', 'control_wait_until', 'waitUntil c;'],
  ['stop', 'control_stop', 'stop all;'],
  ['return', 'control_stop / procedures_return', 'return v;'],
  ['broadcast', 'event_broadcast', 'broadcast Name;'],
  ['broadcastWait', 'event_broadcastandwait', 'broadcastWait Name;'],
  ['say', 'looks_say / looks_sayforsecs', 'say e for n;'],
  ['think', 'looks_think / looks_thinkforsecs', 'think e for n;'],
  ['goto', 'motion_goto / motion_gotoxy', 'goto x, y;'],
  ['gotoXY', 'motion_gotoxy', 'gotoXY x, y;'],
  ['glideXY', 'motion_glidesecstoxy', 'glideXY secs, x, y;'],
  ['glide', 'motion_glideto / motion_glidesecstoxy', 'glide secs to target;'],
  ['setEffect', 'looks_seteffectto', 'setEffect ghost to 50;'],
  ['changeEffect', 'looks_changeeffectby', 'changeEffect ghost by 5;'],
  ['setSoundEffect', 'sound_seteffectto', 'setSoundEffect pitch to 10;'],
  ['changeSoundEffect', 'sound_changeeffectby', 'changeSoundEffect pitch by 10;'],
  ['setRotationStyle', 'motion_setrotationstyle', 'setRotationStyle "left-right";'],
  ['setDragMode', 'sensing_setdragmode', 'setDragMode "draggable";'],
  ['showVariable', 'data_showvariable', 'showVariable score;'],
  ['hideVariable', 'data_hidevariable', 'hideVariable score;'],
  ['local', 'script-local variable', 'local x = 1;'],
  ['region', 'membership region', 'region "name" { ... }'],
];

export function languageReference() {
  const out = [];
  const add = (name, kind, opcode, args, parseNames = []) =>
    out.push({ name, kind, opcode, args, parseNames: parseNames.filter((n) => n !== name) });
  for (const [name, opcode] of Object.entries(ALIAS_TABLES.SIMPLE_ALIASES)) {
    add(snakeToCamel(name), 'statement', opcode, [], [name]);
  }
  for (const [name, [opcode, key]] of Object.entries(ALIAS_TABLES.UNARY_ALIASES)) {
    add(snakeToCamel(name), 'statement', opcode, [key], [name]);
  }
  for (const [name, [opcode]] of Object.entries(ALIAS_TABLES.FIELD_ALIASES)) {
    add(snakeToCamel(name), 'statement', opcode, [], [name]);
  }
  for (const [name, [opcode, key]] of Object.entries(ALIAS_TABLES.UNARY_FIELD_ALIASES)) {
    add(snakeToCamel(name), 'statement', opcode, [key], [name]);
  }
  for (const [name, [opcode, key]] of Object.entries(ALIAS_TABLES.MENU_ALIASES)) {
    add(snakeToCamel(name), 'statement', opcode, [key], [name]);
  }
  for (const [name, [opcode, keys]] of Object.entries(ALIAS_TABLES.LIST_CMD_FN)) {
    add(name, 'statement', opcode, ['list', ...keys]);
  }
  for (const [name, [opcode, keys]] of Object.entries(ALIAS_TABLES.LIST_RPT_FN)) {
    add(name, 'reporter', opcode, ['list', ...keys]);
  }
  for (const [name, [opcode, keys]] of Object.entries(ALIAS_TABLES.FUNC_SUGAR)) add(name, 'reporter', opcode, keys);
  for (const name of ALIAS_TABLES.UNARY_SUGAR) add(name, 'reporter', 'operator_mathop', ['NUM']);
  for (const [name, opcode] of Object.entries(ALIAS_TABLES.REPORTER_NULLARY)) add(name, 'reporter', opcode, []);
  for (const [name, [opcode]] of Object.entries(ALIAS_TABLES.REPORTER_FIELD)) add(name, 'reporter', opcode, []);
  for (const [name, [opcode, key]] of Object.entries(ALIAS_TABLES.REPORTER_MENU_SUGAR)) {
    add(name, 'reporter', opcode, [key]);
  }
  for (const [name, [opcode, keys]] of Object.entries(ALIAS_TABLES.REPORTER_FUNC_SUGAR))
    add(name, 'reporter', opcode, keys);
  for (const [name, prop] of Object.entries(ALIAS_TABLES.SPRITE_PROPS)) {
    add(`.${snakeToCamel(name)}`, 'property', 'sensing_of', [prop], [`.${name}`]);
  }
  for (const [name, opcode, example] of KEYWORD_STATEMENTS)
    out.push({ name, kind: 'keyword', opcode, args: [], example, parseNames: [] });
  return out;
}

export function referenceWithDocs(syntaxMarkdown) {
  const lines = String(syntaxMarkdown || '').split('\n');
  return languageReference().map((entry) => {
    const bare = entry.name.replace(/^\./, '');
    const re = new RegExp(`(^|[^A-Za-z0-9_])${bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9_]|$)`);
    const doc = lines.find((l) => re.test(l));
    return { ...entry, doc: doc ? doc.trim() : null };
  });
}
