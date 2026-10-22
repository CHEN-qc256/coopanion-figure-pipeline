/**
 * 组装形象包（在工作目录里跑）：
 *   model.json + figure.body.part.js  ->  figure.js
 *   assets/portrait.png               ->  tex/body.png
 *   assets/portrait.png               ->  thumbs/cover.png（缩略图）
 *
 * 只做确定性拼装，不跑 forge —— figure.js 是手写代码 + 常量，forge 重生成会覆盖掉手写部分。
 *
 * 改完回读校验：figure.js 里的 MODEL 必须能 JSON.parse 回和 model.json 一致的对象，
 * 导出名必须在文件里。（教训：改 JSON 用字符串替换会静默 no-op，改完必须回读。）
 *
 *   node tools/compose.mjs [--work <dir>]
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { decodePNG, encodePNG } from '../lib/png.mjs';
import { crop, resize, alphaBox } from '../lib/img.mjs';
import { workDir } from '../lib/workdir.mjs';

const WORK = workDir();
const rd = (p) => readFileSync(join(WORK, p));
const wr = (p, b) => { mkdirSync(dirname(join(WORK, p)), { recursive: true }); writeFileSync(join(WORK, p), b); };

const model = JSON.parse(rd('model.json').toString('utf8'));
const part = rd('figure.body.part.js').toString('utf8');
const man = JSON.parse(rd('figure.json').toString('utf8'));

if (part.includes('const MODEL =')) throw new Error('part 文件里不要自带 MODEL 常量（MODEL 由 compose 注入）');

const title = (man.name && (man.name.zh || man.name.en)) || man.id || 'figure';
const head = '/**\n * ' + title + ' 桌面形象（api 2）。\n *\n'
  + ' * 这个文件由 tools/compose.mjs 拼出来：model.json + figure.body.part.js。\n'
  + ' * 不要手改；改源文件再跑 `node tools/compose.mjs`。\n */\n\n'
  + 'const MODEL = ' + JSON.stringify(model) + ';\n\n';
wr('figure.js', head + part);

/* 贴图 */
mkdirSync(join(WORK, 'tex'), { recursive: true });
copyFileSync(join(WORK, 'assets/portrait.png'), join(WORK, 'tex/body.png'));

/* 缩略图：取头部方图 */
const img = decodePNG(rd('assets/portrait.png'));
const box = alphaBox(img, 8);
const side = Math.round(box.w * 0.86);
const cx = box.x + Math.round(box.w * 0.5);
const top = box.y + Math.round(box.h * 0.055);
const sq = crop(img, { x: Math.max(box.x, cx - Math.round(side / 2)), y: top, w: side, h: side });
wr('thumbs/cover.png', encodePNG(resize(sq, 320, 320)));

/* 回读校验 */
const back = rd('figure.js').toString('utf8');
const m = back.match(/^const MODEL = (.*);$/m);
if (!m) throw new Error('figure.js 里找不到 MODEL 行');
const parsed = JSON.parse(m[1]);
if (JSON.stringify(parsed) !== JSON.stringify(model)) throw new Error('figure.js 的 MODEL 与 model.json 不一致');
const exp = man.export;
if (!back.includes('export async function ' + exp)) throw new Error('figure.js 里没有导出 ' + exp);

const st = (p) => (existsSync(join(WORK, p)) ? rd(p).length : -1);
console.log('work dir', WORK);
console.log('figure.js', st('figure.js'), 'bytes; MODEL parts', parsed.parts.length, '; export', exp);
console.log('tex/body.png', st('tex/body.png'), '; thumbs/cover.png', st('thumbs/cover.png'));
console.log('feat.eyes', JSON.stringify(parsed.feat.eyes), 'mouth', JSON.stringify(parsed.feat.mouth));
