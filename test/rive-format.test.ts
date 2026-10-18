// The .riv writer: byte layout of the Rive runtime format, determinism, and
// fail-closed refusals (positive controls for every refusal).

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { TOKENS } from '../src/brand/tokens.ts';
import { encodeRiv, packBytes, RIV_MAJOR_VERSION, RIV_PROP, RivFormatError, rivColor, type RivObject } from '../src/character/walletwallaby/rive/riv-format.ts';

const minimal = (props: RivObject['props'] = [['name', 'A']]): RivObject[] => [
  { type: 'Backboard', props: [] },
  { type: 'Artboard', props },
];

/** Decode one LEB128 varuint at `at`, returning [value, next offset]. */
function varuint(bytes: Uint8Array, at: number): [number, number] {
  let v = 0;
  let shift = 1;
  let i = at;
  for (;;) {
    const b = bytes[i++]!;
    v += (b & 0x7f) * shift;
    if (b < 0x80) return [v, i];
    shift *= 128;
  }
}

describe('riv writer', () => {
  test('writes the runtime header: fingerprint, major version 7, table of contents', () => {
    const bytes = encodeRiv(minimal([['name', 'A'], ['artboardWidth', 10]]));
    assert.equal(String.fromCharCode(...bytes.slice(0, 4)), 'RIVE');
    let [major, at] = varuint(bytes, 4);
    assert.equal(major, RIV_MAJOR_VERSION);
    let minor: number;
    [minor, at] = varuint(bytes, at);
    let fileId: number;
    [fileId, at] = varuint(bytes, at);
    assert.equal(minor, 0);
    assert.equal(fileId, 0);
    // ToC: the used keys in ascending order (name = 4, width = 7), then 0, then one packed word of 2-bit field types.
    const keys: number[] = [];
    for (let k = -1; k !== 0; ) {
      [k, at] = varuint(bytes, at);
      if (k) keys.push(k);
    }
    assert.deepEqual(keys, [RIV_PROP.name[0], RIV_PROP.artboardWidth[0]]);
    const word = bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16) | (bytes[at + 3]! << 24);
    assert.equal(word & 3, 1, 'name is a string (field type 1)');
    assert.equal((word >> 2) & 3, 2, 'width is a double (field type 2)');
  });

  test('the same objects encode to the same bytes, always', () => {
    const objects = minimal([['name', 'WalletWallaby'], ['artboardWidth', 340.25], ['artboardClip', false]]);
    assert.deepEqual(encodeRiv(objects), encodeRiv(structuredClone(objects)));
  });

  test('doubles are float32 little-endian; colours are uint32 0xAARRGGBB', () => {
    const bytes = encodeRiv([...minimal(), { type: 'SolidColor', props: [['colorValue', 0xff112233]] }, { type: 'Node', props: [['x', 1.5]] }]);
    const color = [0x33, 0x22, 0x11, 0xff];
    assert.ok(bytes.join(',').includes(color.join(',')), 'colour bytes present in LE order');
    const f = new Uint8Array(new Float32Array([1.5]).buffer);
    assert.ok(bytes.join(',').includes([...f].join(',')), 'float32 LE present');
  });

  test('refuses values the format cannot carry (positive controls)', () => {
    const bad: [string, RivObject[]][] = [
      ['NaN double', [...minimal(), { type: 'Node', props: [['x', Number.NaN]] }]],
      ['Infinite double', [...minimal(), { type: 'Node', props: [['y', Number.POSITIVE_INFINITY]] }]],
      ['float32 overflow', [...minimal(), { type: 'Node', props: [['x', 1e39]] }]],
      ['negative uint', [...minimal(), { type: 'Node', props: [['parentId', -1]] }]],
      ['fractional uint', [...minimal(), { type: 'Node', props: [['parentId', 1.5]] }]],
      ['colour out of range', [...minimal(), { type: 'SolidColor', props: [['colorValue', 2 ** 32]] }]],
      ['string where a number belongs', [...minimal(), { type: 'Node', props: [['x', '1' as unknown as number]] }]],
      ['bool where a number belongs', [...minimal(), { type: 'Node', props: [['x', true as unknown as number]] }]],
      ['duplicate property', [...minimal(), { type: 'Node', props: [['x', 1], ['x', 2]] }]],
      ['unknown property', [...minimal(), { type: 'Node', props: [['wobble' as never, 1]] }]],
      ['unknown type', [...minimal(), { type: 'Sprite' as never, props: [] }]],
      ['no backboard first', minimal().reverse()],
      ['no artboard', [{ type: 'Backboard', props: [] }]],
    ];
    for (const [name, objects] of bad) assert.throws(() => encodeRiv(objects), RivFormatError, name);
    assert.doesNotThrow(() => encodeRiv(minimal()), 'control: a minimal file encodes');
  });

  test('packs weights and indices as four bytes, refusing anything else', () => {
    assert.equal(packBytes([255], 'w'), 255);
    assert.equal(packBytes([128, 127], 'w'), 128 + 127 * 256);
    assert.equal(packBytes([1, 2, 3, 4], 'i'), 1 + 2 * 256 + 3 * 65536 + 4 * 16777216);
    assert.throws(() => packBytes([256], 'w'), RivFormatError);
    assert.throws(() => packBytes([1.5], 'w'), RivFormatError);
    assert.throws(() => packBytes([1, 2, 3, 4, 5], 'w'), RivFormatError);
  });

  test('colours come only from opaque brand tokens', () => {
    const c = rivColor(TOKENS.terracotta);
    assert.equal(c % 2 ** 24, parseInt(TOKENS.terracotta.slice(1), 16));
    assert.equal(Math.floor(c / 2 ** 24), 255);
    assert.equal(Math.floor(rivColor(TOKENS.charcoal, 0.12) / 2 ** 24), Math.round(0.12 * 255));
    assert.throws(() => rivColor('orange'), RivFormatError);
    assert.throws(() => rivColor(TOKENS.terracotta, 1.2), RivFormatError);
  });
});
