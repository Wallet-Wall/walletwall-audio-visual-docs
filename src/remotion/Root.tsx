// Remotion root. Studio previews the committed spec with an estimated (silent)
// narration track; `npm run render` passes real input props instead.

import React from 'react';
import { Composition, type CalculateMetadataFunction } from 'remotion';
import { estimateTrack } from '../audio/voice-provider.ts';
import type { CopyTemplates, PronunciationLexicon, VoiceIdentity } from '../config/types.ts';
import type { NormalizedSource } from '../source/types.ts';
import type { VideoSpec } from '../spec/types.ts';
import { buildTimeline, totalFrames } from '../timeline/timeline.ts';
import templatesJson from '../../config/copy-templates.json';
import lexiconJson from '../../config/pronunciation.json';
import voiceJson from '../../config/voice-identity.json';
import visualJson from '../../config/blender-visual.json';
import specJson from '../../specs/migration-readiness/spec.json';
import snapshotJson from '../../specs/migration-readiness/source.snapshot.json';
import { resolveVisual, type RawVisual } from '../blender/visual-core.ts';
import { DocsVideo } from './DocsVideo.tsx';
import type { DocsVideoProps } from './props.ts';

export const COMPOSITION_ID = 'WalletWallDocsVideo';

export function headingsOf(source: NormalizedSource): Record<string, string> {
  return Object.fromEntries(source.sections.map((s) => [s.id, s.heading]));
}

const spec = specJson as unknown as VideoSpec;
const source = snapshotJson as unknown as NormalizedSource;
const templates = templatesJson as unknown as CopyTemplates;

const defaultProps: DocsVideoProps = {
  spec,
  track: estimateTrack(spec, voiceJson as unknown as VoiceIdentity, lexiconJson as unknown as PronunciationLexicon),
  headings: headingsOf(source),
  docTitle: source.title,
  templates,
  overlays: { captions: true, characterless: false, guides: false },
  provenance: { blob: spec.source.blob, contentHash: spec.source.contentHash },
  material: resolveVisual(visualJson as unknown as RawVisual),
};

const calculateMetadata: CalculateMetadataFunction<DocsVideoProps> = ({ props }) => {
  const timeline = buildTimeline(props.spec, props.track, props.templates);
  return { durationInFrames: totalFrames(timeline), fps: props.spec.output.fps, width: props.spec.output.width, height: props.spec.output.height };
};

export const RemotionRoot: React.FC = () => (
  <Composition
    id={COMPOSITION_ID}
    component={DocsVideo}
    defaultProps={defaultProps}
    calculateMetadata={calculateMetadata}
    durationInFrames={1}
    fps={30}
    width={1920}
    height={1080}
  />
);
