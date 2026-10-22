# SPDX-License-Identifier: GPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 WalletWall
#
# This file uses the Blender Python API, so it is licensed GPL-3.0-or-later.
# The rest of this repository is MIT; see docs/LICENSING.md.
"""The 2D -> 3D signature transition: the diagram reveals that it always had depth.

A reusable primitive (`depth-reveal`). Its inputs are two teaching surfaces as
Remotion drew them (lossless characterless frames, staged by the orchestrator
into the job's own directory) and each surface's declared terrain. Blender
renders no typography: every pixel of text, card, and route is Remotion's,
projected from the teaching view onto the declared blocks' front faces and onto
a paper sheet behind them. Seen orthographically, the scene is therefore exactly
the flat frame. Then one closed-form camera move (a function of t alone):

  1. the camera dollies in while its lens widens (the frame keeps its size), and
     rises a little: the blocks stand out from the sheet with real depth;
  2. the sheet dissolves, revealing the next lesson surface laid out deeper;
  3. the camera travels to it and settles, orthographic again, on exactly the
     frame Remotion draws next.

No glow, no portal, no particles, no shake: parallax, a dolly, and a dissolve.
"""

import math
from pathlib import Path

import bpy
from mathutils import Vector

import terrain as T
from common import JOBS_ROOT, UNITS, deg, fail, within


def smooth(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def _projected_mesh(name, quads, mat, uv_of):
    """A mesh of quads (lane BU vertices) whose UVs are each vertex's position in the teaching view."""
    me = bpy.data.meshes.new(name)
    verts, faces = [], []
    for q in quads:
        base = len(verts)
        verts.extend(q)
        faces.append(tuple(range(base, base + 4)))
    me.from_pydata(verts, [], faces)
    uvl = me.uv_layers.new(name="teaching")
    for poly in me.polygons:
        for li in poly.loop_indices:
            uvl.data[li].uv = uv_of(Vector(verts[me.loops[li].vertex_index]))
    me.update()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    o.data.materials.append(mat)
    return o


def _image_material(name, image):
    """Emits the image's own pixels, unlit: seen flat, the surface is exactly Remotion's frame."""
    mat = bpy.data.materials.new(name)
    if hasattr(mat, "use_nodes") and not mat.use_nodes:
        mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    uv = nt.nodes.new("ShaderNodeUVMap")
    uv.uv_map = "teaching"
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = image
    # Filtered: a projected surface seen in motion must not shimmer (nearest sampling aliases text as it turns).
    tex.interpolation = "Linear"
    tex.extension = "EXTEND"
    nt.links.new(uv.outputs["UV"], tex.inputs["Vector"])
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Strength"].default_value = 1.0
    nt.links.new(tex.outputs["Color"], em.inputs["Color"])
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    return mat


def _with_fade(mat, method="BLENDED"):
    """Route a material's surface through a dissolve (`fade` node input 0: 1 = opaque, 0 = gone).

    BLENDED sorts whole objects, which is right for the flat sheets; the rock behind a dissolving card uses DITHERED
    (stochastic, resolved per pixel by depth), so a card in front of it is never drawn under it."""
    nt = mat.node_tree
    out = next(n for n in nt.nodes if n.bl_idname == "ShaderNodeOutputMaterial")
    src = out.inputs["Surface"].links[0].from_socket
    nt.links.remove(out.inputs["Surface"].links[0])
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    mix.name = "fade"
    mix.inputs[0].default_value = 1.0
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(src, mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    if hasattr(mat, "surface_render_method"):
        mat.surface_render_method = method
    return mat


def _load_image(rel):
    path = (JOBS_ROOT / rel).resolve()
    if path.suffix != ".png" or not within(path, JOBS_ROOT) or not path.exists():
        fail(f"transition layer image {rel!r} must be a staged .png inside dist/blender/jobs")
    img = bpy.data.images.load(str(path), check_existing=False)
    img.colorspace_settings.name = "sRGB"
    return img


class DepthReveal:
    def __init__(self, spec, terrain_doc, cfg):
        self.spec = spec
        self.cfg = cfg
        segs = {s["segment"]: s for s in terrain_doc["segments"]}
        band = cfg["materials"]["lightBand"]
        vis = cfg["visual"]
        W, H = cfg["render"]["resolution"]

        def uv_of(v):
            return ((v.x / UNITS + 960.0) / W, (v.z / UNITS + 540.0) / H)

        self.fades = []
        self.rock_fades = []
        for k, layer in enumerate(spec["layers"]):
            img = _load_image(layer["image"])
            y0 = layer["depthPx"] * UNITS
            d = layer["blockDepthPx"] * UNITS
            seg = layer["segment"]
            face_mat = _with_fade(_image_material(f"reveal.{seg}.faces", img))
            sheet_mat = _with_fade(_image_material(f"reveal.{seg}.sheet", img))
            # The rock under each block: stratified, in the character's own light and edge (terrain.StrataKit).
            kit = T.StrataKit(vis, band, f"reveal.{seg}", wrap=lambda m: _with_fade(m, "DITHERED"))
            # The outgoing surface (layer 0) dissolves as one; the deeper one stays.
            if k == 0:
                self.fades += [face_mat, sheet_mat]
                self.rock_fades += kit.materials
            # The sheet: the whole teaching surface, behind the blocks, a little larger than the frame.
            m = 400 * UNITS
            x0, x1 = -W / 2 * UNITS - m, W / 2 * UNITS + m
            z0, z1 = -H / 2 * UNITS - m, H / 2 * UNITS + m
            ys = y0 + d
            sheet = _projected_mesh(f"reveal.{layer['segment']}.sheet", [[(x0, ys, z0), (x1, ys, z0), (x1, ys, z1), (x0, ys, z1)]], sheet_mat, uv_of)
            sheet.visible_shadow = False
            for b in segs[seg]["blocks"]:
                if b["element"] == "ground":
                    continue
                bx0, bx1 = (b["x0"] - 960) * UNITS, (b["x1"] - 960) * UNITS
                bz0, bz1 = (540 - b["y1"]) * UNITS, (540 - b["y0"]) * UNITS
                # Front face: Remotion's own pixels for this element; sides and top: the theme's solid colours.
                _projected_mesh(f"reveal.{layer['segment']}.{b['element']}.front", [[(bx0, y0, bz0), (bx1, y0, bz0), (bx1, y0, bz1), (bx0, y0, bz1)]], face_mat, uv_of)
                # Sides, top, and underside only: the front face is the projected frame above, never a second surface.
                kit.build(f"reveal.{layer['segment']}.{b['element']}", f"{seg}:{b['element']}", bx0, bx1, bz1, bz0, y0, ys, b["top"] in T.SUPPORTING, ["right", "left", "top", "bottom"])
        cam_data = bpy.data.cameras.new("reveal.camera")
        cam_data.sensor_width = 36.0
        cam_data.sensor_fit = "HORIZONTAL"
        self.cam = bpy.data.objects.new("reveal.camera", cam_data)
        bpy.context.scene.collection.objects.link(self.cam)

    def at(self, t):
        """Pose the camera and the dissolve for t in [0, 1]. Closed form: no state from any other t."""
        c = self.spec["camera"]
        W = self.cfg["render"]["resolution"][0] * UNITS
        a, b = self.spec["layers"][0], self.spec["layers"][1]
        # The focus travels from the first surface to the second once the dissolve is under way.
        travel = smooth((t - c["travelFrom"]) / (c["travelTo"] - c["travelFrom"]))
        fy = (a["depthPx"] + (b["depthPx"] - a["depthPx"]) * travel) * UNITS
        fx = ((c["focusA"][0] + (c["focusB"][0] - c["focusA"][0]) * travel) - 960) * UNITS
        fz = (540 - (c["focusA"][1] + (c["focusB"][1] - c["focusA"][1]) * travel)) * UNITS
        # How far the view leaves the flat plane: 0 at both ends (orthographic in effect), 1 at the middle.
        bump = smooth(t / c["revealBy"]) * (1.0 - smooth((t - c["settleFrom"]) / (1.0 - c["settleFrom"])))
        dist = math.exp(math.log(c["flatDistance"]) + (math.log(c["nearDistance"]) - math.log(c["flatDistance"])) * bump) * W
        el = deg(c["elevationDeg"]) * bump
        az = deg(c["azimuthDeg"]) * bump
        focus = Vector((fx, fy, fz))
        # The frame keeps its width at the focus plane: the lens widens exactly as the camera closes in.
        # The plane through the focus is framed W wide; the camera looks at the focus from (el, az).
        offset = Vector((dist * math.cos(el) * math.sin(az), -dist * math.cos(el) * math.cos(az), dist * math.sin(el)))
        self.cam.location = focus + offset
        self.cam.rotation_mode = "QUATERNION"
        self.cam.rotation_quaternion = (-offset).to_track_quat("-Z", "Y")
        self.cam.data.lens = 36.0 * dist / W
        self.cam.data.clip_start = max(0.05, dist - 40.0)
        self.cam.data.clip_end = dist + 60.0
        fade = 1.0 - smooth((t - c["dissolveFrom"]) / (c["dissolveTo"] - c["dissolveFrom"]))
        for m in self.fades:
            m.node_tree.nodes["fade"].inputs[0].default_value = fade
        # The rock goes first: behind a dissolving card its layers would otherwise show through the card's own text.
        for m in self.rock_fades:
            m.node_tree.nodes["fade"].inputs[0].default_value = fade**3
        bpy.context.scene.camera = self.cam
        return {"bump": bump, "travel": travel, "fade": fade, "lensMm": self.cam.data.lens}
