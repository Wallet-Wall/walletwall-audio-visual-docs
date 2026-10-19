// Repository guards: brand-contract integrity and drift, determinism, the
// injection-sink and secret rules, credential isolation, the render bundle's
// import closure, CI posture, and dependency pinning.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { CSS_TOKEN_MIRROR, FONTS, TOKENS } from '../src/brand/tokens.ts';
import { COLORS, DOCS_URL } from '../src/brand/repo-constants.ts';
import { SOURCE_IS_FIXTURE, VIDEO_ROOT } from '../src/config/load.ts';
import { brandDrift } from '../src/contracts/brand-drift.ts';
import { prettyJson } from '../src/core/canonical-json.ts';
import { contentAddress } from '../src/core/hash.ts';
import { assembleSpec } from '../src/planner/assemble.ts';
import { STORYBOARD_CONTRACT, type Storyboard } from '../src/planner/storyboard.ts';
import { CONTENT_RULES, EXECUTABLE_CONTEXT_RULES } from './guard-rules.ts';
import { committedSnapshot, committedSpec, config } from './helpers.ts';

interface BrandContract {
  theme: Record<string, string>;
  cssRoot: Record<string, string>;
}
const brandContract = (): BrandContract => JSON.parse(readFileSync(path.join(VIDEO_ROOT, 'contracts', 'walletwall-brand.json'), 'utf8')) as BrandContract;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (name === 'node_modules' || name === 'dist') return [];
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const sources = ['src', 'scripts', 'test'].flatMap((d) => walk(path.join(VIDEO_ROOT, d))).filter((f) => /\.(ts|tsx)$/.test(f));

describe('brand', () => {
  test('the brand contract matches the canonical theme, constants, and :root exactly', { skip: SOURCE_IS_FIXTURE && 'needs WALLETWALL_SOURCE_ROOT (a WalletWall checkout)' }, async () => {
    assert.deepEqual((await brandDrift()).valueDrift, []);
  });
  test('palette and docs URL come from the brand contract only', () => {
    const contract = brandContract();
    assert.equal(TOKENS.terracotta, contract.theme['COLORS.brand.terracotta']);
    assert.equal(TOKENS.terracotta, COLORS.brand.terracotta);
    assert.equal(TOKENS.tan, COLORS.brand.tan);
    assert.equal(TOKENS.accentWash(0.6), contract.theme['VAULT.accentWash']!.replace('{alpha}', '0.6'));
    assert.deepEqual(CSS_TOKEN_MIRROR, contract.cssRoot);
    assert.equal(DOCS_URL, 'https://docs.walletwall.org');
  });
  test('no source file states a brand color literal; colors come from tokens', () => {
    const values = [...Object.values(brandContract().theme), ...Object.values(brandContract().cssRoot)];
    const hexes = values.filter((v) => /^#[0-9a-f]{6}$/i.test(v)).map((v) => v.toLowerCase());
    const rgbs = values.map((v) => /^rgba\((\d+,\d+,\d+),/.exec(v.replace(/\s+/g, ''))?.[1]).filter((v): v is string => Boolean(v));
    assert.ok(hexes.length > 10 && rgbs.length > 3, 'the scan has something to look for');
    for (const file of sources.filter((f) => !f.includes(`${path.sep}test${path.sep}`))) {
      const text = readFileSync(file, 'utf8').toLowerCase().replace(/\s+/g, '');
      for (const hex of hexes) assert.ok(!text.includes(hex), `${path.relative(VIDEO_ROOT, file)} hard-codes ${hex}`);
      for (const rgb of rgbs) assert.ok(!text.includes(`rgba(${rgb},`), `${path.relative(VIDEO_ROOT, file)} hard-codes rgba(${rgb}, …)`);
    }
  });
  test('font families match the bundled fontsource faces', () => {
    for (const [pkg, family] of [
      ['@fontsource-variable/sora/index.css', 'Sora Variable'],
      ['@fontsource-variable/manrope/index.css', 'Manrope Variable'],
      ['@fontsource/ibm-plex-mono/500.css', 'IBM Plex Mono'],
    ] as const) {
      assert.ok(readFileSync(path.join(VIDEO_ROOT, 'node_modules', pkg), 'utf8').includes(`font-family: '${family}'`), pkg);
      assert.ok(Object.values(FONTS).some((f) => f.includes(`"${family}"`)), family);
    }
  });
});

describe('determinism', () => {
  test('the committed spec regenerates byte-for-byte from storyboard + snapshot', () => {
    const spec = committedSpec();
    const storyboard = JSON.parse(readFileSync(path.join(VIDEO_ROOT, 'fixtures', 'storyboards', 'migration-readiness.storyboard.json'), 'utf8')) as Storyboard;
    const rebuilt = assembleSpec(storyboard, {
      source: committedSnapshot(),
      docUrl: spec.source.docUrl,
      blob: spec.source.blob,
      snapshotPath: spec.source.snapshotPath,
      providerId: 'fixture',
      contract: STORYBOARD_CONTRACT,
      storyboardHash: contentAddress(storyboard),
      templates: config.templates,
      voice: config.voice,
      lexicon: config.lexicon,
      sonicIdentityId: config.sonic.ident.id,
      revision: spec.revision,
    });
    assert.equal(prettyJson(rebuilt), prettyJson(spec));
  });
});

describe('repository rules', () => {
  test('injection-sink and secret rules hold for every .ts/.tsx file', () => {
    for (const file of sources.filter((f) => path.basename(f) !== 'guard-rules.ts')) {
      const text = readFileSync(file, 'utf8');
      for (const rule of [...EXECUTABLE_CONTEXT_RULES, ...CONTENT_RULES]) {
        assert.ok(!rule.re.test(text), `${path.relative(VIDEO_ROOT, file)}: ${rule.msg}`);
      }
    }
  });

  test('no generative-media or LLM endpoint is reachable from the pipeline', () => {
    // The one exception is the voice REFERENCE adapter of the narration bakeoff (docs/NARRATION.md), which may name
    // ElevenLabs and nothing else; the next test proves the render and publish paths cannot reach it.
    const hosts = /api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis|replicate\.com|stability\.ai|runwayml|api\.elevenlabs\.io|pika\.art|lumalabs|heygen|synthesia/i;
    const referenceAdapter = path.join(VIDEO_ROOT, 'src', 'narration', 'providers', 'elevenlabs.ts');
    for (const file of sources.filter((f) => !f.includes(`${path.sep}test${path.sep}`))) {
      const text = readFileSync(file, 'utf8');
      if (file === referenceAdapter) {
        assert.ok(/api\.elevenlabs\.io/.test(text), 'the reference adapter pins its host');
        assert.ok(!hosts.test(text.replace(/api\.elevenlabs\.io/g, '')), 'and names no other endpoint');
        continue;
      }
      assert.ok(!hosts.test(text), path.relative(VIDEO_ROOT, file));
    }
  });

  test('no narration provider adapter is reachable from the render bundle or the render and publish scripts', () => {
    // Walk each entry's import closure; the adapters (and their credentials) belong to scripts/narration.ts alone.
    const closure = (entry: string): Set<string> => {
      const seen = new Set<string>();
      const queue = [entry];
      while (queue.length) {
        const file = queue.pop()!;
        if (seen.has(file)) continue;
        seen.add(file);
        for (const m of readFileSync(file, 'utf8').matchAll(/^(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/gm)) {
          const spec = m[1]!;
          if (spec.startsWith('.') && /\.tsx?$/.test(spec)) queue.push(path.resolve(path.dirname(file), spec));
        }
      }
      return seen;
    };
    const providers = path.join(VIDEO_ROOT, 'src', 'narration', 'providers') + path.sep;
    for (const entry of ['src/remotion/index.ts', 'scripts/render.ts', 'scripts/render-review.ts', 'scripts/publish-dry-run.ts', 'scripts/pipeline.ts', 'scripts/public-output-check.ts', 'scripts/plan.ts', 'scripts/validate.ts']) {
      const reached = [...closure(path.join(VIDEO_ROOT, ...entry.split('/')))].filter((f) => f.startsWith(providers));
      assert.deepEqual(reached, [], `${entry} reaches ${reached.map((f) => path.relative(VIDEO_ROOT, f)).join(', ')}`);
    }
    const importers = sources.filter((f) => f.includes(`${path.sep}scripts${path.sep}`) && /narration\/providers/.test(readFileSync(f, 'utf8'))).map((f) => path.relative(VIDEO_ROOT, f).split(path.sep).join('/'));
    assert.deepEqual(importers, ['scripts/narration.ts'], 'only the bakeoff script imports an adapter');
    assert.ok(closure(path.join(VIDEO_ROOT, 'scripts', 'narration.ts')).has(path.join(providers, 'elevenlabs.ts')), 'the scan has something to look for');
  });

  test('the render bundle never reads the environment or imports Node built-ins', () => {
    // Walk the bundle's whole import closure from its entry point, not just src/remotion/.
    const seen = new Set<string>();
    const queue = [path.join(VIDEO_ROOT, 'src', 'remotion', 'index.ts')];
    while (queue.length) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      const text = readFileSync(file, 'utf8');
      const rel = path.relative(VIDEO_ROOT, file);
      assert.ok(!/process\.env|import\.meta\.env/.test(text), `${rel} reads the environment`);
      for (const m of text.matchAll(/^(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/gm)) {
        const spec = m[1]!;
        assert.ok(!spec.startsWith('node:'), `${rel} imports ${spec}`);
        if (spec.startsWith('.') && /\.tsx?$/.test(spec)) queue.push(path.resolve(path.dirname(file), spec));
      }
    }
    assert.ok(seen.size > 15, `walked ${seen.size} modules`);
    for (const nodeOnly of ['config/load.ts', 'source/canonical.ts', 'pipeline/context.ts']) {
      assert.ok(![...seen].some((f) => f.endsWith(path.join(...nodeOnly.split('/')))), `${nodeOnly} stays out of the bundle`);
    }
  });

  test('Remotion packages are exact-pinned to one version; no dependency floats', () => {
    const pkg = JSON.parse(readFileSync(path.join(VIDEO_ROOT, 'package.json'), 'utf8')) as Record<string, Record<string, string>>;
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const [name, range] of Object.entries(all)) assert.match(range, /^\d+\.\d+\.\d+$/, `${name}@${range} must be exact`);
    const remotion = Object.entries(all).filter(([n]) => n === 'remotion' || n.startsWith('@remotion/')).map(([, v]) => v);
    assert.equal(new Set(remotion).size, 1, 'all Remotion packages share one version');
  });

  test('every workflow is fork-safe: no privileged trigger, no secrets, no persisted token', () => {
    const dir = path.join(VIDEO_ROOT, '.github', 'workflows');
    const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
    assert.ok(files.includes('ci.yml'));
    for (const f of files) {
      const wf = readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n');
      assert.match(wf, /^permissions:\n {2}contents: read$/m, `${f}: read-only by default`);
      assert.ok(!/pull_request_target/.test(wf), `${f}: no pull_request_target`);
      assert.ok(!/secrets\./.test(wf), `${f}: no secrets`);
      const checkouts = wf.match(/uses:\s*actions\/checkout@/g)?.length ?? 0;
      assert.equal(wf.match(/persist-credentials: false/g)?.length ?? 0, checkouts, `${f}: every checkout drops its token`);
      const writes = (wf.replace(/#.*$/gm, '').match(/^\s+[a-z-]+: write$/gm) ?? []).map((l) => l.trim());
      assert.ok(writes.every((w) => w === 'security-events: write') && (writes.length === 0 || f === 'codeql.yml'), `${f}: only CodeQL may upload results`);
    }
  });

  test('the verify workflow is read-only and credential-free', () => {
    const wf = readFileSync(path.join(VIDEO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8').replace(/\r\n/g, '\n');
    assert.match(wf, /^permissions:\n {2}contents: read$/m);
    assert.match(wf, /persist-credentials: false/, 'the checkout token is not left in the workspace');
    assert.ok(!/\bwrite\b/.test(wf.replace(/#.*$/gm, '')), 'no write permission');
    assert.ok(!/secrets\./.test(wf), 'no secrets');
    assert.ok(!/pull_request_target|schedule:/.test(wf), 'no privileged or scheduled trigger');
    for (const uses of wf.match(/uses:\s*\S+/g) ?? []) assert.match(uses, /uses:\s*actions\/(checkout|setup-node)@/);
  });

  const workflows = (): { file: string; text: string }[] => {
    const dir = path.join(VIDEO_ROOT, '.github', 'workflows');
    return readdirSync(dir)
      .filter((f) => /\.ya?ml$/.test(f))
      .map((file) => ({ file, text: readFileSync(path.join(dir, file), 'utf8').replace(/\r\n/g, '\n') }));
  };

  test('every action is pinned to a full commit SHA, with the release it was resolved from', () => {
    // A tag or branch can be moved to new code without any change here; a commit SHA cannot.
    let refs = 0;
    for (const { file, text } of workflows()) {
      for (const m of text.matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)(.*)$/gm)) {
        refs++;
        assert.match(m[1]!, /^[A-Za-z0-9-]+\/[A-Za-z0-9._/-]+@[0-9a-f]{40}$/, `${file}: ${m[1]} is not pinned to a full commit SHA`);
        assert.match(m[2]!, /^ # v\d+\.\d+\.\d+$/, `${file}: ${m[1]} does not name the release it was resolved from`);
      }
    }
    assert.ok(refs >= 10, `the scan found ${refs} action references`);
  });

  test('no workflow and no pipeline code can reach a live YouTube upload', () => {
    // No credential can reach a job: no secret and no repository variable is referenced anywhere.
    for (const { file, text } of workflows()) assert.ok(!/\b(?:secrets|vars)\./.test(text), `${file} references a secret or a repository variable`);
    // Nothing names a YouTube or Google OAuth endpoint (a plain substring search over the text).
    const endpoints = ['youtube.googleapis.com', 'googleapis.com/youtube', 'googleapis.com/upload/youtube', 'accounts.google.com/o/oauth2', 'oauth2.googleapis.com'];
    const named = (text: string): string[] => endpoints.filter((e) => text.toLowerCase().includes(e));
    const pipeline = sources.filter((f) => !f.includes(`${path.sep}test${path.sep}`));
    for (const file of pipeline) assert.deepEqual(named(readFileSync(file, 'utf8')), [], `${path.relative(VIDEO_ROOT, file)} names a YouTube or OAuth endpoint`);
    for (const { file, text } of workflows()) assert.deepEqual(named(text), [], `${file} names a YouTube or OAuth endpoint`);
    // The credential-free dry-run provider is the only upload provider, and nothing can state a live receipt.
    const providers = pipeline.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/class\s+(\w+)\s+implements\s+UploadProvider\b/g)].map((m) => m[1]));
    assert.deepEqual(providers, ['DryRunUploadProvider']);
    const live = pipeline.filter((f) => /['"]LIVE['"]/.test(readFileSync(f, 'utf8')));
    assert.deepEqual(live.map((f) => path.relative(VIDEO_ROOT, f).split(path.sep).join('/')), ['src/publish/upload-provider.ts'], 'only the receipt type may name LIVE');
  });

  /** Each step of a workflow: its `- name:` line and every deeper-indented line after it. */
  const steps = (text: string): string[] => {
    const lines = text.split('\n');
    const out: string[] = [];
    lines.forEach((line, i) => {
      const start = /^(\s*)- name: /.exec(line);
      if (!start) return;
      const indent = start[1]!.length;
      let end = i + 1;
      while (end < lines.length && (lines[end]!.trim() === '' || /^\s*/.exec(lines[end]!)![0].length > indent)) end++;
      out.push(lines.slice(i, end).join('\n'));
    });
    return out;
  };

  test('review uploads carry only bundles the public-output gate verified', () => {
    // The gate writes --bundle only on PASS, so an upload of that directory is an upload of verified files.
    let uploads = 0;
    for (const { file, text } of workflows()) {
      const bundles = new Set([...text.matchAll(/--bundle="\$RUNNER_TEMP\/([\w.-]+)"/g)].map((m) => m[1]));
      for (const step of steps(text)) {
        if (!/uses:\s*actions\/upload-artifact@/.test(step)) continue;
        uploads++;
        const uploaded = /\n\s+path: \$\{\{ runner\.temp \}\}\/([\w.-]+)\n/.exec(`${step}\n`)?.[1];
        assert.ok(uploaded && bundles.has(uploaded), `${file}: an upload step uploads something other than a bundle the gate wrote`);
        assert.ok(!/\n\s+if:/.test(step), `${file}: an upload step must only run after every earlier step passed`);
      }
    }
    assert.ok(uploads >= 2, `the scan found ${uploads} upload steps`);
  });
});
