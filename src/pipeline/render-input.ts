// Node-side preparation of everything the Remotion composition needs.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { voiceRequestFor, type VoiceProvider } from '../audio/voice-provider.ts';
import { RIVE_ASSET, RIVE_RUNTIME } from '../character/walletwallaby/versions.ts';
import { DIST_ROOT, readJson, VIDEO_ROOT } from '../config/load.ts';
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

/**
 * Stage the renderer's own pinned dependencies (the compiled WalletWallaby rig
 * and the Rive runtime's WASM) under renderer/ in the bundle's public dir.
 * They are code, not spec content: each is re-hashed against its pin and the
 * render fails closed on any mismatch, so the bytes Remotion draws with are
 * exactly the bytes provenance records.
 */
export function stageRendererAssets(): string[] {
  const pkg = readJson<{ version: string }>(path.join(VIDEO_ROOT, 'node_modules', ...RIVE_RUNTIME.package.split('/'), 'package.json'));
  if (pkg.version !== RIVE_RUNTIME.version) throw new Error(`${RIVE_RUNTIME.package} ${pkg.version} is installed; the renderer is pinned to ${RIVE_RUNTIME.version}`);
  const items = [
    { from: path.join(VIDEO_ROOT, ...RIVE_ASSET.path.split('/')), to: RIVE_ASSET.public, sha256: RIVE_ASSET.sha256 },
    { from: path.join(VIDEO_ROOT, 'node_modules', ...RIVE_RUNTIME.package.split('/'), RIVE_RUNTIME.wasm), to: RIVE_RUNTIME.public, sha256: RIVE_RUNTIME.wasmSha256 },
  ];
  return items.map((item) => {
    const bytes = verifyPinned(readFileSync(item.from), item.sha256, path.relative(VIDEO_ROOT, item.from));
    const dest = path.join(PUBLIC_DIR, ...item.to.split('/'));
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, bytes);
    return dest;
  });
}

/** The bytes, if they are exactly the pinned ones; otherwise a refusal naming both hashes. */
export function verifyPinned(bytes: Uint8Array, pinned: string, what: string): Uint8Array {
  const actual = sha256Hex(bytes);
  if (actual !== pinned) throw new Error(`renderer asset ${what} hash ${actual} != pinned ${pinned}`);
  return bytes;
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
