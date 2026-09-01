# 工具按需加载规则

> **核心原则：打开哪个工具，才加载哪个工具；禁止首屏一次性加载全部工具脚本。**

本页是 DevTools 工作台性能约定的权威说明。新增或改动工具时请先读本文。

## 为什么

- `index.html` 内含全部工具的 DOM 面板，体积很大；若再同步加载几十个 `*.js`，首屏会明显变慢。
- 用户通常只使用上次打开的一个工具；其余工具应在切换路由后再拉取对应脚本与依赖。

## 首屏允许加载的脚本（壳层）

`tools/index.html` 底部**只允许**以下脚本通过 `<script src>` 直接引入：

| 脚本 | 作用 |
|------|------|
| `lib/tools-build.js` | 构建版本号 |
| `lib/theme-presets.js` | 主题预设 |
| `lib/boot-loader.js` | 启动遮罩与进度 |
| `lib/bridge-token.js` | 本机桥 Token |
| `lib/lazy-scripts.js` | **按需加载调度器**（本身很小） |
| `theme.js` | 主题切换 |
| `app.js` | 路由、导航、壳层逻辑 |
| `nav-organize.js` | 导航排序/收藏 |

**禁止**在 `index.html` 里直接 `<script src="./某工具.js">`。历史遗留的大包（`extra.js`、`temp.js`、各工具 `*.js`、vendor）一律走 `DevToolsLazy.ensureForTool`。

## 加载流程

```
首屏 HTML + 壳层 JS
    → boot-loader 显示进度
    → app.js applyRoute({ deferAssets: true })
    → DevToolsLazy.ensureForTool(当前 toolId)
        → 按需：pure / extra / vendor / 工具脚本
    → devtools:boot-ready + devtools:route
切换工具
    → applyRoute → ensureForTool(新 toolId) + 顶栏细进度条
```

### 首屏瞬显当前面板

`boot-loader` / 内联脚本会根据 hash 写入 `html[data-boot-panel="工具id"]`。`workspace-nav.css` 中对应选择器让**当前**面板在 JS 未就绪时即可显示，避免白屏。新增工具面板时**必须**在该 CSS 中补一行 `data-boot-panel` 规则。

### 工具内初始化

工具脚本应监听 `devtools:route`，仅在路由命中本工具时初始化或拉取重资源：

```js
document.addEventListener("devtools:route", (e) => {
  if (e.detail?.tool !== "mytool" && e.detail?.mediaTab !== "mytool") return;
  init();
});
```

不要在脚本顶层或 `DOMContentLoaded` 里无条件执行全量初始化、拉取文章列表或大文件。

## 新增工具检查清单

1. **`tools/lib/lazy-scripts.js`**
   - `TOOL_FILES` 注册 `./mytool.js`
   - 若只需独立脚本：加入 `STANDALONE_NO_EXTRA`（跳过 `extra.js`）
   - 若不依赖 `DevToolsPure`：加入 `NO_PURE`
   - 若需第三方库：在 `TOOL_VENDORS` 注册，并在 `VENDOR_FILES` 中定义
   - 外链整站类工具：加入 `EXTERNAL_SITE_TOOLS` 并按需使用 `open-external-site.js`

2. **`tools/app.js`**
   - `TOOL_GROUPS` / `TOOL_META` 注册导航与标题

3. **`tools/index.html`**
   - 只加工具面板的 HTML，**不要**加 `<script src="./mytool.js">`

4. **`tools/workspace-nav.css`**
   - 补 `html[data-boot-panel="mytool"] #mytool { ... }`

5. **工具脚本 `mytool.js`**
   - 用 `devtools:route` 延迟初始化
   - 大资源（JSON、GIF、wasm）在首次进入该工具或用户交互后再 fetch

6. **冒烟（可选）**  
   - 若有 `*-smoke.cjs`，断言 `data-boot-panel` 与 lazy 注册存在

## 合理例外（不是「全工具加载」）

以下在首屏之后、空闲时后台加载，**不属于**违反按需原则：

| 行为 | 原因 |
|------|------|
| `scheduleDateremindReminders()` | 全站日期提醒需在未打开工具时也能弹窗 |
| `idleLoadPwaOnce()` | PWA 注册与安装提示 |
| `extra.js` 内个别工具的 ffmpeg 预热 | 仅在该工具路由激活后由 `devtools:route` 触发 |

不要以此为理由把更多工具脚本塞回 `index.html`。

## 相关文件

- 调度实现：`tools/lib/lazy-scripts.js`
- 路由与进度：`tools/app.js`（`applyRoute`、`deferAssets`、`setToolLoadProgress`）
- 首屏面板 CSS：`tools/workspace-nav.css`（`data-boot-panel`）
- 启动遮罩：`tools/lib/boot-loader.js`

## 反例（禁止）

```html
<!-- index.html 底部 — 错误 -->
<script src="./wheel.js"></script>
<script src="./muyu.js"></script>
<script src="./healthread.js"></script>
```

```js
// mytool.js 顶层 — 错误：一切入就拉 100MB 资源
fetch("./lib/huge-data.json").then(...);
initEverything();
```

## 正例

```js
// lazy-scripts.js 已注册后，由 ensureForTool 拉取
// mytool.js
let inited = false;
document.addEventListener("devtools:route", (e) => {
  if (e.detail?.tool !== "mytool") return;
  if (inited) return;
  inited = true;
  loadDataWhenNeeded();
});
```
