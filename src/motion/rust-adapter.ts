// The Rust/WASM Motion Intelligence adapter (Node): load the committed engine, turn the lesson's
// motion intent into engine input, call the engine, and validate everything it returns. It fails
// closed and never falls back: a path selected for the engine is performed by the engine, or the
// render stops. There is no trajectory mathematics and no support reasoning here; the engine owns
// both. Before a rust-wasm render the engine also judges every contact the lesson makes, and its
// verdicts must equal the transitional TypeScript judge's, bit for bit.
//
//   validate input (finite, JSON-safe) -> mi_input/mi_solve over a zero-import module ->
//   decode -> refusal (MotionEngineError with the engine's code) | plan -> validateMotionPlan
//                                                                  | report -> validateSupportReport

import { isDeepStrictEqual } from 'node:util';
import { choreograph, layoutsFor } from '../character/walletwallaby/choreography.ts';
import { judgeContacts, type JudgedContact, type SegmentWindow } from '../character/walletwallaby/contacts.ts';
import { FRAME } from '../layout/geometry.ts';
import { terrainsFor, type Terrain } from '../layout/terrain.ts';
import { planMotion } from '../character/walletwallaby/motion.ts';
import type { CopyTemplates } from '../config/types.ts';
import { sha256Hex } from '../core/hash.ts';
import type { VideoSpec } from '../spec/types.ts';
import { buildTimeline, type NarrationTrack } from '../timeline/timeline.ts';
import { ABI_FUNCTIONS, ABI_VERSION, assertHermetic, loadVerifiedArtifact, MOTION_WASM_REL, type ArtifactManifest } from './artifact.ts';
import { rustEngineIdentity, type EngineContactAudit, type RustMotionEngineIdentity } from './engine-identity.ts';
import { assertJsonSafe, ENGINE_REFUSAL_CODES, expectationFor, MotionEngineError, SUPPORT_QUERY_SCHEMA, validateMotionPlan, validateSupportReport, type MotionErrorCode, type MotionIntelligenceConfig, type MotionInput, type MotionPlan, type SupportQuery, type SupportReport } from './plan.ts';
import { bindMotionEngine, engineOwnedEvents, findRustPaths, motionInputForPath, MOTION_INTELLIGENCE_CONFIG, type BoundMotionEngine, type MotionEngineProps, type RustPathSelection } from './rust-path.ts';

interface EngineExports {
  memory: WebAssembly.Memory;
  mi_abi_version(): number;
  mi_input(len: number): number;
  mi_solve(): number;
  mi_output_ptr(): number;
  mi_output_len(): number;
}

export interface SolvedPlan {
  plan: MotionPlan;
  /** The exact bytes the engine returned. */
  bytes: Uint8Array;
  sha256: string;
}

/** One instance of the engine. Not reentrant (one solve at a time), and nothing it returns aliases its memory. */
export class RustMotionEngine {
  readonly manifest: ArtifactManifest;
  #module: WebAssembly.Module;
  #instance: WebAssembly.Instance;

  /** The committed, manifest-verified artifact. */
  static load(): RustMotionEngine {
    const { bytes, manifest } = loadVerifiedArtifact();
    return new RustMotionEngine(bytes, manifest);
  }

  constructor(bytes: Uint8Array<ArrayBuffer>, manifest: ArtifactManifest) {
    assertHermetic(bytes, MOTION_WASM_REL);
    this.manifest = manifest;
    this.#module = new WebAssembly.Module(bytes);
    this.#instance = new WebAssembly.Instance(this.#module, {});
    const abi = this.#exports().mi_abi_version();
    if (abi !== ABI_VERSION) throw new MotionEngineError('ENGINE_UNAVAILABLE', `the engine speaks ABI v${abi}; this adapter speaks v${ABI_VERSION}`);
  }

  #exports(): EngineExports {
    const ex = this.#instance.exports as unknown as EngineExports;
    for (const name of ABI_FUNCTIONS) if (typeof ex[name] !== 'function') throw new MotionEngineError('ENGINE_UNAVAILABLE', `the engine does not export ${name}`);
    return ex;
  }

  /**
   * One raw call across the boundary: the input document's bytes in, the status and the output
   * document's bytes out (copied out of engine memory). A trap is a refusal, and the next call
   * starts from a fresh instance.
   */
  solveBytes(input: Uint8Array): { status: number; output: Uint8Array } {
    const ex = this.#exports();
    try {
      const ptr = ex.mi_input(input.length) >>> 0;
      if (ptr === 0) throw new MotionEngineError('INVALID_INPUT', `the engine refused to reserve a ${input.length}-byte input`);
      new Uint8Array(ex.memory.buffer, ptr, input.length).set(input);
      const status = ex.mi_solve() >>> 0;
      // Read the buffer only after the call: memory growth detaches the old one.
      const output = new Uint8Array(ex.memory.buffer, ex.mi_output_ptr() >>> 0, ex.mi_output_len() >>> 0).slice();
      return { status, output };
    } catch (err) {
      if (err instanceof MotionEngineError) throw err;
      this.#instance = new WebAssembly.Instance(this.#module, {});
      throw new MotionEngineError('ENGINE_FAULT', `the engine trapped: ${(err as Error).message}`);
    }
  }

  /** One document across the boundary: the decoded answer, or the engine's refusal as a MotionEngineError. */
  #answer(document: unknown): { doc: unknown; output: Uint8Array } {
    assertJsonSafe(document);
    const { status, output } = this.solveBytes(new TextEncoder().encode(JSON.stringify(document)));
    let doc: unknown;
    try {
      doc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(output));
    } catch {
      throw new MotionEngineError('ENGINE_FAULT', 'the engine returned a document that is not UTF-8 JSON');
    }
    if (status === 1) {
      const e = (doc as { error?: { code?: unknown; message?: unknown } }).error;
      if (e && ENGINE_REFUSAL_CODES.includes(e.code as MotionErrorCode) && typeof e.message === 'string') throw new MotionEngineError(e.code as MotionErrorCode, e.message);
      throw new MotionEngineError('ENGINE_FAULT', 'the engine refused with a malformed error document');
    }
    if (status !== 0) throw new MotionEngineError('ENGINE_FAULT', `the engine returned status ${status}`);
    return { doc, output };
  }

  /** Judge stances, grips, and braces with the engine's support judge. Throws MotionEngineError on any refusal; returns only a validated report. */
  judge(query: SupportQuery): SupportReport {
    const report = validateSupportReport(this.#answer(query).doc, query);
    if (report.engine.version !== this.manifest.crate.version) throw new MotionEngineError('INVALID_PLAN', `the report was made by ${report.engine.version}, the artifact manifest names ${this.manifest.crate.version}`);
    return report;
  }

  /** Solve one input. Throws MotionEngineError on any refusal; returns only a validated plan. */
  solve(input: MotionInput): SolvedPlan {
    const { doc, output } = this.#answer(input);
    const plan = validateMotionPlan(doc, expectationFor(input));
    if (plan.engine.version !== this.manifest.crate.version) throw new MotionEngineError('INVALID_PLAN', `the plan was made by ${plan.engine.version}, the artifact manifest names ${this.manifest.crate.version}`);
    return { plan, bytes: output, sha256: sha256Hex(output) };
  }
}

export interface RustPathInput {
  selection: RustPathSelection;
  input: MotionInput;
}

/** The engine input for every path the video selects, in clip order (fails closed on an ineligible path), with the plan, terrain, and segments they came from. */
export function rustInputsFor(args: { spec: VideoSpec; track: NarrationTrack; templates: CopyTemplates; headings: Record<string, string> }): { inputs: RustPathInput[]; ts: ReturnType<typeof planMotion>; fps: number; terrains: Map<string, Terrain>; segments: readonly SegmentWindow[] } {
  const timeline = buildTimeline(args.spec, args.track, args.templates);
  const layouts = layoutsFor(timeline, (id) => args.headings[id] ?? '');
  const ts = planMotion(choreograph(timeline, layouts), layouts);
  const paths = findRustPaths(ts, args.spec.id);
  if (!paths.length) throw new MotionEngineError('INELIGIBLE_PATH', `${args.spec.id} selects no path for the Rust engine`);
  const muted = engineOwnedEvents(paths);
  const terrains = terrainsFor(timeline.segments, layouts);
  const inputs = paths.map((p) => ({ selection: p.selection, input: motionInputForPath(p, ts, terrains, timeline.segments, args.spec.output, muted, MOTION_INTELLIGENCE_CONFIG) }));
  return { inputs, ts, fps: timeline.fps, terrains, segments: timeline.segments };
}

/** Where one contact's verdict sits in the engine's report for one terrain. */
interface Slot {
  id: string;
  list: 'stances' | 'grips';
  k: number;
}

/** A judged contact's verdict without its prose (and a brace's without its feet), as the engine states it. */
const plain = (c: JudgedContact): unknown => {
  const v = c.hand ?? c.stance;
  if (!v) return null;
  const { reason: _reason, ...rest } = v as typeof v & { feet?: unknown };
  if (c.hand) delete (rest as { feet?: unknown }).feet;
  return rest;
};

/**
 * The engine judges every contact a lesson's plan makes, not only the hops it performs: each against the
 * terrain on screen at its instant (its segment's, and the outgoing segment's while that one transitions in),
 * by the same rule as the transitional TypeScript audit (../character/walletwallaby/contacts.ts). The two
 * judges must agree on every verdict and on the terrain that carried it, bit for bit (SUPPORT_MISMATCH), and
 * every contact must be carried (IMPLAUSIBLE_SUPPORT). One query per terrain holds every contact judged on it.
 */
export function auditContactsWithEngine(engine: RustMotionEngine, ts: ReturnType<typeof planMotion>, terrains: ReadonlyMap<string, Terrain>, segments: readonly SegmentWindow[], config: MotionIntelligenceConfig = MOTION_INTELLIGENCE_CONFIG): EngineContactAudit {
  const judged = judgeContacts(ts, terrains, segments, config.support);
  const index = new Map(segments.map((s, i) => [s.id, i]));
  const queries = new Map<string, SupportQuery>();
  /** Per contact, in visible order: the terrain and the slot of its verdict in that terrain's query. */
  const slots = judged.map((c): Slot[] => {
    if (c.offStage) return [];
    const i = index.get(c.segmentId);
    const own = i === undefined ? undefined : segments[i];
    const visible = own ? [own.id, ...(i! > 0 && c.atMs < own.contentStartMs ? [segments[i! - 1]!.id] : [])] : [];
    return visible.flatMap((id): Slot[] => {
      const t = terrains.get(id);
      if (!t) return [];
      let q = queries.get(id);
      if (!q) {
        q = { schema: SUPPORT_QUERY_SCHEMA, config: config.support, bodyHeightPx: config.bodyHeightPx, stage: { width: FRAME.width, height: FRAME.height }, terrain: { surfaces: t.surfaces, protectedText: t.protectedText.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h })) }, stances: [], grips: [], braces: [] };
        queries.set(id, q);
      }
      if (c.kind === 'GRIP') return [{ id, list: 'grips' as const, k: q.grips.push({ corner: { x: c.at.x, y: c.at.y }, shoulder: { x: c.shoulder!.x, y: c.shoulder!.y }, scale: c.scale }) - 1 }];
      return [{ id, list: 'stances' as const, k: q.stances.push({ at: { x: c.at.x, y: c.at.y }, scale: c.scale, facing: c.facing, role: c.role, narrowAllowed: false }) - 1 }];
    });
  });
  const reports = new Map([...queries].map(([id, q]) => [id, engine.judge(q)]));
  judged.forEach((c, n) => {
    const at = `${c.segmentId} ${c.kind} ${c.action} at (${c.at.x}, ${c.at.y}) t=${c.atMs}`;
    const verdicts = slots[n]!.map((s) => ({ id: s.id, v: reports.get(s.id)![s.list][s.k]! }));
    const chosen = verdicts.find((x) => x.v.ok) ?? verdicts[0] ?? null;
    if ((chosen?.id ?? null) !== c.terrainOf || !isDeepStrictEqual(chosen?.v ?? null, plain(c))) {
      throw new MotionEngineError('SUPPORT_MISMATCH', `${at}: the engine judged ${JSON.stringify(chosen)}, the TypeScript judge ${JSON.stringify({ id: c.terrainOf, v: plain(c) })}`);
    }
    if (!c.offStage && !chosen?.v.ok) throw new MotionEngineError('IMPLAUSIBLE_SUPPORT', `${at}: the terrain on screen does not carry it (${chosen?.v.code ?? 'no terrain'})`);
  });
  return { contacts: judged.length, offStage: judged.filter((c) => c.offStage).length, queries: queries.size };
}

export interface RustMotion {
  props: MotionEngineProps;
  identity: RustMotionEngineIdentity;
  /** The plans bound exactly as the composition binds them (its contacts time the scene's reactions, the cue sheet included). */
  bound: BoundMotionEngine;
}

/**
 * Plan every engine path of a video before rendering: solve each with the committed engine, then
 * bind the plans exactly as the composition will, so a plan the composition would refuse stops the
 * render here, before any frame is drawn.
 */
export function planRustMotion(args: { spec: VideoSpec; track: NarrationTrack; templates: CopyTemplates; headings: Record<string, string> }, engine: RustMotionEngine = RustMotionEngine.load()): RustMotion {
  const { inputs, ts, fps, terrains, segments } = rustInputsFor(args);
  const solved = inputs.map(({ selection, input }) => ({ selection, ...engine.solve(input) }));
  // Every contact of the lesson, judged by the engine itself, in agreement with the TypeScript judge.
  const support = auditContactsWithEngine(engine, ts, terrains, segments);
  const props: MotionEngineProps = {
    schema: 'walletwall.motion-engine-props/v2',
    engine: 'rust-wasm',
    paths: solved.map((s) => ({ segmentId: s.selection.segmentId, clip: s.selection.clip, action: s.selection.action, plan: s.plan })),
  };
  const bound = bindMotionEngine(props, ts, fps, args.spec.id);
  return {
    props,
    identity: rustEngineIdentity(
      engine.manifest,
      solved.map((s) => ({ segmentId: s.selection.segmentId, clip: s.selection.clip, action: s.selection.action, frames: { first: s.plan.frames.first, count: s.plan.frames.count }, planSha256: s.sha256 })),
      support,
    ),
    bound,
  };
}
