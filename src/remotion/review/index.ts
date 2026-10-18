// Review-only Remotion entry point: WalletWallaby's pose sheet and motion lab.
// It shares the character code with the video but registers nothing the video
// pipeline renders; scripts/render-review.ts bundles it on its own.
import { registerRoot } from 'remotion';
import { ReviewRoot } from './ReviewRoot.tsx';

registerRoot(ReviewRoot);
