# WalletWall material pass: the Blender lane and the flat scenes

This is the visual and material refinement of the Blender presentation lane ([BLENDER.md](BLENDER.md)) and of the flat
teaching scenes Remotion draws. It changes what is drawn, never what is decided: the MotionPlan, the bridge, the rig, the
IK targets, the body's geometry, the declared terrain, every contact, and every authored destination are untouched, and the
production character renderer is still the Rive rig.

One config drives all of it, `config/blender-visual.json`, kept apart from `config/blender.json` (the toolchain and render
pins). Its Blender part is merged into the pinned config as `visual`, so it is hashed into every Blender frame's identity.
Its `flat` part reaches the Remotion scenes as a render input, and is recorded in the build identity
(`src/manifest/build-identity.ts`), so a frame made with other constants is distinguishable.

## The rule

> Nothing WalletWall authors is white.

A colour is **white-ish** when its sRGB luma is at least 0.80 and its chroma (max − min channel) is at most 0.14. Every
colour in the config is a **brand-token name or a derived mix of two** (never a typed hex), and `src/blender/visual-core.ts`
refuses a white-ish result. The guard names `paper`, `surface`, `cream`, `warmStone` and `mortar` and accepts `stone`, `tan`
and `stoneLow`. External captured UI (a screenshot inside a UI frame) may contain white; the audit never looks inside one.

## 1. The character's palette

The rig contract's cream accents (muzzle, chin, chest, inner ears, tail underside, eye glint) read as white against the
paper, and their shade was derived toward charcoal, a cold grey. The Blender body now uses the wall's warm stone, shaded by
the brand's darker stone:

| Accent | Before | After |
|---|---|---|
| lit | `cream` `#F5F1E8` | `stone` `#E9D3AD` |
| shade | `cream` 20% toward charcoal | `stoneLow` `#B99568` |

The coat is still WalletWallrus's own `#BA6F38`, the outline charcoal, the brick belly unchanged. The Rive rig's palette is
pinned by its rig version and is unchanged: until the character is cut over, the default render's character keeps the
rig's cream.

## 2. Authored cards and panels: parchment

Cards, nodes, the docs-reference panel, and the route-end markers were `#F8F2E4` at 82% over the paper, a near-white card.
They are now **parchment**: the paper pulled halfway toward stone, `#EEE0C6` (luma 0.88, chroma 0.16). Text keeps more
contrast than it had on the old card (`test/white-surfaces.test.ts` pins it), because the ground is darker:

| Text | Colour | On the old card | On parchment |
|---|---|---|---|
| body | ink at 96% (was 88%) | 11.0 : 1 | 12.1 : 1 |
| muted | ink at 76% (was 66%) | 5.3 : 1 | 6.8 : 1 |
| link | terracotta-dark mixed 30% toward charcoal | 7.3 : 1 | 7.7 : 1 |

## 3. Terrain, flat and deep

The terrain family is stratified sandstone: a worn cap stone where feet land, layers below it in `stone`, `tan`, a
rose-tinted stone, `stoneLow` and an iron-rich tan, each layer with its own thickness, slanted ends, and a shade stretch
along its lower edge, drawn with a charcoal edge. Every choice is a **hash of the support's own id**: the same support is
the same rock in every frame and every render, and nothing is random.

**Flat scenes** (`src/remotion/scenes/terrain-art.tsx`, geometry in `src/layout/rock.ts`). Only **dedicated physical
support geometry** is cut as terrain:

| Support | Where | Treatment |
|---|---|---|
| the ground | CTA, docs reference, outro, end screen (and every scene that stands on the ground line) | a 30 px strata shelf under the ground line, its lower edge broken, its free end slanted |
| the summit ledge | the takeaway | strata under a cap stone; the sides taper below the contact zone |
| the pillars | under each tier node | strata columns; the sides stay within 3 px of the declared face |
| the slabs | the layered scene behind the nodes | the same strata as bands across the plane, in its own perspective |

A **card or node is content** and stays a card (parchment, text, a fine edge). It is never turned into rock.

**Exact support coordinates.** A formation is cut *inside* its support's declared rectangle. Its top edge is the declared
top, flush: the ground line stays one px at `GROUND_Y`, the cap stone starts at the declared `y`. Within the contact zone
below the top (40 px for the ledge, the whole height for a pillar) a side stays within the jitter (3 px) of the declared
face, so a hand that braces or grips the lip meets the rock where the motion system put it. Only below that zone, where
nothing touches, may a side taper. `test/terrain-art.test.ts` checks this on every real support and pins the declared
terrain and layouts of the lesson to main's content address, so nothing a body touches moved.

**Depth views** (`blender/walletwallaby/terrain.py`, `transition.py`). Every declared block seen in the signature
transition and the contact views is the same rock, built as stacked prisms: a cap stone, then strata with fractured ends and
a setback at the back. The front face on the teaching plane is Remotion's own pixels, projected, so the flat frame at both
ends of the transition is exactly what Remotion draws. The rock fades ahead of the card's own dissolve (dithered
transparency, so a card in front is never drawn under it).

## 4. Contact shadow

A warm umber (`charcoal` mixed 45% toward `terracotta-dark`) with a tight core and a soft penumbra, wider than the foot. It
is clipped to the support under the feet (the horizontal extent of the declared block that owns the surface), so it never
hangs over an edge; darker after a hard landing; and shown, as before, only while the feet are on a declared surface.

## The audit

`node scripts/review/white-audit.ts --before=<stills dir> --after=<stills dir>` reports, and exits non-zero on a failure:

- the **palette**: every authored colour, resolved, with pure white and white-ish counted by the guard;
- the **source**: every white-reading token or literal in `src/remotion`, forbidden or a named exception
  (`src/blender/white-audit.ts` `EXCEPTIONS`; `npm test` fails on an unnamed one, or on a stale exception);
- the **pixels**: over the settled characterless stills, pure-white pixels and flat white-ish pixels other than the canvas
  and the two named exceptions.

Intentional exceptions, each with its reason on record:

- **The canvas**, the brand page colour `paper` `#F2ECDF` (luma 0.93, chroma 0.075): the contract's own background, not a card
  or panel. It is the one white-ish colour left, flagged for the owner.
- **Caption text**, `cream` on the dark caption pill (review renders only): light text, not a surface.
- **The attention wash**, a 7% terracotta tint behind the element the guide points at: a tint over the canvas, darker than it.

## Reading the numbers

Before (main `ddf27b3`): 3,127,939 flat white-ish pixels other than the canvas over the 12 settled characterless stills. After:
0. Pure white: 0 before and after. The default render is intentionally different from main now; the declared terrain and
layouts are byte-for-byte main's.

## Running it

```bash
npm run blender:build && npm run blender:review                       # the character (materials v2) and the seven-pose sheet
npm run blender:contact -- --frames=1850,1904                         # the supports in perspective, with the shadow on them
node scripts/review/blender-transition.ts --stills-only               # the depth reveal's frames (--reuse-layers skips Remotion)
node scripts/review/narrow-perch.ts                                   # the narrow case: the review lab's perch
npm run render:stills migration-readiness -- --frames=1850,2900,1500  # characterless backgrounds for the final sheet
node scripts/review/final-sheet.ts <backgrounds> <reveal sequence> <reveal frame>
node scripts/review/white-audit.ts --before=<main stills> --after=dist/migration-readiness/stills
node scripts/review/visual-metrics.ts <before> <after>                # white-ish pixels and shadow weight on the character
```

## Decisions that stay with the owner

- **The canvas.** Paper stays the page colour. If "nothing white" should reach the page itself, the canvas needs another
  token, which is a docs-theme decision.
- **The reveal's block depth** stays 60 px: a deeper block moves the opaque sheet back and keeps the wallaby on screen longer
  during the dive, which is staging, not material.
- **How rocky.** The strata ranges, the layer colours, the formations' taper and the shadow's strength are one config block.
