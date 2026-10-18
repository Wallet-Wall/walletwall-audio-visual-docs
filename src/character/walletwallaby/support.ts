// Support plausibility: can WalletWallaby's body really be carried here?
//
// The layout declares what each drawn element offers (../../layout/terrain.ts);
// this module judges a contact against it, for a body of a given size facing a
// given way:
//
// - A stance (feet on a surface) needs a solid, upward-facing top under BOTH
//   feet, the projected centre of mass inside that top with a margin, a top of
//   meaningful thickness, the feet ON it (not inside a block, not on its side,
//   not on a drawn line), and no protected text where the feet are. A top that
//   only just holds the feet is a narrow ledge: only an explicitly authored
//   narrow perch may use it. The tail resting on the same top makes a tripod
//   and can make a perch broad; it can never carry a body the feet do not.
// - A grip (a climbing hand) needs a real lip, the corner where a solid top
//   meets its side face, within the arm's reach of the shoulder.
// - A brace (a hand against a face) needs a face that accepts one, within
//   reach, ahead of the body, while the feet themselves stand supported.
//
// Grades, best first: BROAD (wide, with room beyond both feet and for the tail)
// > LEDGE (a normal ledge or the edge of a broad top) > NARROW (authored narrow
// perches only). Selection among a lesson's authored candidate stands takes the
// best grade, then a tail on the support, then the lesson's own order; it fails
// closed when none is plausible. Nothing here moves a destination: it only
// judges the points the lesson authored.
//
// Every test is plain IEEE-754 arithmetic and comparison, with no transcendental
// function, so the Rust/WASM engine's port (motion-intelligence/src/support.rs)
// reaches the same verdict bit for bit. Isomorphic.

import { intersects, type Point, type Rect } from '../../layout/geometry.ts';
import { nearSegment, solidsOf, type SupportClass, type Terrain, type TerrainSurface } from '../../layout/terrain.ts';
import { WALLABY_HEIGHT } from './rig.ts';

/** Support geometry, body heights unless named otherwise (versioned in config/motion.json). */
export interface SupportConfig {
  /** Both feet's span behind and ahead of the stand point (heels sprung back, toes ahead). */
  footprintBackBodyHeights: number;
  footprintFrontBodyHeights: number;
  /** The projected centre of mass, ahead of the stand point. */
  comAheadBodyHeights: number;
  /** Least distance from the centre of mass to the top's nearer end: holding a perch, and touching down on the way. */
  comMarginBodyHeights: number;
  stepComMarginBodyHeights: number;
  /** A top narrower than this holds only an explicitly authored narrow perch. */
  narrowWidthBodyHeights: number;
  /** Broad support: at least this wide, with at least this much top beyond each foot, and the tail on it. */
  broadWidthBodyHeights: number;
  broadMarginBodyHeights: number;
  /** Where the resting tail tip comes down, behind the stand point. */
  tailReachBodyHeights: number;
  /** How far above the top the feet reach: no protected text may sit there. */
  contactHeightBodyHeights: number;
  /** The shoulder, above and ahead of the stand point, and how far a hand reaches from it. */
  shoulderHeightBodyHeights: number;
  shoulderAheadBodyHeights: number;
  armReachBodyHeights: number;
  /** A top thinner than this (px) is a drawn line, not a solid: never terrain. */
  minThicknessPx: number;
  /** How close (px) a point must be to a surface to be on it. */
  tolerancePx: number;
}

/** PERCH: the body settles and holds here. STEP: it touches down on the way (a takeoff, a chained bound). */
export type ContactRole = 'PERCH' | 'STEP';
export type SupportGrade = 'BROAD' | 'LEDGE' | 'NARROW';
export const GRADE_RANK: Readonly<Record<SupportGrade, number>> = { BROAD: 0, LEDGE: 1, NARROW: 2 };

export type SupportCode =
  | 'SUPPORTED'
  /** Nothing is drawn under the feet. */
  | 'NO_SURFACE'
  /** The feet are inside a solid block, not on top of it. */
  | 'INSIDE_SOLID'
  /** The feet are on a vertical face (a block's side). */
  | 'SIDE_FACE'
  /** The feet are on something drawn that is not terrain (a route line, an underline, a border, a UI capture). */
  | 'NOT_TERRAIN'
  /** The top under the feet is too thin to be a solid. */
  | 'TOO_THIN'
  /** The feet do not both fit on the top. */
  | 'FEET_UNSUPPORTED'
  /** The feet do not fit, and only the tail would touch the top. */
  | 'TAIL_ONLY'
  /** The centre of mass falls outside the top (or too near its end). */
  | 'COM_UNSUPPORTED'
  /** A narrow ledge, and the lesson did not author a narrow perch. */
  | 'NARROW_NOT_AUTHORIZED'
  /** Protected text sits where the feet touch. */
  | 'TEXT_CONTACT';
export const SUPPORT_CODES: readonly SupportCode[] = ['SUPPORTED', 'NO_SURFACE', 'INSIDE_SOLID', 'SIDE_FACE', 'NOT_TERRAIN', 'TOO_THIN', 'FEET_UNSUPPORTED', 'TAIL_ONLY', 'COM_UNSUPPORTED', 'NARROW_NOT_AUTHORIZED', 'TEXT_CONTACT'];

export interface StanceQuery {
  at: Point;
  scale: number;
  facing: 1 | -1;
  role: ContactRole;
  /** The lesson authored a narrow perch here. */
  narrowAllowed: boolean;
}

export interface SupportVerdict {
  ok: boolean;
  code: SupportCode;
  /** The surface carrying (or failing to carry) the feet, by id. */
  surface: string | null;
  support: SupportClass | null;
  grade: SupportGrade | null;
  /** Width of the top under the feet, px (0 without one). */
  widthPx: number;
  /** Both feet's span, frame px. */
  feet: { x0: number; x1: number };
  /** The projected centre of mass, frame x. */
  comX: number;
  /** Top left beyond the feet behind them and ahead of them, and beyond the centre of mass toward the nearer end, px (negative: past the end). */
  marginBackPx: number;
  marginFrontPx: number;
  comMarginPx: number;
  /** The resting tail tip comes down on the same top (a tripod), or past its end. */
  tail: 'ON_SUPPORT' | 'FREE';
  reason: string;
}

export class SupportError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'SupportError';
    this.code = code;
  }
}

/** Classes whose tops carry feet. */
const FOOTED: ReadonlySet<SupportClass> = new Set(['SUPPORTED_SURFACE', 'LEDGE', 'NARROW_LEDGE']);
/** Classes whose faces take a hand. */
const BRACEABLE: ReadonlySet<SupportClass> = new Set(['SIDE_FACE', 'OPTIONAL_BRACE']);

const isTop = (s: TerrainSurface): boolean => s.face === 'TOP';
const isFace = (s: TerrainSurface): boolean => s.face === 'LEFT' || s.face === 'RIGHT';
const finite = (v: number): boolean => Number.isFinite(v);

function checkQuery(q: StanceQuery): void {
  if (!finite(q.at.x) || !finite(q.at.y) || !finite(q.scale)) throw new SupportError('INVALID_QUERY', 'a stance needs a finite point and scale');
  if (!(q.scale > 0 && q.scale <= 4)) throw new SupportError('INVALID_QUERY', `scale ${q.scale} is outside (0, 4]`);
  if (q.facing !== 1 && q.facing !== -1) throw new SupportError('INVALID_QUERY', 'facing must be 1 or -1');
}

/** Refuse a malformed terrain (non-finite, inverted, or negative surfaces) before judging anything on it. */
export function checkTerrain(t: Terrain): void {
  for (const s of t.surfaces) {
    if (![s.x0, s.y0, s.x1, s.y1, s.thicknessPx].every(finite)) throw new SupportError('INVALID_TERRAIN', `${s.id} is not finite`);
    if (s.thicknessPx < 0) throw new SupportError('INVALID_TERRAIN', `${s.id} has a negative thickness`);
    if (s.face === 'TOP' && !(s.x1 > s.x0 && s.y0 === s.y1)) throw new SupportError('INVALID_TERRAIN', `${s.id} is not a level top with positive width`);
    if (isFace(s) && !(s.x0 === s.x1 && s.y1 > s.y0)) throw new SupportError('INVALID_TERRAIN', `${s.id} is not a vertical face`);
  }
  for (const r of t.protectedText) if (![r.x, r.y, r.w, r.h].every(finite) || r.w < 0 || r.h < 0) throw new SupportError('INVALID_TERRAIN', 'protected text is not a finite rectangle');
}

/** Strictly inside a solid (below its top, between its faces, above its bottom; or under the ground line). */
function insideSolid(t: Terrain, p: Point, tol: number): string | null {
  for (const { element, rect: r } of solidsOf(t)) {
    if (p.x > r.x + tol && p.x < r.x + r.w - tol && p.y > r.y + tol && p.y < r.y + r.h - tol) return element;
  }
  return null;
}

/** Judge one stance: feet on a top, centre of mass, thickness, text, narrow-ness, and the tail. */
export function evaluateStance(q: StanceQuery, terrain: Terrain, cfg: SupportConfig): SupportVerdict {
  checkQuery(q);
  const bh = WALLABY_HEIGHT * q.scale;
  const tol = cfg.tolerancePx;
  const back = q.at.x - q.facing * cfg.footprintBackBodyHeights * bh;
  const front = q.at.x + q.facing * cfg.footprintFrontBodyHeights * bh;
  const feet = { x0: back < front ? back : front, x1: back < front ? front : back };
  const comX = q.at.x + q.facing * cfg.comAheadBodyHeights * bh;
  const tailX = q.at.x - q.facing * cfg.tailReachBodyHeights * bh;
  const base = { feet, comX, widthPx: 0, marginBackPx: 0, marginFrontPx: 0, comMarginPx: 0, grade: null, tail: 'FREE' as const };
  const refuse = (code: SupportCode, surface: TerrainSurface | null, reason: string, extra: Partial<SupportVerdict> = {}): SupportVerdict => ({ ok: false, code, surface: surface?.id ?? null, support: surface?.support ?? null, ...base, ...extra, reason });

  // Tops level with the feet whose extent overlaps them; solids before drawn lines, then the most overlap.
  const level = terrain.surfaces.filter((s) => isTop(s) && Math.abs(s.y0 - q.at.y) <= tol && s.x1 > feet.x0 && s.x0 < feet.x1);
  const overlap = (s: TerrainSurface): number => (s.x1 < feet.x1 ? s.x1 : feet.x1) - (s.x0 > feet.x0 ? s.x0 : feet.x0);
  let top: TerrainSurface | null = null;
  for (const s of level) {
    if (!FOOTED.has(s.support)) continue;
    if (!top || overlap(s) > overlap(top)) top = s;
  }
  if (!top) {
    const drawn = level[0] ?? terrain.surfaces.find((s) => s.face === 'LINE' && nearSegment(q.at, { x: s.x0, y: s.y0 }, { x: s.x1, y: s.y1 }, tol)) ?? null;
    if (drawn) return refuse('NOT_TERRAIN', drawn, `${drawn.id} is ${drawn.support.toLowerCase().replace(/_/g, ' ')}: drawn information, not terrain`);
    const side = terrain.surfaces.find((s) => isFace(s) && Math.abs(s.x0 - q.at.x) <= tol && q.at.y > s.y0 + tol && q.at.y <= s.y1 + tol) ?? null;
    if (side) return refuse('SIDE_FACE', side, `${side.id} is a vertical face: a hand may brace on it, feet may not stand on it`);
    const inside = insideSolid(terrain, q.at, tol);
    if (inside) return refuse('INSIDE_SOLID', null, `the feet are inside ${inside}, not on top of it`);
    const tailTop = terrain.surfaces.find((s) => isTop(s) && FOOTED.has(s.support) && Math.abs(s.y0 - q.at.y) <= tol && tailX >= s.x0 && tailX <= s.x1) ?? null;
    if (tailTop) return refuse('TAIL_ONLY', tailTop, `only the tail would touch ${tailTop.id}; a tail cannot carry the body`);
    return refuse('NO_SURFACE', null, 'nothing is drawn under the feet');
  }

  const widthPx = top.x1 - top.x0;
  const marginBackPx = q.facing > 0 ? feet.x0 - top.x0 : top.x1 - feet.x1;
  const marginFrontPx = q.facing > 0 ? top.x1 - feet.x1 : feet.x0 - top.x0;
  const comMarginPx = comX - top.x0 < top.x1 - comX ? comX - top.x0 : top.x1 - comX;
  const tail = tailX >= top.x0 && tailX <= top.x1 ? ('ON_SUPPORT' as const) : ('FREE' as const);
  const measured = { widthPx, marginBackPx, marginFrontPx, comMarginPx, tail };
  if (top.thicknessPx < cfg.minThicknessPx) return refuse('TOO_THIN', top, `${top.id} is ${top.thicknessPx} px thick: a drawn edge, not a solid`, measured);
  if (feet.x0 < top.x0 || feet.x1 > top.x1) return refuse('FEET_UNSUPPORTED', top, `both feet must fit on ${top.id} (feet ${round(feet.x0)}..${round(feet.x1)}, top ${round(top.x0)}..${round(top.x1)})`, measured);
  const need = (q.role === 'PERCH' ? cfg.comMarginBodyHeights : cfg.stepComMarginBodyHeights) * bh;
  if (comMarginPx < need) return refuse('COM_UNSUPPORTED', top, `the centre of mass is ${round(comMarginPx)} px from the end of ${top.id}, under the ${round(need)} px it needs`, measured);
  const zone: Rect = { x: feet.x0, y: q.at.y - cfg.contactHeightBodyHeights * bh, w: feet.x1 - feet.x0, h: cfg.contactHeightBodyHeights * bh };
  if (terrain.protectedText.some((r) => intersects(zone, r))) return refuse('TEXT_CONTACT', top, 'protected text sits where the feet touch', measured);
  const narrow = top.support === 'NARROW_LEDGE' || widthPx < cfg.narrowWidthBodyHeights * bh;
  if (narrow && q.role === 'PERCH' && !q.narrowAllowed) return refuse('NARROW_NOT_AUTHORIZED', top, `${top.id} is a narrow ledge (${round(widthPx)} px); only an authored narrow perch may hold it`, measured);
  const broadMargin = cfg.broadMarginBodyHeights * bh;
  const grade: SupportGrade = narrow ? 'NARROW' : widthPx >= cfg.broadWidthBodyHeights * bh && marginBackPx >= broadMargin && marginFrontPx >= broadMargin && tail === 'ON_SUPPORT' ? 'BROAD' : 'LEDGE';
  return { ok: true, code: 'SUPPORTED', surface: top.id, support: top.support, grade, feet, comX, ...measured, reason: `${grade.toLowerCase()} support on ${top.id}` };
}

const round = (v: number): number => Math.round(v * 10) / 10;
/** Euclidean distance from explicit squares (sqrt is correctly rounded everywhere; hypot is not specified to be). */
const distance = (a: Point, b: Point): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
};

export interface SupportChoice {
  /** Index of the chosen candidate in the authored list. */
  index: number;
  at: Point;
  verdict: SupportVerdict;
  /** Every candidate's verdict, in authored order. */
  verdicts: SupportVerdict[];
}

/**
 * Choose among the lesson's authored candidate stands for one destination: the best grade, then a tail
 * resting on the support, then the authored order. Fails closed when no candidate is a plausible perch.
 * It can only pick one of `candidates`; it never moves one.
 */
export function selectSupport(candidates: readonly Point[], query: Omit<StanceQuery, 'at'> & { facingFor?: (at: Point) => 1 | -1 }, terrain: Terrain, cfg: SupportConfig): SupportChoice {
  if (candidates.length === 0) throw new SupportError('SUPPORT_UNAVAILABLE', 'the destination authors no stand');
  const verdicts = candidates.map((at) => evaluateStance({ at, scale: query.scale, facing: query.facingFor ? query.facingFor(at) : query.facing, role: query.role, narrowAllowed: query.narrowAllowed }, terrain, cfg));
  let best = -1;
  for (let i = 0; i < verdicts.length; i++) {
    const v = verdicts[i]!;
    if (!v.ok) continue;
    if (best < 0) {
      best = i;
      continue;
    }
    const b = verdicts[best]!;
    const dg = GRADE_RANK[v.grade!] - GRADE_RANK[b.grade!];
    if (dg < 0 || (dg === 0 && v.tail === 'ON_SUPPORT' && b.tail === 'FREE')) best = i;
  }
  if (best < 0) throw new SupportError('SUPPORT_UNAVAILABLE', `no authored stand is a plausible perch: ${verdicts.map((v, i) => `#${i} ${v.code}`).join(', ')}`);
  return { index: best, at: candidates[best]!, verdict: verdicts[best]!, verdicts };
}

// ── Hands ───────────────────────────────────────────────────────────────────

export type HandCode = 'GRIPPED' | 'BRACED' | 'NOT_A_LIP' | 'NOT_BRACEABLE' | 'BEHIND_THE_BODY' | 'OUT_OF_REACH' | 'FEET_NOT_SUPPORTED';
export const HAND_CODES: readonly HandCode[] = ['GRIPPED', 'BRACED', 'NOT_A_LIP', 'NOT_BRACEABLE', 'BEHIND_THE_BODY', 'OUT_OF_REACH', 'FEET_NOT_SUPPORTED'];
export interface HandVerdict {
  ok: boolean;
  code: HandCode;
  surface: string | null;
  reachPx: number;
  limitPx: number;
  reason: string;
}

/**
 * A climbing grip: `corner` must be a real lip (the end of a solid top that drops away into a face of the
 * same block) within the arm's reach of `shoulder`.
 */
export function evaluateGrip(corner: Point, shoulder: Point, scale: number, terrain: Terrain, cfg: SupportConfig): HandVerdict {
  const tol = cfg.tolerancePx;
  const limitPx = cfg.armReachBodyHeights * WALLABY_HEIGHT * scale;
  const reachPx = distance(corner, shoulder);
  const top = terrain.surfaces.find((s) => isTop(s) && FOOTED.has(s.support) && Math.abs(s.y0 - corner.y) <= tol && (Math.abs(s.x0 - corner.x) <= tol || Math.abs(s.x1 - corner.x) <= tol)) ?? null;
  const face = top ? terrain.surfaces.find((s) => s.element === top.element && isFace(s) && BRACEABLE.has(s.support) && Math.abs(s.x0 - corner.x) <= tol) ?? null : null;
  if (!top || !face) return { ok: false, code: 'NOT_A_LIP', surface: top?.id ?? null, reachPx, limitPx, reason: 'a grip needs the lip where a solid top meets its own side face' };
  if (reachPx > limitPx) return { ok: false, code: 'OUT_OF_REACH', surface: face.id, reachPx, limitPx, reason: `the lip is ${round(reachPx)} px from the shoulder; the arm reaches ${round(limitPx)} px` };
  return { ok: true, code: 'GRIPPED', surface: face.id, reachPx, limitPx, reason: `grips the lip of ${top.element}` };
}

/** A bracing hand: on a face that takes one, ahead of the body, within reach, while the feet stand supported. */
export function evaluateBrace(stance: StanceQuery, hand: Point, terrain: Terrain, cfg: SupportConfig): HandVerdict & { feet: SupportVerdict } {
  const feet = evaluateStance(stance, terrain, cfg);
  const bh = WALLABY_HEIGHT * stance.scale;
  const shoulder = { x: stance.at.x + stance.facing * cfg.shoulderAheadBodyHeights * bh, y: stance.at.y - cfg.shoulderHeightBodyHeights * bh };
  const limitPx = cfg.armReachBodyHeights * bh;
  const reachPx = distance(hand, shoulder);
  const tol = cfg.tolerancePx;
  const face = terrain.surfaces.find((s) => isFace(s) && Math.abs(s.x0 - hand.x) <= tol && hand.y >= s.y0 - tol && hand.y <= s.y1 + tol) ?? null;
  const out = (ok: boolean, code: HandCode, reason: string) => ({ ok, code, surface: face?.id ?? null, reachPx, limitPx, reason, feet });
  if (!feet.ok) return out(false, 'FEET_NOT_SUPPORTED', `a brace never replaces support: ${feet.reason}`);
  if (!face || !BRACEABLE.has(face.support)) return out(false, 'NOT_BRACEABLE', 'a hand braces only against a face that takes one');
  if ((hand.x - stance.at.x) * stance.facing <= 0) return out(false, 'BEHIND_THE_BODY', 'the face is behind the body');
  if (reachPx > limitPx) return out(false, 'OUT_OF_REACH', `the face is ${round(reachPx)} px from the shoulder; the arm reaches ${round(limitPx)} px`);
  return out(true, 'BRACED', `braces against ${face.id}`);
}
