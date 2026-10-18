// Loads the Rive runtime and the WalletWallaby rig from the render bundle, once
// per page. Both are fetched from the bundle's own public dir (staged and
// hash-checked by stageRendererAssets), re-hashed here, and refused on any
// mismatch. The WASM is handed to the runtime as bytes, so it never fetches
// anything itself, and Rive's asset CDN is disabled. Browser-only.

import Rive, { type File as RiveFile, type RiveCanvas } from '@rive-app/canvas-advanced';
import { staticFile } from 'remotion';
import { RIVE_ASSET, RIVE_RUNTIME } from '../../character/walletwallaby/versions.ts';

export interface LoadedRive {
  rive: RiveCanvas;
  file: RiveFile;
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function pinnedBytes(publicPath: string, expected: string, what: string): Promise<Uint8Array> {
  const res = await fetch(staticFile(publicPath));
  if (!res.ok) throw new Error(`${what}: ${publicPath} answered ${res.status}`);
  const buf = await res.arrayBuffer();
  const actual = await sha256(buf);
  if (actual !== expected) throw new Error(`${what}: ${publicPath} hash ${actual} != pinned ${expected}`);
  return new Uint8Array(buf);
}

let loading: Promise<LoadedRive> | null = null;

export function loadWallabyRive(): Promise<LoadedRive> {
  loading ??= (async () => {
    const [wasmBinary, riv] = await Promise.all([
      pinnedBytes(RIVE_RUNTIME.public, RIVE_RUNTIME.wasmSha256, 'Rive runtime'),
      pinnedBytes(RIVE_ASSET.public, RIVE_ASSET.sha256, 'WalletWallaby rig'),
    ]);
    // The runtime asks for a URL even when given the bytes; the URL is never fetched.
    const rive = await Rive({ wasmBinary, locateFile: () => 'about:blank#wasm-provided-inline' } as unknown as Parameters<typeof Rive>[0]);
    const file = await rive.load(riv, undefined, false);
    if (!file) throw new Error('the Rive runtime refused the WalletWallaby rig');
    return { rive, file };
  })();
  return loading;
}
