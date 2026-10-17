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

## Status

The proven v1 choreography (closed-form hops, traces, push-through, and drop-in) is being extracted first, behaviour-preserving. The weighted motion model described here replaces its sampling layer in a follow-up change, with before/after renders.
