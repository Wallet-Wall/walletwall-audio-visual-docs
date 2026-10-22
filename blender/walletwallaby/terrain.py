# SPDX-License-Identifier: GPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 WalletWall
#
# This file uses the Blender Python API, so it is licensed GPL-3.0-or-later.
# The rest of this repository is MIT; see docs/LICENSING.md.
"""The declared terrain, as geometry (walletwall.blender-terrain/v1).

Each block is a declared element of the scene (a card, a graph node, the summit
ledge, the ground): its front face is the rectangle Remotion draws on the
teaching plane, and it extends back into depth. Its top is the surface the
support judge graded, under the same id. Nothing is inferred from pixels, and a
drawn route is shown only as a thin non-contact line: it is information, never
terrain.

Seen in depth, every block is stratified rock: layers of warm stone stacked from
a worn cap stone down, each layer its own thickness, colour, inset from the block's
sides, and setback at the back, all chosen by a hash of the block's own id (the
same block is always the same rock; nothing is random). The layers use the
character's own two-tone light and charcoal edge, so the terrain and the body
read as one made world. The palette comes from config.visual (brand tokens).

Used by the depth views: the contact sheet (a perspective look at the real
support under every stand) and the signature 2D -> 3D transition.
"""

import hashlib
import math

import bpy
from mathutils import Vector

from common import UNITS, deg, fail
import materials as M

SUPPORTING = ("SUPPORTED_SURFACE", "LEDGE", "NARROW_LEDGE")


def unit_hash(seed, *parts):
    """A deterministic number in [0, 1) from ids: the only 'variation' the terrain has."""
    digest = hashlib.sha256(":".join(str(p) for p in (seed, *parts)).encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big") / float(1 << 64)


def lerp_range(rng, u):
    return rng[0] + (rng[1] - rng[0]) * u


def strata_plan(vis, key, height_px, supporting):
    """The block's layers from the top down: [{top, bottom (px below the block's top), layer, cap, setback, and each end's
    inset at the layer's top and bottom edge (px): a layer whose top and bottom insets differ has a slanted, fractured end}].

    A supporting block opens with a thin cap stone (its top, where feet land); the rest are layers of rock whose
    thickness, colour, side inset and back setback come from the hash of `key`. The last layer takes the remainder
    (merged into the one above when it would be a sliver)."""
    st = vis["terrain"]["strata"]
    n = len(st["layers"])
    lo, hi = st["bandPx"]
    seed = st["seed"]
    plan = []
    cursor = 0.0
    if supporting:
        cap = min(st["capPx"], height_px)
        # The cap is flush with the card at its top (the surface feet land on) and breaks in a little below.
        plan.append({"top": 0.0, "bottom": cap, "layer": -1, "cap": True, "setback": 0.0,
                     "l_top": 0.0, "r_top": 0.0,
                     "l_bot": lerp_range((0.0, st["insetPx"][1] * 0.5), unit_hash(seed, key, "cap", "l")),
                     "r_bot": lerp_range((0.0, st["insetPx"][1] * 0.5), unit_hash(seed, key, "cap", "r"))})
        cursor = cap
    i = 0
    prev = -1
    while cursor < height_px - 1e-6:
        band = lerp_range((lo, hi), unit_hash(seed, key, i, "band"))
        bottom = cursor + band
        if height_px - bottom < lo:
            bottom = height_px
        bottom = min(bottom, height_px)
        layer = int(unit_hash(seed, key, i, "layer") * n) % n
        if layer == prev:
            layer = (layer + 1) % n
        prev = layer
        plan.append({
            "top": cursor,
            "bottom": bottom,
            "layer": layer,
            "cap": False,
            "l_top": lerp_range(st["insetPx"], unit_hash(seed, key, i, "lt")),
            "r_top": lerp_range(st["insetPx"], unit_hash(seed, key, i, "rt")),
            "l_bot": lerp_range(st["insetPx"], unit_hash(seed, key, i, "lb")),
            "r_bot": lerp_range(st["insetPx"], unit_hash(seed, key, i, "rb")),
            "setback": lerp_range(st["setbackPx"], unit_hash(seed, key, i, "back")),
        })
        cursor = bottom
        i += 1
    return plan


def _stratum_mesh(name, x_bot, x_top, zb, zt, y0, y1, faces):
    """An open prism: only the faces asked for (front = toward the camera, at y0; back at y1). x_bot / x_top are the
    (left, right) x of its lower and upper edge, so an end can slant."""
    me = bpy.data.meshes.new(name)
    (xlb, xrb), (xlt, xrt) = x_bot, x_top
    v = [(xlb, y0, zb), (xrb, y0, zb), (xrb, y1, zb), (xlb, y1, zb), (xlt, y0, zt), (xrt, y0, zt), (xrt, y1, zt), (xlt, y1, zt)]
    quads = {"front": (0, 1, 5, 4), "right": (1, 2, 6, 5), "back": (2, 3, 7, 6), "left": (3, 0, 4, 7), "top": (4, 5, 6, 7), "bottom": (3, 2, 1, 0)}
    me.from_pydata(v, [], [quads[f] for f in faces])
    me.update()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return o


class StrataKit:
    """The materials for one set of blocks (shared by every block in it) and the builder that stacks their rock.

    `wrap(material)` may post-process each material (the transition routes its surfaces through a dissolve); every
    material the kit made is in `.materials` so the caller can address them."""

    def __init__(self, vis, band, tag, wrap=None):
        self.vis = vis
        t = vis["terrain"]
        wrap = wrap or (lambda m: m)
        self.layers = [wrap(M.two_tone_material(f"{tag}.stratum{i}", l["lit"], l["shade"], band)) for i, l in enumerate(t["strata"]["layers"])]
        self.cap = wrap(M.two_tone_material(f"{tag}.cap", t["top"], t["topShade"], band))
        self.outline = wrap(M.outline_material(t["edge"]))
        self.materials = [*self.layers, self.cap, self.outline]

    def build(self, name, key, x0, x1, ztop, zbot, y0, y1, supporting, faces):
        """Stack the block's strata (frame-space bounds in Blender units) and return its objects, top first."""
        t = self.vis["terrain"]
        height_px = (ztop - zbot) / UNITS
        objs = []
        plan = strata_plan(self.vis, key, height_px, supporting)
        for k, s in enumerate(plan):
            zt = ztop - s["top"] * UNITS
            zb = ztop - s["bottom"] * UNITS
            x_bot = (x0 + s["l_bot"] * UNITS, x1 - s["r_bot"] * UNITS)
            x_top = (x0 + s["l_top"] * UNITS, x1 - s["r_top"] * UNITS)
            back = y1 - s["setback"] * UNITS
            if min(x_bot[1] - x_bot[0], x_top[1] - x_top[0]) < 0.02 or back - y0 < 0.02:
                fail(f"stratum {k} of {key} collapsed: the block is too small for its strata")
            # Only the lowest layer keeps a bottom face; a lower layer's top shows where the one above is inset or set back.
            keep = [f for f in faces if not (f == "bottom" and k < len(plan) - 1)]
            o = _stratum_mesh(f"{name}.s{k}", x_bot, x_top, zb, zt, y0, back, keep)
            o.data.materials.append(self.cap if s["cap"] else self.layers[s["layer"]])
            o.data.materials.append(self.outline)
            mod = o.modifiers.new("outline", "SOLIDIFY")
            mod.thickness = t["edgePx"] * UNITS
            mod.offset = 1.0
            mod.use_flip_normals = True
            mod.use_rim = False
            mod.material_offset = 1
            objs.append(o)
        return objs


class TerrainScene:
    def __init__(self, doc, style, cfg):
        if doc.get("schema") != "walletwall.blender-terrain/v1":
            fail("terrain is not walletwall.blender-terrain/v1")
        vis = cfg["visual"]
        t = vis["terrain"]
        style = style or {}
        self.depth = style.get("depthPx", t["depthPx"])
        band = cfg["materials"]["lightBand"]
        kit = StrataKit(vis, band, "terrain")
        mat_line = M.flat_material("terrain.line", t["line"])
        self.segments = {}
        for seg in doc["segments"]:
            objs = []
            for b in seg["blocks"]:
                x0, x1 = (b["x0"] - 960) * UNITS, (b["x1"] - 960) * UNITS
                ztop, zbot = (540 - b["y0"]) * UNITS, (540 - b["y1"]) * UNITS
                if b["element"] == "ground":
                    x0, x1 = (-400 - 960) * UNITS, (2320 - 960) * UNITS
                supporting = b["top"] in SUPPORTING
                objs += kit.build(f"terrain.{seg['segment']}.{b['element']}", f"{seg['segment']}:{b['element']}", x0, x1, ztop, zbot, 0.0, self.depth * UNITS, supporting, ["front", "right", "back", "left", "top", "bottom"])
            for ln in seg["lines"]:
                a = Vector(((ln["x0"] - 960) * UNITS, 0.0, (540 - ln["y0"]) * UNITS))
                c = Vector(((ln["x1"] - 960) * UNITS, 0.0, (540 - ln["y1"]) * UNITS))
                d = c - a
                if d.length < 1e-6:
                    continue
                bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=1.2 * UNITS, depth=d.length, location=(a + c) / 2)
                cyl = bpy.context.active_object
                cyl.name = f"terrain.{seg['segment']}.{ln['id']}"
                cyl.rotation_mode = "QUATERNION"
                cyl.rotation_quaternion = d.to_track_quat("Z", "Y")
                cyl.data.materials.append(mat_line)
                cyl.visible_shadow = False
                objs.append(cyl)
            self.segments[seg["segment"]] = objs
        self.show(None)

    def show(self, segment):
        for sid, objs in self.segments.items():
            for o in objs:
                o.hide_render = sid != segment


def support_spans(terrain_doc):
    """{(segment, surface id): (x0, x1)} in world X (Blender units): the horizontal extent of the declared block each
    supporting surface belongs to. The ground, which has no horizontal limit on the stage, spans the whole stage."""
    spans = {}
    if not terrain_doc:
        return spans
    for seg in terrain_doc["segments"]:
        for b in seg["blocks"]:
            x0, x1 = b["x0"], b["x1"]
            if b["element"] == "ground":
                x0, x1 = -400.0, 2320.0
            for sid in b["surfaceIds"]:
                spans[(seg["segment"], sid)] = ((x0 - 960) * UNITS, (x1 - 960) * UNITS)
    return spans


def perspective_camera(cfg, spec, name):
    """A perspective camera aimed at a frame-px point on the plane at a depth, from an elevation and azimuth."""
    data = bpy.data.cameras.new(name)
    data.type = "PERSP"
    data.lens = spec.get("lensMm", 50.0)
    data.sensor_width = 36.0
    data.sensor_fit = "HORIZONTAL"
    data.clip_start = 0.05
    data.clip_end = 500.0
    cam = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(cam)
    tx, ty = spec["target"]
    target = Vector(((tx - 960) * UNITS, spec.get("depthPx", 0.0) * UNITS, (540 - ty) * UNITS))
    dist = spec["distancePx"] * UNITS
    el, az = deg(spec.get("elevationDeg", 15.0)), deg(spec.get("azimuthDeg", 0.0))
    offset = Vector((dist * math.cos(el) * math.sin(az), -dist * math.cos(el) * math.cos(az), dist * math.sin(el)))
    cam.location = target + offset
    cam.rotation_mode = "QUATERNION"
    cam.rotation_quaternion = (target - cam.location).to_track_quat("-Z", "Y")
    return cam
