/** 探索：在脸框里试几种「眼」判据，打印候选连通域，供选型。一次性脚本。 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePNG, encodePNG } from '../lib/png.mjs';
import { image, crop, alphaBox } from '../lib/img.mjs';
import { workDir } from '../lib/workdir.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORK = workDir();
const SRC = join(WORK, 'src', '20261022-095419-第-1-张图是-画风与构图模板-Q-版二头身-正-2.png');
const raw = decodePNG(readFileSync(SRC));
const trim = crop(raw, alphaBox({ ...raw, data: (() => { const d = Buffer.alloc(raw.width * raw.height * 4); for (let i = 0; i < raw.width * raw.height; i++) { const r = raw.data[i * 4], g = raw.data[i * 4 + 1], b = raw.data[i * 4 + 2]; const nx = i % raw.width, ny = (i / raw.width) | 0; const edge = nx < 3 || ny < 3 || nx > raw.width - 4 || ny > raw.height - 4; const w = Math.min(r, g, b) > 236; d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = w && !edge ? 0 : 255; } return d; })() }, 8));

const W = trim.width, H = trim.height;
const FACE = { x0: 275, y0: 284, x1: 551, y1: 492 };

function cc(accept, minArea = 30) {
  const seen = new Int32Array(W * H).fill(0);
  const out = [];
  for (let y = FACE.y0; y <= FACE.y1; y++) for (let x = FACE.x0; x <= FACE.x1; x++) {
    const p = y * W + x;
    if (seen[p] || !accept(p)) continue;
    const list = []; const st = [p]; seen[p] = 1;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    while (st.length) {
      const q = st.pop(); list.push(q);
      const qx = q % W, qy = (q / W) | 0;
      if (qx < x0) x0 = qx; if (qx > x1) x1 = qx; if (qy < y0) y0 = qy; if (qy > y1) y1 = qy;
      for (const n of [qx > 0 ? q - 1 : -1, qx < W - 1 ? q + 1 : -1, qy > 0 ? q - W : -1, qy < H - 1 ? q + W : -1]) {
        if (n < 0 || seen[n]) continue;
        const nx = n % W, ny = (n / W) | 0;
        if (nx < FACE.x0 || nx > FACE.x1 || ny < FACE.y0 || ny > FACE.y1) continue;
        if (!accept(n)) continue;
        seen[n] = 1; st.push(n);
      }
    }
    if (list.length >= minArea) out.push({ area: list.length, x0, y0, x1, y1, px: list });
  }
  return out.sort((a, b) => b.area - a.area);
}

const px = (p) => { const i = p * 4; return [trim.data[i], trim.data[i + 1], trim.data[i + 2]]; };
const lum = ([r, g, b]) => .2126 * r + .7152 * g + .0722 * b;
const sat = ([r, g, b]) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx ? (mx - mn) / mx : 0; };

const sets = {
  pureWhite: (p) => { const c = px(p); return c[0] > 243 && c[1] > 243 && c[2] > 243; },
  dark: (p) => lum(px(p)) < 80,
  irisOrange: (p) => { const c = px(p); return sat(c) > .45 && lum(c) > 70 && lum(c) < 210 && c[0] > c[1] && c[1] > c[2]; },
};

const dbg = image(W, H); dbg.data.set(trim.data);
const colors = { pureWhite: [255, 0, 0], dark: [0, 200, 0], irisOrange: [0, 0, 255] };
const lines = [];
for (const [name, fn] of Object.entries(sets)) {
  const got = cc(fn, 120);
  lines.push(`== ${name}: ${got.length} blobs`);
  for (const g of got.slice(0, 8)) {
    lines.push(`   area ${g.area} box [${g.x0},${g.y0},${g.x1 - g.x0 + 1},${g.y1 - g.y0 + 1}] mean ${px(g.px[0])}`);
    const c = colors[name];
    for (const p of g.px) { dbg.data[p * 4] = c[0]; dbg.data[p * 4 + 1] = c[1]; dbg.data[p * 4 + 2] = c[2]; }
  }
}
console.log(lines.join('\n'));
const f = crop(dbg, { x: FACE.x0 - 12, y: FACE.y0 - 12, w: FACE.x1 - FACE.x0 + 24, h: FACE.y1 - FACE.y0 + 24 });
const big = image(f.width * 2, f.height * 2);
for (let y = 0; y < big.height; y++) for (let x = 0; x < big.width; x++) {
  const s = (Math.floor(y / 2) * f.width + Math.floor(x / 2)) * 4, d = (y * big.width + x) * 4;
  big.data[d] = f.data[s]; big.data[d + 1] = f.data[s + 1]; big.data[d + 2] = f.data[s + 2]; big.data[d + 3] = f.data[s + 3];
}
writeFileSync(join(WORK, 'src', '_sets.png'), encodePNG(big));
console.log('crop offset', FACE.x0 - 12, FACE.y0 - 12, 'size', f.width, f.height);
