// 对比「抹脸后的 portrait.png」与「原始抠图 _base.png」，列出被改动区域的连通块。
// 用法: node tools/diffbox.mjs [阈值]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodePNG } from '../lib/png.mjs';
import { workDir } from '../lib/workdir.mjs';

const WORK = workDir();
const a = decodePNG(readFileSync(join(WORK, 'assets', 'portrait.png')));
const b = decodePNG(readFileSync(join(WORK, 'src', '_base.png')));
const W = a.width, H = a.height;
const TH = Number(process.argv[2] || 14);

const d = new Uint8Array(W * H);
let n = 0;
for (let i = 0; i < W * H; i++) {
  const o = i * 4;
  if (!b.data[o + 3] && !a.data[o + 3]) continue;
  const dd = Math.max(
    Math.abs(a.data[o] - b.data[o]),
    Math.abs(a.data[o + 1] - b.data[o + 1]),
    Math.abs(a.data[o + 2] - b.data[o + 2]),
  );
  if (dd > TH) { d[i] = 1; n++; }
}

// 4 邻接连通块
const lab = new Int32Array(W * H).fill(-1), boxes = [];
for (let i = 0; i < W * H; i++) {
  if (!d[i] || lab[i] >= 0) continue;
  const id = boxes.length, q = [i];
  lab[i] = id;
  const bb = { x0: 1e9, y0: 1e9, x1: -1, y1: -1, area: 0, sum: [0, 0, 0] };
  for (let k = 0; k < q.length; k++) {
    const p = q[k], x = p % W, y = (p / W) | 0, o = p * 4;
    bb.area++;
    bb.x0 = Math.min(bb.x0, x); bb.y0 = Math.min(bb.y0, y);
    bb.x1 = Math.max(bb.x1, x); bb.y1 = Math.max(bb.y1, y);
    bb.sum[0] += a.data[o]; bb.sum[1] += a.data[o + 1]; bb.sum[2] += a.data[o + 2];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const np = ny * W + nx;
      if (d[np] && lab[np] < 0) { lab[np] = id; q.push(np); }
    }
  }
  boxes.push(bb);
}
boxes.sort((p, q) => q.area - p.area);
console.log(`changed px (>${TH}) = ${n}, regions = ${boxes.length}`);
for (const bb of boxes.slice(0, 12)) {
  const c = bb.sum.map((v) => Math.round(v / bb.area));
  console.log(`  area=${String(bb.area).padStart(6)} box=[${bb.x0},${bb.y0}]-[${bb.x1},${bb.y1}]` +
    ` w=${bb.x1 - bb.x0 + 1} h=${bb.y1 - bb.y0 + 1} fill=rgb(${c.join(',')})`);
}
