// WalletWall brand constants, read from the brand contract
// (contracts/walletwall-brand.json): values copied from the canonical WalletWall
// source files it names and checked for drift by `npm run contracts:check`.
// Nothing else in this repository may state a brand value. Isomorphic: Node and
// the Remotion bundle both import the JSON directly.

import contract from '../../contracts/walletwall-brand.json' with { type: 'json' };

const theme = contract.theme;
const withAlpha =
  (template: string) =>
  (alpha: number): string =>
    template.replace('{alpha}', String(alpha));

export const COLORS = {
  brand: { terracotta: theme['COLORS.brand.terracotta'], tan: theme['COLORS.brand.tan'], ink: theme['COLORS.brand.ink'] },
  status: { riskDark: theme['COLORS.status.riskDark'] },
} as const;

export const VAULT = { ink: withAlpha(theme['VAULT.ink']), accentWash: withAlpha(theme['VAULT.accentWash']) } as const;

export const DOCS_URL: string = contract.constants.DOCS_URL;

/** CSS custom properties from the canonical :root block. Key = custom property name. */
export const CSS_ROOT = contract.cssRoot;
