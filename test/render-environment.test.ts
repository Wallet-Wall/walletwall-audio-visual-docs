// The render environment as a closed schema, its classification against the approved classes, and the
// approved/observed/changed diff an operator reads when a host stops being approved (src/blender/environment.ts).
// No Blender, GPU, or network: the records below are written the way Blender's render.py records them.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { classifyEnvironment, environmentClassId, environmentsDocumentProblems, formatEnvironmentDiff, parseRenderEnvironment, publicationEnvironmentCheck } from '../src/blender/environment.ts';
import { environmentClass, loadEnvironments, type RenderEnvironment } from '../src/blender/identity.ts';
import { loadBlenderConfig } from '../src/blender/toolchain.ts';
import { VIDEO_ROOT } from '../src/config/load.ts';
import { contentAddress } from '../src/core/hash.ts';

const cfg = loadBlenderConfig();
const envs = loadEnvironments();

/** As render.py render_environment() records the production host (the committed reference's own record). */
const RTX: RenderEnvironment = {
  os: 'windows',
  blenderVersion: '5.2.2 LTS',
  blenderBuildHash: 'd13f752e3b9c',
  engine: 'BLENDER_EEVEE',
  gpu: { backend: 'OPENGL', vendor: 'NVIDIA Corporation', renderer: 'NVIDIA GeForce RTX 5080/PCIe/SSE2', version: '4.6.0 NVIDIA 616.56', deviceType: 'NVIDIA' },
};
/** The proof class: Linux, Mesa llvmpipe (CPU software GL). */
const SOFT: RenderEnvironment = {
  os: 'linux',
  blenderVersion: '5.2.2 LTS',
  blenderBuildHash: 'd13f752e3b9c',
  engine: 'BLENDER_EEVEE',
  gpu: { backend: 'OPENGL', vendor: 'Mesa', renderer: 'llvmpipe (LLVM 21.1.8, 256 bits)', version: '4.5 (Core Profile) Mesa 26.0.3-1ubuntu1', deviceType: 'SOFTWARE' },
};

/** A copy of a record with one change. */
const changed = (base: RenderEnvironment, edit: (e: Record<string, any>) => void): Record<string, any> => {
  const copy = structuredClone(base) as unknown as Record<string, any>;
  edit(copy);
  return copy;
};

describe('the render-environment record is a closed schema', () => {
  test('the two approved environments, as Blender records them, parse unchanged', () => {
    for (const env of [RTX, SOFT]) {
      const r = parseRenderEnvironment(env);
      assert.equal(r.ok, true, JSON.stringify(r));
      if (r.ok) assert.deepEqual(r.env, env);
    }
    // A host that reports no GPU is still a well-formed record (no class approves it).
    assert.equal(parseRenderEnvironment({ ...RTX, gpu: { unavailable: 'ImportError' } }).ok, true);
  });

  test('an unknown top-level field fails closed; the problem names the field, never its value', () => {
    const r = parseRenderEnvironment(changed(RTX, (e) => (e.hostname = 'RENDER-HOST-7')));
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.deepEqual(r.problems, ['$.hostname: unknown field']);
      assert.ok(!r.problems.join(' ').includes('RENDER-HOST-7'));
    }
  });

  test('an unknown field inside gpu fails closed', () => {
    const r = parseRenderEnvironment(changed(RTX, (e) => (e.gpu.driverPath = 'x')));
    assert.equal(r.ok, false);
    if (!r.ok) assert.deepEqual(r.problems, ['$.gpu.driverPath: unknown field']);
  });

  test('a field name that is not a plain identifier is refused without being echoed', () => {
    const r = parseRenderEnvironment(changed(RTX, (e) => (e['C:\\Users\\example'] = 'x')));
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.deepEqual(r.problems, ['$: an unknown field (its name is not shown)']);
      assert.ok(!r.problems.join(' ').includes('Users'));
    }
  });

  test('a missing field, a value of the wrong type, or an over-long value fails closed', () => {
    const missing = parseRenderEnvironment(changed(RTX, (e) => delete e.engine));
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.deepEqual(missing.problems, ['$.engine: missing']);
    const number = parseRenderEnvironment(changed(RTX, (e) => (e.gpu.version = 616.56)));
    assert.equal(number.ok, false);
    if (!number.ok) assert.deepEqual(number.problems, ['$.gpu.version: not a string']);
    const long = parseRenderEnvironment(changed(RTX, (e) => (e.gpu.renderer = 'R'.repeat(400))));
    assert.equal(long.ok, false);
    if (!long.ok) assert.deepEqual(long.problems, ['$.gpu.renderer: longer than 160 characters']);
    const notObject = parseRenderEnvironment('windows');
    assert.equal(notObject.ok, false);
    const control = parseRenderEnvironment(changed(RTX, (e) => (e.gpu.vendor = 'NVIDIA\nCorporation')));
    assert.equal(control.ok, false);
    if (!control.ok) assert.deepEqual(control.problems, ['$.gpu.vendor: has characters outside printable ASCII']);
  });

  test('the Blender build fields must look like a Blender build', () => {
    const r = parseRenderEnvironment(changed(RTX, (e) => (e.blenderBuildHash = 'not-a-hash')));
    assert.equal(r.ok, false);
    if (!r.ok) assert.deepEqual(r.problems, ['$.blenderBuildHash: not a 12-digit build hash']);
  });

  test('a local path inside an allowed field fails closed without echoing it', () => {
    for (const leak of ['C:\\Users\\example\\AppData\\gpu', '/home/example/.local/gpu', '/Users/example/gpu']) {
      const r = parseRenderEnvironment(changed(RTX, (e) => (e.gpu.renderer = leak)));
      assert.equal(r.ok, false, leak);
      if (!r.ok) {
        assert.equal(r.problems.length, 1);
        assert.match(r.problems[0]!, /^\$\.gpu\.renderer: contains a local path/);
        assert.ok(!r.problems[0]!.includes('example'), r.problems[0]);
      }
    }
  });

  test('a secret-shaped value inside an allowed field fails closed without echoing it', () => {
    const token = `ghp_${'a1B2c3D4e5'.repeat(4)}`;
    const r = parseRenderEnvironment(changed(RTX, (e) => (e.gpu.version = token)));
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.match(r.problems[0]!, /^\$\.gpu\.version: contains a secret-shaped value/);
      assert.ok(!r.problems[0]!.includes(token));
    }
  });
});

describe('classifying a render environment', () => {
  test('the production record is approved as the publication class, and the Linux record as the proof class', () => {
    const rtx = classifyEnvironment(RTX, cfg, envs);
    assert.equal(rtx.status, 'APPROVED');
    assert.equal(rtx.approvedClass?.name, 'production-rtx5080');
    assert.equal(rtx.approvedClass?.purpose, 'publication');
    assert.deepEqual(rtx.diff?.changed, []);
    const soft = classifyEnvironment(SOFT, cfg, envs);
    assert.equal(soft.status, 'APPROVED');
    assert.equal(soft.approvedClass?.name, 'proof-linux-software-gl');
  });

  test('a driver-only change is an unapproved candidate whose diff names only the driver', () => {
    const r = classifyEnvironment(changed(RTX, (e) => (e.gpu.version = '4.6.0 NVIDIA 620.10')), cfg, envs);
    assert.equal(r.status, 'UNAPPROVED');
    assert.equal(r.approvedClass, null);
    assert.equal(r.nearest?.name, 'production-rtx5080');
    assert.deepEqual(r.diff?.changed, ['driver']);
    assert.notEqual(r.classId, classifyEnvironment(RTX, cfg, envs).classId, 'another driver is another class');
  });

  test('a GPU change is an unapproved candidate whose diff names the GPU', () => {
    const r = classifyEnvironment(changed(RTX, (e) => (e.gpu.renderer = 'NVIDIA GeForce RTX 4090/PCIe/SSE2')), cfg, envs);
    assert.equal(r.status, 'UNAPPROVED');
    assert.equal(r.nearest?.name, 'production-rtx5080');
    assert.deepEqual(r.diff?.changed, ['gpu']);
  });

  test('a Blender version change is an unapproved candidate even though every GPU field matches', () => {
    const r = classifyEnvironment(changed(RTX, (e) => (e.blenderVersion = '5.2.3 LTS')), cfg, envs);
    assert.equal(r.status, 'UNAPPROVED');
    assert.equal(r.nearest?.name, 'production-rtx5080');
    assert.deepEqual(r.diff?.changed, ['blender']);
    // And another build of the same version.
    const hash = classifyEnvironment(changed(RTX, (e) => (e.blenderBuildHash = '0123456789ab')), cfg, envs);
    assert.equal(hash.status, 'UNAPPROVED');
    assert.deepEqual(hash.diff?.changed, ['blender']);
  });

  test('an unknown field fails closed even when every pinned field matches', () => {
    const r = classifyEnvironment(changed(RTX, (e) => (e.user = 'example')), cfg, envs);
    assert.equal(r.status, 'INVALID');
    assert.equal(r.approvedClass, null);
    assert.equal(r.diff, null, 'no diff is drawn from a record that is not an environment');
    assert.deepEqual(r.problems, ['$.user: unknown field']);
  });

  test('a host without a reported GPU is never approved', () => {
    const r = classifyEnvironment({ ...RTX, gpu: { unavailable: 'ImportError' } }, cfg, envs);
    assert.equal(r.status, 'UNAPPROVED');
    assert.ok(r.diff?.changed.includes('gpu'));
  });

  test('environmentClass, which staging and the public-output gate use, applies the same rules', () => {
    assert.equal(environmentClass(RTX, cfg, envs).approvedAs?.name, 'production-rtx5080');
    assert.equal(environmentClass(changed(RTX, (e) => (e.hostname = 'x')) as unknown as RenderEnvironment, cfg, envs).approvedAs, null);
    assert.equal(environmentClass(changed(RTX, (e) => (e.blenderBuildHash = '0123456789ab')) as unknown as RenderEnvironment, cfg, envs).approvedAs, null);
    assert.equal(environmentClass(changed(RTX, (e) => (e.gpu.version = '4.6.0 NVIDIA 620.10')) as unknown as RenderEnvironment, cfg, envs).approvedAs, null);
  });

  test('the class id is derived as it always was: the committed reference records the id of its own environment and config', () => {
    const ref = JSON.parse(readFileSync(path.join(VIDEO_ROOT, 'blender', 'proof', 'reference', 'proof.json'), 'utf8')) as { environment: RenderEnvironment; environmentClass: string; blenderConfigSha256: string };
    assert.equal(contentAddress({ env: ref.environment, renderConfigSha256: ref.blenderConfigSha256 }).slice(0, 16), ref.environmentClass);
    assert.equal(environmentClassId(RTX, cfg), contentAddress({ env: RTX, renderConfigSha256: contentAddress(cfg) }).slice(0, 16));
    assert.equal(classifyEnvironment(RTX, cfg, envs).classId, environmentClass(RTX, cfg, envs).id);
  });
});

describe("publication:proof's environment step", () => {
  test('the production record proceeds, naming its class', () => {
    const r = publicationEnvironmentCheck(RTX, cfg, envs);
    assert.equal(r.ok, true);
    assert.match(r.lines.join('\n'), /production-rtx5080 \(publication\)/);
  });
  test('a new driver stops before the render, with the diff and the requalification path; nothing is approved', () => {
    const r = publicationEnvironmentCheck(changed(RTX, (e) => (e.gpu.version = '4.6.0 NVIDIA 620.10')), cfg, envs);
    assert.equal(r.ok, false);
    const text = r.lines.join('\n');
    assert.match(text, /changed:\n {2}driver/);
    assert.match(text, /npm run blender:qualify-production/);
    assert.match(text, /no command makes it/);
  });
  test('the proof class stops with "not a production host" and a diff against the publication class, not a requalification', () => {
    const r = publicationEnvironmentCheck(SOFT, cfg, envs);
    assert.equal(r.ok, false);
    const text = r.lines.join('\n');
    assert.match(text, /proof-linux-software-gl class \(proof\): it renders proof frames, never a publication/);
    assert.match(text, /approved \(production-rtx5080, publication\)/);
    assert.ok(!/blender:qualify-production/.test(text));
  });
  test('a record outside the schema stops, naming the field only', () => {
    const r = publicationEnvironmentCheck(changed(RTX, (e) => (e.hostname = 'RENDER-HOST-7')), cfg, envs);
    assert.equal(r.ok, false);
    assert.match(r.lines.join('\n'), /\$\.hostname: unknown field/);
    assert.ok(!r.lines.join('\n').includes('RENDER-HOST-7'));
  });
});

describe('the approved classes document', () => {
  test("this checkout's classes are well-formed", () => {
    assert.deepEqual(environmentsDocumentProblems(envs), []);
  });
  test('a class that pins no OS or engine, an unknown purpose, a duplicate name, an unknown field, or no GPU pin is refused', () => {
    const base = structuredClone(envs);
    const variants: [string, (d: any) => void, RegExp][] = [
      ['no os', (d) => delete d.classes[0].match.os, /classes\[0\]\.match\.os/],
      ['no engine', (d) => delete d.classes[0].match.engine, /classes\[0\]\.match\.engine/],
      ['purpose', (d) => (d.classes[1].purpose = 'publish'), /classes\[1\]\.purpose/],
      ['duplicate', (d) => (d.classes[1].name = d.classes[0].name), /duplicate/],
      ['unknown field', (d) => (d.classes[0].match.gpu.driverAtLeast = '600'), /unknown field/],
      ['no gpu pin', (d) => (d.classes[0].match.gpu = { vendor: 'NVIDIA Corporation' }), /renderer or rendererPrefix/],
    ];
    for (const [label, edit, want] of variants) {
      const d = structuredClone(base);
      edit(d);
      const problems = environmentsDocumentProblems(d);
      assert.ok(problems.some((p) => want.test(p)), `${label}: ${problems.join('; ')}`);
    }
  });
});

describe('the environment diff', () => {
  test('is deterministic text naming only closed-schema fields: approved, observed, changed', () => {
    const r = classifyEnvironment(changed(RTX, (e) => (e.gpu.version = '4.6.0 NVIDIA 620.10')), cfg, envs);
    assert.ok(r.diff);
    assert.equal(
      formatEnvironmentDiff(r.diff),
      [
        'approved (production-rtx5080, publication):',
        '  os: windows',
        '  blender: 5.2.2 (d13f752e3b9c)',
        '  engine: BLENDER_EEVEE',
        '  gpu vendor: NVIDIA Corporation',
        '  gpu: NVIDIA GeForce RTX 5080/PCIe/SSE2',
        '  driver: 4.6.0 NVIDIA 616.56',
        'observed:',
        '  os: windows',
        '  blender: 5.2.2 (d13f752e3b9c)',
        '  engine: BLENDER_EEVEE',
        '  gpu vendor: NVIDIA Corporation',
        '  gpu: NVIDIA GeForce RTX 5080/PCIe/SSE2',
        '  driver: 4.6.0 NVIDIA 620.10',
        '  gpu backend: OPENGL',
        '  gpu device type: NVIDIA',
        'changed:',
        '  driver',
      ].join('\n'),
    );
  });

  test('says so when nothing the class pins has changed', () => {
    const r = classifyEnvironment(RTX, cfg, envs);
    assert.ok(r.diff);
    assert.match(formatEnvironmentDiff(r.diff), /\nchanged:\n {2}\(none\)$/);
  });

  test('a prefix-pinned field shows the prefix it must start with', () => {
    const r = classifyEnvironment(changed(SOFT, (e) => (e.gpu.renderer = 'softpipe')), cfg, envs, { prefer: 'proof' });
    assert.equal(r.status, 'UNAPPROVED');
    assert.equal(r.nearest?.name, 'proof-linux-software-gl');
    assert.match(formatEnvironmentDiff(r.diff!), /\n {2}gpu: llvmpipe\*\n/);
    assert.deepEqual(r.diff?.changed, ['gpu']);
  });

  test('a GPU change on Windows is diffed against the publication class, not the proof class', () => {
    // Equally far from both (the GPU and its driver, versus the OS and the GPU): publication wins the tie.
    const r = classifyEnvironment(changed(RTX, (e) => ((e.gpu.renderer = 'NVIDIA GeForce RTX 6000/PCIe/SSE2'), (e.gpu.version = '4.6.0 NVIDIA 700.01'))), cfg, envs);
    assert.equal(r.nearest?.name, 'production-rtx5080');
    assert.deepEqual(r.diff?.changed, ['gpu', 'driver']);
  });
});
