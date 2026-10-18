// Node-only content addressing. Kept out of the isomorphic modules so the
// Remotion bundle never pulls in node:crypto.

import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical-json.ts';

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** sha256 of the canonical JSON form of a value. */
export function contentAddress(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
