# Third-party notices

This file carries the notices for third-party material this repository **distributes**, and a record of the third-party tools and data it **uses without distributing**. It is read by `npm run rights:check`: every component in [config/release-rights.json](config/release-rights.json) has a heading here, and every crate compiled into a committed artifact has its `name@version` notice below.

It is a notice file, not legal advice. Sources were read on 2026-10-22 (UTC); [docs/LICENSING.md](docs/LICENSING.md) says how, and what was not assessed. The status words (`CLEARED`, `OWNER_CONFIRMATION_PENDING`) are the manifest's and are defined in [docs/RELEASE_RIGHTS.md](docs/RELEASE_RIGHTS.md). A heading's name in backticks is the component's id.

## Distributed in this repository

### `rust-crates-in-wasm`

The committed `motion-intelligence/wasm/motion_intelligence.wasm` (a public file of this repository) is compiled from this repository's Rust source and the crates below. Each is under a license that asks for its notice to accompany copies, so the notices are here. Where a crate offers a choice of license, **MIT is elected**. The locked versions and checksums are in [motion-intelligence/Cargo.lock](motion-intelligence/Cargo.lock); the license of each was read from the crates.io registry record for that exact version, whose checksum matches the lockfile.

| Crate | License | Upstream |
|---|---|---|
| `serde@1.0.229` | MIT OR Apache-2.0 | https://github.com/serde-rs/serde |
| `serde_core@1.0.229` | MIT OR Apache-2.0 | https://github.com/serde-rs/serde |
| `serde_json@1.0.154` | MIT OR Apache-2.0 | https://github.com/serde-rs/json |
| `itoa@1.0.18` | MIT OR Apache-2.0 | https://github.com/dtolnay/itoa |
| `zmij@1.0.23` | MIT | https://github.com/dtolnay/zmij |
| `memchr@2.8.3` | Unlicense OR MIT | https://github.com/BurntSushi/memchr |
| `libm@0.2.16` | MIT | https://github.com/rust-lang/compiler-builtins (the `libm` crate) |

The proc-macro crates `serde_derive`, `syn`, `quote`, `proc-macro2`, and `unicode-ident` run at build time and are not linked into the artifact.

**The Rust standard libraries.** The artifact is also built against Rust's own `core` and `alloc` libraries (toolchain 1.96.0, pinned by `motion-intelligence/rust-toolchain.toml`). The Rust project states "Copyright (c) The Rust Project Contributors" and dual-licenses itself under MIT or Apache-2.0 (https://github.com/rust-lang/rust/blob/1.96.0/COPYRIGHT); MIT is elected here, with the permission text above. The project's `COPYRIGHT` file says third-party parts are tracked separately and shipped as a `COPYRIGHT.html` with each binary toolchain release; those third-party parts were not itemised for this record.

**`serde`, `serde_core`, `serde_json`, `itoa`, `zmij`.** These crates publish this MIT permission text, which names no copyright holder:

```text
Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

**`memchr`.** Offered as Unlicense OR MIT; MIT is elected. Its MIT notice:

```text
The MIT License (MIT)

Copyright (c) 2015 Andrew Gallant

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

**`libm`.** `libm` states that it is available under the MIT license, with the permission text below, and carries further copyright notices for work it is derived from, which this file reproduces from the crate's `LICENSE.txt`:

```text
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

This Rust library contains the following copyrights:

    Copyright (c) 2018 Jorge Aparicio

Portions of this software are derived from third-party works licensed under
terms compatible with the above MIT license:

* musl libc https://www.musl-libc.org/. This library contains the following
  copyright:

      Copyright © 2005-2020 Rich Felker, et al.

* The CORE-MATH project https://core-math.gitlabpages.inria.fr/. CORE-MATH
  routines are available under the MIT license on a per-file basis.

The musl libc COPYRIGHT file also includes the following notice relevant to
math portions of the library:

Much of the math library code (src/math/* and src/complex/*) is
Copyright © 1993,2004 Sun Microsystems or
Copyright © 2003-2011 David Schultz or
Copyright © 2003-2009 Steven G. Kargl or
Copyright © 2003-2009 Bruce D. Evans or
Copyright © 2008 Stephen L. Moshier or
Copyright © 2017-2018 Arm Limited
and labelled as such in comments in the individual source files. All
have been licensed under extremely permissive terms.

Copyright notices are retained in src/* files where relevant.
```

### Signed-distance code (no third-party code)

`blender/walletwallaby/geometry.py`'s signed-distance primitives and operators are written in this repository from their definitions. From 2026-10-18 to 2026-10-26 that file carried code translated from **Inigo Quilez**'s articles (https://iquilezles.org/articles/), recorded as `quilez-sdf-forms`; it was replaced and no longer ships, and the item is retired ([docs/LICENSING.md](docs/LICENSING.md), "Signed-distance code").

## Used by this repository, not distributed

### `blender-runtime`

Blender 5.2.2 renders WalletWallaby. Blender is free software under the GNU GPL (the source is v2 or later, and v3 or later is the license the Blender Foundation says to use for any distribution of its binaries), and its license page and FAQ say that Blender may be used commercially and that what is created with it, including images, movie files, and `.blend` files, is the creator's. This repository installs the official build and does not redistribute it. Scripts that call the Blender Python API are `GPL-3.0-or-later` ([LICENSES/GPL-3.0-or-later.txt](LICENSES/GPL-3.0-or-later.txt)). https://www.blender.org/about/license/ , https://www.blender.org/support/faq/

### `remotion`

Remotion (`remotion` and its `@remotion/*` packages, 4.0.532) is **not** under an open-source license. Its installed `LICENSE.md` is the vendor's own source-available license, free for an individual, a small for-profit organization, a non-profit, or evaluation, with a company license required otherwise. This repository does not redistribute Remotion. **Status: `OWNER_CONFIRMATION_PENDING`.** No paid license is claimed, and none is asserted to exist; whether this project qualifies for the Free License is an owner and vendor question, set out in [docs/LICENSING.md](docs/LICENSING.md#remotion). The packages it covers are listed by the `remotion-*` rules in [config/release-rights.json](config/release-rights.json). https://www.remotion.dev/docs/license/faq

### `npm-permissive-dependencies`

Every other locked npm package, React and ReactDOM included, declares MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, Unlicense, or Python-2.0. None is committed or part of a release artifact. The conditions of those licenses that matter on redistribution (keeping copyright and permission notices, and an Apache-2.0 `NOTICE` file) are therefore not triggered; each package keeps its own license text in `node_modules`, and [package-lock.json](package-lock.json) lists them all. If any is ever redistributed (for example by bundling a build into a release), its notice must go with it.

### `mediabunny`

Mediabunny (https://github.com/Vanilagy/mediabunny) and its AAC, FLAC, and MP3 encoder extensions, version 1.56.1, are under the Mozilla Public License 2.0, whose text is in each package's `LICENSE`. They arrive through Remotion Studio's packages; this repository does not modify or redistribute them. MPL-2.0 is **file-level** copyleft, not repository-wide: if MPL-covered files were distributed, those files (and changes to them) would have to be made available under the MPL, but it would not reach the rest of this repository. The encoder extensions embed WebAssembly builds of FFmpeg's AAC encoder, libFLAC, and LAME (https://lame.sourceforge.io/, LGPL), which carry their own terms; none is part of a release artifact.

### `font-sora`

Sora (variable), `@fontsource-variable/sora` 5.2.8. Copyright 2019 The Sora Project Authors (https://github.com/sora-xor/sora-font). SIL Open Font License, Version 1.1; the full text is in the package's `LICENSE` and at http://scripts.sil.org/OFL. The package's license file names no Reserved Font Name.

### `font-manrope`

Manrope (variable), `@fontsource-variable/manrope` 5.2.8. Copyright 2019 The Manrope Project Authors (https://github.com/sharanda/manrope). SIL Open Font License, Version 1.1; the full text is in the package's `LICENSE`. The package's license file names no Reserved Font Name.

### `font-ibm-plex-mono`

IBM Plex Mono, `@fontsource/ibm-plex-mono` 5.2.7. Copyright 2017 IBM Corp. All rights reserved. SIL Open Font License, Version 1.1; the full text is in the package's `LICENSE`. The package's license file names no Reserved Font Name.

The fonts are not committed. The rendered video contains glyph images, not font files. Redistributing the font files themselves (for example hosting them) would require shipping the OFL text and the copyright notice with them and not selling them by themselves.

### `caniuse-lite`

`caniuse-lite` (https://github.com/browserslist/caniuse-lite) describes itself as "a smaller version of caniuse-db" and names Ben Briggs as its author; its `LICENSE` is the Creative Commons Attribution 4.0 International legal code (https://creativecommons.org/licenses/by/4.0/) and names no other creator, so the creators of the upstream `caniuse-db` data are credited here by that name only. It is browser-support data that `browserslist` loads for build tooling. It is not committed, not modified, and not part of any release artifact, so no attribution is owed today; it is given here so it is already in place if that changes.

### `elevenlabs-service`

ElevenLabs is the external service that synthesizes the narration. It is proprietary and governed by its Terms of Use (https://elevenlabs.io/terms-of-use , last updated 09 October 2026 when read), not by an open-source license. Free plans are limited to non-commercial use and paid plans may use the service commercially, so commercial-use eligibility comes from the owner's plan at the time of each synthesis. The supplemental documents (the Prohibited Use Policy, the Voice Library Addendum, and the API and Creative terms) were read on 2026-10-22. The narration voice is, as the owner reports, a Professional Voice Clone from the provider's Voice Library, which by the provider's rules only the person whose voice it is can create, verify, and publish for other users; it is used under the provider's authorization, and WalletWall claims none of the speaker's voice or likeness. Cloning a person's voice or using reference audio without that person's authorization, and impersonation, remain prohibited. No credential, account identifier, or plan tier is recorded in this repository, only that synthesis was on a paid plan. **Status: `CLEARED`** by the owner's record of 2026-10-22 (see `docs/RELEASE_RIGHTS.md`, "Voice rights").

### `narration-research-providers`

The local narration adapters under `src/narration/providers` (Magpie through NeMo-Speech.cpp, and Chatterbox) exist for the evaluation bakeoff. No render or publish path imports them (`test/guards.test.ts`), so no output of theirs reaches a release. Their model and runtime licenses were not assessed. Status: `UNVERIFIED`, research only.

## Generated media

### `blender-render-output`

The character frames: PNG frames Blender renders of the character model in a scene this repository's code builds, with no image loaded into it, including the seven committed character reference frames. Blender's license page and FAQ treat what Blender produces as the user's own, and the GNU GPL FAQ says a program's license does not reach its output unless the output copies the program's own text or art; the GPL covers the scripts that call the API, not the images. Status: `CLEARED` on the owner's provenance record of 2026-10-25 ([docs/RELEASE_RIGHTS.md](docs/RELEASE_RIGHTS.md#owner-authored-and-generated-items)).

### `blender-depth-reveal-output`

The depth-reveal frames: Blender renders of the 2D-to-3D transition that project Remotion's own frames onto Blender geometry, including the three committed transition reference frames. They carry Remotion's output, so they are not cleared before `remotion-render-output` is. Status: `OWNER_CONFIRMATION_PENDING`.

### `walletwallaby-character-model`

The `.blend` and canonical model generated by `blender/walletwallaby/build.py` from this repository's code; nothing is imported into it. It holds data only: no embedded scripts, and it is always reopened with scripts disabled. The signed-distance primitives `geometry.py` credits to Inigo Quilez are code the build runs, not part of the model, and stay the `quilez-sdf-forms` item. Status: `CLEARED` on the owner's provenance record of 2026-10-25.

### `remotion-render-output`

The MP4, stills, captions, and package Remotion renders. Not treated as cleared before `remotion` is. Status: `OWNER_CONFIRMATION_PENDING`.

### `elevenlabs-narration-audio`

Synthetic narration audio sets. The provider's Terms leave rights in the output with the user, subject to those Terms. The audio lives in the ignored `dist` directory, not in git, and its identity is bound by the narration receipt. Status: `OWNER_CONFIRMATION_PENDING`.
