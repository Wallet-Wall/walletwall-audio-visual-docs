// config/release-rights.json: the closed, machine-readable record of what this repository may and may not say about its
// rights (docs/RELEASE_RIGHTS.md). It keeps four things apart on purpose, because one status must never imply another:
//
//   sourceCode      repository source-code licensing: the license map and the Python files each license covers
//   components      tools, runtimes, third-party code, and generated media, each with its own basis and status
//   dependencies    how every locked npm package and Cargo crate is accounted for
//   videos          per-video asset rights and the video's release state
//
// The schema is closed: an unknown or missing field, an unknown status, basis, layer, kind, state or classification is a
// problem, never a default. Members are read as own keys only, so a parsed `__proto__` member is an unknown field like
// any other and cannot ride along. A status cannot claim more than its basis supports: UNKNOWN never becomes CLEARED,
// and a vendor's, provider's, or third party's terms are cleared only by a record the owner makes. The provider service
// a narration is made with also records its voice (`voiceRights`): a rights-and-consent record that keeps the right to
// the voice apart from the right to its output and from anything WalletWall owns. The manifest is a public file, so it
// may hold no local path, secret, or personal address. No I/O, no environment.

import { canonicalJson } from '../core/canonical-json.ts';
import { contentAddress } from '../core/hash.ts';
import { credentialPatternIn, localPathIn } from '../core/leak-scan.ts';
import { parseSpdx, spdxExceptions, spdxIds, spdxSatisfied } from './spdx.ts';
import {
  ASSET_CATEGORIES,
  BASES_NEEDING_OWNER_CLEARANCE,
  BLENDER_CLASSIFICATIONS,
  BLENDER_COUPLED_LICENSE,
  COMMERCIAL_OUTPUT_BASES,
  COMPONENT_KINDS,
  COMPONENT_LAYERS,
  COMPONENT_SCOPES,
  DISTRIBUTIONS,
  EVIDENCE_TYPES,
  GPL_COMPATIBLE_LICENSES,
  KINDS_BY_LAYER,
  LINKAGES,
  COMPLIANCE_THAT_CLEARS,
  MAX_NOTICE_PERIOD_DAYS,
  PROVIDER_CONTROL_COMPLIANCE,
  PROVIDER_CONTROL_KINDS,
  PROVIDER_CONTROL_STATES,
  RECOGNISED_SPDX_IDS,
  RELEASE_STATES,
  RESTRICTED_SPDX_IDS,
  RIGHTS_BASES,
  RIGHTS_SCHEMA,
  RIGHTS_STATUSES,
  SPEAKER_AUTHORIZATION_SCOPES,
  SPEAKER_OWNERSHIP,
  SPEAKER_SCOPE_NEEDED,
  USE_RESTRICTING_CONTROLS,
  VOICE_AUTHORIZATION_BASES,
  VOICE_SOURCE_TYPES,
  VOICE_SOURCE_USE,
  VOICE_SOURCES,
  VOICE_TYPE_AUTHORIZATION,
  VOICE_TYPES,
  VOICE_USE_BASES,
  VOICE_USE_OUTPUT,
  voiceFactEstablished,
  WALLETWALL_OWNABLE,
  type AssetCategory,
  type CommercialOutputBasis,
  type ComponentLayer,
  type ComponentScope,
  type ProviderControlKind,
  type ReleaseState,
  type RightsBasis,
  type RightsStatus,
  type SpeakerOwnership,
  type VoiceAuthorizationBasis,
  type VoiceSource,
  type VoiceType,
  type VoiceUseBasis,
  type WalletwallOwnable,
} from './vocabulary.ts';

export interface Evidence {
  type: (typeof EVIDENCE_TYPES)[number];
  ref: string;
  retrievedOn?: string;
}

export interface Resolution {
  ownerAction: string;
  reassessmentTrigger: string;
}

export interface Clearance {
  clearedBy: 'OWNER';
  clearedOn: string;
  basis: string;
}

/** What every component and asset claims about its rights. */
export interface RightsClaim {
  rightsBasis: RightsBasis;
  status: RightsStatus;
  licenseExpression: string | null;
  evidence: Evidence[];
  resolution?: Resolution;
  clearance?: Clearance;
}

/** One provider control on a narration voice, as found or as undetermined with the exact uncertainty in `note`. */
export interface ProviderControl {
  kind: ProviderControlKind;
  state: (typeof PROVIDER_CONTROL_STATES)[number];
  note: string;
  /** A notice period in force names its length in days. */
  days?: number;
  observedBy?: 'OWNER';
  observedOn?: string;
  /** Recorded for a use-restricting control in force: whether the restriction still permits this use (a withdrawal may leave only the output already generated). */
  compliance?: 'SATISFIED' | 'NOT_SATISFIED' | 'EXISTING_OUTPUT_ONLY';
}

/**
 * The rights in the narration voice a provider service speaks with. The right to use the voice (source, voiceType,
 * authorizationBasis, useBasis) and the right to use what it says commercially (commercialOutputBasis) are separate facts and
 * each is needed to clear it. The voice id is not recorded (the privacy scan refuses one): the record is bound to it by
 * the sha256 of the id the narration binding names.
 */
export interface VoiceRights {
  binding: { id: string; voiceIdSha256: string };
  source: VoiceSource;
  voiceType: VoiceType;
  authorizationBasis: VoiceAuthorizationBasis;
  useBasis: VoiceUseBasis;
  commercialOutputBasis: CommercialOutputBasis;
  ownership: { walletwallOwns: WalletwallOwnable[]; speakerVoiceAndLikeness: SpeakerOwnership };
  /** Who says the voice is what this record states, the day, and what that rests on. Required once the origin is established. */
  attestation?: { attestedBy: 'OWNER'; attestedOn: string; basis: string };
  /** Only for a speaker's written authorization: when it was granted, who holds the document (it stays out of the public repository), and what it covers. */
  speakerAuthorization?: { documentHeldBy: 'OWNER'; grantedOn: string; scope: string[] };
  providerControls: ProviderControl[];
}

export interface Component extends RightsClaim {
  id: string;
  layer: ComponentLayer;
  kind: string;
  scope: ComponentScope;
  distribution: (typeof DISTRIBUTIONS)[number];
  summary: string;
  assessedVersions?: { package: string; version: string }[];
  producedBy?: string[];
  /** Components this one cannot be CLEARED above (the source it is built from, the tool it needs). */
  dependsOn?: string[];
  /** Only on the provider service the narration binding uses: whose voice it is and why it may be used. */
  voiceRights?: VoiceRights;
}

/** One tracked media file or an exact list of them (never a directory, which would cover whatever is dropped into it later), and the component or video asset whose rights cover them. */
export interface MediaEntry {
  id: string;
  match: { path: string } | { paths: string[] };
  covers: { component: string } | { asset: string };
}

export type AssetBinding =
  | { type: 'SPEC_ASSET'; specAssetId: string; sha256: string }
  | { type: 'SONIC_ASSET'; sonicAssetId: string }
  | { type: 'COMPONENT'; componentId: string }
  | { type: 'CANONICAL_DOCS'; docPath: string; blob: string };

export interface Asset extends RightsClaim {
  id: string;
  category: AssetCategory;
  binding: AssetBinding;
}

export interface OwnerAuthorization {
  authorizedBy: 'OWNER';
  transition: 'UNLISTED->PUBLIC';
  receiptSha256: string;
}

export interface VideoRights {
  videoId: string;
  release: { state: ReleaseState; ownerAuthorization?: OwnerAuthorization };
  assets: Asset[];
  absent: AssetCategory[];
}

/**
 * The owner's decision that a file the analysis cannot read is independent of Blender (a false positive: a local variable
 * called `gpu`). Pinned to the reviewed bytes, so any edit to the file re-opens the question. A declaration the owner
 * makes, like a clearance: it settles only REVIEW_REQUIRED and never overrides what the analysis decides.
 */
export interface OwnerReview {
  reviewedBy: 'OWNER';
  reviewedOn: string;
  fileSha256: string;
  basis: string;
}

export interface PythonEntry {
  path: string;
  classification: (typeof BLENDER_CLASSIFICATIONS)[number];
  license: string;
  reason: string;
  ownerReview?: OwnerReview;
}

export interface NpmRule {
  id: string;
  match: { package: string } | { prefix: string } | { packages: string[] };
  version: string | null;
  lockLicense: string | null;
  resolvedLicense: string | null;
  component: string | null;
  evidence: Evidence[];
}

export interface CrateEntry {
  name: string;
  version: string;
  checksum: string;
  license: string;
  linkage: (typeof LINKAGES)[number];
  evidence: Evidence[];
}

export interface RightsManifest {
  schema: typeof RIGHTS_SCHEMA;
  project: string;
  verifiedOn: string;
  documents: { notices: string; licensing: string; policy: string };
  sourceCode: {
    defaultLicense: string;
    copyright: string;
    licenseFiles: { license: string; path: string; sha256: string }[];
    python: PythonEntry[];
  };
  components: Component[];
  dependencies: { npm: { lockfile: string; rules: NpmRule[] }; cargo: { lockfile: string; crates: CrateEntry[] } };
  mediaFiles: MediaEntry[];
  videos: VideoRights[];
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const own = (o: Rec, k: string): unknown => (Object.hasOwn(o, k) ? o[k] : undefined);

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const SAFE_PATH = /^(?!\/)(?![A-Za-z]:)[A-Za-z0-9._@+/-]+$/;
const PACKAGE_REF = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*@\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/;
const LICENSE_REF = /^LicenseRef-[A-Za-z0-9.-]+$/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
const MAX_TEXT = 700;
/**
 * Account-shaped information a rights record has no business holding, beyond the shared leak policy's paths and secrets.
 * Patterns, not proof: they catch the shapes an account detail usually takes, and the record is reviewed as well.
 */
const ACCOUNT_PATTERNS: readonly { re: RegExp; what: string }[] = [
  { re: /\bpasswo?r?d\b[ \t]*[:=]/i, what: 'a password or credential assignment' },
  { re: /\b(?:api[_ -]?key|secret|token|credential)s?\b[ \t]*[:=][ \t]*\S{6,}/i, what: 'a password or credential assignment' },
  // A mixed-case 20-character identifier with a digit is how provider voice and account ids look.
  { re: /(?<![A-Za-z0-9])(?=[A-Za-z]*\d)(?=[a-z0-9]*[A-Z])[A-Za-z0-9]{20}(?![A-Za-z0-9])/, what: 'an identifier shaped like a provider voice or account id' },
  { re: /\b(?:creator|pro|scale|business|enterprise|starter|team)[ \t]+(?:plan|tier|subscription)\b/i, what: 'a subscription plan tier' },
];

/** The recognised identifiers a CLEARED open-source item may rest on: every one but the restricted. */
const UNRESTRICTED_SPDX_IDS: ReadonlySet<string> = new Set([...RECOGNISED_SPDX_IDS].filter((id) => !RESTRICTED_SPDX_IDS.has(id)));

const plainPath = (v: string): boolean => SAFE_PATH.test(v) && v.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
const validDate = (v: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
};

class Reader {
  readonly problems: string[] = [];
  bad(path: string, message: string): void {
    this.problems.push(`${path}: ${message}`);
  }
  join(path: string, key: string): string {
    return path === '' ? key : `${path}.${key}`;
  }
  /** An object with exactly these fields; unknown and missing fields are problems. */
  shape(v: unknown, path: string, required: readonly string[], optional: readonly string[] = []): Rec | null {
    if (!isRec(v)) {
      this.bad(path || 'manifest', 'must be an object');
      return null;
    }
    const allowed = new Set([...required, ...optional]);
    for (const k of Object.keys(v)) if (!allowed.has(k)) this.bad(this.join(path, k), 'unknown field');
    for (const k of required) if (!Object.hasOwn(v, k)) this.bad(this.join(path, k), 'missing');
    return v;
  }
  str(v: unknown, path: string, max = MAX_TEXT): string | null {
    if (typeof v !== 'string') {
      this.bad(path, 'must be a string');
      return null;
    }
    if (v.length < 1 || v.length > max) {
      this.bad(path, `must be a string of 1 to ${max} characters`);
      return null;
    }
    return v;
  }
  oneOf<T extends string>(v: unknown, path: string, list: readonly T[]): T | null {
    if (typeof v === 'string' && (list as readonly string[]).includes(v)) return v as T;
    this.bad(path, `must be one of ${list.join(', ')}`);
    return null;
  }
  exactly<T extends string>(v: unknown, path: string, expected: T): boolean {
    if (v === expected) return true;
    this.bad(path, `must be exactly ${JSON.stringify(expected)}`);
    return false;
  }
  id(v: unknown, path: string): string | null {
    if (typeof v === 'string' && ID.test(v)) return v;
    this.bad(path, `must match ${ID.source}`);
    return null;
  }
  hex64(v: unknown, path: string): string | null {
    if (typeof v === 'string' && HEX64.test(v)) return v;
    this.bad(path, 'must be 64 lowercase hex characters');
    return null;
  }
  date(v: unknown, path: string): string | null {
    if (typeof v === 'string' && validDate(v)) return v;
    this.bad(path, 'must be a YYYY-MM-DD date');
    return null;
  }
  path(v: unknown, path: string): string | null {
    if (typeof v === 'string' && plainPath(v)) return v;
    this.bad(path, 'must be a plain repo-relative path');
    return null;
  }
  array(v: unknown, path: string, min = 0, max = 4096): unknown[] | null {
    if (!Array.isArray(v)) {
      this.bad(path, 'must be an array');
      return null;
    }
    if (v.length < min || v.length > max) {
      this.bad(path, `must have ${min} to ${max} items`);
      return null;
    }
    return v;
  }
}

function readEvidence(r: Reader, v: unknown, path: string): void {
  const list = r.array(v, path, 1, 12);
  if (!list) return;
  list.forEach((e, i) => {
    const p = `${path}[${i}]`;
    const rec = r.shape(e, p, ['type', 'ref'], ['retrievedOn']);
    if (!rec) return;
    const type = r.oneOf(own(rec, 'type'), `${p}.type`, EVIDENCE_TYPES);
    const ref = own(rec, 'ref');
    if (typeof ref !== 'string' || ref.length < 1 || ref.length > 300) r.bad(`${p}.ref`, 'must be a string of 1 to 300 characters');
    if (own(rec, 'retrievedOn') !== undefined) r.date(own(rec, 'retrievedOn'), `${p}.retrievedOn`);
    if (typeof ref !== 'string') return;
    if (type === 'URL') {
      let url: URL | null = null;
      try {
        url = new URL(ref);
      } catch {
        r.bad(`${p}.ref`, 'a URL must be absolute');
      }
      if (url) {
        if (url.protocol !== 'https:') r.bad(`${p}.ref`, 'a URL must be https');
        if (url.username !== '' || url.password !== '') r.bad(`${p}.ref`, 'a URL must not carry credentials');
      }
      if (own(rec, 'retrievedOn') === undefined) r.bad(`${p}.retrievedOn`, 'required for a URL (the day the page was read)');
    } else if (type === 'FILE') {
      if (!plainPath(ref)) r.bad(`${p}.ref`, 'a file must be a plain repo-relative path');
    } else if (type === 'PACKAGE') {
      if (!PACKAGE_REF.test(ref)) r.bad(`${p}.ref`, 'a package is name@version');
    }
  });
}

/** The fields every component and asset shares, and the rules that tie status to basis. */
function readClaim(r: Reader, rec: Rec, path: string): void {
  const basis = r.oneOf(own(rec, 'rightsBasis'), `${path}.rightsBasis`, RIGHTS_BASES);
  const status = r.oneOf(own(rec, 'status'), `${path}.status`, RIGHTS_STATUSES);
  readEvidence(r, own(rec, 'evidence'), `${path}.evidence`);

  const expression = own(rec, 'licenseExpression');
  if (expression !== null && typeof expression !== 'string') r.bad(`${path}.licenseExpression`, 'must be a string or null');
  if (basis !== null && (expression === null || typeof expression === 'string')) {
    if (basis === 'OPEN_SOURCE_LICENSE') {
      if (expression === null) r.bad(`${path}.licenseExpression`, 'an OPEN_SOURCE_LICENSE basis needs an SPDX expression');
      else {
        const node = parseSpdx(expression);
        if (node === null) r.bad(`${path}.licenseExpression`, 'not a valid SPDX expression');
        else {
          for (const id of spdxIds(node)) if (!RECOGNISED_SPDX_IDS.has(id)) r.bad(`${path}.licenseExpression`, `${id} is not a recognised SPDX license identifier (read its text, then add it to src/rights/vocabulary.ts)`);
          if (spdxExceptions(node).length > 0) r.bad(`${path}.licenseExpression`, 'a WITH exception is not recognised (read the exception text, then extend the policy)');
          if (status === 'CLEARED' && !spdxSatisfied(node, UNRESTRICTED_SPDX_IDS)) {
            const named = spdxIds(node).filter((id) => RESTRICTED_SPDX_IDS.has(id));
            if (named.length > 0) r.bad(`${path}.licenseExpression`, `${named.join(', ')} carries a non-commercial or network-copyleft term, so the item cannot be CLEARED on it alone: record it as NONCOMMERCIAL, INCOMPATIBLE, or OWNER_CONFIRMATION_PENDING, or name an alternative the owner can take with OR`);
          }
        }
      }
    } else if (basis === 'VENDOR_LICENSE' || basis === 'PROVIDER_TERMS') {
      if (expression !== null && !LICENSE_REF.test(expression)) r.bad(`${path}.licenseExpression`, `a ${basis} basis is null or a LicenseRef-… identifier`);
    } else if (expression !== null) {
      r.bad(`${path}.licenseExpression`, `must be null for a ${basis} basis`);
    }
  }

  if (basis === 'UNDETERMINED' && status !== null) {
    if (status === 'CLEARED') r.bad(`${path}.rightsBasis`, 'an UNDETERMINED basis cannot be CLEARED');
    else if (status !== 'UNKNOWN' && status !== 'UNVERIFIED') r.bad(`${path}.rightsBasis`, 'an UNDETERMINED basis is UNKNOWN or UNVERIFIED');
  }

  const resolution = own(rec, 'resolution');
  if (resolution !== undefined) {
    const res = r.shape(resolution, `${path}.resolution`, ['ownerAction', 'reassessmentTrigger']);
    if (res) {
      r.str(own(res, 'ownerAction'), `${path}.resolution.ownerAction`);
      r.str(own(res, 'reassessmentTrigger'), `${path}.resolution.reassessmentTrigger`);
    }
  } else if (status !== null && status !== 'CLEARED') {
    r.bad(`${path}.resolution`, `required while the status is ${status} (the owner action and the reassessment trigger)`);
  }

  const clearance = own(rec, 'clearance');
  const needsOwner = basis !== null && BASES_NEEDING_OWNER_CLEARANCE.includes(basis);
  if (clearance !== undefined) {
    if (status !== null && status !== 'CLEARED') r.bad(`${path}.clearance`, 'only a CLEARED item has one');
    else if (!needsOwner) r.bad(`${path}.clearance`, 'only a VENDOR_LICENSE, PROVIDER_TERMS, or THIRD_PARTY_ATTRIBUTION_ONLY basis takes a clearance record');
    const c = r.shape(clearance, `${path}.clearance`, ['clearedBy', 'clearedOn', 'basis']);
    if (c) {
      r.exactly(own(c, 'clearedBy'), `${path}.clearance.clearedBy`, 'OWNER');
      r.date(own(c, 'clearedOn'), `${path}.clearance.clearedOn`);
      r.str(own(c, 'basis'), `${path}.clearance.basis`);
    }
  } else if (status === 'CLEARED' && needsOwner) {
    r.bad(`${path}.clearance`, `required to clear a ${basis} basis (the owner's record)`);
  }
}

const pick = <T extends string>(v: unknown, list: readonly T[]): T | null => (typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : null);

interface ReadControl {
  kind: ProviderControlKind | null;
  state: string | null;
  compliance: string | null;
}

/** The provider controls of a voice: each kind at most once, each as found (who read it, when) or as undetermined with the exact uncertainty. */
function readProviderControls(r: Reader, v: unknown, path: string, source: VoiceSource | null): ReadControl[] {
  const out: ReadControl[] = [];
  const seen = new Set<string>();
  r.array(v, path, 0, PROVIDER_CONTROL_KINDS.length)?.forEach((c, i) => {
    const p = `${path}[${i}]`;
    const e = r.shape(c, p, ['kind', 'state', 'note'], ['days', 'observedBy', 'observedOn', 'compliance']);
    if (!e) return;
    const kind = r.oneOf(own(e, 'kind'), `${p}.kind`, PROVIDER_CONTROL_KINDS);
    const state = r.oneOf(own(e, 'state'), `${p}.state`, PROVIDER_CONTROL_STATES);
    r.str(own(e, 'note'), `${p}.note`);
    if (kind !== null) {
      if (seen.has(kind)) r.bad(`${p}.kind`, `duplicate ${kind}`);
      seen.add(kind);
    }

    const observedBy = own(e, 'observedBy');
    const observedOn = own(e, 'observedOn');
    if (state === 'UNDETERMINED') {
      if (observedBy !== undefined || observedOn !== undefined) r.bad(`${p}.observedOn`, 'an undetermined control was not observed, so it has no observer or date');
    } else if (state !== null) {
      if (observedBy === undefined) r.bad(`${p}.observedBy`, 'required for a control in force or not in force (who read it)');
      else r.exactly(observedBy, `${p}.observedBy`, 'OWNER');
      if (observedOn === undefined) r.bad(`${p}.observedOn`, 'required for a control in force or not in force (the day it was read or reported)');
      else r.date(observedOn, `${p}.observedOn`);
    }

    const days = own(e, 'days');
    if (days !== undefined) {
      if (kind !== null && kind !== 'NOTICE_PERIOD') r.bad(`${p}.days`, 'only a notice period has a length');
      else if (state !== 'IN_FORCE') r.bad(`${p}.days`, 'only a notice period in force has a length');
      else if (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > MAX_NOTICE_PERIOD_DAYS) r.bad(`${p}.days`, `must be a whole number of days, 1 to ${MAX_NOTICE_PERIOD_DAYS}`);
    } else if (kind === 'NOTICE_PERIOD' && state === 'IN_FORCE') {
      r.bad(`${p}.days`, 'a notice period in force names its length');
    }

    const restricting = kind !== null && USE_RESTRICTING_CONTROLS.includes(kind);
    const compliance = own(e, 'compliance');
    let read: string | null = null;
    if (compliance !== undefined) {
      if (!(restricting && state === 'IN_FORCE')) r.bad(`${p}.compliance`, 'only a CUSTOM_RESTRICTION or LIBRARY_REMOVAL in force has one');
      else {
        read = r.oneOf(compliance, `${p}.compliance`, PROVIDER_CONTROL_COMPLIANCE);
        if (read === 'EXISTING_OUTPUT_ONLY' && kind !== 'LIBRARY_REMOVAL') {
          r.bad(`${p}.compliance`, 'EXISTING_OUTPUT_ONLY is for a LIBRARY_REMOVAL: a withdrawal ends new synthesis and leaves the output already generated while the voice was available');
        }
      }
    } else if (restricting && state === 'IN_FORCE') {
      r.bad(`${p}.compliance`, 'required while a use-restricting control is in force (the owner records whether the restriction still permits this use)');
    }
    out.push({ kind, state, compliance: read });
  });
  if (source === 'ELEVENLABS_VOICE_LIBRARY') {
    for (const kind of PROVIDER_CONTROL_KINDS) if (!seen.has(kind)) r.bad(path, `${kind} is not recorded: a Voice Library voice records every provider control, as found, or as undetermined with the exact uncertainty`);
  }
  return out;
}

/**
 * The rights record of a narration voice (docs/RELEASE_RIGHTS.md, "Voice rights"). It refuses what the owner's policy
 * prohibits and clears only what it establishes: the pairings of source, type, authorization, use and output basis
 * admit three routes and no other, an unauthorized voice is BLOCKED, an undetermined origin is never CLEARED, the right
 * to use the voice and the right to use its output commercially are each needed, WalletWall never records the speaker's
 * voice or likeness as its own, and a provider restriction in force is assessed and never ignored.
 */
function readVoiceRights(r: Reader, v: unknown, path: string, owner: { path: string; kind: string | null; rightsBasis: RightsBasis | null; status: RightsStatus | null }): void {
  const rec = r.shape(v, path, ['binding', 'source', 'voiceType', 'authorizationBasis', 'useBasis', 'commercialOutputBasis', 'ownership', 'providerControls'], ['attestation', 'speakerAuthorization']);
  if (!rec) return;
  if (owner.kind !== null && owner.kind !== 'provider-service') r.bad(path, 'only a provider-service component records a narration voice');
  if (owner.rightsBasis !== null && owner.rightsBasis !== 'PROVIDER_TERMS' && owner.rightsBasis !== 'VENDOR_LICENSE') {
    r.bad(`${owner.path}.rightsBasis`, `a narration voice is the speaker's, not WalletWall's: its basis is PROVIDER_TERMS or VENDOR_LICENSE, never ${owner.rightsBasis}`);
  }

  const binding = r.shape(own(rec, 'binding'), `${path}.binding`, ['id', 'voiceIdSha256']);
  if (binding) {
    r.id(own(binding, 'id'), `${path}.binding.id`);
    r.hex64(own(binding, 'voiceIdSha256'), `${path}.binding.voiceIdSha256`);
  }

  const source = r.oneOf(own(rec, 'source'), `${path}.source`, VOICE_SOURCES);
  const voiceType = r.oneOf(own(rec, 'voiceType'), `${path}.voiceType`, VOICE_TYPES);
  const authorization = r.oneOf(own(rec, 'authorizationBasis'), `${path}.authorizationBasis`, VOICE_AUTHORIZATION_BASES);
  const use = r.oneOf(own(rec, 'useBasis'), `${path}.useBasis`, VOICE_USE_BASES);
  const output = r.oneOf(own(rec, 'commercialOutputBasis'), `${path}.commercialOutputBasis`, COMMERCIAL_OUTPUT_BASES);

  // The routes: each part is the one the part before it requires, so no part is borrowed from another route.
  const types = source === null ? undefined : VOICE_SOURCE_TYPES[source];
  if (types !== undefined && voiceType !== null && voiceFactEstablished(voiceType) && !types.includes(voiceType)) r.bad(`${path}.voiceType`, `a ${source} voice is a ${types.join(' or ')}, not a ${voiceType}`);
  const needAuthorization = voiceType === null ? undefined : VOICE_TYPE_AUTHORIZATION[voiceType];
  if (needAuthorization !== undefined && authorization !== null && voiceFactEstablished(authorization) && authorization !== needAuthorization) {
    r.bad(`${path}.authorizationBasis`, `a ${voiceType} is authorized only by ${needAuthorization}, not ${authorization}: cloning a voice, or conditioning one on reference audio, without the speaker's own authorization is prohibited`);
  }
  const needUse = source === null ? undefined : VOICE_SOURCE_USE[source];
  if (needUse !== undefined && use !== null && voiceFactEstablished(use) && use !== needUse) r.bad(`${path}.useBasis`, `a ${source} voice is used under ${needUse}, not ${use}`);
  const needOutput = use === null ? undefined : VOICE_USE_OUTPUT[use];
  if (needOutput !== undefined && output !== null && voiceFactEstablished(output) && output !== needOutput) r.bad(`${path}.commercialOutputBasis`, `${use} pairs with ${needOutput} for commercial output, not ${output}`);

  // Ownership: WalletWall's own work, never the speaker's voice or likeness.
  const ownership = r.shape(own(rec, 'ownership'), `${path}.ownership`, ['walletwallOwns', 'speakerVoiceAndLikeness']);
  if (ownership) {
    const claimed = new Set<string>();
    r.array(own(ownership, 'walletwallOwns'), `${path}.ownership.walletwallOwns`, 1, 8)?.forEach((claim) => {
      if (pick(claim, WALLETWALL_OWNABLE) === null) r.bad(`${path}.ownership.walletwallOwns`, `${JSON.stringify(claim)} is not WalletWall's to claim: it owns its ${WALLETWALL_OWNABLE.join(', ').toLowerCase().replaceAll('_', ' ')}, never a speaker's voice or likeness`);
      else if (claimed.has(claim as string)) r.bad(`${path}.ownership.walletwallOwns`, `duplicate ${String(claim)}`);
      else claimed.add(claim as string);
    });
    const speaker = r.oneOf(own(ownership, 'speakerVoiceAndLikeness'), `${path}.ownership.speakerVoiceAndLikeness`, SPEAKER_OWNERSHIP);
    if (speaker !== null && authorization !== null && (authorization === 'NO_HUMAN_SPEAKER') !== (speaker === 'NO_HUMAN_SPEAKER')) {
      r.bad(`${path}.ownership.speakerVoiceAndLikeness`, 'NO_HUMAN_SPEAKER is for a voice with no human speaker (authorizationBasis NO_HUMAN_SPEAKER); every other voice has a speaker who keeps the rights in their voice and likeness (SPEAKER_RETAINS)');
    }
  }

  // Whoever says the voice is what this record states is named: no route is stated as fact on nobody's word.
  const attestation = own(rec, 'attestation');
  if (attestation !== undefined) {
    const a = r.shape(attestation, `${path}.attestation`, ['attestedBy', 'attestedOn', 'basis']);
    if (a) {
      r.exactly(own(a, 'attestedBy'), `${path}.attestation.attestedBy`, 'OWNER');
      r.date(own(a, 'attestedOn'), `${path}.attestation.attestedOn`);
      r.str(own(a, 'basis'), `${path}.attestation.basis`);
    }
  } else if ([source, voiceType, authorization, use].every(voiceFactEstablished)) {
    r.bad(`${path}.attestation`, 'required once the origin is established (who says this voice is what the record states, the day, and what that rests on)');
  }

  // A speaker's written authorization: when it was granted, who holds it (it stays out of this public file), and what it covers.
  const written = authorization === 'SPEAKER_WRITTEN_AUTHORIZATION';
  const speakerAuthorization = own(rec, 'speakerAuthorization');
  let speakerScope: string[] | null = null;
  if (speakerAuthorization !== undefined) {
    if (!written) r.bad(`${path}.speakerAuthorization`, 'only a SPEAKER_WRITTEN_AUTHORIZATION has one');
    else {
      const sa = r.shape(speakerAuthorization, `${path}.speakerAuthorization`, ['documentHeldBy', 'grantedOn', 'scope']);
      if (sa) {
        r.exactly(own(sa, 'documentHeldBy'), `${path}.speakerAuthorization.documentHeldBy`, 'OWNER');
        r.date(own(sa, 'grantedOn'), `${path}.speakerAuthorization.grantedOn`);
        const seenScope = new Set<string>();
        const items = r.array(own(sa, 'scope'), `${path}.speakerAuthorization.scope`, 1, SPEAKER_AUTHORIZATION_SCOPES.length);
        items?.forEach((item, i) => {
          const scope = r.oneOf(item, `${path}.speakerAuthorization.scope[${i}]`, SPEAKER_AUTHORIZATION_SCOPES);
          if (scope === null) return;
          if (seenScope.has(scope)) r.bad(`${path}.speakerAuthorization.scope`, `duplicate ${scope}`);
          seenScope.add(scope);
        });
        if (items !== null && items.every((item) => pick(item, SPEAKER_AUTHORIZATION_SCOPES) !== null)) speakerScope = items as string[];
      }
    }
  } else if (written) {
    r.bad(`${path}.speakerAuthorization`, 'required for a SPEAKER_WRITTEN_AUTHORIZATION (when it was granted, who holds the document, and what it covers)');
  }

  const controls = readProviderControls(r, own(rec, 'providerControls'), `${path}.providerControls`, source);

  // What the status may be.
  const status = owner.status;
  if (status === null) return;
  const unauthorized: [string, string][] = [];
  if (authorization === 'NOT_ESTABLISHED') unauthorized.push(['authorization', 'authorizationBasis']);
  if (use === 'NOT_ESTABLISHED') unauthorized.push(['use basis', 'useBasis']);
  if (unauthorized.length > 0) {
    if (status !== 'BLOCKED') {
      for (const [name, field] of unauthorized) r.bad(`${path}.${field}`, `a voice whose ${name} is not established is BLOCKED: it is never pending and never CLEARED (cloning without the speaker's authorization, or a use the provider or rights holder has not granted, is prohibited)`);
    }
  } else {
    const undetermined = ([['source', source], ['voiceType', voiceType], ['authorizationBasis', authorization], ['useBasis', use]] as const).filter(([, x]) => x === 'UNDETERMINED').map(([name]) => name);
    if (undetermined.length > 0 && status !== 'UNKNOWN' && status !== 'UNVERIFIED' && status !== 'BLOCKED') {
      r.bad(`${path}.${undetermined[0]}`, `a voice whose origin is undetermined (${undetermined.join(', ')}) is UNKNOWN or UNVERIFIED (or BLOCKED), never pending confirmation or CLEARED`);
    }
  }
  if (status === 'CLEARED') {
    if (output !== null && !voiceFactEstablished(output)) {
      r.bad(`${path}.commercialOutputBasis`, `commercial-output rights are not established (${output}): the right to use a voice and the right to use its output commercially are separate, and a CLEARED voice has both`);
    }
    if (speakerScope !== null) {
      const needed = SPEAKER_SCOPE_NEEDED[voiceType ?? ''];
      if (needed !== undefined && !needed.every((s) => speakerScope.includes(s))) r.bad(`${path}.speakerAuthorization.scope`, `a CLEARED speaker authorization covers ${needed.join(', ')}; this one covers ${speakerScope.join(', ')}`);
    }
    for (const c of controls) {
      if (c.kind !== null && USE_RESTRICTING_CONTROLS.includes(c.kind) && c.state === 'IN_FORCE' && !COMPLIANCE_THAT_CLEARS.includes(c.compliance ?? '')) {
        r.bad(`${path}.providerControls`, `${c.kind} is in force and not satisfied, so the voice cannot be CLEARED: a provider restriction is assessed, never ignored`);
      }
    }
  }
}

function readComponents(r: Reader, v: unknown): Set<string> {
  const ids = new Set<string>();
  const list = r.array(v, 'components', 1, 200);
  if (!list) return ids;
  const toolIds = new Set<string>();
  const recs: (Rec | null)[] = list.map((c, i) => {
    const rec = r.shape(c, `components[${i}]`, ['id', 'layer', 'kind', 'scope', 'rightsBasis', 'status', 'licenseExpression', 'distribution', 'summary', 'evidence'], ['resolution', 'clearance', 'assessedVersions', 'producedBy', 'dependsOn', 'voiceRights']);
    if (!rec) return null;
    const id = own(rec, 'id');
    if (typeof id === 'string' && ID.test(id)) {
      if (ids.has(id)) r.bad(`components[${i}].id`, `duplicate id ${id}`);
      ids.add(id);
      if (own(rec, 'layer') === 'TOOL_RUNTIME') toolIds.add(id);
    } else {
      r.bad(`components[${i}].id`, `must match ${ID.source}`);
    }
    return rec;
  });
  recs.forEach((rec, i) => {
    if (!rec) return;
    const p = `components[${i}]`;
    const layer = r.oneOf(own(rec, 'layer'), `${p}.layer`, COMPONENT_LAYERS);
    const kind = r.oneOf(own(rec, 'kind'), `${p}.kind`, COMPONENT_KINDS);
    const scope = r.oneOf(own(rec, 'scope'), `${p}.scope`, COMPONENT_SCOPES);
    r.oneOf(own(rec, 'distribution'), `${p}.distribution`, DISTRIBUTIONS);
    r.str(own(rec, 'summary'), `${p}.summary`, 1200);
    if (layer && kind && !KINDS_BY_LAYER[layer].includes(kind)) r.bad(`${p}.kind`, `kind ${kind} is not a ${layer} kind`);
    if (scope === 'RESEARCH_ONLY' && kind !== null && kind !== 'research-tool') r.bad(`${p}.scope`, 'RESEARCH_ONLY is for the research-tool kind only');
    if (scope === 'RELEASE_PATH' && kind === 'research-tool') r.bad(`${p}.scope`, 'a research-tool is RESEARCH_ONLY');
    readClaim(r, rec, p);
    const voiceRights = own(rec, 'voiceRights');
    if (voiceRights !== undefined) readVoiceRights(r, voiceRights, `${p}.voiceRights`, { path: p, kind, rightsBasis: pick(own(rec, 'rightsBasis'), RIGHTS_BASES), status: pick(own(rec, 'status'), RIGHTS_STATUSES) });

    const versions = own(rec, 'assessedVersions');
    if (versions !== undefined) {
      const list = r.array(versions, `${p}.assessedVersions`, 1, 20);
      list?.forEach((x, j) => {
        const e = r.shape(x, `${p}.assessedVersions[${j}]`, ['package', 'version']);
        if (!e) return;
        r.str(own(e, 'package'), `${p}.assessedVersions[${j}].package`, 120);
        const version = own(e, 'version');
        if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) r.bad(`${p}.assessedVersions[${j}].version`, 'must be an exact version');
      });
    }

    const produced = own(rec, 'producedBy');
    if (layer === 'GENERATED_MEDIA') {
      if (produced === undefined) r.bad(`${p}.producedBy`, 'generated media names the tools that produced it');
      else
        r.array(produced, `${p}.producedBy`, 1, 20)?.forEach((t) => {
          if (typeof t !== 'string' || !toolIds.has(t)) r.bad(`${p}.producedBy`, `${String(t)} is not a TOOL_RUNTIME component`);
        });
    } else if (produced !== undefined) {
      r.bad(`${p}.producedBy`, 'only GENERATED_MEDIA components have one');
    }

    const depends = own(rec, 'dependsOn');
    if (depends !== undefined) {
      const seen = new Set<string>();
      r.array(depends, `${p}.dependsOn`, 1, 20)?.forEach((d) => {
        if (typeof d !== 'string' || !ids.has(d)) r.bad(`${p}.dependsOn`, `${String(d)} is not a component`);
        else if (d === own(rec, 'id')) r.bad(`${p}.dependsOn`, 'a component cannot depend on itself');
        else if (seen.has(d)) r.bad(`${p}.dependsOn`, `duplicate ${d}`);
        else seen.add(d);
      });
    }
  });
  return ids;
}

function readMediaFiles(r: Reader, v: unknown, componentIds: ReadonlySet<string>, assetKeys: ReadonlySet<string>): void {
  const list = r.array(v, 'mediaFiles', 0, 500);
  if (!list) return;
  const entryIds = new Set<string>();
  list.forEach((entry, i) => {
    const p = `mediaFiles[${i}]`;
    const rec = r.shape(entry, p, ['id', 'match', 'covers']);
    if (!rec) return;
    const id = r.id(own(rec, 'id'), `${p}.id`);
    if (id) {
      if (entryIds.has(id)) r.bad(`${p}.id`, `duplicate id ${id}`);
      entryIds.add(id);
    }
    const match = own(rec, 'match');
    if (!isRec(match)) r.bad(`${p}.match`, 'must be an object');
    else {
      const keys = Object.keys(match);
      if (keys.length !== 1 || (keys[0] !== 'path' && keys[0] !== 'paths')) r.bad(`${p}.match`, 'must be exactly one of path or paths');
      else if (keys[0] === 'path') r.path(own(match, 'path'), `${p}.match.path`);
      else {
        const list = own(match, 'paths');
        if (!Array.isArray(list) || list.length < 1 || list.length > 200 || !list.every((x) => typeof x === 'string' && plainPath(x)) || new Set(list).size !== list.length) {
          r.bad(`${p}.match.paths`, 'must be a list of 1 to 200 distinct plain repo-relative paths');
        }
      }
    }
    const covers = own(rec, 'covers');
    if (!isRec(covers)) r.bad(`${p}.covers`, 'must be an object');
    else {
      const keys = Object.keys(covers);
      if (keys.length !== 1 || (keys[0] !== 'component' && keys[0] !== 'asset')) r.bad(`${p}.covers`, 'must be exactly one of component or asset');
      else if (keys[0] === 'component') {
        const c = own(covers, 'component');
        if (typeof c !== 'string' || !componentIds.has(c)) r.bad(`${p}.covers.component`, `${String(c)} is not a component`);
      } else {
        const a = own(covers, 'asset');
        if (typeof a !== 'string' || !/^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/.test(a)) r.bad(`${p}.covers.asset`, 'must be videoId/assetId');
        else if (!assetKeys.has(a)) r.bad(`${p}.covers.asset`, `${a} is not an asset`);
      }
    }
  });
}

function readBinding(r: Reader, v: unknown, path: string): void {
  if (!isRec(v)) {
    r.bad(path, 'must be an object');
    return;
  }
  const type = r.oneOf(own(v, 'type'), `${path}.type`, ['SPEC_ASSET', 'SONIC_ASSET', 'COMPONENT', 'CANONICAL_DOCS'] as const);
  const fields: Record<string, readonly string[]> = { SPEC_ASSET: ['specAssetId', 'sha256'], SONIC_ASSET: ['sonicAssetId'], COMPONENT: ['componentId'], CANONICAL_DOCS: ['docPath', 'blob'] };
  if (type === null) {
    for (const k of Object.keys(v)) if (k !== 'type') r.bad(`${path}.${k}`, 'unknown field');
    return;
  }
  const rec = r.shape(v, path, ['type', ...fields[type]!]);
  if (!rec) return;
  if (type === 'SPEC_ASSET') {
    r.id(own(rec, 'specAssetId'), `${path}.specAssetId`);
    r.hex64(own(rec, 'sha256'), `${path}.sha256`);
  } else if (type === 'SONIC_ASSET') {
    r.id(own(rec, 'sonicAssetId'), `${path}.sonicAssetId`);
  } else if (type === 'COMPONENT') {
    r.id(own(rec, 'componentId'), `${path}.componentId`);
  } else {
    r.path(own(rec, 'docPath'), `${path}.docPath`);
    if (typeof own(rec, 'blob') !== 'string' || !/^[0-9a-f]{40}$/.test(own(rec, 'blob') as string)) r.bad(`${path}.blob`, 'must be a 40-hex git blob id');
  }
}

/** Reads the videos and returns the `videoId/assetId` key of every asset, for the media inventory to be checked against. */
function readVideos(r: Reader, v: unknown, componentIds: ReadonlySet<string>): Set<string> {
  const assetKeys = new Set<string>();
  const list = r.array(v, 'videos', 1, 100);
  if (!list) return assetKeys;
  const videoIds = new Set<string>();
  list.forEach((video, i) => {
    const p = `videos[${i}]`;
    const rec = r.shape(video, p, ['videoId', 'release', 'assets', 'absent']);
    if (!rec) return;
    const videoId = r.id(own(rec, 'videoId'), `${p}.videoId`);
    if (videoId) {
      if (videoIds.has(videoId)) r.bad(`${p}.videoId`, `duplicate id ${videoId}`);
      videoIds.add(videoId);
    }

    const release = r.shape(own(rec, 'release'), `${p}.release`, ['state'], ['ownerAuthorization']);
    if (release) {
      const state = r.oneOf(own(release, 'state'), `${p}.release.state`, RELEASE_STATES);
      const auth = own(release, 'ownerAuthorization');
      if (auth !== undefined) {
        if (state !== null && state !== 'PUBLIC') r.bad(`${p}.release.ownerAuthorization`, 'only the PUBLIC state records one');
        const a = r.shape(auth, `${p}.release.ownerAuthorization`, ['authorizedBy', 'transition', 'receiptSha256']);
        if (a) {
          r.exactly(own(a, 'authorizedBy'), `${p}.release.ownerAuthorization.authorizedBy`, 'OWNER');
          r.exactly(own(a, 'transition'), `${p}.release.ownerAuthorization.transition`, 'UNLISTED->PUBLIC');
          r.hex64(own(a, 'receiptSha256'), `${p}.release.ownerAuthorization.receiptSha256`);
        }
      } else if (state === 'PUBLIC') {
        r.bad(`${p}.release.ownerAuthorization`, 'required in the PUBLIC state (only the owner authorizes UNLISTED -> PUBLIC)');
      }
    }

    const present = new Set<string>();
    const assetIds = new Set<string>();
    r.array(own(rec, 'assets'), `${p}.assets`, 0, 500)?.forEach((asset, j) => {
      const ap = `${p}.assets[${j}]`;
      const a = r.shape(asset, ap, ['id', 'category', 'binding', 'rightsBasis', 'status', 'licenseExpression', 'evidence'], ['resolution', 'clearance']);
      if (!a) return;
      const id = r.id(own(a, 'id'), `${ap}.id`);
      if (id) {
        if (assetIds.has(id)) r.bad(`${ap}.id`, `duplicate id ${id}`);
        assetIds.add(id);
        if (videoId) assetKeys.add(`${videoId}/${id}`);
      }
      const category = r.oneOf(own(a, 'category'), `${ap}.category`, ASSET_CATEGORIES);
      if (category) present.add(category);
      readBinding(r, own(a, 'binding'), `${ap}.binding`);
      const binding = own(a, 'binding');
      if (isRec(binding) && own(binding, 'type') === 'COMPONENT') {
        const cid = own(binding, 'componentId');
        if (typeof cid === 'string' && ID.test(cid) && !componentIds.has(cid)) r.bad(`${ap}.binding.componentId`, `${cid} is not a component`);
      }
      readClaim(r, a, ap);
    });

    const seen = new Set<string>();
    r.array(own(rec, 'absent'), `${p}.absent`, 0, ASSET_CATEGORIES.length)?.forEach((c, j) => {
      const category = r.oneOf(c, `${p}.absent[${j}]`, ASSET_CATEGORIES);
      if (!category) return;
      if (seen.has(category)) r.bad(`${p}.absent`, `duplicate ${category}`);
      seen.add(category);
      if (present.has(category)) r.bad(`${p}.absent`, `${category} is both an asset and declared absent`);
    });
    for (const category of ASSET_CATEGORIES) if (!present.has(category) && !seen.has(category)) r.bad(p, `category ${category} is neither an asset nor declared absent`);
  });
  return assetKeys;
}

function readSourceCode(r: Reader, v: unknown): void {
  const rec = r.shape(v, 'sourceCode', ['defaultLicense', 'copyright', 'licenseFiles', 'python']);
  if (!rec) return;
  r.oneOf(own(rec, 'defaultLicense'), 'sourceCode.defaultLicense', ['MIT'] as const);
  r.str(own(rec, 'copyright'), 'sourceCode.copyright', 120);
  r.array(own(rec, 'licenseFiles'), 'sourceCode.licenseFiles', 1, 10)?.forEach((f, i) => {
    const p = `sourceCode.licenseFiles[${i}]`;
    const e = r.shape(f, p, ['license', 'path', 'sha256']);
    if (!e) return;
    r.oneOf(own(e, 'license'), `${p}.license`, ['MIT', 'GPL-3.0-or-later'] as const);
    r.path(own(e, 'path'), `${p}.path`);
    r.hex64(own(e, 'sha256'), `${p}.sha256`);
  });
  const paths = new Set<string>();
  r.array(own(rec, 'python'), 'sourceCode.python', 0, 500)?.forEach((f, i) => {
    const p = `sourceCode.python[${i}]`;
    const e = r.shape(f, p, ['path', 'classification', 'license', 'reason'], ['ownerReview']);
    if (!e) return;
    const file = r.path(own(e, 'path'), `${p}.path`);
    const review = own(e, 'ownerReview');
    if (review !== undefined) {
      if (own(e, 'classification') !== 'BLENDER_INDEPENDENT') r.bad(`${p}.ownerReview`, 'only a BLENDER_INDEPENDENT entry takes an owner review (a coupled file needs none: it is recorded as coupled)');
      const o = r.shape(review, `${p}.ownerReview`, ['reviewedBy', 'reviewedOn', 'fileSha256', 'basis']);
      if (o) {
        r.exactly(own(o, 'reviewedBy'), `${p}.ownerReview.reviewedBy`, 'OWNER');
        r.date(own(o, 'reviewedOn'), `${p}.ownerReview.reviewedOn`);
        r.hex64(own(o, 'fileSha256'), `${p}.ownerReview.fileSha256`);
        r.str(own(o, 'basis'), `${p}.ownerReview.basis`);
      }
    }
    if (file) {
      if (paths.has(file)) r.bad(`${p}.path`, `duplicate path ${file}`);
      paths.add(file);
    }
    const classification = r.oneOf(own(e, 'classification'), `${p}.classification`, BLENDER_CLASSIFICATIONS);
    const license = r.str(own(e, 'license'), `${p}.license`, 60);
    r.str(own(e, 'reason'), `${p}.reason`);
    if (classification && license) {
      if (classification === 'BLENDER_API_COUPLED' && license !== BLENDER_COUPLED_LICENSE) r.bad(`${p}.license`, `a BLENDER_API_COUPLED file is ${BLENDER_COUPLED_LICENSE}`);
      else if (classification === 'REVIEW_REQUIRED' && license !== BLENDER_COUPLED_LICENSE) r.bad(`${p}.license`, `a REVIEW_REQUIRED file is treated as ${BLENDER_COUPLED_LICENSE} until it is decided`);
      else if (classification === 'BLENDER_INDEPENDENT' && !GPL_COMPATIBLE_LICENSES.has(license)) r.bad(`${p}.license`, 'an independent file keeps a GPL-compatible license');
    }
  });
}

/** A rule names its packages exactly one way: one package, a name prefix, or a list of at least two distinct packages. */
function readNpmMatch(r: Reader, match: unknown, path: string): void {
  if (!isRec(match)) {
    r.bad(path, 'must be an object');
    return;
  }
  const keys = Object.keys(match);
  const key = keys[0];
  if (keys.length !== 1 || (key !== 'package' && key !== 'prefix' && key !== 'packages')) {
    r.bad(path, 'must be exactly one of package, prefix, or packages');
    return;
  }
  const value = own(match, key);
  if (key === 'packages') {
    const list = Array.isArray(value) ? value : null;
    if (list === null || list.length < 2 || list.length > 100 || !list.every((x) => typeof x === 'string' && x.length > 0) || new Set(list).size !== list.length) r.bad(`${path}.packages`, 'must be a list of 2 to 100 distinct non-empty package names');
  } else if (typeof value !== 'string' || value.length < 1) {
    r.bad(`${path}.${key}`, 'must be a non-empty string');
  }
}

function readDependencies(r: Reader, v: unknown, componentIds: ReadonlySet<string>): void {
  const rec = r.shape(v, 'dependencies', ['npm', 'cargo']);
  if (!rec) return;
  const npm = r.shape(own(rec, 'npm'), 'dependencies.npm', ['lockfile', 'rules']);
  if (npm) {
    r.path(own(npm, 'lockfile'), 'dependencies.npm.lockfile');
    const ruleIds = new Set<string>();
    r.array(own(npm, 'rules'), 'dependencies.npm.rules', 0, 300)?.forEach((rule, i) => {
      const p = `dependencies.npm.rules[${i}]`;
      const e = r.shape(rule, p, ['id', 'match', 'version', 'lockLicense', 'resolvedLicense', 'component', 'evidence']);
      if (!e) return;
      const id = r.id(own(e, 'id'), `${p}.id`);
      if (id) {
        if (ruleIds.has(id)) r.bad(`${p}.id`, `duplicate id ${id}`);
        ruleIds.add(id);
      }
      readNpmMatch(r, own(e, 'match'), `${p}.match`);
      const version = own(e, 'version');
      const lockLicense = own(e, 'lockLicense');
      if (version !== null && (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version))) r.bad(`${p}.version`, 'must be an exact version or null');
      if (lockLicense !== null && (typeof lockLicense !== 'string' || lockLicense.length < 1)) r.bad(`${p}.lockLicense`, 'must be the license string the lockfile records, or null for none');
      if (lockLicense === null && version === null) r.bad(`${p}.version`, 'required when the lockfile records no license (the evidence is for one version)');
      const resolved = own(e, 'resolvedLicense');
      const component = own(e, 'component');
      if ((resolved === null) === (component === null)) r.bad(p, 'exactly one of resolvedLicense and component');
      if (typeof resolved === 'string' && parseSpdx(resolved) === null) r.bad(`${p}.resolvedLicense`, 'not a valid SPDX expression');
      if (typeof component === 'string' && !componentIds.has(component)) r.bad(`${p}.component`, `${component} is not a component`);
      readEvidence(r, own(e, 'evidence'), `${p}.evidence`);
    });
  }
  const cargo = r.shape(own(rec, 'cargo'), 'dependencies.cargo', ['lockfile', 'crates']);
  if (cargo) {
    r.path(own(cargo, 'lockfile'), 'dependencies.cargo.lockfile');
    const keys = new Set<string>();
    r.array(own(cargo, 'crates'), 'dependencies.cargo.crates', 0, 300)?.forEach((crate, i) => {
      const p = `dependencies.cargo.crates[${i}]`;
      const e = r.shape(crate, p, ['name', 'version', 'checksum', 'license', 'linkage', 'evidence']);
      if (!e) return;
      const name = r.str(own(e, 'name'), `${p}.name`, 80);
      const version = r.str(own(e, 'version'), `${p}.version`, 40);
      if (name && version) {
        if (keys.has(`${name}@${version}`)) r.bad(p, `duplicate crate ${name}@${version}`);
        keys.add(`${name}@${version}`);
      }
      r.hex64(own(e, 'checksum'), `${p}.checksum`);
      const license = r.str(own(e, 'license'), `${p}.license`, 120);
      if (license && parseSpdx(license) === null) r.bad(`${p}.license`, 'not a valid SPDX expression');
      r.oneOf(own(e, 'linkage'), `${p}.linkage`, LINKAGES);
      readEvidence(r, own(e, 'evidence'), `${p}.evidence`);
    });
  }
}

/** Every string in the manifest, for the privacy scan (the manifest is public). */
function strings(v: unknown, path: string, out: [string, string][]): void {
  if (typeof v === 'string') out.push([path, v]);
  else if (Array.isArray(v)) v.forEach((x, i) => strings(x, `${path}[${i}]`, out));
  else if (isRec(v)) for (const k of Object.keys(v)) strings(v[k], path === '' ? k : `${path}.${k}`, out);
}

function scanPrivacy(r: Reader, manifest: unknown): void {
  const found: [string, string][] = [];
  strings(manifest, '', found);
  for (const [path, text] of found) {
    // Every kind of leak a string holds is reported, not just the first, so one edit can fix them all.
    const found = [localPathIn(text, []), credentialPatternIn(text), EMAIL.test(text) ? 'an email address' : null, ...ACCOUNT_PATTERNS.filter((a) => a.re.test(text)).map((a) => a.what)];
    for (const what of found) if (what) r.bad(path, `holds ${what}`);
  }
}

/** Validate a parsed manifest. `problems` is sorted and deterministic; empty means the shape and its internal rules hold. */
export function validateManifest(value: unknown): { problems: string[]; manifest: RightsManifest | null } {
  const r = new Reader();
  const rec = r.shape(value, '', ['schema', 'project', 'verifiedOn', 'documents', 'sourceCode', 'components', 'dependencies', 'mediaFiles', 'videos']);
  if (rec) {
    r.exactly(own(rec, 'schema'), 'schema', RIGHTS_SCHEMA);
    r.id(own(rec, 'project'), 'project');
    r.date(own(rec, 'verifiedOn'), 'verifiedOn');
    const docs = r.shape(own(rec, 'documents'), 'documents', ['notices', 'licensing', 'policy']);
    if (docs) for (const k of ['notices', 'licensing', 'policy']) r.path(own(docs, k), `documents.${k}`);
    readSourceCode(r, own(rec, 'sourceCode'));
    const ids = readComponents(r, own(rec, 'components'));
    readDependencies(r, own(rec, 'dependencies'), ids);
    const assetKeys = readVideos(r, own(rec, 'videos'), ids);
    readMediaFiles(r, own(rec, 'mediaFiles'), ids, assetKeys);
    scanPrivacy(r, value);
  }
  const problems = [...new Set(r.problems)].sort();
  return { problems, manifest: problems.length === 0 ? (value as RightsManifest) : null };
}

/** The identity of the manifest: sha256 of its canonical JSON. A publication receipt can bind to it. */
export function rightsManifestSha256(manifest: unknown): string {
  return contentAddress(manifest);
}

export { canonicalJson as canonicalRightsJson };
