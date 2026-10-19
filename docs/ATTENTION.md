# Attention direction

> The lesson decides what matters. Motion Intelligence decides how WalletWallaby moves. Attention direction decides how the viewer is guided to the already-authored meaning. It never changes a semantic destination or support geometry.

A lesson frame holds many valid things at once: a caption, four tiers, their routes, the guide. Attention direction is the renderer-owned editorial layer that decides, over time, which of them the eye should read first. It is derived, never authored: the planner selects meaning (beats and anchors) and the renderer derives a mode, a hierarchy, and a bounded framing from it. There is no `cameraPrompt`, no styling or animation field in the `VideoSpec`, and no free coordinate.

Code: `src/attention/direction.ts` (the grammar, the schedule, the sampling; isomorphic), `src/attention/config.ts` (the Node loader), `config/attention.json` (the treatments and bounds; part of the build identity), `src/remotion/DocsVideo.tsx` (the content world and the fixed layer), `src/remotion/scenes/*` (the hierarchy drawn). Tests: `test/attention.test.ts`.

## The grammar

A mode is derived per segment from the authored beats. "Current" means the latest beat **by start time** (ties: the later-authored beat); exit beats (`PUSH_THROUGH`, `DIMENSION_JUMP`) shape the transition, not the hierarchy. (The previous renderer picked the current beat by index, so the tiers scene's `INSPECT` of Vault Candidate was silently overridden by the `PUSH_THROUGH` cue authored before it.)

| Mode | Derived from | What it does |
|---|---|---|
| `ESTABLISH` | the scene's content start, until its first beat; a beat whose anchor names no element (`card:top`, `scene:entry`) | the terrain is shown evenly: no subject, no framing |
| `GUIDE` | `HOP`, `LAND`, `PERCH`, `REVEAL`, `TRACE` | the destination gains clear but quiet priority: its wash and rule; other subjects at 0.84 |
| `INSPECT` | `INSPECT` | one subject is primary; unrelated subjects recede to 0.72, context to 0.88; a bounded lean toward the subject |
| `COMPARE` | `COMPARE` | both subjects share the primary hierarchy, identically, for the whole beat; others 0.78; no framing |
| `RESOLVE` | `RESOLVE` | the emphasis settles into the resolved rule (the heavier terracotta rule stays once settled); one framing settle, then nothing moves |
| `TRANSITION` | the window before a scene's content start; the exit move's start, or the start of a non-cut transition out, less one settle | neutral and identity: the transition owns the frame |

Subjects come from the anchor: `card:body:x`, `node:x`, `takeaway:support:x` name `x`; `card:heading` and `takeaway:statement` name the heading and the statement; `edge:a->b` makes `b` primary, `a` related, and the route emphasised. A scene's cast is fixed by its grammar: a card's heading, a graph's caption, and a layered scene's upper plane are **context**; the card items, the nodes (the lower plane in a layered scene), the UI capture, and the takeaway lines are **subjects**; a node's detail line follows its node; a route attached to a primary or related node keeps full emphasis.

Every value (an element's opacity, its wash or rule strength, the camera's pose) eases over one settle (`settleMs`, 700 ms) from what it was when the key began toward the key's target, so a hierarchy change is never a pop and two keys close together still compose smoothly.

## The content world and the fixed editorial layer

`DocsVideo.tsx` draws two layers.

- **The content world**: the scenes (with their transition styles), and WalletWallaby (the Rive canvas or a staged Blender sequence), inside one `AbsoluteFill` with one transform about the frame centre. The framing is applied exactly once, to this unit, so the character and its support are registered by construction: the same affine map takes both.
- **The fixed editorial layer**: a staged Blender depth reveal (the signature transition, always at identity), the review captions, the debug guides, and the end screen's reserved zones. Never framed.

The provenance chip is provenance, but it shares the eyebrow row that the scene grammar lays out and that rides every transition, so it rides the content world with the eyebrow (under the character, as before) and is title-safe-checked like any text. A fixed chip over a leaning header split the row.

Inside a scene, attention direction changes only how much of an element is on screen (its opacity, its wash, its rule), never where it is. Nothing in `src/remotion/scenes` applies a transform from direction.

## The bounded editorial camera

A subtle 2D reframing of the whole world, only where a mode asks for it (`INSPECT`, `RESOLVE`): a scale about the frame centre and a lean toward the subject's rectangle together with the platform its anchor stands on, so the subject and the support read as one. It fails closed to identity and is bounded three times over:

1. **Ceilings** (`config/attention.json`): scale at most 1.05 and, after visual review, a lean of at most 16 px by 9 px; the lesson uses scale 1.03. A 1.04 scale with the full coverage lean (38 by 22 px) pushed captions to the title-safe edge and cramped the docs margin for no gain in direction.
2. **Coverage**: `|tx| <= 960 (s - 1)`, `|ty| <= 540 (s - 1)`, at every sampled frame, quantisation included, so the world always covers the frame and the canvas edge (the ground runs edge to edge) is never exposed. At scale 1.03 this is 28.8 px by 16.2 px, so the 16 by 9 ceiling binds. A lean therefore needs scale: `GUIDE` and `COMPARE` have none and are identity.
3. **Title-safe**: every text region of the layout, the eyebrow and the provenance chip included, stays inside `TITLE_SAFE` and above `CONTENT_BOTTOM` after the transform. The lean is clamped into the admissible interval; if the scale alone would break it, the framing is refused (identity) and the key records why.

When it moves:

- a key is taken only if the camera can then hold still for `minHoldMs` (1400 ms) after its settle; otherwise it is not taken and the camera stays where it was (`cameraDropped` records it). The tiers scene's `INSPECT` of the top tier is such a case: it cannot hold before the push into depth, so the camera stays still and the hierarchy alone marks the tier;
- every scene segment ends with a **required** return to identity: one settle before its exit move, before a non-cut transition, or before its end (a cut). So every transition window, every segment boundary, every brand segment, and the whole end screen are at identity, and the Blender depth reveal's two surfaces are rendered at identity;
- `RESOLVE` holds: after its settle nothing moves until the return;
- there is no rotation, no noise, no random motion, and no continuous drift: the camera moves only when the subject changes, and stops when the viewer is meant to read.

## The hierarchy

The accepted treatment is kept: a quiet terracotta wash (`accentWash(0.07)`) and a 3 px rule for the guide's subject, a 4 px terracotta rule once resolved, a terracotta top rule on a focused node. The additions are an eased strength (so the treatment arrives and leaves over a settle; at full strength the drawing is exactly what it was), and the per-mode opacities above, applied to the whole node (card, text, pillar) or text block. Floors are enforced by the loader: a subject never below 0.5, context never below 0.7. No glow, no blur, no spotlight, no HUD.

## The entrance vocabulary

The laid-brick settle (`settle()` in `src/remotion/style.ts`: 380 ms, 10 px) stays the reveal for cards, text, and nodes. The audit found the repetition mild, because reveals are cue-timed and few; the one place a fade hid structure was routes. A route now **draws on** from its source toward its destination (`entrance.routeDrawMs`, 420 ms, a clip box growing along its dominant direction), so its direction is seen; once drawn it renders exactly as before. A `RESOLVE` rule eases in over the settle rather than switching. No general animation framework, and no motion constant is authored in the spec.

## Captions

The review caption pill is unchanged. It sits in the fixed layer, below `CONTENT_BOTTOM`, so it never competes with the framed world, and production keeps the sidecar captions.

## Determinism and identity

Everything is a pure function of (timeline, layouts, clips, config, time). The module reads no clock, randomness, environment, or DOM; the bundle's import closure stays Node-free. `config/attention.json` is hashed into the build identity (`src/manifest/build-identity.ts`), so a render or review stills made with another attention config are stale to the public-output gate. The declared layouts and terrain are untouched: the plan reads frozen layouts and clips, and the content addresses pinned by `test/terrain-art.test.ts` still hold.

## Review

```bash
npm run render:stills -- migration-readiness --frames=1500,1700,1850,2900,3950,4500,5100
node scripts/review/attention-review.ts --before=<main's stills> --after=dist/migration-readiness/stills --out=dist/attention-review
```

The review script lays out before/after pairs, one temporal sequence per mode, the transition's entry, peak, and exit, and the characterless twins, and prints for each the mode, the subjects, the framing, the attenuated elements, and the reason the key exists.

## Known limitations

- Scale resamples the Rive canvas by up to 3 %; vector surfaces and text are re-rasterised crisply. Blender character frames are resampled the same way.
- The grammar is derived from beats only. A scene with no beats is `ESTABLISH` throughout; a lesson that wants a hierarchy must author beats.
