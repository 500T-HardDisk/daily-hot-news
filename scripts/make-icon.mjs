#!/usr/bin/env node
/**
 * 生成扩展图标 icon.png（128×128，RGBA）。
 * 纯 Node 实现，不依赖任何图形库：手写 PNG 编码 + 简单抗锯齿图形。
 *
 * 用法：node scripts/make-icon.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const W = 128;
const H = 128;
const pixels = Buffer.alloc(W * H * 4, 0);

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a + (b - a) * t;

/** 带 1px 抗锯齿的圆角矩形覆盖率。 */
function roundRectCoverage(x, y, x0, y0, x1, y1, r) {
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  const d = Math.hypot(x - cx, y - cy) - r;
  return clamp01(0.5 - d);
}

function blend(x, y, r, g, b, a) {
  if (a <= 0) {
    return;
  }
  const i = (y * W + x) * 4;
  const da = pixels[i + 3] / 255;
  const oa = a + da * (1 - a);
  if (oa <= 0) {
    return;
  }
  pixels[i] = Math.round((r * a + pixels[i] * da * (1 - a)) / oa);
  pixels[i + 1] = Math.round((g * a + pixels[i + 1] * da * (1 - a)) / oa);
  pixels[i + 2] = Math.round((b * a + pixels[i + 2] * da * (1 - a)) / oa);
  pixels[i + 3] = Math.round(oa * 255);
}

function drawRoundRect(x0, y0, x1, y1, radius, colorAt, alpha = 1) {
  for (let y = Math.max(0, Math.floor(y0) - 1); y <= Math.min(H - 1, Math.ceil(y1) + 1); y++) {
    for (let x = Math.max(0, Math.floor(x0) - 1); x <= Math.min(W - 1, Math.ceil(x1) + 1); x++) {
      const cov = roundRectCoverage(x + 0.5, y + 0.5, x0, y0, x1, y1, radius);
      if (cov <= 0) {
        continue;
      }
      const [r, g, b] = colorAt(x, y);
      blend(x, y, r, g, b, cov * alpha);
    }
  }
}

const clampByte = (v) => Math.max(0, Math.min(255, Math.round(v)));

/* 1. 圆角背景：蓝色渐变 */
drawRoundRect(2, 2, 126, 126, 28, (x, y) => {
  const t = clamp01((x + y) / (W + H));
  return [
    clampByte(mix(37, 11, t)), // #2563EB → #0B2A6B
    clampByte(mix(99, 42, t)),
    clampByte(mix(235, 107, t)),
  ];
});

/* 2. 白色“报纸”卡片 */
drawRoundRect(24, 18, 104, 110, 12, () => [250, 250, 252], 1);

/* 3. 卡片内容：顶部橙色色块 + 若干灰色文本行 */
drawRoundRect(34, 28, 94, 42, 5, (x, y) => {
  const t = clamp01((x - 34) / 60);
  return [clampByte(mix(249, 234, t)), clampByte(mix(115, 88, t)), clampByte(mix(22, 12, t))];
});

const lines = [
  [34, 52, 94, 59, [80, 86, 99]],
  [34, 64, 80, 71, [140, 146, 158]],
  [34, 76, 94, 83, [140, 146, 158]],
  [34, 88, 68, 95, [180, 186, 196]],
  [34, 100, 88, 107, [200, 205, 214]],
];

for (const [x0, y0, x1, y1, color] of lines) {
  drawRoundRect(x0, y0, x1, y1, 3.5, () => color, 1);
}

/* ---------------- PNG 编码 ---------------- */

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crcBuf]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type: RGBA
ihdr[10] = 0; // compression
ihdr[11] = 0; // filter
ihdr[12] = 0; // interlace

const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 4 + 1)] = 0; // filter type 0
  pixels.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const outFile = join(ROOT, 'icon.png');
writeFileSync(outFile, png);
console.log(`✅ 已生成 ${outFile}（${png.length} 字节）`);
