# 黑盒 GIF（VBB）实现说明：代码地图 · 不变量 · 禁改清单

给要改黑盒 GIF（编辑器 / 外预览 / 导出 / GIF）的人和 AI。  
**动手前读完 §0 和 §5；改完按 §6 验。** 本文讲「代码怎么实现、哪里不能动、为什么」。

| 关注点 | 文档 |
|--------|------|
| **实现 / 禁改（本文）** | 函数地图、播放窗口、导出时长、Chrome 行为实测 |
| 产品契约 | [`vbb-edit-preview-export-parity.md`](./vbb-edit-preview-export-parity.md)（编辑 ≡ 预览 ≡ 生成） |
| 时钟根因 | [`vbb-preview-export-clock.md`](./vbb-preview-export-clock.md)（CTS vs Chrome、`frameRaw`） |
| 体积 / 试档 | [`vbb-blackbox-optimization.md`](./vbb-blackbox-optimization.md)（与对齐正交） |

---

## 0. 五条铁律

违反任何一条，用户都会看到「编辑 ≠ 预览 ≠ GIF」，或者按钮一点就自己开播。

1. **「一帧」只从采样表取**：`sampleSpanSec` / `exclusiveEndIndexAtSec` / `frameSeekSec`。禁止拿 `1/fps`、`0.5/fps`、`endKeepStepSec()` 当一帧或当片尾容差——`timeline.fps` 是**全片平均**，录屏 VFR 可以低到 6fps，而密集段是 30/60fps。
2. **暂停态永不自己开播**。编辑器只在 `pause` 监听里认 `video.ended` 回绕；外预览 `holding = paused && !vbbLoopFromFileEnd`，`paused && ended` 时 `timeupdate` / `seeked` 绝不回绕/play（播完自停留给 `pause` 监听；暂停拖到末尾只停 keep 末帧）。
3. **播放跨 keep 边界只走 `keepBoundaryHold`**：rVFC 呈现到段末帧 → 立即 pause → 补足这帧剩余显示时长 → seek 下一段首帧帧内 → 等首帧呈现（`armFramePainted`）→ play。禁止「等越界帧呈现了再跳」，也禁止用定时器在上界切断代替停帧。
4. **导出时长 = 真实 CTS 跨度**。有采样表时禁止 `帧数 / 平均fps`（VFR 静帧被截成 1/平均fps，GIF 比预览短）。
5. **交互热路径保持 [#724](https://github.com/Afra55/Afra55.github.io/pull/724) 恢复的基线**：微调不 play、不 `stopPropagation`、pointerdown 不暂停、不加 `parkHoldPause` 一类补丁（§5 第 8 条）。

---

## 1. 数据流

```
选视频 ─► ensureVbbSourceTimeline(item)                                   40-vbb.js
            probeMp4VideoTimeline(file) → { ctsSec, mediaCtsSec, fps, … }  mp4-timeline.js（只读 moov）
            calibrateToElement(video)   → ctsSec 平移到 Chrome 显示时钟
            取 / 存表一律带 file：resolveVbbTimelineForFile / cacheVbbTimelineForFile
点「编辑」► openVbbEditEditor → DevToolsVtrimEditor.open({ file, timeline, initial })
            编辑器里改：黄柄 trimStart/trimEnd、红段 cutouts、裁剪 crop
点「完成」► item.edit = { trimStart, trimEnd, cutouts, crop, srcFps }；__vbbTimeline 回写 item（不进 localStorage）
外预览 ─► 播放时 armVbbEditFrameWatch（rVFC 每帧）
            enforceVbbEditPlaybackWindow → holdVbbEditAtKeepBoundary → scheduleVbbEditEndCut（无表回退）
生成 GIF ► prepareVbbEncodeSource
            keeps = vbbKeepRangesForEncode(edit, duration, timeline, file)   ← 只算一次
            materializeVbbKeepVideo(keeps)
              ├ exportKeepVideo（ffmpeg frameRaw，默认）
              ├ exportKeepByChromeDisplay（兜底：逐帧 VideoFrame + VideoEncoder）
              └ 本地 concat（兜底：逐段 frameRaw 再拼）
            encodeBlackboxClip({ keepAligned, exportedEdit, exactKeepFrames, segmentSpans })  10-shared-encode.js
```

---

## 2. 代码地图

### 2.1 `tools/lib/mp4-timeline.js` → `window.DevToolsMp4Timeline`

| 函数 | 作用 | 要点 |
|------|------|------|
| `probeMp4VideoTimeline(file)` | stts / ctts / elst → 采样表 | 不解码 |
| `buildTimelineFromTrack`（内部） | `ctsSec`（显示域）、`mediaCtsSec`（ffmpeg 域）、`fps` | `ctsSec` 必须 CTS **升序**（B 帧片要排序）；`fps = (n−1)/(末−首)` 是平均值 |
| `calibrateToElement` | 用 VideoFrame / rVFC 把 `ctsSec` 平移到 Chrome 显示时钟 | 已可信校准不再平移（`timelineCalibrationTrusted`） |
| `sampleIndexAtSec(tl, t)` | t 时刻显示的那一帧（≤t 的最后一枚） | 红段闭区间用它 |
| `inclusiveSampleAtSec(tl, a)` | keep 首帧 | 黄柄片头 |
| `exclusiveEndIndexAtSec(tl, b)` | keep 半开上界 `endF`：第 k 帧露出不足半帧（`b − CTS[k] < 0.5·sampleSpanSec(k)`）就不算进来 | **片尾唯一公式** |
| `sampleSpanSec(tl, k)` | 第 k 帧显示时长：本地帧距（末帧用上一间隔），上限 `1/max(5, fps)` | 所有「一帧」的来源 |
| `sampleRangeForKeep(tl, a, b)` | `{ startF, endF }` | = inclusive + exclusiveEnd |
| `frameSeekSec(tl, k, frac = 0.25)` | 第 k 帧帧内 seek 点（CTS + 25% 本地帧长） | 暂停停帧、跳段落点；末采样也用本地帧长 |
| `toDemuxFrameIndex` | 显示序号 → ffmpeg 解码序帧号 | frameRaw 导出 |
| `canFfmpegFirst` | 能否走 ffmpeg 快切 | 见时钟文档 |

### 2.2 `tools/lib/vtrim-editor.js` 模块级 → `window.DevToolsVtrimEditor`（编辑器、外预览、导出共用）

| 函数 | 作用 |
|------|------|
| `keepRangesFromEdit` ≡ `keepRangesForEncode` | edit → `[{ start, end, startF, endF }]`。二者恒等，**禁止分叉** |
| `normalizeCutouts` | 红段裁进窗口、排序、合并 |
| `previewSeekForKeepRanges(keeps, t, { paused, timeline })` | t 在 keep 外时返回应 seek 的时间：暂停 → 最后保留帧帧内；播放 → 下一段首帧帧内 / 回第一段；在 keep 内返回 null |
| `keepBoundaryHold(keeps, tl, mediaTime)` | 呈现到某段末帧 `endF−1` 时返回 `{ seekSec, nextStart, remainSec, loop }`；相邻段、无帧号、无表返回 null |
| `armFramePainted(video)` | seek **之前**调用：挂一次 rVFC；`wait(ms)` 等新帧真呈现再放行（上限 ms） |
| `alignTrimSecToSamples` / `snapExclusiveEndSec` / `contentExclusiveEndSec` / `nudgeKeepEdgeSec` | 手柄吸附采样、片尾半开吸附、内容末端（空尾巴）、片头/片尾 ±1 |
| `exportKeepVideo` | 下载 / materialize：ffmpeg `frameRaw`（`trim=start_frame:end_frame,setpts=PTS-STARTPTS` + `-vsync passthrough`） |
| `exportKeepByChromeDisplay` | 兜底：逐帧 seek → VideoFrame → VideoEncoder，VFR 铺 `gridFps` 网格 |
| `timelineCalibrationTrusted` | 表是否已可信校准 |

### 2.3 编辑器内部（`openEditor` 闭包）

| 函数 | 作用 |
|------|------|
| `keepRangesLocal` | ≡ `keepRangesForEncode(当前编辑, sourceTimeline)` |
| `nudgeTrimEdgeSec` → `nudgeKeepEdgeSec` | 片头 / 片尾 ±1 采样 |
| `nudgeSelectedCutout` / `nudgeEncodeSec` | 红柄 ±1 采样 |
| `setStart` / `setEnd` | 改柄；按钮与松手走 `seekStartPreviewExact` / `seekEndPreviewExact`，拖动中节流 `previewSeek` |
| `encodeParkSecForEdge` | 停帧目标 = 成片首帧 / 末帧 CTS |
| `seekEndPreviewExact` / `seekStartPreviewExact` | 停到帧内点；`endParkAtSec` 记 CTS |
| `bindNudgeHold` / `snapNudgeToShown` | 按钮：pointerdown 立即 `fire()`，280ms 后每 70ms 连发；松手停帧 |
| `onTimelinePointerDown/Move/Up` / `finishTrimDrag` / `snapTrimHandle` | 拖柄 |
| `togglePlay` / `armFrameWatch` / `clipPlayWindow` / `holdAtKeepBoundary` / `cancelBoundaryHold` | 播放窗口（§3.5） |
| `tightenTrimToContentTimeline` | 打开即把片尾收到视频轨末（容器空尾巴） |
| `detectAndApplySourceTimeline` / `calibrateSourceTimelineToEditorVideo` / `rematchHandlesAfterCalibrate` | 取表、校准、校准后重吸附手柄 |
| `downloadEditedVideo` | 下载编辑视频（与 GIF 同一 keeps、同一导出顺序） |

### 2.4 面板 `tools/extra-panels/v2g-suite-src/40-vbb.js`

改完必须 `node tools/scripts/build-v2g-suite.cjs`（生成 `v2g-suite.js`）。

| 函数 | 作用 |
|------|------|
| `ensureVbbSourceTimeline` / `resolveVbbTimelineForFile` / `cacheVbbTimelineForFile` | 取表 / 存表（**必须**带 file，批量才不串表） |
| `vbbKeepRangesForEncode` / `vbbPreviewSeekForKeepRanges` | 委托 2.2 的同名实现（编辑器未加载时才走回退） |
| `enforceVbbEditPlaybackWindow` | 外预览：timeupdate / seeked / rVFC 时检查是否在 keep 外 |
| `vbbEditSeekKeepTarget` | 外预览换点：先停再 seek，落稳（+ 首帧呈现）再播；关键帧偏早补推一次 |
| `holdVbbEditAtKeepBoundary` / `cancelVbbEditHold` | 外预览段末停帧（≡ 编辑器） |
| `scheduleVbbEditEndCut` | 无采样表回退：按时间预约在末帧上界切 |
| `armVbbEditFrameWatch` | rVFC 循环：enforce → hold → endCut |
| `applyVbbSeek` / `lockVbbPlayUi` / `pauseVbbPreview` | 程序 seek；锁按钮文案；暂停（会取消停帧） |
| `prepareVbbEncodeSource` / `materializeVbbKeepVideo` / `vbbMaterializedKeepDuration` | 生成前 materialize 编辑片；校验报告时长 |
| `saveVbbEditDraftsSync` / `restoreVbbEditDrafts` … | edit 草稿持久化（不含 timeline） |

### 2.5 GIF：`tools/extra-panels/v2g-suite-src/10-shared-encode.js`

`encodeBlackboxClip` → `encodeBlackboxClipCore`；`vbbKeepFrameEncodeOpts` 透传 `keepAligned / exportedEdit / exactKeepFrames / segmentSpans`，中途禁止丢（parity 文档 §6）。

---

## 3. 不变量：规则 → 实现 → 守护测试

### 3.1 采样表

- `ctsSec` 升序、与 `file` 绑定；编辑器克隆、外预览、materialize 用同一张表。
- `timeline.fps` 是全片平均，只配当 `sampleSpanSec` 的上限。真机录屏：开头静 4s、中间静 8s 很常见。
- 测试：`mp4-timeline`、`vbb-preview-gif-align`；夹具要按真机口径算平均 fps（`vbb-trim-nudge-jump` 的 `withAvgFps`），别写死 30。

### 3.2 keep 窗

- 黄柄半开 `[trimStart, trimEnd)`：`startF = inclusiveSampleAtSec(a)`，`endF = exclusiveEndIndexAtSec(b)`。
- 红段闭区间：上一段止于 `cut.start`；下一段从 `ctsSec[sampleIndexAtSec(cut.end) + 1]` 起。
- 编辑器、外预览、materialize、下载**全部**走 `keepRangesForEncode`；生成 GIF 时 keeps 只算一次。
- 判在不在 keep 里：`previewSeekForKeepRanges` 按秒（`start/end`），停帧 / 导出按帧号（`startF/endF`）。手柄都吸在采样 CTS 上，二者一致；别引入「不吸附的手柄」。
- 测试：`vbb-preview-encode-align`、`vbb-trim-cutouts-speed`、`vbb-yellow-end-trim`。

### 3.3 手柄与 ±1

- 片头± / 片尾±：`nudgeKeepEdgeSec` 每次换一个相邻真实采样（`startF±1` / `endF±1`）；静帧也照跳（跨度 ≥0.5s 弹 toast）。
- 片尾已含最后一枚采样时「+」返回原值（不动）；「−」退到 `n−1`。
- `snapExclusiveEndSec`、`contentExclusiveEndSec` 与 `exclusiveEndIndexAtSec` 用**同一个**半帧规则 + `sampleSpanSec`；改一个就得三个一起改。
- 测试：`vbb-trim-nudge-jump`（CFR、稀疏 VFR、低平均 fps VFR 的 ±1；末帧停帧）。

### 3.4 暂停停帧

- 停帧点 = 帧内 25%（`frameSeekSec`），不贴裸 CTS（安卓会先闪上一帧）。
- `endParkAtSec` 记成片末帧 **CTS**，不记 Chrome 帧内偏置点。
- 末采样的帧内点用本地帧长；用 `1/平均fps` 会越过 duration，被 Chrome 夹成 ended。
- 外预览暂停越过停帧的容差 `pastSlop = max(0.012, 0.35·sampleSpanSec(停帧那帧))`，保证不出这一帧。

### 3.5 播放窗口（最容易被改坏）

**编辑器**（`armFrameWatch`，每个呈现帧按顺序）：

1. `clipPlayWindow(mt)`：暂停态直接 return（只有 `loopFromFileEnd` 放行）；越过半开上界 → 回 `startSec`；落进删段 → `previewSeekForKeepRanges`。
2. `holdAtKeepBoundary(mt, meta)`：呈现到段末帧 → 立即 pause → 等 `remainSec / rate − (now − meta.expectedDisplayTime)` → `armFramePainted` → `seekPlayheadExact`（下一段或片头）→ 等首帧（≤120ms）→ play。
   - 停帧期间 `boundaryHold` 非空：按钮仍显示「暂停」，点一下 = 取消停帧（`togglePlay`）；任何 `seeking`、关闭编辑器都会取消；`pause` 监听见到 `boundaryHold` 不刷按钮。
3. 无采样表回退：`parkCutTimer` 按时间预约在上界切。
4. `pause` 监听：`video.ended` 才置 `loopFromFileEnd` 调 `clipPlayWindow` 回绕。

**外预览**（`armVbbEditFrameWatch`，同顺序）：

1. `enforceVbbEditPlaybackWindow(mt)`：`holding = paused && !vbbLoopFromFileEnd`；`paused && ended` 先拦住：
   - `vbbMediaPlaying`（`play` 事件置 true，`pause` 监听收尾 / `emptied` 置 false）仍为 true = 播完自停、`pause` 事件还没到 → 不动，交给 `pause` 监听回绕。
   - 否则是暂停时拖到末尾（外预览有原生进度条）→ 按暂停态停 keep 末帧；末帧已在 keep 里就不动（防 seek↔ended 打转）。
   - 不要改成靠 `ended` 事件：暂停 seek 到末尾 Chrome 有时派、有时不派（实测 0 次 / 2 次都有）。
2. `holdVbbEditAtKeepBoundary(mt, meta)`：同编辑器；停帧期间 `vbbEditSkipBusy = true` 让 enforce 让路；`pauseVbbPreview`、`seeking`、手动 `play`、换片都会 `cancelVbbEditHold`。
3. `scheduleVbbEditEndCut`：无表回退。
4. `pause` 监听：`ended` → `vbbLoopFromFileEnd` 回绕，然后清 `vbbMediaPlaying`；两件事都放在按钮锁判断**之前**。

测试：`vbb-keep-boundary-hold`、`vbb-end-play-align`、`vbb-preview-play-toggle`、`vbb-trim-nudge-jump`（源码守卫 `loopFromFileEnd`）。

### 3.6 导出 / GIF

- materialize 默认 `exportKeepVideo` frameRaw：帧号来自 keeps 的 `startF/endF`（经 `toDemuxFrameIndex`），`-vsync passthrough` 保 VFR 时间戳。
- `segmentSpans` / `duration` = 真实 CTS 跨度（`b.dur`）。只有**无表**的 frameGrid 才用 `帧数 / keepFps`。
- `vbbMaterializedKeepDuration`：接受上报 `rep` 当 `keep − shortTol ≤ rep ≤ keep + 0.05`（`shortTol = max(0.25, keep×0.02)`）；上报明显偏短（旧「帧数÷平均 fps」）→ 用 keep，避免 GIF 窗截掉后几段。`finishMat` 打 `[vbb-mat] 方法 上报Xs · keep Ys → 用Zs · N段`。
- Chrome 兜底：raw H.264 只认 `-r`，VFR 按每个源帧真实时长铺到 `gridFps` 网格（本地帧率 > 平均 ×1.15 时取本地帧率，60 封顶）；静帧重复，比网格密的帧跳过；编码器 `prefer-hardware` 不通再 `no-preference`。
- 本地 concat 兜底：有表时 `tryPart(..., sampleFrames)` 用 keep 帧号 frameRaw，不按时间换帧号。
- GIF：`exportedEdit` → 片尾垫 0、exact 帧、不建段租约（parity 文档 §6）。
- **gifski 分块抽 RGBA**（`10-shared-encode.js` `buildRawArgs` / `encodeChunk`）：
  1. 每块都先出**整窗** fps 网格（多段走 `vbbEncodeSegmentedFpsFilter`，与一次性整段同一前缀）。
  2. 再按**全局帧号** `trim=start_frame=A:end_frame=A+N` 取本块。
  3. **禁止**块头按时间 `trim=start=块起点`：块起点前开始、仍在显示的那一帧会被整帧丢掉（VFR 静帧一丢几秒；手机长片≥18s 强压 ×72 时，删中间后 GIF 比预览短且后段提前）。
  4. demux `-t` 必须盖 **`encodeSs + encodeT` 整窗尾**（不能只盖到块尾：后块 `start_frame` 超出已解帧 → 出帧不足 → gifski 回退 ffmpeg；diag `125947` 块4=23帧）。
  5. **已导出编辑片 / exactKeepFrames / speedBaked：禁止 `wantSeg` 再抽**。大文件+倍速会走 accurate libx264 重编码，打乱 `segmentSpans` 依赖的 VFR 时间戳 → 多段删中间后 GIF≠预览（与租约「导出片不建」同理）。
  6. **逐块 delay 必须对准目标秒数**（`forceAlignSpan`）：无倍速 → `n/fps`；压缩时长 → 本块占 `effSpan` 的份额。禁止放行 `round(100/fps)=70ms` 均匀 delay（相对 66.7ms 系统性 +5%，旧 10% 容差会放过 → 成片偏长、同时刻和预览错位）。容差 ≤2%。
  7. **已导出编辑片禁止静止帧合并**：合并后的长 delay 经 gifski 末帧 PTS quirk与分块拼接，会在块界把静帧拖长，GIF 总时长 > keep、和预览错位。
  8. **已导出编辑片禁止再按 `segmentSpans` 分段采样**（`useSegmented` / `useSegmentedSk`）：mat 已是线性 keep，concat 接点有漂移；再按理想 span 切 → 后块 RGBA 不足、回退 ffmpeg，删中间像没生效（diag `162829` 9 段 + 倍速）。改走整窗全局 `fps`。
- 测试：`vbb-keep-boundary-hold`（导出段）、`vbb-gif-chunk-frames`（分块按帧号 / `-t` 整窗 / 导出片禁 wantSeg）、`vbb-trim-cutouts-speed`（物化短上报）、`vbb-preview-gif-align`、`vbb-precut-trim`、`vbb-blackbox-fps`。

### 3.7 交互热路径

- 按钮 `bindNudgeHold`：不用 `setPointerCapture`（部分安卓会立刻 lostpointercapture，短按像没点到）；`click` 只 `preventDefault`。
- 拖柄：拖动中 `previewSeek` 节流（`DRAG_SEEK_MS = 72`），松手 `finishTrimDrag` 精确停帧。
- 打开编辑器：`ensureVbbVtrimEditor` 不按 BUILD 删模块重载（加载器去重时编辑器会打不开）。
- 测试：`vbb-trim-nudge-jump`「交互热路径保持 145922」、`vbb-editor-mobile`、`vbb-editor-ux`。

---

## 4. Chrome 播放行为（实测；改播放逻辑前必读）

| 现象 | 对策 |
|------|------|
| 播到文件尾：先置 `paused = true`、`ended = true`，再派 `timeupdate`，然后 `pause`、`ended` | 回绕只放 `pause` 监听里；`timeupdate` 见 `paused && ended` 不动 |
| 暂停态 seek 到末尾（含 seek 进无音轨片最后一帧）：`ended = true`、`currentTime` 被报成 duration；**不派 `pause`**，`ended` 事件时有时无 | 不能据 `ended` 续播；用 `vbbMediaPlaying` 区分「播完自停」；停 keep 末帧要防 seek↔ended 打转 |
| rVFC `mediaTime` 常比 CTS 小几 µs | 认帧号加 1/4 帧（`keepBoundaryHold`） |
| `currentTime` 滞后于已呈现帧 | 截断跟 `max(clock, presented)` |
| `seeked` 后立刻 `play()`，新位置首帧常被当迟到帧丢掉 | `armFramePainted`：seek 前挂 rVFC，首帧呈现（≤120ms）再 play |
| 预约定时器赛不过 rVFC 回调延迟 | 段末用停帧（pause），不用「算好时间再切」 |
| 数秒长的静帧后紧跟密集帧，渲染器会丢掉开头几帧（软解 / 低端机更明显） | 浏览器行为，GIF 不受影响；验收看「无 keep 外帧 + 接点首帧在」 |
| 暂停时 seek 到裸 CTS，安卓先闪上一帧 | 停帧一律帧内 25% |
| 无硬编的桌面 / 虚拟机：`VideoEncoder` 只支持 `no-preference` 软编 | Chrome 兜底两档都试 |

---

## 5. 禁止清单（每条都踩过）

1. 用 `1/fps`、`0.5/fps`、`endKeepStepSec()` 判断「一帧」、片尾容差或停帧容差（VFR 低平均 fps 下片尾+ 会倒退、一次跳几帧、暂停停在 keep 外）。
2. 在 `timeupdate` / `seeked` / `ended` 里因为 `paused && ended` 就回绕或 play（片尾+ 到末帧、暂停拖到末尾会自己从头播）；或靠 `ended` 事件分辨「暂停拖到末尾」（Chrome 时派时不派，停帧会漏，画面停在 keep 外）——用 `vbbMediaPlaying`。
3. 等越界帧呈现了再 seek，或用定时器在上界切断代替停帧（接点 / 回绕多闪一帧 GIF 里没有的画面）。
4. `seeked` 后立刻 play 不等首帧（接点少一帧）。
5. 有采样表时导出时长用 `(endF − startF) / keepFps`（VFR 静帧被截断）。
6. Chrome 兜底按 `-r keepFps` 封装 VFR 不铺网格（节奏 ≠ 预览），或只试 `prefer-hardware`。
7. 本地 concat 有表时按时间 `toFrame()` 换帧号。
8. 交互补丁：`parkHoldPause`、在 seek helper 里 bump `playWindowGen`、`stopPropagation`、pointerdown 时暂停、`forcePreviewFrame` / `kickPreviewPaint` / `spuriousPointerCancel` / `commitCoarseRelease`、window 捕获 pointermove、按 BUILD 删模块重载（d26ab253 那一轮把编辑器整个改死，#724 才恢复）。
9. 分叉 keep 公式（预览一套、导出一套），或 GIF 另算 keeps / 另 probe 表 / 批量漏 `file`。
10. 差帧时拨导出路径（chrome ↔ ffmpeg-sec ↔ frameRaw）碰运气，或动撞档 / fps 阶梯（与对齐正交）。
11. gifski 分块块头按时间 `trim=start=`，或「仅首块走分段采样、后续块用全局窗」（VFR 静帧在块界丢失；手机 ×72 强压必现）。
12. 分块 demux `-t` 只盖到块尾（帧号取块时后块出帧不足，回退 ffmpeg）。
13. 已导出编辑片仍 `wantSeg` + 倍速 accurate 重编码（打乱多段 VFR；日志连着「抽片段」+「gifski 回退 ffmpeg」时先查这条）。

---

## 6. 测试与验证

### 6.1 单元 / 源码守卫（CI 自动跑）

`node tools/scripts/ci.cjs` 自动纳入 `tools/test/vbb-*.test.js` 和 `mp4-timeline.test.js`；新测试按这个命名就会进 CI。

| 测试 | 守什么 |
|------|--------|
| `vbb-trim-nudge-jump` | ±1 = 相邻采样（CFR / VFR / 低平均 fps）、末帧停帧、暂停不续播、交互热路径 |
| `vbb-keep-boundary-hold` | 段末停帧、首帧呈现再播、文件尾暂停不续播、暂停容差、导出真实跨度、Chrome 网格、concat 帧号 |
| `vbb-end-play-align` | 片尾停 / 播、外预览 pastSlop |
| `vbb-preview-encode-align` / `vbb-preview-gif-align` | 同表同 keep、materialize、onepass 仅 frameRaw |
| `vbb-gif-chunk-frames` | 分块 = 整窗网格 + 帧号取块；`-t` 整窗；导出片禁 wantSeg；物化打 `[vbb-mat]` |
| `vbb-trim-cutouts-speed` | 物化短上报 → keep；删中间后倍速按 keep 总和 |
| `mp4-timeline` | 采样表、`exclusiveEndIndexAtSec` / `sampleSpanSec`、校准 |

改 `40-vbb.js` 后：`node tools/scripts/build-v2g-suite.cjs` + `node tools/scripts/verify-arch.cjs`；功能改动 `node tools/bump-version.cjs`。

### 6.2 浏览器逐帧验收（改播放 / 导出必须做）

单元测试测不到 Chrome 的事件时序，播放逻辑必须在真浏览器里逐帧核对。

1. 造带「帧号条码」的测试片：每帧顶部一条画 11 个色块编码帧号（bit k 在 `x = k·64 + 36, y = 36`，按 720 宽缩放；绿色通道 > 100 为 1）。三类片：
   - CFR 30fps + B 帧 + 长 GOP + 音轨比视频长（容器空尾巴）
   - VFR：开头一帧静 4s，之后 30fps
   - VFR 无音轨：平均约 6fps，中间一帧静 8s
2. puppeteer（安卓 UA、393×851、触摸）打开 `#vbb`，rVFC + canvas 读条码，记录每个呈现帧。
3. 场景：片头± / 片尾± 到两端（末帧再点 +）、拖黄柄、加红段、编辑器内播放、完成后外预览播放、外预览暂停拖到末尾、生成 GIF。
4. 判定：
   - 编辑器 / 外预览：**没有 keep 外的帧**；接点 = 上一段末帧 → 下一段首帧；回绕 = 末帧 → 首帧；暂停后不出现 `play` 事件。
   - GIF：首帧 = 编辑器片头停帧，末帧 = 片尾停帧，帧数 / 总时长 = keep。
   - 长静帧后偶发丢一两帧属 §4 浏览器行为，不算失败；keep 外帧一律算失败。

---

## 7. 排障速查

| 症状 | 先查 |
|------|------|
| 片尾+ 倒退 / 一次跳几帧 | §3.3：哪里又用了 `1/fps` |
| 点 ± / 到末帧 / 拖到末尾后自己开播 | §3.5：暂停态是否回绕；`loopFromFileEnd` / `vbbLoopFromFileEnd` / `vbbMediaPlaying` |
| 接点 / 回绕闪一帧 | §3.5：`keepBoundaryHold` 是否还接在 rVFC 循环里；`expectedDisplayTime` 迟到是否扣了 |
| 接点少一帧 | `armFramePainted` 是否在 seek **之前**挂上 |
| GIF 比预览短（VFR） | §3.6：`spanSec` 是否按帧数 / 平均 fps；`vbbMaterializedKeepDuration` 是否放过偏短上报 |
| GIF 删中间后比预览短 / 后段提前（手机分块） | §3.6 分块：是否又用块头 `trim=start=`；看日志块帧数是否满（旧 bug 第 5 块 56≠72） |
| gifski「导出的 RGBA 帧不足」回退 ffmpeg，且 GIF≠预览 | §3.6：`-t` 是否整窗；导出片是否又 `抽片段`（禁止 wantSeg） |
| GIF 总时长略长、同时刻画面比预览「慢半拍」 | §3.6.6：delay 是否对准 `n/fps`；容差是否又放宽到 10% |
| 删中间像没生效 / gifski「RGBA 帧不足」反复回退 ffmpeg（已物化多段） | §3.6.8：导出片是否又按 `segmentSpans` 切；应走全局 fps |
| GIF 首尾偏一帧 | parity 文档 §11、时钟文档 |
| 按钮 / 拖柄没反应 | §3.7 + §5 第 8 条；对照 #724 |
