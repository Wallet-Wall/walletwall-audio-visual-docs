// The voice-rights policy of config/release-rights.json (docs/RELEASE_RIGHTS.md, "Voice rights"): a narration voice is
// used on a rights-and-consent basis, not on a blanket ban of every human-derived voice. It is cleared only when the
// right to use the voice and the right to use its output commercially are each established, the speaker keeps their
// voice and likeness, and no provider control is ignored. An unauthorized clone, reference audio without the speaker's
// authorization, or a voice whose basis cannot be established is refused. Each test changes exactly one thing.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { VIDEO_ROOT } from '../src/config/load.ts';
import { sha256Hex } from '../src/core/hash.ts';
import { buildIdentity } from '../src/manifest/build-identity.ts';
import { checkRights, type RightsMode, type RightsReport } from '../src/rights/check.ts';
import { validateManifest } from '../src/rights/manifest.ts';
import { fsRepo } from '../src/rights/repo.ts';
import { BASES_NEEDING_OWNER_CLEARANCE, RIGHTS_STATUSES, STATUSES_PERMITTED_IN, STRICT_STATE } from '../src/rights/vocabulary.ts';
import { baseFiles, baseManifest, BINDING_ID, component, designedVoice, FIXTURE_VOICE_ID, libraryVoice, licensedVoice, memoryRepo, repoWith, withNarration, type Json } from './rights-fixtures.ts';

const run = (repo: ReturnType<typeof repoWith>, mode: RightsMode): RightsReport => checkRights(repo, { mode });
const dev = (repo = repoWith((x) => withNarration(x))): RightsReport => run(repo, 'development');
const strict = (repo = repoWith((x) => withNarration(x))): RightsReport => run(repo, 'public-release');
const codes = (r: RightsReport): string[] => r.findings.map((f) => f.code);
const problems = (m: Json): string[] => validateManifest(m).problems;

/** The fixture manifest with the narration set up (the library voice, cleared), then `change` applied. */
function manifestOf(change: (m: Json) => void = () => {}, voice: Json = libraryVoice(), status = 'CLEARED'): Json {
  const x = { files: baseFiles(), manifest: baseManifest() };
  withNarration(x, voice, status);
  change(x.manifest);
  return x.manifest;
}
const service = (m: Json): Json => component(m, 'elevenlabs-service');
const voiceOf = (m: Json): Json => service(m).voiceRights;
const refuses = (m: Json, re: RegExp, label: string): void => assert.ok(problems(m).some((p) => re.test(p)), `${label}: expected a problem matching ${re}, got ${JSON.stringify(problems(m))}`);
const accepts = (m: Json, label: string): void => assert.deepEqual(problems(m), [], label);
/** What every item that is not CLEARED carries instead of the owner's record. */
const OPEN = { ownerAction: 'Establish the open question and record it.', reassessmentTrigger: 'The question is answered or the terms change.' };
/** Moves the provider service out of CLEARED the way a record must: the clearance goes, the owner action and trigger come. */
const reopen = (m: Json, status: string): void => {
  const c = service(m);
  c.status = status;
  delete c.clearance;
  c.resolution = { ...OPEN };
};
const withVoice = (voice: Json, status = 'CLEARED'): Json => manifestOf(() => {}, voice, status);
/** A clone from reference audio. Only the speaker's written authorization comes with the document that records its scope. */
const cloneFrom = (authorizationBasis: string): Json => {
  const { speakerAuthorization, ...rest } = licensedVoice();
  const documented = authorizationBasis === 'SPEAKER_WRITTEN_AUTHORIZATION';
  return { ...rest, voiceType: 'REFERENCE_AUDIO_CLONE', authorizationBasis, ...(documented ? { speakerAuthorization: { ...speakerAuthorization, scope: ['VOICE_CLONING', 'COMMERCIAL_USE', 'PUBLIC_DISTRIBUTION'] } } : {}) };
};

describe('1. unauthorized real-person cloning is blocked', () => {
  test('a clone whose speaker authorization is not established is BLOCKED: never cleared, never merely pending', () => {
    refuses(withVoice(cloneFrom('NOT_ESTABLISHED')), /whose authorization is not established is BLOCKED/, 'cleared');
    refuses(withVoice(cloneFrom('NOT_ESTABLISHED'), 'OWNER_CONFIRMATION_PENDING'), /whose authorization is not established is BLOCKED/, 'pending');
    refuses(withVoice(cloneFrom('NOT_ESTABLISHED'), 'UNKNOWN'), /whose authorization is not established is BLOCKED/, 'unknown');
  });

  test('recorded honestly as BLOCKED it is a valid record that no release can pass: the strict check fails on it', () => {
    const blocked = (x: { files: Record<string, string>; manifest: Json }): void => {
      withNarration(x, cloneFrom('NOT_ESTABLISHED'), 'BLOCKED');
    };
    const repo = repoWith(blocked);
    assert.deepEqual(codes(dev(repo)), []);
    const s = strict(repo);
    assert.equal(s.result, 'FAIL');
    assert.ok(s.findings.some((f) => f.code === 'RIGHTS_BLOCKING_STATUS' && f.path === 'elevenlabs-service'));
    // A video recorded as RIGHTS_CLEARED cannot carry it: the finding names the blocked voice, not only the pending Remotion beside it.
    const released = dev(repoWith((x) => { blocked(x); x.manifest.videos[0].release.state = 'RIGHTS_CLEARED'; }));
    assert.match(released.findings.find((f) => f.code === 'RELEASE_STATE_UNSUPPORTED')?.message ?? '', /elevenlabs-service is BLOCKED/);
  });

  test('a voice whose use basis is not established is BLOCKED the same way', () => {
    refuses(withVoice({ ...libraryVoice(), useBasis: 'NOT_ESTABLISHED' }), /whose use basis is not established is BLOCKED/, 'use basis');
  });

  test('reference audio, or a clone WalletWall made, is authorized only by the speaker in writing: the Voice Library route does not launder it', () => {
    refuses(withVoice(cloneFrom('VERIFIED_OWNER_PUBLISHED')), /a REFERENCE_AUDIO_CLONE is authorized only by SPEAKER_WRITTEN_AUTHORIZATION, not VERIFIED_OWNER_PUBLISHED/, 'library route for reference audio');
    refuses(withVoice({ ...libraryVoice(), voiceType: 'REFERENCE_AUDIO_CLONE' }), /a ELEVENLABS_VOICE_LIBRARY voice is a PROFESSIONAL_VOICE_CLONE, not a REFERENCE_AUDIO_CLONE/, 'library source, cloned type');
    refuses(withVoice({ ...libraryVoice(), authorizationBasis: 'SPEAKER_WRITTEN_AUTHORIZATION' }), /a PROFESSIONAL_VOICE_CLONE is authorized only by VERIFIED_OWNER_PUBLISHED, not SPEAKER_WRITTEN_AUTHORIZATION/, 'a clone WalletWall vouches for');
    refuses(withVoice({ ...libraryVoice(), authorizationBasis: 'NO_HUMAN_SPEAKER' }), /a PROFESSIONAL_VOICE_CLONE is authorized only by VERIFIED_OWNER_PUBLISHED, not NO_HUMAN_SPEAKER/, 'a clone called synthetic');
  });

  test('the speaker\'s own written authorization does clear a clone, with the commercial scope the licence documents', () => {
    accepts(withVoice(cloneFrom('SPEAKER_WRITTEN_AUTHORIZATION')), 'authorized clone');
  });
});

describe('2. a voice whose provenance is unknown is blocked', () => {
  const unknown = (): Json => ({ ...libraryVoice(), source: 'UNDETERMINED', voiceType: 'UNDETERMINED', authorizationBasis: 'UNDETERMINED', useBasis: 'UNDETERMINED', commercialOutputBasis: 'UNDETERMINED', ownership: { walletwallOwns: ['AUTHORED_SCRIPT'], speakerVoiceAndLikeness: 'SPEAKER_RETAINS' }, providerControls: [] });

  test('it can be recorded only as UNKNOWN, UNVERIFIED, or BLOCKED: never pending confirmation, never CLEARED', () => {
    refuses(withVoice(unknown()), /origin is undetermined \(source, voiceType, authorizationBasis, useBasis\)/, 'cleared');
    refuses(withVoice(unknown(), 'OWNER_CONFIRMATION_PENDING'), /origin is undetermined/, 'pending');
    for (const status of ['UNKNOWN', 'UNVERIFIED', 'BLOCKED']) accepts(withVoice(unknown(), status), status);
  });

  test('one undetermined part of the origin is enough', () => {
    for (const field of ['source', 'voiceType', 'authorizationBasis', 'useBasis']) {
      const m = withVoice({ ...libraryVoice(), [field]: 'UNDETERMINED' });
      refuses(m, new RegExp(`origin is undetermined \\(${field}\\)`), field);
    }
  });

  test('the narration provider with no voice record at all fails the development check, not only the strict one', () => {
    const r = dev(repoWith((x) => { withNarration(x); delete component(x.manifest, 'elevenlabs-service').voiceRights; }));
    assert.equal(r.result, 'FAIL');
    assert.deepEqual(r.findings.filter((f) => f.code === 'VOICE_RIGHTS_MISSING').map((f) => f.path), ['elevenlabs-service']);
  });

  test('an unknown voice recorded as UNKNOWN passes development and fails every release', () => {
    const repo = repoWith((x) => withNarration(x, unknown(), 'UNKNOWN'));
    assert.deepEqual(codes(dev(repo)), []);
    const s = strict(repo);
    assert.equal(s.result, 'FAIL');
    assert.ok(s.findings.some((f) => f.code === 'RIGHTS_BLOCKING_STATUS' && f.path === 'elevenlabs-service'));
  });
});

describe('3. an owner-authorized or provider-authorized Professional Voice Clone can be cleared', () => {
  test('a Voice Library clone its verified owner published, used under the provider\'s terms on a paid plan, is CLEARED and the check passes', () => {
    accepts(manifestOf(), 'manifest');
    const repo = repoWith((x) => withNarration(x));
    assert.deepEqual(codes(dev(repo)), []);
    assert.equal(dev(repo).result, 'PASS');
    // It does not stay in the pending list: only Remotion, the open item of the base manifest, does.
    assert.deepEqual(dev(repo).pending.map((p) => p.id), ['remotion']);
  });

  test('the clearance is the owner\'s record: without it a PROVIDER_TERMS voice is not CLEARED', () => {
    refuses(manifestOf((m) => delete service(m).clearance), /clearance: required to clear a PROVIDER_TERMS basis/, 'service');
  });

  test('the same record pending (its output basis not yet confirmed) is the open owner decision it was before', () => {
    const m = manifestOf((x) => { reopen(x, 'OWNER_CONFIRMATION_PENDING'); voiceOf(x).commercialOutputBasis = 'UNDETERMINED'; });
    accepts(m, 'pending');
  });
});

describe('4. a Voice Design or other synthetic voice can be cleared', () => {
  test('a provider-designed voice has no human speaker, so nothing for a speaker to authorize', () => {
    accepts(withVoice(designedVoice()), 'designed');
    const repo = repoWith((x) => withNarration(x, designedVoice()));
    assert.deepEqual(codes(dev(repo)), []);
  });

  test('a designed voice cannot be dressed as a person: a human voice is never recorded with no speaker', () => {
    refuses(withVoice({ ...designedVoice(), voiceType: 'PROFESSIONAL_VOICE_CLONE' }), /a PROFESSIONAL_VOICE_CLONE is authorized only by VERIFIED_OWNER_PUBLISHED, not NO_HUMAN_SPEAKER/, 'clone with no speaker');
    refuses(withVoice({ ...libraryVoice(), ownership: { walletwallOwns: ['AUTHORED_SCRIPT'], speakerVoiceAndLikeness: 'NO_HUMAN_SPEAKER' } }), /NO_HUMAN_SPEAKER is for a voice with no human speaker/, 'speaker erased');
  });

  test('a voice licensed by its speaker directly is the third route, and needs the licence\'s own output basis', () => {
    accepts(withVoice(licensedVoice()), 'licensed');
    refuses(withVoice({ ...licensedVoice(), commercialOutputBasis: 'PAID_PLAN_TERMS' }), /SPEAKER_LICENSED pairs with SPEAKER_LICENSE for commercial output, not PAID_PLAN_TERMS/, 'a provider plan standing in for a speaker licence');
  });
});

describe('5. a provider restriction cannot be silently ignored', () => {
  const control = (m: Json, kind: string): Json => voiceOf(m).providerControls.find((c: Json) => c.kind === kind);
  const inForce = (kind: string, extra: Json = {}) => (m: Json): void => {
    Object.assign(control(m, kind), { state: 'IN_FORCE', observedBy: 'OWNER', observedOn: '2026-10-22', note: `The ${kind} is in force on the voice's provider page.`, ...extra });
  };

  test('a Voice Library voice records every control, once: an omitted or repeated control is refused', () => {
    for (const kind of ['NOTICE_PERIOD', 'LIVE_MODERATION', 'CUSTOM_RESTRICTION', 'LIBRARY_REMOVAL']) {
      refuses(manifestOf((m) => (voiceOf(m).providerControls = voiceOf(m).providerControls.filter((c: Json) => c.kind !== kind))), new RegExp(`${kind} is not recorded`), `missing ${kind}`);
    }
    refuses(manifestOf((m) => voiceOf(m).providerControls.push({ ...control(m, 'NOTICE_PERIOD') })), /providerControls: .*(duplicate|must have 0 to 4)/, 'repeated');
    refuses(manifestOf((m) => (control(m, 'LIVE_MODERATION').kind = 'NOTICE_PERIOD')), /duplicate NOTICE_PERIOD/, 'repeated by renaming');
  });

  test('a restriction in force is assessed, never ignored: it needs the owner\'s compliance record, and a failed one is never CLEARED', () => {
    for (const kind of ['CUSTOM_RESTRICTION', 'LIBRARY_REMOVAL']) {
      refuses(manifestOf(inForce(kind)), /compliance: required while a use-restricting control is in force/, `${kind} unassessed`);
      refuses(manifestOf(inForce(kind, { compliance: 'NOT_SATISFIED' })), new RegExp(`${kind} is in force and not satisfied`), `${kind} not satisfied`);
      accepts(manifestOf(inForce(kind, { compliance: 'SATISFIED' })), `${kind} satisfied`);
      // Not satisfied is a valid record of an item that is not cleared.
      accepts(manifestOf((m) => { inForce(kind, { compliance: 'NOT_SATISFIED' })(m); reopen(m, 'OWNER_CONFIRMATION_PENDING'); }), `${kind} pending`);
    }
  });

  test('compliance belongs only to a use-restricting control that is in force', () => {
    refuses(manifestOf((m) => (control(m, 'NOTICE_PERIOD').compliance = 'SATISFIED')), /compliance: only a CUSTOM_RESTRICTION or LIBRARY_REMOVAL in force has one/, 'notice period');
    refuses(manifestOf((m) => (control(m, 'CUSTOM_RESTRICTION').compliance = 'SATISFIED')), /compliance: only a CUSTOM_RESTRICTION or LIBRARY_REMOVAL in force has one/, 'undetermined restriction');
  });

  test('a notice period and live moderation are conditions of availability, not restrictions on use: they never block a clearance', () => {
    accepts(manifestOf(inForce('LIVE_MODERATION')), 'live moderation in force');
    accepts(manifestOf((m) => (control(m, 'NOTICE_PERIOD').days = 730)), 'two-year notice period');
  });

  test('what cannot be read offline is recorded as undetermined with the exact uncertainty, and that does not block the category', () => {
    accepts(manifestOf((m) => {
      for (const c of voiceOf(m).providerControls) {
        Object.assign(c, { state: 'UNDETERMINED', note: `Not readable offline: ${c.kind}.` });
        for (const k of ['observedBy', 'observedOn', 'days']) delete c[k];
      }
    }), 'all undetermined');
    refuses(manifestOf((m) => (control(m, 'CUSTOM_RESTRICTION').note = '')), /note: must be a string of 1 to/, 'a bare undetermined');
    refuses(manifestOf((m) => (control(m, 'CUSTOM_RESTRICTION').observedOn = '2026-10-22')), /observedOn: an undetermined control was not observed/, 'invented observation');
  });

  test('a control that was observed says who saw it and when; a notice period says how long', () => {
    refuses(manifestOf((m) => delete control(m, 'NOTICE_PERIOD').observedBy), /observedBy: required for a control in force or not in force/, 'observer');
    refuses(manifestOf((m) => delete control(m, 'NOTICE_PERIOD').observedOn), /observedOn: required for a control in force or not in force/, 'date');
    refuses(manifestOf((m) => delete control(m, 'NOTICE_PERIOD').days), /days: a notice period in force names its length/, 'length');
    refuses(manifestOf((m) => (control(m, 'NOTICE_PERIOD').days = 0)), /days: must be a whole number of days, 1 to 730/, 'zero days');
    refuses(manifestOf((m) => (control(m, 'NOTICE_PERIOD').days = 731)), /days: must be a whole number of days, 1 to 730/, 'beyond two years');
    refuses(manifestOf((m) => (control(m, 'LIVE_MODERATION').days = 30)), /days: only a notice period has a length/, 'days elsewhere');
    // Observed correctly, so only the length is wrong: a notice period that is not in force has none.
    refuses(manifestOf((m) => Object.assign(control(m, 'NOTICE_PERIOD'), { state: 'NOT_IN_FORCE', days: 30 })), /days: only a notice period in force has a length/, 'a length for a notice period that is not in force');
    refuses(manifestOf((m) => (control(m, 'NOTICE_PERIOD').observedBy = 'WALLETWALL')), /observedBy: must be exactly "OWNER"/, 'self-observed');
    refuses(manifestOf((m) => (control(m, 'NOTICE_PERIOD').kind = 'BOGUS')), /kind: must be one of/, 'unknown kind');
    refuses(manifestOf((m) => (control(m, 'NOTICE_PERIOD').state = 'MAYBE')), /state: must be one of/, 'unknown state');
  });

  test('a withdrawal is prospective: during the notice period the voice is still usable, and the clearance records that it was assessed', () => {
    accepts(manifestOf(inForce('LIBRARY_REMOVAL', { compliance: 'SATISFIED', note: 'The voice was withdrawn; its notice period has not ended, so saved voices stay usable until it does.' })), 'inside the notice period');
    refuses(manifestOf(inForce('LIBRARY_REMOVAL', { compliance: 'NOT_SATISFIED', note: 'The notice period has ended.' })), /LIBRARY_REMOVAL is in force and not satisfied/, 'after it');
  });

  test('after a withdrawal takes effect the output already generated stays cleared: EXISTING_OUTPUT_ONLY bars new synthesis without un-clearing the set', () => {
    const withdrawn = (x: { files: Record<string, string>; manifest: Json }): void => {
      withNarration(x);
      Object.assign(control(x.manifest, 'LIBRARY_REMOVAL'), { state: 'IN_FORCE', observedBy: 'OWNER', observedOn: '2026-10-22', compliance: 'EXISTING_OUTPUT_ONLY', note: 'The voice was withdrawn and its notice period has ended; no new synthesis is run with it. The set already generated while it was available is the only output used.' });
    };
    const repo = repoWith(withdrawn);
    assert.deepEqual(codes(dev(repo)), []);
    assert.deepEqual(strict(repo).findings.map((f) => `${f.code} ${f.path}`), ['RIGHTS_BLOCKING_STATUS remotion']);
    assert.deepEqual(dev(repo).pending.map((p) => p.id), ['remotion']);
  });

  test('EXISTING_OUTPUT_ONLY is for a withdrawal alone: a custom restriction that bars the use cannot be waved through as history', () => {
    refuses(manifestOf(inForce('CUSTOM_RESTRICTION', { compliance: 'EXISTING_OUTPUT_ONLY' })), /compliance: EXISTING_OUTPUT_ONLY is for a LIBRARY_REMOVAL/, 'custom restriction');
    refuses(manifestOf((m) => (control(m, 'LIVE_MODERATION').compliance = 'EXISTING_OUTPUT_ONLY')), /compliance: only a CUSTOM_RESTRICTION or LIBRARY_REMOVAL in force has one/, 'not in force');
  });

  test('the other exit is still closed: an unsatisfied withdrawal cannot keep the service CLEARED, and un-clearing the service un-clears what it produced', () => {
    const repo = repoWith((x) => {
      withNarration(x);
      Object.assign(control(x.manifest, 'LIBRARY_REMOVAL'), { state: 'IN_FORCE', observedBy: 'OWNER', observedOn: '2026-10-22', compliance: 'NOT_SATISFIED', note: 'The voice was withdrawn.' });
    });
    assert.ok(problems(JSON.parse(repo.read('config/release-rights.json')!)).some((p) => /LIBRARY_REMOVAL is in force and not satisfied/.test(p)));
    // Reopening only the service leaves its audio and the narration cleared above it: the general dependency rule is not loosened.
    const reopened = dev(repoWith((x) => {
      withNarration(x);
      Object.assign(control(x.manifest, 'LIBRARY_REMOVAL'), { state: 'IN_FORCE', observedBy: 'OWNER', observedOn: '2026-10-22', compliance: 'NOT_SATISFIED', note: 'The voice was withdrawn.' });
      reopen(x.manifest, 'OWNER_CONFIRMATION_PENDING');
    }));
    assert.ok(codes(reopened).includes('COMPONENT_ABOVE_DEPENDENCY'));
    assert.ok(codes(reopened).includes('ASSET_ABOVE_COMPONENT'));
  });
});

describe('6. WalletWall cannot claim ownership of an underlying third-party voice', () => {
  test('the speaker keeps their voice and likeness: it is never recorded as WalletWall\'s', () => {
    refuses(manifestOf((m) => (voiceOf(m).ownership.speakerVoiceAndLikeness = 'WALLETWALL')), /speakerVoiceAndLikeness: must be one of SPEAKER_RETAINS, NO_HUMAN_SPEAKER/, 'speaker voice owned');
    for (const claim of ['SPEAKER_VOICE', 'SPEAKER_LIKENESS', 'VOICE', 'NARRATOR_IDENTITY']) {
      refuses(manifestOf((m) => voiceOf(m).ownership.walletwallOwns.push(claim)), new RegExp(`${claim}" is not WalletWall's to claim`), claim);
    }
    refuses(manifestOf((m) => (voiceOf(m).ownership.walletwallOwns = [])), /walletwallOwns: must have 1 to 8 items/, 'nothing claimed');
    refuses(manifestOf((m) => voiceOf(m).ownership.walletwallOwns.push('COMPOSITION')), /walletwallOwns: duplicate COMPOSITION/, 'repeated claim');
  });

  test('a voice is never filed as owner-authored, generated from owner inputs, or open source', () => {
    for (const rightsBasis of ['OWNER_AUTHORED', 'GENERATED_FROM_OWNER_INPUTS', 'OPEN_SOURCE_LICENSE', 'THIRD_PARTY_ATTRIBUTION_ONLY', 'UNDETERMINED']) {
      refuses(manifestOf((m) => (service(m).rightsBasis = rightsBasis)), new RegExp(`rightsBasis: a narration voice is the speaker's, not WalletWall's: its basis is PROVIDER_TERMS or VENDOR_LICENSE, never ${rightsBasis}`), rightsBasis);
    }
    accepts(manifestOf((m) => (service(m).rightsBasis = 'VENDOR_LICENSE')), 'a licence');
  });

  test('only a provider service records a voice: no other component can borrow the record, or carry a cleared voice', () => {
    refuses(manifestOf((m) => (component(m, 'remotion').voiceRights = libraryVoice())), /components\[\d+\]\.voiceRights: only a provider-service component records a narration voice/, 'a rendering tool');
    refuses(manifestOf((m) => (component(m, 'elevenlabs-narration-audio').voiceRights = libraryVoice())), /only a provider-service component records a narration voice/, 'the generated audio');
  });

  test('the record names the authored script, composition and audiovisual work as WalletWall\'s, and says nothing else is', () => {
    accepts(manifestOf(), 'owned');
    assert.deepEqual(voiceOf(manifestOf()).ownership.walletwallOwns, ['AUTHORED_SCRIPT', 'COMPOSITION', 'AUDIOVISUAL_WORK']);
  });
});

describe('7. the right to use a voice and the right to use its output commercially are distinct', () => {
  test('a voice whose origin is established is still not CLEARED while its commercial-output basis is not', () => {
    for (const basis of ['UNDETERMINED', 'NOT_ESTABLISHED']) {
      const m = withVoice({ ...libraryVoice(), commercialOutputBasis: basis });
      refuses(m, /commercialOutputBasis: commercial-output rights are not established/, basis);
      assert.ok(!problems(m).some((p) => /origin is undetermined|not established is BLOCKED/.test(p)), `${basis}: the origin was not what failed`);
    }
  });

  test('a paid plan does not authorize a voice: output rights established, origin undetermined, is still not CLEARED', () => {
    const m = withVoice({ ...libraryVoice(), authorizationBasis: 'UNDETERMINED' });
    refuses(m, /origin is undetermined \(authorizationBasis\)/, 'origin');
    assert.ok(!problems(m).some((p) => /commercial-output rights are not established/.test(p)), 'the output basis was not what failed');
  });

  test('an unconfirmed output basis is the open owner decision, so it may be pending; a known free-plan synthesis may be pending too', () => {
    for (const basis of ['UNDETERMINED', 'NOT_ESTABLISHED']) accepts(manifestOf((m) => { reopen(m, 'OWNER_CONFIRMATION_PENDING'); voiceOf(m).commercialOutputBasis = basis; }), basis);
  });

  test('a provider plan pairs with a provider-authorized voice, and only that', () => {
    refuses(withVoice({ ...libraryVoice(), commercialOutputBasis: 'SPEAKER_LICENSE' }), /PROVIDER_AUTHORIZED pairs with PAID_PLAN_TERMS for commercial output, not SPEAKER_LICENSE/, 'wrong pairing');
    refuses(withVoice({ ...libraryVoice(), useBasis: 'SPEAKER_LICENSED' }), /a ELEVENLABS_VOICE_LIBRARY voice is used under PROVIDER_AUTHORIZED, not SPEAKER_LICENSED/, 'a library voice used under a private licence');
  });

  test('the audio the service produces and the video\'s narration cannot be CLEARED above a service that is not', () => {
    const repo = repoWith((x) => {
      withNarration(x);
      const c = component(x.manifest, 'elevenlabs-service');
      c.status = 'OWNER_CONFIRMATION_PENDING';
      delete c.clearance;
      c.resolution = { ...OPEN };
      c.voiceRights.commercialOutputBasis = 'UNDETERMINED';
    });
    const r = dev(repo);
    assert.ok(codes(r).includes('COMPONENT_ABOVE_DEPENDENCY'));
    assert.ok(codes(r).includes('ASSET_ABOVE_COMPONENT'));
  });
});

describe('an established origin is attributed, and a speaker\'s written authorization is documented', () => {
  const noAttestation = (m: Json): void => void delete voiceOf(m).attestation;

  test('whoever says the voice is what the record states is named, with the date and the basis: no route is stated as fact without it', () => {
    refuses(manifestOf(noAttestation), /attestation: required once the origin is established/, 'a library voice');
    refuses(manifestOf(noAttestation, designedVoice()), /attestation: required once the origin is established/, 'a designed voice');
    refuses(manifestOf(noAttestation, licensedVoice()), /attestation: required once the origin is established/, 'a licensed voice');
    refuses(manifestOf(noAttestation, libraryVoice(), 'OWNER_CONFIRMATION_PENDING'), /attestation: required once the origin is established/, 'even while pending');
  });

  test('an undetermined origin asserts nothing, so it needs no attestation', () => {
    const unknown = { ...libraryVoice(), source: 'UNDETERMINED', voiceType: 'UNDETERMINED', authorizationBasis: 'UNDETERMINED', useBasis: 'UNDETERMINED', commercialOutputBasis: 'UNDETERMINED', providerControls: [] };
    delete unknown.attestation;
    accepts(manifestOf(() => {}, unknown, 'UNKNOWN'), 'unknown');
  });

  test('the attestation is the owner\'s, dated, and says what it rests on', () => {
    refuses(manifestOf((m) => (voiceOf(m).attestation.attestedBy = 'WALLETWALL')), /attestedBy: must be exactly "OWNER"/, 'self-attested');
    refuses(manifestOf((m) => (voiceOf(m).attestation.attestedOn = 'yesterday')), /attestedOn: must be a YYYY-MM-DD date/, 'date');
    refuses(manifestOf((m) => (voiceOf(m).attestation.basis = '')), /basis: must be a string of 1 to/, 'empty basis');
    refuses(manifestOf((m) => (voiceOf(m).attestation.verified = true)), /attestation\.verified: unknown field/, 'closed');
  });

  test('a speaker\'s written authorization records when it was granted, who holds it, and what it covers', () => {
    refuses(manifestOf((m) => delete voiceOf(m).speakerAuthorization, licensedVoice()), /speakerAuthorization: required for a SPEAKER_WRITTEN_AUTHORIZATION/, 'missing');
    refuses(manifestOf((m) => (voiceOf(m).speakerAuthorization = { documentHeldBy: 'OWNER', grantedOn: '2026-10-01', scope: ['COMMERCIAL_USE', 'PUBLIC_DISTRIBUTION'] })), /speakerAuthorization: only a SPEAKER_WRITTEN_AUTHORIZATION has one/, 'on a Voice Library voice');
    refuses(manifestOf((m) => (voiceOf(m).speakerAuthorization.documentHeldBy = 'WALLETWALL'), licensedVoice()), /documentHeldBy: must be exactly "OWNER"/, 'holder');
    refuses(manifestOf((m) => (voiceOf(m).speakerAuthorization.grantedOn = '2026-02-30'), licensedVoice()), /grantedOn: must be a YYYY-MM-DD date/, 'date');
    refuses(manifestOf((m) => (voiceOf(m).speakerAuthorization.scope = []), licensedVoice()), /scope: must have 1 to 3 items/, 'no scope');
    refuses(manifestOf((m) => (voiceOf(m).speakerAuthorization.scope = ['COMMERCIAL_USE', 'COMMERCIAL_USE']), licensedVoice(), 'OWNER_CONFIRMATION_PENDING'), /scope: duplicate COMMERCIAL_USE/, 'repeated');
    refuses(manifestOf((m) => (voiceOf(m).speakerAuthorization.scope = ['EVERYTHING']), licensedVoice()), /scope\[0\]: must be one of VOICE_CLONING, COMMERCIAL_USE, PUBLIC_DISTRIBUTION/, 'unknown scope');
  });

  test('cleared, it covers commercial use and public distribution, and cloning too when the voice is cloned from reference audio', () => {
    refuses(manifestOf((m) => (voiceOf(m).speakerAuthorization.scope = ['PUBLIC_DISTRIBUTION']), licensedVoice()), /scope: a CLEARED speaker authorization covers COMMERCIAL_USE, PUBLIC_DISTRIBUTION; this one covers PUBLIC_DISTRIBUTION/, 'no commercial use');
    refuses(manifestOf((m) => (voiceOf(m).speakerAuthorization.scope = ['COMMERCIAL_USE']), licensedVoice()), /this one covers COMMERCIAL_USE/, 'no distribution');
    refuses(manifestOf((m) => (voiceOf(m).speakerAuthorization.scope = ['COMMERCIAL_USE', 'PUBLIC_DISTRIBUTION']), cloneFrom('SPEAKER_WRITTEN_AUTHORIZATION')), /a CLEARED speaker authorization covers VOICE_CLONING, COMMERCIAL_USE, PUBLIC_DISTRIBUTION; this one covers COMMERCIAL_USE, PUBLIC_DISTRIBUTION/, 'a clone the speaker never agreed to');
    accepts(withVoice(cloneFrom('SPEAKER_WRITTEN_AUTHORIZATION')), 'a clone the speaker agreed to');
    accepts(withVoice(licensedVoice()), 'a recording');
    // Not cleared, a narrower scope is a valid record of what is still open.
    accepts(manifestOf((m) => { voiceOf(m).speakerAuthorization.scope = ['COMMERCIAL_USE']; reopen(m, 'OWNER_CONFIRMATION_PENDING'); }, licensedVoice()), 'pending');
  });
});

describe('the record is bound to the voice the narration binding names', () => {
  test('the committed shape: the binding id and the sha256 of the configured voice id', () => {
    const v = voiceOf(manifestOf());
    assert.equal(v.binding.id, BINDING_ID);
    assert.equal(v.binding.voiceIdSha256, sha256Hex(FIXTURE_VOICE_ID));
  });

  test('a changed voice id, or a changed binding id, makes the record stale: a swapped voice cannot inherit the clearance', () => {
    const swapped = repoWith((x) => {
      withNarration(x);
      x.files['config/narration-providers.json'] = JSON.stringify({ publication: { id: BINDING_ID, provider: 'elevenlabs' }, providers: { elevenlabs: { voiceId: 'another-voice-0002' } } });
    });
    assert.deepEqual(dev(swapped).findings.map((f) => `${f.code} ${f.path}`), ['VOICE_BINDING_STALE elevenlabs-service']);
    const rebound = repoWith((x) => {
      withNarration(x);
      x.files['config/narration-providers.json'] = JSON.stringify({ publication: { id: 'demo-publication-v2', provider: 'elevenlabs' }, providers: { elevenlabs: { voiceId: FIXTURE_VOICE_ID } } });
    });
    assert.deepEqual(dev(rebound).findings.map((f) => `${f.code} ${f.path}`), ['VOICE_BINDING_STALE elevenlabs-service']);
    const gone = repoWith((x) => {
      withNarration(x);
      x.files['config/narration-providers.json'] = JSON.stringify({ publication: { id: BINDING_ID, provider: 'elevenlabs' }, providers: { elevenlabs: {} } });
    });
    assert.deepEqual(dev(gone).findings.map((f) => `${f.code} ${f.path}`), ['VOICE_BINDING_STALE elevenlabs-service']);
  });

  test('a Voice Library source names the provider the binding uses', () => {
    const r = dev(repoWith((x) => {
      withNarration(x);
      x.files['config/narration-providers.json'] = JSON.stringify({ publication: { id: BINDING_ID, provider: 'acme' }, providers: { acme: { voiceId: FIXTURE_VOICE_ID } } });
      const c = component(x.manifest, 'elevenlabs-service');
      c.id = 'acme-service';
      component(x.manifest, 'elevenlabs-narration-audio').producedBy = ['acme-service'];
      x.manifest.videos[0].assets.find((a: Json) => a.id === 'narration').binding.componentId = 'acme-service';
      x.files['THIRD_PARTY_NOTICES.md'] += '### `acme-service`\n';
    }));
    assert.deepEqual(r.findings.map((f) => `${f.code} ${f.path}`), ['VOICE_SOURCE_PROVIDER_MISMATCH acme-service']);
  });

  test('a voice record on a service the narration binding does not use is unbound', () => {
    const r = dev(repoWith((x) => {
      withNarration(x);
      x.manifest.components.push({ ...JSON.parse(JSON.stringify(component(x.manifest, 'elevenlabs-service'))), id: 'spare-service' });
      x.files['THIRD_PARTY_NOTICES.md'] += '### `spare-service`\n';
    }));
    assert.deepEqual(r.findings.map((f) => `${f.code} ${f.path}`), ['VOICE_RIGHTS_UNBOUND spare-service']);
    const unbound = dev(repoWith((x) => { withNarration(x); x.files['config/narration-providers.json'] = '{}'; }));
    assert.ok(codes(unbound).includes('VOICE_RIGHTS_UNBOUND'));
  });

  test('the record holds the hash of the voice id, never the id: the privacy scan still refuses a voice id', () => {
    refuses(manifestOf((m) => (service(m).summary = 'The voice AbCdEfGhIjKlMnOp1234 is used')), /summary: holds an identifier shaped like a provider voice or account id/, 'a voice id');
  });
});

describe('8. development mode stays deterministic', () => {
  test('the same files give byte-identical reports, in either mode and in any insertion order', () => {
    const a = JSON.stringify(dev());
    assert.equal(JSON.stringify(dev()), a);
    assert.equal(JSON.stringify(strict()), JSON.stringify(strict()));
    const files = baseFiles();
    const x = { files, manifest: baseManifest() };
    withNarration(x);
    files['config/release-rights.json'] = JSON.stringify(x.manifest, null, 2);
    const forward = memoryRepo(files);
    const reversed = Object.fromEntries(Object.entries(files).reverse());
    const backward = { files: () => Object.keys(reversed).reverse(), read: (p: string) => reversed[p] ?? null };
    assert.equal(JSON.stringify(run(forward, 'development')), JSON.stringify(run(backward, 'development')));
    assert.equal(JSON.stringify(run(forward, 'public-release')), JSON.stringify(run(backward, 'public-release')));
  });
});

describe('9. a public release still fails for unrelated unresolved items', () => {
  test('with the voice items cleared, strict fails on exactly the open item and on nothing about the voice', () => {
    const s = strict();
    assert.equal(s.result, 'FAIL');
    assert.deepEqual(s.findings.map((f) => `${f.code} ${f.path}`), ['RIGHTS_BLOCKING_STATUS remotion']);
  });

  test('clearing the voice is not what opens a release: a voice that is not cleared fails strict too', () => {
    const s = strict(repoWith((x) => withNarration(x, libraryVoice(), 'OWNER_CONFIRMATION_PENDING')));
    assert.deepEqual(s.findings.map((f) => f.path).sort(), ['demo/narration', 'elevenlabs-narration-audio', 'elevenlabs-service', 'remotion']);
  });
});

describe('10. this policy cannot silently clear Remotion or any other unrelated component', () => {
  test('only a provider service may carry a voice record, so no other component can be cleared by one', () => {
    for (const id of ['remotion', 'blender-runtime', 'character-model', 'blender-render-output']) {
      refuses(manifestOf((m) => (component(m, id).voiceRights = libraryVoice())), /only a provider-service component records a narration voice/, id);
    }
  });

  test('the policy\'s constants did not move: owner clearance still guards the provider, vendor and attribution bases, and the strict state is still the first that tolerates no open item', () => {
    assert.deepEqual([...BASES_NEEDING_OWNER_CLEARANCE], ['VENDOR_LICENSE', 'PROVIDER_TERMS', 'THIRD_PARTY_ATTRIBUTION_ONLY']);
    assert.equal(STRICT_STATE, 'RIGHTS_CLEARED');
    assert.deepEqual([...STATUSES_PERMITTED_IN.RIGHTS_CLEARED], ['CLEARED']);
    assert.deepEqual([...STATUSES_PERMITTED_IN.PUBLIC], ['CLEARED']);
    assert.equal(RIGHTS_STATUSES.length, 10);
  });

  test('a vendor\'s license is still cleared only by the owner\'s record, whatever a voice record says', () => {
    refuses(manifestOf((m) => (component(m, 'remotion').status = 'CLEARED')), /clearance: required to clear a VENDOR_LICENSE/, 'remotion');
  });
});

describe('this repository', () => {
  const repo = fsRepo(VIDEO_ROOT);
  const manifest = JSON.parse(readFileSync(path.join(VIDEO_ROOT, 'config', 'release-rights.json'), 'utf8')) as Json;
  const find = (id: string): Json => manifest.components.find((c: Json) => c.id === id);
  const voice = (): Json => find('elevenlabs-service').voiceRights;

  test('the existing voice is a Voice Library Professional Voice Clone its verified owner published, used under the provider\'s terms on a paid plan', () => {
    const v = voice();
    assert.equal(v.source, 'ELEVENLABS_VOICE_LIBRARY');
    assert.equal(v.voiceType, 'PROFESSIONAL_VOICE_CLONE');
    assert.equal(v.authorizationBasis, 'VERIFIED_OWNER_PUBLISHED');
    assert.equal(v.useBasis, 'PROVIDER_AUTHORIZED');
    assert.equal(v.commercialOutputBasis, 'PAID_PLAN_TERMS');
    assert.equal(find('elevenlabs-service').rightsBasis, 'PROVIDER_TERMS');
    assert.equal(v.binding.id, 'walletwallaby-elevenlabs-v1');
  });

  test('WalletWall claims its script, composition and audiovisual work, and nothing of the speaker', () => {
    assert.deepEqual(voice().ownership, { walletwallOwns: ['AUTHORED_SCRIPT', 'COMPOSITION', 'AUDIOVISUAL_WORK'], speakerVoiceAndLikeness: 'SPEAKER_RETAINS' });
  });

  test('the voice is stated on the owner\'s word, not as fact: the attestation names the owner, the day, and what it rests on', () => {
    const a = voice().attestation;
    assert.deepEqual([a.attestedBy, a.attestedOn], ['OWNER', '2026-10-22']);
    assert.match(a.basis, /rests on the provider's rules/);
    assert.match(a.basis, /not on an independent check/);
    assert.equal(voice().speakerAuthorization, undefined, 'a Voice Library voice has no private licence');
  });

  test('the provider controls are recorded as they were found: a 30-day notice period the owner read, the rest undetermined, none in force that restricts use', () => {
    const controls = voice().providerControls as Json[];
    assert.deepEqual(controls.map((c) => c.kind).sort(), ['CUSTOM_RESTRICTION', 'LIBRARY_REMOVAL', 'LIVE_MODERATION', 'NOTICE_PERIOD']);
    const notice = controls.find((c) => c.kind === 'NOTICE_PERIOD')!;
    assert.deepEqual([notice.state, notice.days, notice.observedBy], ['IN_FORCE', 30, 'OWNER']);
    for (const c of controls.filter((c) => c.kind !== 'NOTICE_PERIOD')) assert.equal(c.state, 'UNDETERMINED', `${c.kind} was not observed, so it is not asserted`);
    assert.deepEqual(controls.filter((c) => ['CUSTOM_RESTRICTION', 'LIBRARY_REMOVAL'].includes(c.kind) && c.state === 'IN_FORCE'), []);
  });

  test('the three ElevenLabs items are CLEARED by the owner\'s record, and each carries the evidence it rests on', () => {
    const items = [find('elevenlabs-service'), find('elevenlabs-narration-audio'), manifest.videos[0].assets.find((a: Json) => a.id === 'narration')];
    for (const i of items) {
      assert.equal(i.status, 'CLEARED', i.id);
      assert.equal(i.clearance.clearedBy, 'OWNER', i.id);
      assert.equal(i.rightsBasis, 'PROVIDER_TERMS', i.id);
      assert.ok(i.evidence.some((e: Json) => e.type === 'URL' && e.ref === 'https://elevenlabs.io/terms-of-use' && e.retrievedOn === '2026-10-22'), i.id);
    }
    const urls = find('elevenlabs-service').evidence.filter((e: Json) => e.type === 'URL').map((e: Json) => e.ref);
    for (const wanted of ['https://elevenlabs.io/vla', 'https://elevenlabs.io/use-policy', 'https://elevenlabs.io/docs/eleven-creative/voices/voice-library', 'https://elevenlabs.io/docs/eleven-creative/voices/voice-cloning/professional-voice-cloning', 'https://elevenlabs.io/elevenapi-terms']) assert.ok(urls.includes(wanted), wanted);
  });

  test('development passes, and the strict check fails on exactly the seven items this policy does not touch', () => {
    const d = checkRights(repo, { mode: 'development' });
    assert.deepEqual(d.findings, []);
    assert.equal(d.result, 'PASS');
    const unrelated = ['blender-render-output', 'migration-readiness/brand-mark', 'migration-readiness/character', 'quilez-sdf-forms', 'remotion', 'remotion-render-output', 'walletwallaby-character-model'];
    assert.deepEqual(d.pending.map((p) => p.id).sort(), unrelated);
    const s = checkRights(repo, { mode: 'public-release' });
    assert.equal(s.result, 'FAIL');
    assert.deepEqual(s.findings.map((f) => f.path).sort(), unrelated);
    assert.ok(s.findings.every((f) => f.code === 'RIGHTS_BLOCKING_STATUS'));
  });

  test('Remotion, the Quilez primitives, the character, the brand mark and their outputs are as they were: pending, with their owner actions', () => {
    for (const id of ['remotion', 'remotion-render-output', 'quilez-sdf-forms', 'walletwallaby-character-model', 'blender-render-output']) {
      assert.equal(find(id).status, 'OWNER_CONFIRMATION_PENDING', id);
      assert.equal(find(id).clearance, undefined, id);
    }
    for (const id of ['character', 'brand-mark']) {
      const a = manifest.videos[0].assets.find((x: Json) => x.id === id);
      assert.equal(a.status, 'OWNER_CONFIRMATION_PENDING', id);
      assert.equal(a.clearance, undefined, id);
    }
  });

  test('the rights record is outside the render identity and the receipt, so clearing an item moves no proof', () => {
    const identity = buildIdentity();
    assert.ok(!Object.keys(identity.configs).includes('config/release-rights.json'));
    assert.ok(!JSON.stringify(identity).includes('release-rights'));
    for (const rel of ['src/publish/proof-receipt.ts', 'src/publish/public-output.ts', 'src/manifest/build-identity.ts']) {
      assert.ok(!/release-rights|rightsManifest|rights\/manifest/.test(readFileSync(path.join(VIDEO_ROOT, ...rel.split('/')), 'utf8')), `${rel} does not read the rights record`);
    }
  });
});
