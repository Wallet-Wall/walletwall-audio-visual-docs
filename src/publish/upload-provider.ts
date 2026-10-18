// Upload boundary. v1 can only ever upload UNLISTED (or PRIVATE) for human
// review: "public" is not representable in the request type, so no code path
// can publish publicly by accident. A later lane may widen this deliberately,
// behind a separate, protected workflow.

import type { PublishManifest } from './manifest.ts';

export type V1Privacy = 'unlisted' | 'private';

export interface UploadRequest {
  manifest: PublishManifest;
  videoFile: string;
  captionsFile: string;
}

export interface UploadReceipt {
  mode: 'DRY_RUN' | 'LIVE';
  /** null for dry runs; the platform id once a live upload succeeds. */
  youtubeId: string | null;
  privacyStatus: V1Privacy;
}

export interface UploadProvider {
  readonly id: string;
  upload(request: UploadRequest): Promise<UploadReceipt>;
}

/** Credential-free provider: validates the request shape and returns a dry-run receipt. */
export class DryRunUploadProvider implements UploadProvider {
  readonly id = 'youtube-dry-run';

  async upload(request: UploadRequest): Promise<UploadReceipt> {
    const privacy = request.manifest.status.privacyStatus;
    if (privacy !== 'unlisted' && privacy !== 'private') throw new Error(`v1 refuses privacy "${String(privacy)}"`);
    return { mode: 'DRY_RUN', youtubeId: null, privacyStatus: privacy };
  }
}
