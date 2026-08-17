#!/usr/bin/env node
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PORT = 8766;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    let rel = urlPath === "/" ? "/tools/index.html" : urlPath;
    const file = path.join(ROOT, rel.replace(/^\//, ""));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    const ext = path.extname(file);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

async function loadPuppeteer() {
  try {
    return require("puppeteer-core");
  } catch (_) {
    const { execSync } = require("child_process");
    execSync("npm install --no-save puppeteer-core@23", { stdio: "inherit", cwd: "/tmp" });
    return require("/tmp/node_modules/puppeteer-core");
  }
}

async function main() {
  const puppeteer = await loadPuppeteer();
  const server = await startServer();
  const chromePath = ["/usr/bin/google-chrome-stable", "/usr/local/bin/google-chrome", "/usr/bin/google-chrome"].find(
    (p) => fs.existsSync(p)
  );
  if (!chromePath) throw new Error("google-chrome not found");

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });

  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err.message || err)));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (/ERR_CONNECTION_REFUSED|fonts\.googleapis|fonts\.gstatic|net::ERR_|status of 404/i.test(text)) return;
    errors.push(`console: ${text}`);
  });

  await page.goto(`http://127.0.0.1:${PORT}/tools/index.html#memo`, {
    waitUntil: "networkidle0",
    timeout: 60000,
  });

  // wait for memo boot
  await page.waitForFunction(() => window.DevToolsMemo && document.querySelector("#memo.is-workspace-active"), {
    timeout: 15000,
  });

  const result = await page.evaluate(async () => {
    const out = {
      panelActive: document.querySelector("#memo")?.classList.contains("is-workspace-active"),
      hasEditor: Boolean(document.getElementById("memo-editor")),
      hasList: Boolean(document.getElementById("memo-list")),
      version: document.getElementById("site-tools-version")?.textContent || "",
      preserveOk: true,
      steps: [],
    };

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    // save text
    const editor = document.getElementById("memo-editor");
    editor.value = "冒烟测试文本 ABC 你好";
    document.getElementById("memo-save-text").click();
    await sleep(400);
    out.steps.push({ saveText: (window.DevToolsMemo.getIndex().items || []).length >= 1 });

    // paste image via ClipboardEvent is hard; ingest via file input DataTransfer simulation
    const png = await (async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 24;
      canvas.height = 24;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#2ec4b6";
      ctx.fillRect(0, 0, 24, 24);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      return new File([blob], "smoke.png", { type: "image/png" });
    })();

    const dt = new DataTransfer();
    dt.items.add(png);
    const input = document.getElementById("memo-file");
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(600);
    const items = window.DevToolsMemo.getIndex().items || [];
    out.steps.push({
      addImage: items.some((it) => it.type === "image"),
      count: items.length,
    });

    // tag create via searchable dialog
    document.getElementById("memo-tag-new").click();
    await sleep(80);
    const tagInput = document.getElementById("memo-tag-search");
    tagInput.value = "工作";
    tagInput.dispatchEvent(new Event("input", { bubbles: true }));
    document.getElementById("memo-tag-ok").click();
    await sleep(250);
    out.steps.push({
      tagCreated: (window.DevToolsMemo.getIndex().tags || []).some((t) => t.name === "工作"),
      stillOnAll: Boolean(document.querySelector('.memo-tag-item.is-active[data-memo-tag="all"]')),
    });

    // export zip
    const dlg = document.getElementById("memo-export-dlg");
    document.getElementById("memo-export").click();
    await sleep(100);
    out.steps.push({ exportDlgOpen: dlg.open });
    // close without export to avoid download side effects in headless
    dlg.close("cancel");

    // storage bytes API
    const bytes = await window.DevToolsMemo.getStorageBytes();
    out.steps.push({ storageBytes: Number(bytes) > 0, bytes });

    // temp preserve set check via source is elsewhere; verify API still works after fake purge call doesn't delete memo
    out.mode = window.DevToolsMemo.getMode();
    out.itemCount = (window.DevToolsMemo.getIndex().items || []).length;
    out.defaultTagHiddenOnCard = !document.querySelector(".memo-chip")?.textContent?.includes("默认");
    // cards should exist
    out.cardCount = document.querySelectorAll(".memo-card").length;
    // editor should be cleared after save (if UX applied)
    out.editorCleared = editor.value === "";

    // preview dialog plumbing
    out.preview = {
      hasVideo: Boolean(document.getElementById("memo-lightbox-video")),
      hasAudio: Boolean(document.getElementById("memo-lightbox-audio")),
      hasFs: Boolean(document.getElementById("memo-preview-fs")),
      hasFrame: Boolean(document.getElementById("memo-lightbox-frame")),
    };
    out.exportMerged = {
      hasExport: Boolean(document.getElementById("memo-export")),
      noShareBtn: !document.getElementById("memo-share"),
      exportLabel: document.getElementById("memo-export")?.textContent || "",
    };

    // memo focuses on store/retrieve; heavy tools stay standalone
    out.modules = {
      hasTextimg: Boolean(document.getElementById("textimg")),
      hasImgtext: Boolean(document.getElementById("imgtext")),
      hasTiSrc: Boolean(document.getElementById("ti-src")),
      hasSentinel: Boolean(document.getElementById("memo-scroll-sentinel")),
      memoStillActive: document.getElementById("memo")?.classList.contains("is-workspace-active"),
      noMemoToimg: !document.getElementById("memo-toimg") && !document.getElementById("memo-to-image"),
      noMemoOcr: !document.getElementById("memo-ocr") && !document.getElementById("memo-to-ocr"),
      primaryReadClip: document.getElementById("memo-read-clip")?.classList.contains("primary-btn"),
      copyOnCard: Boolean(document.querySelector(".memo-card-actions [data-memo-copy]")),
      captureBar: Boolean(document.querySelector(".memo-capture-bar")),
      quickText: Boolean(document.querySelector(".memo-capture-bar .memo-quick-text #memo-editor")),
      quickTextNotDetails: !document.querySelector("details#memo-editor-fold, details.memo-editor"),
      storageFold: Boolean(document.querySelector(".memo-storage-fold")),
      backupBar: Boolean(document.querySelector(".memo-backup-bar")),
      backupIsFold: document.querySelector(".memo-backup-bar")?.tagName === "DETAILS",
      exportOutsideFold: Boolean(document.querySelector(".memo-backup-bar #memo-export")),
      exportToDirBtn: Boolean(document.getElementById("memo-export-to-dir")),
      dirHint: Boolean(document.getElementById("memo-dir-hint")),
      batchInList: Boolean(document.querySelector(".memo-list-head-actions #memo-batch-del")),
      importPassDlg: Boolean(document.getElementById("memo-import-pass-dlg")),
      pathRelabel: /新标签/.test(document.getElementById("memo-preview-path")?.textContent || ""),
      selectAllScope: /筛选结果/.test(document.querySelector(".memo-select-all-text")?.textContent || ""),
      previewCopy: Boolean(document.getElementById("memo-preview-copy")),
      autoclipRemember: /记住/.test(document.querySelector(".memo-autoclip-flag")?.textContent || ""),
      mobilePasteHint: Boolean(document.querySelector(".memo-hint-narrow")),
      clearFilters: Boolean(document.getElementById("memo-clear-filters")),
      friendlySearch: /标签名/.test(document.getElementById("memo-search")?.placeholder || ""),
      hasUndoBar: Boolean(document.getElementById("memo-undo-bar")),
      hasProgressCancel: Boolean(document.getElementById("memo-progress-cancel")),
      hasTagsToggle: Boolean(document.getElementById("memo-tags-toggle")),
      hasTagsPanel: Boolean(document.getElementById("memo-tags-panel")),
    };

    // inline text edit dialog
    const textItem = (window.DevToolsMemo.getIndex().items || []).find((it) => it.type === "text");
    out.textEdit = {
      hasDlg: Boolean(document.getElementById("memo-text-edit")),
      hasPreviewEdit: Boolean(document.getElementById("memo-preview-edit")),
      hasEditBtn: Boolean(document.querySelector(".memo-more [data-memo-edit], [data-memo-edit]")),
      itemId: textItem?.id || "",
    };
    if (textItem) {
      document.querySelector(`.memo-more [data-memo-edit="${textItem.id}"], [data-memo-edit="${textItem.id}"]`)?.click();
      await sleep(120);
      const editDlg = document.getElementById("memo-text-edit");
      const editSrc = document.getElementById("memo-text-edit-src");
      out.textEdit.opened = Boolean(editDlg?.open);
      out.textEdit.memoStillActive = document.getElementById("memo")?.classList.contains("is-workspace-active");
      out.textEdit.loaded = (editSrc?.value || "").includes("冒烟测试文本");
      out.textEdit.cardEditing = Boolean(document.querySelector(`.memo-card.is-editing[data-memo-id="${textItem.id}"]`));
      if (editSrc) {
        editSrc.value = "冒烟测试文本 ABC 你好（已编辑）";
        editSrc.dispatchEvent(new Event("input", { bubbles: true }));
      }
      document.getElementById("memo-text-edit-save")?.click();
      await sleep(400);
      const updated = (window.DevToolsMemo.getIndex().items || []).find((x) => x.id === textItem.id);
      out.textEdit.saved = (updated?.textPreview || "").includes("已编辑");
      out.textEdit.closed = !editDlg?.open;
      out.textEdit.editingCleared = !document.querySelector(".memo-card.is-editing");
    }

    // open image preview via more menu (primary row keeps copy/download only)
    const openBtn = document.querySelector(".memo-more [data-memo-open], [data-memo-open]");
    if (openBtn) {
      openBtn.click();
      await sleep(300);
      out.preview.opened = Boolean(document.getElementById("memo-lightbox")?.open);
      out.preview.videoHiddenWhenTextOrImg = Boolean(
        document.getElementById("memo-lightbox-video")?.hidden ||
          getComputedStyle(document.getElementById("memo-lightbox-video")).display === "none"
      );
      document.getElementById("memo-lightbox-close")?.click();
      await sleep(100);
      out.preview.closed = !document.getElementById("memo-lightbox")?.open;
    }

    // text content: single click opens preview + line truncation rules
    const textPre = document.querySelector(".memo-text[data-memo-expand]");
    out.textClick = {
      hasPre: Boolean(textPre),
      noCardScroll: textPre ? getComputedStyle(textPre).overflow.includes("hidden") || getComputedStyle(textPre).overflowY === "hidden" : false,
    };
    if (textPre) {
      textPre.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
      await sleep(350);
      out.textClick.previewOpened = Boolean(document.getElementById("memo-lightbox")?.open);
      const vid = document.getElementById("memo-lightbox-video");
      out.textClick.noVideoAbove = Boolean(vid?.hidden) && getComputedStyle(vid).display === "none";
      const txt = document.getElementById("memo-lightbox-text");
      out.textClick.textShown = Boolean(txt) && !txt.hidden && getComputedStyle(txt).display !== "none";
      out.textClick.previewKindText = document.getElementById("memo-lightbox")?.dataset?.previewKind === "text";
      document.getElementById("memo-lightbox-close")?.click();
      await sleep(80);
    }

    // long text (>50 lines) should truncate on card; short text shows fully
    const longBody = Array.from({ length: 60 }, (_, i) => `行${i + 1} 长文本冒烟`).join("\n");
    await window.DevToolsMemo.ingestBlob(new Blob([longBody], { type: "text/plain" }), "long-60.txt");
    await sleep(350);
    const longItem = (window.DevToolsMemo.getIndex().items || []).find((it) => it.type === "text" && /行1 长文本冒烟/.test(it.textPreview || ""));
    const longCard = longItem ? document.querySelector(`.memo-card[data-memo-id="${longItem.id}"] .memo-text`) : null;
    out.textLines = {
      hasLong: Boolean(longItem),
      truncatedClass: Boolean(longCard?.classList.contains("is-truncated")),
      moreHint: /共\s*60\s*行/.test(longCard?.textContent || ""),
      noLine60: !/行60/.test(longCard?.textContent || ""),
      shortFull: Boolean(textPre) && !textPre.classList.contains("is-truncated"),
    };

    // long text preview must show full blob content (not clipped textPreview)
    if (longItem) {
      document.querySelector(`.memo-more [data-memo-open="${longItem.id}"], [data-memo-open="${longItem.id}"]`)?.click();
      await sleep(250);
      const fullTxt = document.getElementById("memo-lightbox-text")?.textContent || "";
      out.textLines.previewFull = /行60 长文本冒烟/.test(fullTxt) && fullTxt.split("\n").length >= 60;
      out.previewUi = {
        hasDel: Boolean(document.getElementById("memo-preview-del")),
        delVisible: !document.getElementById("memo-preview-del")?.hidden,
        hasPath: Boolean(document.getElementById("memo-preview-path")),
        wideEnough: (document.getElementById("memo-lightbox")?.getBoundingClientRect?.().width || 0) >= 480,
      };
      document.getElementById("memo-lightbox-close")?.click();
      await sleep(60);
    }

    // data:image URL text should ingest as image, not text
    const tinyPng =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const beforeCnt = (window.DevToolsMemo.getIndex().items || []).length;
    await window.DevToolsMemo.ingestBlob(new Blob([tinyPng], { type: "text/plain" }), "should-not-stay-text.txt");
    // also exercise addText path via paste-like API: use ingest after converting through internal by saving via editor flow
    // Prefer calling through clipboard-like text add: expose not available, so create via temporary textarea save is heavy.
    // Instead verify helper path: paste simulation
    const beforeTypes = (window.DevToolsMemo.getIndex().items || []).map((it) => it.type);
    document.getElementById("memo-editor").value = tinyPng;
    document.getElementById("memo-save-text")?.click();
    await sleep(500);
    const afterItems = window.DevToolsMemo.getIndex().items || [];
    out.dataUrlImg = {
      grew: afterItems.length >= beforeCnt,
      newestIsImage: afterItems[0]?.type === "image" || afterItems[0]?.type === "gif",
      notPlainDataText: !(afterItems[0]?.type === "text" && String(afterItems[0]?.textPreview || "").startsWith("data:image")),
    };

    // image preview: wheel zoom + drag pan
    const imgItem = (window.DevToolsMemo.getIndex().items || []).find((it) => it.type === "image" || it.type === "gif");
    out.imgZoom = { hasApi: typeof window.DevToolsMemo.getPreviewZoom === "function" };
    if (imgItem) {
      document.querySelector(`[data-memo-preview="${imgItem.id}"], [data-memo-open="${imgItem.id}"]`)?.click();
      await sleep(250);
      const wrap = document.getElementById("memo-zoom-wrap");
      const imgEl = document.getElementById("memo-lightbox-img");
      if (imgEl && !imgEl.complete) {
        await new Promise((resolve) => {
          imgEl.addEventListener("load", resolve, { once: true });
          setTimeout(resolve, 1500);
        });
      }
      await sleep(80);
      const z0 = window.DevToolsMemo.getPreviewZoom?.() || {};
      const rect = wrap?.getBoundingClientRect?.() || { left: 200, top: 200, width: 400, height: 400 };
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      for (let i = 0; i < 8; i += 1) {
        wrap?.dispatchEvent(
          new WheelEvent("wheel", {
            deltaY: -120,
            clientX: cx,
            clientY: cy,
            bubbles: true,
            cancelable: true,
          })
        );
      }
      const z1 = window.DevToolsMemo.getPreviewZoom?.() || {};
      wrap?.dispatchEvent(
        new PointerEvent("pointerdown", {
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
          clientX: cx,
          clientY: cy,
          bubbles: true,
          buttons: 1,
        })
      );
      wrap?.dispatchEvent(
        new PointerEvent("pointermove", {
          pointerId: 1,
          pointerType: "mouse",
          isPrimary: true,
          clientX: cx + 48,
          clientY: cy + 36,
          bubbles: true,
          buttons: 1,
        })
      );
      wrap?.dispatchEvent(
        new PointerEvent("pointerup", {
          pointerId: 1,
          pointerType: "mouse",
          bubbles: true,
        })
      );
      const z2 = window.DevToolsMemo.getPreviewZoom?.() || {};
      document.getElementById("memo-zoom-in")?.click();
      const z3 = window.DevToolsMemo.getPreviewZoom?.() || {};
      document.getElementById("memo-zoom-reset")?.click();
      const z4 = window.DevToolsMemo.getPreviewZoom?.() || {};
      const hud = document.querySelector(".memo-zoom-hud");
      const hudCs = hud ? getComputedStyle(hud) : null;
      out.imgZoom = {
        ...out.imgZoom,
        opened: Boolean(document.getElementById("memo-lightbox")?.open),
        wrapShown: Boolean(wrap) && !wrap.hidden,
        hud: Boolean(document.getElementById("memo-zoom-in") && document.getElementById("memo-zoom-out")),
        resetLabel: (document.getElementById("memo-zoom-reset")?.textContent || "").trim(),
        hudTop: Boolean(hudCs && parseFloat(hudCs.top) >= 0 && hudCs.bottom === "auto"),
        fitOk: Number(z0.fit) > 0 && Math.abs((z0.rel || 1) - 1) < 0.12,
        wheeled: Number(z1.scale) > Number(z0.scale) + 0.0001,
        panned: Math.abs((z2.x || 0) - (z1.x || 0)) > 0.5 || Math.abs((z2.y || 0) - (z1.y || 0)) > 0.5,
        btnZoom: Number(z3.scale) > Number(z2.scale) + 0.0001,
        resetOk: Math.abs((z4.rel || 1) - 1) < 0.12,
        pct: document.getElementById("memo-zoom-pct")?.textContent || "",
      };
      document.getElementById("memo-lightbox-close")?.click();
      await sleep(80);
    }

    // more menu closes when clicking outside
    const more = document.querySelector("details.memo-more");
    out.moreMenu = { has: Boolean(more) };
    if (more) {
      more.open = true;
      document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      await sleep(40);
      out.moreMenu.closesOutside = !more.open;
    }

    // type filter (flat list: no type groups)
    out.typeFilter = {
      host: Boolean(document.getElementById("memo-type-filter")),
      chips: document.querySelectorAll("#memo-type-filter [data-memo-type]").length,
      groups: document.querySelectorAll(".memo-type-group").length,
    };
    document.querySelector('#memo-type-filter [data-memo-type="image"]')?.click();
    await sleep(80);
    out.typeFilter.imageOnly =
      [...document.querySelectorAll(".memo-card")].every((c) => {
        const id = c.dataset.memoId;
        const it = (window.DevToolsMemo.getIndex().items || []).find((x) => x.id === id);
        return it?.type === "image";
      }) && document.querySelectorAll(".memo-card").length >= 1;
    document.querySelector('#memo-type-filter [data-memo-type="all"]')?.click();
    await sleep(80);
    out.typeFilter.flatAll = document.querySelectorAll(".memo-type-group").length === 0;

    // search + autoclip + gif type
    const search = document.getElementById("memo-search");
    out.searchUi = {
      hasSearch: Boolean(search),
      hasAutoclip: Boolean(document.getElementById("memo-autoclip")),
      autoclipDefaultOff: document.getElementById("memo-autoclip") ? !document.getElementById("memo-autoclip").checked : false,
      hasGifChip: Boolean(document.querySelector('#memo-type-filter [data-memo-type="gif"]')),
      hasLoadMore: Boolean(document.getElementById("memo-load-more")),
      hasSentinel: Boolean(document.getElementById("memo-scroll-sentinel")),
    };
    if (search) {
      search.value = "冒烟测试文本";
      search.dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(250);
      out.searchUi.hitText = [...document.querySelectorAll(".memo-card")].length >= 1;
      out.searchUi.onlyTextish = [...document.querySelectorAll(".memo-card")].every((c) => {
        const id = c.dataset.memoId;
        const it = (window.DevToolsMemo.getIndex().items || []).find((x) => x.id === id);
        return it && (it.type === "text" || (it.name || "").includes("冒烟") || (it.textPreview || "").includes("冒烟"));
      });
      search.value = "";
      search.dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(250);
    }
    // add gif file
    const gifBytes = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"), (c) => c.charCodeAt(0));
    const gifFile = new File([gifBytes], "smoke.gif", { type: "image/gif" });
    const dt2 = new DataTransfer();
    dt2.items.add(gifFile);
    const input2 = document.getElementById("memo-file");
    input2.files = dt2.files;
    input2.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(500);
    out.searchUi.gifTyped = (window.DevToolsMemo.getIndex().items || []).some((it) => it.type === "gif");
    document.querySelector('#memo-type-filter [data-memo-type="gif"]')?.click();
    await sleep(80);
    out.searchUi.gifFilter =
      [...document.querySelectorAll(".memo-card")].length >= 1 &&
      [...document.querySelectorAll(".memo-card")].every((c) => {
        const id = c.dataset.memoId;
        const it = (window.DevToolsMemo.getIndex().items || []).find((x) => x.id === id);
        return it?.type === "gif";
      });
    out.searchUi.gifBadge = Boolean(document.querySelector(".memo-anim-badge"));
    document.querySelector('#memo-type-filter [data-memo-type="all"]')?.click();
    await sleep(80);

    // content hash + undo delete
    const hashed = (window.DevToolsMemo.getIndex().items || []).filter((it) => it.contentHash);
    out.hardening = {
      contentHashCount: hashed.length,
      hasUndoBar: Boolean(document.getElementById("memo-undo-bar")),
      hasProgressCancel: Boolean(document.getElementById("memo-progress-cancel")),
      hasTagsToggle: Boolean(document.getElementById("memo-tags-toggle")),
    };
    const undoTarget = (window.DevToolsMemo.getIndex().items || []).find((it) => it.type === "gif") ||
      (window.DevToolsMemo.getIndex().items || [])[0];
    if (undoTarget) {
      const before = (window.DevToolsMemo.getIndex().items || []).length;
      const prevConfirm = window.confirm;
      window.confirm = () => true;
      document.querySelector(`[data-memo-del="${undoTarget.id}"]`)?.click();
      await sleep(120);
      out.hardening.deleted = (window.DevToolsMemo.getIndex().items || []).length === before - 1;
      out.hardening.undoVisible = !document.getElementById("memo-undo-bar")?.hidden;
      document.getElementById("memo-undo-btn")?.click();
      await sleep(200);
      window.confirm = prevConfirm;
      out.hardening.undone = (window.DevToolsMemo.getIndex().items || []).some((it) => it.id === undoTarget.id);
      out.hardening.undoHidden = Boolean(document.getElementById("memo-undo-bar")?.hidden);
    }

    // non-image/text: primary action should be download, not copy
    await window.DevToolsMemo.ingestBlob(new Blob(["smoke-file"], { type: "application/pdf" }), "smoke.pdf");
    await sleep(400);
    const fileItem = (window.DevToolsMemo.getIndex().items || []).find((it) => it.type === "file" || /\.pdf$/i.test(it.name || ""));
    const fileCard = fileItem ? document.querySelector(`.memo-card[data-memo-id="${fileItem.id}"]`) : null;
    out.takeout = {
      hasFile: Boolean(fileItem),
      primaryDownload: Boolean(fileCard?.querySelector(".memo-card-actions > .secondary-btn[data-memo-dl]")),
      noPrimaryCopy: !fileCard?.querySelector(".memo-card-actions > .secondary-btn[data-memo-copy]"),
      leanActions: Boolean(fileCard) && fileCard.querySelectorAll(".memo-card-actions > button, .memo-card-actions > details").length <= 2,
      textStillCopy: Boolean(document.querySelector('.memo-card-actions > .secondary-btn[data-memo-copy]')),
      imageStillCopy: Boolean(
        [...document.querySelectorAll(".memo-card")].some((card) => {
          const id = card.dataset.memoId;
          const it = (window.DevToolsMemo.getIndex().items || []).find((x) => x.id === id);
          return (it?.type === "image" || it?.type === "gif") && card.querySelector(".memo-card-actions > .secondary-btn[data-memo-copy]");
        })
      ),
      previewInMore: Boolean(fileCard?.querySelector(".memo-more [data-memo-open]")),
      noteInMore: Boolean(fileCard?.querySelector(".memo-more [data-memo-note]")),
    };

    out.shareUi = {
      hasPreviewShare: Boolean(document.getElementById("memo-preview-share")),
      api: typeof window.DevToolsMemo.setShareUiForTest === "function",
    };
    window.DevToolsMemo.setShareUiForTest(true);
    await sleep(80);
    const fileCardShare = fileItem ? document.querySelector(`.memo-card[data-memo-id="${fileItem.id}"]`) : null;
    const textCardShare = document.querySelector(".memo-card-actions > .secondary-btn[data-memo-copy]")?.closest(".memo-card");
    out.shareUi.filePrimaryDownload = Boolean(fileCardShare?.querySelector(".memo-card-actions > .secondary-btn[data-memo-dl]"));
    out.shareUi.fileShareInMore = Boolean(fileCardShare?.querySelector(".memo-more [data-memo-share]"));
    out.shareUi.textHasShare = Boolean(textCardShare?.querySelector(".memo-more [data-memo-share], [data-memo-share]"));
    out.shareUi.textKeepsCopy = Boolean(textCardShare?.querySelector(".memo-card-actions > .secondary-btn[data-memo-copy]"));
    // open preview to ensure share chrome shows
    if (fileItem) {
      document.querySelector(`.memo-more [data-memo-open="${fileItem.id}"], [data-memo-open="${fileItem.id}"]`)?.click();
      await sleep(120);
      out.shareUi.previewShareVisible = !document.getElementById("memo-preview-share")?.hidden;
      document.getElementById("memo-lightbox-close")?.click();
      await sleep(60);
    }
    window.DevToolsMemo.setShareUiForTest(false);

    out.p1p2 = {
      imageEst: window.DevToolsMemo.estimateCardHeight({ type: "image" }),
      fileEst: window.DevToolsMemo.estimateCardHeight({ type: "file" }),
      textEst: window.DevToolsMemo.estimateCardHeight({ type: "text" }),
      hasShareProbe: typeof window.DevToolsMemo.canShareFilesProbe === "function",
      aboutMentionsDownload: /下载/.test(
        document.querySelector('#about [data-tool="memo"], #about')?.textContent ||
          "" ||
          "本地备忘录：一键读剪贴板入库、搜索/点选筛选；文本图片可复制，其它类型可下载，手机可单条分享"
      ),
    };
    // about text lives in JS; assert via API contract of height estimates
    out.p1p2.heightOrderOk =
      out.p1p2.imageEst > out.p1p2.fileEst && out.p1p2.imageEst >= out.p1p2.textEst;

    // duplicate paste should bump existing item to front
    const bumpText = "冒烟去重置顶 UNIQUE_BUMP_TEXT_991";
    await window.DevToolsMemo.ingestText(bumpText);
    await sleep(350);
    // bury it under a newer item
    await window.DevToolsMemo.ingestText("冒烟去重垫底另一条");
    await sleep(350);
    const beforeIds = (window.DevToolsMemo.getIndex().items || []).map((x) => x.id);
    const buried = (window.DevToolsMemo.getIndex().items || []).find((it) => (it.textPreview || "").includes("UNIQUE_BUMP_TEXT_991"));
    out.dedupeBump = {
      buried: Boolean(buried) && beforeIds[0] !== buried?.id,
      buriedId: buried?.id || "",
    };
    await window.DevToolsMemo.ingestText(bumpText);
    await sleep(400);
    const after = window.DevToolsMemo.getIndex().items || [];
    out.dedupeBump.frontId = after[0]?.id || "";
    out.dedupeBump.movedFront = after[0]?.id === buried?.id;
    out.dedupeBump.noExtraCopy = after.filter((it) => (it.textPreview || "").includes("UNIQUE_BUMP_TEXT_991")).length === 1;

    const t0 = performance.now();
    const estBytes = await window.DevToolsMemo.getStorageBytes();
    const t1 = performance.now();
    const cache = window.DevToolsMemo.getCountCache?.() || {};
    out.scale = {
      ordered: window.DevToolsMemo.isOrdered?.() === true,
      countMatches: cache.total === (window.DevToolsMemo.getIndex().items || []).length,
      estimateMs: Math.round(t1 - t0),
      estimateFast: t1 - t0 < 80,
      estimateBytes: Number(estBytes) > 0,
      hasDragApi: typeof window.DevToolsMemo.canDragReorder === "function",
    };

    // tagged item leaves default (untagged) bucket
    const firstId = (window.DevToolsMemo.getIndex().items || [])[0]?.id;
    const workTag = (window.DevToolsMemo.getIndex().tags || []).find((t) => t.name === "工作");
    if (firstId && workTag) {
      document.querySelector(`[data-memo-tag-add="${firstId}"]`)?.click();
      await sleep(80);
      document.querySelector(`[data-memo-tag-pick="${workTag.id}"]`)?.click();
      await sleep(250);
      const tagged = (window.DevToolsMemo.getIndex().items || []).find((x) => x.id === firstId);
      out.tagLeavesDefault = {
        hasWork: Boolean(tagged?.tagIds?.includes(workTag.id)),
        noDefault: !(tagged?.tagIds || []).includes("default"),
      };
      document.querySelector('.memo-tag-item[data-memo-tag="default"]')?.click();
      await sleep(80);
      out.tagLeavesDefault.defaultViewHidesTagged = !document.querySelector(`.memo-card[data-memo-id="${firstId}"]`);
      document.querySelector('.memo-tag-item[data-memo-tag="all"]')?.click();
      await sleep(80);

      // delete tag without deleting items; item returns to default
      out.tagDelete = {
        hasDelBtn: Boolean(document.querySelector(`[data-memo-tag-del="${workTag.id}"]`)),
      };
      const prevConfirm = window.confirm;
      window.confirm = () => true;
      document.querySelector(`[data-memo-tag-del="${workTag.id}"]`)?.click();
      await sleep(250);
      window.confirm = prevConfirm;
      const afterDel = (window.DevToolsMemo.getIndex().items || []).find((x) => x.id === firstId);
      out.tagDelete.tagGone = !(window.DevToolsMemo.getIndex().tags || []).some((t) => t.id === workTag.id);
      out.tagDelete.itemKept = Boolean(afterDel);
      out.tagDelete.backToDefault =
        Boolean(afterDel) &&
        (afterDel.tagIds || []).includes("default") &&
        !(afterDel.tagIds || []).includes(workTag.id);
    } else {
      out.tagLeavesDefault = { hasWork: false, noDefault: false, defaultViewHidesTagged: false };
      out.tagDelete = { hasDelBtn: false, tagGone: false, itemKept: false, backToDefault: false };
    }

    // item notes: edit / search / clear + UX polish
    const noteTarget =
      (window.DevToolsMemo.getIndex().items || []).find((x) => x.type === "file") ||
      (window.DevToolsMemo.getIndex().items || [])[0];
    out.noteUi = {
      hasDlg: Boolean(document.getElementById("memo-note-edit")),
      hasPreviewBtn: Boolean(document.getElementById("memo-preview-note")),
      hasCardBtn: Boolean(document.querySelector("[data-memo-note]")),
      hasCount: Boolean(document.getElementById("memo-note-edit-count")),
      searchMentionsNote: /备注/.test(document.getElementById("memo-search")?.placeholder || ""),
      exportMentionsNote: /备注会随条目一起导出/.test(document.getElementById("memo-export-dlg")?.textContent || ""),
      delInMore: Boolean(document.querySelector(".memo-more [data-memo-del]")),
      itemId: noteTarget?.id || "",
    };
    if (noteTarget) {
      const cardBefore = document.querySelector(`.memo-card[data-memo-id="${noteTarget.id}"]`);
      out.noteUi.emptyHint = Boolean(cardBefore?.querySelector(".memo-card-note.is-empty"));
      document.querySelector(`.memo-card[data-memo-id="${noteTarget.id}"] .memo-card-note`)?.click();
      await sleep(80);
      const noteDlg = document.getElementById("memo-note-edit");
      const noteSrc = document.getElementById("memo-note-edit-src");
      out.noteUi.opened = Boolean(noteDlg?.open);
      out.noteUi.countBefore = document.getElementById("memo-note-edit-count")?.textContent || "";
      const longNote = `冒烟备注 UNIQUE_NOTE_MARK_772 ${"长".repeat(90)}`;
      if (noteSrc) {
        noteSrc.value = longNote;
        noteSrc.dispatchEvent(new Event("input", { bubbles: true }));
      }
      out.noteUi.countAfterInput = document.getElementById("memo-note-edit-count")?.textContent || "";
      document.getElementById("memo-note-edit-save")?.click();
      await sleep(220);
      const afterNote = (window.DevToolsMemo.getIndex().items || []).find((x) => x.id === noteTarget.id);
      out.noteUi.saved = String(afterNote?.note || "").includes("UNIQUE_NOTE_MARK_772");
      const noteBtn = document.querySelector(`.memo-card[data-memo-id="${noteTarget.id}"] .memo-card-note`);
      out.noteUi.cardShows = Boolean(noteBtn) && !noteBtn.classList.contains("is-empty");
      out.noteUi.hasExpand = Boolean(
        document.querySelector(`.memo-card[data-memo-id="${noteTarget.id}"] [data-memo-note-expand]`)
      );
      document.querySelector(`[data-memo-note-expand="${noteTarget.id}"]`)?.click();
      await sleep(80);
      out.noteUi.expanded = /长{10,}/.test(
        document.querySelector(`.memo-card[data-memo-id="${noteTarget.id}"] .memo-card-note`)?.textContent || ""
      );
      document.querySelector(`[data-memo-open="${noteTarget.id}"]`)?.click();
      await sleep(120);
      const previewNote = document.getElementById("memo-preview-note");
      out.noteUi.previewBlock = Boolean(previewNote) && !previewNote.hidden && /备注：/.test(previewNote.textContent || "");
      document.getElementById("memo-lightbox-close")?.click();
      await sleep(60);
      const search = document.getElementById("memo-search");
      if (search) {
        search.value = "UNIQUE_NOTE_MARK_772";
        search.dispatchEvent(new Event("input", { bubbles: true }));
      }
      await sleep(500);
      out.noteUi.searchHit = [...document.querySelectorAll(".memo-card")].some(
        (c) => c.dataset.memoId === noteTarget.id
      );
      document.querySelector(`.memo-card[data-memo-id="${noteTarget.id}"] .memo-more [data-memo-note], .memo-card[data-memo-id="${noteTarget.id}"] [data-memo-note]`)?.click();
      await sleep(80);
      document.getElementById("memo-note-edit-clear")?.click();
      await sleep(220);
      const cleared = (window.DevToolsMemo.getIndex().items || []).find((x) => x.id === noteTarget.id);
      out.noteUi.cleared = !cleared?.note;
      if (search) {
        search.value = "";
        search.dispatchEvent(new Event("input", { bubbles: true }));
      }
      await sleep(350);
      out.noteUi.emptyHintAfterClear = Boolean(
        document.querySelector(`.memo-card[data-memo-id="${noteTarget.id}"] .memo-card-note.is-empty`)
      );
    }

    // switch directory dialog UX
    out.switchDir = {
      hasDlg: Boolean(document.getElementById("memo-switch-dir-dlg")),
      hasSwitchBtn: Boolean(document.getElementById("memo-switch-dir")),
      hasPickQuick: Boolean(document.getElementById("memo-pick-dir-quick")),
      api: typeof window.DevToolsMemo.pickDirectory === "function" &&
        typeof window.DevToolsMemo.askSwitchDirectoryChoice === "function",
    };
    if (out.switchDir.api) {
      const pending = window.DevToolsMemo.askSwitchDirectoryChoice({
        existing: false,
        count: 3,
        folderName: "smoke-switch-dir",
      });
      await sleep(60);
      const dlg = document.getElementById("memo-switch-dir-dlg");
      out.switchDir.dlgOpen = Boolean(dlg?.open);
      out.switchDir.migrateVisible = !document.getElementById("memo-switch-migrate")?.hidden;
      out.switchDir.emptyVisible = !document.getElementById("memo-switch-empty")?.hidden;
      document.getElementById("memo-switch-cancel")?.click();
      out.switchDir.choice = await pending;
    }

    // title dblclick rename syncs display name + fileName
    out.renameUi = {
      hasTitleBtn: Boolean(document.querySelector(".memo-card-title[data-memo-rename]")),
      api: typeof window.DevToolsMemo.renameItem === "function",
    };
    const renameTarget =
      (window.DevToolsMemo.getIndex().items || []).find((x) => x.type === "text") ||
      (window.DevToolsMemo.getIndex().items || [])[0];
    if (renameTarget) {
      const titleBtn = document.querySelector(
        `.memo-card-title[data-memo-rename="${renameTarget.id}"]`
      );
      out.renameUi.foundCard = Boolean(titleBtn);
      if (titleBtn) {
        titleBtn.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
        await sleep(60);
        const input = document.querySelector(".memo-card-title-input");
        out.renameUi.inputShown = Boolean(input);
        if (input) {
          const newName = `冒烟重命名_${Date.now().toString(36)}`;
          input.value = newName;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.blur();
          await sleep(350);
          const after = (window.DevToolsMemo.getIndex().items || []).find((x) => x.id === renameTarget.id);
          out.renameUi.savedName = after?.name === newName;
          out.renameUi.fileSynced =
            Boolean(after?.fileName) &&
            (after.fileName === newName ||
              after.fileName.startsWith(newName) ||
              after.fileName.includes(newName));
          out.renameUi.titleUpdated = Boolean(
            document.querySelector(`.memo-card-title[data-memo-rename="${renameTarget.id}"]`)?.textContent ===
              newName
          );
        }
      }
    }

    // theme tokens should drive memo tags / search / type chips
    out.themeMemo = {
      api: typeof window.DevToolsTheme?.setPreset === "function",
      hasSearch: Boolean(document.querySelector(".memo-search")),
      hasTypeChip: Boolean(document.querySelector(".memo-type-chip")),
      hasTags: Boolean(document.querySelector(".memo-tags")),
    };
    if (out.themeMemo.api) {
      const accentBefore = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
      const searchBefore = getComputedStyle(document.querySelector(".memo-search")).backgroundColor;
      const chip = document.querySelector(".memo-type-chip");
      chip?.classList.add("is-active");
      const chipBefore = chip ? getComputedStyle(chip).backgroundColor : "";
      await window.DevToolsTheme.setPreset("paper");
      await sleep(80);
      const accentAfter = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
      const searchAfter = getComputedStyle(document.querySelector(".memo-search")).backgroundColor;
      const chipAfter = chip ? getComputedStyle(chip).backgroundColor : "";
      const tagsAfter = getComputedStyle(document.querySelector(".memo-tags")).backgroundColor;
      out.themeMemo.accentChanged = Boolean(accentAfter) && accentAfter !== accentBefore;
      out.themeMemo.searchFollows = searchAfter !== searchBefore || /255|rgb\(/.test(searchAfter);
      out.themeMemo.chipFollows = Boolean(chipAfter) && chipAfter !== "rgba(0, 0, 0, 0)";
      out.themeMemo.tagsOpaque = Boolean(tagsAfter) && tagsAfter !== "rgba(0, 0, 0, 0)";
      // paper is light — control fills should not stay navy (rgb ~14,22,38)
      out.themeMemo.notStuckNavy =
        !/rgba?\(\s*14\s*,\s*22\s*,\s*38/i.test(searchAfter) &&
        !/rgba?\(\s*14\s*,\s*22\s*,\s*38/i.test(tagsAfter);
      out.themeMemo.schemeLight = document.documentElement.dataset.themeScheme === "light";
      await window.DevToolsTheme.setPreset("default");
      await sleep(40);
    }

    out.uxOverhaul = {
      backupFold: document.querySelector(".memo-backup-bar")?.tagName === "DETAILS",
      emptyTpl: /data-memo-empty/.test(document.querySelector("#memo-list")?.innerHTML || "") ||
        (window.DevToolsMemo.getIndex().items || []).length > 0,
      chipName: Boolean(document.querySelector(".memo-chip-name")),
      chipX: Boolean(document.querySelector(".memo-chip-x")),
      autoclipStatus: Boolean(document.getElementById("memo-autoclip-status")),
      memoBeforeTextimg: (() => {
        const srcs = [...document.scripts].map((s) => s.src || "");
        const mi = srcs.findIndex((s) => /memo\.js/.test(s));
        const ti = srcs.findIndex((s) => /textimg\.js/.test(s));
        return mi >= 0 && ti >= 0 && mi < ti;
      })(),
    };
    const taggedCard = [...document.querySelectorAll(".memo-card")].find((c) => c.querySelector(".memo-chip"));
    if (!taggedCard) {
      const anyCard = document.querySelector(".memo-card [data-memo-tag-add]");
      anyCard?.click();
      await sleep(80);
      const tagSearch = document.getElementById("memo-tag-search");
      if (tagSearch) {
        tagSearch.value = "冒烟标签UX";
        document.getElementById("memo-tag-ok")?.click();
        await sleep(280);
      }
    }
    out.uxOverhaul.chipName = Boolean(document.querySelector(".memo-chip-name"));
    out.uxOverhaul.chipX = Boolean(document.querySelector(".memo-chip-x"));

    // grouped action buttons should share the same height
    out.btnSize = { ok: false };
    const actionRow =
      document.querySelector("#memo .btn-row.tool-actions") ||
      document.querySelector(".btn-row.tool-actions");
    if (actionRow) {
      const btns = [...actionRow.querySelectorAll(".primary-btn, .secondary-btn, .ghost-btn, .file-btn, .copy-btn")].filter(
        (el) => el.offsetParent !== null
      );
      const heights = btns.map((el) => el.getBoundingClientRect().height);
      out.btnSize = {
        count: heights.length,
        heights: heights.map((h) => Math.round(h * 10) / 10),
        ok: heights.length >= 2 && Math.max(...heights) - Math.min(...heights) <= 2,
      };
      const cardPrimary = document.querySelector(".memo-card-actions > .secondary-btn");
      const cardMore = document.querySelector(".memo-card-actions .memo-more-sum");
      if (cardPrimary && cardMore) {
        const a = cardPrimary.getBoundingClientRect().height;
        const b = cardMore.getBoundingClientRect().height;
        out.btnSize.cardAligned = Math.abs(a - b) <= 2;
      } else {
        out.btnSize.cardAligned = true;
      }
    }

    out.cacheBust = {
      version: document.getElementById("site-tools-version")?.textContent || "",
      memoScript: [...document.scripts].some((s) => /memo\.js\?v=20260817navpwa1/.test(s.src)),
    };

    out.pwa = {
      hasManifestLink: Boolean(document.querySelector('link[rel="manifest"]')),
      manifestHref: document.querySelector('link[rel="manifest"]')?.getAttribute("href") || "",
      hasInstallBtn: Boolean(document.getElementById("pwa-install")),
      hasPwaScript: [...document.scripts].some((s) => /pwa\.js/.test(s.src)),
      hasAppleIcon: Boolean(document.querySelector('link[rel="apple-touch-icon"]')),
      hasThemeColor: Boolean(document.querySelector('meta[name="theme-color"]')),
      swApi: "serviceWorker" in navigator,
      registered: false,
    };
    try {
      if (navigator.serviceWorker) {
        const waitReg = async () => {
          for (let i = 0; i < 20; i += 1) {
            const reg = await navigator.serviceWorker.getRegistration("./");
            if (reg) return reg;
            await new Promise((r) => setTimeout(r, 100));
          }
          return null;
        };
        out.pwa.registered = Boolean(await waitReg());
      }
    } catch (err) {
      out.pwa.swError = String((err && err.message) || err);
    }

    out.navCompact = {
      hasToggle: Boolean(document.getElementById("nav-compact")),
      defaultOff: document.getElementById("nav-compact")?.checked === false,
      api: typeof window.DevToolsNav?.setCompact === "function",
    };
    if (window.DevToolsNav?.setCompact) {
      window.DevToolsNav.setCompact(true);
      const groups = [...document.querySelectorAll("#tool-nav .nav-group")];
      const current = groups.find((g) => g.classList.contains("is-current"));
      const other = groups.find((g) => !g.classList.contains("is-current"));
      const curLink = current?.querySelector(".tool-nav-link");
      const othLink = other?.querySelector(".tool-nav-link");
      out.navCompact.barCompact = document.getElementById("nav-bar")?.classList.contains("is-compact");
      out.navCompact.currentOpen = Boolean(curLink) && getComputedStyle(curLink).display !== "none";
      out.navCompact.otherHidden = Boolean(othLink) && getComputedStyle(othLink).display === "none";
      if (other) {
        other.classList.add("is-pinned");
        const pinnedLink = other.querySelector(".tool-nav-link");
        out.navCompact.pinShows = Boolean(pinnedLink) && getComputedStyle(pinnedLink).display !== "none";
        other.classList.remove("is-pinned");
      }
      window.DevToolsNav.setCompact(false);
      out.navCompact.restored = !document.getElementById("nav-bar")?.classList.contains("is-compact");
    }

    return out;
  });

  await browser.close();
  await new Promise((r) => server.close(r));

  const failed = [];
  if (errors.length) failed.push(...errors.map((e) => `page: ${e}`));
  if (!result.panelActive) failed.push("memo panel not active");
  if (!result.hasEditor || !result.hasList) failed.push("missing editor/list");
  if (!/memo|theme|vsplit|vtrim|audio|ffb|ffadapt|setup|btnsize|memoux|imgzoom|vsfsjank|pwa|navpwa/i.test(result.version)) failed.push(`unexpected version ${result.version}`);
  for (const step of result.steps) {
    for (const [k, v] of Object.entries(step)) {
      if (k === "count" || k === "bytes") continue;
      if (!v) failed.push(`step failed: ${k}=${v} in ${JSON.stringify(step)}`);
    }
  }
  if (result.itemCount < 2) failed.push(`expected >=2 items, got ${result.itemCount}`);
  if (result.cardCount < 1) failed.push("no cards rendered");
  if (!result.preview?.hasVideo || !result.preview?.hasAudio || !result.preview?.hasFs) {
    failed.push("preview media controls missing");
  }
  if (!result.preview?.opened || !result.preview?.closed) failed.push("preview open/close failed");
  if (result.textClick?.hasPre && (!result.textClick?.previewOpened || !result.textClick?.noVideoAbove || !result.textClick?.textShown)) {
    failed.push("text single-click should preview text without video chrome");
  }
  if (result.textClick?.hasPre && !result.textClick?.noCardScroll) {
    failed.push("card text should not use visible scrollbars");
  }
  if (result.textClick?.hasPre && !result.textClick?.previewKindText) {
    failed.push("text preview should set data-preview-kind=text");
  }
  if (!result.textLines?.hasLong || !result.textLines?.truncatedClass || !result.textLines?.moreHint || !result.textLines?.noLine60) {
    failed.push("text over 50 lines should truncate on card with preview hint");
  }
  if (result.textLines && result.textLines.shortFull === false) {
    failed.push("short text should render fully without truncate class");
  }
  if (result.textLines && !result.textLines.previewFull) {
    failed.push("text preview should show full content from blob");
  }
  if (!result.previewUi?.hasDel || !result.previewUi?.delVisible || !result.previewUi?.wideEnough) {
    failed.push("preview should expose delete and be list-wide");
  }
  if (!result.dataUrlImg?.newestIsImage || !result.dataUrlImg?.notPlainDataText) {
    failed.push("data:image base64 text should ingest as image");
  }
  if (
    !result.imgZoom?.hasApi ||
    !result.imgZoom?.opened ||
    !result.imgZoom?.wrapShown ||
    !result.imgZoom?.hud ||
    !result.imgZoom?.fitOk ||
    !result.imgZoom?.wheeled ||
    !result.imgZoom?.panned ||
    !result.imgZoom?.btnZoom ||
    !result.imgZoom?.resetOk ||
    result.imgZoom?.resetLabel !== "还原" ||
    !result.imgZoom?.hudTop
  ) {
    failed.push("image preview should zoom with wheel/buttons and pan by drag");
  }
  if (!result.moreMenu?.has || !result.moreMenu?.closesOutside) {
    failed.push("more menu should close on outside click");
  }
  if (!result.exportMerged?.hasExport || !result.exportMerged?.noShareBtn) {
    failed.push("export/share should be a single button");
  }
  if (!/^导出/.test(result.exportMerged?.exportLabel || "")) {
    failed.push(`unexpected export label: ${result.exportMerged?.exportLabel}`);
  }
  if (!result.modules?.hasTextimg || !result.modules?.hasImgtext || !result.modules?.hasTiSrc) {
    failed.push("standalone textimg/imgtext modules missing");
  }
  if (!result.modules?.noMemoToimg || !result.modules?.noMemoOcr) {
    failed.push("memo should not embed toimg/ocr dialogs");
  }
  if (!result.modules?.memoStillActive || !result.modules?.primaryReadClip || !result.modules?.copyOnCard) {
    failed.push("memo store/retrieve primary actions missing");
  }
  if (!result.modules?.captureBar || !result.modules?.storageFold || !result.modules?.clearFilters || !result.modules?.friendlySearch) {
    failed.push("memo capture/search beginner UX missing");
  }
  if (!result.modules?.backupBar || !result.modules?.exportOutsideFold || !result.modules?.exportToDirBtn || !result.modules?.dirHint) {
    failed.push("memo backup bar / dir hint missing");
  }
  if (!result.modules?.backupIsFold || !result.modules?.batchInList || !result.modules?.importPassDlg || !result.modules?.pathRelabel || !result.modules?.selectAllScope) {
    failed.push("memo UX overhaul chrome missing (backup fold/batch/import pass/path/select-all)");
  }
  if (!result.uxOverhaul?.backupFold || !result.uxOverhaul?.chipName || !result.uxOverhaul?.chipX || !result.uxOverhaul?.memoBeforeTextimg || !result.uxOverhaul?.autoclipStatus) {
    failed.push("memo UX overhaul: backup fold / chip split / memo load order / autoclip status");
  }
  if (!result.modules?.previewCopy || !result.modules?.autoclipRemember || !result.modules?.mobilePasteHint) {
    failed.push("memo clipboard takeout / autoclip / paste hint missing");
  }
  if (!result.modules?.quickText || !result.modules?.quickTextNotDetails) {
    failed.push("quick text box should be always visible in capture bar");
  }
  if (!result.modules?.hasUndoBar || !result.modules?.hasProgressCancel || !result.modules?.hasTagsToggle || !result.modules?.hasTagsPanel) {
    failed.push("memo hardening UI missing (undo/cancel/tags drawer)");
  }
  if ((result.hardening?.contentHashCount || 0) < 1) failed.push("contentHash missing on new items");
  if (!result.hardening?.deleted || !result.hardening?.undoVisible || !result.hardening?.undone || !result.hardening?.undoHidden) {
    failed.push("delete undo flow failed");
  }
  if (!result.takeout?.hasFile || !result.takeout?.primaryDownload || !result.takeout?.noPrimaryCopy) {
    failed.push("file/video-like items should primary-download instead of copy");
  }
  if (!result.takeout?.leanActions || !result.takeout?.previewInMore || !result.takeout?.noteInMore) {
    failed.push("card actions should be lean: primary + more (preview/note inside more)");
  }
  if (!result.takeout?.textStillCopy || !result.takeout?.imageStillCopy) {
    failed.push("text/image items should keep primary copy");
  }
  if (!result.shareUi?.hasPreviewShare || !result.shareUi?.api) {
    failed.push("mobile share UI plumbing missing");
  }
  if (!result.shareUi?.filePrimaryDownload || !result.shareUi?.fileShareInMore) {
    failed.push("file items should primary-download with share in more on mobile");
  }
  if (!result.shareUi?.textHasShare || !result.shareUi?.textKeepsCopy) {
    failed.push("text items should keep copy and also offer share on mobile");
  }
  if (!result.shareUi?.previewShareVisible) {
    failed.push("preview share button should show when mobile share enabled");
  }
  if (!result.p1p2?.hasShareProbe || !result.p1p2?.heightOrderOk) {
    failed.push("p1/p2 share probe or card height estimates missing");
  }
  if (!result.dedupeBump?.buried || !result.dedupeBump?.movedFront || !result.dedupeBump?.noExtraCopy) {
    failed.push("duplicate paste should bump existing item to front without cloning");
  }
  if (!result.scale?.ordered || !result.scale?.countMatches || !result.scale?.estimateFast || !result.scale?.estimateBytes) {
    failed.push("scale adaptations missing or slow storage estimate");
  }
  if (!result.textEdit?.hasDlg || !result.textEdit?.hasEditBtn || !result.textEdit?.hasPreviewEdit) {
    failed.push("text edit UI missing");
  }
  if (!result.textEdit?.opened || !result.textEdit?.memoStillActive || !result.textEdit?.loaded) {
    failed.push("text edit dialog should open inline with content");
  }
  if (!result.textEdit?.saved || !result.textEdit?.closed || !result.textEdit?.editingCleared) {
    failed.push("text edit save/close failed");
  }
  if (!result.modules?.hasSentinel) failed.push("infinite scroll sentinel missing");
  if (!result.typeFilter?.host || (result.typeFilter?.chips || 0) < 7) {
    failed.push("type filter chips missing");
  }
  if ((result.typeFilter?.groups || 0) !== 0 || !result.typeFilter?.flatAll) {
    failed.push("all view should be a flat newest-first list without type groups");
  }
  if (!result.typeFilter?.imageOnly) failed.push("image type filter failed");
  if (!result.tagLeavesDefault?.hasWork || !result.tagLeavesDefault?.noDefault) {
    failed.push("tagged item should leave default tag");
  }
  if (!result.tagLeavesDefault?.defaultViewHidesTagged) {
    failed.push("default tag view should hide tagged items");
  }
  if (!result.tagDelete?.hasDelBtn || !result.tagDelete?.tagGone || !result.tagDelete?.itemKept || !result.tagDelete?.backToDefault) {
    failed.push("tag delete should unbind items back to default without removing files");
  }
  if (!result.noteUi?.hasDlg || !result.noteUi?.hasCardBtn || !result.noteUi?.hasPreviewBtn || !result.noteUi?.searchMentionsNote) {
    failed.push("note UI missing");
  }
  if (!result.noteUi?.hasCount || !result.noteUi?.exportMentionsNote || !result.noteUi?.delInMore) {
    failed.push("note UX polish missing (count/export hint/delete-in-more)");
  }
  if (!result.noteUi?.emptyHint || !result.noteUi?.opened || !result.noteUi?.saved || !result.noteUi?.cardShows) {
    failed.push("note empty-hint/open/save/card failed");
  }
  if (!result.noteUi?.hasExpand || !result.noteUi?.expanded || !result.noteUi?.previewBlock) {
    failed.push("note expand/preview block failed");
  }
  if (!result.noteUi?.searchHit || !result.noteUi?.cleared || !result.noteUi?.emptyHintAfterClear) {
    failed.push("note search/clear failed");
  }
  if (!/\d+\s*\/\s*500/.test(result.noteUi?.countAfterInput || "")) {
    failed.push("note char count should update while typing");
  }
  if (!result.switchDir?.hasDlg || !result.switchDir?.hasSwitchBtn || !result.switchDir?.hasPickQuick || !result.switchDir?.api) {
    failed.push("switch directory UI/API missing");
  }
  if (!result.switchDir?.dlgOpen || !result.switchDir?.migrateVisible || !result.switchDir?.emptyVisible || result.switchDir?.choice !== "cancel") {
    failed.push("switch directory dialog choices failed");
  }
  if (!result.renameUi?.hasTitleBtn || !result.renameUi?.api || !result.renameUi?.foundCard) {
    failed.push("rename title button / API missing");
  }
  if (!result.renameUi?.inputShown || !result.renameUi?.savedName || !result.renameUi?.fileSynced || !result.renameUi?.titleUpdated) {
    failed.push("title dblclick rename should update name and fileName");
  }
  if (!result.themeMemo?.api || !result.themeMemo?.hasSearch || !result.themeMemo?.hasTypeChip || !result.themeMemo?.hasTags) {
    failed.push("memo theme chrome / DevToolsTheme.setPreset missing");
  }
  if (!result.themeMemo?.accentChanged || !result.themeMemo?.schemeLight || !result.themeMemo?.notStuckNavy) {
    failed.push("memo tags/search/chips should follow theme tokens (not stuck navy)");
  }
  if (!result.themeMemo?.searchFollows || !result.themeMemo?.chipFollows || !result.themeMemo?.tagsOpaque) {
    failed.push("memo search/type chip/tags should use themed backgrounds");
  }
  if (!result.btnSize?.ok || result.btnSize?.cardAligned === false) {
    failed.push("grouped action buttons should share the same height");
  }
  if (!/navpwa1/i.test(result.cacheBust?.version || "") || !result.cacheBust?.memoScript) {
    failed.push("cache-bust/version should be aligned to navpwa1");
  }
  if (!result.pwa?.hasManifestLink || !/manifest\.webmanifest/.test(result.pwa?.manifestHref || "")) {
    failed.push("PWA manifest link missing");
  }
  if (!result.pwa?.hasInstallBtn || !result.pwa?.hasPwaScript || !result.pwa?.hasAppleIcon || !result.pwa?.hasThemeColor) {
    failed.push("PWA install UI / icons / theme-color missing");
  }
  if (!result.pwa?.swApi || !result.pwa?.registered) {
    failed.push("service worker should register for PWA");
  }
  if (
    !result.navCompact?.hasToggle ||
    !result.navCompact?.defaultOff ||
    !result.navCompact?.api ||
    !result.navCompact?.barCompact ||
    !result.navCompact?.currentOpen ||
    !result.navCompact?.otherHidden ||
    !result.navCompact?.pinShows ||
    !result.navCompact?.restored
  ) {
    failed.push("nav compact setting should hide other groups until hover/pin");
  }
  if (!result.searchUi?.hasSearch || !result.searchUi?.hasAutoclip || !result.searchUi?.autoclipDefaultOff) {
    failed.push("search/autoclip UI missing or autoclip not default-off");
  }
  if (!result.searchUi?.hasGifChip) failed.push("gif type chip missing");
  if (!result.searchUi?.hitText || !result.searchUi?.onlyTextish) failed.push("content search failed");
  if (!result.searchUi?.gifTyped || !result.searchUi?.gifFilter || !result.searchUi?.gifBadge) {
    failed.push("gif typing/filter/badge failed");
  }

  console.log(JSON.stringify({ ok: failed.length === 0, result, failed }, null, 2));
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
