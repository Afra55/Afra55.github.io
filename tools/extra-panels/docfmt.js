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

  /** Pandoc 可直接读的扩展名（与桥 FILE_FROM 对齐） */
  const PANDOC_READ_EXT =
    /\.(docx|odt|epub|html?|shtml|rtf|rst|tex|latex|pptx|xlsx|csv|tsv|md|markdown|org)$/i;

  const OUT_EXT = {
    docx: "docx",
    pdf: "pdf",
    odt: "odt",
    html: "html",
    epub: "epub",
    rtf: "rtf",
    pptx: "pptx",
    latex: "tex",
    gfm: "md",
    markdown: "md",
    rst: "rst",
    org: "org",
    mediawiki: "wiki",
  };

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

  function b64ToBytes(b64) {
    const bin = atob(String(b64 || ""));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  }

  function stemName(name) {
    return String(name || "document").replace(/\.[^.]+$/, "") || "document";
  }

  bindPanel("docfmt", () => {
    if (!window.devtoolsBridgeShell?.mount) return;

    const shell = window.devtoolsBridgeShell.mount({
      host: "#docfmt-bridge-shell",
      prefix: "docfmt",
      kind: "unified",
      collapseAdvanced: true,
      refreshLabel: "刷新",
      hintDisconnected: "请先下载完整 ZIP 并启动统一桥；格式互转需要 Pandoc（PDF/扫描件另需 MinerU）。",
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

    let tab = "any";
    /** @type {File[]} */
    let filesAny = [];
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

    function routeLabel(file) {
      const R = QR();
      const route = R.importRoute?.(file.name, file.type) || { primary: "?", chain: [] };
      return (route.chain || []).join(" → ") || route.primary || "";
    }

    function renderList(ulId, files, metaId) {
      const ul = $(ulId);
      if (!ul) return;
      ul.innerHTML = files
        .map(
          (f) =>
            `<li><span>${escapeHtml(f.name)} · ${Math.round(f.size / 1024)} KB</span><span class="hint tight">${escapeHtml(
              routeLabel(f)
            )}</span></li>`
        )
        .join("");
      const meta = $(metaId);
      if (meta) meta.textContent = files.length ? `已选 ${files.length} 个文件` : meta.dataset.def || meta.textContent;
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
          return { md, via: eng, name: `${stemName(file.name)}.md` };
        } catch (err) {
          lastErr = err;
          log(`${file.name} · ${eng} 失败：${err.message || err}`);
        }
      }
      throw lastErr || new Error("转换失败");
    }

    async function pandocFileTo(file, toFmt) {
      const dataBase64 = await fileToBase64(file);
      async function once() {
        return bridgeFetch("/pandoc/convert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            dataBase64,
            to: toFmt,
            quality: toFmt === "pdf" ? "print" : "max",
          }),
        });
      }
      try {
        return await once();
      } catch (err) {
        const msg = String(err?.message || err);
        if (toFmt === "pdf" && /印刷级 PDF 引擎|Typst|XeLaTeX/i.test(msg)) {
          log("未找到 Typst，尝试一键安装…");
          await bridgeFetch("/pandoc/install", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ package: "typst" }),
          });
          return once();
        }
        throw err;
      }
    }

    async function pandocMdTo(text, toFmt, title) {
      const plan = QR().exportPandocPlan?.(toFmt) || { from: "gfm" };
      async function once() {
        return bridgeFetch("/pandoc/convert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            to: toFmt,
            from: plan.from || "gfm",
            title,
            quality: toFmt === "pdf" ? "print" : "max",
          }),
        });
      }
      try {
        return await once();
      } catch (err) {
        const msg = String(err?.message || err);
        if (toFmt === "pdf" && /印刷级 PDF 引擎|Typst|XeLaTeX/i.test(msg)) {
          log("未找到 Typst，尝试一键安装…");
          await bridgeFetch("/pandoc/install", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ package: "typst" }),
          });
          return once();
        }
        throw err;
      }
    }

    /**
     * 任意格式 → 目标：
     * - Pandoc 可读源：直接文件转换（含 Word→PDF）
     * - PDF/扫描/旧 .doc：质量路由 → MD → 再 Pandoc 转出
     */
    async function convertOneAny(file, toFmt) {
      const to = String(toFmt || "docx").toLowerCase();
      const outExt = OUT_EXT[to] || to;
      const srcExt = (file.name.match(/\.[^.]+$/) || [""])[0].toLowerCase();
      if (srcExt && `.${outExt}` === srcExt) {
        throw new Error("源格式与目标相同，无需转换");
      }

      if (to === "gfm" || to === "markdown") {
        const r = await convertOneToMd(file);
        return {
          bytes: new TextEncoder().encode(r.md),
          name: r.name,
          via: r.via,
        };
      }

      // Markdown 源：走文本导出
      if (/\.(md|markdown|txt)$/i.test(file.name) || /^text\/(markdown|plain)/i.test(file.type)) {
        log(`${file.name} · Pandoc 文本导出 → ${to}…`);
        const text = await file.text();
        const data = await pandocMdTo(text, to, stemName(file.name));
        return {
          bytes: b64ToBytes(data.dataBase64),
          name: data.filename || `${stemName(file.name)}.${outExt}`,
          via: data.pdfEngine ? `pandoc·${data.pdfEngine}` : "pandoc",
        };
      }

      // Pandoc 可直接读：docx→pdf / html→docx 等
      if (PANDOC_READ_EXT.test(file.name)) {
        log(`${file.name} · Pandoc 直接互转 → ${to}…`);
        try {
          const data = await pandocFileTo(file, to);
          if (data.markdown && (to === "gfm" || to === "markdown")) {
            return {
              bytes: new TextEncoder().encode(data.markdown),
              name: `${stemName(file.name)}.md`,
              via: "pandoc",
            };
          }
          if (!data.dataBase64) throw new Error("输出为空");
          return {
            bytes: b64ToBytes(data.dataBase64),
            name: data.filename || `${stemName(file.name)}.${outExt}`,
            via: data.pdfEngine ? `pandoc·${data.pdfEngine}` : "pandoc",
          };
        } catch (err) {
          log(`${file.name} · Pandoc 直接转换失败：${err.message || err}；尝试经 Markdown 中转…`);
        }
      } else {
        log(`${file.name} · 非 Pandoc 直读格式，经质量路由 → Markdown → ${to}…`);
      }

      // PDF / 图片 / 旧 doc / Pandoc 失败：先转 MD 再转出
      const mid = await convertOneToMd(file);
      log(`${file.name} · 已得 Markdown（via ${mid.via}），再导出 ${to}…`);
      const data = await pandocMdTo(mid.md, to, stemName(file.name));
      if (!data.dataBase64) throw new Error("导出为空");
      return {
        bytes: b64ToBytes(data.dataBase64),
        name: data.filename || `${stemName(file.name)}.${outExt}`,
        via: `${mid.via}→pandoc${data.pdfEngine ? "·" + data.pdfEngine : ""}`,
      };
    }

    async function runAny() {
      setError("");
      outEl.hidden = true;
      outEl.innerHTML = "";
      if (!filesAny.length) {
        setError("请先选择文档");
        return;
      }
      const to = String($("#docfmt-any-to")?.value || "docx");
      const links = [];
      for (let i = 0; i < filesAny.length; i += 1) {
        const f = filesAny[i];
        log(`（${i + 1}/${filesAny.length}）${f.name} → ${to}`);
        try {
          const r = await convertOneAny(f, to);
          const blob = new Blob([r.bytes]);
          const url = URL.createObjectURL(blob);
          links.push(
            `<a download="${escapeHtml(r.name)}" href="${url}">下载 ${escapeHtml(r.name)}</a><span class="hint tight">via ${escapeHtml(
              r.via
            )}</span>`
          );
          downloadBlob(blob, r.name);
        } catch (err) {
          setError(`${f.name}：${err.message || err}`);
          return;
        }
      }
      outEl.hidden = false;
      outEl.innerHTML = links.join("<br>");
      log(`完成 ${filesAny.length} 个 → ${to}`);
      toast("互转完成并开始下载");
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
        title = stemName(fileOut.name) || title;
      }
      if (!text.trim()) {
        setError("请粘贴 Markdown 或选择 .md 文件");
        return;
      }
      const to = String($("#docfmt-to-fmt")?.value || "docx");
      log(`Pandoc 导出 · gfm → ${to} · ${to === "pdf" ? "印刷级 PDF" : "quality=max"}…`);
      try {
        const data = await pandocMdTo(text, to, title);
        const bytes = b64ToBytes(data.dataBase64);
        const name = data.filename || `${title}.${OUT_EXT[to] || to}`;
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
      btn.addEventListener("click", () => setTab(btn.dataset.tab || "any"));
    });

    $("#docfmt-file-any")?.addEventListener("change", (e) => {
      filesAny = [...(e.target.files || [])];
      renderList("#docfmt-list-any", filesAny, "#docfmt-meta-any");
    });
    $("#docfmt-clear-any")?.addEventListener("click", () => {
      filesAny = [];
      if ($("#docfmt-file-any")) $("#docfmt-file-any").value = "";
      renderList("#docfmt-list-any", filesAny, "#docfmt-meta-any");
      log("");
    });
    bindDrop($("#docfmt-drop-any"), (list) => {
      filesAny = list.filter(Boolean);
      renderList("#docfmt-list-any", filesAny, "#docfmt-meta-any");
    });
    $("#docfmt-run-any")?.addEventListener("click", () => void runAny());

    $("#docfmt-file-in")?.addEventListener("change", (e) => {
      filesIn = [...(e.target.files || [])];
      renderList("#docfmt-list-in", filesIn, "#docfmt-meta-in");
    });
    $("#docfmt-clear-in")?.addEventListener("click", () => {
      filesIn = [];
      if ($("#docfmt-file-in")) $("#docfmt-file-in").value = "";
      renderList("#docfmt-list-in", filesIn, "#docfmt-meta-in");
      log("");
    });
    bindDrop($("#docfmt-drop-in"), (list) => {
      filesIn = list.filter(Boolean);
      renderList("#docfmt-list-in", filesIn, "#docfmt-meta-in");
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

    async function connectBridge() {
      persist();
      shell.setStatus("is-warn", "正在连接本机桥…", baseUrl());
      try {
        const BT = window.devtoolsBridgeToken;
        let base = baseUrl();
        const found = await BT?.discoverBase?.(base, token(), { kind: "unified" });
        if (found?.base) {
          base = found.base;
          if (baseInput) baseInput.value = base;
        }
        let health = found?.health || null;
        if (!health?.ok) {
          const res = await fetch(`${base}/health`, { cache: "no-store" });
          health = await res.json().catch(() => null);
          if (!res.ok || !health?.ok) throw new Error(health?.error || "本机桥无响应（请确认 17888 已启动）");
        }
        const ver = health.version || "?";
        shell.setStatus(
          "is-ok",
          "已连接本机桥",
          `统一桥 ${base} · v${ver} · /pandoc · /mineru · /docling`
        );
        if (shell.els.refresh) shell.els.refresh.disabled = false;
      } catch (err) {
        const msg = err?.message || String(err);
        shell.setStatus("is-err", "未连接本机桥", msg);
        if (shell.els.refresh) shell.els.refresh.disabled = false;
      }
    }

    shell.bind({
      onConnect: () => void connectBridge(),
      onRefresh: () => void connectBridge(),
      onConnected: async (found) => {
        if (found?.base && baseInput) baseInput.value = found.base;
        await connectBridge();
      },
      onPersist: persist,
      toast,
    });

    const metaAny = $("#docfmt-meta-any");
    if (metaAny) metaAny.dataset.def = metaAny.textContent;
    const metaIn = $("#docfmt-meta-in");
    if (metaIn) metaIn.dataset.def = metaIn.textContent;
    renderList("#docfmt-list-any", filesAny, "#docfmt-meta-any");
    renderList("#docfmt-list-in", filesIn, "#docfmt-meta-in");
    setTab("any");
    void connectBridge();
  });
})();
