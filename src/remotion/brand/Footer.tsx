// WalletWall's quiet brand footer (src/layout/footer.ts): the brick-wallet mark and the wordmark, bottom right, in
// the fixed editorial layer. It teaches nothing and covers nothing; its opacity is footerOpacityAt's, its copy the
// versioned template's (config/copy-templates.json `footer`), its colour the canonical terracotta.

import React from 'react';
import { Img } from 'remotion';
import { FONTS, TOKENS } from '../../brand/tokens.ts';
import { FOOTER, FOOTER_MARK, FOOTER_WORDMARK, FOOTER_WORDMARK_STYLE } from '../../layout/footer.ts';
import { rectStyle } from '../style.ts';

const local = (r: typeof FOOTER) => ({ position: 'absolute' as const, left: r.x - FOOTER.x, top: r.y - FOOTER.y, width: r.w, height: r.h });

export const Footer: React.FC<{ opacity: number; mark: string | null; wordmark: string }> = ({ opacity, mark, wordmark }) => {
  if (opacity <= 0) return null;
  const s = FOOTER_WORDMARK_STYLE;
  return (
    <div data-layer="footer" style={{ ...rectStyle(FOOTER), opacity }}>
      {mark ? <Img src={mark} style={{ ...local(FOOTER_MARK), objectFit: 'contain' }} /> : null}
      <div style={{ ...local(FOOTER_WORDMARK), display: 'flex', alignItems: 'center', fontFamily: FONTS[s.font], fontSize: s.size, fontWeight: s.weight, lineHeight: s.lineHeight, letterSpacing: -0.2, color: TOKENS.terracotta, whiteSpace: 'nowrap' }}>
        {wordmark}
      </div>
    </div>
  );
};
