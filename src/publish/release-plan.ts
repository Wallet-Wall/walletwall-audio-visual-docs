// Release ordering: prerequisites first, then weighted usefulness. Never docs order.
// Deterministic Kahn topological sort with score (then id) as the tie-break. Isomorphic.

import type { ReleaseCandidate, ReleasePlanConfig } from '../config/types.ts';

export function weightedScore(c: ReleaseCandidate, weights: ReleasePlanConfig['weights']): number {
  return (Object.keys(weights) as (keyof typeof weights)[]).reduce((sum, k) => sum + weights[k] * (c.scores[k] ?? 0), 0);
}

export function planReleaseOrder(plan: ReleasePlanConfig): ReleaseCandidate[] {
  const byId = new Map(plan.candidates.map((c) => [c.videoId, c]));
  for (const c of plan.candidates) {
    for (const d of c.dependsOn) if (!byId.has(d)) throw new Error(`${c.videoId} depends on unknown ${d}`);
  }
  const remaining = new Set(byId.keys());
  const done = new Set<string>();
  const order: ReleaseCandidate[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining].map((id) => byId.get(id)!).filter((c) => c.dependsOn.every((d) => done.has(d)));
    if (ready.length === 0) throw new Error(`dependency cycle among: ${[...remaining].join(', ')}`);
    ready.sort((a, b) => weightedScore(b, plan.weights) - weightedScore(a, plan.weights) || (a.videoId < b.videoId ? -1 : a.videoId > b.videoId ? 1 : 0));
    const next = ready[0]!;
    order.push(next);
    done.add(next.videoId);
    remaining.delete(next.videoId);
  }
  return order;
}
