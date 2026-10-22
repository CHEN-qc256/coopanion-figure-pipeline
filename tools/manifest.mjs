/**
 * 生成 figure.json（形象清单）。
 *
 *   templates/figure.template.json   结构骨架：19 个表情 + 18 个动作的多语言词表、配色轴、能力开关
 *   <work>/figure.meta.json          身份信息：id / name / about / credits / export
 *
 * 输出 <work>/figure.json。
 *
 * 教训（复盘 3.6）：必须「解析 → 赋值 → 回写 → 回读校验」，绝不字符串 replace ——
 * 用 replace 改 JSON，键名一变就静默 no-op，最后得到一份"看起来改过了"的旧配置。
 *
 *   node tools/manifest.mjs [--work <dir>]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, workDir } from '../lib/workdir.mjs';

const WORK = workDir();
const tpl = JSON.parse(readFileSync(join(REPO, 'templates', 'figure.template.json'), 'utf8'));
const meta = JSON.parse(readFileSync(join(WORK, 'figure.meta.json'), 'utf8'));

const man = { ...tpl };
for (const k of ['id', 'version', 'name', 'about', 'author', 'license', 'credits', 'export']) {
  if (meta[k] !== undefined) man[k] = meta[k];
}

/* 词表/配色轴允许覆盖，默认沿用模板 */
for (const k of ['axes', 'presets', 'vocab', 'sounds', 'can', 'moves', 'needs', 'hits', 'anchors']) {
  if (meta[k] !== undefined) man[k] = meta[k];
}

if (!/^[a-z][a-z0-9-]*$/.test(man.id)) throw new Error('id 必须是 小写字母/数字/短横线: ' + man.id);
if (!/^create[A-Z][A-Za-z0-9]*Body$/.test(man.export)) {
  throw new Error('export 必须是 create<PascalId>Body 形式: ' + man.export);
}
if (!Array.isArray(man.vocab) || man.vocab.length < 10) throw new Error('vocab 太少，模板可能被改坏了');

man.entry = man.entry || 'figure.js';
man.model = man.model || 'model.json';
man.thumb = man.thumb || 'thumbs/cover.png';
man.manifest = 2;
man.api = 2;

writeFileSync(join(WORK, 'figure.json'), JSON.stringify(man, null, 2) + '\n');

/* 回读校验 */
const back = JSON.parse(readFileSync(join(WORK, 'figure.json'), 'utf8'));
for (const k of ['id', 'export', 'entry', 'api', 'manifest']) {
  if (back[k] !== man[k]) throw new Error('回读校验失败: ' + k + ' = ' + JSON.stringify(back[k]));
}
if (back.vocab.length !== man.vocab.length) throw new Error('回读校验失败: vocab 长度变了');
console.log('figure.json ok:', back.id, '/', back.name.zh, '| export', back.export, '| vocab', back.vocab.length);
