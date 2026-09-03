(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const panel = $("#envkit");
  if (!panel) return;

  const hint = $("#env-run-hint");
  const grid = $("#env-probe-grid");
  const errEl = $("#env-error");

  const BRIDGES = [
    {
      id: "adb",
      name: "统一桥（ADB / FFmpeg / yt-dlp）",
      url: "http://127.0.0.1:17888/health",
      token: "devtools-bridge",
      tokenHeader: "X-Adb-Token",
      link: "#adb",
    },
    {
      id: "ffmpeg-standalone",
      name: "FFmpeg 独立桥（可选 17889）",
      url: "http://127.0.0.1:17889/health",
      token: "devtools-ffmpeg",
      tokenHeader: "X-Ffmpeg-Token",
      link: "#ffbridge",
    },
    {
      id: "git",
      name: "Git 桥",
      url: "http://127.0.0.1:17890/health",
      token: "devtools-git",
      tokenHeader: "X-Git-Token",
      link: "#gitbridge",
    },
  ];

  function detectOs() {
    const ua = navigator.userAgent || "";
    if (/Windows/i.test(ua)) return "win";
    if (/Mac/i.test(ua)) return "mac";
    return "linux";
  }

  function setOs(os) {
    const next = os === "win" || os === "linux" ? os : "mac";
    $$("[data-env-os]", panel).forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.envOs === next);
    });
    if (next === "win") {
      hint.textContent = [
        "Windows（PowerShell）：",
        "1. 把 install-devtools-env.ps1 与 install-win.cmd 放同一文件夹",
        "2. 双击 install-win.cmd",
        "   或：powershell -ExecutionPolicy Bypass -File .\\install-devtools-env.ps1",
        "3. 升级：… -Mode upgrade    只更新桥：… -Mode bridges",
        "4. 启动 ~/DevToolsBridges 里 adb-bridge\\start-win.cmd 与 git-bridge\\start-win.cmd",
      ].join("\n");
    } else if (next === "mac") {
      hint.textContent = [
        "macOS：",
        "1. chmod +x install-devtools-env.sh && ./install-devtools-env.sh",
        "   或双击 install-mac.command",
        "2. 只检测：./install-devtools-env.sh check",
        "3. 升级：./install-devtools-env.sh upgrade",
        "4. 启动 ~/DevToolsBridges/adb-bridge 与 git-bridge 下的 start-mac.command",
      ].join("\n");
    } else {
      hint.textContent = [
        "Linux：",
        "1. chmod +x install-devtools-env.sh && ./install-devtools-env.sh",
        "2. check / upgrade / bridges 同上",
        "3. 启动 ~/DevToolsBridges/*/start-linux.sh",
        "注：部分发行版装 ADB/FFmpeg 需要 sudo。",
      ].join("\n");
    }
    try {
      localStorage.setItem("devtools-envkit-os", next);
    } catch (_) {}
  }

  async function probeOne(b) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
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
      if (!res.ok) {
        return { ok: false, title: b.name, text: `HTTP ${res.status}`, link: b.link };
      }
      const ver = data.version || data.bridgeVersion || "?";
      const extra = data.git || data.ffmpeg || data.adb || data.service || "";
      return {
        ok: true,
        title: b.name,
        text: `在线 · v${ver}${extra ? " · " + String(extra).slice(0, 60) : ""}`,
        link: b.link,
      };
    } catch (e) {
      clearTimeout(timer);
      return { ok: false, title: b.name, text: "未连接（先跑脚本并启动桥）", link: b.link };
    }
  }

  function renderProbe(rows) {
    grid.innerHTML = "";
    for (const r of rows) {
      const card = document.createElement("div");
      card.className = "env-probe-card " + (r.ok ? "is-ok" : "is-err");
      card.innerHTML = `
        <span class="adb-dot ${r.ok ? "is-ok" : "is-err"}" aria-hidden="true"></span>
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
    for (const b of BRIDGES) {
      rows.push(await probeOne(b));
    }
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
