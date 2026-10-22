// WalletWall-owned brand segments. Copy comes only from config/copy-templates.json
// and the spec's source binding; branding stays short so content dominates. The
// outro address is set in WalletWall terracotta.

import React from 'react';
import { AbsoluteFill, Img, staticFile } from 'remotion';
import { TOKENS } from '../../brand/tokens.ts';
import { BRAND_GROUND, CTA_TEXT, DOCS_CARD, END_SCREEN_LABEL, END_SCREEN_ZONES, OUTRO_MARK, OUTRO_TEXT } from '../../layout/brand-layout.ts';
import type { CopyTemplate } from '../../config/types.ts';
import type { VideoSpec } from '../../spec/types.ts';
import type { TimedSegment } from '../../timeline/timeline.ts';
import { rectStyle, settle, textStyle } from '../style.ts';
import { Platform } from '../scenes/common.tsx';
import { Ground } from '../scenes/terrain-art.tsx';
import { useMaterial } from '../material.tsx';

interface BrandProps {
  seg: TimedSegment;
  ms: number;
  spec: VideoSpec;
  template: CopyTemplate;
  docTitle: string;
  provenance: { blob: string; contentHash: string };
}

/** The spec's declared, hash-verified BRAND_MARK asset as staged in the bundle, or null when it declares none. */
export function brandMark(spec: VideoSpec): string | null {
  const mark = spec.assets.find((a) => a.kind === 'BRAND_MARK');
  return mark ? staticFile(`${spec.id}/${mark.id}${mark.path.slice(mark.path.lastIndexOf('.'))}`) : null;
}

export const BrandSegment: React.FC<BrandProps> = ({ seg, ms, spec, template, docTitle, provenance }) => {
  const t0 = seg.contentStartMs;
  const mark = brandMark(spec);
  const m = useMaterial();
  const ink = m.flat.text.ink;
  switch (seg.role) {
    case 'CTA':
      return (
        <AbsoluteFill>
          <Ground {...BRAND_GROUND.CTA} />
          <div style={{ ...rectStyle(CTA_TEXT), ...textStyle('cardHeading', false, ink), ...settle(ms, t0) }}>{template.onScreen}</div>
        </AbsoluteFill>
      );
    case 'DOCS_REFERENCE': {
      const url = spec.source.docUrl.replace(/^https?:\/\//, '');
      return (
        <AbsoluteFill>
          <Ground {...BRAND_GROUND.DOCS_REFERENCE} />
          <Platform rect={DOCS_CARD} />
          <div style={{ position: 'absolute', left: DOCS_CARD.x + 56, top: DOCS_CARD.y + 52, width: DOCS_CARD.w - 112, ...settle(ms, t0) }}>
            <div style={{ ...textStyle('eyebrow'), color: TOKENS.terracotta }}>{template.onScreen}</div>
            <div style={{ ...textStyle('cardHeading', false, ink), marginTop: 26 }}>{docTitle}</div>
            <div style={{ ...textStyle('cardBody', true, ink), fontSize: 30, color: m.flat.text.link, marginTop: 30 }}>{url}</div>
            <div style={{ ...textStyle('chip', true), color: m.flat.text.muted, marginTop: 44 }}>
              {`doc blob ${provenance.blob.slice(0, 7)} · content ${provenance.contentHash.slice(0, 12)} · video r${spec.revision}`}
            </div>
          </div>
        </AbsoluteFill>
      );
    }
    case 'OUTRO':
      return (
        <AbsoluteFill>
          <Ground {...BRAND_GROUND.OUTRO} />
          {mark ? <Img src={mark} style={{ ...rectStyle(OUTRO_MARK), objectFit: 'contain', ...settle(ms, t0, 420) }} /> : null}
          <div style={{ ...rectStyle(OUTRO_TEXT), ...textStyle('graphCaption', false, ink), textAlign: 'center', color: TOKENS.terracotta, ...settle(ms, t0 + 200) }}>{template.onScreen}</div>
        </AbsoluteFill>
      );
    case 'END_SCREEN':
      return (
        <AbsoluteFill>
          {/* The sign-off's own stretch of ground: WalletWallaby stands on it, clear of the reserved zones. */}
          <Ground {...BRAND_GROUND.END_SCREEN} />
          <div style={{ ...rectStyle(END_SCREEN_LABEL), ...textStyle('eyebrow'), color: TOKENS.terracotta }}>{template.onScreen}</div>
          {/* Reserved zones stay empty: YouTube places end-screen elements here. */}
          {Object.entries(END_SCREEN_ZONES).map(([id, r]) => (
            <div key={id} data-zone={id} style={{ ...rectStyle(r) }} />
          ))}
        </AbsoluteFill>
      );
    default:
      return null;
  }
};
