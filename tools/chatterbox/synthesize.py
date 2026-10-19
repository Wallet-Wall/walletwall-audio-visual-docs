"""The one Python entry this repository hands to the Chatterbox environment.

Runs offline against the Hugging Face cache (the caller sets HF_HUB_OFFLINE),
loads the pinned checkpoint revision of ResembleAI/chatterbox, generates one
passage with the model's built-in voice (conds.pt; never a reference clip),
writes a 16-bit PCM WAV at the model's native sample rate with no processing
beyond the clamp to int16, and records exactly what it loaded.

    python -I -B tools/chatterbox/synthesize.py --job <job.json>
    python -I -B tools/chatterbox/synthesize.py --pull [--revision <ref>]

The job file is data written by src/narration/providers/chatterbox.ts; nothing
in it is executed, and only the keys read below are honoured.
"""

from __future__ import annotations

import argparse
import glob
import hashlib
import importlib.metadata
import inspect
import json
import os
import random
import sys
import time
import wave

JOB_SCHEMA = "walletwall.chatterbox-job/v1"
RESULT_SCHEMA = "walletwall.chatterbox-result/v1"
PACKAGE = "chatterbox-tts"


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def snapshot_revision(path: str) -> str | None:
    parts = os.path.normpath(path).split(os.sep)
    for i, part in enumerate(parts):
        if part == "snapshots" and i + 1 < len(parts):
            return parts[i + 1]
    return None


def package_source() -> dict:
    """PEP 610 direct_url.json: how the package was installed (a git commit for a source install)."""
    try:
        text = importlib.metadata.distribution(PACKAGE).read_text("direct_url.json")
    except importlib.metadata.PackageNotFoundError:
        return {}
    if not text:
        return {}
    data = json.loads(text)
    vcs = data.get("vcs_info") or {}
    return {"url": data.get("url"), "vcs": vcs.get("vcs"), "commit": vcs.get("commit_id"), "requestedRevision": vcs.get("requested_revision")}


def load_model(device: str, t3_model: str, revision: str | None, offline: bool):
    """Load ChatterboxMultilingualTTS while recording every checkpoint file it fetched."""
    import chatterbox.mtl_tts as mtl

    used: dict[str, str] = {}
    patched = {}
    for name in ("hf_hub_download", "snapshot_download"):
        if hasattr(mtl, name):
            patched[name] = getattr(mtl, name)

    def recording_file(*args, **kwargs):
        if revision is not None:
            kwargs["revision"] = revision
        if offline:
            kwargs["local_files_only"] = True
        path = patched["hf_hub_download"](*args, **kwargs)
        name = kwargs.get("filename") or (args[1] if len(args) > 1 else os.path.basename(path))
        used[str(name)] = path
        return path

    def recording_snapshot(*args, **kwargs):
        if revision is not None:
            kwargs["revision"] = revision
        if offline:
            kwargs["local_files_only"] = True
        directory = patched["snapshot_download"](*args, **kwargs)
        for pattern in kwargs.get("allow_patterns") or ["*"]:
            for path in sorted(glob.glob(os.path.join(directory, pattern))):
                if os.path.isfile(path):
                    used[os.path.relpath(path, directory).replace(os.sep, "/")] = path
        return directory

    if "hf_hub_download" in patched:
        mtl.hf_hub_download = recording_file
    if "snapshot_download" in patched:
        mtl.snapshot_download = recording_snapshot
    try:
        kwargs = {"device": device}
        if "t3_model" in inspect.signature(mtl.ChatterboxMultilingualTTS.from_pretrained).parameters:
            kwargs["t3_model"] = t3_model
        elif t3_model != "v2":
            raise SystemExit(f"this chatterbox build cannot select t3_model={t3_model!r}: install the pinned source commit (tools/chatterbox/README.md)")
        model = mtl.ChatterboxMultilingualTTS.from_pretrained(**kwargs)
    finally:
        for name, original in patched.items():
            setattr(mtl, name, original)
    return model, used


def pull(args: argparse.Namespace) -> int:
    model, used = load_model("cpu", args.t3_model, args.revision, offline=False)
    revisions = {snapshot_revision(p) for p in used.values()}
    revisions.discard(None)
    out = {
        "repo": args.repo,
        "revision": sorted(revisions)[0] if len(revisions) == 1 else None,
        "revisions": sorted(revisions),
        "files": {name: sha256_file(path) for name, path in sorted(used.items())},
        "sampleRate": int(model.sr),
        "package": {"name": PACKAGE, "version": importlib.metadata.version(PACKAGE), "source": package_source()},
        "builtInVoice": getattr(model, "conds", None) is not None,
    }
    print(json.dumps(out, indent=2))
    return 0


def synthesize(args: argparse.Namespace) -> int:
    with open(args.job, "r", encoding="utf-8") as f:
        job = json.load(f)
    if job.get("schema") != JOB_SCHEMA:
        print(f"job is not {JOB_SCHEMA}", file=sys.stderr)
        return 2
    job_dir = os.path.dirname(os.path.abspath(args.job))
    output = os.path.join(job_dir, os.path.basename(str(job["output"])))
    result_path = os.path.join(job_dir, os.path.basename(str(job["result"])))
    device = str(job["device"])
    seed = int(job["seed"])
    revision = str(job["revision"])

    import numpy as np
    import torch

    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if device == "cuda":
        if not torch.cuda.is_available():
            print("CUDA requested but not available", file=sys.stderr)
            return 3
        torch.cuda.manual_seed_all(seed)

    t0 = time.perf_counter()
    model, used = load_model(device, str(job["t3Model"]), revision, offline=True)
    load_ms = (time.perf_counter() - t0) * 1000.0
    revisions = {snapshot_revision(p) for p in used.values()}
    if revisions != {revision}:
        print(f"loaded snapshot(s) {sorted(r for r in revisions if r)} do not match the pinned revision {revision}", file=sys.stderr)
        return 4
    if getattr(model, "conds", None) is None:
        print("the checkpoint has no built-in voice (conds.pt); reference-audio conditioning is not permitted", file=sys.stderr)
        return 5

    wanted = {
        "exaggeration": float(job["exaggeration"]),
        "cfg_weight": float(job["cfgWeight"]),
        "temperature": float(job["temperature"]),
        "repetition_penalty": float(job["repetitionPenalty"]),
        "min_p": float(job["minP"]),
        "top_p": float(job["topP"]),
    }
    accepted = set(inspect.signature(model.generate).parameters)
    kwargs = {k: v for k, v in wanted.items() if k in accepted}
    if "language_id" in accepted:
        kwargs["language_id"] = str(job["languageId"])

    if device == "cuda":
        torch.cuda.reset_peak_memory_stats()
    torch.manual_seed(seed)
    if device == "cuda":
        torch.cuda.manual_seed_all(seed)
    t1 = time.perf_counter()
    with torch.inference_mode():
        wav = model.generate(str(job["text"]), **kwargs)
    if device == "cuda":
        torch.cuda.synchronize()
    generate_ms = (time.perf_counter() - t1) * 1000.0

    samples = wav.detach().float().cpu().numpy().reshape(-1)
    peak = float(np.max(np.abs(samples))) if samples.size else 0.0
    # The model's float output can exceed full scale by a fraction of a decibel. Writing it as int16 would
    # clip; a constant gain that brings the peak to exactly 1.0 changes level only (never timing or
    # prosody) and is recorded below. Nothing is applied when the output already fits.
    quantization_gain = 1.0 / peak if peak > 1.0 else 1.0
    pcm = np.clip(np.round(samples * quantization_gain * 32767.0), -32768, 32767).astype("<i2")
    with wave.open(output, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(int(model.sr))
        w.writeframes(pcm.tobytes())

    result = {
        "schema": RESULT_SCHEMA,
        "package": {"name": PACKAGE, "version": importlib.metadata.version(PACKAGE), "source": package_source()},
        "torch": torch.__version__,
        "cuda": torch.version.cuda if device == "cuda" else None,
        "device": device,
        "deviceName": torch.cuda.get_device_name(0) if device == "cuda" else "cpu",
        "repo": str(job["repo"]),
        "revision": revision,
        "files": {name: sha256_file(path) for name, path in sorted(used.items())},
        "sampleRate": int(model.sr),
        "loadMs": load_ms,
        "generateMs": generate_ms,
        "maxMemoryMiB": (torch.cuda.max_memory_allocated() / (1024 * 1024)) if device == "cuda" else None,
        "appliedKwargs": sorted(kwargs),
        "peakBeforeQuantization": peak,
        "quantizationGainDb": 20.0 * __import__("math").log10(quantization_gain),
    }
    with open(result_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, sort_keys=True)
        f.write("\n")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--job", help="job file written by the adapter")
    ap.add_argument("--pull", action="store_true", help="download the checkpoint (online) and print its resolved revision")
    ap.add_argument("--repo", default="ResembleAI/chatterbox")
    ap.add_argument("--revision", default=None)
    ap.add_argument("--t3-model", dest="t3_model", default="v3")
    args = ap.parse_args()
    if args.pull:
        return pull(args)
    if not args.job:
        ap.error("--job or --pull is required")
    return synthesize(args)


if __name__ == "__main__":
    sys.exit(main())
