import { deflateSync } from 'node:zlib';
import { nativeImage, type NativeImage } from 'electron';

/**
 * Builds a monochrome clock glyph as a macOS *template image* — black pixels
 * with an alpha mask, which the OS recolors for light/dark menu bars. We draw
 * it ourselves (rather than reuse the colored app icon) because a colored icon
 * disappears against a dark menu bar.
 *
 * Self-contained: rasterizes the glyph by 3× supersampling for cheap
 * anti-aliasing, then encodes a real (zlib-compressed) PNG. Returns a template
 * NativeImage at 2× density. Callers should fall back to the app icon if this
 * throws.
 */
export function buildClockTemplateImage(): NativeImage {
  const size = 36; // @2x of an 18pt menu-bar slot
  const rgba = rasterizeClock(size);
  const png = encodePng(size, size, rgba);
  const img = nativeImage.createFromBuffer(png, { scaleFactor: 2 });
  img.setTemplateImage(true);
  return img;
}

/** Returns an RGBA buffer (black, alpha-masked) of a clock face with hands. */
function rasterizeClock(size: number): Buffer {
  const ss = 3; // supersample factor
  const buf = Buffer.alloc(size * size * 4, 0);
  const c = size / 2;
  const r = size * 0.42; // outer radius
  const ringInner = r - size * 0.11; // ring thickness
  // Hands: hour points up-right (~2 o'clock), minute points up. Lengths in px.
  const hourLen = r * 0.5;
  const minLen = r * 0.72;
  const handHalf = size * 0.05; // half-thickness of a hand stroke
  const hourEnd = { x: c + hourLen * Math.cos(-Math.PI / 6), y: c + hourLen * Math.sin(-Math.PI / 6) };
  const minEnd = { x: c, y: c - minLen };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0;
      const samples = ss * ss;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const px = x + (sx + 0.5) / ss;
          const py = y + (sy + 0.5) / ss;
          const d = Math.hypot(px - c, py - c);
          const inRing = d <= r && d >= ringInner;
          const onHour = pointNearSegment(px, py, c, c, hourEnd.x, hourEnd.y) <= handHalf && d <= r;
          const onMin = pointNearSegment(px, py, c, c, minEnd.x, minEnd.y) <= handHalf && d <= r;
          const onHub = d <= size * 0.06;
          if (inRing || onHour || onMin || onHub) hits++;
        }
      }
      if (hits > 0) {
        const alpha = Math.round((hits / samples) * 255);
        const i = (y * size + x) * 4;
        buf[i] = 0;
        buf[i + 1] = 0;
        buf[i + 2] = 0;
        buf[i + 3] = alpha;
      }
    }
  }
  return buf;
}

/** Distance from point (px,py) to segment (ax,ay)-(bx,by). */
function pointNearSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

// ----- minimal PNG encoder (truecolor + alpha, no filtering) ----------------

function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Each scanline is prefixed with a filter-type byte (0 = none).
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw);

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

let crcTable: number[] | null = null;
function crc32(buf: Buffer): number {
  if (!crcTable) {
    crcTable = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}
