// The release-rights check (`npm run rights:check`, docs/LICENSING.md and docs/RELEASE_RIGHTS.md). It judges the
// committed files and nothing else: no network, no environment, no credentials, no clock, no legal inference beyond the
// policy encoded in src/rights/vocabulary.ts. Two modes:
//
//   development     the repository check. Source-code licensing, the Blender boundary, the lockfiles, the media
//                   assets, and the manifest's own consistency must all hold; items whose rights are an open owner
//                   decision may be recorded as pending, because they are not falsely cleared.
//   public-release  the same, and every material item must be CLEARED. Any other status, a review-required Python
//                   file, anything the owner has not confirmed, fails.
//
// The manifest records facts and can never loosen a rule: the Blender classification of every Python file is derived
// from the code here and the manifest must agree with it.

import { sha256Hex } from '../core/hash.ts';
import { sortFindings, type Finding } from './findings.ts';
import { assessedVersionFindings, cargoFindings, npmFindings, readCargoLock, readNpmLock, rulesFor, type NpmPackage } from './lockfiles.ts';
import { rightsManifestSha256, validateManifest, type Asset, type Component, type RightsManifest } from './manifest.ts';
import type { RepoView } from './repo.ts';
import { classifyPython, embeddedBlenderPython, hasPythonShebang, isPythonPath, scanPython, type PythonClassification } from './python-boundary.ts';
import { parseSpdx, spdxIds } from './spdx.ts';
import { BLENDER_COUPLED_LICENSE, CATEGORY_OF_COMPONENT_KIND, CATEGORY_OF_SPEC_ASSET_KIND, KNOWN_LICENSE_FILES, MEDIA_EXTENSIONS, STATUSES_PERMITTED_IN, type AssetCategory } from './vocabulary.ts';

export const MANIFEST_PATH = 'config/release-rights.json';
export const REPORT_SCHEMA = 'walletwall.rights-check-report/v1';

export type RightsMode = 'development' | 'public-release';

export interface PendingItem {
  kind: 'component' | 'asset' | 'python';
  id: string;
  status: string;
  ownerAction: string;
}

export interface RightsReport {
  schema: typeof REPORT_SCHEMA;
  mode: RightsMode;
  result: 'PASS' | 'FAIL';
  /** The manifest's identity (a publication receipt can bind to it); null when the manifest is not valid. */
  manifestSha256: string | null;
  counts: { components: number; assets: number; videos: number; npmPackages: number; cargoCrates: number; pythonFiles: number };
  findings: Finding[];
  pending: PendingItem[];
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const own = (o: unknown, k: string): unknown => (isRec(o) && Object.hasOwn(o, k) ? o[k] : undefined);

function readJson(repo: RepoView, rel: string): { ok: true; value: unknown } | { ok: false } {
  const text = repo.read(rel);
  if (text === null) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/**
 * Source files in which Blender Python could be handed to Blender as a string (any case of the extension). Markdown is
 * prose and is not scanned. The tests, which spell the pattern on purpose, and this checker are exempt: a script handed
 * to Blender can only be one of the lane's own entries (src/blender/toolchain.ts BLENDER_ENTRIES), never a test's string.
 */
const EMBEDDED_SCAN_EXTENSIONS = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|sh|bash|bat|cmd|ps1|ya?ml|toml|ipynb)$/i;
const EMBEDDED_SCAN_EXEMPT = (p: string): boolean => p.startsWith('test/') || p.startsWith('src/rights/') || p === 'scripts/rights-check.ts';

const dirOf = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

/** What a license text must visibly be, so a file renamed or overwritten with other text is not taken for the license. */
const TEXT_MARKERS: Readonly<Record<string, readonly string[]>> = {
  MIT: ['MIT License', 'Permission is hereby granted, free of charge'],
  'GPL-3.0-or-later': ['GNU GENERAL PUBLIC LICENSE', 'Version 3, 29 June 2007'],
};

export function checkRights(repo: RepoView, options: { mode: RightsMode }): RightsReport {
  const findings: Finding[] = [];
  const pending: PendingItem[] = [];
  const add = (code: string, path: string, message: string): void => void findings.push({ code, path, message });
  const counts = { components: 0, assets: 0, videos: 0, npmPackages: 0, cargoCrates: 0, pythonFiles: 0 };

  const finish = (manifest: RightsManifest | null): RightsReport => {
    const sorted = sortFindings(findings);
    return {
      schema: REPORT_SCHEMA,
      mode: options.mode,
      result: sorted.length === 0 ? 'PASS' : 'FAIL',
      manifestSha256: manifest ? rightsManifestSha256(manifest) : null,
      counts,
      findings: sorted,
      pending: [...pending].sort((a, b) => (a.kind + a.id < b.kind + b.id ? -1 : a.kind + a.id > b.kind + b.id ? 1 : 0)),
    };
  };

  // 1. The manifest, read closed. Nothing else is judged against a manifest that is not valid.
  const text = repo.read(MANIFEST_PATH);
  if (text === null) {
    add('MANIFEST_UNREADABLE', MANIFEST_PATH, `${MANIFEST_PATH} is missing or unreadable`);
    return finish(null);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    add('MANIFEST_UNREADABLE', MANIFEST_PATH, `${MANIFEST_PATH} is not valid JSON`);
    return finish(null);
  }
  const validated = validateManifest(parsed);
  if (validated.manifest === null) {
    for (const problem of validated.problems) add('MANIFEST_INVALID', problem.slice(0, problem.indexOf(': ')) || 'manifest', problem);
    return finish(null);
  }
  const m = validated.manifest;
  const componentById = new Map(m.components.map((c) => [c.id, c]));
  counts.components = m.components.length;
  counts.videos = m.videos.length;
  counts.assets = m.videos.reduce((n, v) => n + v.assets.length, 0);
  counts.cargoCrates = m.dependencies.cargo.crates.length;

  // 2. The documents the manifest points a reader to.
  for (const [role, rel] of Object.entries(m.documents)) if (repo.read(rel) === null) add('DOCUMENT_MISSING', rel, `the ${role} document ${rel} named by the manifest does not exist`);

  // 2b. Every file the manifest cites as evidence exists, wherever it is cited.
  const cited: { owner: string; ref: string }[] = [];
  for (const c of m.components) for (const e of c.evidence) if (e.type === 'FILE') cited.push({ owner: `the component ${c.id}`, ref: e.ref });
  for (const v of m.videos) for (const a of v.assets) for (const e of a.evidence) if (e.type === 'FILE') cited.push({ owner: `the asset ${v.videoId}/${a.id}`, ref: e.ref });
  for (const r of m.dependencies.npm.rules) for (const e of r.evidence) if (e.type === 'FILE') cited.push({ owner: `the npm rule ${r.id}`, ref: e.ref });
  for (const c of m.dependencies.cargo.crates) for (const e of c.evidence) if (e.type === 'FILE') cited.push({ owner: `the crate ${c.name}@${c.version}`, ref: e.ref });
  for (const { owner, ref } of cited) if (repo.read(ref) === null) add('EVIDENCE_FILE_MISSING', ref, `${owner} cites ${ref} as evidence, and it does not exist`);

  // 3. License files: present, pinned, the license they claim to be, and the top-level MIT license intact.
  checkLicenseFiles(m, repo, add);

  // 4. The Blender boundary, derived from the code.
  const python = checkPython(m, repo, add, pending);
  counts.pythonFiles = python.count;

  // 5. Blender Python smuggled into files that are not Python.
  for (const p of repo.files()) {
    if (!EMBEDDED_SCAN_EXTENSIONS.test(p) || EMBEDDED_SCAN_EXEMPT(p)) continue;
    const body = repo.read(p);
    const hit = body === null ? null : embeddedBlenderPython(body);
    if (hit) add('BLENDER_PYTHON_IN_NON_PYTHON_FILE', p, `${p} contains Blender Python (${JSON.stringify(hit)}); a script handed to Blender is a Blender-API script and belongs in a classified Python file`);
  }

  // 6. Lockfiles: every locked package and crate accounted for, assessments pinned to versions.
  const locked = checkLockfiles(m, repo, add);
  counts.npmPackages = locked.length;

  // 6b. A rule may only borrow a component whose license covers what the lockfile records; font packages are always recorded as fonts.
  for (const r of m.dependencies.npm.rules) {
    const c = r.component === null ? undefined : componentById.get(r.component);
    if (c === undefined) continue;
    const lock = r.lockLicense === null ? null : parseSpdx(r.lockLicense);
    if (lock !== null) {
      const covered = c.rightsBasis === 'OPEN_SOURCE_LICENSE' && c.licenseExpression !== null && ((cn) => cn !== null && spdxIds(lock).every((id) => spdxIds(cn).includes(id)))(parseSpdx(c.licenseExpression));
      if (!covered) add('NPM_RULE_COMPONENT_MISMATCH', `rule ${r.id}`, `rule ${r.id} records the lockfile license ${JSON.stringify(r.lockLicense)}, which the component \`${c.id}\` (${c.rightsBasis}${c.licenseExpression ? `, ${c.licenseExpression}` : ''}) does not cover`);
    } else if (c.rightsBasis === 'OPEN_SOURCE_LICENSE' || c.rightsBasis === 'OWNER_AUTHORED' || c.rightsBasis === 'GENERATED_FROM_OWNER_INPUTS') {
      add('NPM_RULE_COMPONENT_MISMATCH', `rule ${r.id}`, `rule ${r.id} covers a license the lockfile writes as ${r.lockLicense === null ? 'nothing' : JSON.stringify(r.lockLicense)} (not an SPDX license), which an ${c.rightsBasis} component \`${c.id}\` cannot stand for: it needs a vendor, provider, or undetermined basis`);
    }
  }
  for (const pkg of locked) {
    if (!pkg.name.startsWith('@fontsource')) continue;
    const component = rulesFor(pkg, m.dependencies.npm.rules).map((r) => (r.component === null ? undefined : componentById.get(r.component))).find((c) => c !== undefined);
    if (component?.kind !== 'font-package') add('FONT_PACKAGE_UNRECORDED', `${pkg.name}@${pkg.version}`, `${pkg.name}@${pkg.version} is a font package, so a rule must tie it to a font-package component (whatever its license), and the video must bind an asset to that component`);
  }

  // 6c. A component cannot be CLEARED above what it is produced by or depends on.
  for (const c of m.components) {
    for (const [why, ids] of [['produced by', c.producedBy ?? []], ['depends on', c.dependsOn ?? []]] as const) {
      for (const id of ids) {
        const target = componentById.get(id);
        if (c.status === 'CLEARED' && target !== undefined && target.status !== 'CLEARED') add('COMPONENT_ABOVE_DEPENDENCY', c.id, `${c.id} is CLEARED but it is ${why} \`${id}\`, which is ${target.status}`);
      }
    }
  }

  // 6d. Every tracked media file is inventoried (images, audio, video, fonts, 3D, compiled artifacts), whatever a spec names.
  // Coverage is by exact path: a file dropped beside an inventoried one is not covered by it.
  const trackedMedia = new Set(repo.files().filter((p) => MEDIA_EXTENSIONS.test(p)));
  const listedBy = (e: RightsManifest['mediaFiles'][number]): string[] => ('path' in e.match ? [e.match.path] : e.match.paths);
  const covered = new Set(m.mediaFiles.flatMap(listedBy));
  for (const p of [...trackedMedia].sort()) if (!covered.has(p)) add('MEDIA_FILE_UNRECORDED', p, `${p} is a media or compiled file with no entry in mediaFiles, so no rights are recorded for it`);
  for (const e of m.mediaFiles) {
    const missing = listedBy(e).filter((p) => !trackedMedia.has(p));
    if (missing.length > 0) add('MEDIA_ENTRY_STALE', e.id, `the mediaFiles entry ${e.id} lists ${missing.join(', ')}, which ${missing.length === 1 ? 'is' : 'are'} not tracked media or compiled file${missing.length === 1 ? '' : 's'}; remove or update it`);
  }

  // 7. Components the detected tooling requires.
  checkRequiredComponents(m, repo, componentById, add);

  // 8. Notices.
  const notices = repo.read(m.documents.notices);
  if (notices !== null) {
    for (const c of m.components) if (!notices.includes(`\`${c.id}\``)) add('NOTICE_MISSING', c.id, `${m.documents.notices} has no entry for the component \`${c.id}\``);
    for (const crate of m.dependencies.cargo.crates) {
      const id = `${crate.name}@${crate.version}`;
      if (crate.linkage === 'COMPILED_INTO_COMMITTED_ARTIFACT' && !notices.includes(`\`${id}\``)) add('NOTICE_MISSING', id, `${m.documents.notices} has no notice for \`${id}\`, which is compiled into a committed artifact`);
    }
  }

  // 9. Media: every video's declared assets, sonic assets, narration, and docs are accounted for.
  checkVideos(m, repo, componentById, add);

  // 10. Release states cannot claim more than the rights support.
  for (const v of m.videos) {
    const permitted: readonly string[] = STATUSES_PERMITTED_IN[v.release.state];
    const items: { id: string; status: string }[] = [...m.components.filter((c) => c.scope === 'RELEASE_PATH').map((c) => ({ id: c.id, status: c.status })), ...v.assets.map((a) => ({ id: `${v.videoId}/${a.id}`, status: a.status }))];
    const offending = items.filter((i) => !permitted.includes(i.status));
    if (python.reviewRequired.length > 0 && v.release.state !== 'LOCAL_PROOF') offending.push(...python.reviewRequired.map((p) => ({ id: p, status: 'REVIEW_REQUIRED' })));
    if (offending.length > 0) add('RELEASE_STATE_UNSUPPORTED', v.videoId, `${v.videoId} is recorded as ${v.release.state}, which tolerates only ${permitted.join(', ')}, but ${offending.slice(0, 8).map((i) => `${i.id} is ${i.status}`).join('; ')}${offending.length > 8 ? `; and ${offending.length - 8} more` : ''}`);
  }

  // 11. Open items: pending in development, blockers in a public release.
  const open: PendingItem[] = [];
  for (const c of m.components) if (c.scope === 'RELEASE_PATH' && c.status !== 'CLEARED') open.push({ kind: 'component', id: c.id, status: c.status, ownerAction: c.resolution?.ownerAction ?? '' });
  for (const v of m.videos) for (const a of v.assets) if (a.status !== 'CLEARED') open.push({ kind: 'asset', id: `${v.videoId}/${a.id}`, status: a.status, ownerAction: a.resolution?.ownerAction ?? '' });
  pending.push(...open);
  if (options.mode === 'public-release') {
    for (const item of open) add('RIGHTS_BLOCKING_STATUS', item.id, `${item.id} is ${item.status}; a public release needs CLEARED. Owner action: ${item.ownerAction}`);
    for (const p of python.reviewRequired) add('PYTHON_REVIEW_REQUIRED', p, `${p} is REVIEW_REQUIRED: its Blender boundary is undecided, and a public release needs it decided`);
  }
  return finish(m);
}

function checkLicenseFiles(m: RightsManifest, repo: RepoView, add: (code: string, path: string, message: string) => void): void {
  const listed = new Map(m.sourceCode.licenseFiles.map((f) => [f.path, f]));
  const content = new Map<string, string>();
  for (const f of m.sourceCode.licenseFiles) {
    const body = repo.read(f.path);
    if (body === null) {
      add('LICENSE_FILE_MISSING', f.path, `${f.path} (${f.license}) is named by the manifest and does not exist`);
      continue;
    }
    content.set(f.path, body);
    if (sha256Hex(body) !== f.sha256) add('LICENSE_FILE_MISMATCH', f.path, `${f.path} is not the pinned ${f.license} text (sha256 differs from the manifest); a license text changes only as a deliberate, reviewed edit`);
    const markers = TEXT_MARKERS[f.license] ?? [];
    if (!markers.every((s) => body.includes(s))) add('LICENSE_TEXT_UNEXPECTED', f.path, `${f.path} does not read as the ${f.license} license text`);
  }
  const root = listed.get('LICENSE');
  if (!root || root.license !== m.sourceCode.defaultLicense) add('LICENSE_FILE_NOT_LISTED', 'LICENSE', `the top-level LICENSE must be listed as ${m.sourceCode.defaultLicense}, the repository default`);
  const used = new Set([m.sourceCode.defaultLicense, ...m.sourceCode.python.map((p) => p.license)]);
  for (const license of [...used].sort()) {
    const wanted = KNOWN_LICENSE_FILES[license];
    if (wanted === undefined) add('LICENSE_TEXT_UNAVAILABLE', license, `no license text is defined for ${license}; add it under LICENSES/ and to the policy before any file uses it`);
    else if (listed.get(wanted)?.license !== license) add('LICENSE_FILE_NOT_LISTED', wanted, `${wanted} must be listed: ${license} is used by ${license === m.sourceCode.defaultLicense ? 'the repository' : 'a classified file'}`);
  }
  const rootBody = content.get('LICENSE');
  const copy = content.get('LICENSES/MIT.txt');
  if (rootBody !== undefined && copy !== undefined && rootBody !== copy) add('LICENSE_MIT_COPY_DIFFERS', 'LICENSES/MIT.txt', 'LICENSES/MIT.txt must be byte-identical to the top-level LICENSE');

  const pkg = readJson(repo, 'package.json');
  if (!pkg.ok) add('PACKAGE_JSON_MISSING', 'package.json', 'package.json is missing or unreadable');
  else if (own(pkg.value, 'license') !== m.sourceCode.defaultLicense) add('PACKAGE_LICENSE_MISMATCH', 'package.json', `package.json declares the license ${JSON.stringify(own(pkg.value, 'license'))}, not the repository default ${m.sourceCode.defaultLicense}`);
  const cargoToml = `${dirOf(m.dependencies.cargo.lockfile)}/Cargo.toml`.replace(/^\//, '');
  const toml = repo.read(cargoToml);
  if (toml === null) add('PACKAGE_LICENSE_MISMATCH', cargoToml, `${cargoToml} is missing, so its license cannot be checked against the repository default`);
  else {
    const declared = /^license[ \t]*=[ \t]*"([^"]+)"/m.exec(toml)?.[1];
    if (declared !== m.sourceCode.defaultLicense) add('PACKAGE_LICENSE_MISMATCH', cargoToml, `${cargoToml} declares the license ${JSON.stringify(declared ?? null)}, not the repository default ${m.sourceCode.defaultLicense}`);
  }
}

/** Every Python file: by extension (any case), and any extensionless file with a Python shebang. */
function pythonPaths(repo: RepoView): string[] {
  return repo.files().filter((p) => {
    if (isPythonPath(p)) return true;
    if (/\.[^/]+$/.test(p.slice(p.lastIndexOf('/') + 1))) return false;
    const text = repo.read(p);
    return text !== null && hasPythonShebang(text);
  });
}

const REVIEW_REMEDY = 'Rewrite the construct so the analysis can read it (an absolute import, no computed or aliased dynamic import), or record the file as BLENDER_API_COUPLED with GPL-3.0-or-later, which is the conservative reading. If the owner has reviewed it and it is independent of Blender (a false positive), record it BLENDER_INDEPENDENT with an ownerReview pinned to its sha256.';

function checkPython(m: RightsManifest, repo: RepoView, add: (code: string, path: string, message: string) => void, pending: PendingItem[]): { count: number; reviewRequired: string[] } {
  const paths = pythonPaths(repo);
  const sources = new Map<string, string | null>(paths.map((p) => [p, repo.read(p)]));
  for (const [p, text] of sources) if (text === null) add('PYTHON_UNREADABLE', p, `${p} could not be read (it is missing, not a regular file, or larger than the bound), so nothing can be said about its Blender boundary`);
  const derived = classifyPython(paths.map((p) => scanPython(p, sources.get(p) ?? '', { unreadable: sources.get(p) === null })));
  const entries = new Map(m.sourceCode.python.map((e) => [e.path, e]));

  // What settles a file the analysis cannot decide: the conservative reading (recorded as coupled), or the owner's review
  // of exactly these bytes (recorded as independent). Neither can override what the analysis decides itself.
  const settlement = new Map<string, 'BLENDER_API_COUPLED' | 'BLENDER_INDEPENDENT'>();
  const staleReview = new Set<string>();
  for (const p of paths) {
    const entry = entries.get(p);
    if (derived.get(p)?.classification !== 'REVIEW_REQUIRED' || entry === undefined) continue;
    const source = sources.get(p);
    if (entry.classification === 'BLENDER_API_COUPLED') settlement.set(p, 'BLENDER_API_COUPLED');
    else if (entry.classification === 'BLENDER_INDEPENDENT' && entry.ownerReview !== undefined && source !== null && source !== undefined) {
      if (entry.ownerReview.fileSha256 === sha256Hex(source)) settlement.set(p, 'BLENDER_INDEPENDENT');
      else staleReview.add(p);
    }
  }
  const effective = (p: string): PythonClassification['classification'] => settlement.get(p) ?? (derived.get(p) as PythonClassification).classification;

  const mixed = new Set<string>();
  for (const p of derived.keys()) if (effective(p) !== 'BLENDER_INDEPENDENT') mixed.add(dirOf(p));
  const reviewRequired: string[] = [];

  for (const p of paths) {
    const d = derived.get(p) as PythonClassification;
    const entry = entries.get(p);
    const settled = settlement.get(p) !== undefined;
    if (d.classification === 'REVIEW_REQUIRED' && !settled) reviewRequired.push(p);
    if (entry === undefined) {
      add('PYTHON_UNCLASSIFIED', p, `${p} is a Python file with no entry in the manifest; it is ${d.classification}${d.reasons.length ? ` (${d.reasons.join('; ')})` : ''}. Add it with the license that matches`);
      continue;
    }
    if (entry.ownerReview !== undefined && d.classification !== 'REVIEW_REQUIRED') {
      add('PYTHON_OWNER_REVIEW_UNNEEDED', p, `${p} carries an ownerReview, but the analysis decides it by itself (${d.classification}) and a review cannot change that; remove the review`);
    }
    if (staleReview.has(p)) {
      add('PYTHON_OWNER_REVIEW_STALE', p, `${p} was reviewed as different bytes (the ownerReview sha256 is not the file's); review it again and record the new sha256. Until then it stays REVIEW_REQUIRED`);
    } else if (entry.classification !== d.classification && !settled) {
      const danger = d.classification === 'BLENDER_API_COUPLED' && entry.license !== BLENDER_COUPLED_LICENSE ? ': recording it so would leave a Blender-API script under MIT' : '';
      add('PYTHON_CLASSIFICATION_MISMATCH', p, `${p} is ${d.classification}${d.reasons.length ? ` (${d.reasons.join('; ')})` : ''} but the manifest records ${entry.classification}${danger}`);
    }
    const expected = effective(p) === 'BLENDER_INDEPENDENT' ? entry.license : BLENDER_COUPLED_LICENSE;
    const wantsHeader = effective(p) !== 'BLENDER_INDEPENDENT' || mixed.has(dirOf(p));
    const { licenses, copyrights } = d.header;
    if (licenses.length === 0) {
      if (wantsHeader) add('PYTHON_LICENSE_HEADER_MISSING', p, `${p} needs an SPDX-License-Identifier header (${expected}) in its leading comment block${d.classification === 'BLENDER_INDEPENDENT' ? ', because it sits in a directory with Blender-API files' : ''}`);
    } else {
      if (licenses.length !== 1 || licenses[0] !== expected) add('PYTHON_LICENSE_HEADER_WRONG', p, `${p} declares ${licenses.map((l) => JSON.stringify(l)).join(' and ')}, expected exactly ${JSON.stringify(expected)}`);
      else if (wantsHeader || copyrights.length > 0) {
        if (copyrights.length !== 1 || copyrights[0] !== m.sourceCode.copyright) add('PYTHON_COPYRIGHT_HEADER_WRONG', p, `${p} must carry exactly one SPDX-FileCopyrightText: ${m.sourceCode.copyright}, the holder named in the repository LICENSE`);
      }
    }
  }
  for (const e of m.sourceCode.python) if (!derived.has(e.path)) add('PYTHON_ENTRY_STALE', e.path, `the manifest classifies ${e.path}, which does not exist`);
  for (const p of reviewRequired) pending.push({ kind: 'python', id: p, status: 'REVIEW_REQUIRED', ownerAction: REVIEW_REMEDY });
  return { count: paths.length, reviewRequired };
}

/** The crate names this repository's Cargo.toml declares itself: the one source-less package the lockfile may list. */
function ownCrates(toml: string | null): string[] {
  const section = toml === null ? null : /^\[package\][ \t]*\r?\n([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(toml)?.[1];
  const name = section === null || section === undefined ? undefined : /^name[ \t]*=[ \t]*"([^"]+)"/m.exec(section)?.[1];
  return name === undefined ? [] : [name];
}

function checkLockfiles(m: RightsManifest, repo: RepoView, add: (code: string, path: string, message: string) => void): NpmPackage[] {
  const npmPath = m.dependencies.npm.lockfile;
  const npmText = repo.read(npmPath);
  let locked: NpmPackage[] = [];
  if (npmText === null) add('NPM_LOCK_UNREADABLE', npmPath, `${npmPath} is missing or unreadable`);
  else {
    const { packages, problems } = readNpmLock(npmText);
    locked = packages;
    for (const p of problems) add('NPM_LOCK_UNREADABLE', npmPath, p);
    if (problems.length === 0) {
      for (const f of [...npmFindings(packages, m.dependencies.npm.rules), ...assessedVersionFindings(packages, m.components)]) add(f.code, f.path, f.message);
      const pkg = readJson(repo, 'package.json');
      if (pkg.ok) {
        const direct = ['dependencies', 'devDependencies', 'optionalDependencies'].flatMap((k) => (isRec(own(pkg.value, k)) ? Object.keys(own(pkg.value, k) as Rec) : []));
        const lockedNames = new Set(packages.map((p) => p.name));
        for (const name of direct.sort()) if (!lockedNames.has(name)) add('NPM_LOCK_OUT_OF_SYNC', name, `package.json depends on ${name}, which ${npmPath} does not lock; regenerate the lockfile so its licenses mean something`);
      }
    }
  }
  const cargoPath = m.dependencies.cargo.lockfile;
  const cargoText = repo.read(cargoPath);
  if (cargoText === null) add('CARGO_LOCK_UNREADABLE', cargoPath, `${cargoPath} is missing or unreadable`);
  else {
    const dir = dirOf(cargoPath);
    const { packages, problems } = readCargoLock(cargoText, ownCrates(repo.read(dir === '' ? 'Cargo.toml' : `${dir}/Cargo.toml`)));
    for (const p of problems) add('CARGO_LOCK_UNREADABLE', cargoPath, p);
    if (problems.length === 0) for (const f of cargoFindings(packages, m.dependencies.cargo.crates)) add(f.code, f.path, f.message);
  }
  return locked;
}

/** The provider the publication narration binding names, or null. */
function narrationProvider(repo: RepoView): string | null {
  const cfg = readJson(repo, 'config/narration-providers.json');
  const provider = cfg.ok ? own(own(cfg.value, 'publication'), 'provider') : undefined;
  return typeof provider === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(provider) ? provider : null;
}

function checkRequiredComponents(m: RightsManifest, repo: RepoView, byId: Map<string, Component>, add: (code: string, path: string, message: string) => void): void {
  // A required tool must be recorded as a tool or runtime on the release path. Relabelling it research-only, or moving it
  // to another layer, would take it out of the strict check, so that is refused as if it were missing.
  const need = (id: string, why: string): void => {
    const c = byId.get(id);
    if (c === undefined) add('REQUIRED_COMPONENT_MISSING', id, `${why}, so the manifest must record the component \`${id}\``);
    else if (c.layer !== 'TOOL_RUNTIME' || c.scope !== 'RELEASE_PATH' || c.kind === 'research-tool') add('REQUIRED_COMPONENT_MISSING', id, `${why}, so \`${id}\` must be a TOOL_RUNTIME component on the RELEASE_PATH, not ${c.layer}/${c.scope}/${c.kind}`);
  };
  if (repo.read('config/blender.json') !== null) {
    need('blender-runtime', 'config/blender.json pins a Blender toolchain');
    // The Blender lane builds the character; its model is rights-bearing media of its own, and no video may omit it by omission.
    if (![...byId.values()].some((c) => c.kind === 'generated-model' && c.scope === 'RELEASE_PATH')) {
      add('CHARACTER_UNRECORDED', 'config/blender.json', 'config/blender.json pins the Blender lane that builds the character, so the manifest must record the character as a generated-model component on the RELEASE_PATH, bound by an asset of every video');
    }
  }
  const pkg = readJson(repo, 'package.json');
  if (pkg.ok && isRec(own(pkg.value, 'dependencies')) && Object.hasOwn(own(pkg.value, 'dependencies') as Rec, 'remotion')) need('remotion', 'package.json depends on remotion');
  const provider = narrationProvider(repo);
  if (provider !== null) need(`${provider}-service`, `config/narration-providers.json binds the publication narration to ${provider}`);
}

/** Every `asset` string anywhere in the sonic identity (any section, any depth), with the category its section implies. */
function collectSonicAssets(node: unknown, trail: string[], out: { id: string; category: AssetCategory }[]): void {
  if (Array.isArray(node)) {
    node.forEach((x, i) => collectSonicAssets(x, [...trail, String(i)], out));
    return;
  }
  if (!isRec(node)) return;
  for (const k of Object.keys(node).sort()) {
    const v = node[k];
    if (k === 'asset' && typeof v === 'string') out.push({ id: v, category: trail.includes('musicBeds') ? 'music' : 'sfx' });
    else collectSonicAssets(v, [...trail, k], out);
  }
}

function checkVideos(m: RightsManifest, repo: RepoView, byId: Map<string, Component>, add: (code: string, path: string, message: string) => void): void {
  const registry = readJson(repo, 'config/videos.json');
  const registered = registry.ok && Array.isArray(own(registry.value, 'videos')) ? (own(registry.value, 'videos') as unknown[]).map((v) => own(v, 'videoId')).filter((x): x is string => typeof x === 'string') : null;
  if (registered === null) add('VIDEO_REGISTRY_UNREADABLE', 'config/videos.json', 'config/videos.json is missing or has no videos list');
  else {
    const have = new Set(m.videos.map((v) => v.videoId));
    for (const id of registered) if (!have.has(id)) add('VIDEO_NOT_IN_MANIFEST', id, `config/videos.json registers ${id}, which has no rights record in the manifest`);
    for (const v of m.videos) if (!registered.includes(v.videoId)) add('VIDEO_ENTRY_STALE', v.videoId, `the manifest records ${v.videoId}, which config/videos.json no longer registers`);
  }

  const sonic = readJson(repo, 'config/sonic-identity.json');
  const sonicAssets: { id: string; category: AssetCategory }[] = [];
  if (sonic.ok) collectSonicAssets(sonic.value, [], sonicAssets);
  const provider = narrationProvider(repo);

  for (const v of m.videos) {
    if (registered !== null && !registered.includes(v.videoId)) continue;
    const at = (id: string): string => `${v.videoId}/${id}`;
    const specJson = readJson(repo, `specs/${v.videoId}/spec.json`);
    if (!specJson.ok) {
      add('SPEC_UNREADABLE', v.videoId, `specs/${v.videoId}/spec.json is missing or unreadable, so ${v.videoId}'s assets cannot be matched to rights`);
      continue;
    }
    const spec = specJson.value;
    const specAssets = Array.isArray(own(spec, 'assets')) ? (own(spec, 'assets') as unknown[]) : [];
    const bySpec = new Map<string, Asset>();
    for (const a of v.assets) if (a.binding.type === 'SPEC_ASSET') bySpec.set(a.binding.specAssetId, a);

    const seen = new Set<string>();
    for (const sa of specAssets) {
      const id = String(own(sa, 'id'));
      seen.add(id);
      const asset = bySpec.get(id);
      if (asset === undefined || asset.binding.type !== 'SPEC_ASSET') {
        add('SPEC_ASSET_UNCOVERED', at(id), `${v.videoId}'s spec declares the asset ${id} (${String(own(sa, 'kind'))}), which has no rights entry; an asset is not cleared because it is available`);
        continue;
      }
      if (asset.binding.sha256 !== own(sa, 'sha256')) add('SPEC_ASSET_HASH_MISMATCH', at(id), `the rights entry for ${id} is for different bytes than the spec's asset (sha256 differs)`);
      const expected = CATEGORY_OF_SPEC_ASSET_KIND[String(own(sa, 'kind'))];
      if (expected === undefined) add('SPEC_ASSET_KIND_UNKNOWN', at(id), `the spec asset ${id} has the kind ${JSON.stringify(own(sa, 'kind'))}, which the rights policy does not know`);
      else if (asset.category !== expected) add('SPEC_ASSET_CATEGORY_MISMATCH', at(id), `${id} is a ${String(own(sa, 'kind'))} and must be recorded as ${expected}, not ${asset.category}`);
    }
    for (const [id] of bySpec) if (!seen.has(id)) add('ASSET_BINDING_STALE', at(id), `the rights entry ${id} is bound to a spec asset that ${v.videoId}'s spec no longer declares`);

    const sonicBound = new Map<string, Asset>();
    for (const a of v.assets) if (a.binding.type === 'SONIC_ASSET') sonicBound.set(a.binding.sonicAssetId, a);
    for (const s of sonicAssets) {
      const asset = sonicBound.get(s.id);
      if (asset === undefined) add('SONIC_ASSET_UNCOVERED', at(s.id), `config/sonic-identity.json assigns the ${s.category} asset ${s.id}, which has no rights entry in ${v.videoId}`);
      else if (asset.category !== s.category) add('SONIC_ASSET_UNCOVERED', at(s.id), `${s.id} is a ${s.category} asset and is recorded as ${asset.category}`);
    }
    for (const id of sonicBound.keys()) if (!sonicAssets.some((s) => s.id === id)) add('ASSET_BINDING_STALE', at(id), `the rights entry is bound to the sonic asset ${id}, which config/sonic-identity.json no longer assigns`);

    const voiced = typeof own(own(spec, 'audio'), 'voiceIdentityId') === 'string';
    if (voiced && provider !== null && !v.assets.some((a) => a.category === 'narration' && a.binding.type === 'COMPONENT' && a.binding.componentId === `${provider}-service`)) {
      add('NARRATION_UNCOVERED', v.videoId, `${v.videoId} is narrated through ${provider}, so it needs a narration asset bound to \`${provider}-service\``);
    }

    const source = own(spec, 'source');
    const docPath = own(source, 'docPath');
    const blob = own(source, 'blob');
    if (!v.assets.some((a) => a.binding.type === 'CANONICAL_DOCS' && a.binding.docPath === docPath && a.binding.blob === blob)) {
      add('DOCS_SOURCE_UNCOVERED', v.videoId, `${v.videoId} is made from ${String(docPath)} at blob ${String(blob)}, which has no rights entry bound to exactly that page`);
    }

    for (const c of m.components) {
      if (c.scope === 'RELEASE_PATH' && (c.kind === 'font-package' || c.kind === 'generated-model') && !v.assets.some((a) => a.binding.type === 'COMPONENT' && a.binding.componentId === c.id)) {
        add('COMPONENT_UNBOUND', at(c.id), `${c.id} (${c.kind}) shapes ${v.videoId}'s frames and must be bound by an asset of the video`);
      }
    }
    for (const a of v.assets) {
      if (a.binding.type !== 'COMPONENT') continue;
      const c = byId.get(a.binding.componentId);
      if (c !== undefined && a.status === 'CLEARED' && c.status !== 'CLEARED') add('ASSET_ABOVE_COMPONENT', at(a.id), `${a.id} is CLEARED but the component \`${c.id}\` it is bound to is ${c.status}`);
      const wanted = c === undefined ? undefined : CATEGORY_OF_COMPONENT_KIND[c.kind];
      if (c !== undefined && wanted !== undefined && a.category !== wanted) add('COMPONENT_CATEGORY_MISMATCH', at(a.id), `${a.id} binds the ${c.kind} component \`${c.id}\` and must be recorded as ${wanted}, not ${a.category}`);
    }
  }
}

/** The report as lines of text: deterministic, with every finding and every pending owner decision. */
export function renderReport(report: RightsReport): string[] {
  const c = report.counts;
  const lines = [
    `rights:check (${report.mode})`,
    `manifest: ${report.manifestSha256 === null ? 'not valid' : report.manifestSha256.slice(0, 12)}`,
    `checked: ${c.components} components, ${c.assets} video assets across ${c.videos} video(s), ${c.npmPackages} npm packages, ${c.cargoCrates} Cargo crates, ${c.pythonFiles} Python files`,
  ];
  if (report.pending.length > 0) {
    lines.push(`pending (recorded, not cleared; ${report.mode === 'public-release' ? 'each one blocks this release' : 'allowed in development'}): ${report.pending.length}`);
    for (const p of report.pending) lines.push(`  - ${p.kind} ${p.id} ${p.status}${p.ownerAction ? `: ${p.ownerAction}` : ''}`);
  }
  for (const f of report.findings) lines.push(`FAIL ${f.code} ${f.path}: ${f.message}`);
  lines.push(`result: ${report.result}${report.findings.length > 0 ? ` (${report.findings.length} finding${report.findings.length === 1 ? '' : 's'})` : ''}`);
  return lines;
}
