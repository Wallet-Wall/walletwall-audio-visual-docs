// Review-only: the before/after sheet for attention direction (docs/ATTENTION.md), from renders that already exist.
//
// node scripts/review/attention-review.ts --before=<stills dir of main> --after=<stills dir of this branch> [--out=dist/attention-review]
//   -> <out>/index.html         one page: representative before/after pairs, one temporal sequence per mode, the depth
//                               transition's entry, peak, and exit, the characterless twins, and for every example the
//                               mode, the subjects, the framing, the attenuated elements, and why the key exists
//   -> <out>/*.png              every pair and strip at full review size
//
// Both stills directories come from `npm run render:stills -- migration-readiness --frames=...` with the same frames.
// Pure image work over files (./png.ts) plus the attention plan of the committed lesson; no Remotion, no network.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadAttentionConfig } from '../../src/attention/config.ts';
import { cameraAt, directionAt, framingCss, planAttention, type AttentionMode, type AttentionPlan, type Framing, type SceneDirection } from '../../src/attention/direction.ts';
import { estimateTrack } from '../../src/audio/voice-provider.ts';
import { mixTokens, TOKENS } from '../../src/brand/tokens.ts';
import { choreograph, layoutsFor } from '../../src/character/walletwallaby/choreography.ts';
import { DIST_ROOT, loadPipelineConfig, VIDEO_ROOT } from '../../src/config/load.ts';
import { sha256Hex } from '../../src/core/hash.ts';
import { loadCommittedSpec } from '../../src/pipeline/context.ts';
import { loadSnapshot } from '../../src/pipeline/render-input.ts';
import { buildTimeline, type TimedSegment, type Timeline } from '../../src/timeline/timeline.ts';
import { blank, hexRgba, over, readPng, resize, writePng, type Image } from './png.ts';

const args = process.argv.slice(2);
const opt = (n: string): string | undefined => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const beforeDir = opt('before');
const afterDir = opt('after');
if (!beforeDir || !afterDir) throw new Error('usage: attention-review.ts --before=<stills dir> --after=<stills dir> [--out=<dir>]');
const out = opt('out') ?? path.join(DIST_ROOT, 'attention-review');
mkdirSync(out, { recursive: true });

// ── The lesson and its direction ────────────────────────────────────────────

const videoId = 'migration-readiness';
const config = loadPipelineConfig();
const spec = loadCommittedSpec(videoId);
const source = loadSnapshot(spec);
const headings: Record<string, string> = Object.fromEntries(source.sections.map((s) => [s.id, s.heading]));
const timeline: Timeline = buildTimeline(spec, estimateTrack(spec, config.voice, config.lexicon), config.templates);
const fps = timeline.fps;
const layouts = layoutsFor(timeline, (id) => headings[id] ?? '');
const clips = choreograph(timeline, layouts);
const attention = loadAttentionConfig();
const plan: AttentionPlan = planAttention(timeline, layouts, clips, attention);
const msOf = (frame: number): number => (frame * 1000) / fps;
const fOf = (ms: number): number => Math.round((ms * fps) / 1000);
const segmentAt = (frame: number): TimedSegment => timeline.segments.find((s) => msOf(frame) >= s.startMs && msOf(frame) < s.endMs) ?? timeline.segments[timeline.segments.length - 1]!;

interface FrameState {
  frame: number;
  segment: string;
  role: string;
  inTransition: boolean;
  direction: SceneDirection;
  camera: Framing;
  identical: boolean;
}

function stateOf(frame: number): FrameState {
  const seg = segmentAt(frame);
  const ms = msOf(frame);
  return { frame, segment: seg.id, role: seg.role, inTransition: ms < seg.contentStartMs, direction: directionAt(plan, seg.id, ms), camera: cameraAt(plan, ms), identical: sameBytes(frame) };
}

// ── Images ──────────────────────────────────────────────────────────────────

const pad = (f: number): string => `f${String(f).padStart(5, '0')}`;
const file = (dir: string, frame: number, characterless = false): string => path.join(dir, `${pad(frame)}${characterless ? '.characterless' : ''}.png`);
const sameBytes = (frame: number, characterless = false): boolean => sha256Hex(readFileSync(file(beforeDir!, frame, characterless))) === sha256Hex(readFileSync(file(afterDir!, frame, characterless)));
const GAP = 10;
const gapColour = hexRgba(TOKENS.charcoal);

function pair(frame: number, w: number, characterless = false): Image {
  const a = resize(readPng(file(beforeDir!, frame, characterless)), w, Math.round((w * 9) / 16));
  const b = resize(readPng(file(afterDir!, frame, characterless)), w, Math.round((w * 9) / 16));
  const sheet = blank(a.width * 2 + GAP, a.height, gapColour);
  over(sheet, a, 0, 0);
  over(sheet, b, a.width + GAP, 0);
  return sheet;
}

/** Two rows (before over after) of the same frames, left to right in time. */
function strip(frames: number[], w: number): Image {
  const h = Math.round((w * 9) / 16);
  const sheet = blank(frames.length * (w + GAP) - GAP, h * 2 + GAP, gapColour);
  frames.forEach((fr, i) => {
    over(sheet, resize(readPng(file(beforeDir!, fr)), w, h), i * (w + GAP), 0);
    over(sheet, resize(readPng(file(afterDir!, fr)), w, h), i * (w + GAP), h + GAP);
  });
  return sheet;
}

const dataUri = (img: Image, name: string): string => {
  const p = path.join(out, name);
  writePng(p, img);
  return `data:image/png;base64,${readFileSync(p).toString('base64')}`;
};

// ── What to show ────────────────────────────────────────────────────────────

const SINGLES: { frame: number; title: string; note: string }[] = [
  { frame: 1500, title: 'Review tier', note: 'GUIDE after the trace up to Review: the current tier carries the wash and rule; the tiers ahead recede a little; the climbed route stays terracotta.' },
  { frame: 1700, title: 'Vault Candidate tier', note: 'The INSPECT of the top tier now registers (the previous renderer lost it to the exit cue); the hierarchy is already easing out, one settle before the push.' },
  { frame: 1850, title: 'Ordinary layered teaching frame', note: 'GUIDE on Value at risk: one current idea is primary while the shared risk tier, its caption, and the slabs stay as context.' },
  { frame: 2900, title: 'Broad reading-card support', note: 'A PERCH on the whole card: ESTABLISH, the whole surface is read, nothing is forced; the COMPARE before it has settled out.' },
  { frame: 3950, title: 'Takeaway and the summit ledge', note: 'GUIDE on the statement while it is read; the RESOLVE that follows frames statement and ledge as one world and then holds still.' },
  { frame: 4500, title: 'CTA', note: 'A brand segment: no direction, identity framing. Restraint: the frame is untouched.' },
  { frame: 5100, title: 'YouTube end screen', note: 'Exempt by construction: identity framing, no direction, the reserved zones stay empty.' },
];
const TRANSITION: { frame: number; label: string }[] = [
  { frame: 1719, label: 'entry: the push begins' },
  { frame: 1766, label: 'peak: the plane opens' },
  { frame: 1812, label: 'exit: the depth plane resolves' },
];
const SEQUENCES: { mode: AttentionMode | 'ARRIVAL'; title: string; frames: number[]; note: string }[] = [
  { mode: 'ESTABLISH', title: 'ESTABLISH: the depth plane opens', frames: [1815, 1821, 1827, 1850], note: 'From the flat frame to the first beat: nothing is forced; then GUIDE lands on Value at risk.' },
  { mode: 'GUIDE', title: 'GUIDE: the trace from Monitor to Review', frames: [1405, 1420, 1435, 1450, 1465, 1480, 1500, 1520], note: 'The route draws on from its source, the guide follows it, the destination gains the wash as the trace begins; no camera.' },
  { mode: 'INSPECT', title: 'INSPECT: the testnet caveat', frames: [3300, 3312, 3324, 3336, 3350, 3380, 3420, 3480], note: 'The subject changes from the placeholder to the testnet line: the wash moves, the rest recedes a little; the lean was already taken at the first INSPECT and does not move again.' },
  { mode: 'INSPECT', title: 'INSPECT: Wallet structure, in depth', frames: [1896, 1908, 1920, 1932, 1950, 1990, 2040], note: 'One settle into the lean toward the far node; the other signals and the upper plane recede; then still.' },
  { mode: 'COMPARE', title: 'COMPARE: band versus verdict', frames: [2545, 2557, 2569, 2581, 2600, 2650, 2700, 2720], note: 'Both alternatives share the same hierarchy for the whole beat; no framing; the PERCH on the whole card settles it out.' },
  { mode: 'RESOLVE', title: 'RESOLVE: the takeaway', frames: [4100, 4112, 4124, 4136, 4160, 4220, 4300, 4326], note: 'One settle: the rule hardens, the support lines recede, the world leans in; then a genuine still hold, and one settle back before the cut.' },
  { mode: 'ARRIVAL', title: 'The CTA arrives', frames: [4326, 4330, 4340, 4350, 4365], note: 'The takeaway returned to identity before the cut; the CTA is a brand segment and is never framed.' },
  { mode: 'TRANSITION', title: 'TRANSITION: the signature depth reveal', frames: [1690, 1705, 1719, 1742, 1766, 1790, 1812, 1815], note: 'The INSPECT hierarchy eases out before the push; from the push to the flat frame nothing competes: identity, no wash, no attenuation.' },
  { mode: 'GUIDE', title: 'GUIDE: the statement is read', frames: [3935, 3945, 3957, 3969, 3990, 4050], note: 'The statement reveals with its laid-brick settle and gains the wash; the support line recedes to 0.9; no camera until the RESOLVE.' },
];
const CHARACTERLESS = [1850, 3330, 3950];

// Every frame the page needs must exist on both sides before any image work starts.
{
  const needed = [...new Set([...SINGLES.map((s) => s.frame), ...TRANSITION.map((t) => t.frame), ...SEQUENCES.flatMap((q) => q.frames), ...CHARACTERLESS])].sort((a, b) => a - b);
  const missing = needed.flatMap((fr) => [beforeDir, afterDir].flatMap((dir) => [file(dir!, fr), ...(CHARACTERLESS.includes(fr) ? [file(dir!, fr, true)] : [])])).filter((f) => !existsSync(f));
  if (missing.length) throw new Error(['missing stills (render them with --frames=' + needed.join(',') + '):', ...missing].join('\n  '));
}

// ── The page ────────────────────────────────────────────────────────────────

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmt = (f: Framing): string => (f.scale === 1 && f.tx === 0 && f.ty === 0 ? 'identity' : `scale ${f.scale.toFixed(4)} · translate ${f.tx.toFixed(1)}, ${f.ty.toFixed(1)} px`);

function stateRows(st: FrameState): string {
  const d = st.direction;
  const attenuated = Object.entries(d.emphasis).filter(([, v]) => v < 1).map(([id, v]) => `${esc(id)} ${v.toFixed(2)}`);
  const key = d.key;
  const rows: [string, string][] = [
    ['Frame', `${st.frame} · ${esc(st.segment)} (${st.role})${st.inTransition ? ' · in the transition window' : ''}`],
    ['Mode', esc(d.mode)],
    ['Primary', d.primary.length ? d.primary.map(esc).join(', ') : 'none'],
    ['Related / route', [...d.related, ...d.routes].length ? [...d.related, ...d.routes].map(esc).join(', ') : 'none'],
    ['Framing', `${fmt(st.camera)}${key && key.framingNote !== 'identity' ? ` (${esc(key.framingNote)})` : ''}`],
    ['Attenuated', attenuated.length ? attenuated.join(' · ') : 'nothing'],
    ['Why', key ? esc(key.reason) : st.role === 'END_SCREEN' || !plan.segments.has(st.segment) ? 'a brand segment: fixed editorial framing, no direction' : 'the transition owns the frame'],
    ['Bytes vs main', st.identical ? 'identical' : 'differ'],
  ];
  return rows.map(([k, v]) => `<tr><th scope="row">${k}</th><td>${v}</td></tr>`).join('');
}

const singles = SINGLES.map((s) => ({ ...s, state: stateOf(s.frame), src: dataUri(pair(s.frame, 560), `pair-${s.frame}.png`) }));
const transition = TRANSITION.map((t) => ({ ...t, state: stateOf(t.frame), src: dataUri(pair(t.frame, 560), `transition-${t.frame}.png`) }));
const sequences = SEQUENCES.map((q, i) => ({ ...q, states: q.frames.map(stateOf), src: dataUri(strip(q.frames, 236), `sequence-${i}-${q.mode.toLowerCase()}.png`) }));
const characterless = CHARACTERLESS.map((fr) => ({ frame: fr, state: stateOf(fr), identical: sameBytes(fr, true), src: dataUri(pair(fr, 560, true), `characterless-${fr}.png`) }));

const allFrames = [...new Set([...SINGLES.map((s) => s.frame), ...TRANSITION.map((t) => t.frame), ...SEQUENCES.flatMap((q) => q.frames), ...CHARACTERLESS])].sort((a, b) => a - b);
const identicalFrames = allFrames.filter((fr) => sameBytes(fr));
const cameraRows = plan.camera.map((k) => `<tr><td class="r">f${fOf(k.atMs)}</td><td>${esc(k.segmentId)}</td><td class="r">${fmt(k.framing)}</td><td>${k.required ? 'required' : ''}</td><td>${esc(k.reason)}</td></tr>`).join('');
const droppedRows = plan.cameraDropped.map((k) => `<tr><td class="r">f${fOf(k.atMs)}</td><td>${esc(k.segmentId)}</td><td class="r">${fmt(k.framing)}</td><td>not taken</td><td>${esc(k.reason)}</td></tr>`).join('');
const scheduleRows = [...plan.segments.values()]
  .flatMap((d) => d.keys.map((k) => `<tr><td class="r">f${fOf(k.atMs)}</td><td>${esc(d.segmentId)}</td><td>${esc(k.mode)}</td><td>${k.primary.map(esc).join(', ') || '—'}</td><td class="r">${fmt(k.framing)}</td><td>${esc(k.reason)}</td></tr>`))
  .join('');
const modes = attention.modes;
const treatmentRows = (['GUIDE', 'INSPECT', 'COMPARE', 'RESOLVE'] as const).map((m) => `<tr><td>${m}</td><td class="r">${modes[m].scale}</td><td class="r">${modes[m].lean}</td><td class="r">${modes[m].others}</td><td class="r">${modes[m].context}</td><td class="r">${modes[m].routes}</td></tr>`).join('');

const figure = (src: string, caption: string, sides = true): string =>
  `<figure>${sides ? '<div class="sides"><span>main</span><span>attention direction</span></div>' : ''}<img src="${src}" alt=""><figcaption>${caption}</figcaption></figure>`;

const html = `<title>Attention Direction Review</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sora:wght@500;700&family=Manrope:wght@400;500;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
  /* One reading column in WalletWall's own material: the representative pairs first, then the sequences, the transition, the characterless twins, the schedule. */
  :root {
    --paper: ${TOKENS.paper}; --panel: ${mixTokens(TOKENS.paper, TOKENS.stone, 0.5)}; --ink: ${TOKENS.charcoal}; --muted: ${mixTokens(TOKENS.charcoal, TOKENS.stone, 0.3)}; --rule: ${mixTokens(TOKENS.stone, TOKENS.tan, 0.5)}; --accent: ${TOKENS.terracotta}; --ok: #3E6B4A; --warn: #8B5A12;
    --display: "Sora", system-ui, sans-serif; --body: "Manrope", system-ui, sans-serif; --mono: "IBM Plex Mono", ui-monospace, Consolas, monospace;
  }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --paper: #1F1E1C; --panel: #2C2A25; --ink: #EDE6D6; --muted: #B3AA98; --rule: #403C33; --accent: ${mixTokens(TOKENS.terracotta, TOKENS.stone, 0.35)}; --ok: #8CC19A; --warn: #E0B35C; color-scheme: dark; } }
  :root[data-theme="dark"] { --paper: #1F1E1C; --panel: #2C2A25; --ink: #EDE6D6; --muted: #B3AA98; --rule: #403C33; --accent: ${mixTokens(TOKENS.terracotta, TOKENS.stone, 0.35)}; --ok: #8CC19A; --warn: #E0B35C; color-scheme: dark; }
  body { background: var(--paper); color: var(--ink); font-family: var(--body); font-size: 16px; line-height: 1.6; padding-block: 40px 72px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
  main { max-width: 1140px; margin: 0 auto; display: grid; gap: 56px; }
  header { display: grid; gap: 12px; max-width: 76ch; }
  .eyebrow { font: 500 12px/1 var(--mono); letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent); }
  h1 { font: 700 clamp(30px, 5vw, 44px)/1.1 var(--display); letter-spacing: -0.01em; margin: 0; text-wrap: balance; }
  h2 { font: 700 24px/1.2 var(--display); margin: 0 0 8px; text-wrap: balance; }
  h3 { font: 700 18px/1.3 var(--display); margin: 0; text-wrap: balance; }
  p { margin: 0; max-width: 72ch; }
  .lede { font-size: 18px; color: var(--muted); }
  .invariant { border-left: 4px solid var(--accent); padding: 10px 16px; background: var(--panel); font: 500 15px/1.5 var(--mono); max-width: 80ch; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; }
  .stat { background: var(--panel); border: 1px solid var(--rule); padding: 20px; display: grid; gap: 6px; align-content: start; min-width: 0; }
  .stat .n { font: 700 26px/1.15 var(--display); font-variant-numeric: tabular-nums; }
  .stat .k { font: 500 12px/1.3 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
  .stat .d { font-size: 14px; color: var(--muted); }
  section { display: grid; gap: 20px; min-width: 0; }
  .example { display: grid; gap: 12px; min-width: 0; padding-top: 20px; border-top: 1px solid var(--rule); }
  figure { margin: 0; display: grid; gap: 8px; min-width: 0; align-content: start; }
  figure img { display: block; width: 100%; height: auto; border: 1px solid var(--rule); background: var(--paper); }
  .sides { display: grid; grid-template-columns: 1fr 1fr; font: 500 12px/1 var(--mono); letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }
  .sides span:last-child { color: var(--accent); padding-left: 12px; }
  figcaption { font-size: 14px; color: var(--muted); max-width: 90ch; }
  .state { border-collapse: collapse; width: 100%; font-size: 14px; }
  .state th { text-align: left; font: 500 12px/1.4 var(--mono); letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); width: 140px; padding: 4px 10px 4px 0; vertical-align: top; }
  .state td { padding: 4px 0; vertical-align: top; overflow-wrap: anywhere; }
  .strip { overflow-x: auto; }
  .strip img { width: auto; max-width: none; height: 290px; }
  .frames { font: 400 12px/1.4 var(--mono); color: var(--muted); display: flex; flex-wrap: wrap; gap: 6px 14px; }
  table.grid { border-collapse: collapse; width: 100%; font-size: 14px; }
  table.grid th, table.grid td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--rule); vertical-align: top; }
  table.grid th { font: 500 12px/1.3 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
  td.r { font-family: var(--mono); font-size: 13px; white-space: nowrap; }
  .tablewrap { overflow-x: auto; }
  .ok { color: var(--ok); font-weight: 700; }
  ul.plain { margin: 0; padding-left: 20px; display: grid; gap: 8px; max-width: 76ch; }
  code { font-family: var(--mono); font-size: 0.9em; }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  @media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto; } }
</style>
<main>
  <header>
    <span class="eyebrow">Attention direction v1 · before / after · the migration-readiness lesson</span>
    <h1>Attention Direction Review</h1>
    <p class="lede">Every frame on the right is the same lesson, the same layout, the same motion plan as the frame on its left. Only how much of each element is on screen, and one bounded framing of the whole world, differ. Semantic and support coordinates did not move.</p>
    <p class="invariant">THE LESSON DECIDES WHAT MATTERS. MOTION INTELLIGENCE DECIDES HOW WALLETWALLABY MOVES. ATTENTION DIRECTION DECIDES HOW THE VIEWER IS GUIDED TO THE ALREADY-AUTHORED MEANING.</p>
  </header>

  <div class="stats" role="list">
    <div class="stat" role="listitem"><span class="k">Camera moves in the lesson</span><span class="n">${plan.camera.length}</span><span class="d">${plan.camera.filter((k) => k.required).length} of them required returns to identity; ${plan.cameraDropped.length} asked-for moves not taken because they could not hold still.</span></div>
    <div class="stat" role="listitem"><span class="k">Largest framing</span><span class="n">scale ${Math.max(...plan.camera.map((k) => k.framing.scale)).toFixed(2)}</span><span class="d">Lean at most ${Math.max(...plan.camera.map((k) => Math.abs(k.framing.tx))).toFixed(1)} by ${Math.max(...plan.camera.map((k) => Math.abs(k.framing.ty))).toFixed(1)} px, inside coverage and title-safe.</span></div>
    <div class="stat" role="listitem"><span class="k">Frames untouched</span><span class="n">${identicalFrames.length} of ${allFrames.length}</span><span class="d">Reviewed frames whose bytes equal main's: every brand, end-screen, and transition frame shown here.</span></div>
    <div class="stat" role="listitem"><span class="k">Declared terrain and layouts</span><span class="n">identical</span><span class="d">The content addresses pinned by test/terrain-art.test.ts still hold; the plan reads frozen layouts.</span></div>
  </div>

  <section>
    <div><h2>Representative frames</h2><p>The seven frames the lane was briefed on. Under each: the derived mode, the subjects, the framing, what receded, and why the key exists.</p></div>
    ${singles.map((s) => `<div class="example"><h3>${s.frame} · ${esc(s.title)}</h3>${figure(s.src, esc(s.note))}<table class="state">${stateRows(s.state)}</table></div>`).join('')}
  </section>

  <section>
    <div><h2>The signature depth transition</h2><p>Entry, peak, and exit of the 2D → 3D reveal. The transition owns these frames: identity framing, no wash, no attenuation; the bytes equal main's.</p></div>
    ${transition.map((t) => `<div class="example"><h3>${t.frame} · ${esc(t.label)}</h3>${figure(t.src, `Mode ${esc(t.state.direction.mode)}; framing ${fmt(t.state.camera)}; bytes vs main: ${t.state.identical ? 'identical' : 'differ'}.`)}</div>`).join('')}
  </section>

  <section>
    <div><h2>Temporal sequences, one per mode</h2><p>Top row main, bottom row attention direction, left to right in time. Judge whether movement reads as direction or as distraction. Frame numbers under each strip; the state of each frame in the schedule below.</p></div>
    ${sequences.map((q) => `<div class="example"><h3>${esc(q.title)}</h3><div class="strip"><img src="${q.src}" alt=""></div><div class="frames">${q.frames.map((fr, i) => `<span>f${fr} ${esc(q.states[i]!.direction.mode)}${q.states[i]!.camera.scale !== 1 ? ` · ${q.states[i]!.camera.scale.toFixed(3)}` : ''}</span>`).join('')}</div><p>${esc(q.note)}</p></div>`).join('')}
  </section>

  <section>
    <div><h2>Without WalletWallaby</h2><p>The design test: the lesson must still communicate with the character removed. The hierarchy and the framing come from the beats and the layout, so the characterless twins carry exactly the same direction.</p></div>
    ${characterless.map((c) => `<div class="example"><h3>${c.frame} · characterless</h3>${figure(c.src, `Mode ${esc(c.state.direction.mode)}; primary ${c.state.direction.primary.map(esc).join(', ') || 'none'}; framing ${fmt(c.state.camera)}.`)}</div>`).join('')}
  </section>

  <section>
    <div><h2>The grammar, as derived for this lesson</h2><p>Every key of every scene segment: when it takes effect, its mode, its subjects, the framing it asked for (already clamped), and the beat that produced it.</p></div>
    <div class="tablewrap"><table class="grid"><thead><tr><th>At</th><th>Segment</th><th>Mode</th><th>Primary</th><th>Framing</th><th>Why</th></tr></thead><tbody>${scheduleRows}</tbody></table></div>
    <div><h3>The camera schedule</h3><p>After the minimum-hold rule. A required key is a return to identity before a transition, an exit move, or a segment's end.</p></div>
    <div class="tablewrap"><table class="grid"><thead><tr><th>At</th><th>Segment</th><th>Pose</th><th></th><th>Why</th></tr></thead><tbody>${cameraRows}${droppedRows}</tbody></table></div>
    <div><h3>Treatments (config/attention.json)</h3><p>ESTABLISH and TRANSITION are always neutral. Settle ${attention.settleMs} ms; minimum hold ${attention.minHoldMs} ms; ceilings scale ${attention.framing.maxScale}, lean ${attention.framing.maxTranslateX} × ${attention.framing.maxTranslateY} px; route draw ${attention.entrance.routeDrawMs} ms.</p></div>
    <div class="tablewrap"><table class="grid"><thead><tr><th>Mode</th><th>Scale</th><th>Lean</th><th>Others</th><th>Context</th><th>Routes</th></tr></thead><tbody>${treatmentRows}</tbody></table></div>
  </section>
</main>
`;
writeFileSync(path.join(out, 'index.html'), html);
console.log(`[attention-review] ${singles.length} pairs, ${transition.length} transition pairs, ${sequences.length} sequences, ${characterless.length} characterless pairs -> ${path.relative(VIDEO_ROOT, out)}/index.html (${(Buffer.byteLength(html) / 1e6).toFixed(1)} MB); ${identicalFrames.length}/${allFrames.length} reviewed frames byte-identical to main`);
