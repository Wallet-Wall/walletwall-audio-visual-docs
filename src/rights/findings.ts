// One finding of the release-rights check: a stable code (an operator and a reviewer act on the code, not the prose),
// the thing it is about, and a message. Findings are ordered by (code, path, message) so the report is deterministic.

export interface Finding {
  code: string;
  path: string;
  message: string;
}

export function sortFindings(findings: readonly Finding[]): Finding[] {
  const key = (f: Finding): string => `${f.code}\u0000${f.path}\u0000${f.message}`;
  return [...findings].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}
