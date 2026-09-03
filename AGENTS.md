# AGENTS.md — Cursor / Cloud Agent 说明

面向在本仓库工作的 AI Agent。人类用户说明见 `tools/README.md`。

## 项目是什么

- 仓库：`Afra55/Afra55.github.io`（GitHub Pages）
- 主产品：`tools/` 下的 **DevTools 纯前端工具站**（[在线](https://afra55.github.io/tools/)）
- 原则：数据尽量在浏览器本地处理；需要系统能力时走 **本机桥**（Node 服务），不把文件上传到第三方

## 目录速查

| 路径 | 用途 |
|------|------|
| `tools/index.html` | 工具站入口 |
| `tools/app.js` | 核心面板逻辑（含 JSON 等内置工具） |
| `tools/registry/tools.json` | 工具分组 / 名称 / 描述（编辑源） |
| `tools/lib/tool-registry.js` | 由 registry 生成的运行时注册表 |
| `tools/lib/lazy-scripts.js` | 按工具按需加载脚本与 vendor |
| `tools/lib/tools-build.js` | `TOOLS_BUILD` / `TOOLS_VERSION` |
| `tools/bump-version.cjs` | 递增版本并同步 `?v=` 缓存戳 |
| `tools/panels/*.html` | 各工具面板 HTML |
| `tools/extra-panels/*.js` | 额外面板逻辑 |
| `tools/vendor/` | 浏览器第三方库（js-yaml、jsonrepair、ffmpeg.wasm 等） |
| `tools/lib/oss-deps.js` | 关于页 OSS 依赖清单（升级 vendor 后必须同步） |
| `tools/adb-bridge/` | ADB / Everything 本机桥（默认端口 `17888`） |
| `tools/ffmpeg-bridge/` | FFmpeg / yt-dlp 本机桥（默认端口 `17889`） |
| `tools/theme.js` / `tools/lib/theme-presets.js` | 主题 |

## 新增 / 改工具时

1. 改 `tools/registry/tools.json`（groups、meta、about 描述）
2. 运行：`node tools/scripts/build-tool-registry.cjs`
3. 校验：`node tools/scripts/verify-registry.cjs`
4. 面板：`tools/panels/<id>.html`；逻辑放 `tools/app.js`（核心）或 `tools/extra-panels/<id>.js` / 独立 `tools/<id>.js`
5. 在 `tools/lib/lazy-scripts.js` 注册 `TOOL_FILES` / `TOOL_VENDORS`（若需要）
6. 引入第三方库：放入 `tools/vendor/`，登记 `lazy-scripts.js` + `oss-deps.js`
7. **合入前**运行：`node tools/bump-version.cjs`（北京时间戳）

## 本机桥约定

- ADB 桥：`http://127.0.0.1:17888`，Token 常见为 `devtools-bridge` / `devtools-adb`（以面板提示为准）
- Everything：网页经 ADB 桥代理访问本机 Everything HTTP Server（勿假定浏览器可直连跨源）
- FFmpeg 桥：`http://127.0.0.1:17889`
- 改桥逻辑时同步 ZIP/启动脚本所需文件列表与 `BRIDGE_VERSION`（若有）
- bat/sh 缓存与生成文件应落在 **脚本同目录**，不要写死用户主目录 C 盘路径

## Git / 合入习惯（强制）

- **所有修改默认自动合入 `master`**：改完 → commit → `git push origin master`（或特性分支立刻 squash/merge 进 master）
- **合入后必须删除本次特性分支**（远程 + 本地），避免 `cursor/*` 堆积冗余；仓库远程尽量只保留 `master`
- 若环境强制先开 `cursor/<name>-xxxx` 分支 / PR：合入 master 后**同一回合内**删分支；不要留着「已合入的僵尸分支」
- 已合入或过时、无用的分支：主动 `git push origin --delete …` 清理
- 提交信息用中文或英文均可，需说清「改了什么 / 为什么」
- 功能合入后必须 bump `TOOLS_BUILD`，否则用户硬刷新也可能看到旧缓存
- **不要做最后验收截图 / walkthrough 录屏**；用户自己看效果。除非用户当次明确要求演示证据

## 代码与产品偏好

- 回复用户用 **简体中文**；直接、简洁
- 改动范围尽量小，复用现有模式（panel HTML、lazy load、registry）
- 前端视觉：若改 landing/营销页需遵守用户的设计规则；**工具站面板**优先保持现有 DevTools UI，不要无故大改皮肤
- 不要主动写用户未要的 Markdown 文档；本文件是例外（Agent 说明书）
- 安全：不写 exploit/PoC；本机桥仅服务本地调试场景

## 近期已落地（避免重复造轮子）

- **JSON 修复**：`jsonrepair` @ `tools/vendor/jsonrepair.min.js`，面板「修复」按钮，lazy load
- **Everything**：`tools/everything.js` + 桥内 `everything-proxy.js`；需同时开 ADB 桥与 Everything HTTP Server
- **ADB 镜像**：scrcpy 相关；bat/工作目录与桥目录一致；端口占用提示、禁止第二座桥抢端口、握手/关键帧/触控多次迭代（桥版本随 `adb-bridge` 递增）；大包读取分块避免 OOM
- **备忘录虚拟列表 / 无限滚动**：桌面滚动根是 `main.shell`（非 `window`）；见 `memoScrollRoot` / `memoListViewMetrics`（`tools/memo.js`）
- **视频播放拖进度条**：串行等 `seeked` 再跟最新目标（`pumpScrubSeek` in `tools/vplay.js`），勿再改回密集 `fastSeek`
- **仅显示分类**：子工具内联展开后滚轮交给 `.nav-bar-scroll`（`overflow: visible` + `bindNavGroupToolsWheelScroll`）；点工具后 `closeNavFlyouts({ keepPinned: true })` 保持展开
- **站点外链**：PDFCraft / 昆虫世界 / 史前博物馆 **只在外链导航**（`sitenav`），侧栏「站点」分组不再单独占位；旧 `#pdfcraft` 等 hash 别名跳 `sitenav`
- **在线钢琴**：`tools/piano.js` + `panels/piano.html`；88 键、黑键用 react-piano `pitchPositions`、电脑键盘约 2.5 八度
- **最近使用 → 常用**：最近弹框/芯片支持右键与长按加常用（`navToolCtx` 挂到 `showModal` 的 dialog 内才能看见）
- **工具区底边距**：桌面滚动在 `.shell`；勿把大块底 padding 放回会裁切的 `app-layout`
- 大量历史 PR 分支名为 `cursor/*-ad72` / `cursor/*-15bf`，多为已合入或废弃；合入后应删除

## 明确不适合硬塞进本站的东西

- 需要整套 Docker 后端的服务（如 ConvertX）：可评估外链/自托管，**不要**当成一个 `vendor/*.js` 塞进静态站
- 把敏感文件默认上传到云端的设计

## 本地预览

```bash
python3 -m http.server 8080 --directory .
# 打开 http://localhost:8080/tools/
```

## 会话建议（给 Agent）

- 长对话变慢或跑题时，请用户新开会话，并让对方贴 `AGENTS.md` 已覆盖之外的「本次任务」即可
- 优先读本文件 + `@` 相关源码，不要假设旧聊天记录仍在上下文中
- 收尾清单：改动已在 `master`、版本已 bump、特性分支已删；**不要**主动附截图证明
