// Injection-sink and secret rules for every .ts/.tsx file in this repository.
//
// Carried over verbatim from the WalletWall repository's static-check rule
// tables (scripts/static-check-rules.mjs, git blob
// 56569a8ab3b34a6858e0fec8d6da5b51aab2ede3), which applied to this pipeline
// while it lived there. Kept as data so the guard test can apply them; this
// file is excluded from its own scan because it necessarily spells the patterns.

export interface GuardRule {
  re: RegExp;
  msg: string;
}

/** Sinks that only matter where code can execute. */
export const EXECUTABLE_CONTEXT_RULES: readonly GuardRule[] = Object.freeze([
  { re: /dangerouslySetInnerHTML/, msg: 'avoid raw HTML rendering in React surfaces' },
  { re: /document\.write|\.innerHTML\s*=/, msg: 'avoid direct DOM HTML injection sinks' },
  { re: /\beval\s*\(/, msg: 'avoid eval() code-injection sink' },
  { re: /\bnew\s+Function\s*\(/, msg: 'avoid new Function() code-injection sink' },
  { re: /\bset(?:Timeout|Interval)\s*\(\s*['"`]/, msg: 'avoid string-based timer sinks' },
]);

export const CONTENT_RULES: readonly GuardRule[] = Object.freeze([
  { re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, msg: 'private key material must not be committed' },
  { re: /"private_key"\s*:\s*"/, msg: 'service account JSON must stay out of git' },
  {
    re: /\b(?:OPENAI|OPENROUTER|ANTHROPIC|ETHERSCAN|ALCHEMY|COINGECKO|DUNE|UPSTASH)_[A-Z0-9_]*(?:KEY|TOKEN)[ \t]*=[ \t]*[A-Za-z0-9_-]{20,}/,
    msg: 'looks like a real API key assignment',
  },
  // This repository's addition: the voice reference adapter's credential (ElevenLabs keys start with sk_).
  { re: /\bELEVENLABS_API_KEY[ \t]*[=:][ \t]*['"]?sk_[A-Za-z0-9]{20,}/, msg: 'looks like a real ElevenLabs key assignment' },
  { re: /\bsk_[0-9a-f]{40,}\b/, msg: 'looks like a real ElevenLabs key' },
]);
