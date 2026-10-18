// A minimal, deterministic writer for the Rive runtime file format (.riv).
//
// WalletWallaby's rig is authored as code (./rig-source.ts) and compiled to a
// .riv that the official Rive runtime loads. This module only serialises: it
// covers the handful of object types the rig uses, validates every value, and
// produces the same bytes for the same objects, always.
//
// Format (Rive runtime format, major version 7): the ASCII fingerprint "RIVE",
// varuint major and minor versions, a varuint file id, a table of contents
// (every property key used, 0-terminated, then each key's field type packed
// 2 bits at a time into little-endian uint32 words, four keys per word), then
// the objects. An object is a varuint type key followed by (varuint property
// key, value) pairs and a 0 terminator. Values: uint and id as LEB128 varuint,
// double as float32 LE, color as uint32 LE (0xAARRGGBB), bool as one byte,
// string as varuint length + UTF-8.
//
// Type and property keys are the runtime's own (rive-runtime,
// include/rive/generated/*_base.hpp). They are part of the published file
// format and are never reassigned. Isomorphic.

/** Wire type of a property value. */
export type FieldType = 'uint' | 'bool' | 'double' | 'color' | 'string';

export const RIV_MAJOR_VERSION = 7;
export const RIV_MINOR_VERSION = 0;

/** Runtime type keys of the objects the rig uses. */
export const RIV_TYPE = {
  Artboard: 1,
  Node: 2,
  Shape: 3,
  Ellipse: 4,
  StraightVertex: 5,
  CubicDetachedVertex: 6,
  PointsPath: 16,
  SolidColor: 18,
  Fill: 20,
  Backboard: 23,
  Stroke: 24,
  KeyedObject: 25,
  KeyedProperty: 26,
  KeyFrameDouble: 30,
  LinearAnimation: 31,
  Bone: 40,
  RootBone: 41,
  Skin: 43,
  Tendon: 44,
  Weight: 45,
  CubicWeight: 46,
  IKConstraint: 81,
} as const;

export type RivTypeName = keyof typeof RIV_TYPE;

/** Runtime property keys and their wire types, by the name this module uses for them. */
export const RIV_PROP = {
  name: [4, 'string'],
  parentId: [5, 'uint'],
  artboardWidth: [7, 'double'],
  artboardHeight: [8, 'double'],
  x: [13, 'double'],
  y: [14, 'double'],
  rotation: [15, 'double'],
  scaleX: [16, 'double'],
  scaleY: [17, 'double'],
  opacity: [18, 'double'],
  ellipseWidth: [20, 'double'],
  ellipseHeight: [21, 'double'],
  vertexX: [24, 'double'],
  vertexY: [25, 'double'],
  isClosed: [32, 'bool'],
  colorValue: [37, 'color'],
  fillRule: [40, 'uint'],
  isVisible: [41, 'bool'],
  thickness: [47, 'double'],
  cap: [48, 'uint'],
  join: [49, 'uint'],
  transformAffectsStroke: [50, 'bool'],
  objectId: [51, 'uint'],
  propertyKey: [53, 'uint'],
  animationName: [55, 'string'],
  fps: [56, 'uint'],
  duration: [57, 'uint'],
  speed: [58, 'double'],
  loopValue: [59, 'uint'],
  frame: [67, 'uint'],
  interpolationType: [68, 'uint'],
  keyValue: [70, 'double'],
  inRotation: [84, 'double'],
  inDistance: [85, 'double'],
  outRotation: [86, 'double'],
  outDistance: [87, 'double'],
  boneLength: [89, 'double'],
  rootBoneX: [90, 'double'],
  rootBoneY: [91, 'double'],
  tendonBoneId: [95, 'uint'],
  tendonXx: [96, 'double'],
  tendonYx: [97, 'double'],
  tendonXy: [98, 'double'],
  tendonYy: [99, 'double'],
  tendonTx: [100, 'double'],
  tendonTy: [101, 'double'],
  weightValues: [102, 'uint'],
  weightIndices: [103, 'uint'],
  skinXx: [104, 'double'],
  skinYx: [105, 'double'],
  skinXy: [106, 'double'],
  skinYy: [107, 'double'],
  skinTx: [108, 'double'],
  skinTy: [109, 'double'],
  cubicInValues: [110, 'uint'],
  cubicInIndices: [111, 'uint'],
  cubicOutValues: [112, 'uint'],
  cubicOutIndices: [113, 'uint'],
  ellipseOriginX: [123, 'double'],
  ellipseOriginY: [124, 'double'],
  constraintStrength: [172, 'double'],
  constraintTargetId: [173, 'uint'],
  ikInvertDirection: [174, 'bool'],
  ikParentBoneCount: [175, 'uint'],
  artboardClip: [196, 'bool'],
} as const satisfies Record<string, readonly [number, FieldType]>;

export type RivPropName = keyof typeof RIV_PROP;

/** Property keys a keyframe may animate (all are doubles on transform components). */
export const ANIMATABLE: ReadonlySet<RivPropName> = new Set<RivPropName>(['x', 'y', 'rotation', 'scaleX', 'scaleY', 'opacity', 'rootBoneX', 'rootBoneY', 'constraintStrength']);

export type RivValue = number | boolean | string;

export interface RivObject {
  type: RivTypeName;
  /** Properties in emission order. Order is preserved, so the same object always encodes the same way. */
  props: readonly (readonly [RivPropName, RivValue])[];
}

/** Any refusal by the writer: a value the format cannot carry, or an object list that cannot be a file. */
export class RivFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RivFormatError';
  }
}

/** Table-of-contents field index of each wire type (bools travel as one byte and share the uint index). */
const TOC_FIELD_INDEX: Record<FieldType, number> = { uint: 0, bool: 0, string: 1, double: 2, color: 3 };

class ByteSink {
  private chunks: number[] = [];
  byte(b: number): void {
    this.chunks.push(b & 0xff);
  }
  varuint(n: number, what: string): void {
    if (!Number.isSafeInteger(n) || n < 0) throw new RivFormatError(`${what}: ${n} is not a non-negative integer`);
    let v = n;
    do {
      let b = v % 128;
      v = Math.floor(v / 128);
      if (v > 0) b |= 0x80;
      this.byte(b);
    } while (v > 0);
  }
  uint32(n: number, what: string): void {
    if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new RivFormatError(`${what}: ${n} is not a uint32`);
    for (let k = 0; k < 4; k++) this.byte(Math.floor(n / 2 ** (8 * k)) % 256);
  }
  float32(n: number, what: string): void {
    if (typeof n !== 'number' || !Number.isFinite(n)) throw new RivFormatError(`${what}: ${String(n)} is not a finite number`);
    if (Math.abs(n) > 3.4e38) throw new RivFormatError(`${what}: ${n} overflows float32`);
    const view = new DataView(new ArrayBuffer(4));
    view.setFloat32(0, n, true);
    for (let k = 0; k < 4; k++) this.byte(view.getUint8(k));
  }
  string(s: string, what: string): void {
    if (typeof s !== 'string') throw new RivFormatError(`${what}: not a string`);
    const bytes = new TextEncoder().encode(s);
    this.varuint(bytes.length, `${what}.length`);
    for (const b of bytes) this.byte(b);
  }
  bytes(): Uint8Array {
    return Uint8Array.from(this.chunks);
  }
}

function writeValue(sink: ByteSink, name: RivPropName, value: RivValue, at: string): void {
  const [, type] = RIV_PROP[name];
  const what = `${at}.${name}`;
  switch (type) {
    case 'uint':
      if (typeof value !== 'number') throw new RivFormatError(`${what}: expected a number`);
      sink.varuint(value, what);
      return;
    case 'bool':
      if (typeof value !== 'boolean') throw new RivFormatError(`${what}: expected a boolean`);
      sink.byte(value ? 1 : 0);
      return;
    case 'double':
      if (typeof value !== 'number') throw new RivFormatError(`${what}: expected a number`);
      sink.float32(value, what);
      return;
    case 'color':
      if (typeof value !== 'number') throw new RivFormatError(`${what}: expected a 0xAARRGGBB number`);
      sink.uint32(value, what);
      return;
    case 'string':
      if (typeof value !== 'string') throw new RivFormatError(`${what}: expected a string`);
      sink.string(value, what);
      return;
  }
}

export interface RivFileOptions {
  /** File id recorded in the header (0 = none). */
  fileId?: number;
}

/**
 * Encode a complete object stream (Backboard, then each Artboard followed by
 * its components and animations) as a .riv file. Fails closed on an unknown
 * property, a duplicated property, or a value the wire type cannot carry.
 */
export function encodeRiv(objects: readonly RivObject[], options: RivFileOptions = {}): Uint8Array {
  if (objects.length === 0 || objects[0]!.type !== 'Backboard') throw new RivFormatError('a .riv starts with a Backboard');
  if (!objects.some((o) => o.type === 'Artboard')) throw new RivFormatError('a .riv needs at least one Artboard');
  const used = new Set<number>();
  for (const [i, o] of objects.entries()) {
    if (!(o.type in RIV_TYPE)) throw new RivFormatError(`object ${i}: unknown type ${String(o.type)}`);
    const seen = new Set<string>();
    for (const [name] of o.props) {
      if (!(name in RIV_PROP)) throw new RivFormatError(`object ${i} (${o.type}): unknown property ${String(name)}`);
      if (seen.has(name)) throw new RivFormatError(`object ${i} (${o.type}): property ${name} set twice`);
      seen.add(name);
      used.add(RIV_PROP[name][0]);
    }
  }
  const typeOfKey = new Map<number, FieldType>(Object.values(RIV_PROP).map(([key, type]) => [key, type]));
  const keys = [...used].sort((a, b) => a - b);

  const sink = new ByteSink();
  for (const ch of 'RIVE') sink.byte(ch.charCodeAt(0));
  sink.varuint(RIV_MAJOR_VERSION, 'header.major');
  sink.varuint(RIV_MINOR_VERSION, 'header.minor');
  sink.varuint(options.fileId ?? 0, 'header.fileId');
  for (const key of keys) sink.varuint(key, 'toc.key');
  sink.varuint(0, 'toc.end');
  for (let i = 0; i < keys.length; i += 4) {
    let word = 0;
    for (let j = 0; j < 4 && i + j < keys.length; j++) word += TOC_FIELD_INDEX[typeOfKey.get(keys[i + j]!)!] * 2 ** (2 * j);
    sink.uint32(word, 'toc.fields');
  }
  for (const [i, o] of objects.entries()) {
    sink.varuint(RIV_TYPE[o.type], `object ${i}.type`);
    for (const [name, value] of o.props) {
      sink.varuint(RIV_PROP[name][0], `object ${i}.key`);
      writeValue(sink, name, value, `object ${i} (${o.type})`);
    }
    sink.varuint(0, `object ${i}.end`);
  }
  return sink.bytes();
}

/** Pack four 0..255 bytes (weights or tendon indices) into one varuint the way Rive's Weight stores them. */
export function packBytes(values: readonly number[], what: string): number {
  if (values.length > 4) throw new RivFormatError(`${what}: at most four influences`);
  let packed = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (!Number.isInteger(v) || v < 0 || v > 255) throw new RivFormatError(`${what}: ${v} is not a byte`);
    packed += v * 2 ** (8 * i);
  }
  return packed;
}

/** An opaque #RRGGBB brand token as a Rive 0xAARRGGBB color. */
export function rivColor(hex: string, alpha = 1): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m || !Number.isFinite(alpha) || alpha < 0 || alpha > 1) throw new RivFormatError(`rivColor(${hex}, ${alpha}): needs an opaque #rrggbb token and 0..1 alpha`);
  return Math.round(alpha * 255) * 2 ** 24 + parseInt(m[1]!, 16);
}
