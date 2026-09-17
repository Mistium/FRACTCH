import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePackageArgs, coerceOption, storedSettings } from '../src/packageCmd.js';

const defaults = { turbo: false, framerate: 30, target: 'html', app: { windowTitle: '' } };

test('package args: boolean flags do not swallow the input path', () => {
  const { words, flags } = parsePackageArgs(
    ['--turbo', 'dir', 'to', 'out.html', '--fps', '60', '--title=My Game', '--no-turbo', '-y'],
    defaults
  );
  assert.deepEqual(words, ['dir', 'to', 'out.html']);
  assert.deepEqual(flags, { turbo: 'false', framerate: '60', 'app.windowTitle': 'My Game', y: 'true' });
});

test('package options are coerced by default type and validated', () => {
  assert.equal(coerceOption(defaults, 'turbo', 'yes'), true);
  assert.equal(coerceOption(defaults, 'framerate', '60'), 60);
  assert.throws(() => coerceOption(defaults, 'framerate', 'abc'), /number/);
  assert.throws(() => coerceOption(defaults, 'bogus', '1'), /unknown packager option/);
  assert.throws(() => coerceOption(defaults, 'app', '1'), /unknown packager option/);
  assert.throws(() => coerceOption(defaults, 'target', 'foo'), /target must be one of/);
});

test('package defaults come from the stage _twconfig_ comment', () => {
  const comment =
    'Configuration for https://turbowarp.org/\nblah\n{"framerate":60,"runtimeOptions":{"maxClones":Infinity,"fencing":false},"hq":true,"width":1600,"height":1000} // _twconfig_';
  assert.deepEqual(storedSettings(['other', comment]), {
    framerate: 60,
    highQualityPen: true,
    stageWidth: 1600,
    stageHeight: 1000,
    maxClones: Infinity,
    fencing: false,
  });
  assert.deepEqual(storedSettings(['no config']), {});
});
