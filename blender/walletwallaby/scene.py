# SPDX-License-Identifier: GPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 WalletWall
#
# This file uses the Blender Python API, so it is licensed GPL-3.0-or-later.
# The rest of this repository is MIT; see docs/LICENSING.md.
"""Render settings, light, and cameras, from the pinned config (config/blender.json).

Colour management is `Standard` with no look, exposure 0, gamma 1, and no
dither: an emitted brand colour lands in the PNG as exactly that colour. The
film is transparent (Remotion composites the frames). EEVEE, no ray tracing,
no motion blur, no bloom: a clean stylised render that is a function of the
scene alone.

Cameras: the teaching view is orthographic and looks straight along +Y at the
teaching plane, 1920 px wide, so a frame px lands on the same frame px Remotion
draws (the 2.5D contract). Depth views (the contact view, the signature
transition) are perspective cameras built from the same plane.
"""

import math

import bpy
from mathutils import Euler, Vector

from common import UNITS, deg, fail, hex_to_linear


def apply_render_settings(cfg, resolution=None):
    r = cfg["render"]
    scene = bpy.context.scene
    if r["engine"] != "BLENDER_EEVEE":
        fail(f"engine {r['engine']} is not the pinned EEVEE")
    scene.render.engine = r["engine"]
    w, h = resolution or r["resolution"]
    scene.render.resolution_x = w
    scene.render.resolution_y = h
    scene.render.resolution_percentage = 100
    scene.render.pixel_aspect_x = 1
    scene.render.pixel_aspect_y = 1
    scene.render.fps = r["fps"]
    scene.render.fps_base = 1.0
    scene.render.film_transparent = r["film"]["transparent"]
    scene.render.filter_size = r["film"]["filterSizePx"]
    scene.render.dither_intensity = r["ditherIntensity"]
    scene.render.use_motion_blur = False
    scene.render.use_border = False
    scene.render.use_crop_to_border = False
    scene.render.use_compositing = False
    scene.render.use_sequencer = False
    scene.render.threads_mode = "FIXED"
    scene.render.threads = r["threads"]
    ee = scene.eevee
    ee.taa_render_samples = r["samples"]
    ee.use_raytracing = r["raytracing"]
    ee.use_shadows = r["shadows"]["enabled"]
    ee.shadow_ray_count = r["shadows"]["rayCount"]
    ee.shadow_step_count = r["shadows"]["stepCount"]
    ee.shadow_resolution_scale = r["shadows"]["resolutionScale"]
    if hasattr(ee, "use_overscan"):
        ee.use_overscan = False
    cm = r["colorManagement"]
    scene.display_settings.display_device = cm["display"]
    scene.view_settings.view_transform = cm["view"]
    scene.view_settings.look = cm["look"]
    scene.view_settings.exposure = cm["exposure"]
    scene.view_settings.gamma = cm["gamma"]
    scene.view_settings.use_curve_mapping = False
    scene.sequencer_colorspace_settings.name = cm["sequencer"]
    img = scene.render.image_settings
    img.file_format = r["output"]["format"]
    img.color_mode = r["output"]["colorMode"]
    img.color_depth = str(r["output"]["colorDepth"])
    img.compression = r["output"]["compression"]
    scene.render.use_file_extension = True
    scene.render.use_overwrite = True
    scene.render.use_placeholder = False
    scene.render.use_stamp = False
    scene.render.metadata_input = "SCENE"
    for k in ("use_stamp_date", "use_stamp_time", "use_stamp_render_time", "use_stamp_frame", "use_stamp_frame_range", "use_stamp_memory", "use_stamp_hostname", "use_stamp_camera", "use_stamp_lens", "use_stamp_scene", "use_stamp_marker", "use_stamp_filename", "use_stamp_sequencer_strip", "use_stamp_note"):
        if hasattr(scene.render, k):
            setattr(scene.render, k, False)


def build_world_and_light(cfg):
    """A flat neutral world (the ambient the shade band reads) and one sun from the upper left, in front."""
    L = cfg["lighting"]
    world = bpy.data.worlds.new("walletwallaby.world")
    bpy.context.scene.world = world
    if hasattr(world, "use_nodes") and not world.use_nodes:
        world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg is None:
        bg = world.node_tree.nodes.new("ShaderNodeBackground")
        out = world.node_tree.nodes.get("World Output") or world.node_tree.nodes.new("ShaderNodeOutputWorld")
        world.node_tree.links.new(bg.outputs[0], out.inputs[0])
    bg.inputs["Color"].default_value = (1, 1, 1, 1)
    bg.inputs["Strength"].default_value = L["ambient"]
    sun_data = bpy.data.lights.new("walletwallaby.key", "SUN")
    sun_data.energy = L["sunStrength"]
    sun_data.angle = deg(L["sunAngleDeg"])
    sun_data.color = (1, 1, 1)
    if hasattr(sun_data, "use_shadow"):
        sun_data.use_shadow = True
    if hasattr(sun_data, "shadow_jitter"):
        sun_data.shadow_jitter = False
    sun = bpy.data.objects.new("walletwallaby.key", sun_data)
    bpy.context.scene.collection.objects.link(sun)
    d = Vector(L["sunDirection"]).normalized()
    sun.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    return sun


def teaching_camera(cfg, name="walletwallaby.teaching"):
    """Orthographic, looking along +Y at the teaching plane; 1920 frame px across."""
    cam_data = bpy.data.cameras.new(name)
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = cfg["render"]["resolution"][0] * UNITS
    cam_data.sensor_fit = "HORIZONTAL"
    cam_data.clip_start = 1.0
    cam_data.clip_end = 200.0
    cam = bpy.data.objects.new(name, cam_data)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = (0.0, -60.0, 0.0)
    cam.rotation_euler = (math.pi / 2, 0.0, 0.0)
    bpy.context.scene.camera = cam
    return cam


def framing_camera(cfg, center_px, width_px, name="walletwallaby.framing"):
    """An orthographic close-up of a region of the teaching plane: frame-px centre and width."""
    cam = teaching_camera(cfg, name)
    cam.data.ortho_scale = width_px * UNITS
    cam.location = ((center_px[0] - 960) * UNITS, -60.0, (540 - center_px[1]) * UNITS)
    return cam


def presentation_yaw(cfg, clips):
    """How far the body turns toward the camera (radians): toward the viewer while it holds and teaches (the belly's
    wall and the face read in volume), toward profile while it travels (the tail and the line of the hop read long).
    A fixed blend of the frame's own key-pose weights, which Motion Intelligence already blends smoothly in time."""
    p = cfg["presentation"]
    travel = sum(p["travelWeights"].get(clip, 0.0) * w for clip, w in (clips or {}).items())
    travel = min(1.0, max(0.0, travel))
    return deg(p["yawTeachDeg"] + (p["yawTravelDeg"] - p["yawTeachDeg"]) * travel)


def place_character(arm, cfg, x, y, scale, facing, depth_px=0.0, clips=None, yaw_override_deg=None):
    """The coordinate contract: the armature's origin (the feet) at frame px (x, y), mirrored by facing, scaled,
    and turned toward the camera by the presentation yaw (about the feet, so no contact moves). The override exists
    for review turnarounds only; lesson renders never set it."""
    yaw = presentation_yaw(cfg, clips) if yaw_override_deg is None else deg(yaw_override_deg)
    arm.location = ((x - 960) * UNITS, depth_px * UNITS, (540 - y) * UNITS)
    arm.rotation_mode = "XYZ"
    arm.rotation_euler = Euler((0.0, 0.0, -yaw * facing), "XYZ")
    arm.scale = (facing * scale, scale, scale)
