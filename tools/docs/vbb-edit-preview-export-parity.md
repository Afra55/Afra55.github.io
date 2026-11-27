# VBB 编辑 ≡ 预览 ≡ 生成 GIF：三者统一

面向改黑盒编辑器 / 外预览 / GIF 导出的人。  
**目标**：黄柄·红柄所见帧 = 外预览播放/停帧 = 成片 GIF 首尾与删中间接点。

| 层次 | 文档 |
|------|------|
| **产品契约（本文）** | keep 窗、共享时间轴、materialize、encode 开关 |
| **时钟根因** | [`vbb-preview-export-clock.md`](./vbb-preview-export-clock.md)（CTS vs Chrome、`frameRaw`、禁止拨开关） |
| **体积 / 帧率试档** | [`vbb-blackbox-optimization.md`](./vbb-blackbox-optimization.md)（与 keep 对齐**正交**） |

实现主路径：

| 模块 | 文件 |
|------|------|
| 片源时间轴 / `canFfmpegFirst` | `tools/lib/mp4-timeline.js` |
| keep / 停帧 / 下载导出 | `tools/lib/vtrim-editor.js` |
| 面板：取表 / materialize / 外预览 / prepare | `tools/extra-panels/v2g-suite-src/40-vbb.js`（改完 `build-v2g-suite.cjs`） |
| GIF 编码 flags | `tools/extra-panels/v2g-suite-src/10-shared-encode.js` |

---

## 一句话结论

三者统一靠三样东西叠在一起：

1. **同一份按 `file` 对齐的采样表**（`ctsSec` / `mediaCtsSec`）  
2. **同一套半开 keep 窗**（`keepRangesForEncode` / `vbbKeepRangesForEncode`）  
3. **有时间编辑时先 materialize 编辑片，再带 `exportedEdit` / `exactKeepFrames` 转 GIF**

差帧先查时钟域与 keeps 是否同窗，**不要**改黑盒试档阶梯「碰运气」。  
撞档库（IndexedDB）只沿用试档起点（fps；手机可再试一次夹紧后的缓存宽），**不**改 keep / materialize / 对齐开关。

---

## 1. 统一物 vs 不统一物

| 必须三者一致 | 可以各走各的 |
|--------------|--------------|
| 采样表（同 file） | GIF 试宽 / 试画质 / 压缩轮次 |
| 半开 keep 窗（trim + cutouts） | 撞档沿用的起始 fps |
| 快切门槛 `canFfmpegFirst` → `frameRaw` | 画质优先开关对阶梯的影响 |
| materialize 后 `startSec=0` + exact 帧 | 10MB 体积硬闸策略 |

---

## 2. 时钟域（摘要 · 细节见时钟文档）

- Probe **CTS** ≠ Chrome **显示时钟** → 必须 `calibrateToElement`；校准后 `ctsSec` 可平移到显示域。  
- **ffmpeg 秒切**用 `mediaCtsSec`；有采样表时 **禁止** onepass 回退 `sec`/`ss`。  
- 默认导出：**`canFfmpegFirst` → `exportKeepVideo` / `frameRaw`**；chrome 逐帧仅异常兜底。  
- 差帧不要在 chrome ↔ ffmpeg-sec ↔ frameRaw 之间拨开关。

---

## 3. 共享时间轴归属

```
加载片源
  → ensureVbbSourceTimeline → item.timeline / vbbSingleTimeline
取表（任何路径）
  → resolveVbbTimelineForFile(file, hint)
     hint → 同 file 的批量项 → 单文件缓存
     ※ 漏传 file 时禁止借用「当前预览条」的表
打开编辑器
  → editor.open({ timeline }) 克隆 cts
     已可信校准（videoframe-t0 / soft / already-aligned）→ 不再平移
     未校准 → 在克隆上锚，避免完成回写把外预览带漂
点「完成」
  → __vbbTimeline 回写 item（不进 localStorage / JSON 备份）
GIF / 下载
  → 同一 matTimeline + 只算一次 matKeeps
```

可信校准判定：`timelineCalibrationTrusted`（`vtrim-editor.js`）。

---

## 4. Edit → materialize → GIF

```
edit 有时间编辑？（vbbEditNeedsExport）
  → prepareVbbEncodeSource
       keeps = vbbKeepRangesForEncode(edit, duration, fileTl, file)  // 只算一次
       materializeVbbKeepVideo(..., keeps, matTimeline)
         canFfmpegFirst → exportKeepVideo(frameRaw)
         异常 → exportKeepByChromeDisplay
         有表兜底模式：frameRaw / frameGrid；无表才 sec/ss
       成功 → file=编辑片, startSec=0, exportedEdit=true, segmentSpans
  → encodeBlackboxClip({
       keepAligned: true,
       exportedEdit,
       exactKeepFrames: exportedEdit || startSec≈0,
       segmentSpans, …
     })
```

打点窗（`fromMark`）同样走校准 + frameRaw 合成单段 keep，失败再回退秒切。

下载「导出编辑视频」与 GIF **同一套** `previewKeeps` + `canFfmpegFirst` 顺序，避免「下载对齐了 GIF 又偏」。

---

## 5. 预览停帧 / 播放 vs 导出选帧

### 编辑器内

- `keepRangesLocal()` ≡ `keepRangesForEncode(..., sourceTimeline)`  
- 停帧目标：`encodeParkSecForEdge` → 采样 **CTS**  
- seek：`seekSecForTime` / `frameSeekSec`（帧内点，勿裸 CTS）  
- `endParkAtSec` 钉 **成片 CTS**，禁止记 Chrome 帧内偏置点（否则播放截断漂半帧）

### 外预览

- `enforceVbbEditPlaybackWindow` → `vbbKeepRangesForEncode` + `previewSeekForKeepRanges`  
- 与成片同一 keep，接点才不会少跳/多带帧  
- rVFC `mediaTime` 对冲 `currentTime` 滞后

### 导出选帧

- `startF` / `endF` 来自 `sampleRangeForKeep`（半开窗）  
- 与预览同一公式，**不是**另一套 keep

---

## 6. 编码开关（保对齐 · 勿丢）

经 `vbbKeepFrameEncodeOpts` 透传给 O3 加宽 / 硬闸重编 / 核心编码，**禁止**中途丢掉：

| Flag | 作用 |
|------|------|
| `keepAligned: true` | 已按预览 keep 对齐 |
| `exportedEdit` | 已 materialize：片尾垫=0；ceil 精确帧；不再 duration 硬切；**不建**段租约 |
| `exactKeepFrames` | 同 exact 路径；或 `startSec≈0` 时开启 |

未 materialize 的「整段从 0 起」也会开 `exactKeepFrames`，避免二次 trim 吃掉尾帧。

---

## 7. 删中间（cutouts）特规

- 红柄 **闭区间**删：上一段止于 `cut.start`；下一段从 **下一源采样**起  
- `nextStartAfterCutEnd` = `ctsSec[sampleIndexAtSec(cutEnd)+1]`；缺表才退 `1/fps`（接点会差帧）  
- 红柄吸附 / rematch / 拖松手：`snapTrimHandle("cut-start"|"cut-end")` 走默认 `sampleIndexAtSec`；**禁止**复用黄柄 `inclusive`（片头缝）或 `exclusive`（片尾半开）  
- 红柄 ±1 步进：`nudgeEncodeSec` + `maxStep` 护栏（坏表/超长静帧勿一次跳数秒）  
- 手柄已在采样 CTS 上：`alignTrimSecToSamples` **保留全精度**；毫秒取整会让 `sampleIndexAtSec` 退上一帧  
- `matKeeps` 只算一次；多段 `segmentSpans` 供按段信息  
- 批量：取表/回写必须带 `file`；有 cutouts 时 materialize **串行**（防第二路僵死）

---

## 8. 撞档库与对齐正交（勿混改）

| 撞档（scheme） | 对齐（本文） |
|----------------|--------------|
| 键：时长 + 分辨率 + 源帧率（VER≥3） | keep / timeline / frameRaw |
| 命中后可按画质微调 **一档 fps** | materialize / exportedEdit |
| IndexedDB `devtools-vbb-scheme` | 不读写撞档 |
| 只影响试档起点（fps；手机可再试一枪夹紧的缓存宽，超了退回 420） | 超限仍走完整阶梯 |

改撞档：**只** bump `VBB_FEATURE_SCHEME_VER`；**禁止**顺手改 `exportedEdit` / `canFfmpegFirst` / keep 公式。  
改对齐：**禁止**顺手改 fps 阶梯或撞档键。

---

## 9. Agent / 后人禁止事项

1. 用拨导出路径代替修时钟  
2. 有 `ctsSec` 时让 onepass 吃 `sec`/`ss`  
3. GIF materialize 另算 keeps / 另 probe 第二张表 / 批量漏 `file`  
4. 对已 `timelineCalibrationTrusted` 的表在编辑器再平移  
5. `exportedEdit` 路径再叠尾垫、二次 duration trim、建段租约  
6. 分叉 `keepRangesForEncode` 与 `keepRangesFromEdit`（当前应恒等）  
7. `endParkAtSec` 记 Chrome 帧内偏置点  
8. `captureStream` 录预览当导出  
9. 以为「撞档/IDB」会影响 keep 窗——不会；差帧仍查时钟与 keeps

---

## 10. 相关测试（合入前）

```bash
node tools/test/vbb-preview-encode-align.test.js
node tools/test/vbb-preview-gif-align.test.js
node tools/test/vbb-precut-trim.test.js
node tools/test/vbb-end-play-align.test.js
node tools/test/mp4-timeline.test.js
node tools/vbb-blackbox-fps.test.js   # 含 exportedEdit 禁 lease + 阶梯硬约束
node tools/scripts/build-v2g-suite.cjs
node tools/bump-version.cjs           # 功能改动必做
```

| 测试 | 覆盖 |
|------|------|
| `vbb-preview-encode-align` | 同表、enforce、materialize、onepass 仅 frameRaw、prepare |
| `vbb-preview-gif-align` | exportedEdit 垫=0、matKeeps、resolve by file、open timeline |
| `vbb-precut-trim` | prepare 透传 flags；lease 禁建 |
| `vbb-end-play-align` | 片尾停/播 |
| `mp4-timeline` | `canFfmpegFirst` / 校准 |
| `vbb-blackbox-fps` | 阶梯硬约束 + exportedEdit 与 scheme VER 并列断言 |

---

## 11. 排障顺序（差帧时）

1. 读用户 `*-export-diag.json` / 面板「导出诊断」：`calibrateMethod`、`exportMethod`、`previewKeeps` vs `export.keeps`  
2. `exportMethod` 已是 `ffmpeg-onepass-frameRaw` 仍偏 → 查校准、帧内 seek、B 帧 / `firstPresentIdx`，**不是**再切回永远 chrome  
3. keeps 不一致 → 查是否漏 `file`、是否另算 keep、手柄是否被毫秒取整  
4. keeps 一致仍偏 → 回时钟文档，查时钟域  
5. **不要**先动 `encodeBlackboxClipCore` 试档阶梯

---

## 会话交接

1. 先读本文 + [`vbb-preview-export-clock.md`](./vbb-preview-export-clock.md) + 最新诊断 JSON。  
2. 改 keep/timeline → 同步两套 align 测试 + `build-v2g-suite.cjs` + bump。  
3. 改撞档 → 只动 scheme 块与 VER；对齐路径零改动。  
4. 用户要「快」：默认 ffmpeg-first；chrome 是异常兜底，勿当常态。
