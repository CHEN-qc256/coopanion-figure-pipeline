/**
 * 离线预览页：把 pack 的 figure.js 按 web/figure-frame.js 的方式装配起来，
 * 逐帧 step() 之后停在一个确定的姿势上，交给 Electron 截图。
 *
 * 这样跑的是真实的 web/kit/body.js + web/kit/rig.js，不是模拟。
 *
 * URL 参数：
 *   pack   形象包目录（相对本页），默认 '../'
 *   s      1 个单位 = 多少 px，默认 3.2
 *   w h    舞台尺寸，默认 760x980
 *   frames 先走多少帧，默认 96
 *   expr   第 3 帧 do() 的表情/动作词
 *   expr2  中途（frames*0.55）再 do() 一个词
 *   walk   第 4 帧开始走到的 x（px），给了就走路
 *   run    walk 时是否跑
 *   once   1 = 只截最后一步；默认逐帧累积
 *   blink  0..1 定住眨眼相位（调试）
 */
const q = new URLSearchParams(location.search);
const PACK = q.get('pack') || '../';
const S = +(q.get('s') || 3.2);
const W = +(q.get('w') || 760);
const H = +(q.get('h') || 980);
const FRAMES = +(q.get('frames') || 96);
const EXPR = q.get('expr') || '';
const EXPR2 = q.get('expr2') || '';
const WALK = q.get('walk');
const RUN = q.get('run') === '1';
const DT = 1 / 60;

const SVGNS = 'http://www.w3.org/2000/svg';

function fail(e) {
  console.error(e);
  window.__error = String(e && e.stack || e);
}

function loadImage(url) {
  return new Promise((ok, bad) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => ok(im);
    im.onerror = () => bad(new Error('image failed: ' + url));
    im.src = String(url);
  });
}

(async () => {
  try {
    const base = new URL(PACK.replace(/\/?$/, '/'), location.href);
    const man = await (await fetch(new URL('figure.json', base))).json();
    const model = await (await fetch(new URL(man.model || 'model.json', base))).json();
    const kit = await import('/web/kit/body.js');
    const mod = await import(new URL(base.href + man.entry).href);

    const root = document.getElementById('root');
    window.__noBlink = q.get('noblink') === '1';
    if (q.get('blink') != null) window.__blinkAt = Math.max(0, Math.min(1, +q.get('blink')));
    const bounds = { W, H, floorY: H - 28, S };
    const host = { root, bounds: () => bounds, emit: () => {}, sound: () => {} };
    const body = await mod[man.export](base, {
      model, scheme: 'default', kit, loadImage,
      asset: (p) => new URL(p, base),
      host: { ...host, start: { x: W / 2, facing: 1 } },
    });

    const tick = (n) => { for (let i = 0; i < n; i++) body.step(DT); };
    tick(2);
    if (q.get('still') === '1') { body.set({ roam: false }); body.place(W / 2, 1); }
    if (q.get('facing') === '-1') body.place(W / 2, -1);
    if (WALK != null) body.walk(+WALK, RUN);
    if (EXPR) body.do(EXPR);
    const mid = Math.round(FRAMES * .55);
    tick(mid);
    if (EXPR2) body.do(EXPR2);
    tick(Math.max(0, FRAMES - mid));

    /* 收尾再 place 一次：idle 的「东张西望」会把 facing 翻掉（faceVis 是用 lerp 过渡的，
     * 中途会渲染出镜像/压扁的中间态），重新 place 会把它瞬间拉回 +1。 */
    if (q.get('still') === '1') { body.place(W / 2, 1); tick(1); }

    window.__layout = body.layout ? body.layout() : null;
    window.__done = true;
  } catch (e) {
    fail(e);
    window.__done = true;
  }
})();
