# DevTools FFmpeg Bridge

本机 FFmpeg 桥：网页可视化批量处理音视频。仅监听 `127.0.0.1`。

## 能力概览（v0.4）

约 **49** 项用户向操作，覆盖日常剪辑/转码/导出：

- **音频**：抽音频、转码、音量、响度/动态响度、单声道/立体声、降噪、掐静音、改采样率、视频内调音量
- **视频**：转封装/转码、压缩、H.265、分辨率、帧率、去音轨、清除元数据
- **画面**：裁剪、补黑边、模糊铺底、旋转、翻转、倒放、去隔行、亮度、锐化、模糊、防抖、色相、暗角、负片
- **时间**：变速、裁剪、保留片尾、淡入淡出、循环、按时长切片、均分 N 段
- **动图/截取**：GIF、动态 WebP、封面、按间隔截帧、音频波形视频
- **合成**：拼接、替换音轨、图片幻灯片、烧录字幕、文字水印
- **探测**：单文件 / 批量 ffprobe

网页从 `GET /ops` 拉取带参数的操作目录；任务统一走 `POST /jobs/run`。

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
