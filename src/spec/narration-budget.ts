// The narration budget (walletwall.narration-budget/v1): how many spoken words a video class may carry.
//
// A deterministic length and capacity contract, not quota tracking. It is derived, never authored: the class
// ceiling comes from VIDEO_CLASSES (the one table of class durations) and the planning pace from the voice
// identity (config/voice-identity.json, pacing.targetWpm), so no spec, planner, or adapter supplies its own
// limits, and a budget handed to the check must equal that derivation exactly. Every route to a voice provider
// runs the check before the provider is called, so a paid provider is never asked to speak a script longer
// than its class.
//
// regenerationReserve is capacity planning: the share of synthesis capacity held back for re-renders on top of
// one full-length script. It never raises maxWords; the spoken script is bounded by the class alone.
// Isomorphic (no Node imports).

import type { VoicePacing } from '../config/types.ts';
import { isOneOf, VIDEO_CLASS_KINDS, VIDEO_CLASSES, type VideoClassKind } from './vocabulary.ts';

export const NARRATION_BUDGET_CONTRACT = 'walletwall.narration-budget/v1';

/** Share of synthesis capacity planned for regeneration on top of one full-length script. */
export const REGENERATION_RESERVE = 0.3;

export interface NarrationBudget {
  maxDurationSeconds: number;
  targetWordsPerMinute: number;
  /** floor(maxDurationSeconds * targetWordsPerMinute / 60): the spoken words the class holds at the planning pace. */
  maxWords: number;
  regenerationReserve: number;
}

export interface NarrationBudgetCheck {
  contract: typeof NARRATION_BUDGET_CONTRACT;
  videoClass: VideoClassKind;
  wordCount: number;
  maxWords: number;
  estimatedDurationSeconds: number;
  maxDurationSeconds: number;
  targetWordsPerMinute: number;
  withinBudget: boolean;
}

/** A budget, pace, or word count that is malformed or departs from the canonical policy. */
export class NarrationBudgetContractError extends Error {
  constructor(message: string) {
    super(`${NARRATION_BUDGET_CONTRACT}: ${message}`);
    this.name = 'NarrationBudgetContractError';
  }
}

/** Narration longer than its class allows, raised before any voice provider is called. */
export class NarrationBudgetError extends Error {
  readonly videoClass: VideoClassKind;
  readonly wordCount: number;
  readonly maxWords: number;
  readonly estimatedDurationSeconds: number;
  readonly maxDurationSeconds: number;

  constructor(check: NarrationBudgetCheck) {
    super(describeNarrationBudget(check));
    this.name = 'NarrationBudgetError';
    this.videoClass = check.videoClass;
    this.wordCount = check.wordCount;
    this.maxWords = check.maxWords;
    this.estimatedDurationSeconds = check.estimatedDurationSeconds;
    this.maxDurationSeconds = check.maxDurationSeconds;
  }
}

const FIELDS = ['maxDurationSeconds', 'targetWordsPerMinute', 'maxWords', 'regenerationReserve'] as const;

function planningPace(targetWpm: unknown): number {
  if (typeof targetWpm !== 'number' || !Number.isFinite(targetWpm) || targetWpm <= 0) throw new NarrationBudgetContractError(`the planning pace must be a positive number of words per minute, not ${String(targetWpm)}`);
  return targetWpm;
}

/** Seconds a script takes at the planning pace: wordCount / targetWpm * 60. */
export function estimatedDurationSeconds(wordCount: number, targetWpm: number): number {
  return (wordCount / planningPace(targetWpm)) * 60;
}

/** Whole words a duration holds at a pace, rounded down so the cap never exceeds the duration. */
export function maxWordsFor(maxDurationSeconds: number, targetWpm: number): number {
  return Math.floor((maxDurationSeconds * planningPace(targetWpm)) / 60);
}

/** The canonical budget of a class at the voice identity's planning pace. */
export function narrationBudgetFor(videoClass: VideoClassKind, pacing: Pick<VoicePacing, 'targetWpm'>): NarrationBudget {
  if (!isOneOf(VIDEO_CLASS_KINDS, videoClass)) throw new NarrationBudgetContractError(`unknown video class ${JSON.stringify(videoClass)}`);
  const maxDurationSeconds = VIDEO_CLASSES[videoClass].maxSeconds;
  const targetWordsPerMinute = planningPace(pacing.targetWpm);
  return Object.freeze({ maxDurationSeconds, targetWordsPerMinute, maxWords: maxWordsFor(maxDurationSeconds, targetWordsPerMinute), regenerationReserve: REGENERATION_RESERVE });
}

/**
 * Accept a budget only when it is exactly the canonical one for its class: the four fields and nothing else,
 * finite and in range, maxWords following from duration and pace, and every value the policy's. A hand-built,
 * stale, or planner-authored copy fails closed instead of widening the cap.
 */
export function validateNarrationBudget(value: unknown, videoClass: VideoClassKind, pacing: Pick<VoicePacing, 'targetWpm'>): NarrationBudget {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new NarrationBudgetContractError('a budget must be an object');
  const given = value as Record<string, unknown>;
  for (const key of Object.keys(given)) if (!(FIELDS as readonly string[]).includes(key)) throw new NarrationBudgetContractError(`unknown budget field ${JSON.stringify(key)}`);
  const n: Record<(typeof FIELDS)[number], number> = { maxDurationSeconds: 0, targetWordsPerMinute: 0, maxWords: 0, regenerationReserve: 0 };
  for (const key of FIELDS) {
    if (!Object.hasOwn(given, key)) throw new NarrationBudgetContractError(`missing budget field ${key}`);
    const v = given[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new NarrationBudgetContractError(`${key} must be a finite number`);
    n[key] = v;
  }
  if (n.maxDurationSeconds <= 0) throw new NarrationBudgetContractError('maxDurationSeconds must be positive');
  if (n.targetWordsPerMinute <= 0) throw new NarrationBudgetContractError('targetWordsPerMinute must be positive');
  if (!Number.isInteger(n.maxWords) || n.maxWords < 0) throw new NarrationBudgetContractError('maxWords must be a whole, non-negative number');
  if (n.regenerationReserve < 0 || n.regenerationReserve >= 1) throw new NarrationBudgetContractError('regenerationReserve must be at least 0 and below 1');
  const derived = maxWordsFor(n.maxDurationSeconds, n.targetWordsPerMinute);
  if (n.maxWords !== derived) throw new NarrationBudgetContractError(`maxWords ${n.maxWords} does not follow from ${n.maxDurationSeconds} s at ${n.targetWordsPerMinute} wpm (${derived}); the reserve never raises it`);
  const canonical = narrationBudgetFor(videoClass, pacing);
  for (const key of FIELDS) {
    if (n[key] !== canonical[key]) throw new NarrationBudgetContractError(`${key} ${n[key]} is not the ${videoClass} policy (${canonical[key]})`);
  }
  return canonical;
}

/** Measure a script's spoken words against a budget; the budget is validated first. */
export function checkNarrationBudget(videoClass: VideoClassKind, wordCount: number, budget: NarrationBudget, pacing: Pick<VoicePacing, 'targetWpm'>): NarrationBudgetCheck {
  const b = validateNarrationBudget(budget, videoClass, pacing);
  if (!Number.isInteger(wordCount) || wordCount < 0) throw new NarrationBudgetContractError(`a word count must be a whole, non-negative number, not ${String(wordCount)}`);
  return {
    contract: NARRATION_BUDGET_CONTRACT,
    videoClass,
    wordCount,
    maxWords: b.maxWords,
    estimatedDurationSeconds: estimatedDurationSeconds(wordCount, b.targetWordsPerMinute),
    maxDurationSeconds: b.maxDurationSeconds,
    targetWordsPerMinute: b.targetWordsPerMinute,
    withinBudget: wordCount <= b.maxWords,
  };
}

/** The gate in front of every voice provider: returns the check when the script fits, throws when it does not. */
export function assertNarrationWithinBudget(videoClass: VideoClassKind, wordCount: number, budget: NarrationBudget, pacing: Pick<VoicePacing, 'targetWpm'>): NarrationBudgetCheck {
  const check = checkNarrationBudget(videoClass, wordCount, budget, pacing);
  if (!check.withinBudget) throw new NarrationBudgetError(check);
  return check;
}

export function describeNarrationBudget(c: NarrationBudgetCheck): string {
  const facts = `${c.wordCount} spoken words ${c.withinBudget ? '<=' : '>'} ${c.maxWords} (about ${c.estimatedDurationSeconds.toFixed(1)} s at ${c.targetWordsPerMinute} wpm, class ceiling ${c.maxDurationSeconds} s)`;
  return c.withinBudget ? `${c.videoClass} narration within budget: ${facts}` : `${c.videoClass} narration over budget: ${facts}; cut the script, never speed it up`;
}
