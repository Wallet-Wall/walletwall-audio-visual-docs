// SPDX license expressions (https://spdx.github.io/spdx-spec/v2.3/SPDX-license-expressions/), just enough to judge a
// dependency's declared license against the encoded policy. Anything that does not fully parse is `null`, never a
// guess: `SEE LICENSE IN LICENSE.md`, `UNLICENSED`-style prose, a stray comma, or a lowercase `or` all fail closed.
// Identifiers are matched exactly (never case-folded into acceptance). No I/O, no environment.

export type SpdxNode =
  | { kind: 'id'; id: string }
  | { kind: 'with'; license: SpdxNode; exception: string }
  | { kind: 'and' | 'or'; left: SpdxNode; right: SpdxNode };

const TOKEN = /\s*(\(|\)|[A-Za-z0-9][A-Za-z0-9.+-]*)/y;

function tokenize(expression: string): string[] | null {
  const tokens: string[] = [];
  TOKEN.lastIndex = 0;
  let at = 0;
  while (at < expression.length) {
    if (/^\s*$/.test(expression.slice(at))) break;
    TOKEN.lastIndex = at;
    const m = TOKEN.exec(expression);
    if (!m) return null;
    tokens.push(m[1]!);
    at = TOKEN.lastIndex;
  }
  return tokens.length > 0 ? tokens : null;
}

const OPERATORS = new Set(['AND', 'OR', 'WITH']);

/** The parsed expression, or null when it is not a complete, well-formed SPDX expression. */
export function parseSpdx(expression: string): SpdxNode | null {
  const tokens = tokenize(expression);
  if (!tokens) return null;
  let i = 0;

  const primary = (): SpdxNode | null => {
    const t = tokens[i];
    if (t === undefined) return null;
    if (t === '(') {
      i++;
      const inner = or();
      if (inner === null || tokens[i] !== ')') return null;
      i++;
      return inner;
    }
    if (t === ')' || OPERATORS.has(t)) return null;
    i++;
    let node: SpdxNode = { kind: 'id', id: t };
    if (tokens[i] === 'WITH') {
      i++;
      const exception = tokens[i];
      if (exception === undefined || exception === '(' || exception === ')' || OPERATORS.has(exception)) return null;
      i++;
      node = { kind: 'with', license: node, exception };
    }
    return node;
  };

  const and = (): SpdxNode | null => {
    let left = primary();
    while (left !== null && tokens[i] === 'AND') {
      i++;
      const right = primary();
      if (right === null) return null;
      left = { kind: 'and', left, right };
    }
    return left;
  };

  const or = (): SpdxNode | null => {
    let left = and();
    while (left !== null && tokens[i] === 'OR') {
      i++;
      const right = and();
      if (right === null) return null;
      left = { kind: 'or', left, right };
    }
    return left;
  };

  const node = or();
  return node !== null && i === tokens.length ? node : null;
}

/** Whether the expression is satisfied: OR needs one side, AND both; a WITH exception must itself be accepted. */
export function spdxSatisfied(node: SpdxNode, accepted: ReadonlySet<string>, exceptions: ReadonlySet<string> = new Set()): boolean {
  switch (node.kind) {
    case 'id':
      return accepted.has(node.id);
    case 'with':
      return exceptions.has(node.exception) && spdxSatisfied(node.license, accepted, exceptions);
    case 'and':
      return spdxSatisfied(node.left, accepted, exceptions) && spdxSatisfied(node.right, accepted, exceptions);
    case 'or':
      return spdxSatisfied(node.left, accepted, exceptions) || spdxSatisfied(node.right, accepted, exceptions);
  }
}

/** Every WITH exception the expression uses, in order. */
export function spdxExceptions(node: SpdxNode): string[] {
  switch (node.kind) {
    case 'id':
      return [];
    case 'with':
      return [...spdxExceptions(node.license), node.exception];
    case 'and':
    case 'or':
      return [...spdxExceptions(node.left), ...spdxExceptions(node.right)];
  }
}

/** Every license identifier the expression mentions, in order (exceptions excluded). */
export function spdxIds(node: SpdxNode): string[] {
  switch (node.kind) {
    case 'id':
      return [node.id];
    case 'with':
      return spdxIds(node.license);
    case 'and':
    case 'or':
      return [...spdxIds(node.left), ...spdxIds(node.right)];
  }
}
