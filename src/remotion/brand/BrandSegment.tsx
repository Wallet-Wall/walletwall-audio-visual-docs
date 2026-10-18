// WalletWall-owned brand segments. Copy comes only from config/copy-templates.json
// and the spec's source binding; branding stays short so content dominates. The
// ident wordmark and the outro address are set in WalletWall terracotta.

import React from 'react';
import { AbsoluteFill, Img, staticFile } from 'remotion';
import { TOKENS } from '../../brand/tokens.ts';
import { CTA_TEXT, DOCS_CARD, END_SCREEN_LABEL, END_SCREEN_ZONES, IDENT_MARK, IDENT_WORDMARK, OUTRO_MARK, OUTRO_TEXT } from '../../layout/brand-layout.ts';
import type { CopyTemplate } from '../../config/types.ts';
import type { VideoSpec } from '../../spec/types.ts';
import type { TimedSegment } from '../../timeline/timeline.ts';
import { rectStyle, settle, textStyle } from '../style.ts';
import { Ground, Platform } from '../scenes/common.tsx';

interface BrandProps {
  seg: TimedSegment;
  ms: number;
  spec: VideoSpec;
  template: CopyTemplate;
  docTitle: string;
  provenance: { blob: string; contentHash: string };
}

function brandMark(spec: VideoSpec): string | null {
  const mark = spec.assets.find((a) => a.kind === 'BRAND_MARK');
  return mark ? staticFile(`${spec.id}/${mark.id}${mark.path.slice(mark.path.lastIndexOf('.'))}`) : null;
}

export const BrandSegment: React.FC<BrandProps> = ({ seg, ms, spec, template, docTitle, provenance }) => {
  const t0 = seg.contentStartMs;
  const mark = brandMark(spec);
  switch (seg.role) {
    case 'IDENT':
      // Multiple possibilities -> brief interference -> resolution -> tactile set: visually, the mark settles like a laid brick.
      return (
        <AbsoluteFill>
          {mark ? <Img src={mark} style={{ ...rectStyle(IDENT_MARK), objectFit: 'contain', ...settle(ms, t0, 520) }} /> : null}
          <div style={{ ...rectStyle(IDENT_WORDMARK), ...textStyle('cardHeading'), textAlign: 'center', color: TOKENS.terracotta, ...settle(ms, t0 + 380, 420) }}>
            {template.onScreen}
          </div>
        </AbsoluteFill>
      );
    case 'CTA':
      return (
        <AbsoluteFill>
          <Ground />
          <div style={{ ...rectStyle(CTA_TEXT), ...textStyle('cardHeading'), ...settle(ms, t0) }}>{template.onScreen}</div>
        </AbsoluteFill>
      );
    case 'DOCS_REFERENCE': {
      const url = spec.source.docUrl.replace(/^https?:\/\//, '');
      return (
        <AbsoluteFill>
          <Ground />
          <Platform rect={DOCS_CARD} />
          <div style={{ position: 'absolute', left: DOCS_CARD.x + 56, top: DOCS_CARD.y + 52, width: DOCS_CARD.w - 112, ...settle(ms, t0) }}>
            <div style={{ ...textStyle('eyebrow'), color: TOKENS.terracotta }}>{template.onScreen}</div>
            <div style={{ ...textStyle('cardHeading'), marginTop: 26 }}>{docTitle}</div>
            <div style={{ ...textStyle('cardBody', true), fontSize: 30, color: TOKENS.terracottaDark, marginTop: 30 }}>{url}</div>
            <div style={{ ...textStyle('chip', true), color: TOKENS.inkMuted, marginTop: 44 }}>
              {`doc blob ${provenance.blob.slice(0, 7)} · content ${provenance.contentHash.slice(0, 12)} · video r${spec.revision}`}
            </div>
          </div>
        </AbsoluteFill>
      );
    }
    case 'OUTRO':
      return (
        <AbsoluteFill>
          <Ground />
          {mark ? <Img src={mark} style={{ ...rectStyle(OUTRO_MARK), objectFit: 'contain', ...settle(ms, t0, 420) }} /> : null}
          <div style={{ ...rectStyle(OUTRO_TEXT), ...textStyle('graphCaption'), textAlign: 'center', color: TOKENS.terracotta, ...settle(ms, t0 + 200) }}>{template.onScreen}</div>
        </AbsoluteFill>
      );
    case 'END_SCREEN':
      return (
        <AbsoluteFill>
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
