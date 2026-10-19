// The provider registry and the provider configuration.
//
// config/narration-providers.json binds each adapter to its runtime, its pinned
// model identity, and its named settings variants. A provider id outside the
// closed list is refused; a variant's settings are validated by the adapter's
// own schema before anything runs. The publication path never reads this file:
// scripts/render.ts keeps the fixture voice, and config/voice-identity.json still
// reports the publication binding as NOT_CONFIGURED. Node-only.

import path from 'node:path';
import { readJson, VIDEO_ROOT } from '../../config/load.ts';
import { isNarrationProviderId, NarrationContractError, type NarrationProvider, type NarrationProviderId, type NarrationSettings } from '../contract.ts';
import { ChatterboxProvider, type ChatterboxBinding } from './chatterbox.ts';
import { ElevenLabsProvider, type ElevenLabsBinding } from './elevenlabs.ts';
import { MagpieProvider, type MagpieBinding, type PinnedFile } from './magpie.ts';

export const PROVIDERS_CONFIG_REL = 'config/narration-providers.json';
export const PROVIDERS_CONFIG_SCHEMA = 'walletwall.narration-providers/v1';

export interface NarrationProvidersConfig {
  schema: typeof PROVIDERS_CONFIG_SCHEMA;
  note: string;
  voiceIdentity: string;
  providers: {
    elevenlabs: ElevenLabsBinding;
    'magpie-nemo-speech': MagpieBinding;
    'chatterbox-multilingual': ChatterboxBinding;
  };
  diagnostics: {
    asr: { binaryEnv: string; modelDirEnv: string; runtime: { name: string; version: string }; model: PinnedFile };
  };
}

export function loadProvidersConfig(videoRoot: string = VIDEO_ROOT): NarrationProvidersConfig {
  const cfg = readJson<NarrationProvidersConfig>(path.join(videoRoot, ...PROVIDERS_CONFIG_REL.split('/')));
  if (cfg.schema !== PROVIDERS_CONFIG_SCHEMA) throw new NarrationContractError(`${PROVIDERS_CONFIG_REL} is not ${PROVIDERS_CONFIG_SCHEMA}`);
  for (const id of ['elevenlabs', 'magpie-nemo-speech', 'chatterbox-multilingual'] as const) {
    const b = cfg.providers[id];
    if (!b || typeof b !== 'object' || !b.variants || typeof b.variants !== 'object') throw new NarrationContractError(`${PROVIDERS_CONFIG_REL}: ${id} binding is missing its variants`);
  }
  return cfg;
}

export function providerFor(id: unknown, config: NarrationProvidersConfig): NarrationProvider {
  if (!isNarrationProviderId(id)) throw new NarrationContractError(`unknown narration provider ${JSON.stringify(id)}`);
  switch (id) {
    case 'elevenlabs':
      return new ElevenLabsProvider(config.providers.elevenlabs);
    case 'magpie-nemo-speech':
      return new MagpieProvider(config.providers['magpie-nemo-speech']);
    case 'chatterbox-multilingual':
      return new ChatterboxProvider(config.providers['chatterbox-multilingual']);
  }
}

export function variantNames(config: NarrationProvidersConfig, id: NarrationProviderId): string[] {
  return Object.keys(config.providers[id].variants).sort();
}

/** The validated settings of one named variant. */
export function variantSettings(config: NarrationProvidersConfig, provider: NarrationProvider, variant: string): NarrationSettings {
  const variants = config.providers[provider.id].variants;
  if (!Object.hasOwn(variants, variant)) throw new NarrationContractError(`${provider.id} has no variant ${JSON.stringify(variant)} (known: ${Object.keys(variants).sort().join(', ')})`);
  return provider.validateSettings(variants[variant]);
}
