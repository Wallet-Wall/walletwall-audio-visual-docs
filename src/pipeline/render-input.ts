// Node-side preparation of everything the Remotion composition needs.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { voiceRequestFor, type VoiceProvider } from '../audio/voice-provider.ts';
import { DIST_ROOT, readJson } from '../config/load.ts';
import { readWorkspaceFile, resolveWorkspacePath } from './context.ts';
import type { PipelineConfig } from '../config/types.ts';
import { sha256Hex } from '../core/hash.ts';
import type { DocsVideoProps, ReviewOverlays } from '../remotion/props.ts';
import type { NormalizedSource } from '../source/types.ts';
import type { VideoSpec } from '../spec/types.ts';
import type { NarrationTrack } from '../timeline/timeline.ts';

export const PUBLIC_DIR = path.join(DIST_ROOT, 'public');

/**
 * Stage ONLY the assets the spec declares, after re-verifying each hash, into
 * the bundle's public dir. Anything not declared in the spec cannot be shown.
 */
export function stageDeclaredAssets(spec: VideoSpec): string[] {
  const staged: string[] = [];
  for (const asset of spec.assets) {
    const bytes = readWorkspaceFile(asset.path);
    if (!bytes) throw new Error(`asset ${asset.id}: path ${JSON.stringify(asset.path)} is not a workspace file`);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(asset.id)) throw new Error(`asset id ${JSON.stringify(asset.id)} is not a plain slug`);
    const actual = sha256Hex(bytes);
    if (actual !== asset.sha256) throw new Error(`asset ${asset.id} (${asset.path}) hash ${actual} != declared ${asset.sha256}`);
    const dest = path.join(PUBLIC_DIR, spec.id, `${asset.id}${path.extname(asset.path)}`);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, bytes);
    staged.push(dest);
  }
  return staged;
}

export function loadSnapshot(spec: VideoSpec): NormalizedSource {
  const file = resolveWorkspacePath(spec.source.snapshotPath);
  if (!file) throw new Error(`snapshot path ${JSON.stringify(spec.source.snapshotPath)} is not a safe workspace path`);
  return readJson<NormalizedSource>(file);
}

export async function synthesize(spec: VideoSpec, provider: VoiceProvider, config: PipelineConfig): Promise<NarrationTrack> {
  return provider.synthesize(voiceRequestFor(spec, config.voice, config.lexicon));
}

export function buildProps(spec: VideoSpec, source: NormalizedSource, track: NarrationTrack, config: PipelineConfig, overlays: ReviewOverlays): DocsVideoProps {
  return {
    spec,
    track,
    headings: Object.fromEntries(source.sections.map((s) => [s.id, s.heading])),
    docTitle: source.title,
    templates: config.templates,
    overlays,
    provenance: { blob: spec.source.blob, contentHash: spec.source.contentHash },
  };
}
