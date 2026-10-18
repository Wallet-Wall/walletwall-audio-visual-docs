// Brand-contract drift: compare contracts/walletwall-brand.json with the
// canonical WalletWall files it was copied from. Needs a real WalletWall
// checkout (WALLETWALL_SOURCE_ROOT); the fixture mirror carries no brand source.
// Node-only.

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readJson, SOURCE_IS_FIXTURE, SOURCE_ROOT, VIDEO_ROOT } from '../config/load.ts';
import { canonicalPath, canonicalText } from '../source/canonical.ts';

export interface BrandContract {
  schema: 'walletwall.brand-contract/v1';
  note: string;
  sources: Record<string, { blob: string }>;
  theme: Record<string, string>;
  constants: Record<string, string>;
  cssRoot: Record<string, string>;
}

export interface BrandDrift {
  /** Values that differ from the canonical source: always a failure. */
  valueDrift: string[];
  /** Source files whose blob moved while every value still matches: refresh the recorded blobs. */
  blobDrift: string[];
}

export const BRAND_CONTRACT_PATH = path.join(VIDEO_ROOT, 'contracts', 'walletwall-brand.json');

const PROBE_ALPHA = 0.5;

function lookup(root: unknown, dotted: string): unknown {
  return dotted.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), root);
}

async function importCanonical(rel: string): Promise<Record<string, unknown>> {
  const abs = canonicalPath(rel);
  if (!abs) throw new Error(`unsafe canonical path ${rel}`);
  return (await import(pathToFileURL(abs).href)) as Record<string, unknown>;
}

/** The :root custom properties of a stylesheet, whitespace-normalized. */
export function cssRootProperties(css: string): Record<string, string> {
  const start = css.indexOf(':root');
  const block = start < 0 ? '' : css.slice(start, css.indexOf('}', start));
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) out[m[1]!] = m[2]!.trim().replace(/\s+/g, '');
  return out;
}

export async function brandDrift(contract: BrandContract = readJson<BrandContract>(BRAND_CONTRACT_PATH)): Promise<BrandDrift> {
  if (SOURCE_IS_FIXTURE) throw new Error('brand drift needs WALLETWALL_SOURCE_ROOT (a WalletWall checkout)');
  const valueDrift: string[] = [];
  const theme = await importCanonical('src/theme.js');
  const constants = await importCanonical('src/constants.js');
  for (const [key, value] of Object.entries(contract.theme)) {
    const live = lookup(theme, key);
    const actual = typeof live === 'function' ? String((live as (a: number) => unknown)(PROBE_ALPHA)) : live;
    const expected = value.includes('{alpha}') ? value.replace('{alpha}', String(PROBE_ALPHA)) : value;
    if (actual !== expected) valueDrift.push(`theme ${key}: contract ${JSON.stringify(value)}, canonical ${JSON.stringify(actual)}`);
  }
  for (const [key, value] of Object.entries(contract.constants)) {
    if (constants[key] !== value) valueDrift.push(`constants ${key}: contract ${JSON.stringify(value)}, canonical ${JSON.stringify(constants[key])}`);
  }
  const root = cssRootProperties(canonicalText('src/index.css'));
  for (const [prop, value] of Object.entries(contract.cssRoot)) {
    if (root[prop] !== value.replace(/\s+/g, '')) valueDrift.push(`css ${prop}: contract ${JSON.stringify(value)}, canonical ${JSON.stringify(root[prop] ?? null)}`);
  }
  const blobDrift: string[] = [];
  for (const [rel, { blob }] of Object.entries(contract.sources)) {
    const live = execFileSync('git', ['-C', SOURCE_ROOT, 'rev-parse', `HEAD:${rel}`], { encoding: 'utf8' }).trim();
    if (live !== blob) blobDrift.push(`${rel}: recorded ${blob}, canonical HEAD ${live}`);
  }
  return { valueDrift, blobDrift };
}
