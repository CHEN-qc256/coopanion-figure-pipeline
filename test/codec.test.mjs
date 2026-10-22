/**
 * lib 自检：node --test test/
 *
 * 只测「解码器能认多少种 PNG」和「几何算子不越界」这两类最容易悄悄错的东西。
 * 不依赖任何外部文件 —— 测试用的图都是现场造出来的。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { decodePNG, encodePNG } from '../lib/png.mjs';
import { image, alphaBox, crop, resize, paste, averageColor, dominantColors, luma, hex } from '../lib/img.mjs';

/** 手工拼一个 PNG，用来喂解码器（可指定 colorType / 每行的滤波类型）。 */
function makePNG(width, height, colorType, pixels, filters = []) {
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  const stride = width * ch;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const ft = filters[y % (filters.length || 1)] || 0;
    raw[y * (stride + 1)] = ft;
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    // 反着算：把原来要给解码器"复原"的数据按滤波类型编回去
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? pixels[y * stride + x - ch] : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const c = y > 0 && x >= ch ? pixels[(y - 1) * stride + x - ch] : 0;
      let v = row[x];
      if (ft === 1) v = (v - a) & 0xff;
      else if (ft === 2) v = (v - b) & 0xff;
      else if (ft === 3) v = (v - ((a + b) >> 1)) & 0xff;
      else if (ft === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = (v - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
      raw[y * (stride + 1) + 1 + x] = v;
    }
  }
  const CRC = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
    return (buf) => { let c = -1; for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  })();
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(CRC(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = colorType; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

test('encode → decode 往返，像素逐字节一致', () => {
  const img = image(17, 9);
  for (let i = 0; i < 17 * 9; i++) {
    img.data[i * 4] = i * 7 % 256;
    img.data[i * 4 + 1] = 255 - (i * 3 % 256);
    img.data[i * 4 + 2] = (i * 11) % 256;
    img.data[i * 4 + 3] = i % 5 === 0 ? 0 : 255;
  }
  const back = decodePNG(encodePNG(img));
  assert.equal(back.width, 17);
  assert.equal(back.height, 9);
  assert.deepEqual([...back.data], [...img.data]);
});

test('解码器能认 5 种行滤波（0–4）', () => {
  const w = 6, h = 5;
  const pixels = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h * 3; i++) pixels[i] = (i * 37) % 256;
  const png = makePNG(w, h, 2, pixels, [0, 1, 2, 3, 4]);
  const img = decodePNG(png);
  assert.equal(img.width, w);
  for (let i = 0; i < w * h; i++) {
    assert.equal(img.data[i * 4], pixels[i * 3], 'R@' + i);
    assert.equal(img.data[i * 4 + 1], pixels[i * 3 + 1], 'G@' + i);
    assert.equal(img.data[i * 4 + 2], pixels[i * 3 + 2], 'B@' + i);
    assert.equal(img.data[i * 4 + 3], 255);
  }
});

test('灰度 / 灰度+alpha / RGBA 都能解出正确的通道', () => {
  const gray = decodePNG(makePNG(2, 2, 0, Buffer.from([10, 20, 30, 40])));
  assert.deepEqual([...gray.data.subarray(0, 8)], [10, 10, 10, 255, 20, 20, 20, 255]);

  const ga = decodePNG(makePNG(2, 1, 4, Buffer.from([50, 128, 200, 0])));
  assert.deepEqual([...ga.data.subarray(0, 8)], [50, 50, 50, 128, 200, 200, 200, 0]);

  const rgba = decodePNG(makePNG(1, 1, 6, Buffer.from([1, 2, 3, 4])));
  assert.deepEqual([...rgba.data], [1, 2, 3, 4]);
});

test('alphaBox 跳过全透明像素', () => {
  const img = image(10, 10);
  for (let y = 2; y < 6; y++) for (let x = 3; x < 8; x++) {
    const o = (y * 10 + x) * 4;
    img.data[o] = 255; img.data[o + 3] = 255;
  }
  assert.deepEqual(alphaBox(img, 8), { x: 3, y: 2, w: 5, h: 4 });
  assert.deepEqual(alphaBox(image(4, 4), 8), { x: 0, y: 0, w: 4, h: 4 });
});

test('crop 越界补透明、resize 保持尺寸、paste 做 source-over', () => {
  const img = image(4, 4, [255, 0, 0, 255]);
  const c = crop(img, { x: 2, y: 2, w: 4, h: 4 });
  assert.equal(c.width, 4);
  assert.equal(c.data[(0 * 4 + 0) * 4], 255, '左上角来自原图');
  assert.equal(c.data[(3 * 4 + 3) * 4 + 3], 0, '右下角是透明');

  const r = resize(img, 3, 7);
  assert.equal(r.width, 3);
  assert.equal(r.height, 7);
  assert.equal(r.data[0], 255, '纯色缩放还是纯色');

  const dst = image(2, 2, [0, 0, 255, 255]);
  const src = image(1, 1, [255, 0, 0, 128]);
  paste(dst, src, 0, 0);
  assert.ok(dst.data[0] > 100 && dst.data[2] > 100, '半透明叠加得到紫');
});

test('平均色 / 主色 / luma / hex', () => {
  const img = image(4, 4, [10, 20, 30, 255]);
  assert.deepEqual(averageColor(img, { x: 0, y: 0, w: 2, h: 2 }), [10, 20, 30]);
  const dom = dominantColors(img, 3);
  assert.equal(dom.length, 1);
  assert.equal(dom[0].count, 16);
  assert.deepEqual(dom[0].rgb, [10, 20, 30]);
  assert.ok(Math.abs(luma(255, 255, 255) - 255) < 0.001);
  assert.equal(hex([10, 20, 30]), '#0a141e');
  assert.equal(hex([10.4, 20.6, 300]), '#0a15ff');
});
