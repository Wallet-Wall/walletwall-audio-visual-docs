## Summary

<!-- One or two sentences: what changes and why. -->

## Type of change

- [ ] Pipeline / validation
- [ ] Character / motion (attach before/after stills)
- [ ] Audio / voice
- [ ] Providers / publishing (dry run only)
- [ ] Documentation
- [ ] Other: <!-- describe -->

## Does this change what a video shows or says?

- [ ] No
- [ ] Yes: affected videos, and the version bumped (spec revision, rig, motion config, voice/sonic config):

## Checklist

- [ ] `npm run check` passes (typecheck + tests + plan:check + validate)
- [ ] `npm audit --audit-level=moderate` passes
- [ ] `git diff --check` is clean
- [ ] No new fact, number, or claim that the bound docs page does not state
- [ ] No styling, code, camera, or prompt fields added to the spec; no new generative asset kinds
- [ ] Render path stays deterministic (no wall-clock time, randomness, environment, or network)
- [ ] No adversarial test weakened
- [ ] No secrets, `.env` files, or provider credentials; CI stays read-only and fork-safe
- [ ] Copy uses "this wallet" / "the address", never "your wallet"

## Testing notes

<!-- Commands run and results. For visual changes: which stills you reviewed. -->
