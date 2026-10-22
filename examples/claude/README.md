# 示例：克劳德娘

这个目录就是**一个做完的形象**，可以拿来对照，也可以直接装进 Coopanion。

```bash
# 从这个目录开始复现（不需要重跑生图）
node tools/measure.mjs --work examples/claude --write   # 重算贴图 + 量点（应与现有文件逐像素一致）
node tools/manifest.mjs --work examples/claude          # 重生成 figure.json
node tools/compose.mjs  --work examples/claude          # 重拼 figure.js / tex / thumbs
node tools/shot.mjs examples/claude/shots/idle.png "still=1&noblink=1&frames=40" 760 980 \
     --work examples/claude --coopanion /path/to/Coopanion
```

| 文件 | 是什么 |
|---|---|
| `src/generated.png` | 生图模型的原始输出（928×1664，纯白底、正面站立、二头身） |
| `src/prompt.txt` | 当时用的提示词骨架 |
| `assets/portrait.png` | 抠透明 + 裁边 + **抹掉五官**后的贴图（850×1365） |
| `assets/measure.json` | 量点结果（脸框、两眼、嘴、肤色、轮廓关键行） |
| `model.json` | 全部参数：贴图盒、锚点、五官坐标、配色、hits |
| `figure.body.part.js` | **手写部分**：rig 结构、走路/裙摆/头发 warp、矢量眼/嘴、19 表情映射 |
| `figure.meta.json` | 身份信息（清单里只放这个 + 模板） |
| `figure.json` | 清单产物 |
| `figure.js` | 拼好的形象代码（`compose.mjs` 的产物，别手改） |
| `tex/body.png` `thumbs/cover.png` | 打包资源 |

安装：把这 5 个（`figure.json` `figure.js` `model.json` `tex/` `thumbs/`）拷到
`<Coopanion>/build/data/home/companion/data/figures/claude/`，把
`build/data/home/companion/config.json` 的 `worlds.desktop-pet.skin.figure` 改成 `claude`，重启 App。

做这个形象时踩的坑、量到的数字，见 [`../../docs/CASE-claude.md`](../../docs/CASE-claude.md)。
