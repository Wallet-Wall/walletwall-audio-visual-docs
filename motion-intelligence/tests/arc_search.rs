//! The surface-aware arc search: which arc a hop flies to keep the scene's text readable. The
//! TypeScript solver is its exact oracle on the committed lesson (test/rust-motion-engine.test.ts);
//! these cases pin the search's rules on terrain built for the purpose.

mod common;

use motion_intelligence::hop::{ARC_CANDIDATES, FLIGHT_SAMPLES};
use motion_intelligence::state::MotionPhase;
use motion_intelligence::terrain::{FigureBox, Rect};
use motion_intelligence::{MotionInput, MotionPlan, Vec2, solve_motion};

/// A level hop across open ground, 1000 px at scale 1, with a window long enough for any candidate.
fn level_hop(text: Vec<Rect>) -> MotionInput {
    let mut i = common::input();
    i.start = Vec2::new(400.0, 800.0);
    i.target = Vec2::new(1400.0, 800.0);
    i.start_scale = 1.0;
    i.target_scale = 1.0;
    i.timing.start_ms = 1000.0;
    i.timing.arrive_by_ms = 2500.0;
    i.timing.end_ms = 4500.0;
    i.terrain.start = None;
    i.terrain.target = None;
    i.terrain.protected_text = text;
    i
}

fn solve(i: &MotionInput) -> MotionPlan {
    solve_motion(i).unwrap_or_else(|e| panic!("{e}"))
}

/// The highest point the feet reach in flight, px above the ground line.
fn apex(p: &MotionPlan) -> f64 {
    p.trajectory.apex_above_px
}

#[test]
fn without_protected_text_the_hop_flies_its_natural_arc() {
    let p = solve(&level_hop(Vec::new()));
    assert_eq!(p.trajectory.arc_fraction, 1.0);
    assert_eq!(p.trajectory.text_crossings, 0);
    // Natural apex: 0.3 body heights plus 0.08 px per px of distance, here 70.8 + 80 px.
    assert!((apex(&p) - 150.8).abs() < 1e-9, "{}", apex(&p));
}

#[test]
fn text_over_the_natural_arc_lowers_it_to_the_first_arc_that_clears_it() {
    // A line of text above the middle of the flight: the natural arc's figure box reaches it, a
    // lower arc passes under it.
    let text = vec![Rect {
        x: 800.0,
        y: 380.0,
        w: 200.0,
        h: 40.0,
    }];
    let p = solve(&level_hop(text));
    assert!(
        p.trajectory.arc_fraction < 1.0,
        "lowered ({})",
        p.trajectory.arc_fraction
    );
    assert_eq!(p.trajectory.text_crossings, 0, "and clear of the text");
    // The first candidate that clears it, in the search's order: every earlier one crosses.
    let k = ARC_CANDIDATES
        .iter()
        .position(|f| *f == p.trajectory.arc_fraction)
        .unwrap();
    assert!(k >= 1);
    assert!(apex(&p) < apex(&solve(&level_hop(Vec::new()))));
    // It still lands exactly on the target.
    let landed = p.samples.iter().find(|s| s.phase == MotionPhase::Contact).unwrap();
    assert!(landed.position.bits_eq(Vec2::new(1400.0, 800.0)));
}

#[test]
fn ties_keep_the_more_natural_arc() {
    // Text covering the whole frame: every candidate crosses it on every sample.
    let everywhere = vec![Rect {
        x: 0.0,
        y: 0.0,
        w: 1920.0,
        h: 1080.0,
    }];
    let p = solve(&level_hop(everywhere));
    assert_eq!(p.trajectory.arc_fraction, 1.0);
    assert_eq!(p.trajectory.text_crossings, FLIGHT_SAMPLES - 1);
}

#[test]
fn when_only_a_higher_arc_clears_low_text_it_keeps_its_height() {
    // A text block standing between the two ends: anything at or under the natural apex runs into
    // it, a higher arc clears it.
    let low = vec![Rect {
        x: 860.0,
        y: 600.0,
        w: 40.0,
        h: 50.0,
    }];
    let p = solve(&level_hop(low.clone()));
    // 1.3 x the natural apex still runs into it; 1.65 x (capped at one body height) clears it.
    assert_eq!(p.trajectory.arc_fraction, 1.65);
    assert_eq!(p.trajectory.text_crossings, 0);
    assert!(apex(&p) > apex(&solve(&level_hop(Vec::new()))));
    // In a window too short for that height at the configured gravity, the higher arc keeps its
    // height and falls under stronger gravity, within the bound.
    let mut tight = level_hop(low);
    tight.timing.arrive_by_ms = tight.timing.start_ms + 700.0;
    let q = solve(&tight);
    assert!(
        q.trajectory.arc_fraction > 1.0,
        "still raised ({})",
        q.trajectory.arc_fraction
    );
    assert!(
        q.trajectory.gravity_boost > 1.0 && q.trajectory.gravity_boost <= tight.config.max_gravity_boost,
        "gravity x{}",
        q.trajectory.gravity_boost
    );
}

#[test]
fn the_lesson_s_higher_arc_onto_a_graph_node_is_kept_with_stronger_gravity() {
    let tiers = common::fixture("tiers-land");
    let p = solve(&tiers);
    assert_eq!(p.trajectory.arc_fraction, 1.3);
    assert!(p.trajectory.gravity_boost > 1.0);
    // Positive control: with nothing to avoid, the same hop flies its natural arc at the configured gravity.
    let mut open = tiers.clone();
    open.terrain.protected_text.clear();
    let q = solve(&open);
    assert_eq!((q.trajectory.arc_fraction, q.trajectory.gravity_boost), (1.0, 1.0));
    assert!(q.trajectory.text_crossings == 0 && q.trajectory.depth_px < p.trajectory.depth_px);
}

#[test]
fn the_figure_box_and_the_overlap_test_are_the_scene_layout_s() {
    // wallabyBounds: the feet at the bottom edge, left 150 and right 100 px wide, 292 px tall at scale 1.
    let figure = FigureBox {
        left: 150.0,
        right: 100.0,
        top: 292.0,
    };
    let b = figure.at(Vec2::new(1000.0, 600.0), 0.5);
    assert_eq!((b.x, b.y, b.w, b.h), (925.0, 454.0, 125.0, 146.0));
    // intersects: positive area only; touching edges do not overlap.
    let touching = Rect {
        x: 1050.0,
        y: 454.0,
        w: 10.0,
        h: 10.0,
    };
    assert!(!b.intersects(&touching));
    let overlapping = Rect { x: 1049.0, ..touching };
    assert!(b.intersects(&overlapping) && overlapping.intersects(&b));
}
