//! Support plausibility: WalletWallaby stands, grips, and braces only where the terrain can really
//! carry him. Each refusal has its positive control, every verdict is checked through the typed API
//! and through the JSON boundary (a `walletwall.support-query/v1` document), and the engine itself
//! chooses only among the lesson's authored stands, refusing when none is plausible.

mod common;

use common::{ground, set_stand, solve_with, surface};
use motion_intelligence::config::SupportConfig;
use motion_intelligence::support::{
    BraceQuery, ContactRole, GripQuery, HandCode, HandVerdict, Judge, StanceQuery, SupportCode, SupportGrade,
    SupportVerdict, TailRest, evaluate_brace, evaluate_grip, evaluate_stance, select_support,
};
use motion_intelligence::terrain::{Face, Rect, SupportClass as S, TerrainSurface};
use motion_intelligence::{MotionErrorCode as E, Vec2, solve_json};
use serde_json::{Value, json};

const BODY_PX: f64 = 236.0;
const FRAME_BOTTOM: f64 = 1080.0;

/// A test scene: the ground, a card, a narrow pedestal, a tiny corner, the summit ledge, a 1 px
/// hairline declared as a surface, a decorative border, a text underline, and a route line.
fn scene() -> Vec<TerrainSurface> {
    let block = |id: &str, (x, y, w, h): (f64, f64, f64, f64), top: S| {
        [
            surface(&format!("{id}:top"), Face::Top, top, (x, y, x + w, y), h),
            surface(&format!("{id}:left"), Face::Left, S::SideFace, (x, y, x, y + h), w),
            surface(
                &format!("{id}:right"),
                Face::Right,
                S::SideFace,
                (x + w, y, x + w, y + h),
                w,
            ),
        ]
    };
    let mut s = vec![ground(880.0)];
    s.extend(block("card", (400.0, 500.0, 600.0, 200.0), S::SupportedSurface));
    s.extend(block("pedestal", (1100.0, 600.0, 100.0, 280.0), S::SupportedSurface));
    s.extend(block("corner", (1250.0, 650.0, 30.0, 230.0), S::SupportedSurface));
    s.extend(block("ledge", (1440.0, 600.0, 320.0, 280.0), S::Ledge));
    s.push(surface(
        "hairline:top",
        Face::Top,
        S::SupportedSurface,
        (200.0, 300.0, 380.0, 300.0),
        1.0,
    ));
    s.push(surface(
        "border:top",
        Face::Top,
        S::DecorativeEdge,
        (1300.0, 420.0, 1420.0, 420.0),
        1.0,
    ));
    s.push(surface(
        "underline:top",
        Face::Top,
        S::DecorativeEdge,
        (100.0, 200.0, 350.0, 200.0),
        2.0,
    ));
    s.push(surface(
        "route#0",
        Face::Line,
        S::NonSupporting,
        (1500.0, 300.0, 1800.0, 350.0),
        2.0,
    ));
    s
}

/// Protected text right above the card's right end.
fn text() -> Vec<Rect> {
    vec![Rect {
        x: 820.0,
        y: 440.0,
        w: 160.0,
        h: 50.0,
    }]
}

fn config() -> SupportConfig {
    common::input().config.support
}

fn stance(x: f64, y: f64, facing: i8, role: ContactRole, narrow_allowed: bool) -> StanceQuery {
    StanceQuery {
        at: Vec2::new(x, y),
        scale: 1.0,
        facing,
        role,
        narrow_allowed,
    }
}

const fn perch(x: f64, y: f64, facing: i8) -> (f64, f64, i8) {
    (x, y, facing)
}

/// The judge over the test scene with `cfg`.
fn judge<'a>(surfaces: &'a [TerrainSurface], text: &'a [Rect], cfg: &'a SupportConfig) -> Judge<'a> {
    Judge {
        surfaces,
        text,
        cfg,
        body_height_px: BODY_PX,
        frame_bottom: FRAME_BOTTOM,
    }
}

/// Answer a support query through the JSON boundary.
fn query(cfg: &SupportConfig, stances: &[StanceQuery], grips: &[GripQuery], braces: &[BraceQuery]) -> Value {
    let doc = json!({
        "schema": "walletwall.support-query/v1",
        "config": cfg,
        "bodyHeightPx": BODY_PX,
        "stage": {"width": 1920.0, "height": FRAME_BOTTOM},
        "terrain": {"surfaces": scene(), "protectedText": text()},
        "stances": stances,
        "grips": grips,
        "braces": braces,
    });
    let out = solve_json(&serde_json::to_vec(&doc).unwrap()).unwrap_or_else(|e| panic!("query refused: {e}"));
    serde_json::from_slice(&out).unwrap()
}

/// Judge one stance both ways and require the two to agree exactly.
fn judged(q: StanceQuery, cfg: &SupportConfig) -> SupportVerdict {
    let (surfaces, text) = (scene(), text());
    let direct = evaluate_stance(&q, &judge(&surfaces, &text, cfg)).unwrap();
    let report = query(cfg, &[q], &[], &[]);
    assert_eq!(report["schema"], "walletwall.support-report/v1");
    assert_eq!(
        report["stances"][0],
        serde_json::to_value(&direct).unwrap(),
        "JSON agrees with the typed API"
    );
    direct
}

fn gripped(g: GripQuery) -> HandVerdict {
    let (surfaces, text, cfg) = (scene(), text(), config());
    let direct = evaluate_grip(&g, &judge(&surfaces, &text, &cfg)).unwrap();
    assert_eq!(
        query(&cfg, &[], &[g], &[])["grips"][0],
        serde_json::to_value(&direct).unwrap()
    );
    direct
}

fn braced(b: BraceQuery) -> HandVerdict {
    let (surfaces, text, cfg) = (scene(), text(), config());
    let direct = evaluate_brace(&b, &judge(&surfaces, &text, &cfg)).unwrap();
    assert_eq!(
        query(&cfg, &[], &[], &[b])["braces"][0],
        serde_json::to_value(&direct).unwrap()
    );
    direct
}

fn refused(q: StanceQuery, want: SupportCode, what: &str) -> SupportVerdict {
    let v = judged(q, &config());
    assert!(!v.ok && v.code == want && v.grade.is_none(), "{what}: {:?}", v.code);
    v
}

// ── The nine refusals the lesson must never perform ─────────────────────────

#[test]
fn a_one_pixel_decorative_border_is_not_terrain() {
    let v = refused(
        stance(1360.0, 420.0, 1, ContactRole::Perch, false),
        SupportCode::NotTerrain,
        "border",
    );
    assert_eq!(v.surface.as_deref(), Some("border:top"));
    // A hairline declared as a surface is still too thin to be a solid.
    refused(
        stance(290.0, 300.0, 1, ContactRole::Perch, false),
        SupportCode::TooThin,
        "hairline",
    );
}

#[test]
fn a_tiny_corner_cannot_hold_both_feet() {
    let v = refused(
        stance(1265.0, 650.0, 1, ContactRole::Perch, false),
        SupportCode::FeetUnsupported,
        "corner",
    );
    assert_eq!(v.width_px, 30.0);
    // Not even as a passing step.
    refused(
        stance(1265.0, 650.0, 1, ContactRole::Step, false),
        SupportCode::FeetUnsupported,
        "corner step",
    );
}

#[test]
fn a_vertical_card_side_takes_a_hand_but_never_feet() {
    let v = refused(
        stance(400.0, 600.0, 1, ContactRole::Perch, false),
        SupportCode::SideFace,
        "card side",
    );
    assert_eq!(v.surface.as_deref(), Some("card:left"));
}

#[test]
fn a_text_underline_is_not_terrain_and_text_is_never_stood_on() {
    refused(
        stance(200.0, 200.0, 1, ContactRole::Perch, false),
        SupportCode::NotTerrain,
        "underline",
    );
    // Standing on the card right under its protected text is refused too.
    refused(
        stance(900.0, 500.0, 1, ContactRole::Perch, false),
        SupportCode::TextContact,
        "text",
    );
}

#[test]
fn a_graph_edge_is_drawn_information_not_terrain() {
    let v = refused(
        stance(1650.0, 325.0, 1, ContactRole::Step, false),
        SupportCode::NotTerrain,
        "route",
    );
    assert_eq!(v.surface.as_deref(), Some("route#0"));
}

#[test]
fn a_tail_cannot_carry_a_body_the_feet_do_not() {
    // Facing left off the ledge's left end: the feet are in the air, the tail tip would reach the ledge.
    let v = refused(
        stance(1400.0, 600.0, -1, ContactRole::Perch, false),
        SupportCode::TailOnly,
        "tail only",
    );
    assert_eq!(v.surface.as_deref(), Some("ledge:top"));
}

#[test]
fn an_unreachable_grip_is_refused() {
    let v = gripped(GripQuery {
        corner: Vec2::new(1440.0, 600.0),
        shoulder: Vec2::new(1300.0, 700.0),
        scale: 1.0,
    });
    assert!(
        !v.ok && v.code == HandCode::OutOfReach && v.reach_px > v.limit_px,
        "{v:?}"
    );
    // A corner that is not a lip (the middle of a top) is never gripped, however close.
    let v = gripped(GripQuery {
        corner: Vec2::new(1600.0, 600.0),
        shoulder: Vec2::new(1600.0, 640.0),
        scale: 1.0,
    });
    assert_eq!(v.code, HandCode::NotALip);
}

#[test]
fn feet_outside_the_support_area_are_refused() {
    let v = refused(
        stance(1460.0, 600.0, 1, ContactRole::Perch, false),
        SupportCode::FeetUnsupported,
        "heel off",
    );
    assert!(
        v.margin_back_px < 0.0,
        "the heel hangs past the lip ({})",
        v.margin_back_px
    );
}

#[test]
fn a_centre_of_mass_outside_the_ledge_is_refused() {
    // A body leaning out past the lip: the feet still fit, the centre of mass does not.
    let mut leaning = config();
    leaning.com_ahead_body_heights = 0.3;
    let v = judged(stance(1715.0, 600.0, 1, ContactRole::Perch, false), &leaning);
    assert!(!v.ok && v.code == SupportCode::ComUnsupported, "{:?}", v.code);
    assert!(v.feet.x1 <= 1760.0 && v.com_x > 1760.0);
    // Positive control: the same stand with the committed centre of mass is carried.
    assert!(judged(stance(1715.0, 600.0, 1, ContactRole::Perch, false), &config()).ok);
}

#[test]
fn the_other_refusals_have_their_own_codes() {
    refused(
        stance(1150.0, 600.0, 1, ContactRole::Perch, false),
        SupportCode::NarrowNotAuthorized,
        "narrow",
    );
    refused(
        stance(700.0, 600.0, 1, ContactRole::Perch, false),
        SupportCode::InsideSolid,
        "inside the card",
    );
    refused(
        stance(700.0, 950.0, 1, ContactRole::Step, false),
        SupportCode::InsideSolid,
        "under the ground",
    );
    refused(
        stance(300.0, 100.0, 1, ContactRole::Step, false),
        SupportCode::NoSurface,
        "mid-air",
    );
}

// ── Six positive controls ──────────────────────────────────────────────────

#[test]
fn a_broad_card_top_is_broad_support_with_the_tail_resting_on_it() {
    let v = judged(stance(600.0, 500.0, 1, ContactRole::Perch, false), &config());
    assert!(v.ok && v.grade == Some(SupportGrade::Broad), "{v:?}");
    assert_eq!((v.tail, v.surface.as_deref()), (TailRest::OnSupport, Some("card:top")));
}

#[test]
fn a_normal_ledge_holds_a_perch_near_its_lip() {
    let v = judged(stance(1500.0, 600.0, 1, ContactRole::Perch, false), &config());
    assert!(v.ok && v.grade == Some(SupportGrade::Ledge), "{v:?}");
    assert!(v.margin_back_px >= 0.0 && v.margin_back_px < 0.1 * BODY_PX);
}

#[test]
fn an_authored_narrow_perch_is_carried_as_narrow() {
    let v = judged(stance(1150.0, 600.0, 1, ContactRole::Perch, true), &config());
    assert!(v.ok && v.grade == Some(SupportGrade::Narrow), "{v:?}");
    // A passing step needs no authorization.
    assert!(judged(stance(1150.0, 600.0, 1, ContactRole::Step, false), &config()).ok);
}

#[test]
fn a_mantle_lip_within_reach_is_gripped() {
    let v = gripped(GripQuery {
        corner: Vec2::new(1440.0, 600.0),
        shoulder: Vec2::new(1400.0, 640.0),
        scale: 1.0,
    });
    assert!(
        v.ok && v.code == HandCode::Gripped && v.surface.as_deref() == Some("ledge:left"),
        "{v:?}"
    );
}

#[test]
fn feet_and_tail_make_a_tripod_on_the_ledge() {
    let v = judged(stance(1640.0, 600.0, 1, ContactRole::Perch, false), &config());
    assert!(
        v.ok && v.grade == Some(SupportGrade::Broad) && v.tail == TailRest::OnSupport,
        "{v:?}"
    );
    // Facing the other way the tail hangs past the end: still carried by the feet, but not broad.
    let w = judged(stance(1650.0, 600.0, -1, ContactRole::Perch, false), &config());
    assert!(
        w.ok && w.tail == TailRest::Free && w.grade == Some(SupportGrade::Ledge),
        "{w:?}"
    );
}

#[test]
fn a_hand_braces_a_face_only_while_the_feet_stand_supported() {
    let on_ground = stance(1360.0, 880.0, 1, ContactRole::Perch, false);
    let hand = Vec2::new(1440.0, 740.0);
    let v = braced(BraceQuery {
        stance: on_ground,
        hand,
    });
    assert!(
        v.ok && v.code == HandCode::Braced && v.surface.as_deref() == Some("ledge:left"),
        "{v:?}"
    );
    // Refusals: the feet in the air, the face behind the body, a hand on nothing.
    let cases = [
        (
            stance(1360.0, 700.0, 1, ContactRole::Perch, false),
            hand,
            HandCode::FeetNotSupported,
        ),
        (
            stance(1360.0, 880.0, -1, ContactRole::Perch, false),
            hand,
            HandCode::BehindTheBody,
        ),
        (on_ground, Vec2::new(1420.0, 740.0), HandCode::NotBraceable),
        (
            stance(1300.0, 880.0, 1, ContactRole::Perch, false),
            hand,
            HandCode::OutOfReach,
        ),
    ];
    for (s, h, want) in cases {
        let v = braced(BraceQuery { stance: s, hand: h });
        assert!(!v.ok && v.code == want, "{want:?}: {v:?}");
    }
}

// ── Selection among the lesson's authored stands ───────────────────────────

fn select(candidates: &[(f64, f64, i8)], focus: Vec2, narrow: bool) -> Result<(usize, Vec2), E> {
    let (surfaces, text, cfg) = (scene(), text(), config());
    let points: Vec<Vec2> = candidates.iter().map(|&(x, y, _)| Vec2::new(x, y)).collect();
    select_support(&points, 1.0, focus, narrow, &judge(&surfaces, &text, &cfg))
        .map(|c| (c.index, c.at))
        .map_err(|e| e.code)
}

#[test]
fn selection_takes_the_best_grade_then_the_tail_then_the_authored_order() {
    let right = Vec2::new(1900.0, 400.0);
    // Ledge (near the lip) before broad (the ledge's middle): broad wins.
    assert_eq!(
        select(&[perch(1500.0, 600.0, 1), perch(1640.0, 600.0, 1)], right, false)
            .unwrap()
            .0,
        1
    );
    // Two broad stands: the authored order wins.
    assert_eq!(
        select(&[perch(600.0, 500.0, 1), perch(700.0, 500.0, 1)], right, false)
            .unwrap()
            .0,
        0
    );
    // An implausible first choice is passed over, never moved.
    let (k, at) = select(&[perch(1265.0, 650.0, 1), perch(1640.0, 600.0, 1)], right, false).unwrap();
    assert!(k == 1 && at.bits_eq(Vec2::new(1640.0, 600.0)));
    // A narrow perch only when authored.
    assert_eq!(
        select(&[perch(1150.0, 600.0, 1)], right, false),
        Err(E::ImplausibleSupport)
    );
    assert_eq!(select(&[perch(1150.0, 600.0, 1)], right, true).unwrap().0, 0);
    // None plausible, or none at all: refused.
    assert_eq!(
        select(&[perch(1360.0, 420.0, 1), perch(1650.0, 325.0, 1)], right, false),
        Err(E::ImplausibleSupport)
    );
    assert_eq!(select(&[], right, false), Err(E::ImplausibleSupport));
}

#[test]
fn the_engine_chooses_among_the_authored_stands_and_refuses_when_none_is_plausible() {
    // The takeaway ledge (1440..1760 at y 600): the lip stand first, the tripod stand second.
    let lip = Vec2::new(1450.0, 600.0);
    let middle = Vec2::new(1640.0, 600.0);
    let p = solve_with(|i| i.destination.candidates = vec![Vec2::new(1265.0, 650.0), lip, middle]).unwrap();
    assert!(
        p.target.bits_eq(lip) || p.target.bits_eq(middle),
        "one of the authored stands, unmoved"
    );
    let k = p.support.candidate as usize;
    assert!(p.support.candidates[k].ok && !p.support.candidates[0].ok);
    assert!(p.samples.last().unwrap().position.bits_eq(p.target));
    // The best-graded stand wins over the authored order.
    let grades: Vec<_> = p.support.candidates.iter().map(|v| v.grade).collect();
    assert_eq!(grades[k], grades.iter().flatten().min().copied());
    // Every authored stand implausible: the engine refuses rather than inventing one.
    let none = solve_with(|i| i.destination.candidates = vec![Vec2::new(1900.0, 600.0), Vec2::new(1600.0, 700.0)]);
    assert_eq!(common::code(none, "no plausible stand"), E::ImplausibleSupport);
    // Positive control: the canonical single stand is carried as broad support with its takeoff judged.
    let canonical = solve_with(|_| {}).unwrap();
    assert_eq!(canonical.support.landing.verdict.grade, Some(SupportGrade::Broad));
    assert!(canonical.support.takeoff.as_ref().is_some_and(|t| t.verdict.ok));
    // And a stand moved one pixel off the ledge is refused, not snapped back onto it.
    let off = solve_with(|i| set_stand(i, Vec2::new(1600.0, 601.5)));
    assert_eq!(common::code(off, "off by a pixel and a half"), E::ImplausibleSupport);
}

/// One edit of a support query document.
type Edit = fn(&mut Value);

#[test]
fn a_support_query_is_refused_when_malformed() {
    let cfg = config();
    let base = json!({
        "schema": "walletwall.support-query/v1",
        "config": cfg,
        "bodyHeightPx": BODY_PX,
        "stage": {"width": 1920.0, "height": FRAME_BOTTOM},
        "terrain": {"surfaces": scene(), "protectedText": text()},
        "stances": [stance(600.0, 500.0, 1, ContactRole::Perch, false)],
        "grips": [],
        "braces": [],
    });
    let ok = solve_json(&serde_json::to_vec(&base).unwrap());
    assert!(ok.is_ok(), "control: the query is answered");
    let edits: [(&str, Edit); 7] = [
        ("unknown field", |v| v["wobble"] = 1.into()),
        ("missing grips", |v| {
            v.as_object_mut().unwrap().remove("grips");
        }),
        ("a stance facing nowhere", |v| v["stances"][0]["facing"] = 0.into()),
        ("a stance at scale zero", |v| v["stances"][0]["scale"] = 0.0.into()),
        ("a stance given as a list", |v| {
            v["stances"][0] = json!([[600, 500], 1, 1, "PERCH", false])
        }),
        ("an inverted top", |v| v["terrain"]["surfaces"][1]["x1"] = 0.0.into()),
        ("an absurd body", |v| v["bodyHeightPx"] = 1.0.into()),
    ];
    for (name, edit) in edits {
        let mut v = base.clone();
        edit(&mut v);
        let r = solve_json(&serde_json::to_vec(&v).unwrap());
        assert!(matches!(r, Err(ref e) if e.code == E::InvalidInput), "{name}: {r:?}");
    }
}
