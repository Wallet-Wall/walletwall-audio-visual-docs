// Deterministic assembly: Storyboard (+ source, config, git provenance) -> VideoSpec.
//
// The assembler adds only what the planner must not decide: provenance, the
// resolved brand copy, the audio identity, the output format, and the video
// class (the shortest class the estimated runtime fits). Same inputs -> same
// bytes, which is what `npm run plan:check` relies on.

import { estimateTrack } from '../audio/voice-provider.ts';
import type { CopyTemplates, PronunciationLexicon, VoiceIdentity } from '../config/types.ts';
import type { NormalizedSource } from '../source/types.ts';
import { SPEC_SCHEMA, type NarrationLine, type Segment, type VideoSpec } from '../spec/types.ts';
import { VIDEO_CLASS_KINDS, VIDEO_CLASSES, type VideoClassKind } from '../spec/vocabulary.ts';
import { buildTimeline } from '../timeline/timeline.ts';
import { isBrandSegment, type Storyboard } from './storyboard.ts';

export interface AssembleContext {
  source: NormalizedSource;
  docUrl: string;
  blob: string;
  snapshotPath: string;
  providerId: string;
  contract: string;
  storyboardHash: string;
  templates: CopyTemplates;
  voice: VoiceIdentity;
  lexicon: PronunciationLexicon;
  sonicIdentityId: string;
  revision: number;
}

export class SplitRequiredError extends Error {
  readonly estimatedMs: number;

  constructor(estimatedMs: number) {
    super(`Estimated runtime ${Math.round(estimatedMs / 1000)} s exceeds every video class; split the material into a series.`);
    this.estimatedMs = estimatedMs;
  }
}

/** Shortest class the runtime fits; a planner request can only lengthen it. */
export function selectVideoClass(totalMs: number, requested?: VideoClassKind): VideoClassKind {
  const minimal = VIDEO_CLASS_KINDS.find((k) => VIDEO_CLASSES[k].maxSeconds * 1000 >= totalMs);
  if (!minimal) throw new SplitRequiredError(totalMs);
  if (requested && VIDEO_CLASS_KINDS.indexOf(requested) > VIDEO_CLASS_KINDS.indexOf(minimal)) return requested;
  return minimal;
}

export function templateNarration(segmentId: string, templateId: string, templates: CopyTemplates): NarrationLine[] {
  const template = templates.templates[templateId];
  if (!template?.narration) return [];
  return [{ id: `${segmentId}.line`, text: template.narration, role: 'TEMPLATE', claimIds: [], templateId }];
}

export function assembleSpec(storyboard: Storyboard, ctx: AssembleContext): VideoSpec {
  const segments: Segment[] = storyboard.segments.map((s): Segment => {
    if (isBrandSegment(s)) {
      return {
        id: s.id,
        role: s.role,
        transitionIn: s.transitionIn,
        narration: templateNarration(s.id, s.templateId, ctx.templates),
        scene: null,
        templateId: s.templateId,
        wallaby: [],
        sonic: [],
      };
    }
    return {
      id: s.id,
      role: s.role,
      transitionIn: s.transitionIn,
      narration: s.narration.map((l) => ({ ...l })),
      scene: s.scene,
      wallaby: s.wallaby,
      sonic: s.sonic,
    };
  });

  const spec: VideoSpec = {
    schema: SPEC_SCHEMA,
    id: storyboard.videoId,
    revision: ctx.revision,
    locale: 'en-US',
    title: { topic: storyboard.topic },
    videoClass: 'QUICK',
    series: storyboard.series,
    source: {
      docPath: ctx.source.docPath,
      docUrl: ctx.docUrl,
      blob: ctx.blob,
      contentHash: ctx.source.hashes.content,
      normalizerVersion: ctx.source.normalizerVersion,
      snapshotPath: ctx.snapshotPath,
    },
    planner: { provider: ctx.providerId, contract: ctx.contract, storyboardHash: ctx.storyboardHash },
    claims: storyboard.claims,
    assets: storyboard.assets,
    segments,
    audio: {
      voiceIdentityId: ctx.voice.id,
      pronunciationDictionaryId: ctx.lexicon.id,
      sonicIdentityId: ctx.sonicIdentityId,
      musicBedId: storyboard.musicBedId,
    },
    output: { width: 1920, height: 1080, fps: 30, captions: 'SIDECAR' },
  };

  const timeline = buildTimeline(spec, estimateTrack(spec, ctx.voice, ctx.lexicon), ctx.templates);
  spec.videoClass = selectVideoClass(timeline.totalMs, storyboard.requestedClass);
  return spec;
}
