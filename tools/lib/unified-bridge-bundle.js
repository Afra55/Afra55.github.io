(() => {
  "use strict";

  /**
   * 统一本机桥完整 ZIP（ADB + FFmpeg + yt-dlp + Git）。
   * 各桥面板下载入口必须走这里，禁止再打独立包。
   */
  let busy = false;

  function ensureJsZip() {
    if (typeof globalThis.JSZip === "function") return Promise.resolve(globalThis.JSZip);
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[src*="jszip"]');
      if (existing) {
        existing.addEventListener("load", () => resolve(globalThis.JSZip));
        existing.addEventListener("error", () => reject(new Error("JSZip 加载失败")));
        if (typeof globalThis.JSZip === "function") resolve(globalThis.JSZip);
        return;
      }
      const s = document.createElement("script");
      const v = window.TOOLS_BUILD || "";
      s.src = `./vendor/jszip.min.js${v ? `?v=${v}` : ""}`;
      s.onload = () => {
        if (typeof globalThis.JSZip !== "function") reject(new Error("JSZip 未加载"));
        else resolve(globalThis.JSZip);
      };
      s.onerror = () => reject(new Error("JSZip 加载失败"));
      document.head.appendChild(s);
    });
  }

  async function fetchTextAsset(path) {
    const res = await fetch(path, { cache: "no-cache" });
    if (!res.ok) throw new Error(`无法读取 ${path}（${res.status}）`);
    return res.text();
  }

  function downloadBlobFile(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2500);
  }

  const PLATFORM = {
    mac: {
      scriptPath: "./adb-bridge/start-mac.command",
      scriptName: "start-adb-bridge.command",
      zipName: "devtools-bridge-full-mac.zip",
      runHint:
        "解压后在终端执行：chmod +x start-adb-bridge.command && ./start-adb-bridge.command\n也可在 Finder 中双击 start-adb-bridge.command。",
    },
    win: {
      scriptPath: "./adb-bridge/start-win.bat",
      scriptName: "start-adb-bridge.bat",
      zipName: "devtools-bridge-full-win.zip",
      runHint:
        "解压后优先双击 start-adb-bridge.cmd（更不易闪退）；不要再同时打开 .bat。请保持窗口打开。",
    },
    linux: {
      scriptPath: "./adb-bridge/start-linux.sh",
      scriptName: "start-adb-bridge.sh",
      zipName: "devtools-bridge-full-linux.zip",
      runHint: "解压后执行：chmod +x start-adb-bridge.sh && ./start-adb-bridge.sh",
    },
  };

  /**
   * @param {"mac"|"win"|"linux"} platform
   * @param {{ onProgress?: (p:{pct:number,text:string})=>void }} [opts]
   */
  async function downloadUnifiedBridgeBundle(platform, opts = {}) {
    if (busy) throw new Error("正在准备完整包，请稍候…");
    const cfg = PLATFORM[platform];
    if (!cfg) throw new Error("未知平台");
    const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : () => {};
    busy = true;
    try {
      onProgress({ pct: 8, text: "加载打包工具…" });
      const JSZipCtor = await ensureJsZip();
      onProgress({ pct: 20, text: "拉取统一桥文件…" });
      const [
        serverJs,
        mirrorJs,
        ctrlJs,
        inspectJs,
        ffmpegJs,
        ytdlpJs,
        gitServerJs,
        gitOpsJs,
        gitNoopSh,
        gitNoopCmd,
        gitNoopCjs,
        scriptRaw,
        resolvePortJs,
        serverJar,
      ] = await Promise.all([
        fetchTextAsset("./adb-bridge/server.js"),
        fetchTextAsset("./adb-bridge/scrcpy-mirror.js").catch(() => ""),
        fetchTextAsset("./adb-bridge/scrcpy-ctrl.js").catch(() => ""),
        fetchTextAsset("./adb-bridge/device-inspect.js").catch(() => ""),
        fetchTextAsset("./ffmpeg-bridge/server.js").catch(() => ""),
        fetchTextAsset("./ffmpeg-bridge/ytdlp-core.js").catch(() => ""),
        fetchTextAsset("./git-bridge/server.js").catch(() => ""),
        fetchTextAsset("./git-bridge/git-ops.js").catch(() => ""),
        fetchTextAsset("./git-bridge/noop-editor.sh").catch(() => "#!/bin/sh\nexit 0\n"),
        fetchTextAsset("./git-bridge/noop-editor.cmd").catch(() => "@echo off\r\nexit /b 0\r\n"),
        fetchTextAsset("./git-bridge/noop-editor.cjs").catch(() => "process.exit(0);\n"),
        fetchTextAsset(cfg.scriptPath),
        fetchTextAsset("./adb-bridge/resolve-port.js").catch(() => ""),
        fetch("./adb-bridge/vendor/scrcpy-server-v3.1", { cache: "no-cache" })
          .then(async (res) => (res.ok ? new Uint8Array(await res.arrayBuffer()) : null))
          .catch(() => null),
      ]);
      const scriptText =
        platform === "win" ? String(scriptRaw).replace(/\r?\n/g, "\r\n") : scriptRaw;
      if (
        !/ADB_BRIDGE_TOKEN|devtools-adb-bridge|devtools-bridge|DevTools local ADB bridge|统一本机桥/.test(
          serverJs
        )
      ) {
        throw new Error("server.js 内容异常，请刷新页面后重试");
      }
      if (!gitServerJs || !gitOpsJs) {
        throw new Error("完整包缺少 git-bridge，请硬刷新页面后重试");
      }
      if (!ffmpegJs) {
        throw new Error("完整包缺少 ffmpeg-bridge，请硬刷新页面后重试");
      }
      const readme = [
        "DevTools 统一本机桥完整包（ADB + Scrcpy + FFmpeg + yt-dlp + Git）",
        "",
        "本压缩包必须同时保留：",
        "  - server.js",
        "  - scrcpy-mirror.js / scrcpy-ctrl.js / device-inspect.js / resolve-port.js",
        "  - ffmpeg-bridge/server.js + ytdlp-core.js",
        "  - git-bridge/server.js + git-ops.js + noop-editor.*",
        "  - vendor/scrcpy-server-v3.1（可选）",
        "  - " + cfg.scriptName,
        "",
        "使用步骤：",
        "1. 解压到任意文件夹（保留 ffmpeg-bridge、git-bridge、vendor 子目录）",
        "2. 本机已安装 Node.js；按需安装 adb / ffmpeg / yt-dlp / git",
        "3. " + cfg.runHint.replace(/\n/g, "\n   "),
        "4. 网页各工具都连 http://127.0.0.1:17888 · Token: devtools-bridge",
        "",
        "只需启动这一座桥。不要再下「独立 Git / 独立 FFmpeg」包。",
        "API：/ff · /ytdlp · /git",
        "",
      ].join("\n");

      onProgress({ pct: 55, text: "正在压缩 ZIP…" });
      const zip = new JSZipCtor();
      zip.file("server.js", serverJs);
      if (mirrorJs) zip.file("scrcpy-mirror.js", mirrorJs);
      if (ctrlJs) zip.file("scrcpy-ctrl.js", ctrlJs);
      if (inspectJs) zip.file("device-inspect.js", inspectJs);
      if (resolvePortJs) zip.file("resolve-port.js", resolvePortJs);
      zip.file("ffmpeg-bridge/server.js", ffmpegJs);
      if (ytdlpJs) zip.file("ffmpeg-bridge/ytdlp-core.js", ytdlpJs);
      zip.file("git-bridge/server.js", gitServerJs);
      zip.file("git-bridge/git-ops.js", gitOpsJs);
      if (gitNoopSh) zip.file("git-bridge/noop-editor.sh", gitNoopSh, { unixPermissions: 0o755 });
      if (gitNoopCmd) zip.file("git-bridge/noop-editor.cmd", String(gitNoopCmd).replace(/\r?\n/g, "\r\n"));
      if (gitNoopCjs) zip.file("git-bridge/noop-editor.cjs", gitNoopCjs);
      if (serverJar) zip.file("vendor/scrcpy-server-v3.1", serverJar);
      zip.file(cfg.scriptName, scriptText, {
        unixPermissions: platform === "win" ? undefined : 0o755,
      });
      if (platform === "win") {
        const wrapper = [
          "@echo off",
          'cd /d "%~dp0"',
          'echo %* | findstr /I "devtools-bridge:" >nul 2>&1',
          "if not errorlevel 1 (",
          '  cmd /d /c ""%~dp0start-adb-bridge.bat" %*"',
          "  exit /b %ERRORLEVEL%",
          ")",
          'cmd /d /c ""%~dp0start-adb-bridge.bat" & echo. & echo Log: last-start.log in this folder & pause"',
          "",
        ].join("\r\n");
        zip.file("start-adb-bridge.cmd", wrapper);
      }
      zip.file(
        platform === "win" ? "README.txt" : "使用说明.txt",
        readme.replace(/\r?\n/g, platform === "win" ? "\r\n" : "\n")
      );

      const blob = await zip.generateAsync(
        {
          type: "blob",
          platform: platform === "win" ? "DOS" : "UNIX",
        },
        (meta) => {
          onProgress({
            pct: 55 + (Number(meta.percent) || 0) * 0.4,
            text: `压缩中… ${Math.round(Number(meta.percent) || 0)}%`,
          });
        }
      );
      onProgress({ pct: 98, text: "开始下载…" });
      downloadBlobFile(blob, cfg.zipName);
      onProgress({ pct: 100, text: "下载已开始" });
      return { zipName: cfg.zipName, platform };
    } finally {
      busy = false;
    }
  }

  function detectOs() {
    const ua = navigator.userAgent || "";
    if (/Windows/i.test(ua)) return "win";
    if (/Mac/i.test(ua)) return "mac";
    return "linux";
  }

  window.devtoolsUnifiedBridgeBundle = {
    download: downloadUnifiedBridgeBundle,
    detectOs,
    isBusy: () => busy,
  };
})();
