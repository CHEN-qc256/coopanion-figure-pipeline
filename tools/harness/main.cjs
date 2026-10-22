/**
 * Electron 截图主进程：起一个只读静态服务，打开 harness 页，等 window.__done，
 * capturePage() 写 PNG。跑的是真实的 web/kit/body.js + web/kit/rig.js —— 与桌面上同引擎。
 *
 * 用法（由 tools/shot.mjs 调用）：
 *   electron tools/harness/main.cjs '{"out":"...png","query":"expr=happy&frames=90","w":760,"h":980,"pack":"<工作目录>"}'
 *
 * 静态服务的三条路由：
 *   /web/*     → <Coopanion>/packages/cortico-world-desktop-pet/web/*   （kit/body.js、kit/rig.js）
 *   /@pack/*   → 形象包目录（--work 指定的那个）
 *   其它       → 本仓库根（tools/harness/index.html 等）
 */
const { app, BrowserWindow } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const COOPANION = process.env.COOPANION_ROOT || '';
const REPO = path.resolve(__dirname, '..', '..');
const COOP_WEB = path.join(COOPANION, 'packages', 'cortico-world-desktop-pet', 'web');

const args = JSON.parse(process.argv[process.argv.length - 1]);
const OUT = args.out;
const QUERY = args.query || '';
const W = args.w || 760;
const H = args.h || 980;
const PACK = args.pack ? path.resolve(args.pack) : path.join(REPO, 'examples', 'claude');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.css': 'text/css; charset=utf-8',
};

/** 把 URL 映射到磁盘文件，并保证不越出各自允许的根。 */
function resolveFile(u) {
  let base, rest;
  if (u.startsWith('/web/')) { base = COOP_WEB; rest = u.slice(5); }
  else if (u.startsWith('/@pack/')) { base = PACK; rest = u.slice(7); }
  else { base = REPO; rest = u; }
  const f = path.join(base, rest);
  if (!f.startsWith(base)) return null;
  return f;
}

const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  const f = resolveFile(u);
  if (!f || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('no'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(res);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.commandLine.appendSwitch('force-device-scale-factor', String(args.dpr || 1));

app.whenReady().then(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  // 缺 Coopanion 时先把话说明白，别让人对着白图猜
  if (!COOPANION || !fs.existsSync(path.join(COOP_WEB, 'kit', 'body.js'))) {
    console.error('COOPANION 无效：找不到 ' + path.join(COOP_WEB, 'kit', 'body.js'));
    console.error('请用 --coopanion <dir> 指向 Coopanion 工作副本，或设 COOPANION_ROOT');
    app.quit();
    return;
  }

  const win = new BrowserWindow({
    width: W, height: H, x: 40, y: 40, show: true, frame: false, backgroundColor: '#eceef0',
    webPreferences: { offscreen: false, backgroundThrottling: false },
  });
  const url = `http://127.0.0.1:${port}/tools/harness/index.html?pack=/@pack/&${QUERY}`;
  const msgs = [];
  win.webContents.on('console-message', (_e, level, message) => { msgs.push(message); });
  try {
    await win.loadURL(url);
    let done = false;
    for (let i = 0; i < 240 && !done; i++) {
      await sleep(50);
      try { done = await win.webContents.executeJavaScript('window.__done === true'); } catch { /* 页面还没好 */ }
    }
    const err = await win.webContents.executeJavaScript('window.__error || null').catch(() => 'executeJavaScript failed');
    if (err) console.error('PAGE ERROR:', err);
    const layout = await win.webContents.executeJavaScript('window.__layout || null').catch(() => null);
    if (layout) console.error('layout', JSON.stringify(layout));
    if (args.probe) {
      const p = await win.webContents.executeJavaScript(args.probe).catch((e) => 'probe failed: ' + e);
      console.error('PROBE ' + JSON.stringify(p));
    }
    await sleep(120);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(OUT, img.toPNG());
    console.error('shot', OUT, img.getSize().width + 'x' + img.getSize().height);
    if (msgs.length) console.error('console:', msgs.slice(-6).join(' | '));
  } catch (e) {
    console.error('FAIL', e && e.stack || e);
    process.exitCode = 1;
  }
  win.destroy();
  server.close();
  app.quit();
});
