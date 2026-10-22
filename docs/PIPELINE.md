# 制作流程（照着做就行）

写给**下一个接手这件事的 AI**。每一步都写了：目的、命令、判据、失败的样子。
案例里的实测数字见 [`CASE-claude.md`](CASE-claude.md)，踩过的坑见 [`PITFALLS.md`](PITFALLS.md)。

总时长参考：一个熟练 AI 约 2–4 小时（其中 1 小时在等生图和逐帧核对）。

---

## 第 0 步 · 环境与目录

**目的**：把"一张画"和"一个包"分开放在确定的位置，后面所有命令都只认这两处。

```
<work>/                     工作目录，一个形象一个（默认 examples/claude）
├── src/                    源图区：generated.png（生图结果）、design-*.png（参考图）、_*.png（调试图）
├── assets/                 portrait.png（抹完五官的贴图）+ measure.json（量点结果）
├── tex/  thumbs/           打包产物
├── figure.body.part.js     手写：身体 warp + 五官矢量绘制
├── model.json              参数：贴图盒、锚点、五官坐标、配色
├── figure.meta.json        身份：id / 名字 / 介绍 / 致谢 / 导出名
├── figure.json             产物：清单（模板 + meta 生成）
└── figure.js               产物：model.json + part 拼出来的形象代码
```

```bash
node -v                     # 需要 >= 22
mkdir -p my-figure/src      # 你的工作目录
```

需要一份 **Coopanion 工作副本**（只为离线预览；本仓库不含它）：

```bash
export COOPANION_ROOT=/path/to/Coopanion      # 或者每条命令加 --coopanion /path/to/Coopanion
ls $COOPANION_ROOT/packages/cortico-world-desktop-pet/web/kit/body.js   # 必须存在
ls $COOPANION_ROOT/node_modules/electron/dist/electron.exe              # 必须存在（离线截图要用）
```

**判据**：上面两个 `ls` 都有输出。没有就先在 Coopanion 目录里 `pnpm install`。

---

## 第 1 步 · 读懂运行时契约（只用读这四件事）

**目的**：不读代码就动手，90% 会在"五官为什么会飘"这种问题上浪费三小时。

1. **每帧你会拿到什么**（`web/kit/body.js` 末尾调 `custom.draw(petG, face, frame)`）：

   | `frame` 字段 | 含义 |
   |---|---|
   | `legs` | `[[髋x,髋y,脚x,脚y], [髋x,髋y,脚x,脚y]]`，单位空间坐标。走路时脚在动 |
   | `low` | 身体下沉量（坐下/被拎起时非 0） |
   | `swing` | 左右摆动量；`tilt` / `lean` 是整体倾角 |
   | `blink` / `eyeClose` | 0..1 眨眼进度 |
   | `face` | 当前表情名（`neutral/happy/...`，共 19 个） |
   | `mode` / `modeT` | `idle/walk/sit/drag/sleep...` |
   | `talk`、`facing`、`sit`、`gesture` | 说话强度、朝向（±1）、坐姿、当前手势 |

   `face` 里有 `gap:[a,b]`（嘴的开合，0..64）、`eyes:[{shape,rx,ry,dx,dy,rot,s,sw}]`、
   `blush`、`brows`、`emit`（`z`/`tear`/`heart`，头顶符号由 kit 自己画，你不用管）。

   ⚠️ **`eyes` 的 `rx/ry` 基准是 16**（kit 内部 `const ring = o => ({shape:'ring', rx:16, ry:16, ...o})`）。
   你的眼实际是 `rx=8.6`，那么所有 `dx/dy/rx/ry` 都要乘 `k = 8.6/16`。**x 和 y 要用各自的 k**（见 PITFALLS #6）。

2. **你要画在哪**：`draw(petG, face, frame)`。`petG` 是 kit 的 `<g>`；形象空间 **256×256，脚底在 y=256**。
   kit 已经帮你做了：呼吸缩放、整体位移、朝向翻转、影子、粒子。**不要再画一遍。**

3. **贴图怎么贴**：`kit.createRig(canvas, model)`，`model = { view, deformers, parts }`。
   - `parts[0] = { id:'body', tex:'body', box:[x,y,w,h], grid:[nx,ny], z, parent }`
   - `deformers`：`rot`（`{kind:'rot', pivot, parent}`，绕点旋转+平移）或 `warp`（`{kind:'warp', rect, parent}`，网格变形，回调 `fn(u,v,x,y)→[dx,dy]`）
   - 每个部件通过 `parent` 串成链，**父级动子级跟着动**。

4. **包怎么被加载**：`{manifest:2, api:2, id, entry:'figure.js', export:'createXxxBody', model:'model.json', thumb, vocab, axes, can, moves, needs}`。
   `api` 必须是 `2`，`export` 必须叫 `create<PascalId>Body`。

**判据**：你能回答"眨眼时我该改哪个值"（`frame.blink`）和"走路时我从哪知道脚在哪"（`frame.legs`）。

---

## 第 2 步 · 生图（图生图最省事）

**目的**：拿到一张**能被机器处理**的整身立绘。这一步的产物质量决定后面一切。

### 给模型喂什么

- **1 张画风/构图模板**：上一版做好的同风格整身像（比例、描边、平涂方式都从它来）
- **1–3 张角色设定**：正面全身 + 脸部特写（越清楚的正面越好）
- 提示词：**结构写死 + 细节可换**。例如：
  > 第 1 张是画风与构图模板：严格沿用它的二头身比例、正面站姿、深色粗描边、平涂赛璐璐上色、纯白背景、整身到脚。
  > 第 2、3 张是角色设定：暖橙色及膝长卷发、琥珀橙大眼配粗黑上挑眼线、观众右手边一朵大号橙色雏菊配黑缎带……

### 验收清单（每条不达标就重出，别急着往下走）

- [ ] **正面**：两只眼睛一样大、都在脸内，鼻尖居中
- [ ] **整身**：头顶到脚底都在画面里，四周留白 ≥ 5%
- [ ] **背景纯白**（或纯色）：便于泛洪抠图；不能有渐变光晕、没有阴影投影
- [ ] **四肢不交叠**：手不挡裙子、腿之间**有干净的缝**（缝被填死的两个腿，走路时会撕开）
- [ ] **眼睛清晰**：上眼线是连续的深色，虹膜和眼白分明（后面要按颜色聚类量它们）
- [ ] 分辨率：整身高度 512–1536 px，单张 ≤ 2 MB，PNG 8 位非隔行

> 出 2 张挑 1 张很划算。挑的时候别只看"好不好看"，先看上面 6 条。

---

## 第 3 步 · 抠透明 + 量点

**目的**：把白底变成透明，并把五官/轮廓变成**数字**。

```bash
node tools/prep.mjs --work my-figure probe
# → trimmed 850x1365；src/_probe.json（数值）、src/_probe.png（带框调试图）、src/_probe_face.png（脸部 2×）
```

它做三件事：从边界泛洪判近白背景 → 1 px 羽化抠掉 → 裁边并统计主色/最大连通域，用来**猜**脸框和肤色。

然后 `profile.mjs` 量身体轮廓：

```bash
node tools/profile.mjs --work my-figure
# → src/_edges.json：逐行左右边界。用来定位腰、裙摆下沿、两腿分开的位置
```

**判据**（都写进 `measure.json`，后面全部引用它）：

| 要量的 | 怎么量 | 案例值（850×1365 的图） |
|---|---|---|
| 脸框 | 头部区域内**最大的米白连通域**的包围盒 | x 275–551, y 284–492 |
| 左右眼 | 脸框内按"深色 + 橙色虹膜"聚类 | 中心 (322,369) / (505,369)，各 92×98 |
| 嘴 | 脸下 1/3 里最暗的一小撮像素 | (403,451)，只有 16×5 |
| 裙摆下沿 | 宽度剖面突然收窄的那一行 | y≈1175 |
| 两腿分界 | 下摆以下"缝隙"的中点 x | x≈404–429 |
| 腰/头宽 | 逐行宽度的极小/极大 | 腰 y485 宽 565；头 y349 宽 649 |

⚠️ **不要靠"看截图数像素"定位**。读图工具会把图缩小（案例里被缩到 0.6976 倍），
按缩略图上的坐标反推原图坐标会系统性偏 1.4 倍，而且每次缩得还不一样。**只用程序量，或只用固定倍率的 `zoom.mjs`。**

---

## 第 4 步 · 五官矢量化（最关键的一步）

**目的**：让眨眼、说话、19 种表情都由**代码**决定，而不是几张画死的图。

### 4.1 把贴图上的眼睛/眉/嘴抹成光皮

```bash
# 先把 tools/measure.mjs 顶部的 P 改成上一步量到的值：
#   P = { face:{x0,y0,x1,y1}, eyeL:{cx,cy,rx,ry}, eyeR:{...}, browY, mouth:{cx,cy,rx,ry}, skin:[r,g,b] }
node tools/measure.mjs --work my-figure --write
# → assets/portrait.png（贴图）+ assets/measure.json + src/_fit.png / _fit_erased.png（核对用）
```

抹除算法要点（`paintSoft`，都在 `tools/measure.mjs` 里）：

1. **mask** = 眼形超椭圆 ∪ 眉毛带 ∪ 嘴；眉毛带只吃"上方 7 px 还是皮肤"的深色像素，否则会把刘海啃出直角。
2. **头发掩码**：从脸框上沿泛洪"连到头顶的橙色"，mask 与羽化都绕开它——**否则会把刘海吃掉**。
3. **颜色**：同一行向左/右找最近的皮肤锚点做线性插值，再和逐行肤色中位数 50/50 混合；找不到锚点就只用中位数。
4. **羽化 3 px**，并与原图 alpha 混合。

**判据**：`src/_fit_erased.png` 里脸是干净的光皮，**刘海边缘和原来一模一样**（放大 6× 看，任何直边/方块都是错的）。

### 4.2 用 SVG 重画眼睛和嘴

看 `examples/claude/figure.body.part.js` 的 `eyeArt()` / `mouthArt()`，核心是 6 条：

1. **坐标系**：`kx = eye.rx/16`、`ky = eye.ry/16`（kit 的基准是 16，x/y 分别缩）。`cx = feat.x + dx*kx`。
2. **不要加"斗鸡眼"偏移**：虹膜横向位置只跟 `frame.look` 走。加一个固定内偏，两只眼会一起朝鼻梁看。
3. **虹膜不要填满眼框**：`irx ≈ 0.85*rx`、`iry ≈ 0.72*ry`，下方露出月牙形眼白——这是"有神"和"死鱼眼"的分界。
4. **上眼线是"填充带"不是描边**：描边会在眼白和眼线之间留灰缝。用一条闭合路径填充，厚度 `≈0.24*ry`。
   如果 CSS 里给这个 class 写了 `fill:none`，会**静默盖掉**元素的 `fill` —— 见 PITFALLS #8。
5. **闭眼**：眼皮填充色要按"眼周实测"取（上眼皮一个色、眼下腮红另一个色），否则闭眼像贴了一块白补丁。
   眼皮填充线和可见眼线**分开算**：填充线一定要盖住虹膜，眼线停在眼框 62% 处。
6. **嘴**：`gap` 是 0..64，阈值别设太低（案例里 `(avg-54)/12`），否则呼吸的 ±1 就会让嘴变成圆「o」。
   中性嘴就是 3 单位宽的小短横。

**判据**：`shot.mjs` 出图后，用 `zoom.mjs` 放大到 4× 看——眼睛位置对不对、有没有缝、闭眼帧像不像闭眼。

---

## 第 5 步 · 写 model.json 与 figure.body.part.js

### model.json（数字都在这里）

```json
{
  "forge": 1, "size": 256, "feetY": 256,
  "view": [0, 0, 256, 256], "extent": [0, 0, 256, 256],
  "scale": 0.18755,
  "parts": [{ "id": "body", "tex": "body", "x": 48.3, "y": 0, "w": 159.4, "h": 256, "z": 5, "pivot": [128, 256] }],
  "pivots": { "neck": [128, 96], "hipNear": [138.5, 205], "hipFar": [116, 205],
              "shoulderNear": [152, 120], "shoulderFar": [104, 120] },
  "feat":  { "eyes": { "L": { "x": 108.7, "y": 69.2, "rx": 8.6, "ry": 9.2 }, "R": { ... } },
             "mouth": { "x": 123.9, "y": 84.6, "rx": 3, "ry": 1.7 } },
  "colors": { "line": "#0d0300", "sclera": "#fffaf3", "eye": "#e0722a", "irisDark": "#7a3a12",
              "irisLight": "#f7ad46", "pupil": "#3d1f0e", "lid": "#fde3cf", "lid2": "#ffcfb4", "mouth": "#b06a4e" },
  "hits": [[128, 150, 112]], "anchors": { "z": [128, 26], "tear": [108.7, 78], "tears": [[108.7,78],[143,78]] }
}
```

**单位换算**：贴图高 `H` px 对应 256 单位 ⇒ `pxPerUnit = H/256`、`scale = 256/H`；
`unit_x = (W_tex_units_left) + px/pxPerUnit`，`unit_y = px/pxPerUnit`。
先算 `box`（贴图在 256 空间里的位置与大小），再算其他所有坐标——**顺序错了会整体偏移**。

### figure.body.part.js（一个文件讲完整个形象）

结构（照抄 `examples/claude/figure.body.part.js`，约 400 行）：

```js
export async function create<Id>Body(base, { model, scheme, kit, loadImage, host }) {
  // 1) 常量：BOX / HIP / HEM / LEG_SPLIT / DEF_EYE=16
  // 2) mount(petG)：建 <g> → <canvas> 塞进 <foreignObject> → fxG（五官 SVG 层）
  //                 rig = kit.createRig(canvas, RIG); rig.upload('body', img)
  // 3) eyeArt()/mouthArt()/browArt()/faceSvg()
  // 4) draw(petG, face, frame)：
  //      - 算腿位移（纯平移，不要绕髋旋转）
  //      - 算头发/裙摆的反向甩动
  //      - rig.render(st)
  //      - fxG.innerHTML = faceSvg(face, frame)
  // 5) return kit.createBody({...host, start}, { figure, words, css })
}
```

**关于整体变换（最容易错的一条）**：

> `frame.low`（下沉）、`frame.swing`（摆动）必须**同时**作用在"贴图"和"五官"上。
> 做法：把这两层放进**同一个父 `<g>`**，把 `translate/rotate` 写在这个父节点上。
> 案例里一开始把旋转交给 rig 的 `root` 变形器（只作用于 canvas），坐姿时 `low=29` 让贴图下沉而五官不动，
> 结果**眼睛飘到刘海上**——这就是用户报的"眼睛有时会错位"，对比图见 `docs/img/face-alignment-fix.png`。

**关于腿**：

> **纯平移，不要旋转**。二头身腿短、又被裙摆遮住，绕髋旋转 ±20° 会把鞋子拧成风车。
> 用 `frame.legs` 算 `dx`（前后差）与 `lift`（抬脚），在 y > 裙摆下沿的区间里按 `smooth(hem, hem+20, y)` 衰减。

**关于打包**：`figure.js` 由 `tools/compose.mjs` 拼（`model.json` 常量 + 你写的 part），**不要手改 `figure.js`**，
也不要拿 `figure-forge` 的 build 去覆盖它（那是模板生成器，会把你的手写代码冲掉）。

---

## 第 6 步 · 离线逐帧验证（唯一能"看见"的办法）

**目的**：桌面上的东西看不见、没法调试，所以先离线把每一帧都截出来。

```bash
node tools/shot.mjs my-figure/shots/idle.png "still=1&noblink=1&frames=40" 760 980 \
     --work my-figure --coopanion /path/to/Coopanion
```

参数（URL query）：

| 参数 | 作用 |
|---|---|
| `frames=N` | 先跑 N 帧再截（60 fps） |
| `still=1` | 关掉漫游并 `place()` 到中间——**固定画面才可比** |
| `noblink=1` | 冻结眨眼（否则可能拍在闭眼/半闭） |
| `blink=0.5` | 反过来：把眨眼定在指定相位，专查闭眼帧 |
| `expr=happy` | 第 3 帧触发某个表情/动作词 |
| `walk=640&run=1` | 走到 x=640，可加跑步 |
| `probe=<js>` | 在页面里执行一段 JS 并把结果打到 stderr（查 CSS 计算值、元素属性特别有用） |

配套：`zoom.mjs <in> <out> x y w h scale` 放大局部；`montage.mjs <out> cols ...files` 平铺对比；
`diffbox.mjs` 两份图逐像素差异。

**判据**（不满足就别往下走）：

- 睁眼、闭眼、半闭三个相位都像"眼睛"，不是一个白椭圆
- 19 个表情逐个截一张、拼一张图，**彼此能区分**
- `sit=1` 与 `walk` 帧里，五官仍然长在脸上（这条专门抓"错位"）
- 灰底图里没有意外的色块/直边（抹脸的痕迹）

---

## 第 7 步 · 清单与打包

```bash
node tools/manifest.mjs --work my-figure   # 模板 + figure.meta.json → figure.json（回读校验）
node tools/compose.mjs  --work my-figure   # → figure.js / tex/body.png / thumbs/cover.png（回读校验）
```

两个工具都会**回读校验**：`figure.json` 的 id/export/entry/api/vocab 长度要和输入一致；
`figure.js` 里的 `const MODEL = {...}` 必须 `JSON.parse` 回来和 `model.json` 深等。
（教训：用字符串 replace 改 JSON，键名一变就静默 no-op，最后拿到一份"看起来改过了"的旧配置。）

包里的 5 个文件：`figure.json` `figure.js` `model.json` `tex/body.png` `thumbs/cover.png`。

---

## 第 8 步 · 安装到 Coopanion 并实机验证

```bash
# 1) 拷包
cp -r my-figure/{figure.json,figure.js,model.json,tex,thumbs} \
      "$COOPANION_ROOT/build/data/home/companion/data/figures/myid/"

# 2) 改配置：worlds.desktop-pet.skin.figure = "myid"
#    ⚠️ 必须写成 UTF-8 无 BOM，否则 app 直接 JSON.parse 失败并进入崩溃重启循环（PITFALLS #10）

# 3) 重启：按可执行路径过滤杀进程 → 清掉 ELECTRON_RUN_AS_NODE/NODE_OPTIONS → 起
```

重启后：

- 看 `<Coopanion>/build/data/logs/core.log`，应有世界启动 + 桌宠页面连接成功的行
- 截全屏（PowerShell `System.Drawing` 的 `CopyFromScreen`），再 `zoom.mjs` 放大看脸
- **一定要看坐下/走路/被拎起来**这几个状态（静态 idle 看不出错位）

---

## 第 9 步 · 交付

留下这些，别人（或下一个你）才能复现：

1. `<work>/` 整个目录（源图 + 量点 + 手写 part + 打好的包）
2. 一份 `REPORT.md`：量到的数字、改过哪些参数、哪些地方妥协了
3. 新踩到的坑补进 `docs/PITFALLS.md`（**症状 → 原因 → 修法**，别只写"修好了"）
4. 至少 4 张图：静态整身、脸部 4× 特写、表情拼图、一个动态姿态

---

## 附：一页速查

| 症状 | 先看哪里 |
|---|---|
| 眼睛飘到头发上 / 偏出脸 | 整体变换是否只作用在贴图（PITFALLS #3） |
| 两只眼像斗鸡眼 | 虹膜偏移里有没有固定内偏（#6） |
| 眼睛比原画矮 | `ky = ry/16` 而不是复用 `rx/16`（#6） |
| 闭眼像白补丁 | 眼皮色没按眼周实测；`lid`/`lid2` 两个色（#16） |
| 上眼线整条不见了 | CSS `fill:none` 盖掉了元素 `fill`（#8） |
| 走路鞋子拧成风车 | 腿用了旋转，应改纯平移（#4） |
| 刘海被啃出直角 | 抹脸没做头发掩码（#9） |
| 截图一会儿睁眼一会儿闭眼 | 没冻结 `noblink`；朝向也要 `still` 固定（#7） |
| 改完配置没生效 | 改的是产物不是源；或 app 被 BOM 卡住（#10 / #11） |
