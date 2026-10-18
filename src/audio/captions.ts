// Captions are generated from the same narration source that drives the voice,
// split into readable cues (two rows, ~42 chars), and timed proportionally to
// characters within each line. They ship as a sidecar file. Isomorphic.

import type { PronunciationLexicon } from '../config/types.ts';
import { IssueCollector } from '../core/issues.ts';
import type { VideoSpec } from '../spec/types.ts';
import type { Timeline } from '../timeline/timeline.ts';
import { aliasLeaks } from './pronunciation.ts';

export interface CaptionCue {
  index: number;
  lineId: string;
  startMs: number;
  endMs: number;
  /** One or two rows. */
  rows: string[];
}

const ROW_CHARS = 42;
const MAX_ROWS = 2;

function greedyRows(words: string[]): string[] {
  const rows: string[] = [];
  let row = '';
  for (const w of words) {
    const candidate = row ? `${row} ${w}` : w;
    if (row && candidate.length > ROW_CHARS) {
      rows.push(row);
      row = w;
    } else row = candidate;
  }
  if (row) rows.push(row);
  return rows;
}

/** Two rows of similar length (when two are needed), each within the row limit. */
function balancedRows(words: string[]): string[] {
  const greedy = greedyRows(words);
  if (greedy.length !== 2) return greedy;
  let best = greedy;
  let bestMax = Math.max(...greedy.map((r) => r.length));
  for (let i = 1; i < words.length; i++) {
    const rows = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
    const max = Math.max(rows[0]!.length, rows[1]!.length);
    if (max <= ROW_CHARS && max < bestMax) {
      best = rows;
      bestMax = max;
    }
  }
  return best;
}

/**
 * Split a line into cues of at most two rows, spreading words evenly across
 * cues so a long line never ends on a one-word orphan cue.
 */
function rowsFor(text: string): string[][] {
  const words = text.split(/\s+/).filter(Boolean);
  const cueCount = Math.ceil(greedyRows(words).length / MAX_ROWS);
  if (cueCount <= 1) return [balancedRows(words)];
  const total = words.join(' ').length;
  const chunks: string[][] = [];
  let chunk: string[] = [];
  let used = 0;
  for (const w of words) {
    chunk.push(w);
    used += w.length + 1;
    const target = (total * (chunks.length + 1)) / cueCount;
    // Prefer a clause boundary near the balance point; otherwise cut a little past it.
    const atClause = /[,:;.?!—]$/.test(w) && used >= target * 0.75;
    if (chunks.length < cueCount - 1 && (atClause || used >= target + 12)) {
      chunks.push(chunk);
      chunk = [];
    }
  }
  if (chunk.length) chunks.push(chunk);
  const balanced = chunks.map(balancedRows);
  if (balanced.some((rows) => rows.length > MAX_ROWS)) {
    // Fall back to plain packing if balancing ever overfills a cue.
    const rows = greedyRows(words);
    const out: string[][] = [];
    for (let i = 0; i < rows.length; i += MAX_ROWS) out.push(rows.slice(i, i + MAX_ROWS));
    return out;
  }
  return balanced;
}

export function buildCaptions(timeline: Timeline): CaptionCue[] {
  const cues: CaptionCue[] = [];
  for (const seg of timeline.segments) {
    for (const line of seg.lines) {
      const chunks = rowsFor(line.text);
      const totalChars = chunks.reduce((n, c) => n + c.join(' ').length, 0) || 1;
      let t = line.startMs;
      chunks.forEach((rows, i) => {
        const share = rows.join(' ').length / totalChars;
        const end = i === chunks.length - 1 ? line.endMs : Math.round(t + (line.endMs - line.startMs) * share);
        cues.push({ index: cues.length + 1, lineId: line.id, startMs: t, endMs: end, rows });
        t = end;
      });
    }
  }
  return cues;
}

function stamp(ms: number, sep: '.' | ','): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const r = ms % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)}${sep}${p(r, 3)}`;
}

export function toWebVtt(cues: CaptionCue[]): string {
  const body = cues.map((c) => `${c.index}\n${stamp(c.startMs, '.')} --> ${stamp(c.endMs, '.')}\n${c.rows.join('\n')}`).join('\n\n');
  return `WEBVTT\n\n${body}\n`;
}

export function toSrt(cues: CaptionCue[]): string {
  return `${cues.map((c) => `${c.index}\n${stamp(c.startMs, ',')} --> ${stamp(c.endMs, ',')}\n${c.rows.join('\n')}`).join('\n\n')}\n`;
}

/** Media QA: captions reproduce the narration source exactly, carry no TTS aliases, and are well-timed. */
export function checkCaptions(cues: CaptionCue[], spec: VideoSpec, timeline: Timeline, lexicon: PronunciationLexicon, issues: IssueCollector): void {
  const narration = spec.segments.flatMap((s) => s.narration);
  for (const line of narration) {
    const text = cues
      .filter((c) => c.lineId === line.id)
      .map((c) => c.rows.join(' '))
      .join(' ');
    if (text !== line.text.replace(/\s+/g, ' ').trim()) issues.error('CAPTIONS_MISMATCH', `captions[${line.id}]`, `expected "${line.text}"`);
  }
  const known = new Set(narration.map((l) => l.id));
  for (const c of cues) {
    if (!known.has(c.lineId)) issues.error('CAPTIONS_MISMATCH', `captions[${c.index}]`, `cue for unknown line ${c.lineId}`);
    const leaks = aliasLeaks(c.rows.join(' '), lexicon);
    if (leaks.length) issues.error('CAPTIONS_PRONUNCIATION_LEAK', `captions[${c.index}]`, leaks.join(', '));
  }
  let prevEnd = 0;
  for (const c of cues) {
    if (c.startMs < prevEnd || c.endMs <= c.startMs || c.endMs > timeline.totalMs) {
      issues.error('CAPTIONS_TIMING', `captions[${c.index}]`, `${c.startMs}-${c.endMs}`);
    }
    prevEnd = c.endMs;
  }
}
