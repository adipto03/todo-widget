// Draws the app icon (indigo circle with a white tick) as build/icon.png for the installer.
// Uses only Node's built-ins so the build doesn't need an image library.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function drawPixels(S) {
  const k = S / 32;
  const rows = Buffer.alloc((S * 4 + 1) * S);
  const segDist = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  };
  for (let y = 0; y < S; y++) {
    const rowStart = y * (S * 4 + 1);
    rows[rowStart] = 0; // no PNG row filter
    for (let x = 0; x < S; x++) {
      const cx = x + 0.5, cy = y + 0.5;
      const alpha = Math.max(0, Math.min(1, 15 * k - Math.hypot(cx - 16 * k, cy - 16 * k)));
      const d = Math.min(
        segDist(cx, cy, 9 * k, 16.5 * k, 14 * k, 21.5 * k),
        segDist(cx, cy, 14 * k, 21.5 * k, 23.5 * k, 11 * k),
      );
      const w = Math.max(0, Math.min(1, 2.6 * k - d));
      const i = rowStart + 1 + x * 4;
      rows[i] = Math.round(79 + (255 - 79) * w);
      rows[i + 1] = Math.round(70 + (255 - 70) * w);
      rows[i + 2] = Math.round(229 + (255 - 229) * w);
      rows[i + 3] = Math.round(255 * alpha);
    }
  }
  return rows;
}

const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header[8] = 8; // bit depth
header[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', zlib.deflateSync(drawPixels(SIZE), { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(__dirname, '..', 'build', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log(`Wrote ${out} (${png.length} bytes)`);
