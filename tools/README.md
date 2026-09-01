# DevTools

实用小工具集合（纯前端，数据不离开浏览器）。

在线地址：[https://afra55.github.io/tools/](https://afra55.github.io/tools/)

## 使用方式

- **单工具工作台**：同一时间只显示一个工具；用 hash 深链分享，例如 `#json`、`#vbb`
- **手机**：点顶栏「工具」打开抽屉；支持搜索与最近使用
- **桌面**：左侧分组导航；可拖拽排序（保存在本地），可恢复默认排序
- **安装为应用（PWA）**：Chrome / Edge 地址栏或顶栏「安装应用」可加到桌面/开始菜单。**在线打开即会拉新版**（Service Worker 网络优先）；离线才用上次缓存。大体积编码器仍需联网首次加载。
- **分类导航**：GIF、视频、黑盒等独立侧栏分类；多工具分类在「仅显示分类」时顶栏有横向滚动条快速切换；旧链接 `#media/...` 会自动跳到 `#工具名`

## 已实现

- 时间戳转换 / 时间差计算 / Cron
- AHEX 颜色调节、HEX / RGB / HSL 互转、屏幕取色、密码生成
- Base64、图片转 Base64（预览）
- JSON 格式化、YAML ⇄ JSON、代码卡片分享图
- 正则测试、文本 Diff、文本处理、命名转换
- URL 编解码、Query / JWT 解析
- UUID 生成、MD5 / SHA-256
- 二维码生成/识别、进制转换、Markdown 预览、单位换算、坐标系互转（WGS84 / GCJ02 / BD09 / CGCS2000）
- **媒体**：GIF 合成/压缩/合并、拆帧 ZIP、转 WebM、视频转 GIF、视频切分、一键黑盒切片
- 图片工具：压缩/目标体积、改尺寸、WebP·JPEG·PNG、裁剪、旋转翻转、批量 ZIP、文字/图片水印、圆角边框、EXIF 查看清除、九宫格、App 图标多尺寸、拼接
- ADB 工具：本机桥连接、多设备信息/状态快照、文件管理、APK 安装与信息分析、应用管理（打开/详情/强停/清数据/权限/卸载/备份）、HTTP 代理与端口转发、开发者选项（触摸/布局边界/动画）、Logcat、输入自动化、剪贴板、截图录屏与任务中心（需本机 `adb`）
- **FFmpeg 本机桥**：浏览本机目录、批量抽音频（MP3/M4A/WAV）、常用转码预设与任务队列（需本机 `ffmpeg`）

分组大致为：时间 / 颜色 / 编码与安全 / 数据与文本 / 媒体 / 图片 / 换算 / 设备。

### ADB 工具（本机桥）

网页不能直接调用 `adb`。使用前请：

1. 确认本机已安装 Node.js 与 `adb`（`adb devices` 可用）
2. 在「ADB 工具」页下载对应系统的**完整 ZIP 包**（内含 `server.js` 与启动脚本），解压到同一目录后运行脚本；或执行：

```bash
node tools/adb-bridge/server.js
```

> 注意：不要只下载启动脚本。缺少同目录的 `server.js` 会导致无法启动（提示找不到 server.js）。
3. 回到网页点击「连接本机桥」（默认 `http://127.0.0.1:17888`，Token `devtools-adb`）

### FFmpeg 本机桥

网页不能直接批量跑系统 `ffmpeg`。使用前请：

1. 确认本机已安装 Node.js 与 `ffmpeg`（`ffmpeg -version` 可用）
2. 在「FFmpeg 本机桥」页下载对应系统的**完整 ZIP 包**，解压后运行启动脚本；或执行：

```bash
node tools/ffmpeg-bridge/server.js
```

3. 回到网页连接本机桥（默认 `http://127.0.0.1:17889`，Token `devtools-ffmpeg`）
4. 浏览本机文件夹，勾选视频或文件夹，选择「抽音频 / 转视频」后开始任务

适合几百个视频批量抽 MP3/M4A/WAV。浏览器内 WASM 工具仍适合少量文件的在线处理。

## 本机桥依赖（小白）

网页内有独立指南：打开工具页 → **安装本机工具**（`#setup`），含 Node.js / ADB / FFmpeg 下载链接与分系统步骤。

## 本地预览

```bash
python3 -m http.server 8080 --directory .
```

打开 `http://localhost:8080/tools/`。

## 测试

```bash
node tools/test/pure.test.js
node tools/vbb-plan.test.js
node tools/adb-bridge/smoke-check.js
node tools/ffmpeg-bridge/smoke-check.js
# 可选：浏览器冒烟（需 Chrome + ffmpeg）
# node tools/vbb-smoke.cjs
```

## 说明

目录自包含，后续可整体迁出为独立仓库。
