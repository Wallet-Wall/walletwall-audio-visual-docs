// Every package the lockfiles resolve is accounted for (docs/LICENSING.md). The lockfiles are the one source of what is
// installed, so the check reads them and nothing else: no node_modules, no registry, no network. A permissive license
// needs no record; everything else must be covered by a manifest rule that names exactly what the lockfile says, so a
// license that changes, a package that appears, or a rule that goes stale is a finding and not a silent pass.
// No I/O, no environment.

import { sortFindings, type Finding } from './findings.ts';
import type { Component, CrateEntry, NpmRule } from './manifest.ts';
import { parseSpdx, spdxSatisfied } from './spdx.ts';
import { PERMISSIVE_LICENSES } from './vocabulary.ts';

export interface NpmPackage {
  name: string;
  version: string;
  /** The license string the lockfile records, or null when it records none. */
  license: string | null;
  dev: boolean;
  optional: boolean;
}

const MODULES = 'node_modules/';

export function readNpmLock(text: string): { packages: NpmPackage[]; problems: string[] } {
  const problems: string[] = [];
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { packages: [], problems: ['the npm lockfile is not valid JSON'] };
  }
  const entries = typeof doc === 'object' && doc !== null && !Array.isArray(doc) ? (doc as Record<string, unknown>)['packages'] : undefined;
  if (typeof entries !== 'object' || entries === null || Array.isArray(entries)) return { packages: [], problems: ['the npm lockfile has no packages map (lockfileVersion 2 or 3 is required)'] };
  const packages: NpmPackage[] = [];
  for (const [key, raw] of Object.entries(entries as Record<string, unknown>)) {
    if (key === '') continue;
    if (typeof raw !== 'object' || raw === null) {
      problems.push(`${key}: is not an object`);
      continue;
    }
    const meta = raw as Record<string, unknown>;
    const at = key.lastIndexOf(MODULES);
    const name = at < 0 ? key : key.slice(at + MODULES.length);
    const resolved = typeof meta['resolved'] === 'string' ? meta['resolved'] : '';
    if (meta['link'] === true || at < 0 || /^(?:file:|git[+:]|github:)/.test(resolved)) {
      problems.push(`${name}: is a link or a non-registry source (${resolved || key}); its license cannot be read from the lockfile`);
      continue;
    }
    if (typeof meta['version'] !== 'string') {
      problems.push(`${name}: has no version`);
      continue;
    }
    const license = typeof meta['license'] === 'string' ? meta['license'] : meta['license'] === undefined ? null : JSON.stringify(meta['license']);
    packages.push({ name, version: meta['version'], license, dev: meta['dev'] === true, optional: meta['optional'] === true });
  }
  packages.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.version < b.version ? -1 : a.version > b.version ? 1 : 0));
  return { packages, problems };
}

const permissive = (license: string | null): boolean => {
  if (license === null) return false;
  const node = parseSpdx(license);
  return node !== null && spdxSatisfied(node, PERMISSIVE_LICENSES);
};

/** The rules that cover one locked package. */
export const rulesFor = (pkg: NpmPackage, rules: readonly NpmRule[]): NpmRule[] => rules.filter((r) => ruleMatches(r, pkg));

const ruleMatches = (rule: NpmRule, pkg: NpmPackage): boolean => {
  const m = rule.match;
  const byName = 'packages' in m ? m.packages.includes(pkg.name) : 'package' in m ? m.package === pkg.name : pkg.name.startsWith(m.prefix);
  return byName && (rule.version === null || rule.version === pkg.version);
};

export function npmFindings(packages: readonly NpmPackage[], rules: readonly NpmRule[]): Finding[] {
  const found: Finding[] = [];
  const used = new Set<string>();
  const usedNames = new Map<string, Set<string>>();
  const checkedRules = new Set<string>();
  for (const pkg of packages) {
    const id = `${pkg.name}@${pkg.version}`;
    const applicable = rules.filter((r) => ruleMatches(r, pkg));
    if (applicable.length > 1) found.push({ code: 'NPM_RULE_AMBIGUOUS', path: id, message: `${id} is covered by more than one rule (${applicable.map((r) => r.id).join(', ')})` });
    const rule = applicable[0];
    if (rule === undefined) {
      if (!permissive(pkg.license)) found.push({ code: 'NPM_LICENSE_UNCLASSIFIED', path: id, message: `${id} declares ${pkg.license === null ? 'no license' : `the license ${JSON.stringify(pkg.license)}`}, which is not a permissive license; add a rule and a component for it, or replace the dependency` });
      continue;
    }
    used.add(rule.id);
    usedNames.set(rule.id, (usedNames.get(rule.id) ?? new Set<string>()).add(pkg.name));
    if (rule.lockLicense !== pkg.license) found.push({ code: 'NPM_RULE_MISMATCH', path: id, message: `rule ${rule.id} expects the lockfile license ${JSON.stringify(rule.lockLicense)} for ${id}, but the lockfile records ${JSON.stringify(pkg.license)}` });
    if (rule.resolvedLicense !== null && !checkedRules.has(rule.id)) {
      checkedRules.add(rule.id);
      if (!permissive(rule.resolvedLicense)) found.push({ code: 'NPM_RULE_LICENSE_NOT_ACCEPTABLE', path: `rule ${rule.id}`, message: `rule ${rule.id} resolves a license (${rule.resolvedLicense}) that is not permissive; a non-permissive license needs a component, not a resolved license` });
    }
  }
  for (const rule of rules) {
    if (!used.has(rule.id)) found.push({ code: 'NPM_RULE_UNUSED', path: `rule ${rule.id}`, message: `rule ${rule.id} matches no package in the lockfile; remove it or update it` });
    else if ('packages' in rule.match) for (const name of rule.match.packages) if (!usedNames.get(rule.id)?.has(name)) found.push({ code: 'NPM_RULE_UNUSED', path: `rule ${rule.id}`, message: `rule ${rule.id} lists ${name}, which the lockfile no longer resolves at the rule's version; remove it from the list` });
  }
  return sortFindings(found);
}

export interface CargoPackage {
  name: string;
  version: string;
  checksum: string;
}

const REGISTRY = /^registry\+(?:sparse\+)?https:\/\/(?:github\.com\/rust-lang\/crates\.io-index|index\.crates\.io\/?)$/;

/**
 * `ownCrates` are the crate names this repository's own Cargo.toml declares. A package with no registry source is
 * accepted only when it is one of them; any other (a path or vendored dependency) is a problem and never skipped.
 */
export function readCargoLock(text: string, ownCrates: readonly string[] = []): { packages: CargoPackage[]; problems: string[] } {
  const blocks = text.split(/^\[\[package\]\][ \t]*\r?$/m).slice(1);
  if (blocks.length === 0) return { packages: [], problems: ['the Cargo lockfile lists no packages'] };
  const problems: string[] = [];
  const packages: CargoPackage[] = [];
  for (const block of blocks) {
    const field = (k: string): string | null => new RegExp(`^${k}[ \\t]*=[ \\t]*"([^"]*)"[ \\t]*\\r?$`, 'm').exec(block)?.[1] ?? null;
    const name = field('name');
    const version = field('version');
    const source = field('source');
    if (name === null || version === null) {
      problems.push('a Cargo lockfile entry has no name or version');
      continue;
    }
    if (source === null) {
      if (!ownCrates.includes(name)) problems.push(`${name}@${version}: has no registry source and is not this repository's own crate (a path or vendored dependency), so its license cannot be read from the lockfile`);
      continue;
    }
    const checksum = field('checksum');
    if (!REGISTRY.test(source) || checksum === null || !/^[0-9a-f]{64}$/.test(checksum)) {
      problems.push(`${name}@${version}: comes from ${source} or has no checksum, so its license cannot be bound to the bytes the lockfile pins`);
      continue;
    }
    packages.push({ name, version, checksum });
  }
  packages.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.version < b.version ? -1 : 1));
  return { packages, problems };
}

export function cargoFindings(packages: readonly CargoPackage[], crates: readonly CrateEntry[]): Finding[] {
  const found: Finding[] = [];
  const recorded = new Map(crates.map((c) => [`${c.name}@${c.version}`, c]));
  const locked = new Set<string>();
  for (const pkg of packages) {
    const id = `${pkg.name}@${pkg.version}`;
    locked.add(id);
    const crate = recorded.get(id);
    if (crate === undefined) {
      found.push({ code: 'CARGO_CRATE_UNLISTED', path: id, message: `${id} is in the Cargo lockfile but has no license record in the manifest` });
      continue;
    }
    if (crate.checksum !== pkg.checksum) found.push({ code: 'CARGO_CHECKSUM_MISMATCH', path: id, message: `${id}: the recorded checksum is not the one the Cargo lockfile pins, so the recorded license is for different bytes` });
    if (!permissive(crate.license)) found.push({ code: 'CARGO_LICENSE_NOT_ACCEPTABLE', path: id, message: `${id} is licensed ${JSON.stringify(crate.license)}, which is not a permissive license` });
  }
  for (const id of recorded.keys()) if (!locked.has(id)) found.push({ code: 'CARGO_CRATE_STALE', path: id, message: `${id} has a license record but is not in the Cargo lockfile; remove or update it` });
  return sortFindings(found);
}

/** A component assessed at a package version holds only while the lockfile resolves exactly that version. */
export function assessedVersionFindings(packages: readonly NpmPackage[], components: readonly Component[]): Finding[] {
  const found: Finding[] = [];
  for (const c of components) {
    for (const a of c.assessedVersions ?? []) {
      const copies = packages.filter((p) => p.name === a.package);
      if (copies.length === 0) {
        found.push({ code: 'REASSESSMENT_REQUIRED', path: c.id, message: `${c.id} was assessed at ${a.package} ${a.version}, which the lockfile no longer resolves` });
        continue;
      }
      for (const copy of copies) {
        if (copy.version !== a.version) found.push({ code: 'REASSESSMENT_REQUIRED', path: c.id, message: `${c.id} was assessed at ${a.package} ${a.version}, but the lockfile resolves ${a.package} ${copy.version}: reassess the license text and update the manifest` });
      }
    }
  }
  return sortFindings(found);
}
