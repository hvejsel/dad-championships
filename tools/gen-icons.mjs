// Generates the PNG app icons from scratch (no image libraries).
// Run with: node tools/gen-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const SS = 3; // supersampling factor, for smooth edges

const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour with alpha
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const BG_TOP = [30, 35, 47];
const BG_BOTTOM = [15, 17, 21];
const GOLD = [245, 196, 81];
const GOLD_DARK = [183, 143, 44];

function roundedSquare(x, y, size) {
  const r = size * 0.225;
  const cx = Math.min(Math.max(x, r), size - r);
  const cy = Math.min(Math.max(y, r), size - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/** Trophy silhouette in unit coordinates (0..1 of the icon side). */
function inTrophy(u, v) {
  const cx = 0.5;
  const dx = Math.abs(u - cx);

  // cup: wide at the top, narrowing and rounding towards the stem
  if (v >= 0.235 && v <= 0.565) {
    const t = (v - 0.235) / 0.33;
    const halfWidth = 0.215 * (1 - 0.62 * t * t) * (t > 0.86 ? Math.sqrt(1 - ((t - 0.86) / 0.15) ** 2) : 1);
    if (dx <= halfWidth) return 'cup';
  }

  // handles: open rings on either side of the cup
  for (const side of [-1, 1]) {
    const hx = u - (cx + side * 0.238);
    const hy = v - 0.315;
    const dist = Math.hypot(hx, hy);
    if (dist <= 0.098 && dist >= 0.062 && side * hx > -0.03) return 'handle';
  }

  // stem
  if (v > 0.545 && v <= 0.68 && dx <= 0.048) return 'cup';
  // foot
  if (v > 0.68 && v <= 0.715 && dx <= 0.10) return 'cup';
  // base
  if (v > 0.715 && v <= 0.775 && dx <= 0.175) return 'base';

  return null;
}

function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          if (!roundedSquare(px, py, size)) continue;

          const shade = py / size;
          let cr = BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * shade;
          let cg = BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * shade;
          let cb = BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * shade;

          const part = inTrophy(px / size, py / size);
          if (part) {
            const gradient = Math.min(1, Math.max(0, (py / size - 0.23) / 0.55));
            const mix = part === 'base' ? 0.55 : gradient * 0.45;
            cr = GOLD[0] + (GOLD_DARK[0] - GOLD[0]) * mix;
            cg = GOLD[1] + (GOLD_DARK[1] - GOLD[1]) * mix;
            cb = GOLD[2] + (GOLD_DARK[2] - GOLD[2]) * mix;
          }
          r += cr; g += cg; b += cb; a += 255;
        }
      }
      const samples = SS * SS;
      const i = (y * size + x) * 4;
      const coverage = a / samples / 255;
      rgba[i] = Math.round(r / samples / (coverage || 1));
      rgba[i + 1] = Math.round(g / samples / (coverage || 1));
      rgba[i + 2] = Math.round(b / samples / (coverage || 1));
      rgba[i + 3] = Math.round(a / samples);
    }
  }
  return encodePng(size, size, rgba);
}

for (const size of [180, 192, 512]) {
  const name = `icon-${size}.png`;
  writeFileSync(new URL(`../${name}`, import.meta.url), renderIcon(size));
  console.log(`wrote ${name}`);
}
