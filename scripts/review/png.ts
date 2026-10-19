// A minimal lossless PNG reader/writer for review sheets: 8-bit RGB/RGBA,
// non-interlaced (what Remotion's renderStill and Blender write). Remotion's
// bundled ffmpeg has no compositing filters, so contact sheets, crops, and
// alpha composites are done here, exactly, with zlib. Node-only.

import { readFileSync, writeFileSync } from 'node:fs';
import zlib from 'node:zlib';

export interface Image {
  width: number;
  height: number;
  /** RGBA, 8 bits per channel, row-major. */
  data: Uint8Array;
}

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function readPng(file: string): Image {
  const buf = readFileSync(file);
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error(`${file} is not a PNG`);
  let off = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const depth = body[8]!;
      colorType = body[9]!;
      if (depth !== 8 || (colorType !== 2 && colorType !== 6) || body[12] !== 0) throw new Error(`${file}: only 8-bit RGB/RGBA non-interlaced PNGs`);
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = new Uint8Array(width * height * 4);
  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)]!;
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp]! : 0;
      const b = prev[i]!;
      const c = i >= bpp ? prev[i - bpp]! : 0;
      let v = row[i]!;
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      out[o] = cur[x * bpp]!;
      out[o + 1] = cur[x * bpp + 1]!;
      out[o + 2] = cur[x * bpp + 2]!;
      out[o + 3] = bpp === 4 ? cur[x * bpp + 3]! : 255;
    }
    prev.set(cur);
  }
  return { width, height, data: out };
}

function chunk(type: string, body: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const tb = Buffer.from(type, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([tb, body])) >>> 0);
  return Buffer.concat([len, tb, body, crc]);
}

export function writePng(file: string, img: Image): void {
  const stride = img.width * 4;
  const raw = Buffer.alloc((stride + 1) * img.height);
  for (let y = 0; y < img.height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(img.data.buffer, img.data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0);
  ihdr.writeUInt32BE(img.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  writeFileSync(file, Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
}

export function blank(width: number, height: number, rgba: [number, number, number, number]): Image {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(rgba, i * 4);
  return { width, height, data };
}

export function crop(img: Image, x: number, y: number, w: number, h: number): Image {
  const out = blank(w, h, [0, 0, 0, 0]);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const sx = x + i;
      const sy = y + j;
      if (sx < 0 || sy < 0 || sx >= img.width || sy >= img.height) continue;
      out.data.set(img.data.subarray((sy * img.width + sx) * 4, (sy * img.width + sx) * 4 + 4), (j * w + i) * 4);
    }
  }
  return out;
}

/** Source-over composite of `src` onto `dst` at (x, y), with an optional global opacity. */
export function over(dst: Image, src: Image, x: number, y: number, opacity = 1): void {
  for (let j = 0; j < src.height; j++) {
    const dy = y + j;
    if (dy < 0 || dy >= dst.height) continue;
    for (let i = 0; i < src.width; i++) {
      const dx = x + i;
      if (dx < 0 || dx >= dst.width) continue;
      const s = (j * src.width + i) * 4;
      const d = (dy * dst.width + dx) * 4;
      const a = (src.data[s + 3]! / 255) * opacity;
      if (a <= 0) continue;
      const da = dst.data[d + 3]! / 255;
      const oa = a + da * (1 - a);
      for (let c = 0; c < 3; c++) dst.data[d + c] = Math.round((src.data[s + c]! * a + dst.data[d + c]! * da * (1 - a)) / Math.max(oa, 1e-9));
      dst.data[d + 3] = Math.round(oa * 255);
    }
  }
}

/** Box-filtered resize (downscale) or nearest (upscale). */
export function resize(img: Image, w: number, h: number): Image {
  const out = blank(w, h, [0, 0, 0, 0]);
  const sx = img.width / w;
  const sy = img.height / h;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const x0 = Math.floor(i * sx);
      const y0 = Math.floor(j * sy);
      const x1 = Math.max(x0 + 1, Math.floor((i + 1) * sx));
      const y1 = Math.max(y0 + 1, Math.floor((j + 1) * sy));
      const acc = [0, 0, 0, 0];
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const o = (Math.min(y, img.height - 1) * img.width + Math.min(x, img.width - 1)) * 4;
          const a = img.data[o + 3]!;
          acc[0]! += img.data[o]! * a;
          acc[1]! += img.data[o + 1]! * a;
          acc[2]! += img.data[o + 2]! * a;
          acc[3]! += a;
          n++;
        }
      }
      const o = (j * w + i) * 4;
      if (acc[3]! > 0) {
        out.data[o] = Math.round(acc[0]! / acc[3]!);
        out.data[o + 1] = Math.round(acc[1]! / acc[3]!);
        out.data[o + 2] = Math.round(acc[2]! / acc[3]!);
      }
      out.data[o + 3] = Math.round(acc[3]! / n);
    }
  }
  return out;
}

/** The bounding box of pixels with alpha above a threshold (null when empty). */
export function alphaBounds(img: Image, threshold = 8): { x: number; y: number; w: number; h: number } | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3]! > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function hexRgba(hex: string, alpha = 255): [number, number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), alpha];
}
