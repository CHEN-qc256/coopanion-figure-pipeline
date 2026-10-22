/**
 * Claude 娘素材预处理：白底抠透明 → 裁边 → 量五官/身体锚点 → 把脸抹成光皮(眼睛/眉毛/嘴抹掉，交给矢量画)。
 *
 *   node prep.mjs probe   只量，出调试图（_probe.png 带标记框 / _probe.txt 数值）
 *   node prep.mjs build   抠图+抹脸，写 assets/portrait.png 与 measure.json
 *
 * 坐标一律以「裁边后的图」为准（px），同时输出 256 单位形象空间坐标（units）。
 * 读图/写图全用仓库自带的 png.mjs / img.mjs，零依赖。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePNG, encodePNG } from '../lib/png.mjs';
import { image, crop, alphaBox, averageColor, dominantColors, resize } from '../lib/img.mjs';
import { workDir } from '../lib/workdir.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORK = workDir();
const SRC = process.argv[3] || join(WORK, 'src', 'generated.png');

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lum = (r, g, b) => .2126 * r + .7152 * g + .0722 * b;
const sat = (r, g, b) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx === 0 ? 0 : (mx - mn) / mx; };

/** 从边界泛洪，把连到边上的近白像素判为背景。 */
function backgroundMask(img) {
  const { width: W, height: H, data } = img;
  const nearWhite = (i) => data[i] > 238 && data[i + 1] > 238 && data[i + 2] > 238;
  const bg = new Uint8Array(W * H);
  const stack = [];
  const push = (x, y) => {
    const p = y * W + x;
    if (bg[p]) return;
    if (!nearWhite(p * 4)) return;
    bg[p] = 1; stack.push(p);
  };
  for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
  for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
  while (stack.length) {
    const p = stack.pop(), x = p % W, y = (p / W) | 0;
    if (x > 0) push(x - 1, y);
    if (x < W - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < H - 1) push(x, y + 1);
  }
  return bg;
}

/** 背景→alpha0，边上做一圈亚像素羽化（暗描边不会被吃掉）。 */
function cutAlpha(img, bg) {
  const { width: W, height: H, data } = img;
  const out = image(W, H);
  out.data.set(data);
  for (let p = 0; p < W * H; p++) if (bg[p]) out.data[p * 4 + 3] = 0;
  // 边界一圈：alpha 取 2x2 邻域平均，去掉硬锯齿
  const a0 = Buffer.from(out.data);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const p = y * W + x;
      const v = a0[p * 4 + 3];
      const nb = [a0[(p - 1) * 4 + 3], a0[(p + 1) * 4 + 3], a0[(p - W) * 4 + 3], a0[(p + W) * 4 + 3]];
      if (v === 255 && nb.some((n) => n === 0)) out.data[p * 4 + 3] = 96;
      else if (v === 0 && nb.some((n) => n === 255)) out.data[p * 4 + 3] = 160;
    }
  }
  return out;
}

/** 连通域标注（4 邻接），返回 [{area, x0,y0,x1,y1, px:[...]}]，只留面积 >= minArea。 */
function labels(img, accept, minArea = 40) {
  const { width: W, height: H, data } = img;
  const seen = new Int32Array(W * H).fill(-1);
  const out = [];
  for (let p0 = 0; p0 < W * H; p0++) {
    if (seen[p0] >= 0) continue;
    if (data[p0 * 4 + 3] < 200 || !accept(p0)) continue;
    const id = out.length;
    const list = [];
    const stack = [p0];
    seen[p0] = id;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    while (stack.length) {
      const p = stack.pop(); list.push(p);
      const x = p % W, y = (p / W) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      const nb = [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1];
      for (const q of nb) {
        if (q < 0 || seen[q] >= 0) continue;
        if (data[q * 4 + 3] < 200 || !accept(q)) continue;
        seen[q] = id; stack.push(q);
      }
    }
    if (list.length >= minArea) out.push({ area: list.length, x0, y0, x1, y1, px: list });
  }
  return out;
}

const hex = (c) => '#' + c.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
const rle = (v) => Math.round(v * 100) / 100;

function main() {
  const mode = process.argv[2] || 'probe';
  const raw = decodePNG(readFileSync(SRC));
  const bg = backgroundMask(raw);
  const cut = cutAlpha(raw, bg);
  const box = alphaBox(cut, 8);
  const trim = crop(cut, box);
  const W = trim.width, H = trim.height;

  // ---- 主色 ----
  const dom = dominantColors(trim, 10).map((d) => ({ rgb: d.rgb, hex: hex(d.rgb), n: d.count }));

  // 肤色：取最亮的那个主色（脸和裙子的米白；头发是橙的，不会混进来）
  const bright = dom.filter((d) => d.rgb[0] > 200 && d.rgb[1] > 200).sort((a, b) => b.n - a.n)[0];
  const skin = bright ? bright.rgb : [252, 232, 212];

  const isSkin = (p) => {
    const i = p * 4;
    const r = trim.data[i], g = trim.data[i + 1], b = trim.data[i + 2];
    return Math.abs(r - skin[0]) < 30 && Math.abs(g - skin[1]) < 30 && Math.abs(b - skin[2]) < 34;
  };

  // ---- 脸：头部区域（上 45% 高）里最大的米白连通域 ----
  const headBottom = H * .45;
  const skinCC = labels(trim, (p) => ((p / W) | 0) < headBottom && isSkin(p), 4000).sort((a, b) => b.area - a.area);
  const face = skinCC[0] || null;

  // ---- 眼：脸范围里的「非肤色」连通域 ----
  const inFace = (p) => {
    if (!face) return false;
    const x = p % W, y = (p / W) | 0;
    if (x < face.x0 || x > face.x1 || y < face.y0 || y > face.y1) return false;
    // 只看脸内部上 2/3（下巴以下没有眼睛）
    return y < face.y0 + (face.y1 - face.y0) * .62;
  };
  const notSkin = (p) => !isSkin(p);
  const marks = labels(trim, (p) => inFace(p) && notSkin(p), 80)
    .sort((a, b) => b.area - a.area);

  // 干净底图（无任何标记），供 measure.mjs 等下游使用
  writeFileSync(join(WORK, 'src', '_base.png'), encodePNG(trim));

  const report = {
    src: SRC, trimmed: [W, H], box, skin: skin ? hex(skin) : null,
    dominant: dom,
    face: face ? { x0: face.x0, y0: face.y0, x1: face.x1, y1: face.y1, area: face.area } : null,
    marks: marks.slice(0, 12).map((m) => ({
      area: m.area, box: [m.x0, m.y0, m.x1 - m.x0 + 1, m.y1 - m.y0 + 1],
      w: m.x1 - m.x0 + 1, h: m.y1 - m.y0 + 1,
      fill: rle(m.area / ((m.x1 - m.x0 + 1) * (m.y1 - m.y0 + 1))),
      mean: (() => { let r = 0, g = 0, b = 0; for (const p of m.px) { r += trim.data[p * 4]; g += trim.data[p * 4 + 1]; b += trim.data[p * 4 + 2]; } const n = m.px.length; return hex([r / n, g / n, b / n]); })(),
    })),
  };
  writeFileSync(join(WORK, 'src', '_probe.json'), JSON.stringify(report, null, 2));

  // ---- 调试图：把候选框画出来 ----
  const dbg = image(W, H);
  dbg.data.set(trim.data);
  const put = (x, y, c) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 4; dbg.data[i] = c[0]; dbg.data[i + 1] = c[1]; dbg.data[i + 2] = c[2]; dbg.data[i + 3] = 255; };
  const rect = (b, c, t = 3) => {
    for (let x = b[0]; x < b[0] + b[2]; x++) for (let k = 0; k < t; k++) { put(x, b[1] + k, c); put(x, b[1] + b[3] - 1 - k, c); }
    for (let y = b[1]; y < b[1] + b[3]; y++) for (let k = 0; k < t; k++) { put(b[0] + k, y, c); put(b[0] + b[2] - 1 - k, y, c); }
  };
  if (face) rect([face.x0, face.y0, face.x1 - face.x0 + 1, face.y1 - face.y0 + 1], [0, 160, 255], 2);
  const palette = [[255, 0, 0], [0, 200, 0], [200, 0, 255], [255, 128, 0], [0, 0, 0]];
  marks.slice(0, 5).forEach((m, i) => rect([m.x0, m.y0, m.x1 - m.x0 + 1, m.y1 - m.y0 + 1], palette[i % palette.length], 3));
  writeFileSync(join(WORK, 'src', '_probe.png'), encodePNG(dbg));

  // 脸部放大调试图（2x）
  if (face) {
    const f = crop(dbg, { x: face.x0 - 10, y: face.y0 - 10, w: (face.x1 - face.x0) + 20, h: (face.y1 - face.y0) + 20 });
    writeFileSync(join(WORK, 'src', '_probe_face.png'), encodePNG(resize(f, f.width * 2, f.height * 2)));
  }
  console.log('probe ->', join(WORK, 'src', '_probe.json'), 'trimmed', W + 'x' + H);
}

main();
