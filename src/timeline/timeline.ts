// Renderer-neutral timeline: VideoSpec + narration durations -> absolute times.
//
// Timing is derived, never authored: the planner orders lines and cues; the
// narration track (a real voice render, or a deterministic estimate) supplies
// durations; this module lays everything end to end in integer milliseconds.
// Renderers convert ms to frames at the very edge. Isomorphic.

import type { CopyTemplates } from '../config/types.ts';
import type { Segment, TransitionSpec, VideoSpec, WallabyBeat } from '../spec/types.ts';
import type { SceneSpec } from '../spec/types.ts';

export interface NarrationLineTiming {
  lineId: string;
  durationMs: number;
  /** Rendered audio for this line; null for estimate-only (silent) tracks. */
  audio: { path: string; sha256: string } | null;
}

export interface NarrationTrack {
  providerId: string;
  voiceIdentityId: string;
  /** True for synthesized speech (drives the synthetic-media disclosure). */
  synthetic: boolean;
  /** True when durations are estimates and no audio exists (fixture / dry run). */
  estimated: boolean;
  lines: NarrationLineTiming[];
}

export const TIMING = {
  leadInMs: 450,
  linePauseMs: 350,
  tailMs: 800,
  transitionMs: { CUT: 350, SECTION_SHIFT: 950, DEPTH_ENTER: 1700, DEPTH_EXIT: 1200 } satisfies Record<TransitionSpec['type'], number>,
  /** Brand segments with narration but no fixed duration get this much air around the line. */
  brandPadMs: 900,
} as const;

/** Exit actions are scheduled to finish exactly when their segment ends. */
export const EXIT_ACTIONS = new Set<WallabyBeat['action']>(['PUSH_THROUGH', 'DIMENSION_JUMP']);

export interface TimedLine {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
}

export interface TimedBeat {
  index: number;
  beat: WallabyBeat;
  startMs: number;
}

export interface TimedSonicCue {
  event: string;
  atMs: number;
}

export interface TimedSegment {
  id: string;
  role: Segment['role'];
  scene: SceneSpec | null;
  templateId: string | undefined;
  transitionIn: TransitionSpec;
  startMs: number;
  /** End of the transition window; the scene is fully on screen from here. */
  contentStartMs: number;
  endMs: number;
  lines: TimedLine[];
  beats: TimedBeat[];
  /** Visual element id -> absolute ms at which it appears. */
  reveals: Record<string, number>;
  sonic: TimedSonicCue[];
}

export interface Timeline {
  fps: number;
  totalMs: number;
  segments: TimedSegment[];
}

export function buildTimeline(spec: VideoSpec, track: NarrationTrack, templates: CopyTemplates): Timeline {
  const durations = new Map(track.lines.map((l) => [l.lineId, l.durationMs]));
  const segments: TimedSegment[] = [];
  let cursor = 0;
  spec.segments.forEach((seg, index) => {
    // The very first segment has no predecessor to transition from.
    const transitionMs = index === 0 ? 0 : TIMING.transitionMs[seg.transitionIn.type];
    const startMs = cursor;
    const contentStartMs = startMs + transitionMs;
    const template = seg.templateId ? templates.templates[seg.templateId] : undefined;
    const lines: TimedLine[] = [];
    let t = contentStartMs + (seg.narration.length > 0 ? TIMING.leadInMs : 0);
    for (const line of seg.narration) {
      const d = durations.get(line.id) ?? 0;
      lines.push({ id: line.id, text: line.text, startMs: t, endMs: t + d });
      t += d + TIMING.linePauseMs + (line.pauseAfterMs ?? 0);
    }
    let endMs: number;
    if (template?.durationMs != null) {
      endMs = contentStartMs + Math.max(template.durationMs, t - contentStartMs);
    } else if (template) {
      endMs = t - TIMING.linePauseMs + TIMING.brandPadMs;
    } else {
      endMs = (lines.length ? t - TIMING.linePauseMs : contentStartMs) + TIMING.tailMs;
    }
    const lineStart = new Map(lines.map((l) => [l.id, l.startMs]));
    const beats: TimedBeat[] = seg.wallaby.map((beat, i) => ({
      index: i,
      beat,
      startMs: (lineStart.get(beat.cue) ?? contentStartMs) + (beat.delayMs ?? 0),
    }));
    const reveals: Record<string, number> = {};
    if (seg.scene) {
      for (const el of visualElements(seg.scene)) {
        reveals[el.id] = el.revealCue ? (lineStart.get(el.revealCue) ?? contentStartMs) : contentStartMs;
      }
    }
    const sonic = seg.sonic.map((c) => ({ event: c.event, atMs: (lineStart.get(c.cue) ?? contentStartMs) + (c.delayMs ?? 0) }));
    segments.push({
      id: seg.id,
      role: seg.role,
      scene: seg.scene,
      templateId: seg.templateId,
      transitionIn: seg.transitionIn,
      startMs,
      contentStartMs,
      endMs,
      lines,
      beats,
      reveals,
      sonic,
    });
    cursor = endMs;
  });
  return { fps: spec.output.fps, totalMs: cursor, segments };
}

export interface VisualElementRef {
  id: string;
  revealCue?: string;
}

/** Every revealable element of a scene, including graph edges (id `edge:<from>-><to>`). */
export function visualElements(scene: SceneSpec): VisualElementRef[] {
  switch (scene.type) {
    case 'CARD':
      return [scene.heading, ...scene.body];
    case 'GRAPH':
      return [
        ...(scene.caption ? [scene.caption] : []),
        ...scene.nodes.flatMap((n) => [n, ...(n.detail ? [{ id: n.detail.id, revealCue: n.detail.revealCue ?? n.revealCue }] : [])]),
        ...scene.edges.map((e) => ({ id: `edge:${e.from}->${e.to}`, ...(e.revealCue ? { revealCue: e.revealCue } : {}) })),
      ];
    case 'UI':
      return [scene.caption, { id: 'ui:capture' }];
    case 'TAKEAWAY':
      return [scene.statement, ...scene.support];
  }
}

export function msToFrame(ms: number, fps: number): number {
  return Math.round((ms * fps) / 1000);
}

export function totalFrames(timeline: Timeline): number {
  return Math.max(1, msToFrame(timeline.totalMs, timeline.fps));
}
