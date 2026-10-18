// Compile WalletWallaby's rig source (./rig-source.ts) into Rive runtime objects
// and the rest-pose model the pose solver and the tests share.
//
// The compiler does what a rigger does in the Rive editor, deterministically:
// it derives each bone's local transform from its authored joints, moves rigid
// outlines into their bone's space, binds skinned outlines to their bone chain
// (bind matrices plus per-vertex byte weights), resolves paint slots to brand
// tokens, and writes every pose clip as keyframes over the same property set.
// Same source, same bytes. Isomorphic.

import { mixTokens, TOKENS } from '../../../brand/tokens.ts';
import { FAMILY_COLORS, RIG_PALETTE, type ColorToken, type RigColor } from '../rig.ts';
import { encodeRiv, packBytes, rivColor, type RivObject, type RivPropName, type RivValue } from './riv-format.ts';
import { angleOf, apply, DEG, invert, local, mul, smoothContour, sub, type CubicVertexSpec, type Mat2D, type Vec } from './rig-math.ts';
import {
  ARTBOARD,
  BONES,
  CLIPS,
  CONTROLS,
  IKS,
  REST_IK,
  RIG_BONES,
  RIG_CLIPS,
  RIG_CONTROLS,
  RIG_IKS,
  RIG_ORIGIN,
  SHAPES,
  type ContourSpec,
  type IkGroup,
  type PaintSlot,
  type PoseSpec,
  type RigBone,
  type RigClip,
  type RigControl,
  type RigIk,
  type ShapeSpec,
} from './rig-source.ts';

/** Rest state of one bone, in the units the runtime stores (radians, rig px). */
export interface BoneModel {
  parent: RigBone | 'root';
  root: boolean;
  /** Position in the parent's space (root bones only; a chained bone sits at its parent's tip). */
  restX: number;
  restY: number;
  restRotation: number;
  length: number;
  /** World transform at rest, in rig space (feet at the origin). */
  restWorld: Mat2D;
}

export interface ControlModel {
  parent: RigBone | 'root';
  restX: number;
  restY: number;
  restRotation: number;
  restScaleY: number;
  restWorld: Mat2D;
}

export type Influences = readonly { bone: RigBone; weight: number }[];

/** One outline vertex with its Bezier handles, and (when skinned) the byte weights of each point. */
export interface OutlineVertex {
  at: Vec;
  inHandle: Vec;
  outHandle: Vec;
  skin?: { at: Influences; inHandle: Influences; outHandle: Influences };
}

/** One outline as the bounds checks and tests need it. */
export interface OutlineModel {
  shape: string;
  closed: boolean;
  /** Rigid outlines: vertices in the attached transform's space. Skinned (attach 'root'): rig-space vertices with weights. */
  attach: RigBone | RigControl | 'root';
  skinned: boolean;
  vertices: OutlineVertex[];
  /** Half the stroke width (rig px), so bounds include the outline's ink. */
  inkPad: number;
}

export interface RigModel {
  artboard: typeof ARTBOARD;
  origin: Vec;
  bones: Record<RigBone, BoneModel>;
  controls: Record<RigControl, ControlModel>;
  /** Rive IK constraints: constrained tip bone, strength group, and the control node they reach for. */
  iks: Record<RigIk, { tip: RigBone; group: IkGroup; target: RigControl }>;
  /** Each clip's duration, whether it loops, and the IK strengths it keys per group. */
  clips: Record<RigClip, { durationS: number; loop: boolean; control: boolean; ik: Partial<Record<IkGroup, number>> }>;
  outlines: OutlineModel[];
}

export class RigCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RigCompileError';
  }
}

const FPS = 60;
const near = (a: Vec, b: Vec): boolean => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
const finiteVec = (v: Vec, what: string): Vec => {
  if (!Number.isFinite(v[0]) || !Number.isFinite(v[1])) throw new RigCompileError(`${what} is not finite`);
  return v;
};

/** A rig colour name -> opaque #RRGGBB: the mascot family's coat, or a brand token. */
const rigColor = (name: RigColor): string => (name in FAMILY_COLORS ? FAMILY_COLORS[name as keyof typeof FAMILY_COLORS] : TOKENS[name as ColorToken]);

/** Paint slot -> opaque #RRGGBB (the shade is derived, never typed). */
export function slotColor(slot: PaintSlot): string {
  const entry = RIG_PALETTE[slot];
  return typeof entry === 'string' ? rigColor(entry) : mixTokens(rigColor(entry.from), rigColor(entry.to), entry.t);
}

function buildSkeleton(): { bones: Record<RigBone, BoneModel>; controls: Record<RigControl, ControlModel> } {
  const bones = {} as Record<RigBone, BoneModel>;
  const worldOf = (name: RigBone | 'root'): Mat2D => {
    if (name === 'root') return [1, 0, 0, 1, 0, 0];
    const b = bones[name];
    if (!b) throw new RigCompileError(`bone ${name} is used before it is defined`);
    return b.restWorld;
  };
  const seen = new Set<string>();
  for (const spec of BONES) {
    if (seen.has(spec.name)) throw new RigCompileError(`bone ${spec.name} defined twice`);
    seen.add(spec.name);
    finiteVec(spec.from, `${spec.name}.from`);
    finiteVec(spec.to, `${spec.name}.to`);
    const dir = sub(spec.to, spec.from);
    const length = Math.hypot(dir[0], dir[1]);
    if (!(length > 0.5)) throw new RigCompileError(`bone ${spec.name} is degenerate`);
    const parentWorld = worldOf(spec.parent);
    const rotation = Math.atan2(dir[1], dir[0]) - angleOf(parentWorld);
    let restX = 0;
    let restY = 0;
    if (spec.root) {
      [restX, restY] = apply(invert(parentWorld), spec.from);
    } else {
      if (spec.parent === 'root') throw new RigCompileError(`chained bone ${spec.name} needs a parent bone`);
      const parent = BONES.find((b) => b.name === spec.parent)!;
      if (!near(parent.to, spec.from)) throw new RigCompileError(`bone ${spec.name} must start at the tip of ${spec.parent}`);
      restX = bones[spec.parent].length;
    }
    bones[spec.name] = { parent: spec.parent, root: spec.root, restX, restY, restRotation: rotation, length, restWorld: mul(parentWorld, local(restX, restY, rotation)) };
  }
  for (const name of RIG_BONES) if (!bones[name]) throw new RigCompileError(`contract bone ${name} is missing`);

  const controls = {} as Record<RigControl, ControlModel>;
  for (const spec of CONTROLS) {
    if (controls[spec.name]) throw new RigCompileError(`control ${spec.name} defined twice`);
    const parentWorld = worldOf(spec.parent);
    const [restX, restY] = spec.parent === 'root' ? spec.at : apply(invert(parentWorld), spec.at);
    // Face controls are rig-aligned at rest; IK carriers store their value directly.
    const restRotation = spec.parent === 'root' ? spec.rotation : spec.rotation - angleOf(parentWorld);
    const restScaleY = spec.name === 'lid' ? 0 : 1;
    controls[spec.name] = { parent: spec.parent, restX, restY, restRotation, restScaleY, restWorld: mul(parentWorld, local(restX, restY, restRotation, 1, restScaleY || 1)) };
  }
  for (const name of RIG_CONTROLS) if (!controls[name]) throw new RigCompileError(`contract control ${name} is missing`);
  return { bones, controls };
}

/** Linear-blend weights along a connected bone chain: full weight mid-bone, a 50/50 split at each joint. */
function chainWeights(p: Vec, chain: readonly RigBone[], bones: Record<RigBone, BoneModel>): { bone: RigBone; weight: number }[] {
  const segs = chain.map((name) => {
    const w = bones[name].restWorld;
    return { name, a: apply(w, [0, 0]), b: apply(w, [bones[name].length, 0]) };
  });
  let best = 0;
  let bestD = Infinity;
  let bestT = 0;
  segs.forEach((s, i) => {
    const d = sub(s.b, s.a);
    const l2 = d[0] * d[0] + d[1] * d[1];
    const t = Math.max(0, Math.min(1, ((p[0] - s.a[0]) * d[0] + (p[1] - s.a[1]) * d[1]) / l2));
    const dist = Math.hypot(p[0] - (s.a[0] + d[0] * t), p[1] - (s.a[1] + d[1] * t));
    if (dist < bestD - 1e-9) {
      bestD = dist;
      best = i;
      bestT = t;
    }
  });
  const raw: [number, number][] = [];
  if (bestT < 0.5 && best > 0) raw.push([best, 0.5 + bestT], [best - 1, 0.5 - bestT]);
  else if (bestT >= 0.5 && best < segs.length - 1) raw.push([best, 1.5 - bestT], [best + 1, bestT - 0.5]);
  else raw.push([best, 1]);
  // Quantise to bytes that sum to exactly 255, as the runtime normalises by 255.
  const bytes = raw.map(([i, w]) => [i, Math.round(w * 255)] as [number, number]).filter(([, w]) => w > 0);
  const sum = bytes.reduce((a, [, w]) => a + w, 0);
  bytes[0]![1] += 255 - sum;
  return bytes.map(([i, w]) => ({ bone: chain[i]!, weight: w }));
}

class ArtboardWriter {
  readonly objects: RivObject[] = [];
  private next = 1;
  readonly index = new Map<string, number>();
  add(type: RivObject['type'], props: [RivPropName, RivValue][], key?: string): number {
    const id = this.next++;
    this.objects.push({ type, props });
    if (key) {
      if (this.index.has(key)) throw new RigCompileError(`duplicate object key ${key}`);
      this.index.set(key, id);
    }
    return id;
  }
  id(key: string): number {
    const id = this.index.get(key);
    if (id === undefined) throw new RigCompileError(`unknown object ${key}`);
    return id;
  }
}

const capOf = (c: 'butt' | 'round' | undefined): number => (c === 'round' ? 1 : 0);
const joinOf = (j: 'miter' | 'round' | undefined): number => (j === 'round' ? 1 : 0);

function vertexProps(v: CubicVertexSpec, toPath: (p: Vec) => Vec): { straight: boolean; props: [RivPropName, RivValue][] } {
  const at = toPath(v.at);
  const inH = toPath(v.inHandle);
  const outH = toPath(v.outHandle);
  const din = sub(inH, at);
  const dout = sub(outH, at);
  const lin = Math.hypot(din[0], din[1]);
  const lout = Math.hypot(dout[0], dout[1]);
  if (lin < 1e-9 && lout < 1e-9) return { straight: true, props: [['vertexX', at[0]], ['vertexY', at[1]]] };
  return {
    straight: false,
    props: [
      ['vertexX', at[0]],
      ['vertexY', at[1]],
      ['inRotation', lin < 1e-9 ? 0 : Math.atan2(din[1], din[0])],
      ['inDistance', lin],
      ['outRotation', lout < 1e-9 ? 0 : Math.atan2(dout[1], dout[0])],
      ['outDistance', lout],
    ],
  };
}

const matProps = (prefix: 'skin' | 'tendon', m: Mat2D): [RivPropName, RivValue][] => [
  [`${prefix}Xx` as RivPropName, m[0]],
  [`${prefix}Xy` as RivPropName, m[1]],
  [`${prefix}Yx` as RivPropName, m[2]],
  [`${prefix}Yy` as RivPropName, m[3]],
  [`${prefix}Tx` as RivPropName, m[4]],
  [`${prefix}Ty` as RivPropName, m[5]],
];

function writeShape(w: ArtboardWriter, spec: ShapeSpec, bones: Record<RigBone, BoneModel>, controls: Record<RigControl, ControlModel>, outlines: OutlineModel[]): void {
  const attachWorld: Mat2D =
    spec.attach === 'root' ? [1, 0, 0, 1, 0, 0] : (bones as Record<string, BoneModel>)[spec.attach]?.restWorld ?? (controls as Record<string, ControlModel>)[spec.attach]?.restWorld ?? null!;
  if (!attachWorld) throw new RigCompileError(`shape ${spec.name}: unknown attachment ${spec.attach}`);
  if (spec.skin && spec.attach !== 'root') throw new RigCompileError(`shape ${spec.name}: a skinned outline attaches to the root`);
  if (spec.skin && spec.space !== 'rig') throw new RigCompileError(`shape ${spec.name}: a skinned outline is authored in rig space`);
  const toAttach = spec.space === 'rig' ? (p: Vec): Vec => apply(invert(attachWorld), p) : (p: Vec): Vec => p;
  const shapeId = w.add('Shape', [['name', spec.name], ['parentId', spec.attach === 'root' ? w.id('node:root') : w.id(`${spec.attach in bones ? 'bone' : 'control'}:${spec.attach}`)]]);
  const g = spec.geometry;
  const inkPad = spec.stroke ? spec.stroke.width / 2 : 0;
  if (g.kind === 'ellipse') {
    const c = toAttach(finiteVec(g.center, `${spec.name}.center`));
    w.add('Ellipse', [['parentId', shapeId], ['x', c[0]], ['y', c[1]], ['rotation', spec.space === 'rig' ? -angleOf(attachWorld) : 0], ['ellipseWidth', g.width], ['ellipseHeight', g.height]]);
    const ring: Vec[] = Array.from({ length: 24 }, (_, i) => [g.center[0] + (g.width / 2) * Math.cos((i / 24) * 2 * Math.PI), g.center[1] + (g.height / 2) * Math.sin((i / 24) * 2 * Math.PI)]);
    outlines.push({ shape: spec.name, closed: true, attach: spec.attach, skinned: false, vertices: ring.map(toAttach).map((p) => ({ at: p, inHandle: p, outHandle: p })), inkPad });
  } else {
    for (const contour of g.kind === 'contours' ? g.contours : [g]) writePath(w, spec, shapeId, contour, bones, toAttach, outlines, inkPad);
  }
  if (spec.fill) {
    const fillId = w.add('Fill', [['parentId', shapeId], ['fillRule', 0], ['isVisible', true]]);
    w.add('SolidColor', [['parentId', fillId], ['colorValue', rivColor(slotColor(spec.fill.slot), spec.fill.alpha ?? 1)]]);
  }
  if (spec.stroke) {
    const s = spec.stroke;
    const strokeId = w.add('Stroke', [['parentId', shapeId], ['thickness', s.width], ['cap', capOf(s.cap)], ['join', joinOf(s.join)], ['transformAffectsStroke', true], ['isVisible', true]]);
    w.add('SolidColor', [['parentId', strokeId], ['colorValue', rivColor(slotColor(s.slot), s.alpha ?? 1)]]);
  }
}

/** One path of a shape: its vertices (skinned to the shape's bone chain when it has one) and its outline model. */
function writePath(
  w: ArtboardWriter,
  spec: ShapeSpec,
  shapeId: number,
  g: ContourSpec,
  bones: Record<RigBone, BoneModel>,
  toAttach: (p: Vec) => Vec,
  outlines: OutlineModel[],
  inkPad: number,
): void {
  const verts = smoothContour(g.points, g.closed, g.roundness ?? 1);
  const pathId = w.add('PointsPath', [['parentId', shapeId], ['isClosed', g.closed]]);
  if (!spec.skin) {
    for (const v of verts) {
      const vp = vertexProps(v, toAttach);
      w.add(vp.straight ? 'StraightVertex' : 'CubicDetachedVertex', [['parentId', pathId], ...vp.props]);
    }
    outlines.push({ shape: spec.name, closed: g.closed, attach: spec.attach, skinned: false, vertices: verts.map((v) => ({ at: toAttach(v.at), inHandle: toAttach(v.inHandle), outHandle: toAttach(v.outHandle) })), inkPad });
    return;
  }
  const chain = spec.skin;
  for (let i = 1; i < chain.length; i++) {
    const prev = bones[chain[i - 1]!];
    const tipPrev = apply(prev.restWorld, [prev.length, 0]);
    const startCur = apply(bones[chain[i]!].restWorld, [0, 0]);
    if (!near(tipPrev, startCur) && Math.hypot(tipPrev[0] - startCur[0], tipPrev[1] - startCur[1]) > 1e-6) throw new RigCompileError(`shape ${spec.name}: skin chain ${chain.join(' > ')} is not connected`);
  }
  const tendonIndex = new Map(chain.map((b, i) => [b, i + 1]));
  const pack = (infl: Influences, what: string): [number, number] => [packBytes(infl.map((f) => f.weight), `${what}.values`), packBytes(infl.map((f) => tendonIndex.get(f.bone)!), `${what}.indices`)];
  const vertices: OutlineVertex[] = [];
  verts.forEach((v, i) => {
    const vp = vertexProps(v, (p) => p);
    const vid = w.add(vp.straight ? 'StraightVertex' : 'CubicDetachedVertex', [['parentId', pathId], ...vp.props]);
    const infl = chainWeights(v.at, chain, bones);
    const inInfl = vp.straight ? infl : chainWeights(v.inHandle, chain, bones);
    const outInfl = vp.straight ? infl : chainWeights(v.outHandle, chain, bones);
    const [values, indices] = pack(infl, `${spec.name}.v${i}`);
    vertices.push({ ...v, skin: { at: infl, inHandle: inInfl, outHandle: outInfl } });
    if (vp.straight) w.add('Weight', [['parentId', vid], ['weightValues', values], ['weightIndices', indices]]);
    else {
      const [iv, ii] = pack(inInfl, `${spec.name}.v${i}.in`);
      const [ov, oi] = pack(outInfl, `${spec.name}.v${i}.out`);
      w.add('CubicWeight', [['parentId', vid], ['weightValues', values], ['weightIndices', indices], ['cubicInValues', iv], ['cubicInIndices', ii], ['cubicOutValues', ov], ['cubicOutIndices', oi]]);
    }
  });
  const toArtboard: Mat2D = [1, 0, 0, 1, RIG_ORIGIN[0], RIG_ORIGIN[1]];
  const skinId = w.add('Skin', [['parentId', pathId], ...matProps('skin', toArtboard)]);
  for (const b of chain) w.add('Tendon', [['parentId', skinId], ['tendonBoneId', w.id(`bone:${b}`)], ...matProps('tendon', mul(toArtboard, bones[b].restWorld))]);
  outlines.push({ shape: spec.name, closed: g.closed, attach: 'root', skinned: true, vertices, inkPad });
}

export interface PoseValues {
  bones: Record<RigBone, number>;
  hipX: number;
  hipY: number;
  ik: Record<IkGroup, number>;
  stance: number;
  heel: number;
}

/** Absolute values a pose sets on every pose property (rest + deltas). */
export function poseValues(pose: PoseSpec, bones: Record<RigBone, BoneModel>, controls: Record<RigControl, ControlModel>): PoseValues {
  const out = {} as Record<RigBone, number>;
  for (const name of RIG_BONES) {
    const delta = pose.bones?.[name] ?? 0;
    if (!Number.isFinite(delta)) throw new RigCompileError(`pose delta for ${name} is not finite`);
    out[name] = bones[name].restRotation + delta * DEG;
  }
  for (const k of Object.keys(pose.bones ?? {})) if (!(RIG_BONES as readonly string[]).includes(k)) throw new RigCompileError(`pose names unknown bone ${k}`);
  const heel = pose.ik?.heelDeg;
  const arms = pose.ik?.arms ?? REST_IK.arms;
  // Both forelimbs follow `arms` in a pose; the near one's group also answers the point_near control clip.
  const ik = { legs: pose.ik?.legs ?? REST_IK.legs, arms, tail: pose.ik?.tail ?? REST_IK.tail, pointNear: arms };
  for (const [g, v] of Object.entries(ik)) if (!(v >= 0 && v <= 1)) throw new RigCompileError(`IK strength ${g}=${v} is outside [0, 1]`);
  return {
    bones: out,
    hipX: bones.hip.restX + (pose.hip?.dx ?? 0),
    hipY: bones.hip.restY + (pose.hip?.dy ?? 0),
    ik,
    stance: pose.ik?.stance ?? controls.stance.restX,
    heel: heel === undefined ? controls.heel.restRotation : heel * DEG,
  };
}

export interface CompiledRig {
  bytes: Uint8Array;
  model: RigModel;
}

export function compileRig(): CompiledRig {
  const { bones, controls } = buildSkeleton();
  const w = new ArtboardWriter();
  const outlines: OutlineModel[] = [];
  const objects: RivObject[] = [
    { type: 'Backboard', props: [] },
    { type: 'Artboard', props: [['name', ARTBOARD.name], ['artboardWidth', ARTBOARD.width], ['artboardHeight', ARTBOARD.height], ['artboardClip', false]] },
  ];
  w.add('Node', [['name', 'root'], ['parentId', 0], ['x', RIG_ORIGIN[0]], ['y', RIG_ORIGIN[1]]], 'node:root');
  for (const spec of BONES) {
    const b = bones[spec.name];
    const parentId = spec.parent === 'root' ? w.id('node:root') : w.id(`bone:${spec.parent}`);
    if (b.root) w.add('RootBone', [['name', spec.name], ['parentId', parentId], ['rootBoneX', b.restX], ['rootBoneY', b.restY], ['rotation', b.restRotation], ['boneLength', b.length]], `bone:${spec.name}`);
    else w.add('Bone', [['name', spec.name], ['parentId', parentId], ['rotation', b.restRotation], ['boneLength', b.length]], `bone:${spec.name}`);
  }
  for (const spec of CONTROLS) {
    const c = controls[spec.name];
    const parentId = spec.parent === 'root' ? w.id('node:root') : w.id(`bone:${spec.parent}`);
    const props: [RivPropName, RivValue][] = [['name', spec.name], ['parentId', parentId], ['x', c.restX], ['y', c.restY], ['rotation', c.restRotation]];
    if (c.restScaleY !== 1) props.push(['scaleY', c.restScaleY]);
    w.add('Node', props, `control:${spec.name}`);
  }
  // Rive IK: each constraint sits on its tip bone and reaches for a control node.
  const iks = {} as RigModel['iks'];
  for (const spec of IKS) {
    if (iks[spec.name]) throw new RigCompileError(`IK ${spec.name} defined twice`);
    if (!Number.isInteger(spec.parentBones) || spec.parentBones < 0) throw new RigCompileError(`IK ${spec.name}: parentBones must be a non-negative integer`);
    let bone: RigBone = spec.tip;
    for (let k = 0; k < spec.parentBones; k++) {
      const parent = bones[bone].parent;
      if (parent === 'root') throw new RigCompileError(`IK ${spec.name}: the chain above ${spec.tip} has only ${k} bones`);
      bone = parent;
    }
    w.add(
      'IKConstraint',
      [['name', spec.name], ['parentId', w.id(`bone:${spec.tip}`)], ['constraintTargetId', w.id(`control:${spec.target}`)], ['constraintStrength', REST_IK[spec.group]], ['ikInvertDirection', spec.invert], ['ikParentBoneCount', spec.parentBones]],
      `ik:${spec.name}`,
    );
    iks[spec.name] = { tip: spec.tip, group: spec.group, target: spec.target };
  }
  for (const name of RIG_IKS) if (!iks[name]) throw new RigCompileError(`contract IK ${name} is missing`);
  // The runtime draws the first drawable in the stream last (on top): write front to back.
  const names = new Set<string>();
  for (const spec of [...SHAPES].reverse()) {
    if (names.has(spec.name)) throw new RigCompileError(`shape ${spec.name} defined twice`);
    names.add(spec.name);
    writeShape(w, spec, bones, controls, outlines);
  }
  objects.push(...w.objects);

  // Clips: every pose clip keys the full pose property set, so blending them is order-stable and history-free.
  const clips = {} as RigModel['clips'];
  const clipNames = new Set<string>();
  for (const clip of CLIPS) {
    if (clipNames.has(clip.name)) throw new RigCompileError(`clip ${clip.name} defined twice`);
    clipNames.add(clip.name);
    if (clip.keys.length === 0) throw new RigCompileError(`clip ${clip.name} has no keys`);
    const frames = clip.keys.map((k) => Math.round(k.atS * FPS));
    if (frames[0] !== 0 || frames.some((f, i) => i > 0 && f <= frames[i - 1]!)) throw new RigCompileError(`clip ${clip.name}: keys must start at 0 and strictly increase`);
    const duration = Math.max(1, frames[frames.length - 1]!);
    objects.push({ type: 'LinearAnimation', props: [['animationName', clip.name], ['fps', FPS], ['duration', duration], ['speed', 1], ['loopValue', clip.loop ? 1 : 0]] });
    const values = clip.keys.map((k) => poseValues(k.pose, bones, controls));
    const keyed = (objectId: number, props: [RivPropName, (v: PoseValues) => number][]): void => {
      objects.push({ type: 'KeyedObject', props: [['objectId', objectId]] });
      for (const [prop, get] of props) {
        objects.push({ type: 'KeyedProperty', props: [['propertyKey', propertyKeyOf(prop)]] });
        values.forEach((v, i) => objects.push({ type: 'KeyFrameDouble', props: [['frame', frames[i]!], ['interpolationType', 1], ['keyValue', get(v)]] }));
      }
    };
    if (clip.only) {
      // A control clip: only the named IK strengths, so mixing it moves nothing else.
      for (const [group, strength] of Object.entries(clip.only.ik) as [IkGroup, number][]) {
        if (!(strength >= 0 && strength <= 1)) throw new RigCompileError(`clip ${clip.name}: IK strength ${strength} is outside [0, 1]`);
        for (const spec of IKS.filter((k) => k.group === group)) keyed(w.id(`ik:${spec.name}`), [['constraintStrength', () => strength]]);
      }
      clips[clip.name] = { durationS: duration / FPS, loop: clip.loop, control: true, ik: { ...clip.only.ik } };
      continue;
    }
    clips[clip.name] = { durationS: duration / FPS, loop: clip.loop, control: false, ik: values[0]!.ik };
    for (const name of RIG_BONES) {
      const props: [RivPropName, (v: PoseValues) => number][] = [['rotation', (v) => v.bones[name]]];
      if (name === 'hip') props.push(['rootBoneX', (v) => v.hipX], ['rootBoneY', (v) => v.hipY]);
      keyed(w.id(`bone:${name}`), props);
    }
    keyed(w.id('control:stance'), [['x', (v) => v.stance]]);
    keyed(w.id('control:heel'), [['rotation', (v) => v.heel]]);
    for (const spec of IKS) keyed(w.id(`ik:${spec.name}`), [['constraintStrength', (v) => v.ik[spec.group]]]);
    if (clip.name === 'base') {
      // The reset also returns the face controls and the IK targets to rest; the solver then sets them absolutely.
      keyed(w.id('control:gaze'), [['x', () => controls.gaze.restX], ['y', () => controls.gaze.restY]]);
      keyed(w.id('control:lid'), [['scaleY', () => controls.lid.restScaleY]]);
      keyed(w.id('control:brow'), [['rotation', () => controls.brow.restRotation]]);
      for (const name of RIG_CONTROLS.filter((c) => c.startsWith('target_'))) keyed(w.id(`control:${name}`), [['x', () => controls[name].restX], ['y', () => controls[name].restY]]);
    }
  }
  for (const name of RIG_CLIPS) if (!clips[name]) throw new RigCompileError(`contract clip ${name} is missing`);

  const model: RigModel = { artboard: ARTBOARD, origin: RIG_ORIGIN, bones, controls, iks, clips, outlines };
  return { bytes: encodeRiv(objects), model };
}

function propertyKeyOf(name: RivPropName): number {
  const keys: Partial<Record<RivPropName, number>> = { x: 13, y: 14, rotation: 15, scaleX: 16, scaleY: 17, opacity: 18, rootBoneX: 90, rootBoneY: 91, constraintStrength: 172 };
  const key = keys[name];
  if (key === undefined) throw new RigCompileError(`${name} is not animatable`);
  return key;
}
