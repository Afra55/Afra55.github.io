# DevTools FFmpeg Bridge

本机 FFmpeg 桥：网页可视化批量抽音频 / 转码。仅监听 `127.0.0.1`。

## 需要

- Node.js
- 系统已安装 `ffmpeg` 与 `ffprobe`

## 启动

解压完整 ZIP 后：

- macOS: `chmod +x start-ffmpeg-bridge.command && ./start-ffmpeg-bridge.command`
- Windows: 双击 `start-ffmpeg-bridge.cmd`
- Linux: `chmod +x start-ffmpeg-bridge.sh && ./start-ffmpeg-bridge.sh`

默认：

- 地址 `http://127.0.0.1:17889`
- Token `devtools-ffmpeg`

## 冒烟

```bash
node tools/ffmpeg-bridge/smoke-check.js
```
