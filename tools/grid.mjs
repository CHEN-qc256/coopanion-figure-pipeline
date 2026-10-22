/** 在脸部裁图上画带坐标标签的网格（2x），用于人工读准眼/嘴位置；同时打印格子颜色表。 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePNG, encodePNG } from '../lib/png.mjs';
import { crop } from '../lib/img.mjs';
import { workDir } from '../lib/workdir.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORK = workDir();
const SRC = join(WORK, 'src', '20261022-095419-第-1-张图是-画风与构图模板-Q-版二头身-正-2.png');

// 用 prep.mjs 产出的 _probe.png（已抠透明+裁边）作为底图，保证坐标一致
const base = decodePNG(readFileSync(join(WORK, 'src', '_probe.png')));
const W = base.width, H = base.height;

const FACE = { x0: 275, y0: 284, x1: 551, y1: 492 };
const PAD = 8;
const R = { x: FACE.x0 - PAD, y: FACE.y0 - PAD, w: FACE.x1 - FACE.x0 + PAD * 2, h: FACE.y1 - FACE.y0 + PAD * 2 };
const f = crop(base, R);
const S = 2;
const out = new Uint8Array(R.w * S * R.h * S * 4);
for (let y = 0; y < R.h * S; y++) for (let x = 0; x < R.w * S; x++) {
  const s = ((y / S) | 0) * R.w + ((x / S) | 0);
  const d = y * R.w * S + x;
  // 背景铺白，便于看清
  let r = f.data[s * 4], g = f.data[s * 4 + 1], b = f.data[s * 4 + 2], a = f.data[s * 4 + 3];
  if (a < 16) { r = 235; g = 235; b = 240; }
  out[d * 4] = r; out[d * 4 + 1] = g; out[d * 4 + 2] = b; out[d * 4 + 3] = 255;
}

const put = (x, y, c) => { if (x < 0 || y < 0 || x >= R.w * S || y >= R.h * S) return; const d = (y * R.w * S + x) * 4; out[d] = c[0]; out[d + 1] = c[1]; out[d + 2] = c[2]; };

// 每 10 源像素一条细线；每 50 一条亮线
for (let sx = Math.ceil((R.x) / 10) * 10; sx <= R.x + R.w; sx += 10) {
  const X = (sx - R.x) * S;
  const major = sx % 50 === 0;
  for (let y = 0; y < R.h * S; y++) for (let k = 0; k < (major ? 2 : 1); k++) put(X + k, y, major ? [0, 160, 255] : [140, 210, 255]);
}
for (let sy = Math.ceil((R.y) / 10) * 10; sy <= R.y + R.h; sy += 10) {
  const Y = (sy - R.y) * S;
  const major = sy % 50 === 0;
  for (let x = 0; x < R.w * S; x++) for (let k = 0; k < (major ? 2 : 1); k++) put(x, Y + k, major ? [0, 160, 255] : [140, 210, 255]);
}

// 5x7 数字/符号位图，用于标坐标
const GLY = {
  '0': ['111', '101', '101', '101', '111'], '1': ['010', '110', '010', '010', '111'], '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'], '4': ['101', '101', '111', '001', '001'], '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'], '7': ['111', '001', '010', '010', '010'], '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'], ' ': ['000', '000', '000', '000', '000'], '-': ['000', '000', '111', '000', '000'],
};
function text(str, x0, y0, c) {
  let cx = x0;
  for (const ch of str) {
    const g = GLY[ch] || GLY[' '];
    for (let r = 0; r < 5; r++) for (let q = 0; q < 3; q++) if (g[r][q] === '1') put(cx + q, y0 + r, c);
    cx += 4;
  }
}
// 顶部标 x 坐标（每 50）
for (let sx = Math.ceil(R.x / 50) * 50; sx <= R.x + R.w; sx += 50) {
  const X = (sx - R.x) * S + 2;
  text(String(sx), X, 1, [200, 0, 0]);
}
// 左侧标 y 坐标（每 50）
for (let sy = Math.ceil(R.y / 50) * 50; sy <= R.y + R.h; sy += 50) {
  const Y = (sy - R.y) * S + 2;
  text(String(sy), 1, Y, [200, 0, 0]);
}

writeFileSync(join(WORK, 'src', '_grid.png'), encodePNG({ width: R.w * S, height: R.h * S, data: Buffer.from(out) }));
console.log('grid', R.x, R.y, R.w, R.h, '->', R.w * S, R.h * S);

// 颜色采样表：每 12 源像素一个点，只打印高饱和/纯白/很暗的点，帮助定位虹膜·巩膜·睫毛
const luma = (r, g, b) => .2126 * r + .7152 * g + .0722 * b;
const rows = [];
for (let y = FACE.y0; y <= FACE.y1; y += 6) for (let x = FACE.x0; x <= FACE.x1; x += 6) {
  const i = (y * W + x) * 4;
  const r = base.data[i], g = base.data[i + 1], b = base.data[i + 2], a = base.data[i + 3];
  if (a < 200) continue;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx ? (mx - mn) / mx : 0, L = luma(r, g, b);
  if (r > 243 && g > 243 && b > 243) rows.push(`W ${x},${y}`);
  else if (L < 70) rows.push(`K ${x},${y}`);
  else if (sat > .5 && L > 80 && L < 200) rows.push(`O ${x},${y}`);
}
console.log(rows.join(' | '));
