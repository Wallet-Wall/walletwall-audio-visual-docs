// Scene renderers. Each draws exactly the regions computed by
// src/layout/scene-layout.ts, so what validation measured is what appears.

import React from 'react';
import { AbsoluteFill, Img, staticFile } from 'remotion';
import { TOKENS } from '../../brand/tokens.ts';
import type { Point } from '../../layout/geometry.ts';
import { EYEBROW_RECT, SUMMIT_LEDGE, type Route } from '../../layout/scene-layout.ts';
import type { CardScene, GraphScene, SceneSpec, TakeawayScene, UiScene, VideoSpec } from '../../spec/types.ts';
import { rectStyle, settle, textStyle } from '../style.ts';
import { Attention, BrickMarker, dipStyle, Ground, Masonry, Platform, regionFor, TextAt, type SceneState } from './common.tsx';

export const SceneView: React.FC<{ scene: SceneSpec; state: SceneState; spec: VideoSpec }> = ({ scene, state, spec }) => {
  const eyebrow = regionFor(state.layout, 'eyebrow');
  return (
    <AbsoluteFill>
      {scene.plane === 'SURFACE' ? <Ground /> : null}
      {eyebrow ? <div style={{ ...rectStyle(EYEBROW_RECT), ...textStyle('eyebrow'), color: TOKENS.terracotta }}>{eyebrow.text}</div> : null}
      {scene.type === 'CARD' ? <CardView scene={scene} state={state} /> : null}
      {scene.type === 'GRAPH' && scene.layout !== 'LAYERED' ? <RouteView scene={scene} state={state} /> : null}
      {scene.type === 'GRAPH' && scene.layout === 'LAYERED' ? <LayeredView scene={scene} state={state} /> : null}
      {scene.type === 'UI' ? <UiView scene={scene} state={state} spec={spec} /> : null}
      {scene.type === 'TAKEAWAY' ? <TakeawayView scene={scene} state={state} /> : null}
    </AbsoluteFill>
  );
};

const CardView: React.FC<{ scene: CardScene; state: SceneState }> = ({ scene, state }) => {
  const card = state.layout.platforms.find((p) => p.kind === 'CARD')!;
  const items = [scene.heading, ...scene.body];
  return (
    <div style={{ position: 'absolute', inset: 0, ...dipStyle(state, card.id) }}>
      <Platform rect={card.rect} />
      {scene.layout === 'SPLIT' && scene.body.length === 2
        ? (() => {
            const top = regionFor(state.layout, scene.body[0]!.id)!.rect.y;
            const bottom = card.rect.y + card.rect.h - 40;
            return <div style={{ position: 'absolute', left: card.rect.x + card.rect.w / 2, top, width: 1, height: bottom - top, background: TOKENS.charcoalBorder }} />;
          })()
        : null}
      {items.map((el) => {
        const r = regionFor(state.layout, el.id);
        return <Attention key={`a-${el.id}`} rect={r?.rect} on={state.attention.has(el.id)} resolved={state.resolved.has(el.id)} />;
      })}
      {items.map((el, i) => {
        const r = regionFor(state.layout, el.id);
        const reveal = settle(state.ms, state.seg.reveals[el.id]);
        return (
          <React.Fragment key={el.id}>
            {i > 0 && r && scene.layout === 'STACK' ? <BrickMarker x={r.rect.x - 30} y={r.rect.y + 17} opacity={reveal.opacity} /> : null}
            <TextAt region={r} state={state} />
          </React.Fragment>
        );
      })}
    </div>
  );
};

function routePath(route: Route): string {
  const [a, ...rest] = route.points;
  if (!a) return '';
  if (route.selfLoop && rest.length === 3) {
    const [c1, c2, b] = rest as [Point, Point, Point];
    return `M ${a.x} ${a.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${b.x} ${b.y}`;
  }
  if (rest.length !== 2) return `M ${a.x} ${a.y} ${rest.map((p) => `L ${p.x} ${p.y}`).join(' ')}`;
  const [mid, b] = rest as [Point, Point];
  return `M ${a.x} ${a.y} Q ${mid.x} ${mid.y - 24} ${b.x} ${b.y}`;
}

const Routes: React.FC<{ routes: Route[]; state: SceneState }> = ({ routes, state }) => (
  <svg style={{ position: 'absolute', inset: 0 }} width={1920} height={1080} viewBox="0 0 1920 1080">
    {routes.map((route) => {
      const shown = settle(state.ms, state.seg.reveals[route.id]).opacity;
      const traced = state.traced[route.id] ?? 0;
      const d = routePath(route);
      return (
        <g key={route.id} opacity={shown} fill="none">
          <path d={d} stroke={TOKENS.charcoalRail} strokeWidth={2} strokeDasharray="7 9" />
          {traced > 0 ? <path d={d} stroke={TOKENS.terracotta} strokeWidth={3} pathLength={1} strokeDasharray={`${traced} 1`} /> : null}
          {(() => {
            const end = route.points[route.points.length - 1]!;
            return <rect x={end.x - 5} y={end.y - 5} width={10} height={10} fill={traced >= 1 ? TOKENS.terracotta : TOKENS.surface} stroke={TOKENS.charcoalRail} />;
          })()}
        </g>
      );
    })}
  </svg>
);

const RouteView: React.FC<{ scene: GraphScene; state: SceneState }> = ({ scene, state }) => (
  <>
    <TextAt region={scene.caption ? regionFor(state.layout, scene.caption.id) : undefined} state={state} />
    {state.layout.platforms
      .filter((p) => p.kind === 'PILLAR')
      .map((p) => {
        const nodeId = p.id.slice('pillar:'.length);
        return (
          <div key={p.id} style={{ opacity: settle(state.ms, state.seg.reveals[nodeId]).opacity }}>
            <Masonry rect={p.rect} />
          </div>
        );
      })}
    <Routes routes={state.layout.routes} state={state} />
    {scene.nodes.map((n) => {
      const platform = state.layout.platforms.find((p) => p.id === `node:${n.id}`)!;
      const reveal = settle(state.ms, state.seg.reveals[n.id]);
      const focus = state.attention.has(n.id);
      return (
        <div key={n.id} style={{ ...reveal, ...dipStyle(state, `node:${n.id}`, reveal.transform) }}>
          <Platform rect={platform.rect} style={focus ? { borderTop: `3px solid ${TOKENS.terracotta}` } : {}} />
          <TextAt region={regionFor(state.layout, n.id)} state={state} />
          <TextAt region={n.detail ? regionFor(state.layout, n.detail.id) : undefined} state={state} color={TOKENS.inkMuted} />
        </div>
      );
    })}
  </>
);

const LayeredView: React.FC<{ scene: GraphScene; state: SceneState }> = ({ scene, state }) => (
  <>
    <svg style={{ position: 'absolute', inset: 0 }} width={1920} height={1080} viewBox="0 0 1920 1080">
      {state.layout.slabs.map((slab) => {
        const [tl, tr, br, bl] = slab.corners;
        const courses = [0.34, 0.67].map((f) => ({ a: { x: tl.x + (bl.x - tl.x) * f, y: tl.y + (bl.y - tl.y) * f }, b: { x: tr.x + (br.x - tr.x) * f, y: tr.y + (br.y - tr.y) * f } }));
        return (
          <g key={slab.id}>
            <polygon points={slab.corners.map((p) => `${p.x},${p.y}`).join(' ')} fill={TOKENS.stone} fillOpacity={slab.id === 'upper' ? 0.32 : 0.45} stroke={TOKENS.charcoalBorder} />
            {courses.map((c, i) => (
              <line key={i} x1={c.a.x} y1={c.a.y} x2={c.b.x} y2={c.b.y} stroke={TOKENS.stoneLow} strokeOpacity={0.45} />
            ))}
          </g>
        );
      })}
    </svg>
    <TextAt region={scene.caption ? regionFor(state.layout, scene.caption.id) : undefined} state={state} />
    <Routes routes={state.layout.routes} state={state} />
    {scene.nodes.map((n) => {
      const platform = state.layout.platforms.find((p) => p.id === `node:${n.id}`)!;
      const reveal = settle(state.ms, state.seg.reveals[n.id]);
      return (
        <div key={n.id} style={{ ...reveal, ...dipStyle(state, `node:${n.id}`, reveal.transform) }}>
          <Platform rect={platform.rect} style={state.attention.has(n.id) ? { borderTop: `3px solid ${TOKENS.terracotta}` } : {}} />
          <TextAt region={regionFor(state.layout, n.id)} state={state} />
          <TextAt region={n.detail ? regionFor(state.layout, n.detail.id) : undefined} state={state} color={TOKENS.inkMuted} />
        </div>
      );
    })}
  </>
);

const UiView: React.FC<{ scene: UiScene; state: SceneState; spec: VideoSpec }> = ({ scene, state, spec }) => {
  const frame = state.layout.platforms.find((p) => p.kind === 'FRAME')!;
  const asset = spec.assets.find((a) => a.id === scene.assetId);
  const ext = asset ? asset.path.slice(asset.path.lastIndexOf('.')) : '';
  return (
    <>
      <TextAt region={regionFor(state.layout, scene.caption.id)} state={state} />
      <Platform rect={frame.rect} style={{ overflow: 'hidden', ...settle(state.ms, state.seg.reveals['ui:capture']) }}>
        {asset ? <Img src={staticFile(`${spec.id}/${asset.id}${ext}`)} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : null}
      </Platform>
    </>
  );
};

const TakeawayView: React.FC<{ scene: TakeawayScene; state: SceneState }> = ({ scene, state }) => (
  <>
    <div style={{ position: 'absolute', inset: 0, ...dipStyle(state, 'ledge') }}>
      <Masonry rect={SUMMIT_LEDGE} course={30} />
    </div>
    {[scene.statement, ...scene.support].map((el) => (
      <Attention key={`a-${el.id}`} rect={regionFor(state.layout, el.id)?.rect} on={state.attention.has(el.id)} resolved={state.resolved.has(el.id)} />
    ))}
    <TextAt region={regionFor(state.layout, scene.statement.id)} state={state} />
    {scene.support.map((el) => {
      const r = regionFor(state.layout, el.id);
      return (
        <React.Fragment key={el.id}>
          {r ? <BrickMarker x={r.rect.x} y={r.rect.y - 14} opacity={settle(state.ms, state.seg.reveals[el.id]).opacity} /> : null}
          <TextAt region={r} state={state} color={TOKENS.inkMuted} />
        </React.Fragment>
      );
    })}
  </>
);
