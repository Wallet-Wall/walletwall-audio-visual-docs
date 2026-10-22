// Semantic audio cue sheet.
//
// Sound is part of the meaning, not decoration: each cue names WHY it plays
// (an action, a transition, or an explicit semantic event in the spec). The
// renderer resolves cue -> versioned asset; an unassigned asset is silence.
// Isomorphic.

import type { MotionEvent } from '../character/walletwallaby/motion.ts';
import type { SonicIdentityConfig } from '../config/types.ts';
import type { WallabyAction } from '../spec/vocabulary.ts';
import type { Timeline } from '../timeline/timeline.ts';

export interface SonicCueEntry {
  event: string;
  atMs: number;
  reason: 'ACTION' | 'TRANSITION' | 'EXPLICIT' | 'CONTACT';
  segmentId: string;
  /** Versioned asset id, or null = silence (not yet produced). */
  asset: string | null;
  gainDb: number;
}

export interface CueSheet {
  /** The sonic identity's ident asset (config/sonic-identity.json). No segment schedules it since the ident scene was retired. */
  identAsset: string | null;
  musicBed: { id: string | null; asset: string | null; duckUnderNarrationDb: number | null };
  cues: SonicCueEntry[];
  /** Cues dropped by the per-event minimum gap (kept for review transparency). */
  suppressed: SonicCueEntry[];
}

/** The renderer's audio grammar. Actions without an entry are deliberately silent (e.g. INSPECT). */
export const ACTION_SONICS: Partial<Record<WallabyAction, string>> = {
  LAND: 'LANDING',
  HOP: 'LANDING',
  REVEAL: 'NODE_REVEAL',
  TRACE: 'ROUTE_TRACE',
  RESOLVE: 'RESOLVED',
  PUSH_THROUGH: 'DIMENSION_SHIFT',
  DIMENSION_JUMP: 'DIMENSION_SHIFT',
};

/**
 * Physical contact is sound too, owned by the renderer (never by the planner):
 * takeoff and landing are timed to the motion plan's actual contacts. Steps
 * within a trace and small weight shifts stay silent: no constant patter.
 */
export const CONTACT_SONICS: Partial<Record<MotionEvent['kind'], string>> = {
  TAKEOFF: 'TAKEOFF',
  LANDING: 'LANDING',
  PUSH: 'PUSH_CONTACT',
};

export function buildCueSheet(timeline: Timeline, sonic: SonicIdentityConfig, musicBedId: string | null, contacts?: readonly MotionEvent[]): CueSheet {
  // The sonic ident sounded with the ident scene, which the lesson no longer has: an assigned ident asset would be named in
  // provenance yet never play, so it is refused until the owner decides where it sounds.
  if (sonic.ident.asset !== null) throw new Error(`the sonic ident ${JSON.stringify(sonic.ident.asset)} has no cue to play it since the ident scene was retired: decide where it sounds before assigning its asset`);
  const raw: Omit<SonicCueEntry, 'asset' | 'gainDb'>[] = [];
  for (const seg of timeline.segments) {
    for (const b of seg.beats) {
      const event = ACTION_SONICS[b.beat.action];
      // With a motion plan, landings are placed at the real contact instead of the beat start.
      if (event && !(contacts && event === 'LANDING')) raw.push({ event, atMs: b.startMs, reason: 'ACTION', segmentId: seg.id });
    }
    for (const c of seg.sonic) raw.push({ event: c.event, atMs: c.atMs, reason: 'EXPLICIT', segmentId: seg.id });
  }
  for (const e of contacts ?? []) {
    const event = CONTACT_SONICS[e.kind];
    if (event) raw.push({ event, atMs: Math.round(e.atMs), reason: 'CONTACT', segmentId: e.segmentId });
  }
  // Codepoint order, never locale order: the cue sheet must be identical on every machine.
  raw.sort((a, b) => a.atMs - b.atMs || (a.event < b.event ? -1 : a.event > b.event ? 1 : 0));

  const lastAt = new Map<string, number>();
  const cues: SonicCueEntry[] = [];
  const suppressed: SonicCueEntry[] = [];
  for (const r of raw) {
    const cfg = sonic.events[r.event];
    const entry: SonicCueEntry = {
      ...r,
      asset: cfg?.asset ?? null,
      gainDb: cfg?.maxGainDb ?? -18,
    };
    const prev = lastAt.get(r.event);
    if (cfg && prev !== undefined && r.atMs - prev < cfg.minGapMs) {
      suppressed.push(entry);
      continue;
    }
    lastAt.set(r.event, r.atMs);
    cues.push(entry);
  }
  const bed = musicBedId ? sonic.musicBeds[musicBedId] : undefined;
  return {
    identAsset: sonic.ident.asset,
    musicBed: { id: musicBedId, asset: bed?.asset ?? null, duckUnderNarrationDb: bed?.duckUnderNarrationDb ?? null },
    cues,
    suppressed,
  };
}
