# SPDX-License-Identifier: GPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 WalletWall
#
# This file uses the Blender Python API, so it is licensed GPL-3.0-or-later.
# The rest of this repository is MIT; see docs/LICENSING.md.
"""One MotionPlan bridge frame (walletwall.blender-motion/v1) onto the armature.

Pure mapping, no decisions: every value set here comes from the frame. The
rig's local rotations less their rest values become each bone's rotation about
its local Z (world depth); the hip's rig position becomes its location; the IK
targets the bridge resolved become the target empties' locations, on their
chain's own depth; the IK strengths become the constraints' influences; the
face controls drive the lane's eye, lid, and brow bones. Every channel of every
frame is written from scratch, so a frame never depends on the one before it.
"""

import math

from mathutils import Vector

from common import UNITS, fail
from rig import bone_depth

# Which constraint answers which IK strength group (the rig contract's groups).
IK_GROUP = {"ik.leg_n": "legs", "ik.foot_n": "legs", "ik.leg_f": "legs", "ik.foot_f": "legs", "ik.arm_n": "pointNear", "ik.arm_f": "arms", "ik.tail": "tail"}
# The depth each IK target sits at: its chain's.
TARGET_CHAIN = {"target_heel_n": "shin_n", "target_toe_n": "foot_n", "target_heel_f": "shin_f", "target_toe_f": "foot_f", "target_paw_n": "forearm_n", "target_paw_f": "forearm_f", "target_tail": "tail_4"}


class RigBinding:
    """Everything a frame writes to, resolved once per scene."""

    def __init__(self, arm, rig, targets, shadow, spans=None, shadow_spec=None):
        self.arm = arm
        self.rig = rig
        self.targets = targets
        self.shadow = shadow
        # The contact shadow's per-frame inputs: the support's horizontal extent (terrain.support_spans) and the
        # shadow's look (config.visual.contactShadow). Without a terrain document the shadow is not clipped.
        self.spans = spans or {}
        self.shadow_spec = shadow_spec
        self.shadow_nodes = None
        if shadow is not None and shadow.data.materials:
            nodes = shadow.data.materials[0].node_tree.nodes
            self.shadow_nodes = (nodes["clipL"], nodes["clipR"], nodes["gain"])
        self.rest = {b["name"]: b["restRotation"] for b in rig["bones"]}
        self.hip_rest = Vector(rig["bones"][0]["head"]) if rig["bones"][0]["name"] == "hip" else None
        if self.hip_rest is None:
            fail("the rig export must list the hip first")
        self.hip_basis = arm.data.bones["hip"].matrix_local.to_3x3().inverted()
        self.face_rest = rig["face"]
        self.constraints = []
        for pb in arm.pose.bones:
            for c in pb.constraints:
                if c.name not in IK_GROUP:
                    fail(f"unexpected constraint {c.name} on {pb.name}")
                self.constraints.append(c)
        if len(self.constraints) != len(IK_GROUP):
            fail("the armature is missing an IK constraint")
        self.meshes = [o for o in arm.children if o.type == "MESH" and o is not shadow]


def apply_frame(b, frame, place):
    """Pose the armature for one bridge frame; `place(arm, x, y, scale, facing)` puts it in the scene."""
    arm = b.arm
    p = frame["place"]
    place(arm, p["x"], p["y"], p["scale"], p["facing"], frame["pose"]["clips"])
    visible = bool(frame["visible"])
    for o in b.meshes:
        o.hide_render = not visible
    pose = frame["pose"]
    rot = pose["rot"]
    for name, rest in b.rest.items():
        pb = arm.pose.bones[name]
        pb.rotation_euler = (0.0, 0.0, rot[name] - rest)
        pb.location = (0.0, 0.0, 0.0)
    hx, hy = pose["hip"]
    delta = Vector(((hx - b.hip_rest[0]) * UNITS, 0.0, -(hy - b.hip_rest[1]) * UNITS))
    arm.pose.bones["hip"].location = b.hip_basis @ delta
    for tname, (tx, ty) in pose["targets"].items():
        if tname not in b.targets:
            fail(f"bridge target {tname} is not in the rig")
        b.targets[tname].location = (tx * UNITS, bone_depth(TARGET_CHAIN[tname]) * UNITS, -ty * UNITS)
    for c in b.constraints:
        c.influence = float(pose["ik"][IK_GROUP[c.name]])
    # Face: the eye moves with the gaze (head-local px), the lid turns down over it, the brow tilts.
    gx = pose["gaze"][0] - b.face_rest["gaze"][0]
    gy = pose["gaze"][1] - b.face_rest["gaze"][1]
    lid = float(pose["lid"])
    for side, sgn in (("n", -1.0), ("f", 1.0)):
        eye = arm.pose.bones[f"eye_{side}"]
        eye.location = (-gy * UNITS, gx * UNITS, 0.0)
        eye.rotation_euler = (0.0, 0.0, 0.0)
        lid_b = arm.pose.bones[f"lid_{side}"]
        lid_b.location = (-gy * UNITS, gx * UNITS, 0.0)
        lid_b.rotation_euler = (0.0, -sgn * math.pi * (lid - 0.5), 0.0)
        brow = arm.pose.bones[f"brow_{side}"]
        brow.location = (0.0, 0.0, 0.0)
        brow.rotation_euler = (0.0, 0.0, pose["brow"] - b.face_rest["browRotation"])
    # The contact shadow shows only while the feet are on a declared surface, clipped to that surface's extent.
    if b.shadow is not None:
        b.shadow.hide_render = (not visible) or frame["semantic"]["contact"] == "NONE"
        if not b.shadow.hide_render:
            set_contact_shadow(b, frame)


def set_contact_shadow(b, frame):
    """The shadow's clip to the support under the feet, and its gain for a hard landing: both from the frame."""
    if b.shadow_nodes is None or b.shadow_spec is None:
        return
    left, right, gain = b.shadow_nodes
    sem = frame["semantic"]
    surf = sem["surface"]
    span = b.spans.get((frame["segment"], surf["id"])) if surf else None
    fade = b.shadow_spec["spanFadePx"] * UNITS
    if span is None:
        span = (-1.0e6, 1.0e6)
        fade = 1.0
    left.inputs["From Min"].default_value = span[0]
    left.inputs["From Max"].default_value = span[0] + fade
    right.inputs["From Min"].default_value = span[1]
    right.inputs["From Max"].default_value = span[1] - fade
    gain.outputs[0].default_value = 1.0 + b.shadow_spec["landingGain"] * sem["landingImpulse"]
