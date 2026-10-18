import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildCaptions, toWebVtt } from '../src/audio/captions.ts';
import { estimateTrack } from '../src/audio/voice-provider.ts';
import { contentAddress, sha256Hex } from '../src/core/hash.ts';
import { IssueCollector } from '../src/core/issues.ts';
import { emptyLineage, markPublished, recordUpload } from '../src/publish/lineage.ts';
import { buildPublishManifest, checkPublishManifest, type PublishManifest } from '../src/publish/manifest.ts';
import { planReleaseOrder } from '../src/publish/release-plan.ts';
import { formatVideoTitle } from '../src/publish/title.ts';
import { DryRunUploadProvider } from '../src/publish/upload-provider.ts';
import { buildTimeline } from '../src/timeline/timeline.ts';
import { clone, committedSnapshot, committedSpec, config } from './helpers.ts';

const spec = committedSpec();
const timeline = buildTimeline(spec, estimateTrack(spec, config.voice, config.lexicon), config.templates);
const manifest = (): PublishManifest =>
  buildPublishManifest({
    spec,
    specHash: contentAddress(spec),
    timeline,
    docDescription: committedSnapshot().description,
    youtube: config.youtube,
    playlists: config.playlists,
    captions: { path: 'dist/x.vtt', sha256: sha256Hex(toWebVtt(buildCaptions(timeline))) },
    video: null,
    narration: { providerId: 'fixture-estimate', estimated: true },
  });

describe('titles', () => {
  test('one video: the searchable topic alone, never "Part 1"', () => {
    assert.equal(formatVideoTitle(spec, null), 'How WalletWall Measures Migration Readiness');
  });
  test('a series: topic first, then series and part', () => {
    const s = { title: { topic: 'Why Two Data Sources Can Disagree' }, series: { seriesId: 'walletwall-vault', part: 2, totalParts: 3 } };
    assert.equal(formatVideoTitle(s, 'WalletWall Vault'), 'Why Two Data Sources Can Disagree | WalletWall Vault — Part 2');
  });
});

describe('publish manifest (dry run)', () => {
  test('is unlisted, reviewed, sourced, and chaptered', () => {
    const m = manifest();
    assert.equal(m.mode, 'DRY_RUN');
    assert.equal(m.status.privacyStatus, 'unlisted');
    assert.equal(m.review.gate, 'HUMAN_REVIEW_BEFORE_PUBLIC');
    assert.ok(m.snippet.description.includes(spec.source.docUrl));
    assert.ok(m.chapters.length >= 3 && m.chapters[0]!.atMs === 0);
    for (let i = 1; i < m.chapters.length; i++) assert.ok(m.chapters[i]!.atMs - m.chapters[i - 1]!.atMs >= 10_000);
    assert.deepEqual(m.playlists.map((p) => p.playlistId), ['walletwall-vault']);
    assert.equal(m.endScreen.applyIn, 'YOUTUBE_STUDIO');
    const issues = new IssueCollector();
    checkPublishManifest(m, config.youtube, {}, issues);
    assert.deepEqual(issues.report().issues, []);
  });

  test('chapters closer than the minimum are refused (positive control)', () => {
    const m = manifest();
    m.chapters.splice(1, 0, { atMs: 4000, title: 'Too soon' });
    const issues = new IssueCollector();
    checkPublishManifest(m, config.youtube, {}, issues);
    assert.ok(issues.report().issues.some((i) => i.code === 'MANIFEST_CHAPTERS_INVALID'));
  });

  test('a credential-shaped env value in the manifest is caught (positive control)', () => {
    const m = manifest();
    const fake = 'not-a-real-token-but-long-enough-0123456789';
    m.snippet.description += `\n${fake}`;
    const issues = new IssueCollector();
    checkPublishManifest(m, config.youtube, { YOUTUBE_UPLOAD_TOKEN: fake }, issues);
    assert.ok(issues.report().issues.some((i) => i.code === 'MANIFEST_SECRET_LEAK'));
  });

  test('the dry-run provider refuses anything but unlisted/private', async () => {
    const m = manifest();
    const receipt = await new DryRunUploadProvider().upload({ manifest: m, videoFile: '', captionsFile: '' });
    assert.deepEqual(receipt, { mode: 'DRY_RUN', youtubeId: null, privacyStatus: 'unlisted' });
    const pub = clone(m) as unknown as { status: { privacyStatus: string } };
    pub.status.privacyStatus = 'public';
    await assert.rejects(new DryRunUploadProvider().upload({ manifest: pub as unknown as PublishManifest, videoFile: '', captionsFile: '' }));
  });
});

describe('lineage: new uploads, never overwrites', () => {
  const v = (revision: number, youtubeId: string) => ({ revision, youtubeId, specHash: 'h', docBlob: 'b', contentHash: 'x' });
  test('an upload waits in review; publishing supersedes and retains the previous version', () => {
    let l = recordUpload(emptyLineage('migration-readiness'), v(1, 'yt-aaa'));
    assert.equal(l.versions[0]!.status, 'UNLISTED_REVIEW');
    assert.equal(l.currentYoutubeId, null);
    l = markPublished(l, 'yt-aaa');
    l = markPublished(recordUpload(l, v(2, 'yt-bbb')), 'yt-bbb');
    assert.equal(l.currentYoutubeId, 'yt-bbb');
    assert.deepEqual(l.versions.map((x) => [x.youtubeId, x.status]), [
      ['yt-aaa', 'SUPERSEDED'],
      ['yt-bbb', 'CURRENT'],
    ]);
  });
  test('revisions only move forward and ids are unique', () => {
    const l = recordUpload(emptyLineage('x'), v(2, 'a'));
    assert.throws(() => recordUpload(l, v(2, 'b')));
    assert.throws(() => recordUpload(l, v(3, 'a')));
    assert.throws(() => markPublished(l, 'zzz'));
  });
  test('the committed lineage starts empty', async () => {
    const { readFileSync } = await import('node:fs');
    const l = JSON.parse(readFileSync(new URL('../manifests/migration-readiness.lineage.json', import.meta.url), 'utf8'));
    assert.deepEqual(l, emptyLineage('migration-readiness'));
  });
});

describe('release planning', () => {
  test('prerequisites come first, then weighted usefulness; docs order is ignored', () => {
    const order = planReleaseOrder(config.releasePlan).map((c) => c.videoId);
    assert.equal(order[0], 'what-is-walletwall');
    assert.ok(order.indexOf('migration-readiness') < order.indexOf('quantum-exposure-clock'));
    assert.ok(order.indexOf('holder-wall') < order.indexOf('whale-watcher'));
    assert.deepEqual(planReleaseOrder(config.releasePlan).map((c) => c.videoId), order, 'deterministic');
  });
  test('cycles and unknown prerequisites are refused', () => {
    const plan = clone(config.releasePlan);
    plan.candidates[0]!.dependsOn = ['migration-readiness'];
    assert.throws(() => planReleaseOrder(plan), /cycle/);
    plan.candidates[0]!.dependsOn = ['nope'];
    assert.throws(() => planReleaseOrder(plan), /unknown/);
  });
});
