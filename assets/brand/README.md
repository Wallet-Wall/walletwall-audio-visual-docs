# Brand marks

Reviewed marks the renderer may show. A `BRAND_MARK` asset may only come from this directory; the WalletWall app's legacy raster icons are refused by validation.

| File | sha256 | Use |
|---|---|---|
| `walletwall-brick-wallet.png` | `91926a2eebc1777194ecf491049b8a7af3cf0892b09b363c5b2a17cd17d5dbad` | The footer |

## walletwall-brick-wallet.png

The WalletWall brick-wallet mark, supplied by the maintainer on 2026-10-17 as a 496 × 496 RGBA PNG (sha256 `467c37e384d55c64f946625160d0cd774a230b25e810017b161f29123e2f4f54`) whose cut-out had a 1-bit alpha mask. It was edge-polished deterministically before being committed; the artwork itself is unchanged:

1. 144 pinholes left by the original background removal were filled from their neighbours.
2. 844 pixels of baked-in backdrop (the old render's light ground and contact shadow, left opaque under the base and in the concave corner beside the wall) were returned to transparency. They were found by flooding from the outside through greyish backdrop-coloured pixels only; mortar joints (brick on both sides) and bevel highlights are excluded.
3. The outer contour was smoothed (Gaussian sigma 2.6 px on the mask, re-sharpened to an anti-aliased ramp of about 1 px), and edge colour was bled outward so the new coverage carries no fringe.

Interior pixels that were opaque before and after are byte-for-byte the original's.
