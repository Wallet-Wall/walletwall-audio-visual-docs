"""WalletWallaby's materials: emblematic flat colour, given volume by light.

Every surface is an exact brand colour. Light never tints it: the diffuse light a
point receives only chooses which of two tones it shows (the lit colour, or the
rig's own shade, derived 20% toward charcoal), so the lit coat is exactly
WalletWallrus's coat and the cream exactly the brand cream, as on the 2D rig. No
gloss, no fur, no gradients: a cel-shaded emblem with a charcoal outline.

The brick belly is the WalletWall wall built into the stomach: courses of bricks
in the coat's own colour, laid level in running bond around the belly's round
front, marked out only by charcoal mortar set into shallow grooves. The field is
centred on the front of the belly, widest low, its courses racked back at the
sides (each course ends on its own joint), with no border; it never wraps into
the flank. The mortar map is generated here from those rules (numpy, exact).
"""

import math

import bpy
import numpy as np

from common import hex_to_linear
from geometry import BELLY_FIELD

# ── The brick field (px on the belly: u = arc length from the front centre, v = height) ──

BRICK = 27.0
COURSE = 13.5
# Bed joints, bottom to top. The lowest course has no bed under it: it runs down under the belly, its head joints
# fading out, so the wall has no bottom edge.
BEDS = (77.0, 90.5, 104.0, 117.5, 131.0)
# Each course's half-extent from the front centre (px of arc at the belly's radius), bottom course first. Even
# courses have head joints at 0, +-27; odd courses at +-13.5, +-40.5 (running bond). As on WalletWallrus's wall, the
# ends alternate a three-quarter bat and a whole joint, so each side is a toothed edge, never a straight border, and
# no bat is a sliver (about 71 and 61 degrees either side of the front).
ENDS = (47.25, 40.5, 47.25, 40.5)
MORTAR_HALF = 1.6
BOTTOM_FADE = 7.0
TEXELS_PER_PX = 12


def brick_field_image(name="walletwallaby.belly"):
    f = BELLY_FIELD
    w = int(round((f["u1"] - f["u0"]) * TEXELS_PER_PX))
    h = int(round((f["v1"] - f["v0"]) * TEXELS_PER_PX))
    u = f["u0"] + (np.arange(w) + 0.5) / TEXELS_PER_PX
    v = f["v0"] + (np.arange(h) + 0.5) / TEXELS_PER_PX
    U, V = np.meshgrid(u, v)  # rows = v
    dist = np.full(U.shape, np.inf)
    fade = np.ones(U.shape)
    field = np.zeros(U.shape)
    for k in range(len(ENDS)):
        lo, hi, e = BEDS[k], BEDS[k + 1], ENDS[k]
        inside = (V >= lo) & (V <= hi) & (np.abs(U) <= e)
        field = np.maximum(field, inside.astype(np.float64))
        # Head joints in running bond, and the course's own two ends (its toothing).
        start = 0.0 if k % 2 == 0 else BRICK / 2
        xs = [start + n * BRICK for n in range(-4, 5)]
        xs = [x for x in xs if abs(x) < e - 1.0] + [-e, e]
        vin = (V >= lo) & (V <= hi)
        for x in xs:
            dist = np.where(vin, np.minimum(dist, np.abs(U - x)), dist)
        if k == 0:
            t = np.clip((V - lo) / BOTTOM_FADE, 0.0, 1.0)
            fade = np.where(vin, t * t * (3 - 2 * t), fade)
    fade = np.where(V < BEDS[0], 0.0, fade)
    # Bed joints: between two courses (spanning the wider), and the top of the top course; none under the lowest.
    for j in range(1, len(BEDS)):
        span = max(ENDS[j - 1], ENDS[j]) if j < len(ENDS) else ENDS[j - 1]
        on = np.abs(U) <= span + MORTAR_HALF
        dist = np.where(on, np.minimum(dist, np.abs(V - BEDS[j])), dist)
        fade = np.where(on & (np.abs(V - BEDS[j]) <= MORTAR_HALF * 2), 1.0, fade)
    mortar = np.clip((MORTAR_HALF - dist) * TEXELS_PER_PX + 0.5, 0.0, 1.0) * fade
    groove = np.clip(1.0 - dist / (MORTAR_HALF * 1.9), 0.0, 1.0) ** 2
    rgba = np.stack([mortar, field, groove, np.ones_like(mortar)], axis=-1).astype(np.float32)
    img = bpy.data.images.new(name, width=w, height=h, alpha=True, float_buffer=True)
    img.colorspace_settings.name = "Non-Color"
    img.pixels.foreach_set(rgba.reshape(-1))
    img.pack()
    return img


# ── Node helpers ───────────────────────────────────────────────────────────────


def _new_material(name):
    mat = bpy.data.materials.new(name)
    if hasattr(mat, "use_nodes") and not mat.use_nodes:
        mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    return mat, nt


def _rgb(nt, color, loc):
    n = nt.nodes.new("ShaderNodeRGB")
    n.outputs[0].default_value = color
    n.location = loc
    return n


def _mix(nt, fac, a, b, loc):
    n = nt.nodes.new("ShaderNodeMix")
    n.data_type = "RGBA"
    n.blend_type = "MIX"
    n.clamp_factor = True
    n.location = loc
    nt.links.new(fac, n.inputs["Factor"])
    nt.links.new(a, n.inputs["A"])
    nt.links.new(b, n.inputs["B"])
    return n.outputs["Result"]


def _light_band(nt, normal, threshold, loc):
    """0 in shade, 1 in light: the diffuse light at a point, through a two-step ramp with a hairline transition."""
    diffuse = nt.nodes.new("ShaderNodeBsdfDiffuse")
    diffuse.inputs["Color"].default_value = (1, 1, 1, 1)
    diffuse.location = loc
    if normal is not None:
        nt.links.new(normal, diffuse.inputs["Normal"])
    to_rgb = nt.nodes.new("ShaderNodeShaderToRGB")
    to_rgb.location = (loc[0] + 200, loc[1])
    nt.links.new(diffuse.outputs[0], to_rgb.inputs[0])
    bw = nt.nodes.new("ShaderNodeRGBToBW")
    bw.location = (loc[0] + 400, loc[1])
    nt.links.new(to_rgb.outputs["Color"], bw.inputs[0])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.location = (loc[0] + 600, loc[1])
    cr = ramp.color_ramp
    cr.interpolation = "LINEAR"
    cr.elements[0].position = threshold - 0.012
    cr.elements[0].color = (0, 0, 0, 1)
    cr.elements[1].position = threshold + 0.012
    cr.elements[1].color = (1, 1, 1, 1)
    nt.links.new(bw.outputs[0], ramp.inputs["Fac"])
    return ramp.outputs["Color"]


def _emit(nt, color, loc):
    em = nt.nodes.new("ShaderNodeEmission")
    em.location = loc
    em.inputs["Strength"].default_value = 1.0
    nt.links.new(color, em.inputs["Color"])
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (loc[0] + 220, loc[1])
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    return em


def _attribute(nt, name, loc):
    a = nt.nodes.new("ShaderNodeAttribute")
    a.attribute_type = "GEOMETRY"
    a.attribute_name = name
    a.location = loc
    return a.outputs["Fac"]


def _step(nt, value, lo, hi, loc):
    m = nt.nodes.new("ShaderNodeMapRange")
    m.location = loc
    m.clamp = True
    m.inputs["From Min"].default_value = lo
    m.inputs["From Max"].default_value = hi
    m.inputs["To Min"].default_value = 0.0
    m.inputs["To Max"].default_value = 1.0
    nt.links.new(value, m.inputs["Value"])
    return m.outputs["Result"]


# ── Materials ─────────────────────────────────────────────────────────────────


def body_material(palette, band, field_img):
    """The one coat: cream where the accent field says, the brick wall's mortar on the belly, two-tone light."""
    mat, nt = _new_material("walletwallaby.coat")
    coat, coat_shade = hex_to_linear(palette["coat"]), hex_to_linear(palette["coatShade"])
    cream, cream_shade = hex_to_linear(palette["cream"]), hex_to_linear(palette["creamShade"])
    ink = hex_to_linear(palette["ink"])
    # The belly's mortar and its groove, from the belly coordinates.
    uv = nt.nodes.new("ShaderNodeUVMap")
    uv.uv_map = "belly"
    uv.location = (-1400, -300)
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = field_img
    tex.interpolation = "Cubic"
    tex.extension = "CLIP"
    tex.location = (-1200, -300)
    nt.links.new(uv.outputs["UV"], tex.inputs["Vector"])
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    sep.location = (-900, -300)
    nt.links.new(tex.outputs["Color"], sep.inputs["Color"])
    mortar = sep.outputs["Red"]
    groove = sep.outputs["Blue"]
    bump = nt.nodes.new("ShaderNodeBump")
    bump.location = (-700, -300)
    bump.invert = True
    bump.inputs["Strength"].default_value = 0.55
    bump.inputs["Distance"].default_value = 0.012
    nt.links.new(groove, bump.inputs["Height"])
    light = _light_band(nt, bump.outputs["Normal"], band, (-700, 200))
    accent = _step(nt, _attribute(nt, "accent", (-1400, 0)), -0.35, 0.35, (-1200, 0))
    lit = _mix(nt, accent, _rgb(nt, coat, (-900, 120)).outputs[0], _rgb(nt, cream, (-900, 40)).outputs[0], (-500, 80))
    shade = _mix(nt, accent, _rgb(nt, coat_shade, (-900, -40)).outputs[0], _rgb(nt, cream_shade, (-900, -120)).outputs[0], (-500, -40))
    toned = _mix(nt, light, shade, lit, (-250, 40))
    final = _mix(nt, mortar, toned, _rgb(nt, ink, (-500, -200)).outputs[0], (0, 0))
    _emit(nt, final, (250, 0))
    mat.use_backface_culling = False
    return mat


def two_tone_material(name, lit_hex, shade_hex, band, accent_hex=None, accent_shade_hex=None):
    """A rigid part's colour (ears, chin, lid): lit/shade, optionally turning to a second pair where `accent` > 0."""
    mat, nt = _new_material(name)
    light = _light_band(nt, None, band, (-700, 200))
    lit = _rgb(nt, hex_to_linear(lit_hex), (-900, 120)).outputs[0]
    shade = _rgb(nt, hex_to_linear(shade_hex), (-900, -40)).outputs[0]
    if accent_hex:
        accent = _step(nt, _attribute(nt, "accent", (-1400, 0)), -0.35, 0.35, (-1200, 0))
        lit = _mix(nt, accent, lit, _rgb(nt, hex_to_linear(accent_hex), (-900, 40)).outputs[0], (-500, 80))
        shade = _mix(nt, accent, shade, _rgb(nt, hex_to_linear(accent_shade_hex), (-900, -120)).outputs[0], (-500, -40))
    toned = _mix(nt, light, shade, lit, (-250, 40))
    _emit(nt, toned, (0, 0))
    return mat


def flat_material(name, hexcolor):
    """One exact colour, unlit: the outline, the eyes, the nose, the mortar's colour, the glint."""
    mat, nt = _new_material(name)
    _emit(nt, _rgb(nt, hex_to_linear(hexcolor), (-300, 0)).outputs[0], (0, 0))
    return mat


def outline_material(ink_hex):
    """The inverted hull's material: charcoal, drawn only where the hull's (flipped) faces face the camera."""
    mat = flat_material("walletwallaby.outline", ink_hex)
    mat.use_backface_culling = True
    if hasattr(mat, "use_backface_culling_shadow"):
        mat.use_backface_culling_shadow = True
    return mat


def shadow_material(spec):
    """The contact shadow under the feet: a warm umber ellipse with a tight core and a soft penumbra, clipped to the
    support it lies on (it never hangs over an edge) and darker for a hard landing.

    `spec` is config.visual.contactShadow. The three per-frame inputs live on named nodes and are set by
    controls.apply_frame: `clipL` / `clipR` (world X of the support's ends, with the fade width) and `gain`."""
    mat, nt = _new_material("walletwallaby.contact_shadow")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    tc.location = (-1400, 0)
    grad = nt.nodes.new("ShaderNodeTexGradient")
    grad.gradient_type = "SPHERICAL"
    grad.location = (-1200, 0)
    nt.links.new(tc.outputs["Object"], grad.inputs["Vector"])
    # Spherical gradient on the unit disc: 1 at the centre, 0 at the rim. Penumbra over the outer part, core in the middle.
    pen = _smooth(nt, grad.outputs["Fac"], 0.0, 0.7, (-1000, 120))
    core = _smooth(nt, grad.outputs["Fac"], 0.5, 0.95, (-1000, -60))
    core_a, pen_a = spec["coreAlpha"], spec["penumbraAlpha"]
    pen_w = nt.nodes.new("ShaderNodeMath")
    pen_w.operation = "MULTIPLY"
    pen_w.inputs[1].default_value = pen_a
    pen_w.location = (-800, 120)
    nt.links.new(pen, pen_w.inputs[0])
    core_w = nt.nodes.new("ShaderNodeMath")
    core_w.operation = "MULTIPLY"
    core_w.inputs[1].default_value = max(core_a - pen_a, 0.0)
    core_w.location = (-800, -60)
    nt.links.new(core, core_w.inputs[0])
    profile = nt.nodes.new("ShaderNodeMath")
    profile.operation = "ADD"
    profile.location = (-600, 30)
    nt.links.new(pen_w.outputs[0], profile.inputs[0])
    nt.links.new(core_w.outputs[0], profile.inputs[1])
    # The support's extent along world X: 1 inside, easing to 0 across the fade width at each end.
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    geo.location = (-1400, -300)
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    sep.location = (-1200, -300)
    nt.links.new(geo.outputs["Position"], sep.inputs["Vector"])
    left = _smooth_node(nt, sep.outputs["X"], "clipL", (-1000, -300))
    right = _smooth_node(nt, sep.outputs["X"], "clipR", (-1000, -480))
    inside = nt.nodes.new("ShaderNodeMath")
    inside.operation = "MULTIPLY"
    inside.location = (-800, -380)
    nt.links.new(left, inside.inputs[0])
    nt.links.new(right, inside.inputs[1])
    clipped = nt.nodes.new("ShaderNodeMath")
    clipped.operation = "MULTIPLY"
    clipped.location = (-400, -100)
    nt.links.new(profile.outputs[0], clipped.inputs[0])
    nt.links.new(inside.outputs[0], clipped.inputs[1])
    gain = nt.nodes.new("ShaderNodeValue")
    gain.name = "gain"
    gain.label = "gain"
    gain.outputs[0].default_value = 1.0
    gain.location = (-600, -250)
    total = nt.nodes.new("ShaderNodeMath")
    total.operation = "MULTIPLY"
    total.use_clamp = True
    total.location = (-200, -100)
    nt.links.new(clipped.outputs[0], total.inputs[0])
    nt.links.new(gain.outputs[0], total.inputs[1])
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = hex_to_linear(spec["color"])
    em.location = (-200, -250)
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    tr.location = (-200, 150)
    mix = nt.nodes.new("ShaderNodeMixShader")
    mix.location = (50, 0)
    nt.links.new(total.outputs[0], mix.inputs[0])
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(em.outputs[0], mix.inputs[2])
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (250, 0)
    nt.links.new(mix.outputs[0], out.inputs["Surface"])
    if hasattr(mat, "surface_render_method"):
        mat.surface_render_method = "BLENDED"
    return mat


def _smooth(nt, value, lo, hi, loc):
    """smoothstep(lo, hi, value) as a Map Range node."""
    m = nt.nodes.new("ShaderNodeMapRange")
    m.location = loc
    m.clamp = True
    m.interpolation_type = "SMOOTHSTEP"
    m.inputs["From Min"].default_value = lo
    m.inputs["From Max"].default_value = hi
    m.inputs["To Min"].default_value = 0.0
    m.inputs["To Max"].default_value = 1.0
    nt.links.new(value, m.inputs["Value"])
    return m.outputs["Result"]


def _smooth_node(nt, value, name, loc):
    """A smoothstep edge whose two ends (From Min, From Max) are set per frame on the node called `name`."""
    m = nt.nodes.new("ShaderNodeMapRange")
    m.name = name
    m.label = name
    m.location = loc
    m.clamp = True
    m.interpolation_type = "SMOOTHSTEP"
    m.inputs["From Min"].default_value = -1.0e6
    m.inputs["From Max"].default_value = -1.0e6 + 1.0
    m.inputs["To Min"].default_value = 0.0
    m.inputs["To Max"].default_value = 1.0
    nt.links.new(value, m.inputs["Value"])
    return m.outputs["Result"]
