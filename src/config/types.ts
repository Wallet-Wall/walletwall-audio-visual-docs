// Typed views of the version-controlled configuration in config/.
// Isomorphic: the Remotion bundle imports the JSON directly; Node loads it via ./load.ts.

import type { SourceDomain } from '../source/types.ts';
import type { SegmentRole } from '../spec/vocabulary.ts';

export interface CopyTemplate {
  role: SegmentRole;
  narration: string | null;
  onScreen: string;
  durationMs: number | null;
}

export interface CopyTemplates {
  schema: 'walletwall.copy-templates/v2';
  templates: Record<string, CopyTemplate>;
  /** The quiet fixed footer's wordmark (src/layout/footer.ts): drawn on every frame the footer shows, never by a segment. */
  footer: { id: string; note?: string; onScreen: string };
}

export interface CopyPolicy {
  schema: 'walletwall.copy-policy/v1';
  forbiddenPhrases: { pattern: string; reason: string }[];
  callToActionPattern: string;
  interpretationMarkers: string[];
}

export interface VoicePacing {
  targetWpm: number;
  maxWpm: number;
  linePauseMs: number;
  sentencePauseMs: number;
  commaPauseMs: number;
}

export interface VoiceDirection {
  concept: string;
  summary: string;
  /** BCP 47 tag of the variety the character speaks (en-AU): what a provider must honour with its own controls. */
  language: string;
  accent: { variety: string; rendering: string };
  register: string;
  qualities: string[];
  avoid: string[];
}

export interface VoiceIdentity {
  schema: 'walletwall.voice-identity/v2';
  id: string;
  character: string;
  direction: VoiceDirection;
  pacing: VoicePacing;
  providerBindings: Record<string, unknown>;
}

export interface LexiconEntry {
  term: string;
  spoken: string;
  ipa: string | null;
}

export interface PronunciationLexicon {
  schema: 'walletwall.pronunciation/v1';
  id: string;
  entries: LexiconEntry[];
}

export interface SonicEventConfig {
  description: string;
  minGapMs: number;
  maxGainDb: number;
  asset: string | null;
}

export interface SonicIdentityConfig {
  schema: 'walletwall.sonic-identity/v1';
  ident: { id: string; concept: string[]; durationMs: { min: number; max: number }; asset: string | null; status: string };
  musicBeds: Record<string, { description: string; duckUnderNarrationDb: number; maxGainDb: number; asset: string | null; status: string }>;
  events: Record<string, SonicEventConfig>;
}

export interface SourceDomainsConfig {
  schema: 'walletwall.source-domains/v1';
  navigationGroups: Record<string, SourceDomain[]>;
}

export interface YoutubeChannelConfig {
  schema: 'walletwall.youtube-channel/v1';
  defaults: {
    categoryId: string;
    defaultLanguage: string;
    defaultAudioLanguage: string;
    privacyStatusOnUpload: 'unlisted' | 'private';
    selfDeclaredMadeForKids: boolean;
    containsSyntheticMedia: boolean;
    license: string;
    baseTags: string[];
    descriptionFooter: string[];
  };
  limits: {
    titleMaxChars: number;
    descriptionMaxChars: number;
    chapterMinSeconds: number;
    chapterMinCount: number;
    endScreenMinMs: number;
    endScreenMaxMs: number;
    videoMinMsForEndScreen: number;
  };
  endScreen: { note: string; elements: { kind: string; source?: string; zone: string }[] };
}

export interface PlaylistConfig {
  id: string;
  title: string;
  description: string;
  youtubePlaylistId: string | null;
  entries: { videoId: string; order: number }[];
}

export interface PlaylistsConfig {
  schema: 'walletwall.playlists/v1';
  playlists: PlaylistConfig[];
}

export type ReleaseCriterion = 'audienceUsefulness' | 'productImportance' | 'docsStability' | 'visualTeachability';

export interface ReleaseCandidate {
  videoId: string;
  docPath: string;
  playlistId: string;
  status: string;
  dependsOn: string[];
  scores: Record<ReleaseCriterion, number>;
}

export interface ReleasePlanConfig {
  schema: 'walletwall.release-plan/v1';
  weights: Record<ReleaseCriterion, number>;
  candidates: ReleaseCandidate[];
}

export interface PipelineConfig {
  templates: CopyTemplates;
  policy: CopyPolicy;
  voice: VoiceIdentity;
  lexicon: PronunciationLexicon;
  sonic: SonicIdentityConfig;
  domains: SourceDomainsConfig;
  youtube: YoutubeChannelConfig;
  playlists: PlaylistsConfig;
  releasePlan: ReleasePlanConfig;
}
