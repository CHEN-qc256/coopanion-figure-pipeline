/**
 * 约定：一个"工作目录"（work dir）里放着一个形象的源图、中间产物和最终包。
 *
 *   examples/claude/          ← 仓库自带的示例
 *   ├── src/                  源图（生图结果、design 参考、调试图）
 *   ├── assets/               portrait.png + measure.json
 *   ├── tex/ thumbs/          打包产物
 *   └── figure.js / model.json / figure.json
 *
 * 指定别的工作目录：`node tools/prep.mjs --work D:\my-figure probe`
 * 或环境变量 FIGURE_WORK。`--work` 会被从 argv 里摘掉，不影响工具自己的位置参数。
 */
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 读走 `--work <dir>` / `--work=<dir>` 并返回绝对路径。 */
export function workDir() {
  const argv = process.argv;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--work') {
      const v = argv[i + 1];
      argv.splice(i, 2);
      return resolve(v);
    }
    if (a.startsWith('--work=')) {
      const v = a.slice('--work='.length);
      argv.splice(i, 1);
      return resolve(v);
    }
  }
  return resolve(process.env.FIGURE_WORK || join(REPO, 'examples', 'claude'));
}

/** 读走 `--coopanion <dir>`（离线预览要用到 Coopanion 的 web 资源）。 */
export function coopanionRoot() {
  const argv = process.argv;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--coopanion') {
      const v = argv[i + 1];
      argv.splice(i, 2);
      return resolve(v);
    }
    if (a.startsWith('--coopanion=')) {
      const v = a.slice('--coopanion='.length);
      argv.splice(i, 1);
      return resolve(v);
    }
  }
  const env = process.env.COOPANION_ROOT;
  if (env) return isAbsolute(env) ? env : resolve(env);
  return null;
}
