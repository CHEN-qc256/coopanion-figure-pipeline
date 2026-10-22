/**
 * 量取五官锚点 + 抹掉原画五官（眼睛/眉毛/嘴），产出光皮底图。
 * 用法：
 *   node tools/measure.mjs           只画验证图 src/_fit.png
 *   node tools/measure.mjs --write   同时写出 assets/portrait.png 与 measure.json
 * 坐标全部在「裁边后 850x1365」空间里。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePNG, encodePNG } from '../lib/png.mjs';
import { crop } from '../lib/img.mjs';
import { workDir } from '../lib/workdir.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORK = workDir();
const base = decodePNG(readFileSync(join(WORK, 'src', '_base.png')));
const W = base.width, H = base.height;
const D = base.data;

// ---- 锚点参数（在裁边空间；每轮看 _fit.png 校准）----
const P = {
  face: { x0: 275, y0: 284, x1: 551, y1: 492 },
  eyeL: { cx: 322, cy: 369, rx: 46, ry: 49 },   // 观众视角左眼
  eyeR: { cx: 505, cy: 369, rx: 46, ry: 49 },   // 观众视角右眼
  browY: 318,                                    // 抹除区上沿（含眉毛）
  mouth: { cx: 403, cy: 451, rx: 9, ry: 5 },
  skin: [252, 232, 212],
};

const px = (x, y) => { const i = (y * W + x) * 4; return [D[i], D[i + 1], D[i + 2], D[i + 3]]; };
const isSkin = (x, y) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return false;
  const [r, g, b, a] = px(x, y);
  if (a < 200) return false;
  return Math.abs(r - 251) < 34 && Math.abs(g - 231) < 38 && Math.abs(b - 211) < 40 && r >= g && g >= b;
};
const apply = (img, x, y, c) => { const i = (y * W + x) * 4; img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255; };
const ring = (img, cx, cy, rx, ry, c, n = 720) => {
  for (let k = 0; k < n; k++) {
    const a = k / n * Math.PI * 2;
    const x = Math.round(cx + Math.cos(a) * rx), y = Math.round(cy + Math.sin(a) * ry);
    if (x >= 0 && y >= 0 && x < W && y < H) apply(img, x, y, c);
  }
};
const hline = (img, x0, x1, y, c) => { for (let x = x0; x <= x1; x++) if (x >= 0 && x < W) apply(img, x, y, c); };
const vline = (img, y0, y1, x, c) => { for (let y = y0; y <= y1; y++) if (y >= 0 && y < H) apply(img, x, y, c); };

// ---- 抹除：超椭圆（上沿压平，能盖住眉毛）内用「逐行肤色轮廓」铺平 ----
// 逐行轮廓 = 该行脸内（排除抹除区）肤色像素的逐通道中位数，再沿 y 做高斯平滑。
// 好处：没有逐列插值的竖向条纹，脸的高光/腮红渐变天然保留。
function rowProfile(img, mask, x0, x1, y0, y1) {
  const prof = [];
  for (let y = y0; y <= y1; y++) {
    const ch = [[], [], []];
    for (let x = x0; x <= x1; x++) {
      if (mask(x, y)) continue;
      if (!isSkin(x, y)) continue;
      const [r, g, b] = px(x, y);
      ch[0].push(r); ch[1].push(g); ch[2].push(b);
    }
    if (ch[0].length >= 8) {
      const med = ch.map((a) => { a.sort((p, q) => p - q); return a[a.length >> 1]; });
      prof[y - y0] = med;
    } else prof[y - y0] = null;
  }
  // 空行用左右邻居插值
  for (let i = 0; i < prof.length; i++) {
    if (prof[i]) continue;
    let a = i - 1, b = i + 1;
    while (a >= 0 && !prof[a]) a--;
    while (b < prof.length && !prof[b]) b++;
    prof[i] = a >= 0 ? prof[a] : b < prof.length ? prof[b] : P.skin.slice();
  }
  // 高斯平滑（sigma≈9 行）
  const K = 27, sig = 9;
  const w = []; let sum = 0;
  for (let k = -K; k <= K; k++) { const v = Math.exp(-(k * k) / (2 * sig * sig)); w.push(v); sum += v; }
  const out = prof.map((_, i) => {
    const acc = [0, 0, 0];
    for (let k = -K; k <= K; k++) {
      const j = Math.min(prof.length - 1, Math.max(0, i + k));
      for (let c = 0; c < 3; c++) acc[c] += prof[j][c] * w[k + K];
    }
    return acc.map((v) => Math.round(v / sum));
  });
  return out;
}

/** 软边抹除：maskFn 圈出「要抹掉的原画像素」，再用
 *  「同行左右最近皮肤像素的中值插值 + 逐行 profile 各占一半」铺色，
 *  最后按到 mask 边界的距离做 3px 羽化。
 *  早期版本是硬边超椭圆 → 在脸上留下方角浅色块，还会啃掉刘海下沿。 */
function paintSoft(img, box, maskFn, prof, yBase) {
  const { x0, x1, y0, y1 } = box;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  if (w <= 0 || h <= 0) return;
  const m = new Uint8Array(w * h);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (maskFn(x, y)) m[(y - y0) * w + (x - x0)] = 1;
  // 软边：mask 内 alpha=1，外侧 3px 内线性降到 0
  const a = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (m[i]) { a[i] = 1; continue; }
    let best = 99;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (m[ny * w + nx]) { const d = Math.hypot(dx, dy); if (d < best) best = d; }
    }
    if (best < 99) a[i] = Math.max(0, Math.min(1, (3.2 - best) / 2.8));
    // 羽化不许溢进头发：刘海边缘的像素必须原样保留，否则会亮一圈
    if (a[i] > 0 && hairAt(x + x0, y + y0)) a[i] = 0;
  }
  const profAt = (y) => prof[Math.max(0, Math.min(prof.length - 1, y - yBase))] || P.skin;
  for (let y = 0; y < h; y++) {
    const yy = y + y0;
    for (let x = 0; x < w; x++) {
      const al = a[y * w + x];
      if (al <= 0.004) continue;
      // 左右锚点：同一行、mask 外、仍是皮肤
      let lx = -1, rx = -1;
      for (let k = x - 1; k >= 0; k--) if (!m[y * w + k] && isSkin(k + x0, yy)) { lx = k; break; }
      for (let k = x + 1; k < w; k++) if (!m[y * w + k] && isSkin(k + x0, yy)) { rx = k; break; }
      const p = profAt(yy);
      for (let c = 0; c < 3; c++) {
        let fill;
        if (lx >= 0 && rx >= 0) {
          const t = (x - lx) / (rx - lx);
          const A = img.data[(yy * W + (lx + x0)) * 4 + c], B = img.data[(yy * W + (rx + x0)) * 4 + c];
          fill = (A + (B - A) * t + p[c]) * .5;
        } else fill = p[c];
        const o = (yy * W + (x + x0)) * 4 + c;
        img.data[o] = Math.round(img.data[o] + (fill - img.data[o]) * al);
      }
    }
  }
}

/** 头发掩码：从脸框上沿泛洪「橙色」像素。刘海垂到眼睛上沿的那一缕不会被抹掉
 *  —— 眼睛的超椭圆没法靠颜色和虹膜区分，但「连通到头顶」的橙色只有头发；
 *  睫毛是黑的，正好把虹膜和刘海隔开，泛洪漏不进眼睛。 */
const hairAt = (() => {
  const { x0, x1, y0, y1 } = P.face;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const isHair = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    const [r, g, b] = px(x, y);
    const L = .3 * r + .59 * g + .11 * b;
    return L < 224 && r - b > 42 && g < 214;
  };
  const m = new Uint8Array(w * h), q = [];
  const push = (x, y) => {
    if (x < x0 || y < y0 || x > x1 || y > y1) return;
    const i = (y - y0) * w + (x - x0);
    if (m[i] || !isHair(x, y)) return;
    m[i] = 1; q.push(i);
  };
  for (let x = x0; x <= x1; x++) for (let y = y0; y < Math.min(y0 + 26, y1); y++) push(x, y);
  for (let i = 0; i < q.length; i++) {
    const ix = q[i] % w, iy = (q[i] / w) | 0;
    push(ix + x0 + 1, iy + y0); push(ix + x0 - 1, iy + y0);
    push(ix + x0, iy + y0 + 1); push(ix + x0, iy + y0 - 1);
  }
  return (x, y) => (x >= x0 && y >= y0 && x <= x1 && y <= y1) ? !!m[(y - y0) * w + (x - x0)] : false;
})();

/** 眼区掩码：眼形超椭圆 ∪ 贴着刘海下沿的一条「眉毛带」，两者都避开头发。
 *  眉毛带只吃「上方 7px 还是皮肤」的非皮肤像素 —— 刘海垂下来的那一缕
 *  （上方也是刘海）不会被整块矩形啃掉，只抹掉贴在额头上的细眉毛。 */
const eyeMaskFn = (e, browTop, browHalf) => (x, y) => {
  if (hairAt(x, y)) return false;
  const u = Math.abs((x - e.cx) / (e.rx + 4)), v = Math.abs((y - e.cy) / (e.ry + 4));
  if (Math.pow(u, 2.6) + Math.pow(v, 2.6) <= 1) return true;
  return Math.abs(x - e.cx) <= browHalf && y >= browTop && y <= browTop + 26
    && !isSkin(x, y) && (y - 7 < 0 || isSkin(x, y - 7));
};

const fit = { width: W, height: H, data: Buffer.from(D) };
ring(fit, P.eyeL.cx, P.eyeL.cy, P.eyeL.rx, P.eyeL.ry, [255, 0, 0]);
ring(fit, P.eyeR.cx, P.eyeR.cy, P.eyeR.rx, P.eyeR.ry, [0, 255, 0]);
ring(fit, P.mouth.cx, P.mouth.cy, P.mouth.rx, P.mouth.ry, [0, 128, 255]);
hline(fit, P.face.x0, P.face.x1, P.browY, [255, 0, 255]);
hline(fit, P.face.x0, P.face.x1, P.face.y0, [120, 0, 200]);
hline(fit, P.face.x0, P.face.x1, P.face.y1, [120, 0, 200]);
vline(fit, P.face.y0, P.face.y1, P.face.x0, [120, 0, 200]);
vline(fit, P.face.y0, P.face.y1, P.face.x1, [120, 0, 200]);
// 中线
vline(fit, P.face.y0, P.face.y1, Math.round((P.face.x0 + P.face.x1) / 2), [255, 160, 0]);

/** 抹除掩码：两个眼区（含眉毛带）+ 嘴。 */
const maskAt = (x, y) => {
  for (const e of [P.eyeL, P.eyeR]) {
    if (eyeMaskFn(e, P.browY - 10, 30)(x, y)) return true;
  }
  const mu = Math.abs((x - P.mouth.cx) / (P.mouth.rx + 7)), mv = Math.abs((y - P.mouth.cy) / (P.mouth.ry + 8));
  return mu * mu + mv * mv <= 1;
};

if (process.argv.includes('--write')) {
  const out = { width: W, height: H, data: Buffer.from(D) };
  const yBase = P.browY - 30, yEnd = P.mouth.cy + 40;
  const prof = rowProfile(out, maskAt, P.face.x0 + 26, P.face.x1 - 26, yBase, yEnd);
  for (const e of [P.eyeL, P.eyeR]) {
    paintSoft(out, { x0: e.cx - 40, x1: e.cx + 40, y0: P.browY - 14, y1: e.cy + 60 },
      eyeMaskFn(e, P.browY - 10, 30), prof, yBase);
  }
  paintSoft(out, { x0: P.mouth.cx - 22, x1: P.mouth.cx + 22, y0: P.mouth.cy - 16, y1: P.mouth.cy + 16 },
    (x, y) => {
      const mu = Math.abs((x - P.mouth.cx) / (P.mouth.rx + 7)), mv = Math.abs((y - P.mouth.cy) / (P.mouth.ry + 8));
      return mu * mu + mv * mv <= 1;
    }, prof, yBase);
  writeFileSync(join(WORK, 'assets', 'portrait.png'), encodePNG(out));
  // 抹除后放大图（肉眼验收）
  const R2 = { x: P.face.x0 - 10, y: P.face.y0 - 10, w: P.face.x1 - P.face.x0 + 20, h: P.face.y1 - P.face.y0 + 20 };
  const g2 = crop(out, R2);
  const S2 = 2, big2 = new Uint8Array(R2.w * S2 * R2.h * S2 * 4);
  for (let y = 0; y < R2.h * S2; y++) for (let x = 0; x < R2.w * S2; x++) {
    const s = ((y / S2) | 0) * R2.w + ((x / S2) | 0), d = y * R2.w * S2 + x;
    big2[d * 4] = g2.data[s * 4]; big2[d * 4 + 1] = g2.data[s * 4 + 1]; big2[d * 4 + 2] = g2.data[s * 4 + 2]; big2[d * 4 + 3] = 255;
  }
  writeFileSync(join(WORK, 'src', '_fit_erased.png'), encodePNG({ width: R2.w * S2, height: R2.h * S2, data: Buffer.from(big2) }));
  const m = {
    size: 256, feetY: 256, texW: W, texH: H,
    face: P.face,
    eyes: { L: P.eyeL, R: P.eyeR },
    mouth: P.mouth,
  };
  writeFileSync(join(WORK, 'assets', 'measure.json'), JSON.stringify(m, null, 2));
  // 头发掩码调试图（品红 = 判成头发，抹除时会保留）——数值化验收，不靠肉眼猜
  {
    const dbg = { width: W, height: H, data: Buffer.from(D) };
    for (let y = P.face.y0; y <= P.face.y1; y++) for (let x = P.face.x0; x <= P.face.x1; x++) {
      if (!hairAt(x, y)) continue;
      const o = (y * W + x) * 4;
      dbg.data[o] = 255; dbg.data[o + 1] = 0; dbg.data[o + 2] = 255; dbg.data[o + 3] = 255;
    }
    writeFileSync(join(WORK, 'src', '_hair.png'), encodePNG(dbg));
  }
  console.log('wrote assets/portrait.png + assets/measure.json');
}

// 2x 裁图给肉眼校准
const R = { x: P.face.x0 - 10, y: P.face.y0 - 10, w: P.face.x1 - P.face.x0 + 20, h: P.face.y1 - P.face.y0 + 20 };
const f = crop(fit, R);
const S = 2;
const big = new Uint8Array(R.w * S * R.h * S * 4);
for (let y = 0; y < R.h * S; y++) for (let x = 0; x < R.w * S; x++) {
  const s = ((y / S) | 0) * R.w + ((x / S) | 0), d = y * R.w * S + x;
  big[d * 4] = f.data[s * 4]; big[d * 4 + 1] = f.data[s * 4 + 1]; big[d * 4 + 2] = f.data[s * 4 + 2]; big[d * 4 + 3] = 255;
}
writeFileSync(join(WORK, 'src', '_fit.png'), encodePNG({ width: R.w * S, height: R.h * S, data: Buffer.from(big) }));
console.log('fit ->', join('src', '_fit.png'), 'crop', R.x, R.y, R.w, R.h);
