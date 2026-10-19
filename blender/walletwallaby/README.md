# WalletWallaby in Blender

The Blender presentation lane: WalletWallaby's body, rig mapping, materials, and renders, authored as code.
See [docs/BLENDER.md](../../docs/BLENDER.md) for the architecture, the coordinate contract, and the evidence.

| File | What it owns |
|---|---|
| `common.py` | Fixed roots, the one bounded job read, output confinement, colour and unit conversions |
| `geometry.py` | The body as signed-distance volumes, surface-nets meshing, skin weights, the belly's coordinates, cream accents |
| `materials.py` | Two-tone emblem shading in exact brand colours, the brick belly's mortar map, the outline and contact shadow |
| `rig.py` | The rig contract's skeleton in 2.5D, face bones, Blender-native IK with pole targets |
| `controls.py` | One MotionPlan bridge frame onto the armature (pure mapping) |
| `scene.py` | Pinned render settings, light, the orthographic teaching camera, character placement |
| `terrain.py` | Declared terrain as blocks, and perspective cameras for depth views |
| `build.py` | Entry: build the character `.blend` and its canonical model manifest |
| `render.py` | Entry: render shots from bridge frames, with IK contact errors and PNG hashes |

Only `scripts/blender.ts` runs these, through `src/blender/toolchain.ts` (fixed arguments, a minimal environment,
jobs and outputs confined to `dist/blender/`).
