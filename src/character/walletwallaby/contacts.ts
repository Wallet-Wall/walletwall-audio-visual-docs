// Every contact WalletWallaby makes in a motion plan, judged for support.
//
// A plan's moves are listed as the contacts they make with the terrain: each
// perch (a hold, or a landing that settles), each passing step (a push-off, a
// chained bound, a trace foothold), each grip (a climb's hands on a lip), and
// each brace (a push's stance). Each is judged (./support.ts) against the
// terrain drawn at that instant: its own segment's, and while that segment is
// still transitioning in, the outgoing segment's too (the previous scene is
// still on screen under the feet). A contact off the stage (an entrance or an
// exit beyond the frame) is not judged: nothing there can be seen standing.
//
// The audit is the motion layer's fail-closed gate: a plan with one contact the
// terrain cannot carry is refused, and the review renders its table as is.
// Isomorphic.

import { FRAME, type Point } from '../../layout/geometry.ts';
import type { SceneLayout } from '../../layout/scene-layout.ts';
import { terrainsFor, type Terrain } from '../../layout/terrain.ts';
import type { Timeline } from '../../timeline/timeline.ts';
import { MotionPlanError } from './ballistics.ts';
import type { MotionPlan } from './motion.ts';
import { WALLABY_HEIGHT } from './rig.ts';
import { evaluateGrip, evaluateStance, type ContactRole, type HandVerdict, type SupportConfig, type SupportVerdict } from './support.ts';

export type ContactKind = 'HOLD' | 'LANDING' | 'TAKEOFF' | 'STEP' | 'GRIP' | 'BRACE';

export interface PlanContact {
  kind: ContactKind;
  /** Index of the clip making the contact. */
  clip: number;
  segmentId: string;
  /** When the contact is made; a hold lasts until `untilMs`. */
  atMs: number;
  untilMs: number;
  at: Point;
  scale: number;
  facing: 1 | -1;
  role: ContactRole;
  /** What the body is doing (the clip's move and, for a hold, its pose). */
  action: string;
  /** A grip's shoulder (the hand reaches from it). */
  shoulder?: Point;
}

export interface JudgedContact extends PlanContact {
  ok: boolean;
  /** Off the stage: not judged. */
  offStage: boolean;
  /** The segment whose terrain carried the contact (its own, or the outgoing one during a transition), or null. */
  terrainOf: string | null;
  stance: SupportVerdict | null;
  hand: HandVerdict | null;
}

export interface SegmentWindow {
  id: string;
  startMs: number;
  /** The segment's own content is on screen from here; before it, the previous segment's still is. */
  contentStartMs: number;
}

const travelFacing = (from: Point, to: Point): 1 | -1 => (to.x < from.x - 4 ? -1 : 1);
const lookFacing = (at: Point, look: Point | null): 1 | -1 => (look && look.x < at.x - 12 ? -1 : 1);

/** Every contact a plan makes, in clip order. */
export function listContacts(plan: MotionPlan): PlanContact[] {
  const out: PlanContact[] = [];
  const sup = plan.config.support;
  plan.clips.forEach((clip, i) => {
    const m = plan.motions[i]!;
    const base = { clip: i, segmentId: clip.segmentId, untilMs: 0 };
    const add = (c: Omit<PlanContact, 'clip' | 'segmentId' | 'untilMs'> & { untilMs?: number }): void => {
      out.push({ ...base, ...c, untilMs: c.untilMs ?? c.atMs });
    };
    switch (m.kind) {
      case 'HIDDEN':
        return;
      case 'HOLD':
        add({ kind: 'HOLD', atMs: clip.startMs, untilMs: clip.endMs, at: clip.from, scale: clip.fromScale, facing: lookFacing(clip.from, clip.lookAt), role: 'PERCH', action: `HOLD ${clip.pose}` });
        return;
      case 'HOP': {
        const facing = travelFacing(clip.from, clip.to);
        if (!m.airborneStart) add({ kind: 'TAKEOFF', atMs: m.takeoffMs, at: clip.from, scale: clip.fromScale, facing, role: 'STEP', action: clip.action ?? 'TRAVEL' });
        add({ kind: 'LANDING', atMs: m.contactMs, at: clip.to, scale: clip.toScale, facing, role: 'PERCH', action: m.airborneStart ? 'FALL' : (clip.action ?? 'TRAVEL') });
        return;
      }
      case 'MANTLE': {
        const facing: 1 | -1 = m.side > 0 ? -1 : 1;
        const bh = WALLABY_HEIGHT * clip.toScale;
        add({ kind: 'TAKEOFF', atMs: m.takeoffMs, at: clip.from, scale: clip.fromScale, facing, role: 'STEP', action: 'MANTLE' });
        add({ kind: 'GRIP', atMs: m.grabMs, untilMs: m.topMs, at: m.corner, scale: clip.toScale, facing, role: 'STEP', action: 'MANTLE', shoulder: { x: m.hang.x + facing * sup.shoulderAheadBodyHeights * bh, y: m.hang.y - sup.shoulderHeightBodyHeights * bh } });
        add({ kind: 'LANDING', atMs: m.topMs, at: clip.to, scale: clip.toScale, facing, role: 'PERCH', action: 'MANTLE' });
        return;
      }
      case 'TRACE': {
        if (m.bounds) {
          const facingOf = (from: Point, to: Point): 1 | -1 => (Math.abs(to.x - from.x) > 4 ? travelFacing(from, to) : travelFacing(clip.from, clip.to));
          const first = m.bounds[0]!;
          add({ kind: 'TAKEOFF', atMs: first.takeoffMs, at: clip.from, scale: clip.fromScale, facing: facingOf(first.from, first.to), role: 'STEP', action: 'TRACE' });
          m.bounds.forEach((b, k) => {
            const last = k === m.bounds!.length - 1;
            add({ kind: last ? 'LANDING' : 'STEP', atMs: b.contactMs, at: last ? clip.to : b.to, scale: b.toScale, facing: facingOf(b.from, b.to), role: last ? 'PERCH' : 'STEP', action: `TRACE ${b.kind}` });
          });
          return;
        }
        const facing = travelFacing(clip.from, clip.to);
        const steps = plan.events.filter((e) => e.segmentId === clip.segmentId && e.atMs >= clip.startMs && e.atMs <= clip.endMs && (e.kind === 'TAKEOFF' || e.kind === 'STEP' || e.kind === 'LANDING'));
        for (const e of steps) add({ kind: e.kind === 'TAKEOFF' ? 'TAKEOFF' : e.kind === 'STEP' ? 'STEP' : 'LANDING', atMs: e.atMs, at: e.at, scale: e.scale, facing, role: e.kind === 'LANDING' ? 'PERCH' : 'STEP', action: m.mode === 'SKIP' ? 'SKIP' : 'TRACE' });
        return;
      }
      case 'RISE':
        add({ kind: 'TAKEOFF', atMs: m.takeoffMs, at: clip.from, scale: clip.fromScale, facing: travelFacing(clip.from, clip.to), role: 'STEP', action: 'EXIT_LEAP' });
        return;
      case 'PUSH':
        add({ kind: 'BRACE', atMs: clip.startMs, untilMs: m.driveMs, at: clip.from, scale: clip.fromScale, facing: travelFacing(clip.from, clip.to), role: 'PERCH', action: 'PUSH_THROUGH' });
        return;
      case 'DROP':
        add({ kind: 'LANDING', atMs: m.contactMs, at: clip.to, scale: clip.fromScale, facing: lookFacing(clip.to, clip.lookAt), role: 'PERCH', action: 'DROP_IN' });
        return;
    }
  });
  return out;
}

const offStage = (p: Point): boolean => p.x < 0 || p.x > FRAME.width || p.y < 0 || p.y > FRAME.height;

/**
 * Judge every contact against the terrain on screen at its instant. `terrains`: each segment's terrain,
 * by id (a segment without one carries nothing). `segments`: in timeline order.
 */
export function judgeContacts(plan: MotionPlan, terrains: ReadonlyMap<string, Terrain>, segments: readonly SegmentWindow[], config: SupportConfig = plan.config.support): JudgedContact[] {
  const index = new Map(segments.map((s, i) => [s.id, i]));
  return listContacts(plan).map((c): JudgedContact => {
    if (offStage(c.at)) return { ...c, ok: true, offStage: true, terrainOf: null, stance: null, hand: null };
    const i = index.get(c.segmentId);
    const own = i === undefined ? undefined : segments[i];
    // The terrains on screen: the contact's own segment, and the outgoing one while this one transitions in.
    const visible: string[] = own ? [own.id] : [];
    if (own && i! > 0 && c.atMs < own.contentStartMs) visible.push(segments[i! - 1]!.id);
    let first: JudgedContact | null = null;
    for (const id of visible) {
      const t = terrains.get(id);
      if (!t) continue;
      const judged = c.kind === 'GRIP' ? { stance: null, hand: evaluateGrip(c.at, c.shoulder!, c.scale, t, config) } : { stance: evaluateStance({ at: c.at, scale: c.scale, facing: c.facing, role: c.role, narrowAllowed: false }, t, config), hand: null };
      const ok = (judged.hand ?? judged.stance)!.ok;
      const result: JudgedContact = { ...c, ok, offStage: false, terrainOf: id, ...judged };
      if (ok) return result;
      first ??= result;
    }
    return first ?? { ...c, ok: false, offStage: false, terrainOf: null, stance: null, hand: null };
  });
}

/** Every contact of a lesson's plan, judged against the terrain each segment declares: the render and publish gates. */
export function auditLesson(timeline: Timeline, layouts: ReadonlyMap<string, SceneLayout>, plan: MotionPlan): JudgedContact[] {
  return judgeContacts(plan, terrainsFor(timeline.segments, layouts), timeline.segments);
}

/** Fail closed: refuse a plan whose contacts the terrain cannot carry, naming each one. */
export function assertSupported(judged: readonly JudgedContact[]): void {
  const bad = judged.filter((c) => !c.ok);
  if (bad.length === 0) return;
  const describe = (c: JudgedContact): string => `${c.segmentId} ${c.kind} ${c.action} at (${Math.round(c.at.x)}, ${Math.round(c.at.y)}) t=${Math.round(c.atMs)}: ${c.hand?.code ?? c.stance?.code ?? 'NO_TERRAIN'} (${c.hand?.reason ?? c.stance?.reason ?? 'no terrain is drawn in this segment'})`;
  throw new MotionPlanError(`UNSUPPORTED_CONTACT: ${bad.length} contact(s) the terrain cannot carry: ${bad.slice(0, 6).map(describe).join('; ')}`);
}
