# Chatterbox environment (isolated)

Chatterbox Multilingual (Resemble AI, MIT) is a PyTorch model. It never enters the Node project: no npm
dependency, no weights in git, no Python on the render path. It lives in its own virtual environment, and
the repository hands that environment exactly one script, `synthesize.py`, with a JSON job file.

## Why an isolated environment

- `chatterbox-tts` pins `torch==2.6.0`, which has no kernels for Blackwell GPUs (the RTX 5080 is
  compute capability 12.0). A CUDA 12.8 build of torch is required, so `overrides.txt` replaces the pin
  with `torch==2.11.0+cu128` from the PyTorch index.
- The wheel on PyPI (`chatterbox-tts 0.1.7`) still loads the V2 multilingual checkpoint and has no
  `t3_model` argument. The V3 checkpoint is selected by the upstream source at commit
  `5de7a54aa4e5e2baadb0182dde554908b48b85c2` (2026-07-21), which `config/narration-providers.json` pins and
  the adapter verifies through the installed package's PEP 610 `direct_url.json`.
- Upstream was developed and tested on Python 3.11; the environment uses CPython 3.11.17.

Windows is sufficient: no WSL is involved. The environment is about 6 GB (torch, CUDA libraries, and the
pinned transformers/diffusers stack) plus the checkpoint in the Hugging Face cache.

## Create it

Anywhere outside the repository (this lane used `C:\Users\<you>\tools\chatterbox`):

```bash
python -m pip install --user uv
python -m uv venv --python 3.11 --native-tls .venv
python -m uv pip install --native-tls --python .venv/Scripts/python.exe \
  torch==2.11.0+cu128 torchaudio==2.11.0+cu128 --index-url https://download.pytorch.org/whl/cu128
python -m uv pip install --native-tls --python .venv/Scripts/python.exe \
  "chatterbox-tts @ git+https://github.com/resemble-ai/chatterbox.git@5de7a54aa4e5e2baadb0182dde554908b48b85c2" \
  --override overrides.txt --extra-index-url https://download.pytorch.org/whl/cu128 --index-strategy unsafe-best-match
```

`requirements.lock.txt` is the `uv pip freeze` of the environment this lane evaluated with. Then:

```bash
export WALLETWALL_CHATTERBOX_PYTHON=/abs/path/to/.venv/Scripts/python.exe
node scripts/narration.ts pull chatterbox      # the only online step: downloads the checkpoint
node scripts/narration.ts doctor
```

`pull` prints the resolved Hugging Face revision and the sha256 of every checkpoint file; pin the revision
as `providers.chatterbox-multilingual.model.revision` in `config/narration-providers.json`. Synthesis runs
with `HF_HUB_OFFLINE=1` and refuses any other revision.

## What the script does, and does not do

- Loads `ChatterboxMultilingualTTS` with `t3_model="v3"` and the checkpoint's built-in voice (`conds.pt`).
  It never passes `audio_prompt_path`: reference-audio conditioning is closed in the adapter's schema.
- Seeds Python, NumPy, and torch (CPU and CUDA) from the job's seed before loading and again before
  generating. CUDA sampling is not guaranteed bit-identical across runs; the bakeoff measures that with
  `--repeat`.
- Writes 16-bit PCM at the model's native 24 kHz with no processing beyond the clamp to int16. The Perth
  watermark that Chatterbox applies to every output is left in place and declared in the settings.
- Records the package version and source commit, torch and CUDA versions, the device, the resolved
  revision, every file loaded with its sha256, timings, and peak CUDA memory in `<passage>.result.json`.
