// The lane's resolved material (config/blender-visual.json) for the flat scenes: the
// parchment of authored cards, the text colours that keep their contrast on it, and the
// palette the terrain formations are cut from. It arrives as a render input (data), so
// the bundle reads no file; a component that needs it and finds none stops the render.

import React, { useContext } from 'react';
import type { BlenderVisual } from '../blender/visual-core.ts';

export const MaterialContext = React.createContext<BlenderVisual | null>(null);

export function useMaterial(): BlenderVisual {
  const m = useContext(MaterialContext);
  if (!m) throw new Error('the composition was rendered without its material (the visual config): refusing to draw with a default');
  return m;
}
