# DevTools FFmpeg Bridge

本机 FFmpeg 桥：网页可视化批量处理音视频。仅监听 `127.0.0.1`。

## 与网页工具的关系（去重策略）

| 场景 | 用哪里 |
| --- | --- |
| 手机 / 少量文件、要预览拖拽 | 网页「音频处理」「视频修剪」「GIF」 |
| 电脑批量、大文件、切片/换音轨/幻灯片等 | **本机桥** |

桥内相近能力已合并（例如音量仅音频/保留视频、响度两种算法、转码含压体积/H.265、切片/均分等），下拉默认只显示 **常用**，勾选「显示更多」展开进阶项。旧 op id 仍可通过 API 别名调用。

## 能力概览（v0.4.1）

约 **32** 项可见操作（16 常用 + 16 更多），覆盖：

- **音频**：导出/转码、音量、响度对齐、声道、降噪、掐静音、采样率
- **视频**：转码/压体积/H.265、分辨率、帧率、去音轨、清元数据
- **画面**：裁剪、补边/模糊铺底、旋转翻转、画面效果包、倒放、去隔行
- **时间**：裁剪/片尾、切片/均分、变速、淡入淡出、循环
- **动图/截取**：GIF/WebP、波形视频、封面、截帧
- **合成**：拼接、换音轨、幻灯片、烧字幕、文字水印

## 需要

- Node.js
- 系统已安装 `ffmpeg` 与 `ffprobe`

## 启动

解压完整 ZIP 后：

- macOS: `chmod +x start-ffmpeg-bridge.command && ./start-ffmpeg-bridge.command`
- Windows: 双击 `start-ffmpeg-bridge.cmd`
- Linux: `chmod +x start-ffmpeg-bridge.sh && ./start-ffmpeg-bridge.sh`

默认：`http://127.0.0.1:17889` · Token `devtools-ffmpeg`

## 冒烟

```bash
node tools/ffmpeg-bridge/smoke-check.js
```
