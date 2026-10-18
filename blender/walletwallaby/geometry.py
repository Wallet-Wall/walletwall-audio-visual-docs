"""WalletWallaby's 3D body, authored as code.

The body is one mass: smooth signed-distance volumes (ellipsoids and round
cones) joined by smooth unions, so the torso, the haunches, the forelimbs, and
the long tail grow out of each other with no seams. The volume is meshed once,
at the rest pose, by surface nets on a fixed grid, projected onto the exact
surface, relaxed, and skinned to the rig contract's 22 bones (the same skeleton
the Rive rig uses). Everything is numpy over fixed inputs: the same source gives
the same mesh, bit for bit, on the same build.

All lengths here are rig px at character scale 1, in the lane's px space:
X forward, Y depth (near side negative, toward the camera), Z up; the feet stand
at the origin. Shape language (the WalletWallrus family): rounded, solid, a
little chunky; the belly is the deepest part of the body (it carries the wall);
a long tail, thick at the base, tapering to a point.
"""

import math

import numpy as np

# ── Signed distance primitives (Inigo Quilez's forms, vectorised) ─────────────


def sd_ellipsoid(p, c, r):
    q = p - np.asarray(c, dtype=np.float64)
    r = np.asarray(r, dtype=np.float64)
    k0 = np.linalg.norm(q / r, axis=1)
    k1 = np.linalg.norm(q / (r * r), axis=1)
    return k0 * (k0 - 1.0) / np.maximum(k1, 1e-12)


def sd_round_cone(p, a, b, r1, r2):
    a = np.asarray(a, dtype=np.float64)
    b = np.asarray(b, dtype=np.float64)
    ba = b - a
    l2 = float(ba @ ba)
    rr = r1 - r2
    a2 = l2 - rr * rr
    il2 = 1.0 / l2
    pa = p - a
    y = pa @ ba
    z = y - l2
    x2v = pa * l2 - np.outer(y, ba)
    x2 = np.einsum("ij,ij->i", x2v, x2v)
    y2 = y * y * l2
    z2 = z * z * l2
    k = math.copysign(1.0, rr) * rr * rr * x2
    out = (np.sqrt(np.maximum(x2 * a2 * il2, 0.0)) + y * rr) * il2 - r1
    c2 = np.sign(y) * a2 * y2 < k
    out = np.where(c2, np.sqrt(x2 + y2) * il2 - r1, out)
    c1 = np.sign(z) * a2 * z2 > k
    out = np.where(c1, np.sqrt(x2 + z2) * il2 - r2, out)
    return out


def smin(a, b, k):
    """Polynomial smooth minimum: a fillet of about k px where two volumes meet."""
    if k <= 0:
        return np.minimum(a, b)
    h = np.maximum(k - np.abs(a - b), 0.0) / k
    return np.minimum(a, b) - h * h * k * 0.25


def smax(a, b, k):
    return -smin(-a, -b, k)


def scaled(fn, axis_scale):
    """Evaluate a primitive in a space squashed along Y (depth) by axis_scale (a flatter or rounder cross-section)."""
    s = np.array([1.0, axis_scale, 1.0])

    def f(p):
        return fn(p / s) * min(1.0, axis_scale)

    return f


# ── The design (rig px; the 2D rig contract's rest pose, given volume) ───────


class Part:
    """One volume: its SDF, the bones it moves with (weights may blend along its length), and its group."""

    def __init__(self, name, fn, bones, group, blend=0.0):
        self.name = name
        self.fn = fn
        self.bones = bones  # list of (bone, weight) or a callable p -> [(bone, w)] arrays
        self.group = group
        self.blend = blend


def P(x, y, d=0.0):
    """Rig px (x forward, y down) at depth d -> lane px (X, Y, Z)."""
    return (x, d, -y)


# Depth of the paired limbs (px from the mid-plane). Near = negative (toward the camera).
LEG_D = 15.0
ARM_D = 29.0
EAR_D = 9.0
EYE = {"x": 58.5, "z": 192.0}


def tail_radius(u):
    """The rig contract's tail half-width (rig-source.ts tailHalf), slightly fuller at the root for volume."""
    u = min(1.0, max(0.0, u))
    return 1.8 + 23.0 * (1.0 - u) ** 1.25 + 3.0 * math.exp(-((u / 0.18) ** 2))


def build_parts(rig):
    bones = {b["name"]: b for b in rig["bones"]}

    def bone_pts(name, d=0.0):
        b = bones[name]
        return P(b["head"][0], b["head"][1], d), P(b["tail"][0], b["tail"][1], d)

    parts = []
    # Torso: rump, belly (the deepest mass: the wall it carries), chest, and a short thick neck.
    parts.append(Part("rump", lambda p: sd_ellipsoid(p, P(-20, -84), (33, 31, 32)), [("hip", 1.0)], "torso"))
    parts.append(Part("belly", lambda p: sd_ellipsoid(p, P(11, -101), (42, 36, 40)), [("hip", 0.55), ("chest", 0.45)], "torso", 22))
    parts.append(Part("chest", lambda p: sd_ellipsoid(p, P(17, -145), (30, 27, 28)), [("chest", 1.0)], "torso", 20))
    parts.append(Part("neck", scaled(lambda p: sd_round_cone(p, P(20, -160), P(31, -178), 22, 17), 0.92), [("neck", 1.0)], "torso", 16))
    # Head: a rounded crown running in one convex line down a deep muzzle to a blunt nose; full cheeks.
    parts.append(Part("crown", lambda p: sd_ellipsoid(p, P(44, -193), (27.5, 21.5, 21.5)), [("head", 1.0)], "head", 9))
    parts.append(Part("muzzle", scaled(lambda p: sd_round_cone(p, P(58, -184), P(83, -179.5), 15, 10.5), 0.92), [("head", 1.0)], "head", 10))
    parts.append(Part("cheek", lambda p: sd_ellipsoid(p, P(50, -179), (17, 17.5, 12.5)), [("head", 1.0)], "head", 8))
    # Tail: five round cones along the rest line, one per tail bone; it tapers from a thick root to a point.
    rest = rig["tail"]["rest"]
    seg = [math.dist(rest[i], rest[i + 1]) for i in range(len(rest) - 1)]
    total = sum(seg)
    us = [0.0]
    for s in seg:
        us.append(us[-1] + s / total)
    for i, name in enumerate(rig["tail"]["bones"]):
        a = P(rest[i][0], rest[i][1])
        b = P(rest[i + 1][0], rest[i + 1][1])
        r1 = tail_radius(us[i])
        r2 = max(1.6, tail_radius(us[i + 1]))
        parts.append(Part(name, (lambda a, b, r1, r2: lambda p: sd_round_cone(p, a, b, r1, r2))(a, b, r1, r2), [(name, 1.0)], "tail", 16 if i == 0 else 3))
    # Where the tail grows out of the rump: the muscle that carries it, filling the corner between back and tail.
    parts.append(Part("tail_root", lambda p: sd_ellipsoid(p, P(-40, -78), (22, 19, 16)), [("hip", 0.5), ("tail_0", 0.5)], "tail", 14))
    return parts


def build_hindlegs(rig):
    """Each hind leg is its own skinned limb: the big haunch, set into the rump and carrying the weight, the shin,
    and the long foot (sole on the ground at the toes). Its own outline is the line of the haunch over the belly,
    as on the 2D rig. Returns {side: [parts]}."""
    bones = {b["name"]: b for b in rig["bones"]}
    out = {}
    for side, sgn in (("n", -1.0), ("f", 1.0)):
        def pts(name):
            b = bones[name]
            return P(b["head"][0], b["head"][1], sgn * LEG_D), P(b["tail"][0], b["tail"][1], sgn * LEG_D)

        off = bones[f"thigh_{side}"]["head"][0] - (-14.0)  # the far leg carries the rig's own 2D offset
        parts = [Part(f"haunch_{side}", (lambda off, sgn: lambda p: sd_ellipsoid(p, P(-6 + off, -67, sgn * 16), (35, 17.5, 31)))(off, sgn), [(f"thigh_{side}", 0.8), ("hip", 0.2)], f"leg_{side}")]
        a, b = pts(f"thigh_{side}")
        parts.append(Part(f"thigh_{side}", (lambda a, b: lambda p: sd_round_cone(p, a, b, 16, 9.5))(a, b), [(f"thigh_{side}", 1.0)], f"leg_{side}", 8))
        a, b = pts(f"shin_{side}")
        parts.append(Part(f"shin_{side}", (lambda a, b: lambda p: sd_round_cone(p, a, b, 8.8, 5.6))(a, b), [(f"shin_{side}", 1.0)], f"leg_{side}", 5))
        a, b = pts(f"foot_{side}")
        # The foot runs past the toe joint to the toe tip; flattened a little top to bottom.
        tip = (b[0] + (b[0] - a[0]) * 0.36, b[1], b[2] - 0.4)
        parts.append(Part(f"foot_{side}", (lambda a, tip: scaled(lambda p: sd_round_cone(p, a, tip, 6.2, 4.8), 1.25))(a, tip), [(f"foot_{side}", 1.0)], f"leg_{side}", 3))
        out[side] = parts
    return out


def build_forelimbs(rig):
    """Each forelimb is its own skinned limb at the side of the chest, its shoulder set into the body: it hangs in
    front of the flank, clear of the belly's wall, and bends at the elbow as one piece. Returns {side: [parts]}."""
    bones = {b["name"]: b for b in rig["bones"]}
    out = {}
    for side, sgn in (("n", -1.0), ("f", 1.0)):
        def pts(name):
            b = bones[name]
            return P(b["head"][0], b["head"][1], sgn * ARM_D), P(b["tail"][0], b["tail"][1], sgn * ARM_D)

        a, b = pts(f"arm_{side}")
        parts = [Part(f"arm_{side}", (lambda a, b: lambda p: sd_round_cone(p, a, b, 9.0, 6.4))(a, b), [(f"arm_{side}", 1.0)], f"arm_{side}")]
        a, b = pts(f"forearm_{side}")
        parts.append(Part(f"forearm_{side}", (lambda a, b: lambda p: sd_round_cone(p, a, b, 6.0, 5.2))(a, b), [(f"forearm_{side}", 1.0)], f"arm_{side}", 3))
        paw = (b[0] + 2.0, b[1], b[2] - 0.6)
        parts.append(Part(f"paw_{side}", (lambda paw: lambda p: sd_ellipsoid(p, paw, (6.8, 6.0, 5.6)))(paw), [(f"forearm_{side}", 1.0)], f"arm_{side}", 2))
        out[side] = parts
    return out


# The order volumes are joined in; each joins the union so far with its own fillet.
def body_sdf(parts):
    def f(p):
        d = None
        for part in parts:
            v = part.fn(p)
            d = v if d is None else smin(d, v, part.blend)
        # Soles: nothing of the body reaches below the ground plane at rest.
        return smax(d, -p[:, 2] - 0.0, 2.0)

    return f


# ── Surface nets ──────────────────────────────────────────────────────────────


def surface_nets(sdf, lo, hi, h):
    """Quad mesh of the zero level set of `sdf` on a regular grid of spacing h (outward normals)."""
    xs = np.arange(lo[0], hi[0] + h * 0.5, h)
    ys = np.arange(lo[1], hi[1] + h * 0.5, h)
    zs = np.arange(lo[2], hi[2] + h * 0.5, h)
    nx, ny, nz = len(xs), len(ys), len(zs)
    G = np.stack(np.meshgrid(xs, ys, zs, indexing="ij"), axis=-1)
    F = sdf(G.reshape(-1, 3)).reshape(nx, ny, nz)
    inside = F < 0.0
    # Cubes with a sign change get one vertex: the mean of their edges' zero crossings.
    corners = [(i, j, k) for i in (0, 1) for j in (0, 1) for k in (0, 1)]
    cin = [inside[i : nx - 1 + i, j : ny - 1 + j, k : nz - 1 + k] for (i, j, k) in corners]
    any_in = np.zeros_like(cin[0])
    all_in = np.ones_like(cin[0])
    for c in cin:
        any_in |= c
        all_in &= c
    active = any_in & ~all_in
    edges = []
    for (a, b) in [((0, 0, 0), (1, 0, 0)), ((0, 1, 0), (1, 1, 0)), ((0, 0, 1), (1, 0, 1)), ((0, 1, 1), (1, 1, 1)),
                   ((0, 0, 0), (0, 1, 0)), ((1, 0, 0), (1, 1, 0)), ((0, 0, 1), (0, 1, 1)), ((1, 0, 1), (1, 1, 1)),
                   ((0, 0, 0), (0, 0, 1)), ((1, 0, 0), (1, 0, 1)), ((0, 1, 0), (0, 1, 1)), ((1, 1, 0), (1, 1, 1))]:
        edges.append((a, b))
    acc = np.zeros(active.shape + (3,))
    cnt = np.zeros(active.shape)
    for (a, b) in edges:
        fa = F[a[0] : nx - 1 + a[0], a[1] : ny - 1 + a[1], a[2] : nz - 1 + a[2]]
        fb = F[b[0] : nx - 1 + b[0], b[1] : ny - 1 + b[1], b[2] : nz - 1 + b[2]]
        cross = (fa < 0.0) != (fb < 0.0)
        t = np.where(cross, fa / np.where(cross, fa - fb, 1.0), 0.0)
        pa = G[a[0] : nx - 1 + a[0], a[1] : ny - 1 + a[1], a[2] : nz - 1 + a[2]]
        pb = G[b[0] : nx - 1 + b[0], b[1] : ny - 1 + b[1], b[2] : nz - 1 + b[2]]
        pt = pa + (pb - pa) * t[..., None]
        acc += np.where(cross[..., None], pt, 0.0)
        cnt += cross
    index = -np.ones(active.shape, dtype=np.int64)
    index[active] = np.arange(int(active.sum()))
    verts = acc[active] / cnt[active][:, None]
    faces = []
    # One quad per grid edge with a sign change, joining the four cubes around it.
    for axis in range(3):
        b_ax, c_ax = (axis + 1) % 3, (axis + 2) % 3
        sl_lo = [slice(None)] * 3
        sl_hi = [slice(None)] * 3
        sl_lo[axis] = slice(0, -1)
        sl_hi[axis] = slice(1, None)
        s0 = inside[tuple(sl_lo)]
        s1 = inside[tuple(sl_hi)]
        g = np.argwhere(s0 != s1)
        eb = np.zeros(3, dtype=np.int64)
        ec = np.zeros(3, dtype=np.int64)
        eb[b_ax] = 1
        ec[c_ax] = 1
        cubes = [g - eb - ec, g - ec, g, g - eb]
        ok = np.ones(len(g), dtype=bool)
        for cu in cubes:
            ok &= (cu >= 0).all(axis=1) & (cu[:, 0] < active.shape[0]) & (cu[:, 1] < active.shape[1]) & (cu[:, 2] < active.shape[2])
        g = g[ok]
        cubes = [cu[ok] for cu in cubes]
        ids = np.stack([index[cu[:, 0], cu[:, 1], cu[:, 2]] for cu in cubes], axis=1)
        good = (ids >= 0).all(axis=1)
        ids = ids[good]
        flip = ~s0[g[good][:, 0], g[good][:, 1], g[good][:, 2]]
        ids[flip] = ids[flip][:, ::-1]
        faces.append(ids)
    faces = np.concatenate(faces, axis=0)
    return verts, faces


def gradient(sdf, p, e=0.05):
    g = np.zeros_like(p)
    for i in range(3):
        d = np.zeros(3)
        d[i] = e
        g[:, i] = (sdf(p + d) - sdf(p - d)) / (2 * e)
    return g


def project(sdf, verts, steps=4):
    for _ in range(steps):
        d = sdf(verts)
        g = gradient(sdf, verts)
        n2 = np.maximum(np.einsum("ij,ij->i", g, g), 1e-12)
        verts = verts - (d / n2)[:, None] * g
    return verts


def relax(sdf, verts, faces, rounds=3, amount=0.5):
    """Tangential Laplacian relaxation (even quads), re-projected onto the surface each round."""
    n = len(verts)
    # Neighbours from quad edges.
    e = np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 3]], faces[:, [3, 0]]], axis=0)
    e = np.concatenate([e, e[:, ::-1]], axis=0)
    deg = np.bincount(e[:, 0], minlength=n).astype(np.float64)
    for _ in range(rounds):
        s = np.zeros_like(verts)
        np.add.at(s, e[:, 0], verts[e[:, 1]])
        avg = s / np.maximum(deg, 1)[:, None]
        g = gradient(sdf, verts)
        nrm = g / np.maximum(np.linalg.norm(g, axis=1), 1e-12)[:, None]
        delta = avg - verts
        delta -= np.einsum("ij,ij->i", delta, nrm)[:, None] * nrm
        verts = project(sdf, verts + amount * delta, steps=2)
    return verts


# ── Skin weights, belly coordinates, accents ──────────────────────────────────


def skin_weights(parts, verts, bone_names, temperature=3.2):
    """Per-vertex bone weights: a softmax over the volumes by how close each one is to the vertex, mapped to the
    bones each volume moves with. Joints blend over a few px; distant volumes contribute nothing."""
    d = np.stack([np.maximum(part.fn(verts), 0.0) for part in parts], axis=1)
    w = np.exp(-(d - d.min(axis=1, keepdims=True)) / temperature)
    w /= w.sum(axis=1, keepdims=True)
    out = np.zeros((len(verts), len(bone_names)))
    col = {b: i for i, b in enumerate(bone_names)}
    for k, part in enumerate(parts):
        for bone, bw in part.bones:
            out[:, col[bone]] += w[:, k] * bw
    out[out < 1e-3] = 0.0
    out /= out.sum(axis=1, keepdims=True)
    group = np.array([parts[i].group for i in np.argmin(d - 0.0, axis=1)])
    return out, group, d


# The belly field (materials.py draws it): cylindrical coordinates about a vertical axis through the torso, so the
# courses run level around the belly's round front. u = arc length from the front centre (px at radius BELLY_R),
# v = height (px). Only torso vertices get them; everything else sits far outside the field.
BELLY_AXIS_X = 2.0
BELLY_R = 38.0
BELLY_FIELD = {"u0": -64.0, "u1": 64.0, "v0": 50.0, "v1": 140.0}


def belly_uv(verts, group):
    ang = np.arctan2(verts[:, 1], verts[:, 0] - BELLY_AXIS_X)
    u = BELLY_R * ang
    v = verts[:, 2]
    f = BELLY_FIELD
    uu = (u - f["u0"]) / (f["u1"] - f["u0"])
    vv = (v - f["v0"]) / (f["v1"] - f["v0"])
    torso = group == "torso"
    # Only the front half of the torso can carry the field (the back of the body never wraps round to it).
    front = np.abs(ang) < math.radians(100)
    keep = torso & front
    uu = np.where(keep, uu, -4.0)
    vv = np.where(keep, vv, -4.0)
    return np.stack([uu, vv], axis=1)


def accent_field(verts, group, rig):
    """> 0 where the coat turns cream: the muzzle, the throat above the wall, and the tail's underside."""
    a = np.full(len(verts), -10.0)
    head = group == "head"
    # The muzzle: everything of the face in front of and below the eye line, to the nose.
    muz = -sd_ellipsoid(verts, P(80, -175.5), (20, 20, 10.5))
    a = np.where(head, np.maximum(a, muz), a)
    # The throat: from under the chin down the front of the neck, ending above the brick field (coat between).
    torso = group == "torso"
    thr = np.minimum(-sd_ellipsoid(verts, P(38, -160), (12, 17, 21)), (verts[:, 0] - 25.0) * 0.5)
    a = np.where(torso | head, np.maximum(a, thr), a)
    # The tail's underside: a cream band below the centreline from near the root to the tip.
    rest = rig["tail"]["rest"]
    tail = group == "tail"
    pts = np.array([P(x, y) for (x, y) in rest])
    seglen = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    cum = np.concatenate([[0.0], np.cumsum(seglen)])
    total = cum[-1]
    # Nearest point on the rest polyline (in X-Z), its arc position, and the local up direction.
    best_d = np.full(len(verts), np.inf)
    best_u = np.zeros(len(verts))
    best_s = np.zeros(len(verts))
    for i in range(len(pts) - 1):
        a0, b0 = pts[i][[0, 2]], pts[i + 1][[0, 2]]
        ab = b0 - a0
        t = np.clip(((verts[:, [0, 2]] - a0) @ ab) / (ab @ ab), 0, 1)
        q = a0 + t[:, None] * ab
        rel = verts[:, [0, 2]] - q
        dist = np.linalg.norm(rel, axis=1)
        nrm = np.array([-ab[1], ab[0]]) / np.linalg.norm(ab)
        if nrm[1] < 0:
            nrm = -nrm
        better = dist < best_d
        best_d = np.where(better, dist, best_d)
        best_u = np.where(better, (cum[i] + t * seglen[i]) / total, best_u)
        best_s = np.where(better, rel @ nrm, best_s)
    r = np.array([tail_radius(u) for u in best_u])
    grow = np.clip((best_u - 0.25) / 0.2, 0, 1)
    under = (-best_s / np.maximum(r, 1e-6) - (1.0 - 0.72 * grow)) * 6.0
    a = np.where(tail, np.maximum(a, under), a)
    return a


# ── Small rigid parts (ears, eyes, nose, lids, brows, claws): their own meshes ──


def mesh_from_sdf(fn, lo, hi, h, relax_rounds=2):
    verts, faces = surface_nets(fn, lo, hi, h)
    verts = project(fn, verts)
    verts = relax(fn, verts, faces, rounds=relax_rounds)
    return verts, faces


def ear_inner(p, length=64.0, width=11.5):
    """> 0 on the ear's cupped inner face, inside a margin from its rim and clear of its base and tip."""
    x, y, z = p[:, 0], p[:, 1], p[:, 2]
    u = np.clip(x / length, 0.0, 1.0)
    half = 1.3 + width * np.sin(np.pi * np.clip(0.12 + 0.88 * u, 0.0, 1.0)) ** 0.7 * (1.0 - 0.5 * u)
    bow = 2.4 * (1.0 - np.clip(z / half, -1.0, 1.0) ** 2) * np.sin(np.pi * np.clip(u * 1.1, 0.0, 1.0))
    front = bow - y
    rim = 0.62 * half - np.abs(z)
    ends = np.minimum(x - 6.0, 0.86 * length - x)
    return np.minimum(np.minimum(front, rim), ends)


def ear_sdf(length=64.0, width=11.5, thick=3.4):
    """An ear along +X from its base (local frame): broad low, narrowing to a rounded point, with its inner face
    (local -Y) cupped: the ear's mid-surface bows back (+Y) along its centreline."""

    def f(p):
        x, y, z = p[:, 0], p[:, 1], p[:, 2]
        u = np.clip(x / length, 0.0, 1.0)
        half = 1.3 + width * np.sin(np.pi * np.clip(0.12 + 0.88 * u, 0.0, 1.0)) ** 0.7 * (1.0 - 0.5 * u)
        bow = 2.4 * (1.0 - np.clip(z / half, -1.0, 1.0) ** 2) * np.sin(np.pi * np.clip(u * 1.1, 0.0, 1.0))
        planar = np.abs(z) - half
        slab = np.abs(y - bow) - thick * (1.0 - 0.55 * u)
        ends = np.maximum(-x - 2.0, x - length)
        return smax(smax(planar, slab, 1.4), ends, 2.0)

    return f
