// Strict RIFF/WAVE reader and PCM16 writer for narration artifacts.
//
// Every candidate's audio enters the evaluation through parseWav: anything that
// is not a well-formed 16-bit integer PCM file (mono or stereo) with exactly one
// fmt chunk and one non-empty data chunk is refused, so a truncated, mislabelled,
// float-encoded, or empty file can never be hashed as a narration artifact.
// Isomorphic (no Node imports).

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  /** Sample frames (one sample per channel). */
  frames: number;
  durationMs: number;
  /** Byte offset and length of the data chunk payload inside the file. */
  dataOffset: number;
  dataLength: number;
}

export class WavFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WavFormatError';
  }
}

const WAVE_FORMAT_PCM = 1;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;

function fourcc(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
}

export function parseWav(bytes: Uint8Array): WavInfo {
  if (bytes.length < 12 || fourcc(bytes, 0) !== 'RIFF' || fourcc(bytes, 8) !== 'WAVE') throw new WavFormatError('not a RIFF/WAVE file');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let fmt: { sampleRate: number; channels: number; bitsPerSample: number } | null = null;
  let data: { offset: number; length: number } | null = null;
  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = fourcc(bytes, at);
    const size = view.getUint32(at + 4, true);
    const payload = at + 8;
    if (payload + size > bytes.length) throw new WavFormatError(`chunk ${JSON.stringify(id)} runs past the end of the file`);
    if (id === 'fmt ') {
      if (fmt) throw new WavFormatError('more than one fmt chunk');
      if (size < 16) throw new WavFormatError('fmt chunk too short');
      let format = view.getUint16(payload, true);
      const channels = view.getUint16(payload + 2, true);
      const sampleRate = view.getUint32(payload + 4, true);
      const byteRate = view.getUint32(payload + 8, true);
      const blockAlign = view.getUint16(payload + 12, true);
      const bitsPerSample = view.getUint16(payload + 14, true);
      if (format === WAVE_FORMAT_EXTENSIBLE) {
        if (size < 40) throw new WavFormatError('WAVE_FORMAT_EXTENSIBLE chunk too short');
        format = view.getUint16(payload + 24, true);
      }
      if (format !== WAVE_FORMAT_PCM) throw new WavFormatError(`unsupported sample format ${format} (only integer PCM)`);
      if (bitsPerSample !== 16) throw new WavFormatError(`unsupported bit depth ${bitsPerSample} (only 16-bit PCM)`);
      if (channels !== 1 && channels !== 2) throw new WavFormatError(`unsupported channel count ${channels}`);
      if (sampleRate < 8000 || sampleRate > 192_000) throw new WavFormatError(`unsupported sample rate ${sampleRate}`);
      if (blockAlign !== channels * 2 || byteRate !== sampleRate * blockAlign) throw new WavFormatError('fmt chunk is internally inconsistent');
      fmt = { sampleRate, channels, bitsPerSample };
    } else if (id === 'data') {
      if (data) throw new WavFormatError('more than one data chunk');
      data = { offset: payload, length: size };
    }
    at = payload + size + (size % 2);
  }
  if (!fmt) throw new WavFormatError('no fmt chunk');
  if (!data) throw new WavFormatError('no data chunk');
  if (data.length === 0) throw new WavFormatError('empty data chunk');
  const blockAlign = fmt.channels * 2;
  if (data.length % blockAlign !== 0) throw new WavFormatError('data chunk is not whole sample frames');
  const frames = data.length / blockAlign;
  return { ...fmt, frames, durationMs: Math.round((frames * 1000) / fmt.sampleRate), dataOffset: data.offset, dataLength: data.length };
}

/** Mono samples in [-1, 1): a stereo file is averaged to mono. */
export function decodePcm16Mono(bytes: Uint8Array, info: WavInfo): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset + info.dataOffset, info.dataLength);
  const out = new Float32Array(info.frames);
  const ch = info.channels;
  for (let i = 0; i < info.frames; i++) {
    let sum = 0;
    for (let c = 0; c < ch; c++) sum += view.getInt16((i * ch + c) * 2, true);
    out[i] = sum / ch / 32768;
  }
  return out;
}

/** Wrap raw little-endian 16-bit PCM in a canonical 44-byte WAV header. */
export function wrapPcm16(pcm: Uint8Array, sampleRate: number, channels: 1 | 2): Uint8Array {
  if (pcm.length === 0 || pcm.length % (channels * 2) !== 0) throw new WavFormatError('PCM payload is not whole 16-bit frames');
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192_000) throw new WavFormatError(`unsupported sample rate ${sampleRate}`);
  const out = new Uint8Array(44 + pcm.length);
  const v = new DataView(out.buffer);
  const tag = (at: number, s: string) => {
    for (let i = 0; i < 4; i++) out[at + i] = s.charCodeAt(i);
  };
  tag(0, 'RIFF');
  v.setUint32(4, 36 + pcm.length, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, WAVE_FORMAT_PCM, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * channels * 2, true);
  v.setUint16(32, channels * 2, true);
  v.setUint16(34, 16, true);
  tag(36, 'data');
  v.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

/** Mono float samples -> 16-bit PCM WAV (values are clamped; nothing else is changed). */
export function encodeWavPcm16(samples: Float32Array, sampleRate: number): Uint8Array {
  const pcm = new Uint8Array(samples.length * 2);
  const view = new DataView(pcm.buffer);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(i * 2, Math.round(v * 32767), true);
  }
  return wrapPcm16(pcm, sampleRate, 1);
}
