// Narration continuity: speech owns conversational rhythm (src/timeline/timeline.ts). A silence between two lines is
// authored language: the sentence pause inside a segment, the section pause across a boundary, plus whatever pause the
// earlier line authors (pauseAfterMs, for emphasis or a rhetorical beat). A transition, a slide, a landing, or a settle
// never adds to it, and a visual never leaves a long silence inside a sentence. A silent brand segment between two lines
// (none in a lesson today) authors its own silence by its template's length; a silent content segment authors none, so
// the silence across it is refused. Isomorphic.

import type { VideoSpec } from '../spec/types.ts';
import { BRAND_ROLES } from '../spec/vocabulary.ts';
import { TIMING, type Timeline, type Timing } from './timeline.ts';

/** The most unauthored silence a sentence may ever hold between two of its clauses. */
export const MAX_INTRA_SENTENCE_PAUSE_MS = 800;

export interface CadenceProblem {
  code: 'UNAUTHORED_SILENCE' | 'INTRA_SENTENCE_PAUSE' | 'LINE_OUTSIDE_SEGMENT';
  /** The earlier line of the pair (null for a problem with one line). */
  from: string | null;
  to: string;
  detail: string;
}

/** A line that ends a sentence: terminal punctuation, then any closing quotes or brackets. */
export const endsSentence = (text: string): boolean => /[.!?]["')\]]*$/.test(text.trim());

/** Every place the timeline's speech departs from the script's authored cadence; an empty list is a pass. */
export function narrationCadence(spec: VideoSpec, timeline: Timeline, timing: Timing = TIMING): CadenceProblem[] {
  const authored = new Map(spec.segments.flatMap((s) => s.narration.map((l) => [l.id, l.pauseAfterMs ?? 0] as const)));
  const problems: CadenceProblem[] = [];
  let prev: { id: string; text: string; endMs: number; segment: number } | null = null;
  timeline.segments.forEach((seg, i) => {
    for (const line of seg.lines) {
      if (line.startMs < seg.startMs || line.endMs > seg.endMs) {
        problems.push({ code: 'LINE_OUTSIDE_SEGMENT', from: null, to: line.id, detail: `${line.id} (${line.startMs}-${line.endMs} ms) is not inside ${seg.id} (${seg.startMs}-${seg.endMs} ms)` });
      }
      if (prev) {
        const gap = line.startMs - prev.endMs;
        const pause = authored.get(prev.id) ?? 0;
        const sameSegment = prev.segment === i;
        // Only a brand segment's template authors a silence of its own; a silent content segment's length is its
        // transition and tail, which never decide when the next words come.
        const silent = timeline.segments.slice(prev.segment + 1, i).filter((s) => s.lines.length === 0);
        const authoredBetween = silent.length > 0 && silent.every((s) => BRAND_ROLES.has(s.role));
        if (!authoredBetween) {
          const cadence = sameSegment ? timing.linePauseMs : timing.sectionPauseMs;
          if (gap !== cadence + pause) {
            problems.push({ code: 'UNAUTHORED_SILENCE', from: prev.id, to: line.id, detail: `${gap} ms between ${prev.id} and ${line.id}; the script authors ${cadence + pause} ms (the ${sameSegment ? 'sentence' : 'section'} pause ${cadence} ms${pause ? ` + pauseAfterMs ${pause}` : ''})` });
          }
        }
        if (!endsSentence(prev.text) && gap - pause > MAX_INTRA_SENTENCE_PAUSE_MS) {
          problems.push({ code: 'INTRA_SENTENCE_PAUSE', from: prev.id, to: line.id, detail: `${gap - pause} ms of unauthored silence inside one sentence, between ${prev.id} and ${line.id} (at most ${MAX_INTRA_SENTENCE_PAUSE_MS} ms)` });
        }
      }
      prev = { id: line.id, text: line.text, endMs: line.endMs, segment: i };
    }
  });
  return problems;
}
