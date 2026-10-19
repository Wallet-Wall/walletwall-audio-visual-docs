// Objective audio diagnostics for narration candidates: level, loudness
// (ITU-R BS.1770-4 integrated, K-weighted, gated), clipping, silence and pause
// distribution, and a coarse pitch profile. These support a listening decision;
// they never make it. Isomorphic (no Node imports).

export interface AudioMetrics {
  sampleRate: number;
  durationMs: number;
  peakDbfs: number;
  rmsDbfs: number;
  dcOffset: number;
  /** null when the file is shorter than one 400 ms loudness block or entirely gated out. */
  integratedLufs: number | null;
  clipping: { samples: number; runs: number; longestRun: number };
  silence: {
    thresholdDbfs: number;
    leadingMs: number;
    trailingMs: number;
    speechMs: number;
    /** Internal silences of at least `minPauseMs`. */
    minPauseMs: number;
    pauses: { count: number; maxMs: number; totalMs: number };
  };
  /** Coarse F0 statistics over voiced speech frames (autocorrelation, 60-400 Hz); null when nothing is voiced. */
  pitch: { voicedRatio: number; medianHz: number; semitoneStd: number; p10Hz: number; p90Hz: number } | null;
}

const DB_FLOOR = -120;
const dbfs = (linear: number): number => (linear > 0 ? Math.max(DB_FLOOR, 20 * Math.log10(linear)) : DB_FLOOR);

const SILENCE_DBFS = -50;
const MIN_PAUSE_MS = 200;
const CLIP_LEVEL = 0.9999;

export function analyzeAudio(samples: Float32Array, sampleRate: number): AudioMetrics {
  const n = samples.length;
  let peak = 0;
  let sumSq = 0;
  let sum = 0;
  let clipped = 0;
  let runs = 0;
  let longestRun = 0;
  let run = 0;
  for (let i = 0; i < n; i++) {
    const x = samples[i]!;
    const a = Math.abs(x);
    if (a > peak) peak = a;
    sumSq += x * x;
    sum += x;
    if (a >= CLIP_LEVEL) {
      clipped++;
      run++;
      if (run === 2) runs++;
      if (run > longestRun) longestRun = run;
    } else run = 0;
  }
  const frameLen = Math.max(1, Math.round(sampleRate / 100)); // 10 ms
  const frames = Math.floor(n / frameLen);
  const silent: boolean[] = [];
  for (let f = 0; f < frames; f++) {
    let s = 0;
    const base = f * frameLen;
    for (let i = 0; i < frameLen; i++) s += samples[base + i]! * samples[base + i]!;
    silent.push(dbfs(Math.sqrt(s / frameLen)) < SILENCE_DBFS);
  }
  let leading = 0;
  while (leading < frames && silent[leading]) leading++;
  let trailing = 0;
  while (trailing < frames - leading && silent[frames - 1 - trailing]) trailing++;
  const minPauseFrames = Math.round(MIN_PAUSE_MS / 10);
  const pauses = { count: 0, maxMs: 0, totalMs: 0 };
  let speechFrames = 0;
  let silentRun = 0;
  for (let f = leading; f < frames - trailing; f++) {
    if (silent[f]) {
      silentRun++;
      continue;
    }
    speechFrames++;
    if (silentRun >= minPauseFrames) {
      pauses.count++;
      pauses.totalMs += silentRun * 10;
      pauses.maxMs = Math.max(pauses.maxMs, silentRun * 10);
    }
    silentRun = 0;
  }
  return {
    sampleRate,
    durationMs: Math.round((n * 1000) / sampleRate),
    peakDbfs: dbfs(peak),
    rmsDbfs: dbfs(Math.sqrt(sumSq / Math.max(1, n))),
    dcOffset: n ? sum / n : 0,
    integratedLufs: integratedLoudness(samples, sampleRate),
    clipping: { samples: clipped, runs, longestRun },
    silence: { thresholdDbfs: SILENCE_DBFS, leadingMs: leading * 10, trailingMs: trailing * 10, speechMs: speechFrames * 10, minPauseMs: MIN_PAUSE_MS, pauses },
    pitch: pitchProfile(samples, sampleRate),
  };
}

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** The two K-weighting stages for an arbitrary sample rate (the BS.1770 prototypes, as in libebur128 / pyloudnorm). */
export function kWeighting(sampleRate: number): [Biquad, Biquad] {
  const shelf = (() => {
    const G = 3.999843853973347;
    const Q = 0.7071752369554196;
    const fc = 1681.974450955533;
    const A = 10 ** (G / 40);
    const w0 = (2 * Math.PI * fc) / sampleRate;
    const alpha = Math.sin(w0) / (2 * Q);
    const cos = Math.cos(w0);
    const a0 = A + 1 - (A - 1) * cos + 2 * Math.sqrt(A) * alpha;
    return {
      b0: (A * (A + 1 + (A - 1) * cos + 2 * Math.sqrt(A) * alpha)) / a0,
      b1: (-2 * A * (A - 1 + (A + 1) * cos)) / a0,
      b2: (A * (A + 1 + (A - 1) * cos - 2 * Math.sqrt(A) * alpha)) / a0,
      a1: (2 * (A - 1 - (A + 1) * cos)) / a0,
      a2: (A + 1 - (A - 1) * cos - 2 * Math.sqrt(A) * alpha) / a0,
    };
  })();
  const highpass = (() => {
    const Q = 0.5003270373238773;
    const fc = 38.13547087602444;
    const w0 = (2 * Math.PI * fc) / sampleRate;
    const alpha = Math.sin(w0) / (2 * Q);
    const cos = Math.cos(w0);
    const a0 = 1 + alpha;
    return { b0: (1 + cos) / 2 / a0, b1: -(1 + cos) / a0, b2: (1 + cos) / 2 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
  })();
  return [shelf, highpass];
}

function filter(x: Float32Array, q: Biquad): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const x0 = x[i]!;
    const y0 = q.b0 * x0 + q.b1 * x1 + q.b2 * x2 - q.a1 * y1 - q.a2 * y2;
    y[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return y;
}

/** ITU-R BS.1770-4 integrated loudness of a mono signal, in LUFS. */
export function integratedLoudness(samples: Float32Array, sampleRate: number): number | null {
  const [shelf, highpass] = kWeighting(sampleRate);
  const k = filter(filter(samples, shelf), highpass);
  const block = Math.round(0.4 * sampleRate);
  const hop = Math.round(0.1 * sampleRate);
  if (k.length < block) return null;
  const powers: number[] = [];
  for (let start = 0; start + block <= k.length; start += hop) {
    let s = 0;
    for (let i = start; i < start + block; i++) s += k[i]! * k[i]!;
    powers.push(s / block);
  }
  const loudness = (p: number) => -0.691 + 10 * Math.log10(p);
  const absolute = powers.filter((p) => p > 0 && loudness(p) > -70);
  if (absolute.length === 0) return null;
  const mean = absolute.reduce((a, b) => a + b, 0) / absolute.length;
  const gate = loudness(mean) - 10;
  const relative = absolute.filter((p) => loudness(p) > gate);
  if (relative.length === 0) return null;
  return loudness(relative.reduce((a, b) => a + b, 0) / relative.length);
}

/** Gain (dB) that moves `current` LUFS to `target`, clamped so the peak never exceeds `peakCeilingDbfs`. */
export function loudnessMatchGainDb(current: number, target: number, peakDbfs: number, peakCeilingDbfs: number): { gainDb: number; limited: boolean } {
  const wanted = target - current;
  const headroom = peakCeilingDbfs - peakDbfs;
  return wanted > headroom ? { gainDb: headroom, limited: true } : { gainDb: wanted, limited: false };
}

export function applyGainDb(samples: Float32Array, gainDb: number): Float32Array {
  const g = 10 ** (gainDb / 20);
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i]! * g;
  return out;
}

function pitchProfile(samples: Float32Array, sampleRate: number): AudioMetrics['pitch'] {
  // Decimate to ~8 kHz: F0 lives far below 4 kHz and this keeps the autocorrelation cheap.
  const factor = Math.max(1, Math.floor(sampleRate / 8000));
  const fs = sampleRate / factor;
  const len = Math.floor(samples.length / factor);
  const x = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    let s = 0;
    for (let j = 0; j < factor; j++) s += samples[i * factor + j]!;
    x[i] = s / factor;
  }
  const frame = Math.round(0.04 * fs);
  const hop = Math.round(0.01 * fs);
  const minLag = Math.floor(fs / 400);
  const maxLag = Math.ceil(fs / 60);
  if (len < frame + maxLag) return null;
  const f0s: number[] = [];
  let speechFrames = 0;
  for (let start = 0; start + frame + maxLag <= len; start += hop) {
    let energy = 0;
    for (let i = 0; i < frame; i++) energy += x[start + i]! * x[start + i]!;
    if (dbfs(Math.sqrt(energy / frame)) < -40) continue;
    speechFrames++;
    const r = new Float64Array(maxLag + 2);
    let best = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let num = 0;
      let den = 0;
      for (let i = 0; i < frame; i++) {
        num += x[start + i]! * x[start + i + lag]!;
        den += x[start + i + lag]! * x[start + i + lag]!;
      }
      r[lag] = num / Math.sqrt(energy * den || 1);
      if (r[lag]! > best) best = r[lag]!;
    }
    if (best <= 0.6) continue;
    // The fundamental is the SHORTEST lag whose peak is close to the global maximum: a longer lag
    // that matches equally well is a multiple of the period (the octave-below error).
    let lag = 0;
    for (let l = minLag; l <= maxLag; l++) {
      if (r[l]! >= best - 0.05 && r[l]! >= (r[l - 1] ?? -1) && r[l]! >= (r[l + 1] ?? -1)) {
        lag = l;
        break;
      }
    }
    if (lag === 0) continue;
    // Parabolic interpolation around the peak for non-integer periods.
    const a = r[lag - 1] ?? r[lag]!;
    const b = r[lag]!;
    const c = r[lag + 1] ?? r[lag]!;
    const denom = a - 2 * b + c;
    const offset = denom === 0 ? 0 : (0.5 * (a - c)) / denom;
    f0s.push(fs / (lag + Math.max(-0.5, Math.min(0.5, offset))));
  }
  if (f0s.length < 5 || speechFrames === 0) return null;
  const sorted = [...f0s].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
  const median = q(0.5);
  const semis = f0s.map((f) => 12 * Math.log2(f / median));
  const meanSemi = semis.reduce((a, b) => a + b, 0) / semis.length;
  const semitoneStd = Math.sqrt(semis.reduce((a, s) => a + (s - meanSemi) ** 2, 0) / semis.length);
  return { voicedRatio: f0s.length / speechFrames, medianHz: median, semitoneStd, p10Hz: q(0.1), p90Hz: q(0.9) };
}
