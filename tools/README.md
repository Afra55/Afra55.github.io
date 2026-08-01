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
- ADB 工具：本机桥连接、多设备信息/状态快照、文件管理、APK 安装、应用管理（打开/卸载/停用/备份）、Logcat、输入自动化、剪贴板推送、屏幕常亮/USB 安装快捷开关、截图录屏与任务中心（需本机 `adb`）

默认按「时间 / 颜色 / 编码 / 数据 / 文本 / 其他」分组排列。可拖拽顶部导航手动排序，顺序会保存在浏览器本地；也可一键恢复默认排序。

### ADB 工具（本机桥）

网页不能直接调用 `adb`。使用前请：

1. 确认本机已安装 Node.js 与 `adb`（`adb devices` 可用）
2. 在「ADB 工具」页下载并运行启动脚本，或执行：

```bash
node tools/adb-bridge/server.js
```

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
