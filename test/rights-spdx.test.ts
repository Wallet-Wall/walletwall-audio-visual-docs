// The SPDX license-expression evaluator behind `npm run rights:check`: a license a dependency declares is accepted
// only when an expression we can fully parse is satisfied by the encoded policy. Anything else fails closed.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseSpdx, spdxIds, spdxSatisfied } from '../src/rights/spdx.ts';

const ACCEPTED = new Set(['MIT', 'ISC', 'Apache-2.0', 'BSD-3-Clause', 'Unicode-3.0']);
const ok = (expr: string, accepted: ReadonlySet<string> = ACCEPTED, exceptions: ReadonlySet<string> = new Set()): boolean => {
  const node = parseSpdx(expr);
  return node !== null && spdxSatisfied(node, accepted, exceptions);
};

describe('SPDX expressions', () => {
  test('a simple identifier is accepted only when the policy lists it', () => {
    assert.equal(ok('MIT'), true);
    assert.equal(ok('GPL-3.0-or-later'), false);
    assert.equal(ok('mit'), false, 'identifiers are matched exactly, never case-folded into acceptance');
  });

  test('OR needs one acceptable side, AND needs both', () => {
    assert.equal(ok('MIT OR GPL-3.0-or-later'), true);
    assert.equal(ok('GPL-3.0-or-later OR AGPL-3.0-only'), false);
    assert.equal(ok('MIT AND GPL-3.0-or-later'), false);
    assert.equal(ok('(MIT OR Apache-2.0) AND Unicode-3.0'), true);
    assert.equal(ok('(MIT OR Apache-2.0) AND CC-BY-NC-4.0'), false);
  });

  test('AND binds tighter than OR', () => {
    // MIT OR (GPL-3.0-or-later AND ISC): MIT alone satisfies it.
    assert.equal(ok('MIT OR GPL-3.0-or-later AND ISC'), true);
    // (GPL-3.0-or-later AND ISC) OR AGPL-3.0-only: neither alternative is acceptable.
    assert.equal(ok('GPL-3.0-or-later AND ISC OR AGPL-3.0-only'), false);
  });

  test('a WITH exception counts only when the exception itself is accepted', () => {
    assert.equal(ok('MIT WITH LLVM-exception'), false);
    assert.equal(ok('MIT WITH LLVM-exception', ACCEPTED, new Set(['LLVM-exception'])), true);
  });

  test('a custom LicenseRef is never acceptable on its own', () => {
    assert.equal(ok('LicenseRef-Remotion'), false);
  });

  test('anything that does not fully parse is refused, never guessed', () => {
    for (const bad of ['', ' ', 'MIT OR', 'OR MIT', '(MIT', 'MIT)', 'MIT AND AND ISC', 'SEE LICENSE IN LICENSE.md', 'Remotion License', 'MIT, ISC', 'MIT/ISC', 'UNLICENSED ISC']) {
      assert.equal(parseSpdx(bad), null, JSON.stringify(bad));
      assert.equal(ok(bad), false, JSON.stringify(bad));
    }
  });

  test('operators are matched exactly; a lowercase "or" is an identifier, which breaks the expression', () => {
    assert.equal(parseSpdx('MIT or ISC'), null);
  });

  test('every identifier an expression mentions is listed, in order, without operators', () => {
    assert.deepEqual(spdxIds(parseSpdx('(MIT OR Apache-2.0) AND Unicode-3.0')!), ['MIT', 'Apache-2.0', 'Unicode-3.0']);
    assert.deepEqual(spdxIds(parseSpdx('GPL-2.0-only WITH Classpath-exception-2.0')!), ['GPL-2.0-only']);
  });

  test('a trailing + is "or later" and is part of the identifier the policy sees', () => {
    assert.equal(ok('GPL-3.0+', new Set(['GPL-3.0+'])), true);
    assert.equal(ok('GPL-3.0+'), false);
  });
});
