# DevTools

实用小工具集合（纯前端，数据不离开浏览器）。

在线地址：[https://afra55.github.io/tools/](https://afra55.github.io/tools/)

## 已实现

- 时间戳转换 / 时间差计算
- AHEX 颜色调节、HEX / RGB / HSL 互转
- Base64、图片转 Base64（预览）
- JSON 格式化、YAML ⇄ JSON
- 正则测试、文本 Diff
- URL 编解码、Query / JWT 解析
- UUID 生成、MD5 / SHA-256
- 文本处理、命名转换、二维码生成/识别、代码卡片分享图、进制转换、Markdown 预览、Cron、单位换算、坐标系互转（WGS84 / GCJ02 / BD09 / CGCS2000）
- GIF 合成、拆帧 ZIP、转 WebM、视频转 GIF
- 图片工具：压缩/目标体积、改尺寸、WebP·JPEG·PNG、裁剪、旋转翻转、批量 ZIP、文字/图片水印、圆角边框、EXIF 查看清除、九宫格、App 图标多尺寸、拼接
- ADB 工具：本机桥连接、多设备信息/状态快照、文件管理、APK 安装与信息分析、应用管理（打开/详情/强停/清数据/权限/卸载/备份）、HTTP 代理与端口转发、开发者选项（触摸/布局边界/动画）、Logcat、输入自动化、剪贴板、截图录屏与任务中心（需本机 `adb`）

默认按「时间 / 颜色 / 编码 / 数据 / 文本 / 其他」分组排列。可拖拽顶部导航手动排序，顺序会保存在浏览器本地；也可一键恢复默认排序。

### ADB 工具（本机桥）

网页不能直接调用 `adb`。使用前请：

1. 确认本机已安装 Node.js 与 `adb`（`adb devices` 可用）
2. 在「ADB 工具」页下载对应系统的**完整 ZIP 包**（内含 `server.js` 与启动脚本），解压到同一目录后运行脚本；或执行：

```bash
node tools/adb-bridge/server.js
```

> 注意：不要只下载启动脚本。缺少同目录的 `server.js` 会导致无法启动（提示找不到 server.js）。
3. 回到网页点击「连接本机桥」（默认 `http://127.0.0.1:17888`，Token `devtools-adb`）

## 本地预览

```bash
python3 -m http.server 8080 --directory .
```

打开 `http://localhost:8080/`。

## 测试

```bash
node tools/test/pure.test.js
node tools/adb-bridge/smoke-check.js
# 可选浏览器冒烟（需静态服务）
# python3 -m http.server 8080 --directory tools
# 打开 /test/smoke.html
```

## 说明

目录自包含，后续可整体迁出为独立仓库。
