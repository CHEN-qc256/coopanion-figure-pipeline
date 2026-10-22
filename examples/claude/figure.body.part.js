/**
 * 克劳德娘（Claude 娘）—— 单一贴图 + warp 的 Q 版桌宠身体。
 *
 * 一张 850x1365 的立绘贴在 256 单位的形象空间里（5.332 px/单位，box 见 model.json），
 * 靠 web/kit/rig.js 的网格变形做动作：
 *   - 双腿在裙摆下摆处铰链摆动（走路/跑步/被拎起/坐下）
 *   - 长发按高度衰减地左右甩动，裙摆同样，两者相位错开
 *   - 整体倾斜/呼吸由 kit 的 createBody 负责
 *
 * 五官是矢量的（贴图里已经把原来的眼睛/眉毛/嘴抹成了光皮），所以眨眼、视线、说话开合、
 * 26 种表情都走同一套代码，不会出现「贴片换脸」的跳变。
 *
 * 坐标全部来自实测（tools/profile.mjs、tools/measure.mjs）：
 *   眼 L(108.7,69.2) R(143.0,69.2) rx8.6 ry9.2；嘴 (123.9,84.6)；hip L(116,205) R(138.5,205)。
 */

const SVGNS = 'http://www.w3.org/2000/svg';
const XHTMLNS = 'http://www.w3.org/1999/xhtml';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const ease = (rate, dt) => 1 - Math.exp(-rate * dt);
const smooth = (a, b, x) => { const k = clamp((x - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
const bump = (u) => Math.sin(Math.PI * clamp(u, 0, 1));
const r2 = (v) => Math.round(v * 100) / 100;

/** FACES 里 rx/ry 的默认值；表情给的半径按这个比例缩到本形象的眼大小。 */
const DEF_EYE = 16;

export async function createClaudeBody(base, { model, scheme, kit, loadImage, host }) {
  const M = model && model.parts ? model : MODEL;
  const feat = M.feat || {};
  const colors = M.colors || {};
  const palettes = M.palettes || [];
  const expr = M.expressions || {};
  let pick = typeof scheme === 'string' ? scheme : (palettes[0] ? palettes[0].id : '');

  const href = (tex) => new URL('tex/' + tex + '.png', base).href;
  const load = (url) => loadImage
    ? loadImage(url)
    : new Promise((ok, bad) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => bad(new Error('image failed: ' + url)); im.src = url; });

  const body0 = M.parts[0];
  const BOX = [body0.x, body0.y, body0.w, body0.h];
  const EYE = [feat.eyes.L || { x: 108.7, y: 69.2, rx: 8.6, ry: 9.2 }, feat.eyes.R || { x: 143.0, y: 69.2, rx: 8.6, ry: 9.2 }];
  const MOUTH = feat.mouth || { x: 123.9, y: 84.6, rx: 3, ry: 1.7 };
  /** 两条腿的髋关节（贴图实测），[远(观众左), 近(观众右)] */
  const HIP = [[116, 205], [138.5, 205]];
  const HEM = 219; // 裙摆下沿，warp 从这里开始生效
  const LEG_SPLIT = 126.5; // 两条腿在 x 上的分界（腿间空隙的中点）

  const C = {
    lash: colors.lash || '#0d0300',
    line: colors.line || '#120705',
    sclera: colors.sclera || '#fffaf3',
    irisDark: colors.irisDark || '#7a3a12',
    irisLight: colors.irisLight || '#f7ad46',
    pupil: colors.pupil || '#3d1f0e',
    lid: colors.lid || '#fde3cf',
    lid2: colors.lid2 || '#ffcfb4',
    mouth: colors.mouth || '#b06a4e',
    brow: colors.brow || '#c9803f',
  };

  /* 注意：这里**不能**给 .f-lash 写 `fill:none` —— CSS 会盖掉元素上的 fill 属性，
   * 上眼线是「填充带」，之前被这条规则整条吞掉（查 getComputedStyle 才发现）。
   * 只画描边的下眼线自己在元素上写 fill="none"。 */
  const css = ''
    + '.forge-figure { shape-rendering: geometricPrecision; }'
    + '.forge-figure .f-lash { stroke-linecap: round; stroke-linejoin: round; }';

  const filterNow = () => {
    const p = palettes.find((x) => x.id === pick);
    return p && p.filter && p.filter !== 'none' ? p.filter : '';
  };

  /* ---------------- 网格：一条贴图，四组 warp ---------------- */
  const RIG = {
    view: M.view || [0, 0, M.size || 256, M.size || 256],
    deformers: {
      root: { kind: 'rot', pivot: [128, 256] },
      legs: { kind: 'warp', rect: [40, 196, 220, 256], parent: 'root' },
      skirt: { kind: 'warp', rect: [36, 140, 222, 236], parent: 'legs' },
      hair: { kind: 'warp', rect: [26, 52, 232, 244], parent: 'skirt' },
    },
    parts: [{ id: 'body', tex: 'body', box: BOX, grid: [84, 150], z: 5, parent: 'hair' }],
  };

  /* ---------------- 挂载：canvas 放进 foreignObject，脸是 SVG 盖在上面 ---------------- */
  const VIEW = RIG.view;
  let wrap = null, fo = null, canvas = null, fxG = null, rig = null, mountedIn = null, pxScale = 0, frameN = 0;
  let disposed = false;

  function mount(petG) {
    petG.textContent = '';
    rig?.dispose();
    rig = null;
    wrap = document.createElementNS(SVGNS, 'g');
    wrap.setAttribute('class', 'forge-figure');
    canvas = document.createElementNS(XHTMLNS, 'canvas');
    canvas.style.cssText = 'width:100%;height:100%;display:block';
    fo = document.createElementNS(SVGNS, 'foreignObject');
    fo.setAttribute('x', VIEW[0]); fo.setAttribute('y', VIEW[1]);
    fo.setAttribute('width', VIEW[2] - VIEW[0]); fo.setAttribute('height', VIEW[3] - VIEW[1]);
    fo.appendChild(canvas);
    fxG = document.createElementNS(SVGNS, 'g');
    wrap.append(fo, fxG);
    petG.appendChild(wrap);
    rig = kit.createRig(canvas, RIG);
    rig.upload('body', bodyImg);
    mountedIn = petG; pxScale = 0;
  }

  function fitCanvas() {
    const m = mountedIn && mountedIn.getScreenCTM();
    if (!m) return;
    const k = Math.hypot(m.c, m.d) * (window.devicePixelRatio || 1) * 1.2;
    if (Math.abs(k - pxScale) / (pxScale || 1) < .08) return;
    pxScale = k;
    // 上限 4.2：贴图本身 5.33 px/单位，再往上只是浪费显存
    canvas.width = Math.max(16, Math.round((VIEW[2] - VIEW[0]) * Math.min(k, 4.2)));
    canvas.height = Math.max(16, Math.round((VIEW[3] - VIEW[1]) * Math.min(k, 4.2)));
  }

  const bodyImg = await load(href('body'));

  /* ---------------- 逐帧状态 ---------------- */
  let lastT = null;
  let hairX = 0, skirtX = 0, walkK = 0, sitK = 0, runK = 0;
  let legA = [0, 0], legY = [0, 0];

  /* ---------------- 眼睛 ---------------- */
  // 表情 -> 嘴的参数：w 半宽, curve 弧度(+上扬), round 圆张, skew 歪
  const MOUTHS = {
    neutral: { w: 1.9, curve: .20 }, happy: { w: 4.4, curve: 2.4, open: .25 },
    wink: { w: 4.0, curve: 2.0, open: .18 }, love: { w: 4.2, curve: 2.3, open: .3 },
    shy: { w: 2.2, curve: .35 }, surprised: { w: 2.1, round: 1 },
    angry: { w: 3.2, curve: -1.8 }, sad: { w: 3.4, curve: -2.2 },
    sleepy: { w: 2.5, round: 1 }, sleep: { w: 1.7, round: 1 },
    dizzy: { w: 3.8, curve: -.5 }, dragged: { w: 3.0, curve: -1.5 },
    content: { w: 3.0, curve: 1.7 }, waking: { w: 2.2, round: 1 },
    squeeze: { w: 2.6, curve: .4 }, bowing: { w: 2.4, curve: .2 },
    smug: { w: 3.8, curve: 1.5, skew: 1 }, flustered: { w: 2.3, curve: -.7 },
    cry: { w: 4.2, curve: -2.4, open: .45 }, pout: { w: 1.8, curve: -.9 },
    worried: { w: 2.9, curve: -1.2 }, determined: { w: 3.0, curve: -.3 },
    excited: { w: 3.6, curve: 2.8, open: .55 }, confused: { w: 2.3, curve: .2 },
    listening: { w: 2.3, curve: .35 }, thinking: { w: 2.3, curve: .3 },
    run: { w: 3.4, curve: 1.1 },
  };

  function eyeArt(i, e, f) {
    const g = EYE[i];
    const outS = i === 0 ? -1 : 1;              // 眼尾朝脸外侧
    const kx = g.rx / DEF_EYE, ky = g.ry / DEF_EYE;   // kit 的基准是 rx=ry=16
    const shape = (e && e.shape) || 'ring';
    const cx = g.x + ((e && e.dx) || 0) * kx;
    const cy = g.y + ((e && e.dy) || 0) * ky;
    const rxE = ((e && e.rx != null) ? e.rx : DEF_EYE) * kx;
    const ryE = ((e && e.ry != null) ? e.ry : DEF_EYE) * ky;
    const look = f.look || [0, 0];
    const lx = clamp(look[0] || 0, -1, 1), ly = clamp(look[1] || 0, -1, 1);
    const blink = clamp(Math.max(f.blink || 0, f.eyeClose || 0), 0, 1);
    const sw = clamp(rxE * .30, 1.1, 3.2);      // 眼线粗细
    const R = r2;
    const parts = [];
    const id = 'ce' + i;

    /* 闭合/弯眼：不画眼白，只画一道弧 */
    if (shape === 'up' || shape === 'down' || shape === 'squeeze' || ryE < 1.4) {
      const up = shape === 'up';
      /* 弧线要浅、要落在眼框里：早先 peak 给到 .95ryE，弧顶冲到眼框上沿之外，
       * 粗描边看起来像多长了一道眉毛。 */
      const y0 = cy + ryE * (up ? .16 : -.14);
      const peak = (up ? -1 : 1) * ryE * .46;
      const stop = clamp(ryE * .26, 2.0, 3.2);
      parts.push('<path class="f-lash" fill="none" stroke="' + C.lash + '" stroke-width="' + R(stop) + '" d="M' + R(cx - rxE * 1.0) + ' ' + R(y0)
        + 'Q' + R(cx) + ' ' + R(y0 + peak * 1.55) + ' ' + R(cx + rxE * 1.0) + ' ' + R(y0 + peak * .55) + '"/>');
      if (shape === 'squeeze') {
        // 挤眼：眼尾补一小撇
        parts.push('<path class="f-lash" fill="none" stroke="' + C.lash + '" stroke-width="' + R(stop * .8) + '" d="M' + R(cx + outS * rxE * .95) + ' ' + R(y0 + peak * .55)
          + 'Q' + R(cx + outS * rxE * 1.35) + ' ' + R(y0 + peak * .2) + ' ' + R(cx + outS * rxE * 1.5) + ' ' + R(y0 + peak * 1.0) + '"/>');
      }
      return parts.join('');
    }

    /* 「晕」：螺旋 */
    if (shape === 'spiral') {
      const rot = (e && e.rot) || 0;
      let d = '';
      for (let n = 0; n <= 30; n++) {
        const a = n / 30 * Math.PI * 5 + rot, rr = Math.max(1, rxE * .92) * (n / 30);
        d += (n ? 'L' : 'M') + R(cx + Math.cos(a) * rr) + ' ' + R(cy + Math.sin(a) * rr * 1.05);
      }
      return '<path class="f-lash" fill="none" stroke="' + C.line + '" stroke-width="' + R(clamp(sw * .75, 1, 2.4)) + '" d="' + d + '"/>';
    }

    /* 「心」：心形虹膜 */
    if (shape === 'heart') {
      const s = (e && e.s) || 1, h = Math.max(3.2, ryE * .9) * s, w = h * 1.1;
      const d = 'M' + R(cx) + ' ' + R(cy + h * .78)
        + 'C' + R(cx - w * 1.5) + ' ' + R(cy - h * .1) + ' ' + R(cx - w * .45) + ' ' + R(cy - h * 1.15) + ' ' + R(cx) + ' ' + R(cy - h * .28)
        + 'C' + R(cx + w * .45) + ' ' + R(cy - h * 1.15) + ' ' + R(cx + w * 1.5) + ' ' + R(cy - h * .1) + ' ' + R(cx) + ' ' + R(cy + h * .78) + 'Z';
      return '<path d="' + d + '" fill="' + (colors.eye || '#e0722a') + '"/>'
        + '<circle cx="' + R(cx - w * .38) + '" cy="' + R(cy - h * .3) + '" r="' + R(Math.max(.7, w * .18)) + '" fill="#fff" opacity=".92"/>';
    }

    /* 常规睁眼：眼白 + 虹膜 + 瞳孔 + 高光，整体裁在眼形里 */
    /* 竖直尺度全部锁在原画量到的眼框里（cy±ry），眼线占框顶那条带，
     * 开口整体下移 —— 否则眼线会爬到刘海上去，像贴了两道假睫毛。 */
    const oy = ryE * .70, ox = rxE * .95;
    const cyE = cy + ryE * .21;
    const topY = cyE - oy, botY = cyE + oy;
    const lidK = clamp(Math.max(blink, shape === 'lid' ? .45 : 0), 0, 1);
    /* 眼皮分两条线：
     *   lidFillY 一路压到底，保证虹膜被完全盖住；
     *   lidLineY 是看得见的那条眼线，闭眼时停在眼框下方 62% 处，
     *   不然线会贴在眼框最下沿，看着像「眼睛没了只剩一条缝」。 */
    const lidFillY = lerp(topY - 1.1, botY + .8, lidK);
    const lidLineY = lerp(topY - 1.1, cyE + oy * .62, lidK);
    const irisS = shape === 'wide' ? .97 : 1;
    /* 虹膜默认居中：早先写了 cx - outS*.5（两眼各朝鼻梁偏半个单位），
     * 会让她看起来有点斗鸡眼。视线偏移只来自 look。 */
    const ix = cx + clamp(lx * 1.5, -1.5, 1.5) + (shape === 'gt' ? 2.2 : shape === 'lt' ? -2.2 : 0);
    const iy = cyE - oy * .06 + clamp(ly * 1.2, -1.2, 1.2);
    /* 原画的虹膜几乎填满眼睛开口（只在外角留月牙形眼白），上沿被眼线压住，瞳孔是竖长椭圆 */
    const irx = Math.min(ox * 1.02, rxE * .84) * irisS;
    const iry = Math.min(oy * .88, ryE * .72) * irisS;
    const gid = 'ig' + i;

    parts.push('<defs><clipPath id="' + id + '"><ellipse cx="' + R(cx) + '" cy="' + R(cyE) + '" rx="' + R(ox) + '" ry="' + R(oy) + '"/></clipPath>'
      + '<linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">'
      + '<stop offset="0" stop-color="' + C.pupil + '"/><stop offset=".26" stop-color="' + C.irisDark + '"/>'
      + '<stop offset=".58" stop-color="' + (colors.eye || '#e0722a') + '"/>'
      + '<stop offset=".86" stop-color="' + C.irisLight + '"/><stop offset="1" stop-color="' + C.irisLight + '"/></linearGradient></defs>');
    parts.push('<g clip-path="url(#' + id + ')">');
    parts.push('<ellipse cx="' + R(cx) + '" cy="' + R(cyE) + '" rx="' + R(ox) + '" ry="' + R(oy) + '" fill="' + C.sclera + '"/>');
    // 眼白上沿的阴影，让眼睛有厚度
    parts.push('<path d="M' + R(cx - ox) + ' ' + R(topY + 1.2) + 'Q' + R(cx) + ' ' + R(topY - 1.6) + ' ' + R(cx + ox) + ' ' + R(topY + 1.2) + 'L' + R(cx + ox) + ' ' + R(topY - 1) + 'L' + R(cx - ox) + ' ' + R(topY - 1) + 'Z" fill="' + C.irisDark + '" opacity=".18"/>');
    parts.push('<ellipse cx="' + R(ix) + '" cy="' + R(iy) + '" rx="' + R(irx) + '" ry="' + R(iry) + '" fill="url(#' + gid + ')"/>');
    // 虹膜上沿压一条更深的弧，模拟被眼线遮住的投影
    parts.push('<path d="M' + R(ix - irx) + ' ' + R(iy - iry * .56) + 'Q' + R(ix) + ' ' + R(iy - iry * 1.06) + ' ' + R(ix + irx) + ' ' + R(iy - iry * .56)
      + '" fill="none" stroke="' + C.pupil + '" stroke-width="' + R(Math.max(.4, iry * .12)) + '" opacity=".34"/>');
    parts.push('<ellipse cx="' + R(ix) + '" cy="' + R(iy + iry * .04) + '" rx="' + R(irx * .30) + '" ry="' + R(iry * .76) + '" fill="' + C.pupil + '"/>');
    parts.push('<circle cx="' + R(ix - irx * .34) + '" cy="' + R(iy - iry * .38) + '" r="' + R(Math.max(1.1, irx * .32)) + '" fill="#fff" opacity=".97"/>');
    parts.push('<circle cx="' + R(ix + irx * .42) + '" cy="' + R(iy + iry * .48) + '" r="' + R(Math.max(.6, irx * .15)) + '" fill="#fff" opacity=".78"/>');
    parts.push('</g>');

    // 眼皮：从眼形上沿压到 lidFillY（皮肤色渐变），**裁在眼形里**，不会在脸上留下浅色方块
    if (lidK > .004) {
      const lw = ox * 1.30;
      const lgid = 'lg' + i;
      parts.push('<defs><linearGradient id="' + lgid + '" x1="0" y1="0" x2="0" y2="1">'
        + '<stop offset="0" stop-color="' + C.lid + '"/><stop offset="1" stop-color="' + C.lid2 + '"/></linearGradient></defs>');
      parts.push('<g clip-path="url(#' + id + ')"><path d="M' + R(cx - lw) + ' ' + R(topY - 2) + 'H' + R(cx + lw) + 'V' + R(lidFillY)
        + 'Q' + R(cx) + ' ' + R(lidFillY + oy * .12) + ' ' + R(cx - lw) + ' ' + R(lidFillY) + 'Z" fill="url(#' + lgid + ')"/>'
        + '<path d="M' + R(cx - lw) + ' ' + R(lidLineY - oy * .30) + 'Q' + R(cx) + ' ' + R(lidLineY - oy * .46) + ' ' + R(cx + lw) + ' ' + R(lidLineY - oy * .30)
        + 'V' + R(lidLineY) + 'H' + R(cx - lw) + 'Z" fill="' + C.irisDark + '" opacity=".10"/></g>');
    }

    /* 上眼线：**填充带**（不是描边），下沿咬住眼形上缘，外角加厚上挑 + 眼尾尖。
     * 上一版用细描边，眼白和眼线之间会露出一道缝，看起来发灰发软。 */
    const innerX = cx - outS * ox * 1.00, outerX = cx + outS * ox * 1.06;
    /* 上眼线贴着眼的**上缘**走：内角几乎压在开口线上，外角略抬并加厚挑出去。
     * （早期版本 innerY 用了 +.26oy，整条带子滑到眼球中间，像画了道下眼线。） */
    const innerY = lidLineY + oy * .04, outerY = lidLineY - oy * .14;
    const peakY = lidLineY - oy * .34;
    const lashT = clamp(ryE * .24, 1.7, 3.6);
    const tipX = outerX + outS * sw * 1.35, tipY = outerY - sw * .80;
    parts.push('<path class="f-lash" fill="' + C.lash + '" d="M' + R(innerX) + ' ' + R(innerY)
      + 'Q' + R(cx) + ' ' + R(peakY) + ' ' + R(outerX) + ' ' + R(outerY)
      + 'L' + R(tipX) + ' ' + R(tipY)
      + 'Q' + R(cx) + ' ' + R(peakY + lashT * 1.05) + ' ' + R(innerX) + ' ' + R(innerY + lashT * .30) + 'Z"/>');
    // 眼尾的小翼（再往外撇一小撮）
    parts.push('<path fill="' + C.lash + '" opacity=".9" d="M' + R(outerX) + ' ' + R(outerY + sw * .2)
      + 'Q' + R(tipX + outS * sw * .5) + ' ' + R(tipY + sw * .35) + ' ' + R(tipX + outS * sw * 1.1) + ' ' + R(tipY + sw * .95)
      + 'Q' + R(tipX - outS * sw * .1) + ' ' + R(tipY + sw * 1.3) + ' ' + R(outerX) + ' ' + R(outerY + sw * .7) + 'Z"/>');
    // 下眼线：贴着椭圆下缘（3 点二次曲线近似椭圆；用一根 Q 敷衍的话中段会浮在
    // 弧线上方，看起来像在虹膜中间横了一道黑线）
    if (lidK < .5) {
      const P = (a) => [cx + outS * ox * Math.cos(a * Math.PI / 180), cyE + oy * Math.sin(a * Math.PI / 180)];
      const [x0, y0] = P(22), [xm, ym] = P(56), [xc2, yc2] = P(90), [xn, yn] = P(124), [x1, y1] = P(158);
      parts.push('<path class="f-lash" fill="none" stroke="' + C.lash + '" stroke-width="' + R(clamp(sw * .26, .4, .85)) + '" stroke-linecap="round" opacity="' + R((1 - lidK / .5) * .62) + '" d="M'
        + R(x0) + ' ' + R(y0) + 'Q' + R(xm) + ' ' + R(ym) + ' ' + R(xc2) + ' ' + R(yc2)
        + 'Q' + R(xn) + ' ' + R(yn) + ' ' + R(x1) + ' ' + R(y1) + '"/>');
    }
    return parts.join('');
  }

  /* ---------------- 嘴 ---------------- */
  function mouthArt(f) {
    const gap = f.gap || [50, 50];
    const openG = clamp(((gap[0] + gap[1]) / 2 - 54) / 12, 0, 1);
    const st = MOUTHS[f.face] || MOUTHS.neutral;
    const w = (st.w || 2.6) * (MOUTH.rx / 3);
    const cx = MOUTH.x, cy = MOUTH.y;
    const open = clamp(Math.max(openG, st.open || 0), 0, 1);
    const R = r2;
    const out = [];
    if (st.round || open > .46) {
      const ry = lerp(.75, 3.1, open) * (MOUTH.ry / 1.7) * .82;
      const rx = w * (st.round ? .62 : .78);
      out.push('<ellipse cx="' + R(cx) + '" cy="' + R(cy + ry * .25) + '" rx="' + R(rx) + '" ry="' + R(ry) + '" fill="#8a3a28"/>');
      if (ry > 1.4) out.push('<ellipse cx="' + R(cx) + '" cy="' + R(cy + ry * .78) + '" rx="' + R(rx * .66) + '" ry="' + R(ry * .34) + '" fill="#d0705a"/>');
      out.push('<ellipse cx="' + R(cx) + '" cy="' + R(cy + ry * .25) + '" rx="' + R(rx) + '" ry="' + R(ry) + '" fill="none" stroke="#5e2416" stroke-width=".5" opacity=".7"/>');
    } else {
      const c = st.curve || 0;
      const sk = (st.skew || 0) * .6;
      out.push('<path d="M' + R(cx - w) + ' ' + R(cy + c * .12) + 'Q' + R(cx - w * .2) + ' ' + R(cy + c * .78 + sk * 2.2) + ' ' + R(cx + w) + ' ' + R(cy + c * .12 + sk * 1.4) + '" fill="none" stroke="' + C.mouth + '" stroke-width="' + R(clamp(w * .34, .75, 1.5)) + '" stroke-linecap="round"/>');
    }
    return out.join('');
  }

  /* 眉：只在 kit 明确要「怒/悲」时画（原画眉毛藏在刘海下，常态不画才干净） */
  function browArt(f) {
    const kind = f.brows;
    if (!kind) return '';
    const R = r2, out = [];
    for (let i = 0; i < 2; i++) {
      const g = EYE[i], outS = i === 0 ? -1 : 1;
      const cx = g.x, cy = g.y - g.ry * 1.02;
      const w = g.rx * .84;
      const innerX = cx - outS * w, outerX = cx + outS * w;
      const tilt = kind === 'angry' ? 1 : -1;      // 怒：内端压低；悲：内端抬高
      const dy = g.ry * .30 * tilt;
      out.push('<path stroke="' + C.brow + '" stroke-width="' + R(clamp(g.ry * .095, .55, 1.15)) + '" stroke-linecap="round" fill="none" opacity=".78" d="M'
        + R(innerX) + ' ' + R(cy + dy) + 'Q' + R(cx) + ' ' + R(cy - g.ry * .22) + ' ' + R(outerX) + ' ' + R(cy - dy * .60) + '"/>');
    }
    return out.join('');
  }

  /* ---------------- 脸 ---------------- */
  function faceSvg(face, f) {
    const out = [];
    const eyes = face.eyes || [];
    const over = expr[face.face] || null;
    if (over) {
      for (const slot of ['eyeL', 'eyeR', 'mouth']) {
        const im = over[slot];
        if (!im || !im.at) continue;
        out.push('<image href="' + href(im.tex) + '" x="' + r2(im.at[0] - im.w / 2) + '" y="' + r2(im.at[1] - im.h / 2) + '" width="' + im.w + '" height="' + im.h + '"/>');
      }
    }
    for (let i = 0; i < 2; i++) out.push(eyeArt(i, eyes[i], f));
    out.push(browArt(f));
    const hideMouth = over && over.mouth;
    if (!hideMouth) out.push(mouthArt(f));
    return out.join('');
  }

  /* ---------------- 身体 ---------------- */
  const figure = {
    extent: M.extent,
    hits: M.hits,
    anchors: M.anchors,
    gestures: M.gestures,
    colors: { z: colors.accent || null },
    setScheme(id) { if (typeof id === 'string') pick = id; },
    setSkin() { /* 只有一套身体 */ },
    draw(petG, face, fIn) {
      if (mountedIn !== petG || !petG.contains(fo)) mount(petG);
      if (disposed) return;
      /* 调试用：预览页/截图 harness 可以定住眨眼相位，便于逐帧核表情 */
      const w = typeof window !== 'undefined' ? window : null;
      const f = w && typeof w.__blinkAt === 'number' ? { ...fIn, blink: w.__blinkAt, eyeClose: w.__blinkAt }
        : (w && w.__noBlink) ? { ...fIn, blink: 0, eyeClose: 0 } : fIn;
      if (frameN++ % 20 === 0) fitCanvas();
      const t = f.t || 0, dt = lastT == null ? 1 / 60 : clamp(t - lastT, 0, .05);
      lastT = t;
      const mode = f.mode || 'idle';
      const walking = mode === 'walk' || mode === 'run';
      const held = mode === 'drag', airborne = mode === 'air';
      const legs = f.legs || [];

      walkK = lerp(walkK, walking ? 1 : 0, ease(8, dt));
      runK = lerp(runK, mode === 'run' ? 1 : 0, ease(7, dt));
      sitK = lerp(sitK, clamp(f.sit ?? 0, 0, 1), ease(12, dt));

      /* 腿：kit 递来的是 hip->foot 的线段（按 Coo 的 44 单位腿算的）。
       * 我们的腿短、又大半被裙摆挡着，**不能绕髋旋转**（鞋会被拧成风车），
       * 改成「脚整体横移 + 抬脚」——从裙摆下沿到脚底做衰减，像是从裙子里荡出去。 */
      const want = [0, 0], wantY = [0, 0];
      for (let i = 0; i < 2; i++) {
        const l = legs[i];
        if (!l) continue;
        const dx = (l[2] || 0) - (l[0] || 0), dy = Math.max(4, (l[3] || 0) - (l[1] || 0));
        const lift = clamp(44 - Math.hypot(dx, dy), 0, 16);
        want[i] = lerp(0, clamp(dx * .52, -6, 6), walkK) * (1 - sitK);
        wantY[i] = lerp(lerp(0, -lift * .50, walkK), -6.5, sitK);
      }
      if (held) { want[0] = 3.4 + 1.6 * Math.sin(t * 9); want[1] = -2.6 - 1.4 * Math.sin(t * 9 + 1.1); wantY[0] = 2.6; wantY[1] = 1.8; }
      if (airborne) { want[0] = 2.6; want[1] = -1.8; wantY[0] = 1.8; wantY[1] = 1.2; }
      legA[0] = lerp(legA[0], want[0], ease(20, dt));
      legA[1] = lerp(legA[1], want[1], ease(20, dt));
      legY[0] = lerp(legY[0], wantY[0], ease(20, dt));
      legY[1] = lerp(legY[1], wantY[1], ease(20, dt));

      /* 头发与裙摆：反着 swing 甩，跑起来再多一点拖尾 */
      const sway = clamp((f.swing || 0) / 26, -1.6, 1.6);
      const hairTo = clamp(-sway * 1.9 - (walking ? .5 : 0) - runK * .9, -3, 3);
      const skirtTo = clamp(-sway * 1.3 - (walking ? .35 : 0), -2.2, 2.2);
      hairX = lerp(hairX, hairTo, ease(8, dt));
      skirtX = lerp(skirtX, skirtTo, ease(9, dt));

      /* 一条 mesh 管两条腿：以两腿之间的空隙为界（实测空隙在 x 124.4..128.7，取中点）。
       * 纯位移，不旋转 —— 脚的形状永远不会被拧坏。 */
      const legWarp = (u, v, x, y) => {
        const w = smooth(HEM, HEM + 19, y);
        if (w <= 0) return [0, 0];
        const i = x >= LEG_SPLIT ? 1 : 0;
        return [legA[i] * w, legY[i] * w];
      };

      const low = f.low || 0;
      /* 身体的前后摆/上下颠（root）不能只作用在贴图上：五官是另一层矢量 SVG，
       * 只动贴图会让眼睛从脸上滑出去（坐着 low 最大 29 单位、走路颠 3-7 单位）。
       * 所以 root 干脆不交给 rig，而是把同一套变换写到包住 canvas + fxG 的 wrap 上，
       * 两层由构造保证永远同步。rig 的 rot 是「先绕 pivot 转、再加平移」，
       * 对应的 SVG 写法就是 translate(0,ty) rotate(a,128,256)（列表右先左后）。 */
      const rootA = clamp(-sway * 1.2, -5, 5) + (walking ? 1.2 : 0) * (1 - sitK);
      const rootY = low - 3.5 * sitK;
      const st = {
        legs: { fn: legWarp },
        skirt: { fn: (u, v, x, y) => { const k = smooth(150, 226, y); return [skirtX * k * k, 0]; } },
        hair: { fn: (u, v, x, y) => { const k = smooth(104, 232, y); return [hairX * k * k, 0]; } },
      };
      rig.render(st);

      const ftv = (Math.abs(rootA) > .015 || Math.abs(rootY) > .015)
        ? 'translate(0 ' + r2(rootY) + ') rotate(' + r2(rootA) + ' 128 256)' : '';
      if (wrap.getAttribute('transform') !== ftv) wrap.setAttribute('transform', ftv);

      const filt = filterNow();
      const style = filt ? 'filter:' + filt : '';
      if (wrap.getAttribute('style') !== style) wrap.setAttribute('style', style);
      fxG.innerHTML = faceSvg(face, f);
    },
    dispose() {
      disposed = true;
      rig?.dispose();
      rig = null; canvas = null; fo = null; fxG = null; wrap = null; mountedIn = null;
    },
  };

  const start = { ...(host && host.start) };
  if (typeof start.scheme === 'string' && palettes.some((p) => p.id === start.scheme)) pick = start.scheme;
  const body = kit.createBody({ ...host, start }, { figure, words: M.words || {}, css });
  const setScheme = body.setScheme;
  body.setScheme = async (id, o) => { pick = id; return setScheme ? setScheme(id, o) : undefined; };
  return body;
}
