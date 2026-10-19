// The Node side of attention direction: reads config/attention.json. Everything else (the
// grammar, the schedule, the sampling, the types) is in ./direction.ts, which the Remotion
// bundle imports too. Node-only.

import path from 'node:path';
import { readJson, VIDEO_ROOT } from '../config/load.ts';
import { ATTENTION_CONFIG_REL, resolveAttentionConfig, type AttentionConfig } from './direction.ts';

export * from './direction.ts';

export function loadAttentionConfig(): AttentionConfig {
  return resolveAttentionConfig(readJson<unknown>(path.join(VIDEO_ROOT, ATTENTION_CONFIG_REL)));
}
