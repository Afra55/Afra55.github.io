(() => {
  "use strict";

  const K = window.DevToolsExtraKit;
  if (!K) return;
  const { $, bindPanel, toast } = K;
  const QR = () => window.DevToolsDocQualityRouter || {};

  const DEFAULT_BASE = "http://127.0.0.1:17888";
  const DEFAULT_TOKEN = "devtools-bridge";
  const BASE_KEY = "devtools-docfmt-base";
  const TOKEN_KEY = "devtools-docfmt-token";

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function downloadBlob(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name || "out.bin";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const s = String(reader.result || "");
        const i = s.indexOf(",");
        resolve(i >= 0 ? s.slice(i + 1) : s);
      };
      reader.onerror = () => reject(reader.error || new Error("读文件失败"));
      reader.readAsDataURL(file);
    });
  }

  bindPanel("docfmt", () => {
    if (!window.devtoolsBridgeShell?.mount) return;

    const shell = window.devtoolsBridgeShell.mount({
      host: "#docfmt-bridge-shell",
      prefix: "docfmt",
      kind: "unified",
      collapseAdvanced: true,
      refreshLabel: "刷新",
      hintDisconnected: "请先下载完整 ZIP 并启动统一桥；文档互转需要 Pandoc / MinerU。",
      connHint:
        '共用统一桥 <strong>17888</strong> · Token <span class="mono">devtools-bridge</span> · <span class="mono">/pandoc</span> · <span class="mono">/mineru</span> · <span class="mono">/docling</span>',
    });

    const baseInput = shell.els.base;
    const tokenInput = shell.els.token;
    const errorEl = $("#docfmt-error");
    const logEl = $("#docfmt-log");
    const outEl = $("#docfmt-out");

    try {
      const b = localStorage.getItem(BASE_KEY);
      const t = localStorage.getItem(TOKEN_KEY);
      if (b && baseInput) baseInput.value = b;
      if (t && tokenInput) tokenInput.value = t;
    } catch (_) {}

    const baseUrl = () => String(baseInput?.value || DEFAULT_BASE).replace(/\/$/, "");
    const token = () => String(tokenInput?.value || DEFAULT_TOKEN).trim();
    const setError = (m) => {
      if (!errorEl) return;
      errorEl.hidden = !m;
      errorEl.textContent = m || "";
    };
    const log = (m) => {
      if (logEl) logEl.textContent = m || "";
    };

    let tab = "to-md";
    /** @type {File[]} */
    let filesIn = [];
    /** @type {File|null} */
    let fileOut = null;

    function persist() {
      try {
        localStorage.setItem(BASE_KEY, baseUrl());
        localStorage.setItem(TOKEN_KEY, token());
      } catch (_) {}
    }

    async function bridgeFetch(path, opts = {}) {
      persist();
      const headers = {
        "X-Adb-Token": token(),
        "X-Ffmpeg-Token": token(),
        ...(opts.headers || {}),
      };
      const res = await fetch(`${baseUrl()}${path}`, { ...opts, headers });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      return data;
    }

    async function probe(mount, key) {
      try {
        const res = await fetch(`${baseUrl()}/${mount}/health`, { cache: "no-store" });
        const data = await res.json().catch(() => null);
        const eng = data?.[key];
        return { bridge: true, ready: !!(res.ok && data?.ok && eng?.ok), error: eng?.error || "" };
      } catch (_) {
        return { bridge: false, ready: false, error: "桥未启动" };
      }
    }

    function setTab(next) {
      tab = next;
      document.querySelectorAll("#docfmt .docfmt-tab").forEach((btn) => {
        const on = btn.dataset.tab === next;
        btn.classList.toggle("is-on", on);
        btn.setAttribute("aria-selected", on ? "true" : "false");
      });
      document.querySelectorAll("#docfmt .docfmt-pane").forEach((pane) => {
        pane.hidden = pane.dataset.pane !== next;
      });
    }

    function renderInList() {
      const ul = $("#docfmt-list-in");
      if (!ul) return;
      const R = QR();
      ul.innerHTML = filesIn
        .map((f) => {
          const route = R.importRoute?.(f.name, f.type) || { primary: "?", chain: [] };
          return `<li><span>${escapeHtml(f.name)} · ${Math.round(f.size / 1024)} KB</span><span class="hint tight">${escapeHtml(
            (route.chain || []).join(" → ") || route.primary || ""
          )}</span></li>`;
        })
        .join("");
      const meta = $("#docfmt-meta-in");
      if (meta) meta.textContent = filesIn.length ? `已选 ${filesIn.length} 个文件` : meta.dataset.def || meta.textContent;
    }

    function bindDrop(el, onFiles) {
      if (!el) return;
      el.addEventListener("dragover", (e) => {
        e.preventDefault();
        el.classList.add("is-over");
      });
      el.addEventListener("dragleave", () => el.classList.remove("is-over"));
      el.addEventListener("drop", (e) => {
        e.preventDefault();
        el.classList.remove("is-over");
        onFiles([...(e.dataTransfer?.files || [])]);
      });
    }

    async function convertOneToMd(file) {
      const R = QR();
      const route = R.importRoute?.(file.name, file.type) || { chain: ["mineru", "docling"], primary: "mineru" };
      const forceOcr = /\.(png|jpe?g|webp|gif|tiff?|bmp|jp2)$/i.test(file.name) || /^image\//i.test(file.type);
      const [pandocH, mineruH, doclingH] = await Promise.all([
        probe("pandoc", "pandoc"),
        probe("mineru", "mineru"),
        probe("docling", "docling"),
      ]);
      const ready = { pandoc: pandocH.ready, mineru: mineruH.ready, docling: doclingH.ready };
      const chain = (route.chain || []).filter((e) => e !== "raw" && e !== "browser" && ready[e]);
      if (!chain.length) {
        throw new Error(
          !pandocH.bridge && !mineruH.bridge
            ? "本机桥未启动"
            : `无可用引擎（需 Pandoc/MinerU）。路由：${(route.chain || []).join("→")}`
        );
      }
      let lastErr = null;
      for (const eng of chain) {
        log(`${file.name} · 尝试 ${eng}…`);
        try {
          const dataBase64 = await fileToBase64(file);
          const body =
            eng === "pandoc"
              ? { filename: file.name, dataBase64, to: "gfm", quality: "max" }
              : { filename: file.name, dataBase64, forceOcr };
          const data = await bridgeFetch(`/${eng}/convert`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          const md = String(data.markdown || "").trim();
          if (!md) throw new Error("输出为空");
          return { md, via: eng, name: file.name.replace(/\.[^.]+$/, "") + ".md" };
        } catch (err) {
          lastErr = err;
          log(`${file.name} · ${eng} 失败：${err.message || err}`);
        }
      }
      throw lastErr || new Error("转换失败");
    }

    async function runToMd() {
      setError("");
      outEl.hidden = true;
      outEl.innerHTML = "";
      if (!filesIn.length) {
        setError("请先选择文档");
        return;
      }
      const links = [];
      for (let i = 0; i < filesIn.length; i += 1) {
        const f = filesIn[i];
        log(`（${i + 1}/${filesIn.length}）${f.name}`);
        try {
          const r = await convertOneToMd(f);
          const blob = new Blob([r.md], { type: "text/markdown;charset=utf-8" });
          const url = URL.createObjectURL(blob);
          links.push(
            `<a download="${escapeHtml(r.name)}" href="${url}">下载 ${escapeHtml(r.name)}</a><span class="hint tight">via ${escapeHtml(r.via)}</span>`
          );
          downloadBlob(blob, r.name);
        } catch (err) {
          setError(`${f.name}：${err.message || err}`);
          return;
        }
      }
      outEl.hidden = false;
      outEl.innerHTML = links.join("<br>");
      log(`完成 ${filesIn.length} 个 → Markdown（最高规格路由）`);
      toast("已转换并开始下载");
    }

    async function runFromMd() {
      setError("");
      outEl.hidden = true;
      let text = String($("#docfmt-md-text")?.value || "");
      let title = "document";
      if (fileOut) {
        text = await fileOut.text();
        title = fileOut.name.replace(/\.[^.]+$/, "") || title;
      }
      if (!text.trim()) {
        setError("请粘贴 Markdown 或选择 .md 文件");
        return;
      }
      const to = String($("#docfmt-to-fmt")?.value || "docx");
      const plan = QR().exportPandocPlan?.(to) || { from: "gfm" };
      log(`Pandoc 导出 · gfm → ${to} · ${to === "pdf" ? "印刷级 PDF" : "quality=max"}…`);
      async function doConvert() {
        return bridgeFetch("/pandoc/convert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            to,
            from: plan.from || "gfm",
            title,
            quality: to === "pdf" ? "print" : "max",
          }),
        });
      }
      try {
        let data;
        try {
          data = await doConvert();
        } catch (err) {
          const msg = String(err?.message || err);
          if (to === "pdf" && /印刷级 PDF 引擎|Typst|XeLaTeX/i.test(msg)) {
            log("未找到 Typst，尝试一键安装…");
            await bridgeFetch("/pandoc/install", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ package: "typst" }),
            });
            data = await doConvert();
          } else {
            throw err;
          }
        }
        const bytes = Uint8Array.from(atob(data.dataBase64 || ""), (c) => c.charCodeAt(0));
        const name = data.filename || `${title}.${to}`;
        downloadBlob(new Blob([bytes]), name);
        outEl.hidden = false;
        const via = data.pdfEngine ? `印刷级 · ${data.pdfEngine}` : "Pandoc 最高质量";
        outEl.innerHTML = `<span class="hint tight">已导出 ${escapeHtml(name)}（${escapeHtml(via)}）</span>`;
        log(`完成 · ${name}${data.pdfEngine ? ` · engine=${data.pdfEngine}` : ""}`);
        toast("导出完成");
      } catch (err) {
        setError(err.message || String(err));
      }
    }

    document.querySelectorAll("#docfmt .docfmt-tab").forEach((btn) => {
      btn.addEventListener("click", () => setTab(btn.dataset.tab || "to-md"));
    });

    $("#docfmt-file-in")?.addEventListener("change", (e) => {
      filesIn = [...(e.target.files || [])];
      renderInList();
    });
    $("#docfmt-clear-in")?.addEventListener("click", () => {
      filesIn = [];
      if ($("#docfmt-file-in")) $("#docfmt-file-in").value = "";
      renderInList();
      log("");
    });
    bindDrop($("#docfmt-drop-in"), (list) => {
      filesIn = list.filter(Boolean);
      renderInList();
    });
    $("#docfmt-run-in")?.addEventListener("click", () => void runToMd());

    $("#docfmt-file-out")?.addEventListener("change", async (e) => {
      fileOut = e.target.files?.[0] || null;
      if (fileOut) {
        $("#docfmt-md-text").value = await fileOut.text();
        $("#docfmt-meta-out").textContent = `已载入 ${fileOut.name}`;
      }
    });
    $("#docfmt-clear-out")?.addEventListener("click", () => {
      fileOut = null;
      if ($("#docfmt-file-out")) $("#docfmt-file-out").value = "";
      if ($("#docfmt-md-text")) $("#docfmt-md-text").value = "";
      $("#docfmt-meta-out").textContent = "也可直接粘贴下方正文。导出经 Pandoc（gfm → 目标，quality=max）。";
    });
    bindDrop($("#docfmt-drop-out"), async (list) => {
      const f = list.find((x) => /\.(md|markdown|txt)$/i.test(x.name));
      if (!f) return;
      fileOut = f;
      $("#docfmt-md-text").value = await f.text();
      $("#docfmt-meta-out").textContent = `已载入 ${f.name}`;
    });
    $("#docfmt-run-out")?.addEventListener("click", () => void runFromMd());

    const metaIn = $("#docfmt-meta-in");
    if (metaIn) metaIn.dataset.def = metaIn.textContent;
    renderInList();
    setTab("to-md");
  });
})();
