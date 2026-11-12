# VBB 预览≡导出：时钟域与快切经验

面向后期改编辑器 / 导出 / GIF materialize 的人。实现主路径：

| 模块 | 文件 |
|------|------|
| 片源时间轴 | `tools/lib/mp4-timeline.js` |
| 修剪编辑器 | `tools/lib/vtrim-editor.js` |
| 黑盒面板 / GIF 物化 / 草稿 | `tools/extra-panels/v2g-suite-src/40-vbb.js`（改完跑 `build-v2g-suite.cjs`） |

相关：黑盒体积/帧率策略见 [`vbb-blackbox-optimization.md`](./vbb-blackbox-optimization.md)。

---

## 一句话结论

**预览与导出差帧，根因几乎总是「时钟域」而不是「换一种导出器」。**  
校准可信 → **ffmpeg `frameRaw` 快切**；不可信 → chrome 逐帧（准但慢）。禁止再靠切换导出路径碰运气。

---

## 根因（不要再猜成别的）

1. **Probe CTS ≠ Chrome 显示时钟**  
   `probeMp4VideoTimeline` 的 `ctsSec`（stts/ctts/elst）是容器媒体时钟；Android Chrome 实际显示常整体偏 **X≈15–32ms**（elst 空编辑被当成 0、µs 截断等都会贡献）。
2. **精确 CTS seek 常显示 k−1**  
   `currentTime = cts[k]` 或 `cts[k]+1e-4` 在手机上经常仍停在上一帧。应用 **帧内点** `frameSeekSec`（默认落到帧长约 1/4 处）。
3. **chrome-VideoFrame「成功」不等于 keeps 算对了**  
   成功 diag 与失败 diag 可有**完全相同的 keep / startF / endF**；成功只是因为采帧与预览同在 Chrome 时钟域，偏移被抵消。
4. **校准后 `ctsSec` 已平移到显示域**  
   必须保留 **`mediaCtsSec`** 给 ffmpeg **秒切**；有采样表时 **禁止再回退 `onepass-sec`**（失败 diag 里大量 `ffmpeg-onepass-sec` 即此坑）。

复现锚点片源：`2547.mp4`（Android Chrome）。

---

## 禁止再做的事（历史坑）

1. **在 chrome-VideoFrame ↔ ffmpeg-sec ↔ frameRaw 之间来回拨开关**「当修 bug」——不修时钟，只会震荡。
2. **用 `captureStream` 录预览当导出**——质量差，产品已否决。
3. **校准中点复核去比 `video.currentTime`**——seek 后它≈你刚设的值，复核恒过；必须比 **`VideoFrame.timestamp`**（容差约 ¼ 帧）。
4. **有 `ctsSec` 时 ffmpeg 失败再吃 `sec`/`ss` 兜底**——校准后秒数已不在容器时钟。
5. **GIF materialize 不传 timeline / 不校准 / 与下载用不同 keeps**——下载对齐了 GIF 又偏。
6. **停帧把 `endParkAtSec` 记成 Chrome 帧内偏置点**——播放截断会漂半帧；钉 **成片 CTS**，seek 才用帧内点。
7. **以为「只能对齐预览帧」**——慢的是**每帧 seek**，不是对齐本身；校准过关就该快切。

---

## 正确做法（检查清单）

打开片源 / 导出前：

1. `probeMp4VideoTimeline(file)` → 得到 `ctsSec` + `mediaCtsSec`
2. `calibrateToElement(timeline, videoEl)` → `chromeOffsetSec` / `calibrateMethod`（中点容差 **1 帧**；中点仍抖 → **仍应用 t0**，标 `videoframe-t0-soft`，**不算失败**）
3. 停帧 / 精确 seek：`seekSecForTime` / `frameSeekSec`（勿裸 CTS）
4. keep：`keepRangesFromEdit(edit, duration, timeline)`（半开采样窗）
5. 导出顺序（下载须先 `ensureSourceTimelineForExport` / await `sourceTimelineReady`）：
   - **默认** `canFfmpegFirst`（有 `ctsSec` 且 CTS 近似单调即可；**校准 method 不挡**）→ **`exportKeepVideo` frameRaw**（「快速切片…」）
   - **异常**才 `exportKeepByChromeDisplay`（无表 / CTS 真乱序 / 裁画面 / 快切挂了；toast 须带「异常」；进度「对齐预览帧」——**绝不当默认**）
   - 仍无 → ffmpeg 兜底（无采样表才允许 sec）
6. GIF：`materializeVbbKeepVideo` 与下载**同一套** `matTimeline` + `matKeeps` + `canFfmpegFirst`  
   - **删中间（三者同表）**：
     - 加载后 `ensureVbbSourceTimeline` → `vbbSingleTimeline` / `item.timeline`
     - 取表一律 `resolveVbbTimelineForFile(file, hint)`：**按 file 对齐**，批量禁止串用当前预览条的表
     - 打开编辑：`editor.open({ timeline })` 克隆后校准（勿中途改外预览数组）；完成回写 `__vbbTimeline`
     - 外预览 `enforceVbbEditPlaybackWindow` / 编辑器 `keepRangesLocal` / GIF `matKeeps` 都走 `keepRangesForEncode(..., timeline, file)`
     - `nextStartAfterCutEnd` = `ctsSec[sampleIndexAtSec(cutEnd)+1]`；缺表才退回 `1/fps`（接点会差帧）
7. 诊断 JSON（ver≥6）必含：`calibrateMethod`、`chromeOffsetSec`、`exportOrder`、`exportMethod`、`previewKeeps`

合入前：相关单测 + `build-v2g-suite.cjs` + `bump-version.cjs`。

---

## 快切 vs 预览帧

| 路径 | 速度 | 何时用 |
|------|------|--------|
| ffmpeg `trim=start_frame/end_frame`（frameRaw） | 快（一次滤镜） | **默认**（`canFfmpegFirst`） |
| chrome 逐帧 seek + `VideoFrame` + Encoder | 最慢 | **异常兜底**（无表/乱序/未锚上/裁画面/快切挂） |
| `-c copy` | 最快 | **不考虑**（只能切关键帧） |

以后可演进（未做）：WebCodecs 顺序解码按下标取帧；chrome 兜底改「播放抓帧」少 seek。**先保证时钟与门槛，再谈换编码器。**

---

## 诊断 JSON 怎么读

导出附带 `*-export-diag.json`：

| 字段 | 含义 |
|------|------|
| `exportOrder` | `ffmpeg-first` / `chrome-first` |
| `export.exportMethod` | 期望快切：`ffmpeg-onepass-frameRaw`；慢路径：`chrome-VideoFrame`；**若见 `onepass-sec` 且有 timeline = 回归 bug** |
| `source.calibrateMethod` | 诊断用；有表即应 `exportOrder=ffmpeg-first`；仅无表/乱序/快切挂 → chrome |
| `source.chromeOffsetSec` | 显示相对媒体的 X（秒） |
| `previewKeeps` / `export.keeps` | 比对是否同窗；同 keeps 仍偏画面 → 仍是时钟/seek，不是 keep 公式 |

---

## 编辑草稿恢复（附带坑）

点「完成」后刷新再选同片套不上，常见不是「没保存」，而是**匹配键过严**：

- 重选后 `size` / `lastModified` 常变；Chrome `duration` 可差约 1s
- 正确：`contentSig`（文件头 256KB）→ 名+大小 → 名+放宽时长 → **唯一文件名**
- 「完成」须写指纹并 **回读校验**；失败提示备份编辑（隐私模式/配额）
- 键：`devtools-vbb-edit-drafts-json-v1`；成功出片后故意清该片草稿

实现：`findVbbEditDraftForItem` / `vbbFileContentSig` / `saveVbbEditDraftsSync`（`40-vbb.js`）。

---

## 改代码时要同步动的文件

- 改时间轴 / 校准 / `canFfmpegFirst` → `mp4-timeline.js` + `tools/test/mp4-timeline.test.js`
- 改停帧 / 导出顺序 / diag → `vtrim-editor.js` + `tools/test/vbb-preview-encode-align.test.js`
- 改 GIF 物化 / 草稿 → `40-vbb.js` → **`build-v2g-suite.cjs`** + `vbb-preview-gif-align` / `vbb-edit-draft` 测试
- 功能合入必须 `bump-version.cjs`（北京时间戳）

---

## 会话交接（给下一个 Agent）

1. 先读本文件 + 用户最新 `*-export-diag.json`，**不要**先改导出优先顺序碰运气。  
2. 若 `exportMethod` 已是 frameRaw 仍偏：查 `calibrateMethod`、帧内 seek、demux `firstPresentIdx` / B 帧乱序，而不是再切回「永远 chrome」。  
3. 用户要快：默认 ffmpeg-first；chrome 是**异常兜底**，勿当常态路径。中点抖动用 soft，勿再因 mid-check 丢掉快切。
