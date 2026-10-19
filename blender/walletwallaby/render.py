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
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402

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


def measure_bones(arm, names):
    """Each contract bone's head and tail as the teaching view projects them, in frame pixels (x right, y down): the
    geometry the ported rig invariants are checked on (scripts/blender-invariants.ts). Depth is not a frame pixel."""
    mw = arm.matrix_world
    out = {}
    for name in names:
        pb = arm.pose.bones[name]
        h = mw @ pb.head
        t = mw @ pb.tail
        out[name] = [round(h.x / UNITS + 960.0, 3), round(540.0 - h.z / UNITS, 3), round(t.x / UNITS + 960.0, 3), round(540.0 - t.z / UNITS, 3)]
    return out


def render_environment():
    """What actually rendered: OS family, Blender build, engine, and the GPU or software renderer with its driver or
    Mesa identity, as Blender's own GPU module reports them after a render. No host name, user, or path."""
    env = {
        "os": {"win32": "windows", "linux": "linux", "darwin": "macos"}.get(sys.platform, sys.platform),
        "blenderVersion": bpy.app.version_string,
        "blenderBuildHash": bpy.app.build_hash.decode() if isinstance(bpy.app.build_hash, bytes) else str(bpy.app.build_hash),
        "engine": bpy.context.scene.render.engine,
    }
    try:
        import gpu

        env["gpu"] = {
            "backend": gpu.platform.backend_type_get(),
            "vendor": gpu.platform.vendor_get(),
            "renderer": gpu.platform.renderer_get(),
            "version": gpu.platform.version_get(),
            "deviceType": gpu.platform.device_type_get(),
        }
    except Exception as e:  # noqa: BLE001 - recorded as unknown, never guessed
        env["gpu"] = {"unavailable": type(e).__name__}
    return env


def crop_camera(cfg, name):
    """The teaching view restricted to a crop: orthographic, looking along +Y, one frame pixel per image pixel."""
    cam = S.teaching_camera(cfg, name)
    return cam


def frame_crop(cam, crop):
    """Frame an integer frame-px canvas (x, y, width, height) without moving the camera: it stays exactly where the
    full-frame teaching camera is (so everything view-dependent, such as the sun's shadow clipmap, is anchored as in a
    full-frame render) and the lens shift moves the view onto the crop. One image pixel is one frame pixel."""
    x, y, w, h = crop["x"], crop["y"], crop["width"], crop["height"]
    side = max(w, h)
    cam.data.sensor_fit = "AUTO"
    cam.data.ortho_scale = side * UNITS
    cam.location = (0.0, -60.0, 0.0)
    # Shift is in units of the larger frame dimension (here `side` px).
    cam.data.shift_x = (x + w / 2.0 - 960.0) / side
    cam.data.shift_y = (540.0 - (y + h / 2.0)) / side
    return (w, h)


def ink_on_interior_edge(path, crop, frame_size):
    """True when any drawn pixel touches a crop edge that lies inside the frame (the envelope did not hold the body).
    An edge on the frame's own border is exempt: there the character simply leaves the frame."""
    w, h = crop["width"], crop["height"]
    img = bpy.data.images.load(str(path), check_existing=False)
    try:
        px = np.zeros(w * h * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
    finally:
        bpy.data.images.remove(img)
    a = px.reshape(h, w, 4)[::-1, :, 3]  # rows top-down, alpha
    W, H = frame_size
    edges = []
    if crop["x"] > 0:
        edges.append(a[:, 0])
    if crop["x"] + w < W:
        edges.append(a[:, w - 1])
    if crop["y"] > 0:
        edges.append(a[0, :])
    if crop["y"] + h < H:
        edges.append(a[h - 1, :])
    return any(float(e.max(initial=0.0)) > 0.0 for e in edges)


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
    environment = None
    # Measurements are asked for by the job (the invariants run), and only views that project like the teaching view.
    measure = bool(job.get("measure"))
    bone_names = [b["name"] for b in rig["bones"]]
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
        elif cam_spec["kind"] == "crop":
            if "crop" not in cameras:
                cameras["crop"] = crop_camera(cfg, "cam.crop")
            key = "crop"
            shot["resolution"] = list(frame_crop(cameras["crop"], cam_spec))
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
        bone_names_px = measure_bones(arm, bone_names) if measure and frame["visible"] and cam_spec["kind"] in ("teaching", "crop") else None
        out = out_path(f"{job['outputs']['dir']}/{shot['name']}.png")
        bpy.context.scene.render.filepath = str(out)
        bpy.ops.render.render(write_still=True)
        if cam_spec["kind"] == "crop" and ink_on_interior_edge(out, cam_spec, cfg["render"]["resolution"]):
            fail(f"frame {shot['frame']}: the drawn body reaches an interior edge of its crop {cam_spec}; the envelope does not hold it")
        if environment is None:
            environment = render_environment()
        ms = (time.perf_counter() - t0) * 1000
        if first_ms is None:
            first_ms = ms
        report.append({
            "name": shot["name"],
            "frame": shot["frame"],
            **({"crop": {k: cam_spec[k] for k in ("x", "y", "width", "height")}} if cam_spec["kind"] == "crop" else {}),
            **({"bones": bone_names_px} if bone_names_px is not None else {}),
            "ms": round(ms, 1),
            "contactErrorPx": {k: round(v, 4) for k, v in sorted(errs.items())},
            "sha256": hashlib.sha256(out.read_bytes()).hexdigest(),
        })
    total = time.perf_counter() - t_all
    manifest = {
        "schema": "walletwall.blender-render/v1",
        "blenderVersion": bpy.app.version_string,
        "environment": environment,
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
