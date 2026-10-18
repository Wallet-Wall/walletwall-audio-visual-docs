// The same faces the app ships (Sora, Manrope, IBM Plex Mono), bundled locally:
// no font CDN is contacted at render time.

import '@fontsource-variable/sora/index.css';
import '@fontsource-variable/manrope/index.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';

export const FONT_LOADS = [
  '600 48px "Sora Variable"',
  '700 22px "Manrope Variable"',
  '500 34px "Manrope Variable"',
  '500 18px "IBM Plex Mono"',
] as const;

export async function loadBrandFonts(): Promise<void> {
  await Promise.all(FONT_LOADS.map((f) => document.fonts.load(f)));
  await document.fonts.ready;
}
