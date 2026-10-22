# SPDX-License-Identifier: MIT
# SPDX-FileCopyrightText: 2026 WalletWall
#
# This file uses no Blender API and keeps the repository license (MIT). GPL-3.0-or-later
# files in this directory load it inside Blender; see docs/LICENSING.md.
"""Shared guards for the WalletWallaby Blender lane.

Blender runs these scripts as a subprocess of scripts/blender.ts with fixed
arguments: `--background --factory-startup --disable-autoexec --offline-mode
--python-exit-code 1 --python <this lane's entry> -- --job <job.json>`. The job
file is the only input. It is written by the TypeScript orchestrator inside
dist/blender/jobs/, read here through one bounded handle, and holds data only
(no code, no paths outside dist/blender). Every output is written under
dist/blender/out/. Nothing here reads the environment or the network.
"""

import json
import math
import os
import sys
from pathlib import Path

LANE_ROOT = Path(__file__).resolve().parent
REPO_ROOT = LANE_ROOT.parent.parent
DIST_ROOT = (REPO_ROOT / "dist" / "blender").resolve()
JOBS_ROOT = DIST_ROOT / "jobs"
OUT_ROOT = DIST_ROOT / "out"
MAX_JOB_BYTES = 256 * 1024 * 1024


class LaneError(Exception):
    pass


def fail(message):
    raise LaneError(message)


def within(path, root):
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def job_from_argv():
    """The one `--job <path>` argument after `--`, resolved and confined to dist/blender/jobs."""
    argv = sys.argv
    if "--" not in argv:
        fail("expected `-- --job <path>`")
    rest = argv[argv.index("--") + 1 :]
    if len(rest) != 2 or rest[0] != "--job":
        fail("expected exactly `--job <path>` after `--`")
    path = Path(rest[1]).resolve()
    if path.suffix != ".json" or not within(path, JOBS_ROOT):
        fail("the job must be a .json file inside dist/blender/jobs")
    return read_json(path)


def read_json(path):
    """Read one JSON file through a single bounded handle (no stat-then-open race)."""
    with open(path, "rb") as f:
        data = f.read(MAX_JOB_BYTES + 1)
    if len(data) > MAX_JOB_BYTES:
        fail(f"{path.name} is larger than {MAX_JOB_BYTES} bytes")
    return json.loads(data.decode("utf-8"))


def out_path(relative):
    """A path under dist/blender/out from a plain relative POSIX path (no parent, hidden, or absolute segments)."""
    if not isinstance(relative, str) or not relative or relative.startswith("/") or "\\" in relative:
        fail(f"output path {relative!r} must be a relative POSIX path")
    parts = relative.split("/")
    if any(p in ("", ".", "..") or p.startswith(".") for p in parts):
        fail(f"output path {relative!r} has an empty, parent, or hidden segment")
    path = (OUT_ROOT / Path(*parts)).resolve()
    if not within(path, OUT_ROOT):
        fail(f"output path {relative!r} escapes dist/blender/out")
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_to_linear(hexcolor):
    """'#RRGGBB' (sRGB, as the brand contract states it) -> scene-linear RGBA for Blender's colour sockets."""
    if not (isinstance(hexcolor, str) and len(hexcolor) == 7 and hexcolor[0] == "#"):
        fail(f"colour {hexcolor!r} is not #RRGGBB")
    rgb = [int(hexcolor[i : i + 2], 16) / 255.0 for i in (1, 3, 5)]
    return (*[srgb_to_linear(c) for c in rgb], 1.0)


# The coordinate contract (src/character/walletwallaby/blender/bridge.ts):
#   rig px (x forward, y down) at depth d (px, near side negative) -> armature space (X, Y, Z) = (x, d, -y) * UNITS
UNITS = 0.01


def rig3(x, y, d=0.0):
    """Rig px (x, y-down) at body depth d -> the lane's px space (X forward, Y depth, Z up)."""
    return (x, d, -y)


def deg(v):
    return v * math.pi / 180.0


def log(*parts):
    print("[walletwallaby]", *parts, flush=True)
