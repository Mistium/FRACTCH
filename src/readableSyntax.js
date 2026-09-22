// Opcode mappings shared by the parser and the source generator. Keep these
// limited to blocks whose complete shape is described by the readable form.
export const PROPERTY_REPORTERS = {
  'self.x': 'motion_xposition',
  'self.y': 'motion_yposition',
  'self.direction': 'motion_direction',
  'self.size': 'looks_size',
  'self.costume': 'looks_costumenumbername',
  'stage.backdrop': 'looks_backdropnumbername',
  'sound.volume': 'sound_volume',
  'mouse.x': 'sensing_mousex',
  'mouse.y': 'sensing_mousey',
  'mouse.down': 'sensing_mousedown',
  'timer.value': 'sensing_timer',
};

export const INPUT_PROPERTIES = {
  'self.x': { '=': ['motion_setx', 'X'], '+=': ['motion_changexby', 'DX'] },
  'self.y': { '=': ['motion_sety', 'Y'], '+=': ['motion_changeyby', 'DY'] },
  'self.direction': { '=': ['motion_pointindirection', 'DIRECTION'] },
  'self.size': { '=': ['looks_setsizeto', 'SIZE'], '+=': ['looks_changesizeby', 'CHANGE'] },
  'sound.volume': { '=': ['sound_setvolumeto', 'VOLUME'], '+=': ['sound_changevolumeby', 'VOLUME'] },
  'pen.color': { '=': ['pen_setPenColorToColor', 'COLOR'] },
  'pen.size': { '=': ['pen_setPenSizeTo', 'SIZE'], '+=': ['pen_changePenSizeBy', 'SIZE'] },
};

export const SIMPLE_METHODS = {
  'pen.down': 'pen_penDown',
  'pen.up': 'pen_penUp',
  'pen.clear': 'pen_clear',
  'timer.reset': 'sensing_resettimer',
};
