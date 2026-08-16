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
    };

    // inline text edit dialog
    const textItem = (window.DevToolsMemo.getIndex().items || []).find((it) => it.type === "text");
    out.textEdit = {
      hasDlg: Boolean(document.getElementById("memo-text-edit")),
      hasPreviewEdit: Boolean(document.getElementById("memo-preview-edit")),
      hasEditBtn: Boolean(document.querySelector("[data-memo-edit]")),
      itemId: textItem?.id || "",
    };
    if (textItem) {
      document.querySelector(`[data-memo-edit="${textItem.id}"]`)?.click();
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

    // open image preview
    const openBtn = document.querySelector("[data-memo-open]");
    if (openBtn) {
      openBtn.click();
      await sleep(300);
      out.preview.opened = Boolean(document.getElementById("memo-lightbox")?.open);
      document.getElementById("memo-lightbox-close")?.click();
      await sleep(100);
      out.preview.closed = !document.getElementById("memo-lightbox")?.open;
    }

    // type filter + grouped sections
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
    } else {
      out.tagLeavesDefault = { hasWork: false, noDefault: false, defaultViewHidesTagged: false };
    }

    return out;
  });

  await browser.close();
  await new Promise((r) => server.close(r));

  const failed = [];
  if (errors.length) failed.push(...errors.map((e) => `page: ${e}`));
  if (!result.panelActive) failed.push("memo panel not active");
  if (!result.hasEditor || !result.hasList) failed.push("missing editor/list");
  if (!/memo|theme/i.test(result.version)) failed.push(`unexpected version ${result.version}`);
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
  if ((result.typeFilter?.groups || 0) < 1) failed.push("type groups missing in all view");
  if (!result.typeFilter?.imageOnly) failed.push("image type filter failed");
  if (!result.tagLeavesDefault?.hasWork || !result.tagLeavesDefault?.noDefault) {
    failed.push("tagged item should leave default tag");
  }
  if (!result.tagLeavesDefault?.defaultViewHidesTagged) {
    failed.push("default tag view should hide tagged items");
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
