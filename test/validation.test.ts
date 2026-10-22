// The publishability gate. The committed spec must pass; every rule has a
// positive control: a single, targeted defect that must fail with its code.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { estimateTrack } from '../src/audio/voice-provider.ts';
import { ISSUE_CODES } from '../src/core/issues.ts';
import { resolveWorkspacePath } from '../src/pipeline/context.ts';
import type { CardScene, GraphScene, VideoSpec } from '../src/spec/types.ts';
import { isSafeRepoPath } from '../src/validation/paths.ts';
import { clone, codes, committedSnapshot, committedSpec, config, repoResolver, scaledTrack, segment, validate } from './helpers.ts';

function expectCode(mutate: (spec: VideoSpec) => void, code: keyof typeof ISSUE_CODES, opts: Parameters<typeof validate>[1] = {}): void {
  const spec = clone(committedSpec());
  mutate(spec);
  const report = validate(spec, opts);
  assert.ok(codes(report).includes(code), `expected ${code}, got ${JSON.stringify(codes(report))}`);
  assert.equal(report.ok, false);
}

describe('committed spec', () => {
  test('passes every rule with no warnings', () => {
    const report = validate(committedSpec());
    assert.deepEqual(report.issues, []);
    assert.equal(report.ok, true);
  });

  test('is a QUICK video with the required structure', () => {
    const spec = committedSpec();
    assert.equal(spec.videoClass, 'QUICK');
    assert.deepEqual(
      spec.segments.map((s) => s.role),
      ['HOOK', 'QUESTION', 'EXPLANATION', 'EXPLANATION', 'IMPLICATION', 'IMPLICATION', 'TAKEAWAY', 'CTA', 'DOCS_REFERENCE', 'OUTRO', 'END_SCREEN'],
    );
    assert.equal(spec.segments.filter((s) => s.transitionIn.type === 'DEPTH_ENTER').length, 1, 'one earned 2D -> 3D transition');
  });

  // The video teaches from its first frame: WalletWall's brand is a quiet fixed footer, never a standalone logo scene.
  test('a standalone ident segment is refused: the role does not exist', () =>
    expectCode((s) => s.segments.splice(1, 0, { id: 'ident', role: 'IDENT' as never, transitionIn: { type: 'CUT' }, narration: [], scene: null, templateId: 'ident.v1', wallaby: [], sonic: [] }), 'SPEC_SCHEMA_INVALID'));
});

describe('shape and vocabulary (no generative or styling channel exists)', () => {
  test('a prompt field is rejected as a generative channel', () =>
    expectCode((s) => Object.assign(segment(s, 'hook').scene as object, { imagePrompt: 'glowing blockchain cubes' }), 'SPEC_GENERATIVE_FIELD'));
  test('a CSS / style field is rejected', () => expectCode((s) => Object.assign(segment(s, 'tiers') as object, { style: { color: 'neon' } }), 'SPEC_GENERATIVE_FIELD'));
  test('an unknown key is rejected', () => expectCode((s) => Object.assign(s.claims[0] as object, { confidence: 0.9 }), 'SPEC_UNKNOWN_KEY'));
  test('an unsupported scene type is rejected', () => expectCode((s) => Object.assign(segment(s, 'question').scene as object, { type: 'CODE' }), 'SCENE_TYPE_UNSUPPORTED'));
  test('an invented Wallaby action is rejected', () => expectCode((s) => Object.assign(segment(s, 'question').wallaby[0] as object, { action: 'BACKFLIP' }), 'WALLABY_ACTION_UNSUPPORTED'));
  test('an invented expression is rejected', () => expectCode((s) => Object.assign(segment(s, 'question').wallaby[0] as object, { expression: 'ECSTATIC' }), 'WALLABY_EXPRESSION_UNSUPPORTED'));
  test('a Wallaby target outside the scene is rejected', () => expectCode((s) => Object.assign(segment(s, 'tiers').wallaby[0] as object, { target: 'node:moon' }), 'WALLABY_TARGET_UNKNOWN'));
  test('a targeted action without a target is rejected', () => expectCode((s) => delete segment(s, 'reading').wallaby[0]!.target, 'WALLABY_TARGET_REQUIRED'));
  test('a cue to a missing line is rejected', () => expectCode((s) => Object.assign(segment(s, 'hook').wallaby[0] as object, { cue: 'hook.l9' }), 'CUE_UNKNOWN'));
  test('a stock-footage asset kind is not expressible', () => expectCode((s) => Object.assign(s.assets[0] as object, { kind: 'STOCK_FOOTAGE' }), 'ASSET_KIND_PROHIBITED'));
});

describe('claims and provenance', () => {
  test('a fabricated quote fails', () =>
    expectCode((s) => Object.assign(s.claims.find((c) => c.id === 'c-four-tiers')!.evidence[0] as object, { quote: 'Every assessment normalizes into one of five tiers.' }), 'CLAIM_QUOTE_NOT_IN_SOURCE'));
  test('a claim citing a missing section fails', () =>
    expectCode((s) => Object.assign(s.claims[0]!.evidence[0] as object, { sectionId: 'nonexistent' }), 'CLAIM_SECTION_UNKNOWN'));
  test('a MEASURED claim needs a hashed artifact', () => expectCode((s) => Object.assign(s.claims[0] as object, { type: 'MEASURED' }), 'CLAIM_EVIDENCE_MISSING'));
  test('an artifact that does not exist fails', () =>
    expectCode((s) => {
      s.claims[0] = { id: s.claims[0]!.id, type: 'MEASURED', statement: 'x', evidence: [{ kind: 'ARTIFACT', path: 'docs/does-not-exist.json', sha256: '0'.repeat(64), note: 'n' }] };
    }, 'CLAIM_ARTIFACT_MISSING'));
  test('a content line with no claims fails', () => expectCode((s) => Object.assign(segment(s, 'question').narration[1] as object, { claimIds: [] }), 'NARRATION_UNSUPPORTED'));
  test('an unknown claim id fails', () => expectCode((s) => Object.assign(segment(s, 'question').narration[1] as object, { claimIds: ['c-ghost'] }), 'CLAIM_UNKNOWN'));
  test('interpretation must be marked as interpretation', () =>
    expectCode((s) => Object.assign(segment(s, 'signals').narration[1] as object, { text: 'Migration Readiness adds no new measurement.' }), 'NARRATION_INTERPRETATION_UNMARKED'));
  test('an interpretation claim cannot be spoken as plain fact', () =>
    expectCode((s) => Object.assign(segment(s, 'signals').narration[1] as object, { role: 'CONTENT' }), 'NARRATION_ROLE_MISMATCH'));
  test('a spoken number must appear in the cited evidence', () =>
    expectCode((s) => Object.assign(segment(s, 'tiers').narration[0] as object, { text: 'Every assessment normalizes into one of five tiers.' }), 'NARRATION_NUMBER_UNSOURCED'));
  test('an on-screen number must appear in the cited evidence (no fabricated data)', () =>
    expectCode((s) => Object.assign((segment(s, 'question').scene as CardScene).body[0] as object, { text: 'No second score, 97% accurate' }), 'VISUAL_NUMBER_UNSOURCED'));
  test('on-screen text must cite claims', () => expectCode((s) => Object.assign((segment(s, 'question').scene as CardScene).heading as object, { claimIds: [] }), 'VISUAL_TEXT_UNSOURCED'));
  test('a graph label must appear in its evidence', () =>
    expectCode((s) => Object.assign((segment(s, 'tiers').scene as GraphScene).nodes[1] as object, { text: 'Escalate' }), 'GRAPH_LABEL_UNSOURCED'));
  test('an ascending layout must match the cited order', () =>
    expectCode((s) => {
      const g = segment(s, 'tiers').scene as GraphScene;
      g.nodes.reverse();
    }, 'GRAPH_ORDERING_UNSOURCED'));
  test('an ascending layout needs an ordering claim', () => expectCode((s) => delete (segment(s, 'tiers').scene as GraphScene).orderingClaimId, 'GRAPH_ORDERING_UNSOURCED'));
  test('a UI scene must show a real UI capture', () =>
    expectCode((s) => {
      const seg = segment(s, 'question');
      seg.scene = { type: 'UI', plane: 'SURFACE', eyebrowSectionId: 'migration-readiness', assetId: 'brand-mark', caption: { id: 'cap', text: 'The recommend step', claimIds: ['c-recommend-step'] } };
      seg.wallaby = [];
    }, 'UI_SCENE_REQUIRES_REAL_CAPTURE'));
  test('an asset whose bytes changed fails', () => expectCode((s) => Object.assign(s.assets[0] as object, { sha256: 'f'.repeat(64) }), 'ASSET_HASH_MISMATCH'));
  test('an asset path escaping the repository is refused', () => expectCode((s) => Object.assign(s.assets[0] as object, { path: '../ww-docs-video-evil/secret.png' }), 'SPEC_PATH_INVALID'));
  test('an absolute or backslash path is refused', () => {
    expectCode((s) => Object.assign(s.assets[0] as object, { path: 'C:/Users/someone/key.png' }), 'SPEC_PATH_INVALID');
    expectCode((s) => (s.source.snapshotPath = 'video\\specs\\x.json'), 'SPEC_PATH_INVALID');
  });
  test('path safety rules and the repo-boundary resolver', () => {
    for (const ok of ['video/assets/brand/walletwall-brick-wallet.png', 'docs/concepts/migration-readiness.mdx', 'video/specs/a/source.snapshot.json']) assert.equal(isSafeRepoPath(ok), true, ok);
    for (const bad of ['', '/etc/passwd', '../x', 'a/../../b', 'a//b', './a', 'C:/x', 'a\\b']) assert.equal(isSafeRepoPath(bad), false, bad);
    assert.equal(resolveWorkspacePath('../ww-docs-video-evil/x.png'), null, 'sibling directory sharing the repo-root prefix');
    assert.equal(resolveWorkspacePath('video/../package.json'), null, 'no climbing out of this repository');
    assert.ok(resolveWorkspacePath('docs/concepts/migration-readiness.mdx'), 'canonical tree');
    assert.ok(resolveWorkspacePath('video/specs/migration-readiness/spec.json'), 'this repository');
  });
  test('a quantum sonic event is refused for a non-quantum source', () =>
    expectCode((s) => segment(s, 'tiers').sonic.push({ event: 'SUPERPOSITION_ENTER', cue: 'tiers.l1' }), 'SONIC_QUANTUM_OUT_OF_DOMAIN'));
});

describe('adversarial planner output (code-review controls)', () => {
  const docSha = () => repoResolver('docs/concepts/migration-readiness.mdx')!.sha256;
  test('a measurement cannot be sourced from the free-text note', () =>
    expectCode((s) => {
      s.claims.push({ id: 'c-latency', type: 'MEASURED', statement: 'Latency fell.', evidence: [{ kind: 'ARTIFACT', path: 'docs/concepts/migration-readiness.mdx', sha256: docSha(), note: 'p95 latency fell 83%' }] });
      segment(s, 'question').narration[1]!.claimIds.push('c-latency');
      segment(s, 'question').narration[1]!.text = 'It does not introduce a second score; latency fell 83%.';
    }, 'NARRATION_NUMBER_UNSOURCED'));
  test('a MEASURED claim must quote its artifact', () =>
    expectCode((s) => s.claims.push({ id: 'c-m', type: 'MEASURED', statement: 'x', evidence: [{ kind: 'ARTIFACT', path: 'docs/concepts/migration-readiness.mdx', sha256: docSha(), note: 'n' }] }), 'CLAIM_EVIDENCE_MISSING'));
  test('an artifact excerpt must really be in the artifact', () =>
    expectCode((s) => s.claims.push({ id: 'c-m', type: 'MEASURED', statement: 'x', evidence: [{ kind: 'ARTIFACT', path: 'docs/concepts/migration-readiness.mdx', sha256: docSha(), note: 'n', quote: 'latency fell by 83 percent' }] }), 'CLAIM_QUOTE_NOT_IN_SOURCE'));
  test('a genuine artifact excerpt is accepted (control)', () => {
    const spec = clone(committedSpec());
    spec.claims.push({ id: 'c-m', type: 'MEASURED', statement: 'x', evidence: [{ kind: 'ARTIFACT', path: 'docs/concepts/migration-readiness.mdx', sha256: docSha(), note: 'n', quote: 'Every assessment normalizes into one of four tiers.' }] });
    const report = validate(spec);
    assert.deepEqual(codes(report), []);
  });
  test('a "real UI capture" must come from the reviewed capture directory', () =>
    expectCode((s) => Object.assign(s.assets[0] as object, { kind: 'REAL_UI_CAPTURE' }), 'ASSET_LOCATION_INVALID'));
  test('a brand mark must be a reviewed mark in this repository, never the app\'s legacy raster icons', () =>
    expectCode((s) => Object.assign(s.assets[0] as object, { path: 'public/brand/wallet-wall-icon-only.png' }), 'ASSET_LOCATION_INVALID'));
  test('non-numeric, negative, or runaway timing fails instead of disabling the gates', () => {
    expectCode((s) => Object.assign(segment(s, 'hook').narration[0] as object, { pauseAfterMs: 'x' }), 'TIMING_INVALID');
    expectCode((s) => Object.assign(segment(s, 'hook').narration[0] as object, { pauseAfterMs: -4000 }), 'TIMING_INVALID');
    expectCode((s) => Object.assign(segment(s, 'hook').wallaby[1] as object, { delayMs: 60_000 }), 'TIMING_INVALID');
    expectCode((s) => Object.assign(segment(s, 'question').wallaby[2] as object, { delayMs: 9000 }), 'TIMING_INVALID');
  });
  test('the output format is fixed', () => expectCode((s) => Object.assign(s.output as object, { width: 640, height: 360 }), 'SPEC_SCHEMA_INVALID'));
  test('zero-width, homoglyph, and fullwidth text is refused', () => {
    expectCode((s) => Object.assign(segment(s, 'takeaway').narration[0] as object, { text: 'So: Su​bscribe. Quantum Exposure says how urgent.' }), 'TEXT_INVALID_CHARACTERS');
    expectCode((s) => Object.assign(segment(s, 'question').narration[2] as object, { text: 'It recommends one path, and places yоur wallet in a shared risk tier.' }), 'TEXT_INVALID_CHARACTERS');
    expectCode((s) => Object.assign(segment(s, 'tiers').narration[0] as object, { text: 'Every assessment normalizes into one of ５ tiers.' }), 'TEXT_INVALID_CHARACTERS');
  });
  test('quantity words outside the old list are still checked; prototype names are not numbers', () => {
    expectCode((s) => Object.assign(segment(s, 'tiers').narration[0] as object, { text: 'Seventy percent of assessments normalize into one of four tiers.' }), 'NARRATION_NUMBER_UNSOURCED');
    const spec = clone(committedSpec());
    segment(spec, 'tiers').narration[0]!.text = 'Every assessment normalizes into one of four tiers, in ascending order of prioritization; the constructor is irrelevant.';
    assert.ok(!codes(validate(spec)).includes('NARRATION_NUMBER_UNSOURCED'));
  });
  test('call-to-action variants outside the CTA are refused', () =>
    expectCode((s) => Object.assign(segment(s, 'takeaway').narration[0] as object, { text: 'So: hit the like button. Quantum Exposure says how urgent.' }), 'COPY_CTA_REPEATED'));
  test('fragment quotes and mid-word matches bind to nothing', () => {
    expectCode((s) => Object.assign(s.claims.find((c) => c.id === 'c-qes')!.evidence[0] as object, { quote: 'the risk' }), 'CLAIM_QUOTE_NOT_IN_SOURCE');
    expectCode((s) => Object.assign(s.claims.find((c) => c.id === 'c-qes')!.evidence[0] as object, { quote: 'is it to move saf' }), 'CLAIM_QUOTE_NOT_IN_SOURCE');
  });
  test('reserved and path-like ids are refused', () => {
    expectCode((s) => Object.assign((segment(s, 'question').scene as CardScene).body[0] as object, { id: 'eyebrow' }), 'SPEC_ID_INVALID');
    expectCode((s) => (s.id = '../../escape'), 'SPEC_ID_INVALID');
  });
  test('TRACE must follow a drawn route', () => expectCode((s) => Object.assign(segment(s, 'tiers').wallaby[1] as object, { target: 'node:review' }), 'WALLABY_TARGET_UNKNOWN'));
  test('a heading long enough to reach the provenance chip fails', () => {
    const spec = committedSpec();
    const source = committedSnapshot();
    source.sections.find((x) => x.id === 'the-shared-risk-tiers')!.heading = 'The shared risk tiers and every single thing about how they are computed';
    assert.ok(codes(validate(spec, { source })).includes('TEXT_OVERFLOW'));
  });
});

describe('structure, transitions, and duration', () => {
  test('the CTA is required', () => expectCode((s) => (s.segments = s.segments.filter((x) => x.role !== 'CTA')), 'STRUCTURE_SEGMENT_MISSING'));
  test('the end screen is required', () => expectCode((s) => (s.segments = s.segments.filter((x) => x.role !== 'END_SCREEN')), 'STRUCTURE_SEGMENT_MISSING'));
  test('a second CTA is refused', () =>
    expectCode((s) => {
      const extra = { ...clone(segment(s, 'cta')), id: 'cta-2' };
      extra.narration = extra.narration.map((l) => ({ ...l, id: 'cta-2.line' }));
      s.segments.splice(9, 0, extra);
    }, 'STRUCTURE_SEGMENT_REPEATED'));
  test('the takeaway cannot precede the explanation', () =>
    expectCode((s) => {
      const t = s.segments.findIndex((x) => x.id === 'takeaway');
      const [take] = s.segments.splice(t, 1);
      s.segments.splice(2, 0, take!);
    }, 'STRUCTURE_ORDER'));
  test('DEPTH_ENTER must be driven by PUSH_THROUGH', () => expectCode((s) => segment(s, 'tiers').wallaby.pop(), 'TRANSITION_DEPTH_NOT_DRIVEN'));
  test('SECTION_SHIFT must be driven by DIMENSION_JUMP', () => expectCode((s) => segment(s, 'question').wallaby.pop(), 'TRANSITION_SHIFT_NOT_DRIVEN'));
  test('the video must return from depth to the surface', () => expectCode((s) => (segment(s, 'reading').transitionIn = { type: 'CUT' }), 'TRANSITION_DEPTH_UNBALANCED'));
  test('a depth scene must sit on the depth plane', () => expectCode((s) => ((segment(s, 'signals').scene as GraphScene).plane = 'SURFACE'), 'TRANSITION_PLANE_MISMATCH'));
  test('runtime over the class ceiling fails; never speed up narration', () => {
    const spec = committedSpec();
    const report = validate(spec, { track: scaledTrack(estimateTrack(spec, config.voice, config.lexicon), 1.4) });
    assert.ok(codes(report).includes('DURATION_EXCEEDS_CLASS'));
  });
  test('unnaturally fast narration fails', () => {
    const spec = committedSpec();
    const report = validate(spec, { track: scaledTrack(estimateTrack(spec, config.voice, config.lexicon), 0.6) });
    assert.ok(codes(report).includes('PACE_TOO_FAST'));
  });
  test('a longer class than needed is flagged', () => {
    const spec = clone(committedSpec());
    spec.videoClass = 'DEEP_DIVE';
    assert.ok(codes(validate(spec), 'warning').includes('DURATION_CLASS_NOT_SHORTEST'));
  });
  test('text that cannot fit its region fails', () =>
    expectCode((s) => Object.assign((segment(s, 'question').scene as CardScene).heading as object, { text: 'The recommend step '.repeat(8).trim() }), 'TEXT_OVERFLOW'));
});

describe('copy, titles, and source binding', () => {
  test('"your wallet" breaks the neutral-wallet copy rule', () =>
    expectCode((s) => Object.assign(segment(s, 'question').narration[2] as object, { text: 'It recommends one path, and places your wallet in a shared risk tier.' }), 'COPY_FORBIDDEN_PHRASE'));
  test('hype is refused', () => expectCode((s) => (s.title.topic = 'This Insane Feature Will Change Everything'), 'COPY_FORBIDDEN_PHRASE'));
  test('subscribe-begging outside the CTA is refused', () =>
    expectCode((s) => Object.assign(segment(s, 'takeaway').narration[0] as object, { text: 'So: subscribe. Quantum Exposure says how urgent.' }), 'COPY_CTA_REPEATED'));
  test('brand copy must match its template', () =>
    expectCode((s) => Object.assign(segment(s, 'cta').narration[0] as object, { text: 'Smash that like button!' }), 'NARRATION_TEMPLATE_MISMATCH'));
  test('a part label never goes in the topic', () => expectCode((s) => (s.title.topic = 'Migration Readiness Part 1'), 'TITLE_INVALID'));
  test('a single video is not a series', () => expectCode((s) => (s.series = { seriesId: 'walletwall-vault', part: 1, totalParts: 1 }), 'SERIES_INVALID'));
  test('a spec planned against older content is stale', () => expectCode((s) => (s.source.contentHash = '0'.repeat(64)), 'SOURCE_HASH_STALE'));
  test('the canonical docs page must be published', () =>
    expectCode(() => undefined, 'DOCS_URL_UNPUBLISHED', { page: { published: false, url: 'https://docs.walletwall.org/concepts/migration-readiness', groups: [], reason: 'MINTIGNORED' } }));
});
