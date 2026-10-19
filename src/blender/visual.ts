// The Node side of the lane's visual constants: reads config/blender-visual.json.
// Everything else (resolution, the white guard, the types) is in ./visual-core.ts, which the
// Remotion bundle can import too. Node-only.

import path from 'node:path';
import { VIDEO_ROOT, readJson } from '../config/load.ts';
import { BLENDER_VISUAL_REL, resolveVisual, type BlenderVisual, type RawVisual } from './visual-core.ts';

export * from './visual-core.ts';

export function loadVisualConfig(): BlenderVisual {
  return resolveVisual(readJson<RawVisual>(path.join(VIDEO_ROOT, BLENDER_VISUAL_REL)));
}
