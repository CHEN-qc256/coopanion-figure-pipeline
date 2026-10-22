/**
 * 最小 PNG 编解码器（零依赖，只用到 node:zlib）。
 *
 * 只支持「8 位、非隔行」的 PNG —— 这覆盖了生图模型输出、截图、ffmpeg 转出的全部情况。
 * 解出来统一是 RGBA8；编码固定输出 RGBA8。
 *
 * 之所以自己写一个：Coopanion 自带的 `tools/figure-forge/lib/png.mjs` 是 AGPL 代码，
 * 本仓库要保持 MIT 干净、且能被单独拷走使用，所以这里从 PNG 规范重新实现。
 */

import { deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** 按 PNG 规范解一个 chunk 序列（只收集解码需要的那几种）。 */
function readChunks(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error('decodePNG: 不是 PNG（签名不符）');
  }
  const out = { idat: [], palette: null, trns: null };
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    off += 12 + len;
    if (type === 'IHDR') {
      out.width = data.readUInt32BE(0);
      out.height = data.readUInt32BE(4);
      out.depth = data[8];
      out.colorType = data[9];
      out.interlace = data[12];
    } else if (type === 'IDAT') out.idat.push(data);
    else if (type === 'PLTE') out.palette = data;
    else if (type === 'tRNS') out.trns = data;
    else if (type === 'IEND') break;
  }
  if (!out.width || !out.height) throw new Error('decodePNG: 缺少 IHDR');
  return out;
}

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** 逐行反滤波（PNG 规范 9.2）。 */
function unfilter(raw, width, height, bpp) {
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const ft = raw[pos++];
    const row = raw.subarray(pos, pos + stride);
    pos += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = row[x];
      if (ft === 1) v = (v + a) & 0xff;
      else if (ft === 2) v = (v + b) & 0xff;
      else if (ft === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (ft === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      } else if (ft !== 0) {
        throw new Error(`decodePNG: 不支持的行滤波类型 ${ft}`);
      }
      cur[x] = v;
    }
  }
  return out;
}

/**
 * 解码 PNG → { width, height, data: Buffer(RGBA8) }
 */
export function decodePNG(buf) {
  const c = readChunks(buf);
  if (c.depth !== 8) throw new Error(`decodePNG: 只支持 8 位深（此图 ${c.depth} 位）`);
  if (c.interlace) throw new Error('decodePNG: 不支持隔行扫描（interlaced）PNG');
  const ch = CHANNELS[c.colorType];
  if (!ch) throw new Error(`decodePNG: 不支持的颜色类型 ${c.colorType}`);
  if (!c.idat.length) throw new Error('decodePNG: 没有 IDAT');

  const raw = inflateSync(Buffer.concat(c.idat));
  const planes = unfilter(raw, c.width, c.height, ch);
  const { width, height } = c;
  const data = Buffer.alloc(width * height * 4);
  const pal = c.palette, trns = c.trns;

  for (let i = 0, n = width * height; i < n; i++) {
    const o = i * 4;
    let r, g, b, a = 255;
    if (c.colorType === 0) {
      r = g = b = planes[i];
    } else if (c.colorType === 4) {
      r = g = b = planes[i * 2];
      a = planes[i * 2 + 1];
    } else if (c.colorType === 2) {
      r = planes[i * 3]; g = planes[i * 3 + 1]; b = planes[i * 3 + 2];
    } else if (c.colorType === 6) {
      r = planes[o]; g = planes[o + 1]; b = planes[o + 2]; a = planes[o + 3];
    } else { // 3 = 调色板
      const idx = planes[i];
      r = pal[idx * 3]; g = pal[idx * 3 + 1]; b = pal[idx * 3 + 2];
      if (trns && idx < trns.length) a = trns[idx];
    }
    data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = a;
  }
  return { width, height, data };
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/**
 * 编码 → PNG Buffer（RGBA8、非隔行、每行不滤波）。
 * @param {{width:number,height:number,data:Buffer|Uint8Array}} img
 */
export function encodePNG(img) {
  const { width, height } = img;
  if (!width || !height) throw new Error('encodePNG: 宽高必须大于 0');
  const src = img.data;
  const stride = width * 4;
  if (src.length < stride * height) throw new Error('encodePNG: data 长度不足');

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  ihdr[10] = 0;  // deflate
  ihdr[11] = 0;  // adaptive filtering
  ihdr[12] = 0;  // no interlace

  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: None
    src.copy
      ? src.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
      : raw.set(src.subarray(y * stride, y * stride + stride), y * (stride + 1) + 1);
  }

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
