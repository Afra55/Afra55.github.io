(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const panel = $("#envkit");
  if (!panel) return;

  const hint = $("#env-run-hint");
  const grid = $("#env-probe-grid");
  const errEl = $("#env-error");
  const installBtns = $("#env-install-btns");
  const upgradeBtns = $("#env-upgrade-btns");

  /** 统一桥五大能力（均挂在 17888，勿再起独立端口） */
  const BRIDGES = [
    {
      id: "adb",
      name: "① ADB",
      url: "http://127.0.0.1:17888/health",
      token: "devtools-bridge",
      tokenHeader: "X-Adb-Token",
      link: "#adb",
      kind: "adb",
    },
    {
      id: "ff-mount",
      name: "② FFmpeg · /ff",
      url: "http://127.0.0.1:17888/ff/health",
      token: "devtools-bridge",
      tokenHeader: "X-Ffmpeg-Token",
      link: "#ffbridge",
      kind: "ff",
    },
    {
      id: "ytdlp-mount",
      name: "③ yt-dlp · /ytdlp",
      url: "http://127.0.0.1:17888/ytdlp/health",
      token: "devtools-bridge",
      tokenHeader: "X-Ffmpeg-Token",
      link: "#ytdlp",
      kind: "ytdlp",
    },
    {
      id: "git-mount",
      name: "④ Git · /git",
      url: "http://127.0.0.1:17888/git/health",
      token: "devtools-bridge",
      tokenHeader: "X-Git-Token",
      link: "#gitbridge",
      kind: "git",
    },
    {
      id: "everything-mount",
      name: "⑤ Everything · /everything",
      url: "http://127.0.0.1:17888/everything/health",
      token: "devtools-bridge",
      tokenHeader: "X-Adb-Token",
      link: "#everything",
      kind: "everything",
    },
  ];

  function detectOs() {
    const ua = navigator.userAgent || "";
    if (/Windows/i.test(ua)) return "win";
    if (/Mac/i.test(ua)) return "mac";
    return "linux";
  }

  function linkBtn(href, download, label, primary) {
    const a = document.createElement("a");
    a.className = primary ? "primary-btn" : "secondary-btn";
    a.href = href;
    a.download = download;
    a.textContent = label;
    return a;
  }

  function setOs(os) {
    const next = os === "win" || os === "linux" ? os : "mac";
    $$("[data-env-os]", panel).forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.envOs === next);
    });

    installBtns.innerHTML = "";
    upgradeBtns.innerHTML = "";

    if (next === "win") {
      installBtns.append(
        linkBtn("./envkit/install-win.cmd", "install-win.cmd", "下载安装（双击 .cmd）", true),
        linkBtn("./envkit/install-devtools-env.ps1", "install-devtools-env.ps1", "PowerShell 脚本", false)
      );
      upgradeBtns.append(
        linkBtn("./envkit/upgrade-win.cmd", "upgrade-win.cmd", "下载一键升级（双击）", true),
        linkBtn("./envkit/upgrade-devtools-env.ps1", "upgrade-devtools-env.ps1", "升级 PowerShell", false)
      );
      hint.textContent = [
        "升级会处理：Node、Git、FFmpeg、ADB、yt-dlp（winget / yt-dlp -U）+ 统一桥文件。",
        "1. 下载 upgrade-win.cmd（建议与 ps1 同目录）",
        "2. 双击运行，等对照表打印完成",
        "3. 新开终端，再启动 DevToolsBridges/adb-bridge（统一桥 17888）",
        "仅检测：powershell -File install-devtools-env.ps1 -Mode check",
      ].join("\n");
    } else if (next === "mac") {
      installBtns.append(
        linkBtn("./envkit/install-mac.command", "install-mac.command", "下载安装（双击）", true),
        linkBtn("./envkit/install-devtools-env.sh", "install-devtools-env.sh", "Shell 脚本", false)
      );
      upgradeBtns.append(
        linkBtn("./envkit/upgrade-mac.command", "upgrade-mac.command", "下载一键升级（双击）", true),
        linkBtn("./envkit/upgrade-devtools-env.sh", "upgrade-devtools-env.sh", "升级 Shell（联网拉最新）", false)
      );
      hint.textContent = [
        "升级会处理：Node、Git、FFmpeg、ADB、yt-dlp（Homebrew 等）+ 统一桥文件。",
        "1. 下载 upgrade-mac.command 并允许打开，或：",
        "   chmod +x upgrade-devtools-env.sh && ./upgrade-devtools-env.sh",
        "2. 看终端「升级后对照」；日志在 ~/DevToolsBridges/last-upgrade.log",
        "3. 重新启动 adb-bridge（统一桥 17888）以加载新 server.js",
      ].join("\n");
    } else {
      installBtns.append(
        linkBtn("./envkit/install-devtools-env.sh", "install-devtools-env.sh", "下载安装脚本", true)
      );
      upgradeBtns.append(
        linkBtn("./envkit/upgrade-devtools-env.sh", "upgrade-devtools-env.sh", "下载一键升级脚本", true),
        linkBtn("./envkit/install-devtools-env.sh", "install-devtools-env.sh", "完整脚本（再跑 upgrade）", false)
      );
      hint.textContent = [
        "升级会处理：Node、Git、FFmpeg、ADB、yt-dlp（apt/dnf/pacman 等）+ 统一桥文件。",
        "chmod +x upgrade-devtools-env.sh && ./upgrade-devtools-env.sh",
        "或：./install-devtools-env.sh upgrade",
        "需要 sudo 时会提示输入密码。启动统一桥：adb-bridge/start-*",
      ].join("\n");
    }

    try {
      localStorage.setItem("devtools-envkit-os", next);
    } catch (_) {}
  }

  async function probeOne(b) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3500);
    try {
      const res = await fetch(b.url, {
        signal: ctrl.signal,
        cache: "no-store",
        headers: { [b.tokenHeader]: b.token },
      });
      clearTimeout(timer);
      let data = null;
      try {
        data = await res.json();
      } catch (_) {}

      if (b.kind === "adb") {
        if (!res.ok || !data?.ok) {
          return { ok: false, title: b.name, text: data?.error || `HTTP ${res.status}`, link: b.link };
        }
        const ver = data.version || "?";
        const adbVer = data.adb?.version || data.adb?.path || "";
        const adbOk = data.adb?.ok !== false;
        return {
          ok: adbOk,
          warn: data.ok && !adbOk,
          title: b.name,
          text: adbOk
            ? `统一桥在线 · v${ver}${adbVer ? " · " + String(adbVer).slice(0, 48) : ""}`
            : `桥在线 · v${ver}，但本机未找到 adb`,
          link: b.link,
        };
      }

      if (b.kind === "everything") {
        // 桥通了但本机 Everything HTTP 未开时仍会 502；区分「桥挂了」与「Everything 未开」
        if (res.status === 502 || (res.ok && data && data.ok === false)) {
          return {
            ok: false,
            warn: true,
            title: b.name,
            text: data?.error || "桥已挂载，但本机 Everything HTTP Server 未开/不可达",
            link: b.link,
          };
        }
        if (!res.ok || !data?.ok) {
          return { ok: false, title: b.name, text: data?.error || `HTTP ${res.status}`, link: b.link };
        }
        return {
          ok: true,
          title: b.name,
          text: `在线 · 经桥代理${data.target ? " · " + data.target : ""}`,
          link: b.link,
        };
      }

      if (!res.ok || (data && data.ok === false)) {
        return {
          ok: false,
          title: b.name,
          text: data?.error || `HTTP ${res.status}`,
          link: b.link,
        };
      }
      const ver = data?.version || data?.bridgeVersion || "";
      const extra =
        data?.git ||
        data?.ffmpeg ||
        data?.ytdlp ||
        data?.service ||
        (data?.ok ? "挂载正常" : "");
      return {
        ok: true,
        title: b.name,
        text: `在线${ver ? " · v" + ver : ""}${extra ? " · " + String(extra).slice(0, 56) : ""}`,
        link: b.link,
      };
    } catch (e) {
      clearTimeout(timer);
      return { ok: false, title: b.name, text: "未连接（先启动 adb-bridge 统一桥 17888）", link: b.link };
    }
  }

  function renderProbe(rows) {
    grid.innerHTML = "";
    for (const r of rows) {
      const card = document.createElement("div");
      const state = r.ok ? "is-ok" : r.warn ? "is-warn" : "is-err";
      const dot = r.ok ? "is-ok" : r.warn ? "is-warn" : "is-err";
      card.className = "env-probe-card " + state;
      card.innerHTML = `
        <span class="adb-dot ${dot}" aria-hidden="true"></span>
        <div>
          <strong>${r.title}</strong>
          <p class="hint tight">${r.text}</p>
        </div>
        <a class="ghost-btn" href="${r.link}">打开</a>
      `;
      grid.appendChild(card);
    }
  }

  async function probeAll() {
    errEl.hidden = true;
    grid.innerHTML = `<p class="hint">探测中…</p>`;
    const rows = [];
    for (const b of BRIDGES) rows.push(await probeOne(b));
    renderProbe(rows);
  }

  $$("[data-env-os]", panel).forEach((btn) => {
    btn.addEventListener("click", () => setOs(btn.dataset.envOs));
  });
  $("#env-probe").addEventListener("click", () => probeAll());

  let initial = detectOs();
  try {
    const saved = localStorage.getItem("devtools-envkit-os");
    if (saved === "mac" || saved === "win" || saved === "linux") initial = saved;
  } catch (_) {}
  setOs(initial);
  probeAll();
})();
