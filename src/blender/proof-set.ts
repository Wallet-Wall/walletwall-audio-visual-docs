// The representative proof set: ten lesson frames, chosen by fixed rules from the lesson's own bridge (never by
// hand), covering every body state and the signature transition. CI renders exactly these; the production render
// host renders them too, as the cross-class references. Node-only.

import type { BlenderMotionDocument, BlenderMotionFrame } from '../character/walletwallaby/blender/bridge.ts';
import { characterCrop } from '../character/walletwallaby/blender/crop.ts';
import { RIG_ENVELOPE } from '../character/walletwallaby/rig/rig-source.ts';

export const PROOF_ROLES = ['idle', 'crouch', 'airborne', 'landing', 'perch', 'inspect', 'tail-brace', 'transition-entry', 'transition-peak', 'transition-exit'] as const;
export type ProofRole = (typeof PROOF_ROLES)[number];

const w = (f: BlenderMotionFrame, clip: string): number => (f.pose.clips as Record<string, number>)[clip] ?? 0;

/** A frame whose crop lies wholly inside the frame (no clamped edge), so the proof covers the full envelope check. */
const interior = (f: BlenderMotionFrame, padPx: number): boolean => {
  const c = characterCrop(f, RIG_ENVELOPE, padPx, { width: 1920, height: 1080 });
  return c !== null && c.x > 0 && c.y > 0 && c.x + c.width < 1920 && c.y + c.height < 1080;
};

/** The character roles: for each, the first lesson frame meeting its rule, in lesson order (deterministic). */
export function characterProofFrames(bridge: BlenderMotionDocument, padPx: number, exclude: { first: number; last: number }): Record<Exclude<ProofRole, `transition-${string}`>, number> {
  const usable = bridge.frames.filter((f) => f.visible && !f.semantic.offStage && interior(f, padPx) && (f.frame < exclude.first || f.frame > exclude.last));
  const pick = (role: string, rule: (f: BlenderMotionFrame) => boolean, score: (f: BlenderMotionFrame) => number = () => 0): number => {
    const hits = usable.filter(rule);
    if (hits.length === 0) throw new Error(`the lesson has no frame for the proof role ${role}`);
    // Highest score wins; the earliest frame breaks ties.
    return hits.reduce((best, f) => (score(f) > score(best) ? f : best)).frame;
  };
  return {
    idle: pick('idle', (f) => f.semantic.action === 'IDLE' && f.semantic.phase === 'HOLD' && w(f, 'idle_alert') > 0.99),
    crouch: pick('crouch', (f) => f.semantic.phase === 'PRELOAD', (f) => w(f, 'crouch_preload')),
    airborne: pick('airborne', (f) => f.semantic.contact === 'NONE' && f.semantic.phase === 'FLIGHT', (f) => w(f, 'airborne')),
    landing: pick('landing', (f) => f.semantic.phase === 'CONTACT' && f.semantic.landingImpulse > 0.15 && f.semantic.landingImpulse < 0.6, (f) => w(f, 'land_soft')),
    perch: pick('perch', (f) => f.semantic.phase === 'HOLD' && w(f, 'perch') > 0.99),
    inspect: pick('inspect', (f) => f.semantic.action === 'INSPECT' && f.semantic.phase === 'HOLD' && w(f, 'inspect') > 0.99),
    'tail-brace': pick('tail-brace', (f) => f.semantic.contact !== 'NONE' && f.semantic.landingImpulse > 0.9, (f) => w(f, 'land_hard')),
  };
}

/** The transition roles: the reveal's first frame (flat), its deepest frame (the camera's bump peaks), and its last. */
export function transitionProofFrames(range: { first: number; last: number }, flatAgain: number, revealBy: number, settleFrom: number): Record<Extract<ProofRole, `transition-${string}`>, number> {
  // The bump is 1 from t = revealBy until t = settleFrom; its first full frame is the peak.
  const span = flatAgain - range.first;
  const peak = range.first + Math.ceil(revealBy * span);
  if (!(peak > range.first && peak < range.last && settleFrom > revealBy)) throw new Error('the reveal has no peak frame');
  return { 'transition-entry': range.first, 'transition-peak': peak, 'transition-exit': range.last };
}
