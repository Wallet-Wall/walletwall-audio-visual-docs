# WalletWallaby Motion Architecture

> The lesson decides WHERE WalletWallaby goes. The motion system decides HOW he gets there.

WalletWallaby should read as a small, agile macropod physically crossing information terrain — not a sprite translated between coordinates. He has weight; jumps are physically plausible; landings have consequence; perches are supported by the surface. And the lesson stays fully deterministic.

## Layers

```text
VideoSpec beat (action + target anchor)          ← authored meaning: WHAT and WHERE
        │ choreography: resolve anchors, order, timing windows
        ▼
semantic clips (from → to, start → end)          ← fixed by the spec; never altered below this line
        │ motion solver: pure, closed-form, bounded
        ▼
motion plan (phases, trajectory, contact events)
        │ sample at absolute time t
        ▼
pose channels (position, compression, stretch, rotation, tail, ears, contact)
        │
        ▼
Remotion renders frame N
```

The choreography layer resolves every destination from the spec's anchors and owns the order and timing windows. The motion solver receives a fixed start, a fixed destination, and a time budget, and returns how to get there. It has no input through which it could pick a different node, skip content, reorder traversal, or change what a claim means, and its final semantic state is exactly the authored anchor.

## Movement feel

Apex Legends is a feel reference only: momentum, acceleration, air control, precise landings, surface awareness, mantling onto ledges, slide-like traversal where it carries meaning, and chaining moves without a full reset. **Nothing is copied from it**: no code, assets, animations, constants, or proprietary systems. Every curve and constant here is WalletWall's own and is derived from simple physics (ballistic arcs, damped springs).

Restraint is part of the brand. No cartoon squash-and-stretch comedy, no spinning or tumbling, no floppy ragdoll, no boing sounds, no camera shake, no idle bouncing.

## A hop, phase by phase

1. **Observe / orient**: face the destination; head and gaze lead.
2. **Anticipation**: the body lowers, haunches compress, the tail lifts back for balance; a brief hold is allowed.
3. **Takeoff**: the body extends, rear-leg thrust is implied, the torso pitches only slightly, the tail counters.
4. **Airborne**: a ballistic arc with constant horizontal velocity; posture evolves with velocity; the tail counterbalances; ears and head lag a little.
5. **Contact**: the feet reach the platform first, on the exact authored anchor.
6. **Compression**: the body absorbs the landing; the tail and ears follow through.
7. **Settle**: one small rebound, then the rest pose.
8. **Stable perch**: weight visibly supported; at most a slow, tiny breathing cycle.

Other actions reuse the same parts: `PERCH` settles into a balanced stance with the tail stabilising; `INSPECT` leans in with a small stance adjustment; `TRACE` follows the drawn route as a chain of short, low hops that never fully reset; `PUSH_THROUGH` shifts weight back, then drives the body along the force direction into depth.

## Platform response

Cards, graph nodes, and ledges may acknowledge contact with a tiny, bounded settle (a few pixels at most) that returns exactly to rest. Information surfaces never bounce, and text stays readable throughout.

## Determinism and safety

- Every channel is a closed-form function of absolute time and the plan: no fixed-step integration that depends on frame history, no wall-clock time, no browser timing, no randomness. Any frame renders identically in isolation.
- Secondary motion (tail, ears, compression rebound) is a sum of analytic damped-spring responses to the plan's own contact events.
- Inputs are validated and fail closed: NaN, Infinity, negative or zero durations, impossible budgets, unbounded heights, and absurd velocities are refused, not clamped into nonsense.
- Every channel is bounded by version-controlled limits (rotation, compression, stretch, tail and ear angles, platform displacement, speed).
- Physics parameters live in a versioned motion config. The motion config version and the character rig version are recorded in provenance, and tests refuse a parameter change without a version bump.

## Out of scope

No general-purpose physics or game engine (Matter.js, Rapier, Phaser), no Three.js conversion of the character, no collision world, pathfinding, procedural levels, particles, camera shake, character variants, or new mascots. If a concrete need ever proves one of these unavoidable, it is proposed and reviewed on its own.

## Implementation (rig v2, motion v2)

| Layer | Code |
|---|---|
| Where and when: anchors, order, time windows | `src/character/walletwallaby/choreography.ts` |
| How: motion plan and per-frame sampling | `src/character/walletwallaby/motion.ts` |
| Physics constants (versioned) | `config/motion.json` |
| Look: palette slots, poses, expressions | `src/character/walletwallaby/rig.ts` |
| Declared versions and pinned definition hashes | `src/character/walletwallaby/versions.ts` |
| Drawing the channels | `src/remotion/wallaby/WallabyFigure.tsx` |

`planMotion(clips, layouts)` runs once per video; `sampleWallaby(plan, ms)` is a pure function of the plan and the absolute time. Neither can return a destination that the clip did not give it.

### Model

- **Gravity** is measured in body heights per second squared (21 by default), so a far, small WalletWallaby falls like a near one.
- **A hop** follows `y(s) = y0 + (y1 - y0)·s - c·s(1 - s)` with constant horizontal velocity. The depth `c` sets the apex height above the higher endpoint, and the flight time follows from gravity.
  - The natural apex grows with distance, between 0.18 and 1.0 body heights.
  - If the flight cannot fit its window, the arc is lowered first, then gravity is raised (at most 1.8×). Otherwise the hop is refused.
  - Every hop touches down at least 40 ms before its clip ends, so each clip closes standing exactly on its anchor.
- **Phases:** orient (up to 160 ms), anticipation (190 ms, with a held bottom), takeoff extension, ballistic flight, contact, compression, settle, perch. Pitch follows the velocity direction (±9°), and the head counter-rotates to keep the gaze steady.
- **Surface awareness:** the solver samples each candidate arc (from 0.05× to 3× the natural height) against the scene's protected text and keeps the arc that crosses the least, preferring the natural one.
  - On a card top, where only about 6 px separate the ears from the eyebrow, a short move becomes a low skim.
  - A long move along one surface becomes chained low skips (one per 0.62 body heights), each lifted no higher than the measured clearance.
- **Traces** chain short bounds along the drawn route, accelerating out and decelerating in, with brief ground contacts. The trail fills in under the feet.
- **Push-through** shifts the weight back onto the haunches, rolls it forward, then drives along the force direction into depth under constant acceleration.
- **Drop-in** is a free fall to the authored anchor, then a landing.
- **Secondary motion** (compression, tail, ears) is a sum of analytic damped-spring responses to the plan's own events (`TAKEOFF`, `LANDING`, `STEP`, `PUSH`, `SHIFT`). Each response peaks once, rebounds by under 35%, and is exactly zero outside its window.
- **Platform response:** a landing on a card, graph node, or ledge depresses that platform by at most 3 px (cards by half as much) and returns it exactly to rest within 420 ms. The platform's text moves with it, and the feet ride it by the same quantised amount, so the character never floats or clips. UI captures never move.
- **Sound:** `LANDING` now plays at the real contact rather than at the beat start, with quiet `TAKEOFF` (−30 dB) and `PUSH_CONTACT` cues. Steps and weight shifts are silent. All sonic assets are still unassigned, which means silence.

### Palette (rig v2)

| Part | Token |
|---|---|
| Coat, tail, outer ears, eyelids | `terracotta` (canonical WalletWall terracotta, `#BF4E32`) |
| Far ear and foot, shading strokes | derived: `terracotta` mixed 42% toward `terracottaDark`, computed rather than typed |
| Belly, muzzle, highlight | `cream` |
| Inner ears | `mortar` (WalletWall's cream-family token) |
| Outline, eyes, nose, claws | `charcoal` |
| Trail tag on the strap | `tan` (the coat's former colour, kept as an accent) |

The traced route stays a 3 px terracotta line over a grey dashed rail. Next to a filled, outlined character it reads as the path rather than the agent, so its treatment was left unchanged.

### Guarantees (tests in `test/motion.test.ts`)

- The same spec, config, and code give the same plan and the same frames. The motion module reads no clock, randomness, or environment.
- Every hop lands exactly on its target. Every clip that moves ends on its authored anchor, and every perch holds it.
- A different but valid physics config yields the same landings in the same order. The solver reads clips and never rewrites them.
- Invalid configs are refused, with positive controls for each case: NaN, Infinity, negative or zero values, out-of-range or unbounded values, string numbers, missing or unknown fields, and inconsistent pairs.
- Invalid moves are refused: non-finite inputs, empty windows, non-positive scales, and moves that cannot fit their window under the speed and gravity limits.
- All channels stay inside their limits on every frame, and platforms return exactly to rest.
- Perched frames never overlap protected text.

### Known weaknesses

- **Text crossings in flight are reduced, not eliminated.** This video has 105 crossing frames against 109 for v1, which the tests use as a ceiling. The remainder come from route traces that pass beside node labels, the exit leap through the eyebrow, and hops between graph nodes. Removing them needs choreography changes (route and exit placement), which are outside a physics pass.
- **Mid-route contacts on a trace are on the drawn trail, not on a platform.** The trail is treated as terrain.
- **Code changes in `motion.ts` are not covered by the definition hash.** Only the config and the timing table are hashed, so a behavioural code change must bump `MOTION.version` by review discipline.
