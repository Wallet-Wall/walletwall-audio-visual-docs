# SPDX-License-Identifier: GPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 WalletWall
#
# This file uses the Blender Python API, so it is licensed GPL-3.0-or-later.
# The rest of this repository is MIT; see docs/LICENSING.md.
"""Build WalletWallaby's Blender character from code: `npm run blender:build`.

Input (the job, written by scripts/blender.ts): the rig contract export
(walletwall.blender-rig/v1: skeleton, IK chains, palette from the brand
contract) and the pinned render config (config/blender.json). Output, under
dist/blender/out/: the generated .blend and model.json, a canonical description
of everything the build made (mesh bytes, weights, attributes, materials,
bones, constraints) with its sha256. The .blend is a generated artifact; the
reviewable source is this directory.
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
from mathutils import Matrix, Vector  # noqa: E402

import geometry as G  # noqa: E402
import materials as M  # noqa: E402
import rig as R  # noqa: E402
from common import UNITS, fail, job_from_argv, log, out_path  # noqa: E402

LANE_VERSION = {"model": 1, "materials": 2}


def new_mesh_object(name, verts_px, faces, arm=None, groups=None):
    """A mesh object in armature space from lane-px vertices; rigid parts get one full-weight group."""
    mesh = bpy.data.meshes.new(name)
    v = (np.asarray(verts_px, dtype=np.float64) * UNITS).astype(np.float32)
    f = np.asarray(faces, dtype=np.int64)
    nv, nf = len(v), len(f)
    corners = f.shape[1]
    mesh.vertices.add(nv)
    mesh.vertices.foreach_set("co", v.reshape(-1))
    mesh.loops.add(nf * corners)
    mesh.loops.foreach_set("vertex_index", f.reshape(-1).astype(np.int32))
    mesh.polygons.add(nf)
    mesh.polygons.foreach_set("loop_start", (np.arange(nf) * corners).astype(np.int32))
    mesh.polygons.foreach_set("loop_total", np.full(nf, corners, dtype=np.int32))
    mesh.update(calc_edges=True)
    mesh.validate(clean_customdata=False)
    mesh.shade_smooth()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    if arm is not None:
        obj.parent = arm
        mod = obj.modifiers.new("rig", "ARMATURE")
        mod.object = arm
        mod.use_vertex_groups = True
        if groups:
            for bone in groups:
                g = obj.vertex_groups.new(name=bone)
                g.add(list(range(nv)), 1.0, "REPLACE")
    return obj


def add_outline(obj, width_px, outline_mat):
    obj.data.materials.append(outline_mat)
    mod = obj.modifiers.new("outline", "SOLIDIFY")
    mod.thickness = width_px * UNITS
    mod.offset = 1.0
    mod.use_flip_normals = True
    mod.use_even_offset = False
    mod.use_quality_normals = True
    mod.use_rim = False
    mod.material_offset = len(obj.data.materials) - 1
    return mod


def build_body(rig, cfg):
    t0 = time.perf_counter()
    parts = G.build_parts(rig)
    sdf = G.body_sdf(parts)
    h = cfg["model"]["gridPx"]
    verts, faces = G.surface_nets(sdf, (-215.0, -48.0, -4.0), (106.0, 48.0, 218.0), h)
    verts = G.project(sdf, verts)
    verts = G.relax(sdf, verts, faces, rounds=cfg["model"]["relaxRounds"])
    log(f"body: {len(verts)} vertices, {len(faces)} quads in {time.perf_counter() - t0:.1f} s")
    bone_names = [b["name"] for b in rig["bones"]]
    weights, group, _ = G.skin_weights(parts, verts, bone_names)
    uv = G.belly_uv(verts, group)
    accent = G.accent_field(verts, group, rig)
    return parts, verts, faces, weights, uv, accent, bone_names


def attach_body(arm, verts, faces, weights, uv, accent, bone_names):
    obj = new_mesh_object("WalletWallaby.Body", verts, faces, arm)
    mesh = obj.data
    for j, bone in enumerate(bone_names):
        col = weights[:, j]
        idx = np.nonzero(col > 0)[0]
        if len(idx) == 0:
            continue
        g = obj.vertex_groups.new(name=bone)
        for w in np.unique(np.round(col[idx], 4)):
            sel = idx[np.round(col[idx], 4) == w]
            g.add(sel.tolist(), float(w), "REPLACE")
    # The belly's coordinates and the cream accent field, per corner / per vertex.
    uv_layer = mesh.uv_layers.new(name="belly")
    loops = np.zeros(len(mesh.loops), dtype=np.int64)
    mesh.loops.foreach_get("vertex_index", loops)
    uv_layer.data.foreach_set("uv", uv[loops].astype(np.float32).reshape(-1))
    attr = mesh.attributes.new("accent", "FLOAT", "POINT")
    attr.data.foreach_set("value", accent.astype(np.float32))
    return obj


# Mesh bounds (lane px) for each limb: x, y (depth) per side, z.
LIMB_BOUNDS = {
    "Forelimb": {"x": (-10.0, 66.0), "n": (-45.0, -10.0), "f": (10.0, 45.0), "z": (100.0, 162.0)},
    "Hindleg": {"x": (-50.0, 78.0), "n": (-40.0, 6.0), "f": (-6.0, 40.0), "z": (-4.0, 104.0)},
}


def build_limbs(arm, kind, limbs, bone_names, mats, outline_w, outline_mat):
    """Each paired limb: its own mesh, skinned to its bones, in the coat. Its outline over the body is an interior
    line (thinner on the near side, where it lies over the body)."""
    objs = []
    b = LIMB_BOUNDS[kind]
    for side, parts in limbs.items():
        def sdf(p, parts=parts):
            d = None
            for part in parts:
                v = part.fn(p)
                d = v if d is None else G.smin(d, v, part.blend)
            return G.smax(d, -p[:, 2], 2.0) if kind == "Hindleg" else d

        lo = (b["x"][0], b[side][0], b["z"][0])
        hi = (b["x"][1], b[side][1], b["z"][1])
        verts, faces = G.mesh_from_sdf(sdf, lo, hi, 0.9, 2)
        weights, _, _ = G.skin_weights(parts, verts, bone_names, temperature=2.0)
        o = new_mesh_object(f"WalletWallaby.{kind}_{side}", verts, faces, arm)
        for j, bone in enumerate(bone_names):
            idx = np.nonzero(weights[:, j] > 0)[0]
            if len(idx) == 0:
                continue
            g = o.vertex_groups.new(name=bone)
            for wv in np.unique(np.round(weights[idx, j], 4)):
                sel = idx[np.round(weights[idx, j], 4) == wv]
                g.add(sel.tolist(), float(wv), "REPLACE")
        o.data.uv_layers.new(name="belly").data.foreach_set("uv", np.full(len(o.data.loops) * 2, -4.0, dtype=np.float32))
        o.data.attributes.new("accent", "FLOAT", "POINT").data.foreach_set("value", np.full(len(verts), -10.0, dtype=np.float32))
        o.data.materials.append(mats["coat"])
        add_outline(o, outline_w * (0.7 if side == "n" else 1.0), outline_mat)
        objs.append(o)
    return objs


def cfg_ear_turn():
    """How far each ear's inner face turns forward from facing straight out to its side (degrees)."""
    return 34.0


def head_surface_depth(parts, x, z):
    """How far the head's near surface is from the mid-plane at (x, z): bisection along -Y on the head volumes."""
    head = [p for p in parts if p.group in ("head",)]

    def f(y):
        p = np.array([[x, y, z]])
        return min(float(p_.fn(p)[0]) for p_ in head)

    lo, hi = 0.0, -40.0
    for _ in range(60):
        mid = (lo + hi) / 2
        if f(mid) < 0:
            lo = mid
        else:
            hi = mid
    return -lo


def build_face_and_ears(arm, rig, parts, mats, outline_w, outline_mat):
    """The rigid parts: ears, eyes and glints, lids, brows, nose, chin, and the mouth's line."""
    objs = []
    eye_depth = head_surface_depth(parts, G.EYE["x"], G.EYE["z"]) - 2.4
    # Ears: leaf-shaped, cupped, riding their bones; the cream inner ear on the cup.
    ear_fn = G.ear_sdf()
    ev, ef = G.mesh_from_sdf(ear_fn, (-6.0, -10.0, -16.0), (70.0, 10.0, 16.0), 0.9)
    cup = ev[:, 1] < -0.4
    for side, sgn in (("n", -1.0), ("f", 1.0)):
        bone = arm.data.bones[f"ear_{side}"]
        head = bone.head_local / UNITS
        axis = (bone.tail_local - bone.head_local).normalized()
        # Ear frame: X along the bone; the cup (local -Y) faces out to its own side and a little forward.
        a = math.radians(cfg_ear_turn())
        n_out = Vector((math.sin(a), sgn * math.cos(a), 0.0))
        n_out = (n_out - axis * n_out.dot(axis)).normalized()
        ly = -n_out
        lz = axis.cross(ly).normalized()
        basis = Matrix((axis, ly, lz)).transposed()
        w = np.array([tuple(head + basis @ Vector(p)) for p in ev])
        accent = G.ear_inner(ev)
        o = new_mesh_object(f"WalletWallaby.Ear_{side}", w, ef, arm, [f"ear_{side}"])
        o.data.attributes.new("accent", "FLOAT", "POINT").data.foreach_set("value", accent.astype(np.float32))
        o.data.materials.append(mats["ear"] if side == "n" else mats["ear_far"])
        add_outline(o, outline_w * 0.8, outline_mat)
        objs.append(o)
    # Eyes (charcoal), set into the head, each with a cream glint, a coat lid, and a brow.
    for side, sgn in (("n", -1.0), ("f", 1.0)):
        c = (G.EYE["x"], sgn * eye_depth, G.EYE["z"])
        fn = lambda p, c=c: G.sd_ellipsoid(p, c, (7.2, 4.6, 7.8))
        v, f = G.mesh_from_sdf(fn, (c[0] - 9, c[1] - 7, c[2] - 9), (c[0] + 9, c[1] + 7, c[2] + 9), 0.45, 1)
        o = new_mesh_object(f"WalletWallaby.Eye_{side}", v, f, arm, [f"eye_{side}"])
        o.data.materials.append(mats["ink"])
        objs.append(o)
        g = (c[0] + 2.5, c[1] + sgn * 3.9, c[2] + 3.0)
        fn = lambda p, g=g: G.sd_ellipsoid(p, g, (2.2, 1.2, 2.2))
        v, f = G.mesh_from_sdf(fn, (g[0] - 3, g[1] - 3, g[2] - 3), (g[0] + 3, g[1] + 3, g[2] + 3), 0.25, 1)
        o = new_mesh_object(f"WalletWallaby.Glint_{side}", v, f, arm, [f"eye_{side}"])
        o.data.materials.append(mats["glint"])
        objs.append(o)
        # The lid: a coat shell over the eye's upper half; its bone turns it down over the eye as it closes.
        def lid_fn(p, c=c):
            shell = np.abs(G.sd_ellipsoid(p, c, (8.4, 5.4, 9.0))) - 0.55
            return G.smax(shell, -(p[:, 2] - c[2]) - 0.0, 0.6)

        v, f = G.mesh_from_sdf(lid_fn, (c[0] - 10, c[1] - 8, c[2] - 2), (c[0] + 10, c[1] + 8, c[2] + 10), 0.35, 1)
        o = new_mesh_object(f"WalletWallaby.Lid_{side}", v, f, arm, [f"lid_{side}"])
        o.data.materials.append(mats["lid"])
        objs.append(o)
        b = (c[0] + 0.5, c[1] + sgn * 1.8, c[2] + 13.8)
        fn = lambda p, b=b: G.sd_round_cone(p, (b[0] - 4.6, b[1], b[2] - 0.4), (b[0] + 4.6, b[1], b[2] + 0.3), 1.0, 0.85)
        v, f = G.mesh_from_sdf(fn, (b[0] - 7, b[1] - 3, b[2] - 3), (b[0] + 7, b[1] + 3, b[2] + 3), 0.3, 1)
        o = new_mesh_object(f"WalletWallaby.Brow_{side}", v, f, arm, [f"brow_{side}"])
        o.data.materials.append(mats["ink"])
        objs.append(o)
    # Claws: three short charcoal claws at each toe tip and two at each paw, riding their bones (as on the 2D rig).
    bones = {b["name"]: b for b in rig["bones"]}
    for side, sgn in (("n", -1.0), ("f", 1.0)):
        fb = bones[f"foot_{side}"]
        (hx, hy), (tx, ty) = fb["head"], fb["tail"]
        dx, dy = tx - hx, ty - hy
        tip = (tx + dx * 0.36, -(ty + dy * 0.36) - 0.4)
        for k in (-1, 0, 1):
            d = sgn * G.LEG_D + k * 3.4
            a = (tip[0] - 1.5, d, tip[1] + 1.2)
            b = (tip[0] + 4.6, d, tip[1] - 1.0)
            fn = lambda p, a=a, b=b: G.sd_round_cone(p, a, b, 1.25, 0.55)
            v, f = G.mesh_from_sdf(fn, (a[0] - 3, d - 3, a[2] - 4), (b[0] + 3, d + 3, a[2] + 4), 0.3, 1)
            o = new_mesh_object(f"WalletWallaby.Claw_{side}{k + 1}", v, f, arm, [f"foot_{side}"])
            o.data.materials.append(mats["ink"])
            objs.append(o)
        pb = bones[f"forearm_{side}"]
        (px, py) = pb["tail"]
        for k in (-1, 1):
            d = sgn * G.ARM_D + k * 2.2
            a = (px + 6.0, d, -py - 1.5)
            b = (px + 9.6, d, -py - 3.4)
            fn = lambda p, a=a, b=b: G.sd_round_cone(p, a, b, 1.0, 0.45)
            v, f = G.mesh_from_sdf(fn, (a[0] - 3, d - 3, b[2] - 3), (b[0] + 3, d + 3, a[2] + 3), 0.3, 1)
            o = new_mesh_object(f"WalletWallaby.PawClaw_{side}{k + 1}", v, f, arm, [f"forearm_{side}"])
            o.data.materials.append(mats["ink"])
            objs.append(o)
    # Nose: a round charcoal tip on the muzzle.
    fn = lambda p: G.sd_ellipsoid(p, (89.5, 0.0, 180.6), (5.0, 6.6, 5.2))
    v, f = G.mesh_from_sdf(fn, (85, -9, 173), (98, 9, 188), 0.4, 1)
    o = new_mesh_object("WalletWallaby.Nose", v, f, arm, ["head"])
    o.data.materials.append(mats["ink"])
    objs.append(o)
    # The chin (cream, on the jaw) tucked under the overhanging lip, and the mouth's dark interior above it.
    fn = lambda p: G.sd_round_cone(p, (54.0, 0.0, 167.0), (76.0, 0.0, 170.2), 6.2, 4.0) * 1.0
    fs = G.scaled(fn, 1.25)
    v, f = G.mesh_from_sdf(fs, (44, -12, 158), (84, 12, 178), 0.5, 1)
    o = new_mesh_object("WalletWallaby.Chin", v, f, arm, ["jaw"])
    o.data.materials.append(mats["chin"])
    add_outline(o, outline_w * 0.6, outline_mat)
    objs.append(o)
    fn = lambda p: G.sd_round_cone(p, (58.0, 0.0, 170.6), (80.0, 0.0, 172.4), 5.6, 3.2)
    v, f = G.mesh_from_sdf(G.scaled(fn, 1.2), (50, -10, 162), (86, 10, 180), 0.5, 1)
    o = new_mesh_object("WalletWallaby.Mouth", v, f, arm, ["head"])
    o.data.materials.append(mats["ink"])
    objs.append(o)
    return objs, eye_depth


# Canonical model identity: the same on every host. Each quantum is far coarser than the last-bit float noise that
# separates platforms (different libm and numpy builds) and far finer than anything a render can show.
Q_POSITION = 256  # per rig px: 1/256 px
Q_WEIGHT = 4096
Q_ATTRIBUTE = 256
Q_UV = 65536
Q_BONE = 1_000_000  # per Blender unit
Q_MATERIAL = 10_000_000


def _q(a, scale):
    return np.round(np.asarray(a, dtype=np.float64) * scale).astype(np.int64)


def canonical_model(arm, objects):
    """The model as canonical content: geometry quantized and ordered by position (not by generation order), faces
    rotated to their lowest vertex (winding kept) and sorted, weights, attributes and UVs quantized in that order,
    bones and constraints quantized. Two hosts that build the same source agree on this hash; their raw float
    realizations (realization_hash) may differ in the last bits."""
    h = hashlib.sha256()
    for o in sorted(objects, key=lambda x: x.name):
        me = o.data
        nv = len(me.vertices)
        co = np.zeros(nv * 3, dtype=np.float64)
        me.vertices.foreach_get("co", co)
        qco = _q(co.reshape(-1, 3) / UNITS, Q_POSITION)
        order = np.lexsort((np.arange(nv), qco[:, 2], qco[:, 1], qco[:, 0]))
        inv = np.empty(nv, dtype=np.int64)
        inv[order] = np.arange(nv)
        lv = np.zeros(len(me.loops), dtype=np.int64)
        me.loops.foreach_get("vertex_index", lv)
        starts = np.zeros(len(me.polygons), dtype=np.int64)
        totals = np.zeros(len(me.polygons), dtype=np.int64)
        me.polygons.foreach_get("loop_start", starts)
        me.polygons.foreach_get("loop_total", totals)
        # Each face's corners as loop indices, rotated to start at its lowest canonical vertex.
        faces = []
        for s, t in zip(starts.tolist(), totals.tolist()):
            loops = list(range(s, s + t))
            vs = [int(inv[lv[l]]) for l in loops]
            k = vs.index(min(vs))
            faces.append((tuple(vs[k:] + vs[:k]), loops[k:] + loops[:k]))
        faces.sort(key=lambda f: (len(f[0]), f[0]))
        corner_loops = np.array([l for _, ls in faces for l in ls], dtype=np.int64)
        h.update(f"object:{o.name}:{nv}:{len(faces)}".encode())
        h.update(qco[order].tobytes())
        h.update(np.array([v for vs, _ in faces for v in (len(vs), *vs)], dtype=np.int64).tobytes())
        # Weights per group, in canonical vertex order (0 where a vertex is not in the group).
        names = {g.index: g.name for g in o.vertex_groups}
        w = {g.name: np.zeros(nv) for g in o.vertex_groups}
        for v in me.vertices:
            for ge in v.groups:
                w[names[ge.group]][v.index] = ge.weight
        for name in sorted(w):
            h.update(f"group:{name}".encode())
            h.update(_q(w[name][order], Q_WEIGHT).tobytes())
        for a in sorted(me.attributes, key=lambda a: a.name):
            if a.name.startswith(".") or a.data_type != "FLOAT" or a.domain not in ("POINT", "CORNER"):
                continue
            buf = np.zeros(len(a.data), dtype=np.float64)
            a.data.foreach_get("value", buf)
            h.update(f"attr:{a.name}:{a.domain}".encode())
            h.update(_q(buf[order] if a.domain == "POINT" else buf[corner_loops], Q_ATTRIBUTE).tobytes())
        for uvl in sorted(me.uv_layers, key=lambda u: u.name):
            buf = np.zeros(len(uvl.data) * 2, dtype=np.float64)
            uvl.data.foreach_get("uv", buf)
            h.update(f"uv:{uvl.name}".encode())
            h.update(_q(buf.reshape(-1, 2)[corner_loops], Q_UV).tobytes())
        h.update(("materials:" + ",".join(m.name for m in me.materials)).encode())
        h.update(("modifiers:" + ",".join(f"{m.type}:{getattr(m, 'thickness', 0):.6f}" for m in o.modifiers)).encode())
    for b in sorted(arm.data.bones, key=lambda b: b.name):
        h.update(f"bone:{b.name}:{b.parent.name if b.parent else ''}".encode())
        h.update(_q([x for col in b.matrix_local.col for x in col], Q_BONE).tobytes())
    for pb in sorted(arm.pose.bones, key=lambda b: b.name):
        for c in pb.constraints:
            h.update(f"constraint:{pb.name}:{c.name}:{c.type}:{getattr(c, 'chain_count', 0)}".encode())
            if c.type == "IK":
                h.update(_q([math.degrees(c.pole_angle)], 1000).tobytes())
    return h.hexdigest()


def realization_hash(arm, objects):
    """This host's exact realization of the model: raw float32 geometry, weights, attributes, bones, constraints.
    Host-specific (last-bit float noise differs across platforms); recorded beside the canonical hash."""
    h = hashlib.sha256()
    summary = []
    for o in sorted(objects, key=lambda x: x.name):
        me = o.data
        co = np.zeros(len(me.vertices) * 3, dtype=np.float32)
        me.vertices.foreach_get("co", co)
        lv = np.zeros(len(me.loops), dtype=np.int32)
        me.loops.foreach_get("vertex_index", lv)
        h.update(o.name.encode())
        h.update(co.tobytes())
        h.update(lv.tobytes())
        for g in sorted(o.vertex_groups, key=lambda g: g.name):
            h.update(g.name.encode())
        for a in sorted(me.attributes, key=lambda a: a.name):
            if a.name.startswith(".") or a.domain not in ("POINT", "CORNER"):
                continue
            if a.data_type == "FLOAT":
                buf = np.zeros(len(a.data), dtype=np.float32)
                a.data.foreach_get("value", buf)
                h.update(a.name.encode())
                h.update(buf.tobytes())
        for uvl in me.uv_layers:
            buf = np.zeros(len(uvl.data) * 2, dtype=np.float32)
            uvl.data.foreach_get("uv", buf)
            h.update(uvl.name.encode())
            h.update(buf.tobytes())
        # Weights, vertex by vertex.
        for v in me.vertices:
            for ge in v.groups:
                h.update(np.array([v.index, ge.group, ge.weight], dtype=np.float32).tobytes())
        summary.append({"object": o.name, "vertices": len(me.vertices), "polygons": len(me.polygons), "materials": [m.name for m in me.materials]})
    for b in arm.data.bones:
        h.update(b.name.encode())
        h.update(np.array(list(b.matrix_local.col[0]) + list(b.matrix_local.col[1]) + list(b.matrix_local.col[2]) + list(b.matrix_local.col[3]), dtype=np.float32).tobytes())
    for pb in arm.pose.bones:
        for c in pb.constraints:
            h.update(f"{pb.name}:{c.name}:{c.type}".encode())
            if c.type == "IK":
                h.update(np.array([c.pole_angle, c.chain_count], dtype=np.float64).tobytes())
    return h.hexdigest(), summary


def material_hash(mats):
    h = hashlib.sha256()
    for name in sorted(mats):
        m = mats[name]
        h.update(name.encode())
        for n in sorted(m.node_tree.nodes, key=lambda n: n.name):
            h.update(f"{n.name}:{n.bl_idname}".encode())
            img = getattr(n, "image", None)
            if img is not None:
                px = np.zeros(len(img.pixels), dtype=np.float32)
                img.pixels.foreach_get(px)
                h.update(f"{img.size[0]}x{img.size[1]}".encode())
                h.update(_q(px, 65535).tobytes())
            for i in n.inputs:
                dv = getattr(i, "default_value", None)
                if dv is None:
                    continue
                try:
                    vals = list(dv)
                except TypeError:
                    vals = [dv]
                # Quantized: colour constants pass through libm (sRGB -> linear), which may differ in the last bit by host.
                h.update(_q([float(x) for x in vals if isinstance(x, (int, float))], Q_MATERIAL).tobytes())
        for l in sorted(m.node_tree.links, key=lambda l: (l.from_node.name, l.from_socket.identifier, l.to_node.name, l.to_socket.identifier)):
            h.update(f"{l.from_node.name}.{l.from_socket.identifier}>{l.to_node.name}.{l.to_socket.identifier}".encode())
    return h.hexdigest()


def main():
    job = job_from_argv()
    if job.get("schema") != "walletwall.blender-job/v1" or job.get("kind") != "build":
        fail("not a walletwall.blender-job/v1 build job")
    rig = job["rig"]
    cfg = job["config"]
    if rig.get("schema") != "walletwall.blender-rig/v1":
        fail("the rig export is not walletwall.blender-rig/v1")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    t0 = time.perf_counter()
    parts, verts, faces, weights, uv, accent, bone_names = build_body(rig, cfg)
    eye_depth = head_surface_depth(parts, G.EYE["x"], G.EYE["z"]) - 2.4
    arm = R.build_armature(rig, eye_depth)
    vis = cfg["visual"]
    # The coat is the rig contract's; its cream accents become the wall's warm stone (config/blender-visual.json): no white.
    pal = {**rig["palette"], "cream": vis["palette"]["accent"], "creamShade": vis["palette"]["accentShade"]}
    band = cfg["materials"]["lightBand"]
    field = M.brick_field_image()
    mats = {
        "coat": M.body_material(pal, band, field),
        "ear": M.two_tone_material("walletwallaby.ear", pal["coat"], pal["coatShade"], band, pal["cream"], pal["creamShade"]),
        "ear_far": M.two_tone_material("walletwallaby.ear_far", pal["coat"], pal["coatShade"], band),
        "chin": M.two_tone_material("walletwallaby.chin", pal["cream"], pal["creamShade"], band),
        "lid": M.two_tone_material("walletwallaby.lid", pal["coat"], pal["coatShade"], band),
        "ink": M.flat_material("walletwallaby.ink", pal["ink"]),
        "glint": M.flat_material("walletwallaby.glint", vis["palette"]["glint"]),
    }
    outline = M.outline_material(pal["ink"])
    shadow = M.shadow_material(vis["contactShadow"])
    w = cfg["outline"]["widthPx"]
    body = attach_body(arm, verts, faces, weights, uv, accent, bone_names)
    body.data.materials.append(mats["coat"])
    add_outline(body, w, outline)
    small, _ = build_face_and_ears(arm, rig, parts, mats, w, outline)
    small += build_limbs(arm, "Forelimb", G.build_forelimbs(rig), bone_names, mats, w, outline)
    small += build_limbs(arm, "Hindleg", G.build_hindlegs(rig), bone_names, mats, w, outline)
    # The contact shadow: a soft charcoal ellipse at the feet, facing the camera, behind the body.
    cs = vis["contactShadow"]
    bpy.ops.mesh.primitive_circle_add(vertices=64, radius=1.0, fill_type="NGON", location=(0, 0, 0))
    disc = bpy.context.active_object
    disc.name = "WalletWallaby.ContactShadow"
    disc.rotation_euler = (math.pi / 2, 0, 0)
    disc.scale = (cs["widthPx"] * UNITS / 2, cs["heightPx"] * UNITS / 2, 1)
    disc.location = (cs["centerPx"][0] * UNITS, cs["depthPx"] * UNITS, -cs["centerPx"][1] * UNITS)
    disc.parent = arm
    disc.data.materials.append(shadow)
    disc.visible_shadow = False
    targets = R.build_ik(arm, rig)
    model_sha = canonical_model(arm, [body] + small)
    realization_sha, summary = realization_hash(arm, [body] + small)
    mats_all = dict(mats)
    mats_all["outline"] = outline
    mats_all["shadow"] = shadow
    mats_sha = material_hash(mats_all)
    blend = out_path(job["outputs"]["blend"])
    bpy.ops.wm.save_as_mainfile(filepath=str(blend), compress=False, check_existing=False)
    manifest = {
        "schema": "walletwall.blender-model/v1",
        "modelVersion": LANE_VERSION["model"],
        "materialsVersion": LANE_VERSION["materials"],
        "modelSha256": model_sha,
        "modelRealizationSha256": realization_sha,
        "canonicalQuanta": {"positionPerPx": Q_POSITION, "weight": Q_WEIGHT, "attribute": Q_ATTRIBUTE, "uv": Q_UV, "bonePerUnit": Q_BONE, "material": Q_MATERIAL},
        "materialsSha256": mats_sha,
        "blenderVersion": bpy.app.version_string,
        "blenderBuildHash": bpy.app.build_hash.decode() if isinstance(bpy.app.build_hash, bytes) else str(bpy.app.build_hash),
        "objects": summary,
        "bones": [b.name for b in arm.data.bones],
        "ikTargets": sorted(targets),
        "eyeDepthPx": round(eye_depth, 6),
        "buildSeconds": round(time.perf_counter() - t0, 3),
    }
    out_path(job["outputs"]["manifest"]).write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    log(f"built {blend.name}: model {model_sha[:12]}, materials {mats_sha[:12]}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001 - report and exit non-zero (--python-exit-code)
        print(f"[walletwallaby] build failed: {e}", file=sys.stderr, flush=True)
        raise
