/**
 * DevTools 第三方开源依赖清单（关于页展示 + 升级检索用）。
 * 维护：升级 vendor/CDN/自托管构建后请同步更新本文件（版本、路径、说明）。
 */
(() => {
  "use strict";

  /** @type {{ updated: string, groups: Array<{ id: string, label: string, items: OssItem[] }> }} */
  const OSS_DEPS = {
    updated: "2026-09-02",
    groups: [
      {
        id: "vendor",
        label: "浏览器 vendor（tools/vendor/）",
        items: [
          {
            name: "js-yaml",
            version: "4.1.0",
            license: "MIT",
            repo: "https://github.com/nodeca/js-yaml",
            usedIn: "YAML ↔ JSON",
            path: "tools/vendor/js-yaml.min.js",
          },
          {
            name: "JSZip (+ pako)",
            version: "3.10.1",
            license: "MIT / GPLv3",
            repo: "https://github.com/Stuk/jszip",
            usedIn: "ADB 桥 ZIP 打包、批量下载",
            path: "tools/vendor/jszip.min.js",
          },
          {
            name: "SparkMD5",
            version: "—",
            license: "MIT",
            repo: "https://github.com/satazor/js-spark-md5",
            usedIn: "Hash / MD5",
            path: "tools/vendor/spark-md5.min.js",
          },
          {
            name: "qrcodejs",
            version: "—",
            license: "MIT",
            repo: "https://github.com/davidshimjs/qrcodejs",
            usedIn: "二维码生成",
            path: "tools/vendor/qrcode.min.js",
          },
          {
            name: "jsQR",
            version: "—",
            license: "Apache-2.0",
            repo: "https://github.com/cozmo/jsQR",
            usedIn: "二维码识别",
            path: "tools/vendor/jsQR.js",
          },
          {
            name: "html2canvas",
            version: "1.4.1",
            license: "MIT",
            repo: "https://github.com/niklasvh/html2canvas",
            usedIn: "代码分享卡片 / 文字转图片截图",
            path: "tools/vendor/html2canvas.min.js",
          },
          {
            name: "gif.js",
            version: "0.2.0",
            license: "MIT",
            repo: "https://github.com/jnordberg/gif.js",
            usedIn: "GIF 编码",
            path: "tools/vendor/gif.js, gif.worker.js",
          },
          {
            name: "omggif",
            version: "—",
            license: "MIT",
            repo: "https://github.com/deanm/omggif",
            usedIn: "GIF 解码 / 帧读取",
            path: "tools/vendor/omggif.js",
          },
          {
            name: "jsonrepair",
            version: "3.15.0",
            license: "ISC",
            repo: "https://github.com/josdejong/jsonrepair",
            usedIn: "JSON 修复（尾逗号、注释、单引号等）",
            path: "tools/vendor/jsonrepair.min.js",
          },
          {
            name: "gifsicle-wasm-browser",
            version: "v1.5.19",
            license: "MIT",
            repo: "https://github.com/renzhezhilu/gifsicle-wasm-browser",
            usedIn: "GIF 压缩 / 合并",
            path: "tools/vendor/gifsicle.min.js",
          },
          {
            name: "ffmpeg.wasm (@ffmpeg/core + @ffmpeg/ffmpeg)",
            version: "0.12.6",
            license: "MIT",
            repo: "https://github.com/ffmpegwasm/ffmpeg.wasm",
            usedIn: "视频修剪 / 音频 / GIF / 黑盒等网页 FFmpeg",
            path: "tools/vendor/ffmpeg/",
          },
        ],
      },
      {
        id: "cdn",
        label: "运行时 CDN 加载",
        items: [
          {
            name: "Tesseract.js",
            version: "5.1.1",
            license: "Apache-2.0",
            repo: "https://github.com/naptha/tesseract.js",
            usedIn: "图片转文字 OCR",
            path: "cdn.jsdelivr.net/npm/tesseract.js@5.1.1",
          },
          {
            name: "Google Fonts",
            version: "—",
            license: "OFL",
            repo: "https://fonts.google.com/",
            usedIn: "站点 UI 字体；文转图按需加载 Noto Serif SC",
            path: "fonts.googleapis.com",
          },
        ],
      },
      {
        id: "whiteboard",
        label: "画板（自托管构建）",
        items: [
          {
            name: "Excalidraw",
            version: "源码构建（未 pin）",
            license: "MIT",
            repo: "https://github.com/excalidraw/excalidraw",
            usedIn: "画板工具 #whiteboard",
            path: "tools/excalidraw/",
          },
          {
            name: "React（Excalidraw 内置）",
            version: "构建内嵌",
            license: "MIT",
            repo: "https://github.com/facebook/react",
            usedIn: "Excalidraw 画板 iframe",
            path: "tools/excalidraw/assets/",
          },
          {
            name: "Mermaid / marked / KaTeX / CodeMirror 等",
            version: "Excalidraw 构建内嵌",
            license: "MIT 等",
            repo: "https://github.com/excalidraw/excalidraw/tree/master/packages",
            usedIn: "画板内流程图 / 公式 / 文本编辑",
            path: "tools/excalidraw/assets/",
          },
        ],
      },
      {
        id: "sandspiel",
        label: "落沙沙盒（自托管构建）",
        items: [
          {
            name: "sandspiel",
            version: "本站单机中文构建",
            license: "MIT",
            repo: "https://github.com/MaxBittker/sandspiel",
            usedIn: "落沙沙盒 #sandspiel",
            path: "tools/sandspiel/",
          },
          {
            name: "WebGL-Fluid-Simulation",
            version: "构建内嵌",
            license: "MIT",
            repo: "https://github.com/PavelDoGreat/WebGL-Fluid-Simulation",
            usedIn: "落沙沙盒流体/风力",
            path: "tools/sandspiel/",
          },
        ],
      },
      {
        id: "data",
        label: "结构化数据（穴位等）",
        items: [
          {
            name: "Bencaodian / 本草典",
            version: "v1 seed",
            license: "CC BY-SA 4.0",
            repo: "https://bencaodian.org/en/about/data/",
            usedIn: "穴位图 · 经穴定位/功效详情（195/361 条）",
            path: "tools/lib/acupoints-bundle.json（经 build 脚本合并）",
          },
          {
            name: "AcuKG",
            version: "—",
            license: "研究数据集",
            repo: "https://github.com/yimingli99/AcuKG-Knowledge-graph-for-medical-acupuncture",
            usedIn: "穴位图 · 361 经穴名录与英文主治补全",
            path: "tools/scripts/build-acupoints.mjs 输入",
          },
          {
            name: "Wellcome Collection",
            version: "—",
            license: "CC BY 4.0",
            repo: "https://wellcomecollection.org/",
            usedIn: "穴位图 · 经络参考图（wellcome/*.jpg）",
            path: "tools/lib/acupoint/wellcome/",
          },
          {
            name: "GB/T 40997-2021",
            version: "2021",
            license: "国家标准（名称与定位整理）",
            repo: "https://ndls.cnis.ac.cn/standard/detail/d3fc1cfbf61f63334b07738ca9b2f4a9",
            usedIn: "穴位图 · 51 经外奇穴",
            path: "tools/lib/extra-acupoints-source.json",
          },
        ],
      },
      {
        id: "bridge",
        label: "本机桥 / 可选下载",
        items: [
          {
            name: "scrcpy-server",
            version: "3.1",
            license: "Apache-2.0",
            repo: "https://github.com/Genymobile/scrcpy",
            usedIn: "ADB 屏幕镜像",
            path: "tools/adb-bridge/vendor/scrcpy-server-v3.1",
          },
          {
            name: "Node.js",
            version: "用户自装",
            license: "MIT",
            repo: "https://github.com/nodejs/node",
            usedIn: "ADB / FFmpeg 本机桥运行时",
            path: "—",
          },
          {
            name: "FFmpeg / ffprobe",
            version: "用户自装",
            license: "LGPL / GPL",
            repo: "https://github.com/FFmpeg/FFmpeg",
            usedIn: "FFmpeg 本机桥；网页内用 ffmpeg.wasm",
            path: "—",
          },
          {
            name: "Android platform-tools (adb)",
            version: "用户自装",
            license: "Apache-2.0",
            repo: "https://developer.android.com/tools/releases/platform-tools",
            usedIn: "ADB 工具",
            path: "—",
          },
        ],
      },
      {
        id: "api",
        label: "浏览器 API（无第三方库）",
        items: [
          {
            name: "Web Crypto API",
            version: "—",
            license: "—",
            repo: "https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API",
            usedIn: "备忘录加密、Hash",
            path: "浏览器内置",
          },
          {
            name: "WebRTC (RTCPeerConnection)",
            version: "—",
            license: "—",
            repo: "https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API",
            usedIn: "局域网互传",
            path: "浏览器内置",
          },
        ],
      },
      {
        id: "inspired",
        label: "风格参考（本地重写，未嵌入其代码）",
        items: [
          {
            name: "Logoly",
            version: "—",
            license: "WTFPL",
            repo: "https://github.com/bestony/logoly",
            usedIn: "P站风 Logo",
            path: "—",
          },
          {
            name: "zzkia",
            version: "—",
            license: "未声明",
            repo: "https://github.com/dcalsky/zzkia",
            usedIn: "诺基亚短信",
            path: "—",
          },
        ],
      },
      {
        id: "dev",
        label: "开发与冒烟测试（不随站发布）",
        items: [
          {
            name: "Puppeteer",
            version: "23.11.1",
            license: "Apache-2.0",
            repo: "https://github.com/puppeteer/puppeteer",
            usedIn: "memo-smoke / lanshare-smoke 等",
            path: "tools/node_modules/",
          },
        ],
      },
    ],
  };

  window.DevToolsOssDeps = OSS_DEPS;
})();
