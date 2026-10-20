// The render environment as a closed schema, its classification against the approved classes, and the
// approved/observed/changed diff an operator reads when a host stops being approved (src/blender/environment.ts).
// No Blender, GPU, or network: the records below are written the way Blender's render.py records them.

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { blenderPinProblems, classBlenderPinProblem, classifyEnvironment, environmentClassId, environmentsDocumentProblems, environmentSummary, formatEnvironmentDiff, parseRenderEnvironment, publicationEnvironmentCheck, referenceExportProblem } from '../src/blender/environment.ts';
import { environmentClass, loadEnvironments, type EnvironmentsDocument, type RenderEnvironment } from '../src/blender/identity.ts';
import { loadBlenderConfig } from '../src/blender/toolchain.ts';
import { VIDEO_ROOT } from '../src/config/load.ts';
import { contentAddress } from '../src/core/hash.ts';
import { scratchArea } from './publication-fixtures.ts';

const cfg = loadBlenderConfig();
const envs = loadEnvironments();
const area = scratchArea('environment');
after(area.cleanup);

/** A copy of this checkout's classes document with one edit (any shape: the point is what the checks make of it). */
const docWith = (edit: (d: any) => void): EnvironmentsDocument => {
  const d = structuredClone(envs) as any;
  edit(d);
  return d as EnvironmentsDocument;
};
/** The same value with every object's keys in reverse order. */
const reversedKeys = (v: unknown): unknown => (Array.isArray(v) ? v.map(reversedKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reversedKeys(x)])) : v);
/** Another Blender build: what a reviewed bump of config/blender.json would pin. */
const NEXT_BUILD = { version: '5.2.3', buildHash: '0123456789ab' };

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
    assert.deepEqual(r.diff?.changed, ['blender version']);
    // And another build of the same version: only the build is named.
    const hash = classifyEnvironment(changed(RTX, (e) => (e.blenderBuildHash = '0123456789ab')), cfg, envs);
    assert.equal(hash.status, 'UNAPPROVED');
    assert.deepEqual(hash.diff?.changed, ['blender build']);
    // The release type ("LTS") is not part of the version a class pins.
    assert.equal(classifyEnvironment(changed(RTX, (e) => (e.blenderVersion = '5.2.2')), cfg, envs).status, 'APPROVED');
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
      ['no gpu pin', (d) => (d.classes[0].match.gpu = { backend: 'OPENGL', vendor: 'NVIDIA Corporation' }), /renderer or rendererPrefix/],
    ];
    for (const [label, edit, want] of variants) {
      const d = structuredClone(base);
      edit(d);
      const problems = environmentsDocumentProblems(d);
      assert.ok(problems.some((p) => want.test(p)), `${label}: ${problems.join('; ')}`);
    }
  });

  test('each new requirement refuses its own violation, by field name (positive controls)', () => {
    const variants: [string, (d: any) => void, string][] = [
      ['no Blender pin', (d) => delete d.classes[0].match.blender, 'classes[0].match.blender: the class must pin the Blender build it was qualified on ({ version, buildHash }, as config/blender.json pins it)'],
      ['a Blender pin that is not an object', (d) => (d.classes[1].match.blender = '5.2.2 (d13f752e3b9c)'), 'classes[1].match.blender: the class must pin the Blender build it was qualified on ({ version, buildHash }, as config/blender.json pins it)'],
      ['an unknown field in the Blender pin', (d) => (d.classes[0].match.blender.series = '5.2 LTS'), 'classes[0].match.blender: unknown field'],
      ['a version with its release type', (d) => (d.classes[0].match.blender.version = '5.2.2 LTS'), 'classes[0].match.blender.version: not a Blender release version as config/blender.json pins it (e.g. 5.2.2)'],
      ['a short build hash', (d) => (d.classes[0].match.blender.buildHash = 'd13f752e3b9'), 'classes[0].match.blender.buildHash: not a 12-digit build hash'],
      ['no backend', (d) => delete d.classes[1].match.gpu.backend, 'classes[1].match.gpu.backend: the class must pin the GPU backend'],
      ['a backend not named as Blender names it', (d) => (d.classes[0].match.gpu.backend = 'opengl'), 'classes[0].match.gpu.backend: not a GPU backend as Blender names it (e.g. OPENGL)'],
      ['an empty backend', (d) => (d.classes[0].match.gpu.backend = ''), 'classes[0].match.gpu.backend: not a string'],
      ['a publication class without a vendor', (d) => delete d.classes[0].match.gpu.vendor, 'classes[0].match.gpu.vendor: a publication class must pin it'],
      ['a publication class without a driver', (d) => delete d.classes[0].match.gpu.version, 'classes[0].match.gpu.version: a publication class must pin the driver'],
      ['a publication class by renderer prefix', (d) => ((d.classes[0].match.gpu.rendererPrefix = 'NVIDIA GeForce'), delete d.classes[0].match.gpu.renderer), 'classes[0].match.gpu.rendererPrefix: a publication class pins the exact renderer, never a prefix'],
      ['an unknown field in the match', (d) => (d.classes[0].match.blenderAtLeast = '5.2'), 'classes[0].match: unknown field'],
    ];
    for (const [label, edit, want] of variants) {
      const problems = environmentsDocumentProblems(docWith(edit));
      assert.ok(problems.includes(want), `${label}: ${problems.join('; ')}`);
      // The control: the same document without the edit has no problems.
      assert.deepEqual(environmentsDocumentProblems(docWith(() => {})), [], label);
    }
    // A proof class may pin a renderer family and leave the vendor and driver open; a publication class may not.
    assert.deepEqual(environmentsDocumentProblems(docWith((d) => delete d.classes[1].match.gpu.vendor)), []);
    assert.ok(environmentsDocumentProblems(docWith((d) => (d.classes[1].purpose = 'publication'))).includes('classes[1].match.gpu.rendererPrefix: a publication class pins the exact renderer, never a prefix'));
  });

  test('a class in the older shape (no Blender build, no backend) fails explicitly and is never read as a wildcard', () => {
    const old = docWith((d) => {
      for (const c of d.classes) {
        delete c.match.blender;
        delete c.match.gpu.backend;
      }
    });
    const problems = environmentsDocumentProblems(old);
    for (const i of [0, 1]) {
      assert.ok(problems.includes(`classes[${i}].match.blender: the class must pin the Blender build it was qualified on ({ version, buildHash }, as config/blender.json pins it)`), problems.join('\n'));
      assert.ok(problems.includes(`classes[${i}].match.gpu.backend: the class must pin the GPU backend`), problems.join('\n'));
    }
    // A caller that skipped validation still approves nothing: the missing pins are changed fields, not wildcards.
    for (const [record, name, prefer] of [[RTX, 'production-rtx5080', 'publication'], [SOFT, 'proof-linux-software-gl', 'proof']] as const) {
      const r = classifyEnvironment(record, cfg, old, { prefer });
      assert.equal(r.status, 'UNAPPROVED', name);
      assert.equal(r.nearest?.name, name);
      assert.deepEqual(r.diff?.changed, ['blender version', 'blender build', 'gpu backend'], name);
      assert.match(formatEnvironmentDiff(r.diff!), /\n {2}blender build: \(not pinned: the class is incomplete\)\n/);
      assert.ok(r.diff!.classProblems.some((p) => /match\.gpu\.backend: the class must pin the GPU backend/.test(p)), name);
    }
  });

  test('loading refuses a v1 document, and a v2 document in the older shape, naming why', () => {
    const v1 = docWith((d) => {
      d.schema = 'walletwall.blender-environments/v1';
      for (const c of d.classes) {
        delete c.match.blender;
        delete c.match.gpu.backend;
      }
    });
    const dir = area.dir('documents');
    writeFileSync(path.join(dir, 'v1.json'), JSON.stringify(v1));
    assert.throws(() => loadEnvironments(path.join(dir, 'v1.json')), /is not walletwall\.blender-environments\/v2 \(classes must pin the Blender build and the GPU backend/);
    writeFileSync(path.join(dir, 'v2-old-shape.json'), JSON.stringify({ ...v1, schema: 'walletwall.blender-environments/v2' }));
    assert.throws(() => loadEnvironments(path.join(dir, 'v2-old-shape.json')), /does not define valid classes: .*classes\[0\]\.match\.blender: the class must pin the Blender build/);
    writeFileSync(path.join(dir, 'v2.json'), JSON.stringify(envs));
    assert.deepEqual(loadEnvironments(path.join(dir, 'v2.json')), envs);
  });
});

describe('every class pins the GPU backend and the Blender build it was qualified on', () => {
  test('the two classes pin what their recorded evidence reports', () => {
    // The production class: the committed reference's own record (the RTX host qualified it).
    const ref = JSON.parse(readFileSync(path.join(VIDEO_ROOT, 'blender', 'proof', 'reference', 'proof.json'), 'utf8')) as { environment: RenderEnvironment & { gpu: { backend: string } } };
    const prod = envs.classes.find((c) => c.name === 'production-rtx5080')!;
    assert.equal(prod.match.gpu.backend, ref.environment.gpu.backend);
    assert.deepEqual(prod.match.blender, { version: ref.environment.blenderVersion.split(' ')[0], buildHash: ref.environment.blenderBuildHash });
    // The proof class: the Linux software-GL record (SOFT, as the recorded proof run reported it).
    const proof = envs.classes.find((c) => c.name === 'proof-linux-software-gl')!;
    assert.equal(proof.match.gpu.backend, (SOFT.gpu as { backend: string }).backend);
    assert.deepEqual(proof.match.blender, { version: SOFT.blenderVersion.split(' ')[0], buildHash: SOFT.blenderBuildHash });
  });

  test("this checkout's classes pin the build config/blender.json pins", () => {
    assert.deepEqual(blenderPinProblems(envs, cfg), []);
    for (const c of envs.classes) assert.equal(classBlenderPinProblem(c, cfg), null, c.name);
  });

  test('a matching backend and Blender build approve, and the diff shows both as pinned (the device type stays unpinned)', () => {
    const r = classifyEnvironment(RTX, cfg, envs);
    assert.equal(r.status, 'APPROVED');
    const approved = Object.fromEntries(r.diff!.fields.map((f) => [f.key, f.approved]));
    assert.equal(approved['gpu.backend'], 'OPENGL');
    assert.equal(approved.blenderVersion, '5.2.2');
    assert.equal(approved.blenderBuildHash, 'd13f752e3b9c');
    assert.equal(approved['gpu.deviceType'], null);
    assert.deepEqual(r.diff!.classProblems, []);
  });

  test('a backend-only change is unapproved, for the publication class and the proof class alike', () => {
    const vulkan = changed(RTX, (e) => (e.gpu.backend = 'VULKAN'));
    const rtx = classifyEnvironment(vulkan, cfg, envs);
    assert.equal(rtx.status, 'UNAPPROVED');
    assert.equal(rtx.nearest?.name, 'production-rtx5080');
    assert.deepEqual(rtx.diff?.changed, ['gpu backend']);
    assert.match(formatEnvironmentDiff(rtx.diff!), /\n {2}gpu backend: OPENGL\nobserved:\n[\s\S]*\n {2}gpu backend: VULKAN\n[\s\S]*\nchanged:\n {2}gpu backend$/);
    const soft = classifyEnvironment(changed(SOFT, (e) => (e.gpu.backend = 'VULKAN')), cfg, envs, { prefer: 'proof' });
    assert.equal(soft.status, 'UNAPPROVED');
    assert.equal(soft.nearest?.name, 'proof-linux-software-gl');
    assert.deepEqual(soft.diff?.changed, ['gpu backend']);
    // Never accepted because the vendor, renderer, and driver still match: not by staging, not by publication:proof.
    assert.equal(environmentClass(vulkan as unknown as RenderEnvironment, cfg, envs).approvedAs, null);
    const proof = publicationEnvironmentCheck(vulkan, cfg, envs);
    assert.equal(proof.ok, false);
    assert.match(proof.lines.join('\n'), /changed:\n {2}gpu backend/);
  });

  test('a record without a backend, or with a field beside it, fails closed', () => {
    const missing = classifyEnvironment(changed(RTX, (e) => delete e.gpu.backend), cfg, envs);
    assert.equal(missing.status, 'INVALID');
    assert.deepEqual(missing.problems, ['$.gpu.backend: missing']);
    const extra = parseRenderEnvironment(changed(RTX, (e) => (e.gpu.backendVersion = '4.6')));
    assert.equal(extra.ok, false);
    if (!extra.ok) assert.deepEqual(extra.problems, ['$.gpu.backendVersion: unknown field']);
  });

  test('a host that reports no GPU, or reports it as unknown, never matches a class', () => {
    for (const gpu of [{ unavailable: 'ImportError' }, { ...RTX.gpu, backend: 'UNKNOWN' }, { ...RTX.gpu, backend: '(unavailable)' }]) {
      const r = classifyEnvironment({ ...RTX, gpu }, cfg, envs);
      assert.equal(r.status, 'UNAPPROVED', JSON.stringify(gpu));
      assert.ok(r.diff!.changed.length > 0);
    }
    // Even a class that pins "(unavailable)" verbatim cannot approve a host without a GPU.
    const odd = docWith((d) => (d.classes[0].match.gpu = { backend: 'OPENGL', vendor: '(unavailable)', renderer: '(unavailable)', version: '(unavailable)' }));
    assert.equal(classifyEnvironment({ ...RTX, gpu: { unavailable: 'ImportError' } }, cfg, odd).status, 'UNAPPROVED');
  });

  test('several changes are listed in the fixed field order, whatever order the record was written in', () => {
    const edited = changed(RTX, (e) => ((e.gpu.backend = 'VULKAN'), (e.blenderBuildHash = '0123456789ab'), (e.gpu.version = '4.6.0 NVIDIA 620.10')));
    const r = classifyEnvironment(edited, cfg, envs);
    assert.deepEqual(r.diff?.changed, ['blender build', 'driver', 'gpu backend']);
    const reversed = reversedKeys(edited);
    assert.notEqual(JSON.stringify(reversed), JSON.stringify(edited));
    const again = classifyEnvironment(reversed, cfg, envs);
    assert.equal(again.classId, r.classId);
    assert.equal(formatEnvironmentDiff(again.diff!), formatEnvironmentDiff(r.diff!));
    assert.equal(environmentSummary(again), environmentSummary(r));
  });
});

describe("a class's Blender pin and config/blender.json must agree", () => {
  const MESSAGE = 'publication class "production-rtx5080" was qualified with Blender build 5.2.2 (0123456789ab), but the current pinned build is 5.2.2 (d13f752e3b9c)';

  test('a class qualified on another build approves nothing, naming both builds', () => {
    const doc = docWith((d) => (d.classes[0].match.blender.buildHash = '0123456789ab'));
    assert.deepEqual(blenderPinProblems(doc, cfg), [MESSAGE]);
    // A record from the build the class names: every field matches the class, but config/blender.json pins another build.
    const fromClassBuild = classifyEnvironment(changed(RTX, (e) => (e.blenderBuildHash = '0123456789ab')), cfg, doc);
    assert.equal(fromClassBuild.status, 'UNAPPROVED');
    assert.deepEqual(fromClassBuild.diff?.changed, []);
    assert.deepEqual(fromClassBuild.diff?.classProblems, [MESSAGE]);
    // A record from the pinned build: it differs from the class's pin, and the class is incoherent all the same.
    const fromPinned = classifyEnvironment(RTX, cfg, doc);
    assert.equal(fromPinned.status, 'UNAPPROVED');
    assert.deepEqual(fromPinned.diff?.changed, ['blender build']);
    assert.match(formatEnvironmentDiff(fromPinned.diff!), new RegExp(`\\nthe class approves nothing:\\n {2}${MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
    assert.match(environmentSummary(fromPinned), /; the class approves nothing: publication class "production-rtx5080" was qualified with Blender build/);
  });

  test('updating config/blender.json alone keeps no class approved: neither the old build nor the new one', () => {
    const bumped = { ...cfg, blender: { ...cfg.blender, ...NEXT_BUILD } };
    assert.equal(classifyEnvironment(RTX, bumped, envs).status, 'UNAPPROVED');
    const fresh = classifyEnvironment(changed(RTX, (e) => ((e.blenderVersion = '5.2.3 LTS'), (e.blenderBuildHash = NEXT_BUILD.buildHash))), bumped, envs);
    assert.equal(fresh.status, 'UNAPPROVED');
    assert.deepEqual(fresh.diff?.changed, ['blender version', 'blender build']);
    assert.deepEqual(blenderPinProblems(envs, bumped), [
      'publication class "production-rtx5080" was qualified with Blender build 5.2.2 (d13f752e3b9c), but the current pinned build is 5.2.3 (0123456789ab)',
      'proof class "proof-linux-software-gl" was qualified with Blender build 5.2.2 (d13f752e3b9c), but the current pinned build is 5.2.3 (0123456789ab)',
    ]);
  });

  test('updating a class alone never blesses an unpinned Blender', () => {
    const doc = docWith((d) => (d.classes[0].match.blender = { ...NEXT_BUILD }));
    const r = classifyEnvironment(changed(RTX, (e) => ((e.blenderVersion = '5.2.3 LTS'), (e.blenderBuildHash = NEXT_BUILD.buildHash))), cfg, doc);
    assert.equal(r.status, 'UNAPPROVED');
    assert.deepEqual(r.diff?.changed, []);
    assert.deepEqual(r.diff?.classProblems, ['publication class "production-rtx5080" was qualified with Blender build 5.2.3 (0123456789ab), but the current pinned build is 5.2.2 (d13f752e3b9c)']);
  });

  test('updating both together approves the new build, and only it', () => {
    const bumped = { ...cfg, blender: { ...cfg.blender, ...NEXT_BUILD } };
    const doc = docWith((d) => {
      for (const c of d.classes) c.match.blender = { ...NEXT_BUILD };
    });
    assert.deepEqual(blenderPinProblems(doc, bumped), []);
    assert.equal(classifyEnvironment(changed(RTX, (e) => ((e.blenderVersion = '5.2.3 LTS'), (e.blenderBuildHash = NEXT_BUILD.buildHash))), bumped, doc).status, 'APPROVED');
    assert.equal(classifyEnvironment(RTX, bumped, doc).status, 'UNAPPROVED');
  });

  test('neither message nor diff echoes a malformed pin', () => {
    const doc = docWith((d) => (d.classes[0].match.blender.version = 'C:\\Users\\example\\blender'));
    const r = classifyEnvironment(RTX, cfg, doc);
    assert.equal(r.status, 'UNAPPROVED');
    const shown = [formatEnvironmentDiff(r.diff!), environmentSummary(r)].join('\n');
    assert.ok(!shown.includes('example'), shown);
    assert.ok(r.diff!.classProblems.includes('classes[0].match.blender.version: not a Blender release version as config/blender.json pins it (e.g. 5.2.2)'));
    assert.match(classBlenderPinProblem(doc.classes[0], cfg)!, /was qualified with Blender build \(not a Blender build\), but the current pinned build is 5\.2\.2 \(d13f752e3b9c\)$/);
  });
});

describe('an unvalidated or code-built classes document fails closed, without throwing or echoing', () => {
  test('a class that is not an object is a class problem, never a crash', () => {
    for (const bad of [null, undefined, 'production-rtx5080', 7]) {
      const only = { ...structuredClone(envs), classes: [bad] } as unknown as EnvironmentsDocument;
      const r = classifyEnvironment(RTX, cfg, only);
      assert.equal(r.status, 'UNAPPROVED', String(bad));
      assert.deepEqual(r.diff?.classProblems, ['classes[0]: not an object'], String(bad));
      assert.equal(publicationEnvironmentCheck(RTX, cfg, only).ok, false, String(bad));
      // Beside the real classes it is passed over: the production class still approves its own host.
      assert.equal(classifyEnvironment(RTX, cfg, docWith((d) => d.classes.unshift(bad))).approvedClass?.name, 'production-rtx5080', String(bad));
    }
  });

  test('an invalid class name or purpose is never echoed into a diff or a summary', () => {
    const doc = docWith((d) => ((d.classes[0].name = 'C:\\Users\\example\\class'), (d.classes[0].purpose = '/home/example/purpose')));
    const r = classifyEnvironment(changed(RTX, (e) => (e.gpu.version = '4.6.0 NVIDIA 620.10')), cfg, doc);
    assert.equal(r.status, 'UNAPPROVED');
    const shown = [formatEnvironmentDiff(r.diff!), environmentSummary(r)].join('\n');
    assert.ok(!shown.includes('example'), shown);
    assert.match(shown, /^approved \(\(not a class name\), not a valid purpose\):/);
  });

  test('each class is read once, as plain data: a getter cannot answer the schema one thing and the match another', () => {
    let reads = 0;
    const doc = docWith(() => {});
    const gpu = doc.classes[0]!.match.gpu as Record<string, unknown>;
    delete gpu.backend;
    Object.defineProperty(gpu, 'backend', { enumerable: true, configurable: true, get: () => (reads++ === 0 ? 'VULKAN' : 'OPENGL') });
    const r = classifyEnvironment(changed(RTX, (e) => (e.gpu.backend = 'VULKAN')), cfg, doc);
    assert.equal(reads, 1, 'the class was read once');
    // Whatever it answered, the decision, the diff, and the class handed back agree on it.
    const shown = r.diff!.fields.find((f) => f.key === 'gpu.backend')!.approved;
    assert.equal(shown, 'VULKAN');
    assert.equal(r.status, 'APPROVED');
    assert.equal(r.approvedClass!.match.gpu.backend, shown);
  });

  test('agreement needs a well-formed class pin: a missing pin never "agrees" with a malformed config', () => {
    const noPin = docWith((d) => delete d.classes[0].match.blender).classes[0]!;
    const malformed = { ...cfg, blender: { ...cfg.blender, version: undefined, buildHash: undefined } } as unknown as typeof cfg;
    assert.match(classBlenderPinProblem(noPin, malformed)!, /was qualified with Blender build \(not a Blender build\), but the current pinned build is \(not a Blender build\)$/);
    assert.equal(blenderPinProblems({ ...structuredClone(envs), classes: [noPin] } as EnvironmentsDocument, malformed).length, 1);
    // The control: a well-formed pin equal to a well-formed config agrees.
    assert.equal(classBlenderPinProblem(envs.classes[0], cfg), null);
  });

  test('a polluted Object.prototype cannot supply a value shape to the record parser', () => {
    const proto = Object.prototype as Record<string, unknown>;
    try {
      proto.vendor = { re: /^$/, what: 'a polluted shape' };
      const r = parseRenderEnvironment(RTX);
      assert.equal(r.ok, true, JSON.stringify(r));
    } finally {
      delete proto.vendor;
    }
  });
});

describe('a proof run becomes the reference only in the publication class its own record derives', () => {
  const reference = JSON.parse(readFileSync(path.join(VIDEO_ROOT, 'blender', 'proof', 'reference', 'proof.json'), 'utf8')) as { environment: RenderEnvironment; environmentClass: string; approvedClass: string };

  test('the committed reference itself qualifies', () => {
    assert.equal(referenceExportProblem(reference, cfg, envs), null);
  });

  test('a run labelled production but recorded with another backend or Blender build is refused, whatever its label', () => {
    for (const edit of [(e: Record<string, any>) => (e.gpu.backend = 'VULKAN'), (e: Record<string, any>) => (e.blenderBuildHash = '0123456789ab')]) {
      const run = { ...reference, environment: changed(reference.environment, edit) };
      assert.match(referenceExportProblem(run, cfg, envs)!, /^it was not rendered in an approved publication class \(not approved; nearest approved class production-rtx5080/);
    }
  });

  test('a run whose recorded class id or name is not what its record derives is refused', () => {
    assert.match(referenceExportProblem({ ...reference, environmentClass: '0'.repeat(16) }, cfg, envs)!, /is not what its record derives \(d9777826203659db, production-rtx5080\)$/);
    assert.match(referenceExportProblem({ ...reference, approvedClass: 'proof-linux-software-gl' }, cfg, envs)!, /is not what its record derives/);
  });

  test('a proof-class run is never the reference, even labelled production', () => {
    const soft = { environment: SOFT, environmentClass: environmentClassId(SOFT, cfg), approvedClass: 'production-rtx5080' };
    assert.match(referenceExportProblem(soft, cfg, envs)!, /^it was not rendered in an approved publication class/);
  });

  test('classes that disagree with config/blender.json export nothing', () => {
    const doc = docWith((d) => (d.classes[0].match.blender.buildHash = '0123456789ab'));
    assert.match(referenceExportProblem(reference, cfg, doc)!, /the class approves nothing: publication class "production-rtx5080" was qualified with Blender build 5\.2\.2 \(0123456789ab\)/);
  });
});

describe('prototype names and inherited members never stand in for a pin or a field', () => {
  test('a class whose backend arrives only as an own "__proto__" member (raw JSON) pins no backend', () => {
    const viaProto = JSON.parse(JSON.stringify(envs).replace('"backend":"OPENGL",', '"__proto__":{"backend":"OPENGL"},')) as EnvironmentsDocument;
    assert.ok(Object.hasOwn(viaProto.classes[0]!.match.gpu, '__proto__'));
    const problems = environmentsDocumentProblems(viaProto);
    assert.ok(problems.includes('classes[0].match.gpu: unknown field'), problems.join('; '));
    assert.ok(problems.includes('classes[0].match.gpu.backend: the class must pin the GPU backend'), problems.join('; '));
    assert.equal(classifyEnvironment(RTX, cfg, viaProto).status, 'UNAPPROVED');
  });

  test('a backend or Blender pin inherited through a prototype is no pin', () => {
    const inheritedBackend = docWith((d) => {
      const { backend, ...rest } = d.classes[0].match.gpu;
      d.classes[0].match.gpu = Object.assign(Object.create({ backend }), rest);
    });
    assert.ok(environmentsDocumentProblems(inheritedBackend).includes('classes[0].match.gpu.backend: the class must pin the GPU backend'));
    assert.equal(classifyEnvironment(RTX, cfg, inheritedBackend).status, 'UNAPPROVED');
    const inheritedBlender = docWith((d) => {
      const blender = d.classes[0].match.blender;
      delete d.classes[0].match.blender;
      Object.setPrototypeOf(d.classes[0].match, { blender });
    });
    assert.equal(classifyEnvironment(RTX, cfg, inheritedBlender).status, 'UNAPPROVED');
    assert.ok(blenderPinProblems(inheritedBlender, cfg).length === 1, 'an inherited pin does not cohere either');
  });

  test('a record whose fields are inherited, or that carries an own "__proto__" member, is no record', () => {
    const inherited = parseRenderEnvironment(Object.create(structuredClone(RTX)));
    assert.equal(inherited.ok, false);
    if (!inherited.ok) assert.deepEqual(inherited.problems, ['$.os: missing', '$.blenderVersion: missing', '$.blenderBuildHash: missing', '$.engine: missing', '$.gpu: missing']);
    // Own top-level fields with every GPU field inherited: still no record, so never the production class.
    const inheritedGpu = classifyEnvironment({ ...structuredClone(RTX), gpu: Object.create(structuredClone(RTX.gpu)) }, cfg, envs);
    assert.equal(inheritedGpu.status, 'INVALID');
    assert.deepEqual(inheritedGpu.problems, ['$.gpu.backend: missing', '$.gpu.vendor: missing', '$.gpu.renderer: missing', '$.gpu.version: missing', '$.gpu.deviceType: missing']);
    const raw = JSON.parse(JSON.stringify(RTX).replace('"os":', '"__proto__":{"os":"windows"},"os":'));
    const parsed = parseRenderEnvironment(raw);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.deepEqual(parsed.problems, ['$: an unknown field (its name is not shown)']);
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
        '  blender version: 5.2.2',
        '  blender build: d13f752e3b9c',
        '  engine: BLENDER_EEVEE',
        '  gpu vendor: NVIDIA Corporation',
        '  gpu: NVIDIA GeForce RTX 5080/PCIe/SSE2',
        '  driver: 4.6.0 NVIDIA 616.56',
        '  gpu backend: OPENGL',
        'observed:',
        '  os: windows',
        '  blender version: 5.2.2',
        '  blender build: d13f752e3b9c',
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
