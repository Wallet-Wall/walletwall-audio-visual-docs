// npm run stills:compare -- <first> <second> -> exit 0 only when two render:stills outputs of the same
// input are identical: the same stills, byte-identical lossless PNGs, each stills.json naming its own
// bytes, and equal stills.json metadata. This is the repeat-render determinism proof (MP4 bytes are not
// run-to-run stable, so an MP4 hash is never used for it).
//
// Usage: node scripts/stills-compare.ts <first stills dir> <second stills dir>
// Exit 0 = identical; 1 = a difference (each one is printed); 2 = usage error.

import { compareStillSets } from '../src/publish/public-output.ts';

const dirs = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (dirs.length !== 2) {
  console.error('[stills:compare] usage: node scripts/stills-compare.ts <first stills dir> <second stills dir>');
  process.exit(2);
}
const result = compareStillSets(dirs[0]!, dirs[1]!);
for (const d of result.differences) console.log(`  DIFFERENT ${d}`);
console.log(`[stills:compare] ${result.identical ? 'IDENTICAL' : 'DIFFERENT'}: ${result.stills} stills${result.identical ? ', every PNG byte-identical' : `, ${result.differences.length} differences`}`);
process.exitCode = result.identical ? 0 : 1;
