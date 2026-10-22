// Node-side preparation of everything the Remotion composition needs.

import { mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadAttentionConfig } from '../attention/config.ts';
import { requestSpokenWords, voiceRequestFor, type VoiceProvider } from '../audio/voice-provider.ts';
import { loadVisualConfig } from '../blender/visual.ts';
import { DIST_ROOT, readJson } from '../config/load.ts';
import { readWorkspaceFile, resolveWorkspacePath } from './context.ts';
import type { PipelineConfig } from '../config/types.ts';
import { readContainedFile } from '../core/contained-read.ts';
import { isLineId } from '../narration/publication.ts';
import { sha256Hex } from '../core/hash.ts';
import type { DocsVideoProps, ReviewOverlays } from '../remotion/props.ts';
import type { NormalizedSource } from '../source/types.ts';
import { assertNarrationWithinBudget, narrationBudgetFor } from '../spec/narration-budget.ts';
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

/**
 * Stage the narration audio the track names (publication narration only; the fixture voice is silent) into the bundle's
 * public dir, where the composition plays it (src/timeline/timeline.ts narrationAudio). Each WAV is read from the
 * verified narration set's directory through one handle, never a link, and must be the bytes the track names. The
 * staged names come from line ids, never from a record. Returns the staged files.
 */
export function stageNarrationAudio(spec: VideoSpec, track: NarrationTrack, setDir: string): string[] {
  const dest = path.join(PUBLIC_DIR, spec.id, 'narration');
  rmSync(dest, { recursive: true, force: true });
  const voiced = track.lines.filter((l) => l.audio);
  if (voiced.length === 0) return [];
  if (!track.publication) throw new Error('a track with audio must carry its publication narration identity');
  const realDir = realpathSync(setDir);
  mkdirSync(dest, { recursive: true });
  return voiced.map((line) => {
    if (!isLineId(line.lineId)) throw new Error(`narration line id ${JSON.stringify(line.lineId)} is not a plain id`);
    const name = `${line.lineId}.wav`;
    const bytes = readContainedFile(path.join(realDir, name), (real) => real === path.join(realDir, name));
    if (!bytes || sha256Hex(bytes) !== line.audio!.sha256) throw new Error(`narration audio for ${line.lineId} is missing or is not the bytes the verified set names; re-run the narration step`);
    const file = path.join(dest, name);
    writeFileSync(file, bytes);
    return file;
  });
}

export function loadSnapshot(spec: VideoSpec): NormalizedSource {
  const file = resolveWorkspacePath(spec.source.snapshotPath);
  if (!file) throw new Error(`snapshot path ${JSON.stringify(spec.source.snapshotPath)} is not a safe workspace path`);
  return readJson<NormalizedSource>(file);
}

/**
 * The render path's one route to a voice provider. The narration budget is checked here, before the provider
 * is called, so a paid provider is never asked to speak a script longer than its class (fail closed, any provider).
 */
export async function synthesize(spec: VideoSpec, provider: VoiceProvider, config: PipelineConfig): Promise<NarrationTrack> {
  const request = voiceRequestFor(spec, config.voice, config.lexicon);
  assertNarrationWithinBudget(spec.videoClass, requestSpokenWords(request), narrationBudgetFor(spec.videoClass, config.voice.pacing), config.voice.pacing);
  return provider.synthesize(request);
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
    material: loadVisualConfig(),
    direction: loadAttentionConfig(),
  };
}
