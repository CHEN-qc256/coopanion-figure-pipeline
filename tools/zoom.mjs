/** 放大看细节：node tools/zoom.mjs in.png out.png x y w h [scale] */
import { readFileSync, writeFileSync } from 'node:fs';
import { decodePNG, encodePNG } from '../lib/png.mjs';
import { crop, resize } from '../lib/img.mjs';

const [inp, outp, x, y, w, h, sc] = process.argv.slice(2);
const img = decodePNG(readFileSync(inp));
const s = +(sc || 2);
const c = crop(img, { x: +x, y: +y, w: +w, h: +h });
writeFileSync(outp, encodePNG(resize(c, Math.round(+w * s), Math.round(+h * s))));
console.log('zoom', outp, Math.round(+w * s) + 'x' + Math.round(+h * s));
