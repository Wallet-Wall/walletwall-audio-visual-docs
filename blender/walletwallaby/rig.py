# SPDX-License-Identifier: GPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 WalletWall
#
# This file uses the Blender Python API, so it is licensed GPL-3.0-or-later.
# The rest of this repository is MIT; see docs/LICENSING.md.
"""WalletWallaby's armature: the rig contract's skeleton, given depth.

The 22 bones are the Rive rig's own (names, parents, rest positions), placed on
the 2.5D plane: rig x -> X, rig y (down) -> -Z, and the paired limbs set to
either side of the body in depth (near side toward the camera, -Y). Every bone
is rolled so its local Z axis is world +Y, so a rig rotation (positive =
clockwise on screen) is a rotation about local Z by the same angle, and a pose
is exactly the rig's local rotations less their rest values.

Blender performs; it does not decide. The IK chains (two-bone legs, forelimbs,
and tail tip; aimed feet) are Blender-native constraints whose targets are
empties that only the MotionPlan bridge moves, at strengths only the bridge sets.
The solver is the legacy one, which re-solves every evaluation from the posed
chain (no state carried between frames). Pole targets ride the chain's parent,
on the side the contract bends to (knees forward, elbows down, the tail arched).
"""

import math

import bpy
from mathutils import Matrix, Vector

from common import UNITS, fail, log
from geometry import ARM_D, EAR_D, EYE, LEG_D

FACE_BONES = ("eye_n", "eye_f", "lid_n", "lid_f", "brow_n", "brow_f")


def bone_depth(name):
    sgn = -1.0 if name.endswith("_n") else 1.0 if name.endswith("_f") else 0.0
    if name.startswith(("thigh", "shin", "foot")):
        return sgn * LEG_D
    if name.startswith(("arm", "forearm")):
        return sgn * ARM_D
    if name.startswith("ear"):
        return sgn * EAR_D
    return 0.0


def to_bu(x, y, d):
    """Rig px (x, y-down) at depth d (px) -> armature space (Blender units)."""
    return Vector((x * UNITS, d * UNITS, -y * UNITS))


def build_armature(rig, eye_depth):
    data = bpy.data.armatures.new("walletwallaby.rig")
    obj = bpy.data.objects.new("WalletWallaby", data)
    bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = data.edit_bones
    for b in rig["bones"]:
        bone = eb.new(b["name"])
        d = bone_depth(b["name"])
        bone.head = to_bu(b["head"][0], b["head"][1], d)
        bone.tail = to_bu(b["tail"][0], b["tail"][1], d)
        bone.align_roll(Vector((0.0, 1.0, 0.0)))
    for b in rig["bones"]:
        if b["parent"] != "root":
            eb[b["name"]].parent = eb[b["parent"]]
            eb[b["name"]].use_connect = bool(b["connected"])
    # The lane's face bones (not in the rig contract; driven by its face controls): each eye, its lid, its brow.
    head = eb["head"]
    for side, sgn in (("n", -1.0), ("f", 1.0)):
        c = to_bu(EYE["x"], -EYE["z"], sgn * eye_depth)
        for kind, off in (("eye", (0, 0)), ("lid", (0, 0)), ("brow", (0.5, 11.2))):
            bone = eb.new(f"{kind}_{side}")
            at = c + Vector((off[0] * UNITS, 0, off[1] * UNITS))
            bone.head = at
            bone.tail = at + Vector((6 * UNITS, 0, 0))
            bone.align_roll(Vector((0.0, 1.0, 0.0)))
            bone.parent = head
    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in obj.pose.bones:
        pb.rotation_mode = "XYZ"
        pb.ik_stretch = 0.0
    obj.pose.ik_solver = "LEGACY"
    return obj


def _empty(name, parent, loc):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = "PLAIN_AXES"
    e.empty_display_size = 0.05
    bpy.context.scene.collection.objects.link(e)
    e.parent = parent
    e.location = loc
    return e


def chain_bend(arm, tip, chain):
    """The rest bend of a two-bone chain: the unit vector from the root-tip line to the middle joint (armature space)."""
    bones = arm.data.bones
    lower = bones[tip]
    upper = lower.parent
    root = upper.head_local
    mid = upper.tail_local
    end = lower.tail_local
    axis = (end - root).normalized()
    off = (mid - root) - axis * (mid - root).dot(axis)
    if off.length < 1e-6:
        fail(f"chain {tip} has no rest bend")
    return upper.name, off.normalized()


def build_ik(arm, rig):
    """Target empties (the bridge moves them), poles, and the constraints. Returns the targets by contract name."""
    targets = {}
    for ik in rig["iks"]:
        name = ik["target"]
        if name not in targets:
            tip = arm.data.bones[ik["tip"]]
            targets[name] = _empty(f"T.{name}", arm, tip.tail_local.copy())
    for ik in rig["iks"]:
        pb = arm.pose.bones[ik["tip"]]
        tgt = targets[ik["target"]]
        if ik["chain"] == 1:
            c = pb.constraints.new("DAMPED_TRACK")
            c.name = f"ik.{ik['name']}"
            c.target = tgt
            c.track_axis = "TRACK_Y"
            continue
        if ik["chain"] != 2:
            fail(f"IK {ik['name']}: only one- and two-bone chains are in the contract")
        upper, bend = chain_bend(arm, ik["tip"], 2)
        parent = arm.data.bones[upper].parent
        mid = arm.data.bones[upper].tail_local
        pole = _empty(f"P.{ik['name']}", arm, (mid + bend * 1.2).copy())
        # The pole rides the chain's parent bone so it turns with the body.
        mw = pole.matrix_world.copy()
        pole.parent = arm
        pole.parent_type = "BONE"
        pole.parent_bone = parent.name
        pole.matrix_world = mw
        c = pb.constraints.new("IK")
        c.name = f"ik.{ik['name']}"
        c.target = tgt
        c.pole_target = pole
        c.chain_count = 2
        c.use_tail = True
        c.use_stretch = False
        c.iterations = 500
        c.pole_angle = calibrate_pole(arm, c, ik["tip"])
    return targets


def _joint_positions(arm, tip):
    bpy.context.view_layer.update()
    lower = arm.pose.bones[tip]
    upper = lower.parent
    return [upper.head.copy(), upper.tail.copy(), lower.tail.copy()]


def calibrate_pole(arm, c, tip):
    """The pole angle that leaves the rest pose exactly where the rig contract puts it (targets at rest)."""
    want = [arm.data.bones[tip].parent.head_local, arm.data.bones[tip].parent.tail_local, arm.data.bones[tip].tail_local]
    best, best_err = 0.0, math.inf
    for k in range(-180, 180, 1):
        c.pole_angle = math.radians(k)
        got = _joint_positions(arm, tip)
        err = sum((g - w).length for g, w in zip(got, want))
        if err < best_err - 1e-12:
            best, best_err = math.radians(k), err
    c.pole_angle = best
    log(f"pole {c.name}: {math.degrees(best):.0f} deg, rest error {best_err / UNITS:.4f} px")
    if best_err / UNITS > 0.25:
        fail(f"{c.name}: no pole angle reproduces the rest pose (error {best_err / UNITS:.3f} px)")
    return best
