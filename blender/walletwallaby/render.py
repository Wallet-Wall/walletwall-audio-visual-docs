"""Render WalletWallaby from MotionPlan bridge frames: `npm run blender:render`.

Input (the job, written by scripts/blender.ts): the pinned config, the rig
export, the bridge document (walletwall.blender-motion/v1, already validated by
the orchestrator and re-checked here for shape), optionally the declared
terrain (walletwall.blender-terrain/v1), and a list of shots: which bridge frame,
which camera, and where the PNG goes. Output, under dist/blender/out/: one
lossless RGBA PNG per shot and render.json (per-shot timing, the IK contact
error measured on Blender's own solved bones, and each PNG's sha256).

Every shot is posed from scratch from its frame (controls.apply_frame), so the
order shots render in cannot change any of them.
"""

import hashlib
import json
import math
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bpy  # noqa: E402

import controls as C  # noqa: E402
import scene as S  # noqa: E402
import terrain as T  # noqa: E402
import transition as TR  # noqa: E402
from common import OUT_ROOT, UNITS, fail, job_from_argv, log, out_path, within  # noqa: E402

TIP_OF = {"target_heel_n": "shin_n", "target_toe_n": "foot_n", "target_heel_f": "shin_f", "target_toe_f": "foot_f", "target_paw_n": "forearm_n", "target_paw_f": "forearm_f", "target_tail": "tail_4"}
# A paw is a contact only when both forelimbs hold a lip (the `arms` group); pointing aims at a target it need not reach.
GROUP_OF = {"target_heel_n": "legs", "target_toe_n": "legs", "target_heel_f": "legs", "target_toe_f": "legs", "target_paw_n": "arms", "target_paw_f": "arms", "target_tail": "tail"}


def contact_error(binding, frame):
    """Distance (rig px) between each fully-weighted IK target and where Blender's solved chain actually reaches."""
    arm = binding.arm
    errs = {}
    if not frame["visible"]:
        return errs
    for t, bone in TIP_OF.items():
        if frame["pose"]["ik"][GROUP_OF[t]] < 0.999:
            continue
        tip = arm.pose.bones[bone].tail
        want = binding.targets[t].location
        # Compare in the plane: the chain's depth is the target's by construction.
        errs[t] = math.hypot(tip.x - want.x, tip.z - want.z) / UNITS
    return errs


def main():
    job = job_from_argv()
    if job.get("schema") != "walletwall.blender-job/v1" or job.get("kind") != "render":
        fail("not a walletwall.blender-job/v1 render job")
    cfg = job["config"]
    rig = job["rig"]
    blend = (OUT_ROOT / job["blend"]).resolve()
    if not within(blend, OUT_ROOT) or blend.suffix != ".blend" or not blend.exists():
        fail("the character .blend must be a built file inside dist/blender/out")
    bpy.ops.wm.open_mainfile(filepath=str(blend), load_ui=False, use_scripts=False)
    S.apply_render_settings(cfg, job.get("resolution"))
    S.build_world_and_light(cfg)
    arm = bpy.data.objects["WalletWallaby"]
    targets = {o.name[2:]: o for o in bpy.data.objects if o.name.startswith("T.")}
    shadow = bpy.data.objects.get("WalletWallaby.ContactShadow")
    binding = C.RigBinding(arm, rig, targets, shadow, T.support_spans(job.get("terrain")), cfg["visual"]["contactShadow"])
    frames = {f["frame"]: f for f in job["bridge"]["frames"]}
    reveal = TR.DepthReveal(job["transition"], job["terrain"], cfg) if job.get("transition") else None
    terrain = T.TerrainScene(job.get("terrain"), job.get("terrainStyle"), cfg) if job.get("terrain") and not reveal else None
    cameras = {}
    report = []
    t_all = time.perf_counter()
    first_ms = None
    for shot in job["shots"]:
        t0 = time.perf_counter()
        frame = frames.get(shot["frame"])
        if frame is None:
            fail(f"shot {shot['name']}: frame {shot['frame']} is not in the bridge")
        cam_spec = shot["camera"]
        key = json.dumps(cam_spec, sort_keys=True)
        if cam_spec["kind"] == "transition":
            if reveal is None:
                fail("a transition shot needs the job's transition")
            reveal.at(float(cam_spec["t"]))
        elif key not in cameras:
            if cam_spec["kind"] == "teaching":
                cameras[key] = S.teaching_camera(cfg, f"cam.{len(cameras)}")
            elif cam_spec["kind"] == "framing":
                cameras[key] = S.framing_camera(cfg, cam_spec["center"], cam_spec["widthPx"], f"cam.{len(cameras)}")
            elif cam_spec["kind"] == "perspective":
                cameras[key] = T.perspective_camera(cfg, cam_spec, f"cam.{len(cameras)}")
            else:
                fail(f"unknown camera kind {cam_spec['kind']}")
        if cam_spec["kind"] != "transition":
            bpy.context.scene.camera = cameras[key]
        res = shot.get("resolution") or job.get("resolution") or cfg["render"]["resolution"]
        bpy.context.scene.render.resolution_x, bpy.context.scene.render.resolution_y = int(res[0]), int(res[1])
        if terrain is not None:
            terrain.show(shot.get("terrainSegment"))
        dfs = shot.get("depthFromScale")
        if dfs:
            # A move into depth (the plan's scale falling): true size, real depth; the perspective does the shrinking.
            place = lambda a, x, y, s, f, clips: S.place_character(a, cfg, x, y, dfs["s0"], f, dfs["base"] + dfs["k"] * (dfs["s0"] / s - 1.0), clips)
        else:
            place = lambda a, x, y, s, f, clips: S.place_character(a, cfg, x, y, s, f, shot.get("depthPx", 0.0), clips, shot.get("yawDeg"))
        C.apply_frame(binding, frame, place)
        bpy.context.view_layer.update()
        errs = contact_error(binding, frame)
        out = out_path(f"{job['outputs']['dir']}/{shot['name']}.png")
        bpy.context.scene.render.filepath = str(out)
        bpy.ops.render.render(write_still=True)
        ms = (time.perf_counter() - t0) * 1000
        if first_ms is None:
            first_ms = ms
        report.append({
            "name": shot["name"],
            "frame": shot["frame"],
            "ms": round(ms, 1),
            "contactErrorPx": {k: round(v, 4) for k, v in sorted(errs.items())},
            "sha256": hashlib.sha256(out.read_bytes()).hexdigest(),
        })
    total = time.perf_counter() - t_all
    manifest = {
        "schema": "walletwall.blender-render/v1",
        "blenderVersion": bpy.app.version_string,
        "shots": report,
        "seconds": round(total, 3),
        "firstShotMs": round(first_ms or 0.0, 1),
    }
    out_path(job["outputs"]["manifest"]).write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    worst = max((v for r in report for v in r["contactErrorPx"].values()), default=0.0)
    log(f"rendered {len(report)} shots in {total:.1f} s (first {first_ms or 0:.0f} ms); worst IK contact error {worst:.4f} px")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        print(f"[walletwallaby] render failed: {e}", file=sys.stderr, flush=True)
        raise
