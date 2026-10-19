// The lesson's motion, frame by frame, exactly as the composition samples it
// (src/remotion/DocsVideo.tsx buildModel + sampleWithEngine), turned into the
// Blender bridge and the declared terrain. Node-only (the composition itself is
// not importable from Node: it is .tsx).

import { FixtureVoiceProvider } from '../audio/voice-provider.ts';
import { choreograph, layoutsFor, mouthAt } from '../character/walletwallaby/choreography.ts';
import { planMotion, type MotionPlan, type WallabyState } from '../character/walletwallaby/motion.ts';
import { compileRig } from '../character/walletwallaby/rive/rig-compile.ts';
import { BLENDER_MOTION_SCHEMA, bridgeFrame, PLANE_ORIGIN, UNITS_PER_PX, validateBridge, type BlenderMotionDocument } from '../character/walletwallaby/blender/bridge.ts';
import { blenderTerrainDocument, type BlenderTerrainDocument } from '../character/walletwallaby/blender/terrain-export.ts';
import { loadPipelineConfig } from '../config/load.ts';
import { terrainsFor, type Terrain } from '../layout/terrain.ts';
import { typescriptEngineIdentity } from '../motion/engine-identity.ts';
import { bindMotionEngine, sampleWithEngine, type BoundMotionEngine } from '../motion/rust-path.ts';
import { planRustMotion } from '../motion/rust-adapter.ts';
import { loadCommittedSpec } from '../pipeline/context.ts';
import { loadSnapshot, synthesize } from '../pipeline/render-input.ts';
import { buildTimeline, totalFrames, type Timeline } from '../timeline/timeline.ts';
import { contentAddress } from '../core/hash.ts';

export interface LessonMotion {
  videoId: string;
  timeline: Timeline;
  motion: MotionPlan;
  engine: BoundMotionEngine;
  engineId: string;
  terrains: Map<string, Terrain>;
  frames: number;
  sample(frame: number): { state: WallabyState; segment: string; onScreen: Terrain[] };
}

export async function lessonMotion(videoId: string, engineName: 'typescript' | 'rust-wasm' = 'typescript'): Promise<LessonMotion> {
  const config = loadPipelineConfig();
  const spec = loadCommittedSpec(videoId);
  const source = loadSnapshot(spec);
  const track = await synthesize(spec, new FixtureVoiceProvider(), config);
  const timeline = buildTimeline(spec, track, config.templates);
  const headings: Record<string, string> = Object.fromEntries(source.sections.map((s) => [s.id, s.heading]));
  const layouts = layoutsFor(timeline, (id) => headings[id] ?? '');
  const clips = choreograph(timeline, layouts);
  const motion = planMotion(clips, layouts);
  const rust = engineName === 'rust-wasm' ? planRustMotion({ spec, track, templates: config.templates, headings }) : null;
  const engine = bindMotionEngine(rust?.props, motion, timeline.fps, spec.id);
  const identity = rust ? rust.identity : typescriptEngineIdentity();
  const engineId = rust ? `rust-wasm:${rust.identity.wasm.sha256.slice(0, 16)}` : `typescript:${contentAddress(identity).slice(0, 16)}`;
  const terrains = terrainsFor(timeline.segments, layouts);
  return {
    videoId,
    timeline,
    motion,
    engine,
    engineId,
    terrains,
    frames: totalFrames(timeline),
    sample(frame: number) {
      const ms = (frame * 1000) / timeline.fps;
      const state = sampleWithEngine(engine, motion, frame, ms, mouthAt(timeline, ms));
      const clip = motion.clips.find((c) => ms >= c.startMs && ms < c.endMs) ?? motion.clips[motion.clips.length - 1]!;
      // The terrain on screen, as the contact audit sees it: the clip's own segment, and the outgoing one while it transitions in.
      const i = timeline.segments.findIndex((s) => s.id === clip.segmentId);
      const ids = [clip.segmentId];
      if (i > 0 && ms < timeline.segments[i]!.contentStartMs) ids.push(timeline.segments[i - 1]!.id);
      return { state, segment: clip.segmentId, onScreen: ids.flatMap((id) => (terrains.get(id) ? [terrains.get(id)!] : [])) };
    },
  };
}

/** The bridge document for an inclusive frame range of the lesson, validated before it can reach Blender. */
export function lessonBridge(lesson: LessonMotion, first: number, last: number): BlenderMotionDocument {
  if (!Number.isInteger(first) || !Number.isInteger(last) || first < 0 || last >= lesson.frames || last < first) throw new Error(`frames ${first}..${last} are not a range of ${lesson.videoId} (0..${lesson.frames - 1})`);
  const model = compileRig().model;
  const frames = [];
  for (let f = first; f <= last; f++) {
    const { state, segment, onScreen } = lesson.sample(f);
    frames.push(bridgeFrame(model, f, segment, state, onScreen));
  }
  const doc: BlenderMotionDocument = { schema: BLENDER_MOTION_SCHEMA, videoId: lesson.videoId, fps: lesson.timeline.fps, range: { first, last }, motionEngine: lesson.engineId, coordinates: { unitsPerPx: UNITS_PER_PX, planeOrigin: { ...PLANE_ORIGIN } }, frames };
  return validateBridge(JSON.parse(JSON.stringify(doc)));
}

/** The declared terrain of every segment the bridge touches. */
export function lessonTerrain(lesson: LessonMotion, bridge: BlenderMotionDocument): BlenderTerrainDocument {
  const segments = [...new Set(bridge.frames.map((f) => f.segment))];
  return blenderTerrainDocument(lesson.terrains, segments);
}
