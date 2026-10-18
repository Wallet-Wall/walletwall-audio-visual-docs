// Test harness: the pinned Rive runtime (@rive-app/canvas-advanced) running
// under Node, loading the committed rig. The runtime is the same WASM the
// render bundle loads; under Node it gets the bytes directly and a minimal
// canvas-less `document` (it probes for WebGL at start-up and needs nothing
// else to load files, pose artboards, and report transforms).

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { RIVE_ASSET } from '../src/character/walletwallaby/versions.ts';
import { compileRig, type RigModel } from '../src/character/walletwallaby/rive/rig-compile.ts';
import type { RiveFileLike, RiveRuntime } from '../src/character/walletwallaby/rive/rig-apply.ts';
import { VIDEO_ROOT } from '../src/config/load.ts';

export interface LoadedRig {
  rive: RiveRuntime & { load(bytes: Uint8Array, loader: undefined, cdn: boolean): Promise<(RiveFileLike & { artboardCount(): number }) | null> };
  file: RiveFileLike & { artboardCount(): number };
  model: RigModel;
  bytes: Uint8Array;
}

let loaded: Promise<LoadedRig> | null = null;

/** The runtime module plus the committed .riv, loaded once per test process. */
export function loadRig(): Promise<LoadedRig> {
  loaded ??= (async () => {
    const g = globalThis as { document?: unknown };
    g.document ??= { createElement: () => ({ getContext: () => null }) };
    const require = createRequire(path.join(VIDEO_ROOT, 'package.json'));
    const modPath = require.resolve('@rive-app/canvas-advanced');
    const { default: Rive } = (await import(pathToFileURL(modPath).href)) as { default: (opts: unknown) => Promise<LoadedRig['rive']> };
    const wasmBinary = readFileSync(path.join(path.dirname(modPath), 'rive.wasm'));
    // The runtime asks for a URL even when handed the bytes; this one is never fetched.
    // It also logs that the canvas-less shim has no WebGL (image meshes only, unused); keep test output clean.
    const log = console.log;
    console.log = () => {};
    let rive: LoadedRig['rive'];
    try {
      rive = await Rive({ wasmBinary, locateFile: () => 'never-fetched:' });
    } finally {
      console.log = log;
    }
    const bytes = new Uint8Array(readFileSync(path.join(VIDEO_ROOT, ...RIVE_ASSET.path.split('/'))));
    const file = await rive.load(bytes, undefined, false);
    if (!file) throw new Error('the Rive runtime refused the committed rig');
    return { rive, file, model: compileRig().model, bytes };
  })();
  return loaded;
}
