// What the published docs site actually serves, derived from the same two files
// Mintlify uses: docs/docs.json (navigation) and docs/.mintignore (exclusions).
// A video may only point at a page that is in navigation and not excluded.
// Isomorphic: callers pass file contents in.

export interface DocsSite {
  baseUrl: string;
  /** slug (no extension, no leading slash) -> navigation group names, outermost first. */
  pages: Map<string, string[]>;
  ignorePatterns: string[];
}

export function buildDocsSite(baseUrl: string, docsJsonText: string, mintignoreText: string): DocsSite {
  const nav = (JSON.parse(docsJsonText) as { navigation?: unknown }).navigation;
  const pages = new Map<string, string[]>();
  walk(nav, [], pages);
  const ignorePatterns = mintignoreText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  return { baseUrl: baseUrl.replace(/\/+$/, ''), pages, ignorePatterns };
}

function walk(node: unknown, groups: string[], out: Map<string, string[]>): void {
  if (typeof node === 'string') {
    if (!out.has(node)) out.set(node, groups);
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) walk(child, groups, out);
    return;
  }
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    const label = [obj.group, obj.tab, obj.anchor, obj.dropdown].find((v) => typeof v === 'string') as string | undefined;
    const next = label ? [...groups, label] : groups;
    for (const key of ['tabs', 'anchors', 'dropdowns', 'groups', 'pages', 'navigation']) {
      if (key in obj) walk(obj[key], next, out);
    }
  }
}

/** docs/concepts/migration-readiness.mdx -> concepts/migration-readiness */
export function docSlug(docPath: string): string {
  return docPath.replace(/^docs\//, '').replace(/\.(mdx|md)$/, '');
}

/**
 * gitignore-style matching, as Mintlify applies .mintignore. Negations are not
 * honored, which errs toward "not published" (the safe direction for a video
 * that must link to a live page).
 */
export function isMintignored(site: DocsSite, docPath: string): boolean {
  const rel = docPath.replace(/^docs\//, '');
  return site.ignorePatterns.some((p) => !p.startsWith('!') && patternToRegExp(p).test(rel));
}

export function patternToRegExp(raw: string): RegExp {
  let p = raw;
  let anchored = false;
  let dirOnly = false;
  if (p.startsWith('/')) {
    anchored = true;
    p = p.slice(1);
  }
  if (p.endsWith('/')) {
    dirOnly = true;
    p = p.slice(0, -1);
  }
  if (p.includes('/')) anchored = true; // a slash before the end anchors the pattern to the root
  const prefix = anchored ? '^' : '^(?:.*/)?';
  const suffix = dirOnly ? '/.*$' : '(?:/.*)?$';
  return new RegExp(prefix + globToRegExp(p).source.slice(1, -1) + suffix);
}

export interface PublishedPage {
  published: boolean;
  url: string;
  groups: string[];
  reason?: 'NOT_IN_NAVIGATION' | 'MINTIGNORED';
}

export function publishedPage(site: DocsSite, docPath: string): PublishedPage {
  const slug = docSlug(docPath);
  const url = `${site.baseUrl}/${slug}`;
  const groups = site.pages.get(slug);
  if (isMintignored(site, docPath)) return { published: false, url, groups: groups ?? [], reason: 'MINTIGNORED' };
  if (!groups) return { published: false, url, groups: [], reason: 'NOT_IN_NAVIGATION' };
  return { published: true, url, groups };
}

function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] as string;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++;
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}
