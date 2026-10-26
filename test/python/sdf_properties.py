# SPDX-License-Identifier: MIT
# SPDX-FileCopyrightText: 2026 WalletWall
#
# Property tests for the signed-distance building blocks in blender/walletwallaby/geometry.py. Each test states a
# geometric or analytic fact about the shape or operator and checks it against an oracle built from the definition (a
# dense union of balls, a sphere, an axis, a derivative), never against the output of an earlier implementation.
# Pure numpy, no Blender API: run by test/blender-sdf.test.ts with a Python that has numpy (python -m unittest).

import math
import os
import sys
import unittest

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "blender", "walletwallaby"))
import geometry as G  # noqa: E402

RNG_SEED = 20261026


def rng():
    return np.random.default_rng(RNG_SEED)


def unit_rows(v):
    return v / np.linalg.norm(v, axis=1)[:, None]


def ball_union(p, a, b, r1, r2, samples=4001):
    """Signed distance oracle for a round cone from its definition: the convex hull of two balls is the union of the
    balls whose centres and radii interpolate linearly between them. Outside, the distance to a union of balls is the
    smallest of the distances to each ball."""
    a = np.asarray(a, dtype=np.float64)
    b = np.asarray(b, dtype=np.float64)
    t = np.linspace(0.0, 1.0, samples)
    centres = a[None, :] + t[:, None] * (b - a)[None, :]
    radii = r1 + t * (r2 - r1)
    d = np.linalg.norm(p[:, None, :] - centres[None, :, :], axis=2) - radii[None, :]
    return d.min(axis=1)


def profile_boundary(a_len, r1, r2, samples=4001):
    """Dense samples of a round cone's boundary in its (axial, radial) half-plane, taken from the union of the two
    discs and the discs between them: a sample of either end circle or of any interpolated circle is on the boundary
    when no interpolated disc contains it. Rings 1/200 of the length apart and samples pi/4000 apart put every boundary
    point within about 1e-3 of a sample."""
    t = np.linspace(0.0, 1.0, 201)
    centres = np.stack([t * a_len, np.zeros_like(t)], axis=1)
    radii = r1 + t * (r2 - r1)
    ang = np.linspace(0.0, math.pi, samples)
    pts = []
    for c, r in zip(centres, radii):
        ring = np.stack([c[0] + r * np.cos(ang), r * np.sin(ang)], axis=1)
        depth = (radii[None, :] - np.linalg.norm(ring[:, None, :] - centres[None, :, :], axis=2)).max(axis=1)
        pts.append(ring[depth <= 1e-9 * max(r1, r2, 1.0)])
    return np.concatenate(pts, axis=0)


class EllipsoidTests(unittest.TestCase):
    c = (3.0, -2.0, 5.0)
    r = (4.0, 2.5, 1.5)

    def test_sign_outside_inside_and_surface(self):
        g = rng()
        dirs = unit_rows(g.normal(size=(500, 3)))
        r = np.array(self.r)
        surface = np.array(self.c) + dirs * r
        self.assertLess(np.abs(G.sd_ellipsoid(surface, self.c, self.r)).max(), 1e-9)
        outside = np.array(self.c) + dirs * r * 1.3
        inside = np.array(self.c) + dirs * r * 0.7
        self.assertTrue((G.sd_ellipsoid(outside, self.c, self.r) > 0).all())
        self.assertTrue((G.sd_ellipsoid(inside, self.c, self.r) < 0).all())

    def test_centre_is_the_deepest_point(self):
        d = G.sd_ellipsoid(np.array([self.c]), self.c, self.r)
        self.assertAlmostEqual(float(d[0]), -min(self.r), places=12)

    def test_exact_along_each_principal_axis(self):
        for axis in range(3):
            for s in (-1.0, 1.0):
                for gap in (-0.6, -0.1, 0.25, 3.0):
                    p = np.array(self.c, dtype=np.float64)
                    p[axis] += s * (self.r[axis] + gap)
                    self.assertAlmostEqual(float(G.sd_ellipsoid(p[None, :], self.c, self.r)[0]), gap, places=9)

    def test_exact_for_a_sphere(self):
        g = rng()
        p = g.uniform(-10, 10, size=(800, 3))
        want = np.linalg.norm(p - np.array([1.0, 2.0, 3.0]), axis=1) - 2.5
        np.testing.assert_allclose(G.sd_ellipsoid(p, (1.0, 2.0, 3.0), (2.5, 2.5, 2.5)), want, atol=1e-9)

    def test_first_order_exact_near_the_surface(self):
        # Along the outward normal at a surface point, d(x0 + e n) = e + O(e^2).
        g = rng()
        r = np.array(self.r)
        dirs = unit_rows(g.normal(size=(300, 3)))
        x0 = np.array(self.c) + dirs * r
        n = unit_rows((x0 - np.array(self.c)) / (r * r))
        for e in (1e-3, -1e-3, 1e-2):
            d = G.sd_ellipsoid(x0 + e * n, self.c, self.r)
            self.assertLess(np.abs(d - e).max(), 40.0 * e * e + 1e-12)

    def test_symmetric_across_its_axes(self):
        g = rng()
        q = g.uniform(-6, 6, size=(400, 3))
        base = G.sd_ellipsoid(np.array(self.c) + q, self.c, self.r)
        for flip in ((-1, 1, 1), (1, -1, 1), (1, 1, -1), (-1, -1, -1)):
            np.testing.assert_allclose(G.sd_ellipsoid(np.array(self.c) + q * np.array(flip), self.c, self.r), base, rtol=0, atol=1e-12)

    def test_translation_and_scale_covariant(self):
        g = rng()
        p = g.uniform(-8, 8, size=(400, 3))
        d = G.sd_ellipsoid(p, self.c, self.r)
        np.testing.assert_allclose(G.sd_ellipsoid(p - np.array(self.c), (0, 0, 0), self.r), d, atol=1e-11)
        np.testing.assert_allclose(G.sd_ellipsoid(p * 3.0, tuple(3.0 * x for x in self.c), tuple(3.0 * x for x in self.r)), 3.0 * d, atol=1e-10)

    def test_finite_for_small_radii_and_the_production_domain(self):
        g = rng()
        p = g.uniform(-300, 300, size=(5000, 3))
        self.assertTrue(np.isfinite(G.sd_ellipsoid(p, (0.0, 0.0, 100.0), (42.0, 36.0, 40.0))).all())
        tiny = G.sd_ellipsoid(p, (0.0, 0.0, 0.0), (1e-6, 2e-6, 1e-6))
        self.assertTrue(np.isfinite(tiny).all())
        self.assertTrue((tiny > 0).all())


class RoundConeTests(unittest.TestCase):
    a = (1.0, 2.0, -1.0)
    b = (9.0, -3.0, 4.0)
    r1 = 3.0
    r2 = 1.2

    def frame(self):
        a = np.array(self.a)
        b = np.array(self.b)
        u = (b - a) / np.linalg.norm(b - a)
        v = np.cross(u, [0.0, 0.0, 1.0])
        v /= np.linalg.norm(v)
        w = np.cross(u, v)
        return a, b, u, v, w, float(np.linalg.norm(b - a))

    def test_outside_matches_the_union_of_balls(self):
        g = rng()
        p = g.uniform(-8, 16, size=(1500, 3))
        oracle = ball_union(p, self.a, self.b, self.r1, self.r2)
        out = oracle > 0.05
        self.assertGreater(out.sum(), 1000)
        np.testing.assert_allclose(G.sd_round_cone(p[out], self.a, self.b, self.r1, self.r2), oracle[out], atol=2e-5)

    def test_inside_is_minus_the_distance_to_the_boundary(self):
        a, b, u, v, w, length = self.frame()
        boundary = profile_boundary(length, self.r1, self.r2)
        g = rng()
        t = g.uniform(-self.r1, length + self.r2, size=600)
        rho = g.uniform(0.0, self.r1, size=600)
        phi = g.uniform(0.0, 2 * math.pi, size=600)
        p = a + t[:, None] * u + rho[:, None] * (np.cos(phi)[:, None] * v + np.sin(phi)[:, None] * w)
        inside = ball_union(p, self.a, self.b, self.r1, self.r2) < -0.05
        self.assertGreater(inside.sum(), 150)
        q = np.stack([t[inside], rho[inside]], axis=1)
        want = -np.linalg.norm(q[:, None, :] - boundary[None, :, :], axis=2).min(axis=1)
        np.testing.assert_allclose(G.sd_round_cone(p[inside], self.a, self.b, self.r1, self.r2), want, atol=2e-3)

    def test_caps_and_side_lie_on_the_surface(self):
        a, b, u, v, w, length = self.frame()
        s = (self.r1 - self.r2) / length
        c = math.sqrt(1.0 - s * s)
        caps = np.array([a - self.r1 * u, b + self.r2 * u])
        np.testing.assert_allclose(G.sd_round_cone(caps, self.a, self.b, self.r1, self.r2), 0.0, atol=1e-9)
        # The side touches the end balls where their radius meets the side's normal (s along the axis, c across it).
        g = rng()
        phi = g.uniform(0.0, 2 * math.pi, size=200)
        lam = g.uniform(0.0, 1.0, size=200)
        radial = np.cos(phi)[:, None] * v + np.sin(phi)[:, None] * w
        t1 = a + self.r1 * (s * u + c * radial)
        t2 = b + self.r2 * (s * u + c * radial)
        side = t1 + lam[:, None] * (t2 - t1)
        np.testing.assert_allclose(G.sd_round_cone(side, self.a, self.b, self.r1, self.r2), 0.0, atol=1e-9)

    def test_signs_and_depth_at_the_end_centres(self):
        d = G.sd_round_cone(np.array([self.a, self.b]), self.a, self.b, self.r1, self.r2)
        self.assertAlmostEqual(float(d[0]), -self.r1, places=9)
        self.assertLess(float(d[1]), 0.0)
        self.assertGreater(float(G.sd_round_cone(np.array([[50.0, 50.0, 50.0]]), self.a, self.b, self.r1, self.r2)[0]), 0.0)

    def test_symmetric_about_its_axis(self):
        a, b, u, v, w, length = self.frame()
        g = rng()
        t = g.uniform(-5, length + 5, size=300)
        rho = g.uniform(0, 8, size=300)
        ds = []
        for phi in (0.0, 1.1, 2.5, 4.0):
            p = a + t[:, None] * u + rho[:, None] * (math.cos(phi) * v + math.sin(phi) * w)
            ds.append(G.sd_round_cone(p, self.a, self.b, self.r1, self.r2))
        for d in ds[1:]:
            np.testing.assert_allclose(d, ds[0], atol=1e-9)

    def test_one_lipschitz_and_continuous_across_the_region_seams(self):
        g = rng()
        p = g.uniform(-6, 14, size=(4000, 3))
        q = p + g.normal(scale=0.05, size=p.shape)
        dp = G.sd_round_cone(p, self.a, self.b, self.r1, self.r2)
        dq = G.sd_round_cone(q, self.a, self.b, self.r1, self.r2)
        self.assertTrue((np.abs(dp - dq) <= np.linalg.norm(p - q, axis=1) + 1e-9).all())
        # A line crossing both seams (behind the first tangent circle, along the side, past the second) has no jump.
        a, b, u, v, w, length = self.frame()
        t = np.linspace(-4.0, length + 4.0, 20001)
        line = a + t[:, None] * u + 2.0 * v
        d = G.sd_round_cone(line, self.a, self.b, self.r1, self.r2)
        self.assertLess(np.abs(np.diff(d)).max(), (t[1] - t[0]) + 1e-9)

    def test_degenerate_shapes(self):
        g = rng()
        p = g.uniform(-6, 6, size=(400, 3))
        # Equal radii: a capsule, the distance to the segment less the radius.
        a = np.array([-2.0, 0.0, 0.0])
        b = np.array([3.0, 1.0, 0.5])
        ab = b - a
        h = np.clip(((p - a) @ ab) / (ab @ ab), 0.0, 1.0)
        capsule = np.linalg.norm(p - (a + h[:, None] * ab), axis=1) - 1.5
        np.testing.assert_allclose(G.sd_round_cone(p, a, b, 1.5, 1.5), capsule, atol=1e-9)
        # Coincident ends: a sphere of the larger radius.
        np.testing.assert_allclose(G.sd_round_cone(p, a, a, 1.0, 2.0), np.linalg.norm(p - a, axis=1) - 2.0, atol=1e-9)
        # One ball inside the other: the larger ball. Touching from inside (the distance between centres equals the
        # difference of the radii) is the same shape, with nothing to taper.
        np.testing.assert_allclose(G.sd_round_cone(p, a, a + np.array([0.5, 0.0, 0.0]), 3.0, 1.0), np.linalg.norm(p - a, axis=1) - 3.0, atol=1e-9)
        np.testing.assert_allclose(G.sd_round_cone(p, a, a + np.array([2.0, 0.0, 0.0]), 3.0, 1.0), np.linalg.norm(p - a, axis=1) - 3.0, atol=1e-9)
        # Wider end second: the same shape as the narrower end first.
        np.testing.assert_allclose(G.sd_round_cone(p, a, b, 0.6, 2.0), G.sd_round_cone(p, b, a, 2.0, 0.6), atol=1e-9)

    def test_finite_in_the_production_domain(self):
        g = rng()
        p = g.uniform(-300, 300, size=(5000, 3))
        self.assertTrue(np.isfinite(G.sd_round_cone(p, (20.0, 0.0, 160.0), (31.0, 0.0, 178.0), 22.0, 17.0)).all())
        self.assertTrue(np.isfinite(G.sd_round_cone(p, (0.0, 0.0, 0.0), (9.2, 0.0, 0.7), 1.0, 0.85)).all())


class SmoothMinMaxTests(unittest.TestCase):
    k = 2.0

    def grid(self):
        g = rng()
        return g.uniform(-5, 5, size=20000), g.uniform(-5, 5, size=20000)

    def test_symmetric(self):
        a, b = self.grid()
        np.testing.assert_array_equal(G.smin(a, b, self.k), G.smin(b, a, self.k))
        np.testing.assert_array_equal(G.smax(a, b, self.k), G.smax(b, a, self.k))

    def test_ordinary_min_and_max_outside_the_blend_band(self):
        a, b = self.grid()
        far = np.abs(a - b) >= self.k
        np.testing.assert_array_equal(G.smin(a, b, self.k)[far], np.minimum(a, b)[far])
        np.testing.assert_array_equal(G.smax(a, b, self.k)[far], np.maximum(a, b)[far])

    def test_bounded_and_deepest_where_the_operands_meet(self):
        a, b = self.grid()
        s = G.smin(a, b, self.k)
        self.assertTrue((s <= np.minimum(a, b)).all())
        self.assertTrue((s >= np.minimum(a, b) - self.k / 4.0 - 1e-12).all())
        x = np.linspace(-3, 3, 13)
        np.testing.assert_allclose(G.smin(x, x, self.k), x - self.k / 4.0, atol=1e-12)
        m = G.smax(a, b, self.k)
        self.assertTrue((m >= np.maximum(a, b)).all())
        self.assertTrue((m <= np.maximum(a, b) + self.k / 4.0 + 1e-12).all())

    def test_shift_equivariant(self):
        a, b = self.grid()
        np.testing.assert_allclose(G.smin(a + 1.7, b + 1.7, self.k), G.smin(a, b, self.k) + 1.7, atol=1e-12)

    def test_continuous_and_smooth_through_the_band(self):
        # Along a line crossing the band, the value and its first derivative have no jump (C1), the slope stays in
        # [0, 1] for each operand, and the two partial derivatives sum to one.
        b = 0.0
        a = np.linspace(-4.0, 4.0, 160001)
        h = a[1] - a[0]
        s = G.smin(a, np.full_like(a, b), self.k)
        da = np.diff(s) / h
        self.assertLess(np.abs(np.diff(da)).max(), 1e-3)
        self.assertTrue((da >= -1e-9).all() and (da <= 1.0 + 1e-9).all())
        db = (G.smin(a, np.full_like(a, b + 1e-6), self.k) - G.smin(a, np.full_like(a, b - 1e-6), self.k)) / 2e-6
        dA = (G.smin(a + 1e-6, np.full_like(a, b), self.k) - G.smin(a - 1e-6, np.full_like(a, b), self.k)) / 2e-6
        np.testing.assert_allclose(dA + db, 1.0, atol=1e-6)

    def test_smooth_max_is_the_mirror_of_smooth_min(self):
        a, b = self.grid()
        np.testing.assert_allclose(G.smax(a, b, self.k), -G.smin(-a, -b, self.k), atol=1e-12)

    def test_no_blend_is_the_plain_operator(self):
        a, b = self.grid()
        np.testing.assert_array_equal(G.smin(a, b, 0.0), np.minimum(a, b))
        np.testing.assert_array_equal(G.smax(a, b, 0.0), np.maximum(a, b))


class ScaledTests(unittest.TestCase):
    def sphere(self, p):
        return np.linalg.norm(p, axis=1) - 2.0

    def test_identity_scale_is_the_primitive(self):
        g = rng()
        p = g.uniform(-5, 5, size=(500, 3))
        np.testing.assert_allclose(G.scaled(self.sphere, 1.0)(p), self.sphere(p), atol=1e-12)

    def test_zero_set_is_the_stretched_surface_and_signs_follow(self):
        g = rng()
        for s in (0.6, 0.92, 1.25):
            dirs = unit_rows(g.normal(size=(400, 3)))
            surface = 2.0 * dirs * np.array([1.0, s, 1.0])
            f = G.scaled(self.sphere, s)
            np.testing.assert_allclose(f(surface), 0.0, atol=1e-12)
            self.assertTrue((f(surface * 1.2) > 0).all())
            self.assertTrue((f(surface * 0.8) < 0).all())

    def test_a_distance_bound_whatever_the_stretch(self):
        # Stretching space changes distances; the result must still never overstate the distance (1-Lipschitz).
        g = rng()
        for s in (0.5, 0.92, 1.25, 2.0):
            f = G.scaled(self.sphere, s)
            p = g.uniform(-6, 6, size=(5000, 3))
            q = p + g.normal(scale=0.2, size=p.shape)
            self.assertTrue((np.abs(f(p) - f(q)) <= np.linalg.norm(p - q, axis=1) + 1e-12).all())


class ShellTests(unittest.TestCase):
    def test_a_band_of_constant_thickness_around_the_surface(self):
        g = rng()
        p = g.uniform(-6, 6, size=(5000, 3))
        d = np.linalg.norm(p, axis=1) - 3.0
        band = G.shell(d, 0.5)
        r = np.linalg.norm(p, axis=1)
        self.assertTrue((band[(r > 2.6) & (r < 3.4)] < 0).all())
        self.assertTrue((band[(r < 2.4) | (r > 3.6)] > 0).all())
        dirs = unit_rows(g.normal(size=(300, 3)))
        for radius in (2.5, 3.5):
            np.testing.assert_allclose(G.shell(np.linalg.norm(dirs * radius, axis=1) - 3.0, 0.5), 0.0, atol=1e-12)

    def test_symmetric_about_the_surface_and_one_lipschitz(self):
        x = np.linspace(-4, 4, 8001)
        np.testing.assert_allclose(G.shell(x, 0.7), G.shell(-x, 0.7), atol=0)
        self.assertLessEqual(np.abs(np.diff(G.shell(x, 0.7))).max(), (x[1] - x[0]) + 1e-12)


if __name__ == "__main__":
    unittest.main()
