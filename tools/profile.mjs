/** 身体轮廓量取：逐行左右边界 + 宽度，用于定 hip/neck/shoulder/裙摆 等锚点。 */
import { readFileSync, writeFileSync } from 'node:fs';
import { decodePNG, encodePNG } from '../lib/png.mjs';

const W0 = new URL('../assets/portrait.png', import.meta.url);
const img = decodePNG(readFileSync(W0));
const W = img.width, H = img.height;
const A = (x, y) => img.data[(y * W + x) * 4 + 3];
const edges = [];
for (let y = 0; y < H; y++) {
  let l = -1, r = -1;
  for (let x = 0; x < W; x++) if (A(x, y) > 24) { l = x; break; }
  for (let x = W - 1; x >= 0; x--) if (A(x, y) > 24) { r = x; break; }
  edges.push([l, r]);
}
console.log('size', W, H);
console.log('y, l, r, w, cx');
for (let y = 0; y < H; y += 20) {
  const [l, r] = edges[y];
  console.log(`${y}\t${l}\t${r}\t${r - l + 1}\t${((l + r) / 2).toFixed(0)}`);
}
// 关键点：最宽行、每段局部极值
let widest = [0, -1];
for (let y = 0; y < H; y++) { const w = edges[y][1] - edges[y][0] + 1; if (w > widest[1]) widest = [y, w]; }
console.log('widest row', widest);
// 找腰部（头下最窄）：在 y 500..900 之间
let waist = [0, 1e9];
for (let y = 480; y < 900; y++) { const w = edges[y][1] - edges[y][0] + 1; if (w < waist[1]) waist = [y, w]; }
console.log('waist', waist);
// 裙摆最大
let skirt = [0, 0];
for (let y = 900; y < 1250; y++) { const w = edges[y][1] - edges[y][0] + 1; if (w > skirt[1]) skirt = [y, w]; }
console.log('skirt widest', skirt);
// 头部最宽
let head = [0, 0];
for (let y = 0; y < 500; y++) { const w = edges[y][1] - edges[y][0] + 1; if (w > head[1]) head = [y, w]; }
console.log('head widest', head);
// 腿：裙摆以下每行的左右边界
for (let y = 1150; y < H; y += 10) {
  const [l, r] = edges[y];
  const spans = [];
  let inRun = false, s = 0;
  for (let x = 0; x < W; x++) {
    const on = A(x, y) > 24;
    if (on && !inRun) { inRun = true; s = x; }
    if (!on && inRun) { inRun = false; spans.push([s, x - 1]); }
  }
  if (inRun) spans.push([s, W - 1]);
  console.log(`y=${y} spans`, JSON.stringify(spans));
}
writeFileSync(new URL('../src/_edges.json', import.meta.url), JSON.stringify({ W, H, edges }));
