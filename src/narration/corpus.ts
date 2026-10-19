// The versioned narration evaluation corpus (fixtures/narration-eval/corpus.json):
// identical text for every candidate, in four classes. The corpus text is the
// display text; the synthesizer receives the spoken text (lexicon aliases
// applied), and both hashes are part of every artifact's identity. Node-only.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { toSpokenText } from '../audio/pronunciation.ts';
import { VIDEO_ROOT } from '../config/load.ts';
import type { PipelineConfig } from '../config/types.ts';
import { contentAddress, sha256Hex } from '../core/hash.ts';
import { assertPlainId, NarrationContractError, VOICE_PROFILE, type NarrationRequest } from './contract.ts';

export const CORPUS_REL = 'fixtures/narration-eval/corpus.json';
export const CORPUS_SCHEMA = 'walletwall.narration-eval-corpus/v1';
export const PASSAGE_CLASSES = ['SHORT_INSTRUCTION', 'NORMAL_EXPLANATION', 'TECHNICAL_PASSAGE', 'LONG_FORM'] as const;
export type PassageClass = (typeof PASSAGE_CLASSES)[number];

export interface CorpusPassage {
  id: string;
  class: PassageClass;
  title: string;
  /** Spoken-duration target at the identity's natural pace. */
  targetSeconds: { min: number; max: number };
  text: string;
}

export interface NarrationCorpus {
  schema: typeof CORPUS_SCHEMA;
  id: string;
  version: number;
  note: string;
  passages: CorpusPassage[];
}

const TOP_KEYS = ['schema', 'id', 'version', 'note', 'passages'];
const PASSAGE_KEYS = ['id', 'class', 'title', 'targetSeconds', 'text'];

function closed(value: unknown, keys: readonly string[], where: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new NarrationContractError(`${where}: not an object`);
  const obj = value as Record<string, unknown>;
  for (const k of Object.keys(obj)) if (!keys.includes(k)) throw new NarrationContractError(`${where}: unknown key ${JSON.stringify(k)}`);
  for (const k of keys) if (!Object.hasOwn(obj, k)) throw new NarrationContractError(`${where}: missing key ${JSON.stringify(k)}`);
  return obj;
}

/** Control characters, zero-width and bidi marks, line and paragraph separators, and the byte-order mark: never in narration text. */
export function hasInvisibleCharacters(text: string): boolean {
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c <= 8 || (c >= 11 && c <= 31) || c === 127) return true;
    if ((c >= 0x200b && c <= 0x200f) || (c >= 0x2028 && c <= 0x202f) || c === 0xfeff) return true;
  }
  return false;
}

export function parseCorpus(value: unknown): NarrationCorpus {
  const c = closed(value, TOP_KEYS, 'corpus');
  if (c.schema !== CORPUS_SCHEMA) throw new NarrationContractError(`corpus: schema must be ${CORPUS_SCHEMA}`);
  assertPlainId('corpus id', c.id);
  if (typeof c.version !== 'number' || !Number.isInteger(c.version) || c.version < 1) throw new NarrationContractError('corpus: version must be a positive integer');
  if (typeof c.note !== 'string') throw new NarrationContractError('corpus: note must be a string');
  if (!Array.isArray(c.passages) || c.passages.length === 0) throw new NarrationContractError('corpus: passages must be a non-empty array');
  const seen = new Set<string>();
  const passages = c.passages.map((p, i) => {
    const o = closed(p, PASSAGE_KEYS, `passages[${i}]`);
    const id = assertPlainId(`passages[${i}].id`, o.id);
    if (seen.has(id)) throw new NarrationContractError(`passages[${i}]: duplicate id ${id}`);
    seen.add(id);
    if (!(PASSAGE_CLASSES as readonly string[]).includes(o.class as string)) throw new NarrationContractError(`passages[${i}]: unknown class`);
    if (typeof o.title !== 'string' || !o.title.trim()) throw new NarrationContractError(`passages[${i}]: title must be a string`);
    const t = closed(o.targetSeconds, ['min', 'max'], `passages[${i}].targetSeconds`);
    if (typeof t.min !== 'number' || typeof t.max !== 'number' || t.min <= 0 || t.max < t.min) throw new NarrationContractError(`passages[${i}]: bad targetSeconds`);
    if (typeof o.text !== 'string' || !o.text.trim()) throw new NarrationContractError(`passages[${i}]: text must be a non-empty string`);
    if (o.text !== o.text.normalize('NFKC') || hasInvisibleCharacters(o.text)) throw new NarrationContractError(`passages[${i}]: text must be NFKC-stable visible text`);
    if (o.text !== o.text.trim() || /\s{2,}/.test(o.text)) throw new NarrationContractError(`passages[${i}]: text must be single-spaced and trimmed`);
    return { id, class: o.class as PassageClass, title: o.title, targetSeconds: { min: t.min, max: t.max }, text: o.text };
  });
  return { schema: CORPUS_SCHEMA, id: c.id as string, version: c.version, note: c.note, passages };
}

export function loadCorpus(videoRoot: string = VIDEO_ROOT): NarrationCorpus {
  return parseCorpus(JSON.parse(readFileSync(path.join(videoRoot, ...CORPUS_REL.split('/')), 'utf8')));
}

/** The corpus content address: what every bakeoff result is bound to. */
export const corpusSha256 = (corpus: NarrationCorpus): string => contentAddress(corpus);

export function textHashes(displayText: string, spokenText: string): { displaySha256: string; spokenSha256: string } {
  return { displaySha256: sha256Hex(displayText), spokenSha256: sha256Hex(spokenText) };
}

export function passageRequest(passage: CorpusPassage, config: PipelineConfig): NarrationRequest {
  return {
    passageId: passage.id,
    displayText: passage.text,
    spokenText: toSpokenText(passage.text, config.lexicon),
    language: 'en-US',
    voiceProfile: VOICE_PROFILE,
    identity: config.voice,
  };
}
