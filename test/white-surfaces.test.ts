// Nothing WalletWall authors may be white: the parchment of cards and panels, the text that must stay
// readable on it, and an audit of the Remotion source that names every white-reading token it still
// uses. External captured UI may contain white; the audit never looks inside it (this lesson has none).

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { TOKENS } from '../src/brand/tokens.ts';
import { isWhiteish, loadVisualConfig } from '../src/blender/visual.ts';
import { EXCEPTIONS, isPureWhite, paletteEntries, scanSources } from '../src/blender/white-audit.ts';

const visual = loadVisualConfig();

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const lin = (c: number): number => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const lum = (c: [number, number, number]): number => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const ratio = (a: [number, number, number], b: [number, number, number]): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};
const rgba = (s: string): [number, number, number, number] => {
  const m = /rgba\((\d+),(\d+),(\d+),([\d.]+)\)/.exec(s);
  assert.ok(m, s);
  return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
};
/** A translucent text colour as it lands on an opaque ground. */
const over = (fg: string, bg: [number, number, number]): [number, number, number] => {
  const [r, g, b, a] = rgba(fg);
  return [r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a)];
};

describe('authored cards and panels are warm parchment, never white', () => {
  const paper = rgb(TOKENS.paper);
  /** The card as it was: the surface token at the card token's alpha over the canvas. */
  const oldCard = over(`rgba(${rgb(TOKENS.surface).join(',')},${rgba(TOKENS.card)[3]})`, paper);
  const parchment = rgb(visual.flat.surface);

  test('the parchment is not white-ish, is darker than the old card, and has a hue (positive control: the old card was white-ish)', () => {
    assert.ok(!isWhiteish(visual.flat.surface, visual.whiteGuard));
    assert.ok(!isPureWhite(visual.flat.surface));
    const oldHex = `#${oldCard.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
    assert.ok(isWhiteish(oldHex, visual.whiteGuard), `${oldHex} was white-ish`);
    assert.ok(lum(parchment) < lum(oldCard));
  });

  test('text keeps more contrast on the parchment than it had on the old card: body, muted, and link', () => {
    for (const [what, text] of [
      ['ink', visual.flat.text.ink],
      ['muted', visual.flat.text.muted],
    ] as const) {
      const before = ratio(over(what === 'ink' ? TOKENS.ink : TOKENS.inkMuted, oldCard), oldCard);
      const after = ratio(over(text, parchment), parchment);
      assert.ok(after >= before, `${what}: ${after.toFixed(2)} on parchment vs ${before.toFixed(2)} on the old card`);
      // And on the canvas, where headings and captions sit.
      assert.ok(ratio(over(text, paper), paper) >= ratio(over(what === 'ink' ? TOKENS.ink : TOKENS.inkMuted, paper), paper));
    }
    assert.ok(ratio(rgb(visual.flat.text.link), parchment) >= ratio(rgb(TOKENS.terracottaDark), oldCard), 'the link colour');
    // Readable by WCAG AA at every size, not only better than before.
    assert.ok(ratio(over(visual.flat.text.muted, parchment), parchment) >= 4.5);
  });
});

describe('the white-surface audit', () => {
  test('the palette has no pure white and no white-ish colour except the canvas, which is a named exception', () => {
    const entries = paletteEntries(visual);
    assert.ok(entries.length >= 20);
    assert.equal(entries.filter((e) => e.pureWhite).length, 0);
    assert.deepEqual(entries.filter((e) => e.whiteish).map((e) => e.name), ['canvas (paper)']);
  });

  test('the Remotion source uses no white-reading token or literal except the named exceptions (positive controls: the scan names them)', () => {
    const { forbidden, exceptions } = scanSources();
    assert.deepEqual(forbidden, [], forbidden.map((f) => `${f.file}:${f.line} ${f.what}`).join('; '));
    assert.ok(exceptions.length >= 3, 'the canvas and the caption text are found and named');
    for (const e of exceptions) assert.ok(e.why.length > 20, `${e.file}:${e.line} has a reason on record`);
    // Every exception rule is used (a stale one is a loophole waiting for a new occurrence).
    for (const rule of EXCEPTIONS) assert.ok(exceptions.some((e) => rule.file.test(e.file) && e.what === rule.what), `unused exception: ${rule.what} in ${rule.file}`);
  });

  test('a white card is caught by the scan (positive control)', () => {
    assert.ok(isPureWhite('#FFFFFF') && isPureWhite('#FDFDFB') && !isPureWhite(TOKENS.paper));
    assert.ok(isWhiteish(TOKENS.surface, visual.whiteGuard) && isWhiteish(TOKENS.card.length > 0 ? '#F8F2E4' : '#000000', visual.whiteGuard));
  });
});
