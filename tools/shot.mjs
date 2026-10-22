/**
 * 出图：node tools/shot.mjs <out.png> ["expr=happy&frames=90"] [w] [h] [probe] [--work <dir>] [--coopanion <dir>]
 * 用 Electron（与 Coopanion 同引擎，最保真）跑 harness 并截图。
 *
 * 需要 Coopanion 的工作副本（harness 要 import 它的 web/kit/body.js）：
 *   node tools/shot.mjs shots/a.png "frames=60" --coopanion E:/path/to/Coopanion
 * 或先设 COOPANION_ROOT 环境变量。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { coopanionRoot, workDir } from '../lib/workdir.mjs';

const PACK = workDir();          // 顺手把 --work 从 argv 里摘掉
const ROOT = coopanionRoot();
if (!ROOT) {
  console.error('缺少 Coopanion 路径：加 --coopanion <dir> 或设 COOPANION_ROOT');
  process.exit(2);
}
const ELECTRON = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
if (!existsSync(ELECTRON)) {
  console.error('找不到 electron：' + ELECTRON + '\n先在该目录跑一次 pnpm install');
  process.exit(2);
}
const MAIN = resolve(new URL('./harness/main.cjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

const out = resolve(process.argv[2] || 'shots/shot.png');
const query = process.argv[3] || 'frames=96';
const w = +(process.argv[4] || 760), h = +(process.argv[5] || 980);
const probe = process.argv[6] || '';
mkdirSync(dirname(out), { recursive: true });

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;
env.COOPANION_ROOT = ROOT;

const r = spawnSync(ELECTRON, [
  '--no-sandbox', '--disable-gpu-sandbox', MAIN,
  JSON.stringify({ out, query, w, h, probe, pack: PACK }),
], { env, encoding: 'utf8', timeout: 120000, windowsHide: true, cwd: ROOT });
const tail = (s, n = 1200) => (s || '').slice(-n).trim();
if (r.stdout) console.log(tail(r.stdout));
if (r.stderr) console.log(tail(r.stderr));
if (r.status !== 0) console.error('electron exit', r.status);
if (!existsSync(out)) { console.error('NO OUTPUT', out); process.exit(1); }
console.log('ok', out, statSync(out).size, 'bytes');
