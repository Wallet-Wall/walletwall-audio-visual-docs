# WalletWallaby Motion Architecture

> The lesson decides WHERE WalletWallaby goes. The motion system decides HOW he gets there.

WalletWallaby should read as a small, agile macropod physically crossing information terrain — not a sprite translated between coordinates. He has weight; jumps are physically plausible; landings have consequence; perches are supported by the surface, and only by a surface that could really carry him. And the lesson stays fully deterministic.

## Layers

```text
VideoSpec beat (action + target anchor)          ← authored meaning: WHAT and WHERE
        │ choreography: resolve anchors, order, timing windows
        ▼
semantic clips (from → to, start → end)          ← fixed by the spec; never altered below this line
        │ motion solver: pure, closed-form, bounded
        ▼
motion plan (phases, trajectory, contact events)
        │ sample at absolute time t (Remotion frame → ms)
        ▼
motion state (position, velocity, action, phase,     ← Motion Intelligence decides BEHAVIOUR
              key-pose blend, contacts, tail intent)
        │ rig controls: a pure mapping
        ▼
clip weights + IK targets + small continuous offsets
        │ the resolved pose and its IK targets (walletwall.blender-motion/v1)
        ▼
Blender: IK, the 3D body, lossless frames            ← Blender performs the BODY
        │ crops placed by Remotion
        ▼
Remotion captures frame N                             ← Remotion owns TIME
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

Other actions reuse the same parts: `PERCH` settles into a balanced stance with the tail stabilising; `INSPECT` leans in with a small stance adjustment; `TRACE` bounds between supported footholds on the route's own nodes while the trail draws under the leap (the drawn route itself is information, never stood on); `PUSH_THROUGH` shifts weight back, then drives the body along the force direction into depth.

## Terrain and support

Content is terrain, but not every pixel is. The scene grammar declares what each drawn element offers a body (`src/layout/terrain.ts`): a card's or node's top is a `SUPPORTED_SURFACE`, the summit is a `LEDGE`, a block's sides are `SIDE_FACE`s (a hand may brace on one, a climbing hand may grip its lip, feet never stand on it), a UI capture offers only `OPTIONAL_BRACE` faces, and a route line, an underline, a hairline border, or a divider is `NON_SUPPORTING` or `DECORATIVE_EDGE`: never terrain. Every contact is judged (`src/character/walletwallaby/support.ts`): both feet on a solid level top, the centre of mass inside it with a margin, a top of meaningful thickness, no protected text where the feet touch, a narrow ledge only where the lesson authored a narrow perch, and the tail never carrying a body the feet do not. A grip needs a real lip within reach; a brace needs supported feet. Where an anchor authors several stands, the best-supported one is chosen (broad support, then a normal ledge, then narrow; then the tail resting on the support; then the authored order), and the choreography fails closed when none is plausible. Every render and the publish dry run judge every contact of the lesson against the terrain on screen at its instant and refuse a plan with one the terrain cannot carry (`src/character/walletwallaby/contacts.ts`). The Rust/WASM engine owns the same judge ([MOTION_INTELLIGENCE.md](MOTION_INTELLIGENCE.md)).

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

## Implementation (rig v6, motion v4)

| Layer | Code |
|---|---|
| Where and when: anchors, order, time windows | `src/character/walletwallaby/choreography.ts` |
| Motion intelligence: plan, phases, contacts, tail intent, mantles, landings | `src/character/walletwallaby/motion.ts` |
| Terrain semantics: what each drawn element offers a body | `src/layout/terrain.ts` |
| Support plausibility: stances, grips, braces, stand selection | `src/character/walletwallaby/support.ts` |
| The contact audit (every contact of a plan, judged; the render and publish gates) | `src/character/walletwallaby/contacts.ts` |
| Traces as bounds between supported footholds | `src/character/walletwallaby/trace.ts` |
| Physics and behaviour constants (versioned) | `config/motion.json` |
| Vocabulary poses as clip blends, expressions, palette slots | `src/character/walletwallaby/rig.ts` |
| The rig contract as code: skeleton, controls, IK, clips, envelope, paint slots | `src/character/walletwallaby/rig/rig-source.ts` |
| Rig contract to the rest-pose model (deterministic) | `rig/rig-compile.ts` |
| Motion state to rig controls | `rig/rig-controls.ts` |
| Frame-pure posing: the pose before IK and every IK target | `rig/rig-apply.ts`, `blender/pose-resolve.ts` |
| Drawing: the Blender character (crops composited by Remotion) and the depth reveal | `src/character/walletwallaby/blender/`, `src/blender/`, `blender/walletwallaby/`, `src/remotion/wallaby/WallabyBlender.tsx`; see [BLENDER.md](BLENDER.md) |
| Declared versions and pinned hashes | `src/character/walletwallaby/versions.ts` |
| Rust/WASM Motion Intelligence (engine v3, opt-in: every hop from a stance that ends in a perch, its stand selection and support verdicts, its arc search, the contacts the scene reacts to, and an audit of every lesson contact) | `motion-intelligence/`, `src/motion/`; see [MOTION_INTELLIGENCE.md](MOTION_INTELLIGENCE.md) |

`planMotion(clips, layouts)` runs once per video; `sampleWallaby(plan, ms)` is a pure function of the plan and the absolute time. Neither can return a destination that the clip did not give it.

### The rig contract and its renderer

WalletWallaby is drawn by Blender ([BLENDER.md](BLENDER.md)): a code-built body in WalletWallrus's shape language (one rounded mass in the walrus's coat, charcoal outline, warm stone accents, the wall built into the belly, and the long tail as the signature feature), posed by the rig contract below and pinned by its canonical model hash (`BLENDER_CHARACTER`). The contract is renderer-neutral: names, rest pose, IK chains, and clips, authored as code so every bone and key is reviewable in a diff. Rig v6 is that contract alone. Rigs v3 to v5 were drawn by the Rive runtime from 2D silhouette shapes compiled into a `.riv`; the runtime, the asset, and the shapes were retired once the invariants it proved were proven on the frames Blender renders (`npm run blender:invariants`), and the pose it evaluated is pinned (`test/blender-lane.test.ts`).

- **Skeleton:** 22 bones. Hip, chest, neck, head, jaw, two ears, a five-bone tail, two three-bone hind legs, and two two-bone forelimbs. Blender's armature is built on exactly these bones (`rig-export.ts`), with its own face bones for the eyes, lids, and brows.
- **Clips:** a reset (`base`), a looping `idle_alert` (a 3.4 s breath), eleven key poses (`crouch_preload`, `takeoff`, `airborne`, `land_soft`, `land_hard`, `perch`, `inspect`, `trace`, `mantle`, `push`, `resolve`), and two control clips (`tail_free`, `point_near`). Every pose clip sets the full pose property set, so blending is order-stable.
- **IK:** two-bone legs plant each foot, with the heel set by the clip-keyed foot angle and the toes on the rig's ground point; two-bone forelimbs grip a ledge lip in the mantle and point at what the lesson reveals; a two-bone tail tip rests on the surface. Strengths are keyed by the clips, so the clips decide when the feet plant (never in flight), and a blend of two clips blends their IK. The pose resolver decides every target; Blender's IK only reaches for them.
- **Palette:** the coat is WalletWallrus's own (`#BA6F38`, `FAMILY_COLORS` in `rig.ts`), not the docs theme's redder terracotta; the shade is the coat mixed 20% toward charcoal, computed, never typed; outline, mortar, eyes, nose, and claws are charcoal; the accents are the material pass's warm stone ([BLENDER_VISUAL.md](BLENDER_VISUAL.md)). Two flat tones per surface, no highlights: brand colours are checked on the rendered pixels.

**Frame-authoritative posing.** Every frame is a pure function of the frame: `rigControls(state)` and `resolvePose` (`blender/pose-resolve.ts`) blend the frame's clips from rest, add the continuous controls, and place every IK target, and the bridge (`walletwall.blender-motion/v1`) carries exactly that to Blender, which poses a fresh armature state from it. Nothing reads elapsed time; frames rendered in a shuffled order are byte-identical.

### Motion intelligence (v4)

The motion layer now returns behaviour, not drawing parameters:

- **Action and phase.** `IDLE`, `HOP`, `AIRBORNE`, `LAND`, `PERCH`, `INSPECT`, `TRACE`, `MANTLE`, and `PUSH_THROUGH`, through phases from `ORIENT` and `PRELOAD` to `REACH`, `CONTACT`, `SETTLE`, `HANG`, `PULL`, `BRACE`, `LOAD`, `DRIVE`, and `FALL`.
- **Key-pose blend.** Each vocabulary pose is a blend of the rig's clips (`TEACH` is part alert idle, part teaching stance), and every transition is a blend between clip mixes.
- **Velocity.** Closed form: the derivative of the feet's path, tested against finite differences.
- **Jumps.** Orient; preload, where the tail loads down against the ground and stiffens; takeoff extension, where the tail locks straight as a lever; flight, where the tail counter-rotates against the body's pitch and streams against the vertical velocity; reach, where the legs swing forward feet-first and the tail sweeps down to meet the ground; then contact, compression, and settle.
- **Landings** are soft or hard by impact (a smoothstep from 0.55 to 0.95). A hard landing blends in `land_hard` (deeper compression, a wider stance, forelimbs out), recovers 2.5 times more slowly, and braces the tail. The brace carries into the following hold and relaxes there.
- **Mantles.** A move becomes a climb when its destination is a platform top at least 0.55 body heights above a start beside that platform, the whole sequence fits the window under the speed and gravity limits, and it crosses no more protected text than the hop would. The climb: jump to a hang point below the lip; catch it (the arm IK grips the lip, the body hangs outside the face with the legs against it, and the tail swings as a counterweight); pull the hindquarters up and over; settle exactly on the anchor. The committed lesson has no ledge that can be climbed without crossing text, so it keeps its hops; the motion lab shows the climb.
- **The tail.** It rests on the surface behind as a third support whenever there is surface under it, and the tail IK makes the contact exact. Past a platform's edge, `tail_free` releases it and it hangs. Where a pose holds it well clear (inspect, trace, flight), the release is smooth. On narrow perches it corrects the balance with a slow ±2° sway. It never sinks through a surface: if a pose would drive the tip below the surface line, the tail first swings up about its root, so the IK only has to close a few pixels instead of folding the tip.
- **Pointing.** The near forelimb reaches for the subject with the arm IK, weighted by the pose's reach, never past the rig's reach (a far subject is pointed at, not lunged for). Presenting gestures stay as small rotation offsets.
- **Support (v4).** Every stand, takeoff, landing, trace foothold, grip, and brace is judged against the declared terrain (see "Terrain and support" above); a plan with one unsupported contact is refused.
- **Exit leaps (v4)** leave the plane above the frame (the apex is out of view), and the next scene's arrival continues that flight: the body falls in from above and lands on its stand only once the new scene's content is on screen, never on the outgoing scene's geometry.

### Bounds

`RIG_ENVELOPE` (rig space at scale 1: x −224..152, y −280..92) bounds the drawn ink of every pose the motion system can produce, measured on the pixels Blender actually draws (`npm run blender:invariants`: every 9th lesson frame and every lab frame; the closest the ink comes to the box is 1.8 px at the top). While holding, the drawn pixels never overlap protected text and stay inside title-safe (checked on the committed lesson's hold frames). The production crop is this box padded by 40 rig px, and a frame whose ink reaches a crop edge fails the render. The layout box `WALLABY_EXTENT` (x −150..100) is unchanged so that no scene's layout moves; the rest pose's ink now reaches x −197 behind the feet (the longer tail), so the guarantees above are checked on real geometry instead, as they were for leans.

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
- **Traces** bound between supported footholds on the route's own nodes (`trace.ts`): low skips along one top, and one leap across from the nearest supported foothold on the start to the nearest on the destination, on the arc that crosses the least text without passing through any block (tested at the footprint's back, centre, and front). The drawn route is never stood on; the trail draws under the leap.
- **Push-through** shifts the weight back onto the haunches, rolls it forward, then drives along the force direction into depth under constant acceleration.
- **Drop-in** is a free fall to the authored anchor, then a landing.
- **Falls** continue an exit leap into the next scene: airborne from the start, they land on the chosen stand at the end of their window.
- **Secondary motion** (compression, tail, ears) is a sum of analytic damped-spring responses to the plan's own events (`TAKEOFF`, `LANDING`, `STEP`, `PUSH`, `SHIFT`). Each response peaks once, rebounds by under 35%, and is exactly zero outside its window.
- **Platform response:** a landing on a card, graph node, or ledge depresses that platform by at most 3 px (cards by half as much) and returns it exactly to rest within 420 ms. The platform's text moves with it, and the feet ride it by the same quantised amount, so the character never floats or clips. UI captures never move.
- **Sound:** `LANDING` now plays at the real contact rather than at the beat start, with quiet `TAKEOFF` (−30 dB) and `PUSH_CONTACT` cues. Steps and weight shifts are silent. All sonic assets are still unassigned, which means silence.

### Guarantees

Tests live in `test/motion.test.ts`, `test/motion-intelligence.test.ts`, `test/rig.test.ts`, `test/blender-lane.test.ts`, and `test/versions.test.ts`; what needs the rendered frames runs as `npm run blender:invariants` (before every publication render, and on a sample in the Blender proof workflow).

- The same spec, config, and rig give the same plan, the same rig controls, and the same resolved pose. Shuffled evaluation of about 590 frames is bit-identical to timeline order, and a positive control proves the comparison catches a 0.01° change; frames Blender renders in a shuffled order are byte-identical too.
- Every hop lands exactly on its target. Every clip that moves ends on its authored anchor, every perch holds it, and the mantle ends on the authored ledge. A very different physics config gives the same landings in the same order.
- On every grounded frame Blender's IK reaches every toe and heel target (within 0.05 px; worst over the whole lesson 0.0217 px) and the knees point forward. The tail rests on supported surfaces and is released past edges, the paws hold the ledge lip in a climb, and no tail joint bends more than 70°.
- Every control is finite and inside its hard limit on every frame. Clip weights are in [0, 1] and sum to 1, and clip times are in range.
- Adversarial controls are refused, each with a positive control: non-finite or out-of-range values, unknown or duplicated clips, control clips used as poses, unreachable grips, and inverted support spans. So is anything that is not exactly a v1 bridge, and a Blender frame that is not the bytes its manifest names.
- The Blender character built from the rig is the pinned one (its canonical model and materials hashes), and every opaque pixel it draws is a mix of the palette's colours. The build identity and the provenance manifest record the Blender build, its config, lane source, and the pinned character.
- Invalid motion configs are refused, as before, with positive controls.

### Review renders

`npm run blender:review` renders the pose sheet and close-ups (with `--turnaround`, a turn study), and `npm run blender:contact` the lesson's contacts in perspective on their declared terrain. The motion lab (`src/remotion/review/motion-lab-scene.ts`) is bridged like a lesson (`src/blender/lab.ts`) for the invariants and the narrow-perch review.

### Known weaknesses

- **Text crossings in flight are reduced, not eliminated:** 105 frames against the v1 ceiling of 109, for the reasons given for v2. Flight poses extend past the layout box, so that count, which uses the box, is an estimate.
- **The layout box under-reserves the tail.** `WALLABY_EXTENT` still reserves 150 px behind the feet at scale 1; the rest pose's tail reaches 197. Growing it would move every scene's layout; the real-ink checks keep holds off text and inside title-safe meanwhile.
- **Support is a flat-footed model.** A stance is the feet's span on a level top: no slopes, no partial footing, no per-paw placement. Blender's IK plants the drawn feet on the stand point.
- **The rig and the body are code-authored.** The clips were tuned by hand with probes and the body is built from code (BLENDER.md), not by an animator in an editor. The contract is stable, so an editor-authored body can replace the code-built one, but it must pass the same invariants and be pinned the same way.
- **Code changes in `motion.ts` are not covered by the definition hash.** Only the config and the timing table are hashed, so a behavioural code change must bump `MOTION.version` by review discipline. The rig is fully covered: its source is in the definition; the resolved pose is pinned (`test/blender-lane.test.ts`), and Blender's body by its canonical model hash.
- **Blender's IK is the legacy solver with calibrated poles.** The poles reproduce the rest pose within 0.21 px; a pole that crosses its chain is not proven. In the motion lab's climb the arm reaches near full length and lands within 2.5 px of the lip (Rive's tolerance was 3). A Blender upgrade must re-run the invariants.
