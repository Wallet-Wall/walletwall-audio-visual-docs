// The WalletWall docs-video composition. Everything visible is a pure function
// of (props, current time): the timeline, scene layouts, WalletWallaby's clips
// and motion plan, and the attention direction schedule are computed once from
// the spec, then sampled per frame.
//
// Two layers. The CONTENT WORLD (the scenes with their transitions, and the
// character drawn on them) is framed as one unit by attention direction's
// bounded camera: a single transform about the frame centre, so the character
// stays registered with its support exactly. The provenance chip shares the eyebrow
// row the scene lays out, so it rides the world with it. The FIXED EDITORIAL LAYER
// (a staged depth reveal, review captions, debug guides, the
// end screen's reserved zones) is never framed.

import React, { useEffect, useMemo, useState } from 'react';
import { AbsoluteFill, cancelRender, continueRender, delayRender, Img, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { cameraAt, directionAt, framingCss, planAttention, type AttentionPlan } from '../attention/direction.ts';
import { buildCaptions } from '../audio/captions.ts';
import { TOKENS, withAlpha } from '../brand/tokens.ts';
import { choreograph, layoutsFor, mouthAt, type Clip } from '../character/walletwallaby/choreography.ts';
import { planMotion, platformOffsets, traverseProgress, type MotionPlan } from '../character/walletwallaby/motion.ts';
import { CONTENT_BOTTOM, easeInOut, TITLE_SAFE } from '../layout/geometry.ts';
import { END_SCREEN_ZONES, PROVENANCE_CHIP } from '../layout/brand-layout.ts';
import type { SceneLayout } from '../layout/scene-layout.ts';
import { bindMotionEngine, sampleWithEngine, type BoundMotionEngine } from '../motion/rust-path.ts';
import { buildTimeline, type TimedSegment, type Timeline } from '../timeline/timeline.ts';
import { BrandSegment } from './brand/BrandSegment.tsx';
import { loadBrandFonts } from './fonts.ts';
import type { DocsVideoProps } from './props.ts';
import { SceneView } from './scenes/SceneView.tsx';
import type { SceneState } from './scenes/common.tsx';
import { rectStyle, textStyle } from './style.ts';
import { MaterialContext } from './material.tsx';
import { WallabyBlender } from './wallaby/WallabyBlender.tsx';
import { WallabyRive } from './wallaby/WallabyRive.tsx';

interface Model {
  timeline: Timeline;
  layouts: Map<string, SceneLayout>;
  clips: Clip[];
  motion: MotionPlan;
  /** The Rust/WASM engine's plans for the paths it owns (none unless the render selected it), and the contacts the scene reacts to. */
  engine: BoundMotionEngine;
  /** Where the viewer's eye is guided, when (src/attention/direction.ts): derived from the same beats and layouts. */
  attention: AttentionPlan;
  captions: ReturnType<typeof buildCaptions>;
}

export function buildModel(props: DocsVideoProps): Model {
  const timeline = buildTimeline(props.spec, props.track, props.templates);
  const layouts = layoutsFor(timeline, (id) => props.headings[id] ?? '');
  const clips = choreograph(timeline, layouts);
  const motion = planMotion(clips, layouts);
  // Fails closed: an engine plan that does not answer exactly these clips stops the render.
  const engine = bindMotionEngine(props.motionEngine, motion, timeline.fps, props.spec.id);
  const attention = planAttention(timeline, layouts, clips, props.direction);
  return { timeline, layouts, clips, motion, engine, attention, captions: buildCaptions(timeline) };
}

/** `contacts`: what the platforms react to (the TypeScript plan's contacts, or the engine's on the paths it performs). */
function sceneState(seg: TimedSegment, layout: SceneLayout, motion: MotionPlan, contacts: BoundMotionEngine['contacts'], attention: AttentionPlan, ms: number): SceneState {
  const traced: Record<string, number> = {};
  for (const c of motion.clips) {
    if (c.segmentId !== seg.id || c.kind !== 'TRAVERSE' || !c.target) continue;
    // The trail fills in as WalletWallaby's feet cover it.
    traced[c.target] = ms < c.startMs ? 0 : traverseProgress(motion, c, ms);
  }
  return { ms, seg, layout, direction: directionAt(attention, seg.id, ms), routeDrawMs: attention.config.entrance.routeDrawMs, traced, platformDip: platformOffsets(motion, seg.id, ms, contacts) };
}

function transitionStyles(type: TimedSegment['transitionIn']['type'], e: number): { exit: React.CSSProperties; enter: React.CSSProperties } {
  switch (type) {
    case 'SECTION_SHIFT':
      return { exit: { transform: `translateX(${-1920 * e}px)` }, enter: { transform: `translateX(${1920 * (1 - e)}px)` } };
    case 'DEPTH_ENTER':
      // The 2D teaching plane opens backwards into depth; the deeper dimension resolves out of it.
      return {
        exit: { transform: `perspective(1500px) rotateX(${58 * e}deg) translateY(${-70 * e}px) scale(${1 - 0.2 * e})`, transformOrigin: '50% 82%', opacity: 1 - 0.95 * e },
        enter: { transform: `scale(${1.14 - 0.14 * e})`, opacity: e },
      };
    case 'DEPTH_EXIT':
      return {
        exit: { transform: `translateY(${300 * e}px) scale(${1 - 0.08 * e})`, opacity: 1 - e },
        enter: { transform: `translateY(${-220 * (1 - e)}px)`, opacity: e },
      };
    case 'CUT':
    default:
      return { exit: { opacity: 1 - e }, enter: { opacity: e } };
  }
}

export const DocsVideo: React.FC<DocsVideoProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ms = (frame * 1000) / fps;
  const [fontHandle] = useState(() => delayRender('Loading WalletWall fonts'));
  useEffect(() => {
    loadBrandFonts()
      .then(() => continueRender(fontHandle))
      .catch((err: unknown) => cancelRender(err instanceof Error ? err : new Error(String(err))));
  }, [fontHandle]);
  const model = useMemo(() => buildModel(props), [props]);
  const { timeline } = model;

  const index = Math.max(0, timeline.segments.findIndex((s) => ms >= s.startMs && ms < s.endMs));
  const seg = timeline.segments[index] ?? timeline.segments[timeline.segments.length - 1]!;
  const prev = timeline.segments[index - 1];
  const inTransition = Boolean(prev) && ms < seg.contentStartMs;
  const e = inTransition ? easeInOut((ms - seg.startMs) / (seg.contentStartMs - seg.startMs)) : 1;
  const styles = transitionStyles(seg.transitionIn.type, e);

  const renderSegment = (s: TimedSegment, at: number): React.ReactNode => {
    if (s.scene) {
      const layout = model.layouts.get(s.id)!;
      return <SceneView scene={s.scene} state={sceneState(s, layout, model.motion, model.engine.contacts, model.attention, at)} spec={props.spec} />;
    }
    const template = s.templateId ? props.templates.templates[s.templateId] : undefined;
    return template ? <BrandSegment seg={s} ms={at} spec={props.spec} template={template} docTitle={props.docTitle} provenance={props.provenance} /> : null;
  };

  const wallaby = sampleWithEngine(model.engine, model.motion, frame, ms, mouthAt(timeline, ms));
  // A staged depth reveal draws the whole frame (surfaces and character) for its range; the flat transition steps aside.
  const reveal = props.overlays.characterless ? undefined : props.depthReveals?.find((r) => frame >= r.range.first && frame <= r.range.last);
  const cue = props.overlays.captions ? model.captions.find((c) => ms >= c.startMs && ms < c.endMs) : undefined;
  const section = seg.scene ? props.headings[seg.scene.eyebrowSectionId] : undefined;
  // The content world's framing: identity (`none`) wherever attention direction frames nothing, so those frames are untouched.
  const framing = cameraAt(model.attention, ms);

  return (
    <MaterialContext.Provider value={props.material}>
    <AbsoluteFill style={{ backgroundColor: TOKENS.paper, overflow: 'hidden' }}>
      {/* The content world: scenes, their transitions, and the character, framed as ONE unit (one transform, one origin). */}
      <AbsoluteFill data-layer="content-world" style={{ transform: framingCss(framing), transformOrigin: '960px 540px' }}>
        {inTransition && prev ? <AbsoluteFill style={styles.exit}>{renderSegment(prev, prev.endMs - 1)}</AbsoluteFill> : null}
        <AbsoluteFill style={inTransition ? styles.enter : undefined}>{renderSegment(seg, ms)}</AbsoluteFill>
        {/* The provenance chip shares the eyebrow row the scene grammar lays out, so it rides the world with it (title-safe-checked like any text) and stays under the character. */}
        {seg.scene && !inTransition ? (
          <div style={{ ...rectStyle(PROVENANCE_CHIP), ...textStyle('chip', true), color: props.material.flat.text.muted, textAlign: 'right', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {`${props.spec.source.docPath.replace(/^docs\//, '')}${section ? ` § ${section}` : ''}`}
          </div>
        ) : null}
        {reveal || props.overlays.characterless ? null : props.characterRenderer ? (
          <WallabyBlender frame={frame} visible={wallaby.visible} opacity={wallaby.opacity} source={props.characterRenderer} />
        ) : (
          <WallabyRive states={[wallaby]} opacity={wallaby.opacity} />
        )}
      </AbsoluteFill>

      {/* The fixed editorial layer: never framed. */}
      {reveal ? (
        <AbsoluteFill style={{ backgroundColor: TOKENS.paper }}>
          <Img src={staticFile(`${reveal.dir}/f${String(frame).padStart(5, '0')}.png`)} style={{ position: 'absolute', left: 0, top: 0, width: 1920, height: 1080 }} />
        </AbsoluteFill>
      ) : null}

      {cue ? (
        <div style={{ position: 'absolute', left: 260, width: 1400, top: 948, display: 'flex', justifyContent: 'center' }}>
          <div style={{ ...textStyle('cardBody'), background: withAlpha(TOKENS.charcoal, 0.86), color: TOKENS.cream, padding: '8px 18px', borderRadius: 2, fontSize: 30, lineHeight: 1.3, textAlign: 'center' }}>
            {cue.rows.map((r) => (
              <div key={r}>{r}</div>
            ))}
          </div>
        </div>
      ) : null}

      {props.overlays.guides ? (
        <>
          <div style={{ ...rectStyle(TITLE_SAFE), border: `1px dashed ${TOKENS.accentWash(0.6)}` }} />
          <div style={{ position: 'absolute', left: 0, top: CONTENT_BOTTOM, width: 1920, height: 1, background: TOKENS.accentWash(0.6) }} />
          {seg.role === 'END_SCREEN'
            ? Object.entries(END_SCREEN_ZONES).map(([id, r]) => <div key={id} style={{ ...rectStyle(r), border: `2px dashed ${withAlpha(TOKENS.charcoal, 0.5)}` }} />)
            : null}
        </>
      ) : null}
    </AbsoluteFill>
    </MaterialContext.Provider>
  );
};
