# AGENTS.md — Cursor / Cloud Agent 说明

面向本仓库 AI Agent。人类说明见 `tools/README.md`。

## 项目

- 仓库：`Afra55/Afra55.github.io`（GitHub Pages）
- 主产品：`tools/` DevTools 纯前端站（[在线](https://afra55.github.io/tools/)）
- 原则：数据尽量在浏览器本地处理；系统能力走本机桥，不上传第三方

## 目录速查

| 路径 | 用途 |
|------|------|
| `tools/index.html` | 入口 |
| `tools/app.js` | 核心面板逻辑 |
| `tools/registry/tools.json` | 工具分组 / 名称 / 描述（编辑源） |
| `tools/lib/tool-registry.js` | 由 registry 生成的运行时表 |
| `tools/lib/lazy-scripts.js` | 按工具懒加载脚本 / vendor |
| `tools/lib/tools-build.js` | `TOOLS_BUILD` / `TOOLS_VERSION` |
| `tools/bump-version.cjs` | 递增版本并同步 `?v=` |
| `tools/panels/*.html` | 面板 HTML |
| `tools/extra-panels/*.js` | 额外面板逻辑 |
| `tools/vendor/` | 浏览器第三方库 |
| `tools/lib/oss-deps.js` | 关于页 OSS 清单（升级 vendor 后同步） |
| `tools/adb-bridge/` | **统一本机桥**（`17888`）：ADB / Everything / FFmpeg(`/ff`) / yt-dlp(`/ytdlp`) / Git(`/git`) |
| `tools/ffmpeg-bridge/` | FFmpeg / yt-dlp 模块（由统一桥挂载；也可独立 `17889`） |
| `tools/git-bridge/` | Git 模块（由统一桥挂载 `/git`；也可独立 `17890`） |
| `tools/envkit/` | 一键检测/安装/升级脚本 |
| `tools/theme.js` / `tools/lib/theme-presets.js` | 主题 |

## 新增 / 改工具

1. 改 `tools/registry/tools.json`
2. `node tools/scripts/build-tool-registry.cjs`
3. `node tools/scripts/verify-registry.cjs`
4. 面板：`tools/panels/<id>.html`；逻辑：`app.js` / `extra-panels/<id>.js` / `tools/<id>.js`
5. 需要时在 `lazy-scripts.js` 登记 `TOOL_FILES` / `TOOL_VENDORS`
6. 第三方库进 `vendor/`，并登记 `lazy-scripts.js` + `oss-deps.js`
7. 合入前：`node tools/bump-version.cjs`（北京时间戳）

## 本机桥（强制 · 统一桥优先）

- **唯一默认入口**：`http://127.0.0.1:17888`，Token `devtools-bridge`，协议 `devtools-bridge://start`
- 能力挂载：Everything（根）· FFmpeg `/ff` · yt-dlp `/ytdlp` · Git `/git`；**用户只需启动一次**
- 独立端口仅兼容旧包：FFmpeg `17889`、Git `17890`；**新功能不要默认新端口**
- 面板一律：`bindBridgeLaunchUI({ kind: "unified" })`（`tools/lib/bridge-token.js`）；共用「记住解压目录 / 自动启动」
- 改桥逻辑必须同步：`BRIDGE_VERSION`（`adb-bridge/server.js`）+ 完整 ZIP 文件列表（`extra-panels/adb.js` → `downloadAdbBridgeBundle`）+ EnvKit `sync_bridges` / `Sync-Bridges`（sh+ps1）+ 启动脚本缺文件 WARN
- bat/sh 缓存写在**脚本同目录**，勿写死用户主目录

### 新增一座「桥能力」要对齐（一键装 / 一键更）

1. 模块目录 `tools/<name>-bridge/`（可被 `adb-bridge` `require`；含 `server.js` 等）
2. **挂进统一桥** `adb-bridge/server.js`（load + 路由前缀），默认走 17888
3. **完整 ZIP**：`downloadAdbBridgeBundle` 写入 zip（与 ffmpeg-bridge、git-bridge 同级）
4. **EnvKit**：`install-devtools-env.{sh,ps1}` 的 `sync_bridges` / `Sync-Bridges` 下载并校验；`install`/`upgrade`/`bridges` 三种模式都要覆盖
5. **面板**：默认 17888 + Token `devtools-bridge` + `bindBridgeLaunchUI(unified)`；独立包仅作可选回退
6. **探测文案**：`envkit.js` 的 BRIDGES、`setup.html` / 面板说明写「统一桥」，勿只写独立端口
7. registry + lazy-scripts + `bump-version.cjs`

禁止：只做独立端口桥却不进统一 ZIP / EnvKit；禁止新工具另起一套「记住目录」实现。

## Git（强制）

- 做完即合入 `master`：commit → `git push origin master`；**不要等用户说「合入」**
- Cloud 若强制 `cursor/<name>-xxxx` + PR：同回合内 merge 进 master、push、删分支；不以「等用户点 Merge」为终点
- 合入后删本次特性分支（远程 + 本地）；过时 `cursor/*` 主动清理
- 提交信息说清改了什么 / 为什么；功能改动必须 bump `TOOLS_BUILD`
- **不做**验收截图 / walkthrough，除非用户当次明确要求

## 代码与产品

- 回复用**简体中文**；改动尽量小，复用 panel / lazy / registry 模式
- 工具站面板保持现有 DevTools UI；landing 才套营销设计规则
- 不主动写用户未要的 Markdown（本文件除外）
- 安全：不写 exploit/PoC；本机桥仅本地调试

## 回复风格（ADHD 友好 · 默认开启）

改编自 [ayghri/i-have-adhd](https://github.com/ayghri/i-have-adhd)（MIT）。默认全程生效；用户说「正常模式 / stop adhd mode」时改回普通简洁风格并一句确认。

1. **先给下一步**：首句是可立刻做的动作/结论，不要「好问题 / 让我先看看」
2. **多步编号**：超过一步用 `1. 2. 3.`；每步一件事；默认 ≤5 条，多了拆「现在 / 以后」
3. **收尾一个下一步**：未完结时末句给两分钟内能做的动作；禁止「有问题再说」
4. **少跑题**：先做完当前事；旁支最多一句并问要不要接着做
5. **每轮重述状态**：不假设用户记得上轮进度
6. **时间说具体**：用「约 5 分钟 / 半小时」，不用「一会儿」
7. **完成写清楚**：说清「现在能做什么」，别埋在复盘里
8. **报错就事论事**：原因 + 修法；禁止「哎呀 / 似乎有问题」
9. **禁开场与客套收尾**：不预告自己要做什么、不任务结束后再复述一遍
10. **冲突时优先**：安全、自动合入 master、简体中文、不录屏验收；输出形状仍尽量遵守上面几条

发送前自检：删「我接下来会…」「还有别的吗」、无信息量的「顺便」。只看首句和末句应能知道「现在做什么」和「刚发生了什么」。

## 勿重复造轮子（易踩坑）

- **ADB 镜像**：scrcpy-server v3.1，桥 ≥0.9.12；`scrcpy-ctrl.js` 须进 ZIP；勿默认 `i-frame-interval=1`
- **Everything**：需同时开 ADB 桥 + Everything HTTP Server
- **备忘录滚动**：桌面滚动根是 `main.shell`（非 `window`）
- **视频拖进度**：串行等 `seeked`（`pumpScrubSeek`），勿密集 `fastSeek`
- **导航**：仅显示分类时滚轮交给 `.nav-bar-scroll`；站点外链只在 `sitenav`
- **Git 可视化**：统一桥 `/git`（完整包）；独立桥 `git-bridge` 17890 可选；面板 `#gitbridge`；小白模式含同步/冲突/补丁/对齐线上
- **环境管家**：`#envkit` + `tools/envkit/install-devtools-env.{sh,ps1}`；缺啥装啥、可 upgrade/bridges

## 不要硬塞

- 需整套 Docker 后端的服务：可外链/自托管，勿塞进 `vendor/*.js`
- 敏感文件默认上传云端

## 本地预览

```bash
python3 -m http.server 8080 --directory .
# http://localhost:8080/tools/
```

## 会话

- 对话变慢/跑题：请用户新开会话，只贴本文件未覆盖的「本次任务」
- 优先读本文件 + 相关源码，不假设旧聊天仍在上下文
