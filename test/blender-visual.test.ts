// The Blender lane's visual constants (config/blender-visual.json), without Blender:
// every colour is a brand token or a derived mix of two, none of them is white, the
// loader refuses anything else, the constants are part of every frame's identity, and
// the lane's Python types no colour of its own. Blender itself draws these in
// `npm run blender:review` / `blender:contact` (docs/BLENDER_VISUAL.md).

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { TOKENS } from '../src/brand/tokens.ts';
import { BLENDER_VISUAL_REL, BlenderVisualError, isWhiteish, loadVisualConfig, lumaChroma, resolveColor, resolveVisual } from '../src/blender/visual.ts';
import { blenderConfigSha256, BLENDER_LANE_DIR, loadBlenderConfig } from '../src/blender/toolchain.ts';
import { VIDEO_ROOT } from '../src/config/load.ts';

const raw = () => JSON.parse(readFileSync(path.join(VIDEO_ROOT, BLENDER_VISUAL_REL), 'utf8'));
const visual = loadVisualConfig();

describe('the lane has a warm palette with no white', () => {
  test('the guard names the whites the docs theme and brand define (positive controls), and passes the warm stones', () => {
    for (const white of [TOKENS.paper, TOKENS.surface, TOKENS.cream, TOKENS.warmStone, TOKENS.mortar]) assert.ok(isWhiteish(white, visual.whiteGuard), `${white} is white-ish`);
    for (const warm of [TOKENS.stone, TOKENS.tan, TOKENS.stoneLow, TOKENS.terracotta]) assert.ok(!isWhiteish(warm, visual.whiteGuard), `${warm} is not`);
    assert.ok(isWhiteish('#FFFFFF', visual.whiteGuard) && isWhiteish('#E0E0E0', visual.whiteGuard));
  });

  test('every colour the lane draws is resolved, opaque, and not white-ish', () => {
    const colours: string[] = [
      ...Object.values(visual.palette),
      visual.terrain.edge,
      visual.terrain.line,
      visual.terrain.top,
      visual.terrain.topShade,
      visual.contactShadow.color,
      ...visual.terrain.strata.layers.flatMap((l) => [l.lit, l.shade]),
      visual.flat.surface,
      visual.flat.text.link,
    ];
    assert.ok(colours.length >= 16);
    for (const c of colours) {
      assert.match(c, /^#[0-9A-F]{6}$/);
      assert.ok(!isWhiteish(c, visual.whiteGuard), c);
    }
  });

  test('the cream accents are warm stone, shaded by the brand\'s darker stone (not derived toward grey)', () => {
    assert.equal(visual.palette.accent, TOKENS.stone.toUpperCase());
    assert.equal(visual.palette.accentShade, TOKENS.stoneLow.toUpperCase());
    // A shade is darker than its light, and each stratum's shade is warm (red above blue) like the stone itself.
    for (const l of visual.terrain.strata.layers) {
      assert.ok(lumaChroma(l.shade).luma < lumaChroma(l.lit).luma, `${l.lit} -> ${l.shade}`);
      const [r, , b] = [1, 3, 5].map((i) => parseInt(l.shade.slice(i, i + 2), 16));
      assert.ok(r! > b!, `${l.shade} is warm`);
    }
  });

  test('the loader refuses a white accent, an unknown token, a translucent token, and a collapsed strata set', () => {
    assert.doesNotThrow(() => resolveVisual(raw()), 'the real config passes');
    const bad: [string, (c: any) => void, RegExp][] = [
      ['a white accent', (c) => (c.palette.accent = 'cream'), /white-ish/],
      ['a near-white terrain top', (c) => (c.terrain.top = 'surface'), /white-ish/],
      ['a pale stratum', (c) => (c.terrain.strata.layers[0] = 'warmStone'), /white-ish/],
      ['a mix that lands on white', (c) => (c.palette.glint = { mix: ['cream', 'paper'], t: 0.5 }), /white-ish/],
      ['an unknown token', (c) => (c.palette.accent = 'sparkle'), /not an opaque brand colour token/],
      ['a translucent token', (c) => (c.terrain.edge = 'card'), /not an opaque brand colour token/],
      ['one stratum', (c) => (c.terrain.strata.layers = ['stone']), /at least two/],
      ['another schema', (c) => (c.schema = 'walletwall.blender-visual/v2'), /is not walletwall.blender-visual\/v1/],
      ['an inverted range', (c) => (c.terrain.strata.bandPx = [40, 10]), /bandPx/],
      ['a white card surface', (c) => (c.flat.surface = 'surface'), /flat.surface .* is white-ish/],
      ['a card surface that is paper itself', (c) => (c.flat.surface = 'paper'), /flat.surface .* is white-ish/],
      ['a pillar side that strays too far', (c) => (c.flat.pillar.sideJitterPx = 30), /sideJitterPx/],
      ['a missing flat kind', (c) => delete c.flat.ledge, /flat.ledge is missing/],
      ['text that is not a translucent token', (c) => (c.flat.text.ink.token = 'charcoal'), /not a translucent brand colour token/],
    ];
    for (const [what, mutate, re] of bad) {
      const c = raw();
      mutate(c);
      assert.throws(() => resolveVisual(c), (e: unknown) => e instanceof BlenderVisualError && re.test(e.message), what);
    }
  });

  test('a colour is a token or a mix of tokens: nothing typed', () => {
    assert.equal(resolveColor('stone'), '#E9D3AD');
    assert.match(resolveColor({ mix: ['stone', 'terracotta'], t: 0.5 }), /^#[0-9A-F]{6}$/);
    assert.throws(() => resolveColor('#FFFFFF'), BlenderVisualError);
    const text = readFileSync(path.join(VIDEO_ROOT, BLENDER_VISUAL_REL), 'utf8');
    assert.doesNotMatch(text, /#[0-9a-fA-F]{3,8}\b/, 'the config names tokens; it types no hex');
  });
});

describe('the constants are part of every frame\'s identity, and the lane types no colour', () => {
  test('the visual config is merged into the pinned config, so changing it changes the config hash', () => {
    const cfg = loadBlenderConfig();
    // The flat scenes' constants do not change a Blender frame, so they stay out of the Blender config (and its hash).
    const { flat: _flat, ...blenderPart } = visual;
    assert.deepEqual(cfg.visual, blenderPart);
    assert.ok(!('flat' in cfg.visual));
    const before = blenderConfigSha256(cfg);
    const edited = { ...cfg, visual: { ...cfg.visual, palette: { ...cfg.visual.palette, accent: '#E9D3AE' } } };
    assert.notEqual(blenderConfigSha256(edited), before);
  });

  test('the lane\'s Python takes every colour from the job: no hex literal, no white default', () => {
    for (const f of readdirSync(BLENDER_LANE_DIR).filter((x) => x.endsWith('.py'))) {
      const text = readFileSync(path.join(BLENDER_LANE_DIR, f), 'utf8');
      assert.doesNotMatch(text, /["']#[0-9a-fA-F]{3,8}["']/, `${f} types a colour`);
    }
    // Positive control: the check does catch the forms it names.
    assert.match('top = style.get("top", "#FFFFFF")', /["']#[0-9a-fA-F]{3,8}["']/);
  });

  test('the contact shadow is a warm umber, strongest at its core, and sized for a foot', () => {
    const s = visual.contactShadow;
    assert.ok(s.coreAlpha > s.penumbraAlpha && s.coreAlpha <= 0.6);
    assert.ok(lumaChroma(s.color).luma < 0.35, 'dark enough to read on the paper');
    assert.ok(s.widthPx > 2 * s.heightPx && s.spanFadePx > 0);
  });
});
