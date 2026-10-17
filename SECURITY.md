# Security Policy

WalletWall is a non-custodial wallet intelligence and research project. This repository turns published WalletWall documentation into videos. It never needs seed phrases, private keys, wallet signatures, or custody of anything.

## Scope

In scope for security reports:

- A secret, token, key, or credential-shaped value anywhere in this repository, its CI logs, or its generated manifests
- A way for spec or planner input to escape the repository (absolute paths, `..`, symlinks, hidden or dependency folders) or to stage an undeclared file into a render
- A way to put text, imagery, or audio into a video that bypasses claim validation (for example invisible or look-alike Unicode, unverified quotes, or unhashed assets)
- A way for an untrusted pull request to reach a provider credential (voice, YouTube, or rendering), or for a publishing step to run on untrusted content
- A way to make an upload request anything other than `unlisted` or `private`

Out of scope:

- The WalletWall application and its infrastructure (separate, private repositories)
- Vulnerabilities in Remotion, Chromium, Node.js, or other upstream dependencies — please report those upstream; we track advisories through `npm audit` and Dependabot

## Reporting

Please report privately rather than in a public issue: open a [GitHub Security Advisory](https://github.com/Wallet-Wall/walletwall-audio-visual-docs/security/advisories/new) on this repository, or email security@walletwall.org. Include a description, reproduction steps, and your assessment of impact.

Never paste seed phrases, private keys, API keys, or credentials into an issue, pull request, or comment.

## Handling credentials

- This repository contains no credentials and must never contain any. Provider bindings name environment variables only.
- Credentials never appear in logs, rendered frames, committed manifests, browser-visible environment variables, or PR comments. The render bundle never reads the environment, and publish manifests are scanned for credential-shaped values.
- Pull-request CI is read-only (`contents: read`, `persist-credentials: false`), runs on `pull_request` (never `pull_request_target`), and takes no secrets, so fork pull requests cannot reach any credential.
- Publishing, when it exists, will be a separate, manually dispatched workflow behind a protected environment with required reviewers, holding least-privilege upload scope and consuming only artifacts produced by the read-only verify job.

If you accidentally commit a secret: rotate it immediately (assume it is compromised), remove it from history, and report the exposure as above.
