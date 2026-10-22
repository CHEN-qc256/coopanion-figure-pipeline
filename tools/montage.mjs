/**
 * 拼图：node tools/montage.mjs out.png cols cellW cellH cx cy cw ch in1.png in2.png ...
 * 每张输入按固定框裁切后缩放，按列数平铺。用来一次核完所有表情。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { decodePNG, encodePNG } from '../lib/png.mjs';
import { image, crop, resize, paste } from '../lib/img.mjs';

const a = process.argv.slice(2);
const out = a[0], cols = +a[1], cw = +a[2], ch = +a[3];
const [cx, cy, sw, sh] = a.slice(4, 8).map(Number);
const files = a.slice(8);
const rows = Math.ceil(files.length / cols);

const W = cols * (cw + 6) + 6, H = rows * (ch + 6) + 6;
const dst = image(W, H, [26, 28, 32, 255]);
files.forEach((f, i) => {
  const img = decodePNG(readFileSync(f));
  const c = crop(img, { x: cx, y: cy, w: sw, h: sh });
  const r = resize(c, cw, ch);
  const gx = 6 + (i % cols) * (cw + 6), gy = 6 + Math.floor(i / cols) * (ch + 6);
  paste(dst, r, gx, gy);
});
writeFileSync(out, encodePNG(dst));
console.log('montage', out, W + 'x' + H, files.length, 'cells');
