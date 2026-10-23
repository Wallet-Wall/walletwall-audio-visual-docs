// Machine-readable validation results. Every rule reports a stable code so CI,
// review tooling, and future dashboards can act on failures without parsing
// prose. Codes are append-only: renaming one is a breaking contract change.

export type Severity = 'error' | 'warning';

export const ISSUE_CODES = {
  // Shape / vocabulary
  SPEC_SCHEMA_INVALID: 'The document is not a walletwall.video-spec/v1 object of the expected shape.',
  SPEC_UNKNOWN_KEY: 'A key outside the VideoSpec contract was found (strict shape).',
  SPEC_GENERATIVE_FIELD: 'A generative prompt / styling / code field was found; no such path exists in v1.',
  SPEC_DUPLICATE_ID: 'Two elements share an id.',
  SPEC_ID_INVALID: 'Ids are lowercase slugs (line ids may contain dots); a few ids are reserved by the renderer.',
  TEXT_INVALID_CHARACTERS: 'Spoken and on-screen text must be NFKC-normalized, visible, Latin-script text (no zero-width or look-alike characters).',
  TIMING_INVALID: 'A timing field is not a sane integer, or an event falls outside its segment.',
  NARRATION_CADENCE: 'A silence between narration lines is not authored language (a transition, slide, or landing is holding the speech back), or a line falls outside its segment.',
  SPEC_PATH_INVALID: 'A path must be repo-relative (no absolute paths, drive letters, backslashes, or "..").',
  SCENE_TYPE_UNSUPPORTED: 'Scene type is outside the supported scene vocabulary.',
  SCENE_ROLE_MISMATCH: 'Content roles need a scene; brand roles must not have one.',
  WALLABY_ACTION_UNSUPPORTED: 'WalletWallaby action is outside the supported action vocabulary.',
  WALLABY_EXPRESSION_UNSUPPORTED: 'WalletWallaby expression is outside the supported vocabulary.',
  WALLABY_TARGET_REQUIRED: 'This WalletWallaby action needs a target anchor.',
  WALLABY_TARGET_UNKNOWN: 'WalletWallaby target anchor does not exist in the scene.',
  CUE_UNKNOWN: 'A cue references a narration line that does not exist in the segment.',
  WALLABY_OCCLUDES_TEXT: 'WalletWallaby would stand over on-screen text; the character must never hide information.',
  // Claims and provenance
  CLAIM_UNKNOWN: 'A narration line or visual cites a claim id that is not defined.',
  CLAIM_UNUSED: 'A claim is defined but never cited.',
  CLAIM_EVIDENCE_MISSING: 'A claim has no evidence of the kind its type requires.',
  CLAIM_SECTION_UNKNOWN: 'Claim evidence cites a source section that does not exist.',
  CLAIM_QUOTE_NOT_IN_SOURCE: 'Claim evidence quote is not a verbatim span of the cited source section.',
  CLAIM_ARTIFACT_MISSING: 'Claim evidence artifact does not exist in the repository.',
  CLAIM_ARTIFACT_HASH_MISMATCH: 'Claim evidence artifact content does not match its recorded hash.',
  NARRATION_UNSUPPORTED: 'A content narration line cites no claims.',
  NARRATION_INTERPRETATION_UNMARKED: 'Interpretation is not linguistically presented as interpretation.',
  NARRATION_ROLE_MISMATCH: 'Narration role does not match the claims it cites.',
  NARRATION_TEMPLATE_MISMATCH: 'Template narration differs from the version-controlled template.',
  NARRATION_NUMBER_UNSOURCED: 'Spoken number does not appear in any cited evidence.',
  VISUAL_TEXT_UNSOURCED: 'On-screen text cites no claims.',
  VISUAL_NUMBER_UNSOURCED: 'On-screen number does not appear in any cited evidence (no fabricated data).',
  GRAPH_LABEL_UNSOURCED: 'Graph node label does not appear in its cited evidence.',
  GRAPH_EDGE_UNKNOWN_NODE: 'Graph edge references a node that does not exist.',
  GRAPH_ORDERING_UNSOURCED: 'An ordered layout needs a cited ordering claim.',
  GRAPH_LAYER_INVALID: 'LAYERED graphs need UPPER and LOWER nodes; other layouts must not set layers.',
  EYEBROW_SECTION_UNKNOWN: 'Scene eyebrow cites a source section that does not exist.',
  // Structure
  STRUCTURE_SEGMENT_MISSING: 'A required segment (hook, explanation, takeaway, canonical page, end screen) is missing.',
  STRUCTURE_ORDER: 'Segments are out of the required order.',
  STRUCTURE_SEGMENT_REPEATED: 'A segment role that must appear once appears more than once.',
  TEMPLATE_UNKNOWN: 'A brand segment names a template that does not exist or has the wrong role.',
  // Duration and pacing
  DURATION_EXCEEDS_CLASS: 'Estimated runtime exceeds the video class ceiling; split or reclassify.',
  DURATION_CLASS_NOT_SHORTEST: 'A shorter video class would fit this runtime.',
  PACE_TOO_FAST: 'Narration pace exceeds the natural ceiling; never speed narration to fit.',
  NARRATION_OVER_BUDGET: 'Narration has more spoken words than its video class holds at the planning pace (src/spec/narration-budget.ts); cut the script.',
  END_SCREEN_DURATION: 'End screen must last 5 to 20 seconds.',
  VIDEO_TOO_SHORT: 'Video is too short to carry a YouTube end screen (25 s minimum).',
  // Transitions and audio
  TRANSITION_DEPTH_BUDGET: 'More 2D -> 3D transitions than the budget allows without justification.',
  TRANSITION_DEPTH_NOT_DRIVEN: 'DEPTH_ENTER must be driven by a PUSH_THROUGH beat in the previous segment.',
  TRANSITION_DEPTH_UNBALANCED: 'Depth transitions must enter before exiting and return to the surface.',
  TRANSITION_SHIFT_NOT_DRIVEN: 'SECTION_SHIFT must be driven by a DIMENSION_JUMP beat in the previous segment.',
  TRANSITION_PLANE_MISMATCH: 'A scene plane disagrees with the depth state implied by transitions.',
  SONIC_EVENT_UNSUPPORTED: 'Sonic event is outside the semantic audio vocabulary.',
  SONIC_QUANTUM_OUT_OF_DOMAIN: 'Quantum sonic semantics used outside a quantum source domain.',
  // Assets
  ASSET_UNKNOWN: 'A scene references an asset id that is not declared.',
  ASSET_KIND_PROHIBITED: 'Asset kind is outside the allowed source hierarchy.',
  ASSET_MISSING: 'A declared asset file does not exist.',
  ASSET_LOCATION_INVALID: 'An asset kind must come from its reviewed location (e.g. real UI captures only from video/assets/ui-captures/).',
  ASSET_HASH_MISMATCH: 'A declared asset does not match its recorded hash.',
  UI_SCENE_REQUIRES_REAL_CAPTURE: 'UI scenes must show a real WalletWall UI capture.',
  // Layout
  TEXT_OVERFLOW: 'Text does not fit its bounded layout region.',
  SAFE_AREA_VIOLATION: 'A layout region falls outside the YouTube title-safe area.',
  // Source / docs
  SOURCE_HASH_STALE: 'The spec was planned against different source content than the current doc.',
  SOURCE_DOC_MISMATCH: 'The spec source binding does not match the normalized source.',
  DOCS_URL_UNPUBLISHED: 'The canonical docs page is not published (not in navigation, or mintignored).',
  // Copy
  COPY_FORBIDDEN_PHRASE: 'Copy uses a phrase the WalletWall copy policy forbids.',
  COPY_CTA_FORBIDDEN: 'No like-and-subscribe call to action: the canonical page line is the only call to action, from its template.',
  TITLE_INVALID: 'Title breaks the naming rules (length, part labels, series order).',
  SERIES_INVALID: 'Series membership is inconsistent (one-part series, part out of range).',
  // Media QA
  CAPTIONS_MISMATCH: 'Captions do not reproduce the final narration source.',
  CAPTIONS_PRONUNCIATION_LEAK: 'Captions contain pronunciation aliases instead of display text.',
  CAPTIONS_TIMING: 'Caption cues overlap or fall outside the video.',
  // Publish manifest QA
  MANIFEST_CHAPTERS_INVALID: 'YouTube chapters need at least three entries, starting at 0:00, each long enough.',
  MANIFEST_PRIVACY_INVALID: 'v1 uploads are unlisted (or private) for human review; never public.',
  MANIFEST_SECRET_LEAK: 'A credential-shaped environment value appears in the publish manifest.',
} as const;

export type IssueCode = keyof typeof ISSUE_CODES;

export interface ValidationIssue {
  code: IssueCode;
  severity: Severity;
  /** JSON-path-like location, e.g. `segments[3].narration[1]`. */
  path: string;
  message: string;
}

export interface ValidationReport {
  ok: boolean;
  errors: number;
  warnings: number;
  issues: ValidationIssue[];
}

export class IssueCollector {
  readonly issues: ValidationIssue[] = [];

  error(code: IssueCode, path: string, detail?: string): void {
    this.issues.push({ code, severity: 'error', path, message: detail ? `${ISSUE_CODES[code]} ${detail}` : ISSUE_CODES[code] });
  }

  warn(code: IssueCode, path: string, detail?: string): void {
    this.issues.push({ code, severity: 'warning', path, message: detail ? `${ISSUE_CODES[code]} ${detail}` : ISSUE_CODES[code] });
  }

  report(): ValidationReport {
    const errors = this.issues.filter((i) => i.severity === 'error').length;
    return { ok: errors === 0, errors, warnings: this.issues.length - errors, issues: this.issues };
  }
}
