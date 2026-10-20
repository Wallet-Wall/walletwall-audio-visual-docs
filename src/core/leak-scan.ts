// The one leak policy for everything this repository writes for review or publication: local machine paths,
// this machine's own directories and names, and secret-shaped values. The public-output gate applies it to every
// artifact it verifies, the render-environment schema to every environment field (patterns only, so that a
// classification never depends on the machine that checks it), and the publication proof receipt to itself and
// its evidence. Callers pass this machine's roots and names; nothing here reads the environment. Node-only.

import path from 'node:path';

/**
 * Local machine paths. Applied to every artifact. Shaped so that repo-relative paths, `video/…`
 * workspace paths, and URLs (including ones whose path contains /home/) are not matched.
 */
const LOCAL_PATHS: readonly { re: RegExp; what: string }[] = [
  { re: /(?<![A-Za-z0-9])[A-Za-z]:[\\/](?![\\/])/, what: 'a Windows drive path' },
  { re: /(?:^|[\s"'`(=,;])\\\\[A-Za-z0-9._$-]+\\/, what: 'a UNC path' },
  { re: /(?:^|[\s"'`(=,;:])\/(?:Users|home|root)\/(?=[^\s/])/, what: 'a home-directory path' },
  // Temporary and system directories: where Remotion bundles, browser profiles, and toolchains live on a
  // Linux runner (/tmp, /opt/hostedtoolcache), a Mac (/private/var/folders), or WSL (/mnt/c).
  { re: /(?:^|[\s"'`(=,;:])\/(?:tmp|var|opt|mnt|private|proc|usr|etc|srv|run)\/(?=[^\s/])/, what: 'a temporary or system directory path' },
  { re: /(?:^|[\s"'`(=,;:])~[\\/]/, what: 'a home-relative path' },
  { re: /\bfile:\/\//i, what: 'a file:// URL' },
];

/**
 * In binary metadata a path can abut other printable bytes, so boundaries cannot be required there;
 * a home, temporary, or system directory with a name and a trailing separator is specific enough on
 * its own. (Not used on text, where it would match URLs such as https://host/home/page/.)
 */
const BINARY_LOCAL_PATH = /[\\/](?:Users|home|root|tmp|var|opt|mnt|private)[\\/][^\\/\s]{1,64}[\\/]/;

/** What kind of local machine path `text` holds, or null. `roots` are this machine's own directories (localRoots). */
export function localPathIn(text: string, roots: readonly string[], binary = false): string | null {
  for (const p of LOCAL_PATHS) if (p.re.test(text)) return p.what;
  if (binary && BINARY_LOCAL_PATH.test(text)) return 'a home, temporary, or system directory path';
  const lower = text.toLowerCase();
  for (const root of roots) if (lower.includes(root)) return 'an absolute path of this machine';
  return null;
}

/** This machine's absolute directories, in every spelling an artifact could carry them. */
export function localRoots(candidates: (string | undefined)[]): string[] {
  const roots = new Set<string>();
  for (const c of candidates) {
    if (!c) continue;
    const abs = path.resolve(c);
    // Never a filesystem root or a short path like /tmp: those would match ordinary text.
    if (abs.length < 8 || abs === path.parse(abs).root) continue;
    for (const form of [abs, abs.split(path.sep).join('/'), abs.split('/').join('\\')]) roots.add(form.toLowerCase());
  }
  return [...roots];
}

/**
 * Secret-shaped values: formats specific enough that ordinary copy, content hashes (lowercase hex), URLs, and
 * versions never match them. A generic "token: …" rule is deliberately absent: the lessons talk about tokens.
 */
const CREDENTIAL_PATTERNS: readonly { re: RegExp; what: string }[] = [
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, what: 'a private key' },
  { re: /\bgh[pousr]_[A-Za-z0-9]{36,}/, what: 'a GitHub token' },
  { re: /\bgithub_pat_[A-Za-z0-9_]{40,}/, what: 'a GitHub token' },
  { re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/, what: 'an AWS access key' },
  { re: /\bAIza[0-9A-Za-z_-]{35}/, what: 'a Google API key' },
  { re: /\bya29\.[0-9A-Za-z_-]{20,}/, what: 'a Google OAuth token' },
  { re: /\bxox[abprs]-[0-9A-Za-z-]{10,}/, what: 'a Slack token' },
  { re: /\bsk[-_](?:live_|test_|ant-|proj-)?[A-Za-z0-9_-]{24,}/, what: 'an API secret key' },
  { re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/, what: 'a JSON web token' },
  { re: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/i, what: 'a bearer token' },
  { re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i, what: 'credentials inside a URL' },
];

/** What kind of secret-shaped value `text` holds, or null. */
export function credentialPatternIn(text: string): string | null {
  return CREDENTIAL_PATTERNS.find((s) => s.re.test(text))?.what ?? null;
}

/** Generic identities shared by every CI runner or container: not names of this machine. */
const GENERIC_NAMES = new Set(['runner', 'root', 'admin', 'administrator', 'user', 'users', 'ubuntu', 'vscode', 'node', 'docker', 'localhost', 'localdomain', 'codespace', 'codespaces', 'github', 'default', 'guest']);

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether `text` names one of `names` (machineNames) as a whole word (letters and digits of any script are word characters). */
export function machineNameIn(text: string, names: readonly string[]): boolean {
  return names.some((n) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(n)}(?![\\p{L}\\p{N}])`, 'iu').test(text));
}

/**
 * This machine's host and user names, as the leak scan looks for them: whole words, three characters or more, not a
 * generic CI identity, and not a word of `vocabulary` (the repository's own committed records: a host named like the
 * video, a GPU vendor, or the engine cannot be told apart from the records themselves, so it is no leak signal).
 *
 * Names are looked for only where an artifact records machine facts (render and stills records, binary metadata, the
 * publication proof receipt and its evidence), never in authored copy: a host may be named with any word a lesson
 * says.
 */
export function machineNames(candidates: (string | undefined)[], vocabulary = ''): string[] {
  const names = new Set<string>();
  for (const c of candidates) {
    const whole = c?.trim().toLowerCase();
    if (!whole) continue;
    // The name as given, a host's own label (the first of a dotted name), and each word of a name with spaces.
    for (const n of [whole, whole.split('.')[0]!, ...whole.split(/\s+/)]) {
      if (n.length < 3 || !/^[\p{L}\p{N}._-]+$/u.test(n) || GENERIC_NAMES.has(n) || machineNameIn(vocabulary, [n])) continue;
      names.add(n);
    }
  }
  return [...names].sort();
}
