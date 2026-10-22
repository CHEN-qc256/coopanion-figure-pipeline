/**
 * 一点点位图工具（零依赖）。约定：图像 = { width, height, data: Buffer(RGBA8) }。
 *
 * 这里只放流水线真正用到的算子：裁剪、缩放（预乘 alpha 的双线性）、抠图包围盒、
 * 主色统计、叠加。同样是为了不依赖 Coopanion 的 AGPL 代码而重写的。
 */

/** 新建图像，fill 为默认像素（默认全透明）。 */
export function image(width, height, fill = [0, 0, 0, 0]) {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = fill[0]; data[i * 4 + 1] = fill[1];
    data[i * 4 + 2] = fill[2]; data[i * 4 + 3] = fill.length > 3 ? fill[3] : 255;
  }
  return { width, height, data };
}

/** alpha > thr 的像素的包围盒；全透明时返回整幅。 */
export function alphaBox(img, thr = 8) {
  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] <= thr) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return { x: 0, y: 0, w: img.width, h: img.height };
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** 裁剪（越界部分按透明补齐）。 */
export function crop(img, r) {
  const x0 = Math.round(r.x), y0 = Math.round(r.y);
  const w = Math.round(r.w), h = Math.round(r.h);
  const out = image(w, h);
  for (let y = 0; y < h; y++) {
    const sy = y0 + y;
    if (sy < 0 || sy >= img.height) continue;
    for (let x = 0; x < w; x++) {
      const sx = x0 + x;
      if (sx < 0 || sx >= img.width) continue;
      const s = (sy * img.width + sx) * 4, d = (y * w + x) * 4;
      out.data[d] = img.data[s]; out.data[d + 1] = img.data[s + 1];
      out.data[d + 2] = img.data[s + 2]; out.data[d + 3] = img.data[s + 3];
    }
  }
  return out;
}

/** 双线性缩放。颜色按预乘 alpha 插值，避免透明边缘发黑。 */
export function resize(img, w, h) {
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));
  const out = image(w, h);
  const sx = img.width / w, sy = img.height / h;
  const at = (x, y) => {
    x = Math.min(img.width - 1, Math.max(0, x));
    y = Math.min(img.height - 1, Math.max(0, y));
    const o = (y * img.width + x) * 4;
    return [img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3]];
  };
  for (let y = 0; y < h; y++) {
    const fy = Math.min(img.height - 1, (y + 0.5) * sy - 0.5);
    const y0 = Math.floor(fy), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(img.width - 1, (x + 0.5) * sx - 0.5);
      const x0 = Math.floor(fx), tx = fx - x0;
      const p00 = at(x0, y0), p10 = at(x0 + 1, y0), p01 = at(x0, y0 + 1), p11 = at(x0 + 1, y0 + 1);
      let r = 0, g = 0, b = 0, a = 0;
      for (const [p, wgt] of [
        [p00, (1 - tx) * (1 - ty)], [p10, tx * (1 - ty)],
        [p01, (1 - tx) * ty], [p11, tx * ty],
      ]) {
        const al = p[3] / 255;
        r += p[0] * al * wgt; g += p[1] * al * wgt; b += p[2] * al * wgt; a += p[3] * wgt;
      }
      const d = (y * w + x) * 4;
      if (a > 0) {
        const inv = 255 / a;
        out.data[d] = Math.min(255, Math.round(r * inv));
        out.data[d + 1] = Math.min(255, Math.round(g * inv));
        out.data[d + 2] = Math.min(255, Math.round(b * inv));
      }
      out.data[d + 3] = Math.min(255, Math.round(a));
    }
  }
  return out;
}

/** 等比缩放到能放进 w×h，居中贴到新画布（fill 为底色）。 */
export function fit(img, w, h, fill = [0, 0, 0, 0]) {
  const k = Math.min(w / img.width, h / img.height);
  const r = resize(img, Math.round(img.width * k), Math.round(img.height * k));
  const out = image(w, h, fill);
  paste(out, r, Math.round((w - r.width) / 2), Math.round((h - r.height) / 2));
  return out;
}

/** 把 src 以 source-over 方式叠到 dst 的 (x,y)。 */
export function paste(dst, src, x0, y0) {
  for (let y = 0; y < src.height; y++) {
    const dy = y0 + y;
    if (dy < 0 || dy >= dst.height) continue;
    for (let x = 0; x < src.width; x++) {
      const dx = x0 + x;
      if (dx < 0 || dx >= dst.width) continue;
      const s = (y * src.width + x) * 4, d = (dy * dst.width + dx) * 4;
      const sa = src.data[s + 3] / 255;
      if (sa <= 0) continue;
      const da = dst.data[d + 3] / 255;
      const oa = sa + da * (1 - sa);
      for (let c = 0; c < 3; c++) {
        dst.data[d + c] = Math.round((src.data[s + c] * sa + dst.data[d + c] * da * (1 - sa)) / (oa || 1));
      }
      dst.data[d + 3] = Math.round(oa * 255);
    }
  }
  return dst;
}

export const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

/** 矩形内平均色（跳过透明像素）。 */
export function averageColor(img, rect) {
  const r = rect || { x: 0, y: 0, w: img.width, h: img.height };
  let n = 0, R = 0, G = 0, B = 0;
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
      const o = (y * img.width + x) * 4;
      if (img.data[o + 3] < 8) continue;
      R += img.data[o]; G += img.data[o + 1]; B += img.data[o + 2]; n++;
    }
  }
  return n ? [Math.round(R / n), Math.round(G / n), Math.round(B / n)] : [0, 0, 0];
}

/** 主色统计：按 16 级量化后按出现次数排序，返回 [{rgb,count}]。 */
export function dominantColors(img, k = 8, rect) {
  const r = rect || { x: 0, y: 0, w: img.width, h: img.height };
  const map = new Map();
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
      const o = (y * img.width + x) * 4;
      if (img.data[o + 3] < 8) continue;
      const key = ((img.data[o] >> 4) << 8) | ((img.data[o + 1] >> 4) << 4) | (img.data[o + 2] >> 4);
      const slot = map.get(key) || { n: 0, r: 0, g: 0, b: 0 };
      slot.n++; slot.r += img.data[o]; slot.g += img.data[o + 1]; slot.b += img.data[o + 2];
      map.set(key, slot);
    }
  }
  return [...map.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, k)
    .map((s) => ({
      rgb: [Math.round(s.r / s.n), Math.round(s.g / s.n), Math.round(s.b / s.n)],
      count: s.n,
    }));
}

/** [r,g,b] → '#rrggbb'（接受浮点）。 */
export const hex = (rgb) =>
  '#' + rgb.slice(0, 3).map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
