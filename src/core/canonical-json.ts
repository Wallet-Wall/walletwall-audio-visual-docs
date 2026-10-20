// Canonical JSON: sorted object keys, no insignificant whitespace, undefined
// members dropped. Used for every content address in the pipeline so a hash
// never depends on property insertion order or platform line endings.
//
// Isomorphic (no Node imports); hashing lives in ./hash.ts.

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      // Defined, never assigned: assigning `__proto__` (an own key JSON.parse can produce) would set the prototype and
      // drop the member from the canonical form, so content could ride along outside every content address.
      if (v !== undefined) Object.defineProperty(out, key, { value: sortDeep(v), enumerable: true, writable: true, configurable: true });
    }
    return out;
  }
  return value;
}

/** Stable, human-reviewable serialization for committed artifacts (LF, trailing newline). */
export function prettyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
