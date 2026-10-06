#!/usr/bin/env node
"use strict";

/**
 * 黑盒 #vbb 功能面自动化测评（交互/流程；编码体积累计见 vbb-bench-local）。
 * 用法：node tools/scripts/vbb-feature-eval.cjs [video1] [video2] [image...]
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT = path.resolve(__dirname, "../..");
const PORT = Number(process.env.VBB_EVAL_PORT || 8768);
const OUT = process.env.VBB_EVAL_OUT || path.join(ROOT, "tools/.tmp-vbb-bench/feature-eval.json");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".gif": "image/gif",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
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
  return new Promise((resolve) => server.listen(PORT, "127.0.0.1", () => resolve(server)));
}

function findBrowser() {
  const cands = [
    process.env.VBB_SMOKE_BROWSER,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean);
  for (const p of cands) {
    try {
      if (fs.existsSync(p)) return p;
    } catch (_) {}
  }
  return "";
}

async function loadPuppeteer() {
  try {
    return require("puppeteer-core");
  } catch (_) {}
  try {
    return require(path.join(os.tmpdir(), "node_modules", "puppeteer-core"));
  } catch (_) {
    throw new Error("需要 puppeteer-core（可用 npm i puppeteer-core）");
  }
}

function check(rows, id, ok, detail) {
  rows.push({ id, ok: Boolean(ok), detail: String(detail || "") });
  console.log(`${ok ? "PASS" : "FAIL"}  ${id}${detail ? " — " + detail : ""}`);
}

async function waitBoot(page) {
  await page.goto(`http://127.0.0.1:${PORT}/tools/index.html?debug#vbb`, {
    waitUntil: "networkidle0",
    timeout: 120000,
  });
  await page.waitForFunction(
    () => window.__devtoolsBootReady && Boolean(document.getElementById("vbb-file")),
    { timeout: 90000 }
  );
}

async function main() {
  const args = process.argv.slice(2);
  const videos = args.filter((p) => /\.(mp4|mov|webm|m4v)$/i.test(p) && fs.existsSync(p));
  const images = args.filter((p) => /\.(png|jpe?g|webp|gif)$/i.test(p) && fs.existsSync(p));
  const v1 = videos[0];
  const v2 = videos[1] || videos[0];
  if (!v1) throw new Error("请至少传一个本地视频路径");

  const browserPath = findBrowser();
  if (!browserPath) throw new Error("未找到 Edge/Chrome");
  const puppeteer = await loadPuppeteer();
  const server = await startServer();
  const rows = [];
  const browser = await puppeteer.launch({
    executablePath: browserPath,
    headless: "new",
    args: ["--disable-gpu", "--no-sandbox"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, isLandscape: false });
  page.setDefaultTimeout(60000);

  try {
    await waitBoot(page);
    const build = await page.evaluate(() => window.TOOLS_BUILD || "");
    check(rows, "panel.boot", Boolean(build), `TOOLS_BUILD=${build}`);

    // 工作流切换
    const wf = await page.evaluate(() => {
      const click = (id) => document.getElementById(id)?.click();
      const active = () =>
        [...document.querySelectorAll("[data-vbb-workflow]")].find((b) => b.classList.contains("is-active"))
          ?.dataset.vbbWorkflow;
      click("vbb-workflow-manual");
      const manual = active() === "manual" && !document.getElementById("vbb-manual-panel")?.hidden;
      click("vbb-workflow-split");
      const split = active() === "split" && !document.getElementById("vbb-split-panel")?.hidden;
      click("vbb-workflow-single");
      const single = active() === "single";
      return { manual, split, single, active: active() };
    });
    check(rows, "workflow.switch", wf.manual && wf.split && wf.single, JSON.stringify(wf));

    // 选项折叠与控件存在
    const opts = await page.evaluate(() => {
      const ids = [
        "vbb-max-mb",
        "vbb-perf",
        "vbb-wake-lock",
        "vbb-notify-sound",
        "vbb-notify-vibrate",
        "vbb-auto-crop",
        "vbb-auto-pack",
        "vbb-auto-dl-each",
        "vbb-speed-limit",
        "vbb-speed-sec",
        "vbb-oneclick",
        "vbb-merge",
        "vbb-merge-video",
        "vbb-zip",
        "vbb-edit-open",
      ];
      const missing = ids.filter((id) => !document.getElementById(id));
      return { missing, maxMb: document.getElementById("vbb-max-mb")?.value };
    });
    check(rows, "options.controls", opts.missing.length === 0, opts.missing.join(",") || `maxMb=${opts.maxMb}`);

    // 单文件加载
    const input = await page.$("#vbb-file");
    await input.uploadFile(v1);
    await page.waitForFunction(() => {
      const b = document.getElementById("vbb-oneclick");
      return b && !b.disabled;
    }, { timeout: 90000 });
    const loaded = await page.evaluate(() => {
      const meta = document.getElementById("vbb-meta")?.textContent || "";
      const edit = !document.getElementById("vbb-file-edit")?.hidden;
      const openEnabled = !document.getElementById("vbb-edit-open")?.disabled;
      return { meta, edit, openEnabled };
    });
    check(rows, "load.single", loaded.edit && loaded.openEnabled, loaded.meta.slice(0, 120));

    // 编辑器：立刻出现 boot/overlay，并测滚动锁
    const editOpen = await page.evaluate(async () => {
      const beforeY = window.scrollY;
      window.scrollTo(0, 120);
      const y1 = window.scrollY;
      document.getElementById("vbb-edit-open")?.click();
      await new Promise((r) => setTimeout(r, 40));
      const boot = Boolean(document.querySelector(".vtrim-editor-boot, .vtrim-editor-overlay"));
      const locked = document.body.classList.contains("vtrim-editor-open");
      // 等编辑层真正挂上
      const t0 = Date.now();
      while (Date.now() - t0 < 15000) {
        if (document.querySelector(".vtrim-editor-overlay")) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      const overlay = Boolean(document.querySelector(".vtrim-editor-overlay"));
      const done = document.querySelector(".vtrim-editor-overlay [id$='-done']");
      // 拖片尾存在
      const endHandle = Boolean(document.querySelector(".vtrim-handle-end, [id$='-handle-end']"));
      const nudge = Boolean(document.querySelector("[id$='-nudge-end-m']"));
      // 片尾截止点：拖拽预览时间与播放守卫同一公式
      const endKeep = await (async () => {
        const video = document.querySelector(".vtrim-editor-overlay video");
        const handle = document.querySelector(".vtrim-editor-overlay .vtrim-handle-end");
        const timeline = document.querySelector(".vtrim-editor-overlay .vtrim-timeline");
        if (!video || !handle || !timeline || !(video.duration > 1)) return { ok: false, reason: "no-timeline" };
        const rect = timeline.getBoundingClientRect();
        const targetRatio = 0.55;
        const x = rect.left + rect.width * targetRatio;
        const y = rect.top + rect.height / 2;
        handle.dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true, clientX: x, clientY: y, pointerId: 1, pointerType: "touch" })
        );
        timeline.dispatchEvent(
          new PointerEvent("pointermove", { bubbles: true, clientX: x, clientY: y, pointerId: 1, pointerType: "touch" })
        );
        window.dispatchEvent(
          new PointerEvent("pointerup", { bubbles: true, clientX: x, clientY: y, pointerId: 1, pointerType: "touch" })
        );
        await new Promise((r) => setTimeout(r, 200));
        const previewT = Number(video.currentTime) || 0;
        const label = document.querySelector(".vtrim-editor-overlay [id$='-range-label']")?.textContent || "";
        // 标签形如 保留 x（a–b）
        const m = /（([^–-]+)[–-]([^）]+)）/.exec(label);
        return {
          ok: previewT > 0.2,
          previewT,
          label,
          hasRange: Boolean(m),
        };
      })();
      // 关闭（必须点「关闭」，勿点其它 ghost）
      document.querySelector(".vtrim-editor-overlay [id$='-close']")?.click();
      await new Promise((r) => setTimeout(r, 120));
      const closed = !document.querySelector(".vtrim-editor-overlay");
      return { beforeY, y1, boot, locked, overlay, endHandle, nudge, closed, afterOpen: Boolean(done), endKeep };
    });
    check(
      rows,
      "edit.open.lock",
      editOpen.boot && editOpen.overlay && editOpen.locked && editOpen.endHandle && editOpen.closed,
      JSON.stringify(editOpen)
    );
    check(
      rows,
      "edit.trim-end-preview",
      editOpen.endKeep?.ok && editOpen.endKeep?.hasRange,
      JSON.stringify(editOpen.endKeep || {})
    );

    // —— 编辑专项：默认修剪时长 + 绿框常显 + 删中间须点按钮 ——
    const editSuite = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const waitOverlay = async (ms = 15000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) {
          if (document.querySelector(".vtrim-editor-overlay")) return true;
          await sleep(40);
        }
        return Boolean(document.querySelector(".vtrim-editor-overlay"));
      };
      const $ = (suf) => document.querySelector(`.vtrim-editor-overlay [id$='-${suf}']`);
      const modeActive = () =>
        document.querySelector(".vtrim-editor-overlay [data-vte-mode].is-active")?.dataset?.vteMode || "";

      document.getElementById("vbb-edit-open")?.click();
      if (!(await waitOverlay())) return { ok: false, reason: "no-overlay" };
      await sleep(300);

      const defaultMode = modeActive();
      const trimTools = $("trim-tools");
      const cropPanel = $("crop-panel");
      const cropBox = $("crop-box");
      const cropEnable = $("crop-enable");
      const defaultTrimUi =
        defaultMode === "trim" &&
        trimTools &&
        !trimTools.hidden &&
        cropPanel?.hidden === true;
      const cropBoxVisible =
        Boolean(cropEnable?.checked) && Boolean(cropBox) && !cropBox.hidden;
      const cropInteractiveOnTrim = cropBox?.classList?.contains("is-interactive") === true;

      // 切到裁切画面：绿框可拖
      document.querySelector('.vtrim-editor-overlay [data-vte-mode="crop"]')?.click();
      await sleep(80);
      const cropMode = modeActive() === "crop";
      const cropPanelShown = cropPanel && !cropPanel.hidden;
      const cropInteractiveOnCrop = cropBox?.classList?.contains("is-interactive") === true;

      // 切到删中间
      document.querySelector('.vtrim-editor-overlay [data-vte-mode="cut"]')?.click();
      await sleep(80);
      const cutMode = modeActive() === "cut";
      const cutAdd = $("cut-add");
      const cutTools = $("cut-tools");
      const cutToolsShown = cutTools && !cutTools.hidden && Boolean(cutAdd);
      const downloadBtn = Boolean($("download")) && /下载编辑后的视频/.test($("download")?.textContent || "");

      const video = document.querySelector(".vtrim-editor-overlay video");
      const timeline = document.querySelector(".vtrim-editor-overlay .vtrim-timeline");
      const cutoutsEl = $("cutouts");
      const countCuts = () =>
        cutoutsEl ? cutoutsEl.querySelectorAll(".vtrim-cutout:not(.is-draft)").length : -1;

      // 拖进度：不应新增红段
      const beforeDrag = countCuts();
      let dragSeekOk = false;
      if (video && timeline && video.duration > 1) {
        const rect = timeline.getBoundingClientRect();
        const y = rect.top + rect.height / 2;
        const x0 = rect.left + rect.width * 0.35;
        const x1 = rect.left + rect.width * 0.65;
        timeline.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            clientX: x0,
            clientY: y,
            pointerId: 7,
            pointerType: "touch",
          })
        );
        timeline.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            clientX: x1,
            clientY: y,
            pointerId: 7,
            pointerType: "touch",
          })
        );
        window.dispatchEvent(
          new PointerEvent("pointerup", {
            bubbles: true,
            clientX: x1,
            clientY: y,
            pointerId: 7,
            pointerType: "touch",
          })
        );
        await sleep(220);
        dragSeekOk = countCuts() === beforeDrag && beforeDrag === 0;
      }

      // 点「添加删除段」才加红段；起点=点击时的进度
      const tAtAdd = Number(video?.currentTime) || 0;
      cutAdd?.click();
      await sleep(120);
      const afterAdd = countCuts();
      const addOk = afterAdd === 1;
      let cutStartAtPlayhead = false;
      let cutStartSec = -1;
      const firstCut = cutoutsEl?.querySelector(".vtrim-cutout:not(.is-draft)");
      if (firstCut && video?.duration > 0) {
        const pct = parseFloat(getComputedStyle(firstCut).getPropertyValue("--cut-start"));
        cutStartSec = (Number.isFinite(pct) ? pct : 0) / 100 * video.duration;
        cutStartAtPlayhead = Math.abs(cutStartSec - tAtAdd) <= 0.25;
      }

      // 再拖空白进度：仍不应变成 2 段
      if (video && timeline && video.duration > 1) {
        const rect = timeline.getBoundingClientRect();
        const y = rect.top + rect.height / 2;
        const x0 = rect.left + rect.width * 0.4;
        const x1 = rect.left + rect.width * 0.7;
        timeline.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            clientX: x0,
            clientY: y,
            pointerId: 8,
            pointerType: "touch",
          })
        );
        timeline.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            clientX: x1,
            clientY: y,
            pointerId: 8,
            pointerType: "touch",
          })
        );
        window.dispatchEvent(
          new PointerEvent("pointerup", {
            bubbles: true,
            clientX: x1,
            clientY: y,
            pointerId: 8,
            pointerType: "touch",
          })
        );
        await sleep(200);
      }
      const afterDragKeep = countCuts() === 1;

      // 完成保存：应带回 cutouts
      $("done")?.click();
      await sleep(200);
      const closed = !document.querySelector(".vtrim-editor-overlay");
      const badge = document.getElementById("vbb-file-edit-label")?.textContent || "";
      const savedHint = /删/.test(badge) || /裁/.test(badge);

      return {
        defaultMode,
        defaultTrimUi,
        cropBoxVisible,
        cropInteractiveOnTrim,
        cropMode,
        cropPanelShown,
        cropInteractiveOnCrop,
        cutMode,
        cutToolsShown,
        beforeDrag,
        dragSeekOk,
        afterAdd,
        addOk,
        tAtAdd,
        cutStartSec,
        cutStartAtPlayhead,
        afterDragKeep,
        trimTailKeep:
          typeof window.DevToolsVtrimEditor?.keepRangesFromEdit === "function"
            ? (() => {
                const end = 4;
                const ks = window.DevToolsVtrimEditor.keepRangesFromEdit(
                  { trimStart: 0.5, trimEnd: end, cutouts: [] },
                  10
                );
                const last = ks[ks.length - 1];
                return {
                  lastEnd: last?.end,
                  expected: end - 1 / 25,
                  ok: Math.abs((last?.end || 0) - (end - 1 / 25)) < 0.015,
                };
              })()
            : { ok: false, reason: "no-keepRanges" },
        closed,
        badge: badge.slice(0, 80),
        savedHint,
        downloadBtn,
        cutClosedKeep:
          typeof window.DevToolsVtrimEditor?.keepRangesFromEdit === "function"
            ? (() => {
                const ks = window.DevToolsVtrimEditor.keepRangesFromEdit(
                  { trimStart: 0, trimEnd: 10, cutouts: [{ start: 2, end: 4 }] },
                  10
                );
                return {
                  n: ks.length,
                  k0end: ks[0]?.end,
                  k1start: ks[1]?.start,
                  ok:
                    ks.length === 2 &&
                    Math.abs((ks[0]?.end || 0) - 2) < 0.02 &&
                    (ks[1]?.start || 0) >= 4 + 1 / 25 - 0.01,
                };
              })()
            : { ok: false, reason: "no-keepRanges" },
      };
    });
    check(
      rows,
      "edit.default-trim",
      editSuite.defaultTrimUi === true,
      JSON.stringify({ mode: editSuite.defaultMode, ui: editSuite.defaultTrimUi })
    );
    check(
      rows,
      "edit.crop-box-visible",
      editSuite.cropBoxVisible === true && editSuite.cropInteractiveOnTrim === false,
      JSON.stringify({
        visible: editSuite.cropBoxVisible,
        interactiveOnTrim: editSuite.cropInteractiveOnTrim,
      })
    );
    check(
      rows,
      "edit.crop-mode-interactive",
      editSuite.cropMode && editSuite.cropPanelShown && editSuite.cropInteractiveOnCrop,
      JSON.stringify({
        mode: editSuite.cropMode,
        panel: editSuite.cropPanelShown,
        interactive: editSuite.cropInteractiveOnCrop,
      })
    );
    check(
      rows,
      "edit.cut-drag-no-add",
      editSuite.cutMode && editSuite.cutToolsShown && editSuite.dragSeekOk,
      JSON.stringify({
        cutMode: editSuite.cutMode,
        tools: editSuite.cutToolsShown,
        dragSeekOk: editSuite.dragSeekOk,
        before: editSuite.beforeDrag,
      })
    );
    check(
      rows,
      "edit.cut-add-button",
      editSuite.addOk && editSuite.afterDragKeep,
      JSON.stringify({ afterAdd: editSuite.afterAdd, keepOne: editSuite.afterDragKeep })
    );
    check(
      rows,
      "edit.cut-starts-at-playhead",
      editSuite.cutStartAtPlayhead === true,
      JSON.stringify({
        tAtAdd: Number(editSuite.tAtAdd).toFixed(2),
        cutStart: Number(editSuite.cutStartSec).toFixed(2),
      })
    );
    check(
      rows,
      "edit.trim-end-half-open",
      editSuite.trimTailKeep?.ok === true,
      JSON.stringify(editSuite.trimTailKeep || {})
    );
    check(
      rows,
      "edit.cut-closed-keep",
      editSuite.cutClosedKeep?.ok === true,
      JSON.stringify(editSuite.cutClosedKeep || {})
    );
    check(
      rows,
      "edit.download-edited-mp4",
      editSuite.downloadBtn === true,
      JSON.stringify({ downloadBtn: editSuite.downloadBtn })
    );
    check(
      rows,
      "edit.save-cutouts",
      editSuite.closed && editSuite.savedHint,
      JSON.stringify({ closed: editSuite.closed, badge: editSuite.badge })
    );

    // 手动打点 UI
    const manual = await page.evaluate(async () => {
      document.getElementById("vbb-workflow-manual")?.click();
      await new Promise((r) => setTimeout(r, 30));
      const panel = !document.getElementById("vbb-manual-panel")?.hidden;
      const scrub = !document.getElementById("vbb-scrub")?.disabled;
      const mark = !document.getElementById("vbb-mark-tap")?.disabled;
      // 打一段
      const v = document.getElementById("vbb-video");
      if (v) v.currentTime = Math.min(1, (v.duration || 2) * 0.1);
      document.getElementById("vbb-mark-tap")?.click();
      await new Promise((r) => setTimeout(r, 20));
      if (v) v.currentTime = Math.min((v.duration || 3) - 0.2, (v.duration || 3) * 0.4);
      document.getElementById("vbb-mark-tap")?.click();
      await new Promise((r) => setTimeout(r, 40));
      const countText = document.getElementById("vbb-manual-count")?.textContent || "";
      const oneclick = document.getElementById("vbb-oneclick")?.textContent || "";
      document.getElementById("vbb-mark-clear")?.click();
      return { panel, scrub, mark, countText, oneclick };
    });
    check(
      rows,
      "manual.mark",
      manual.panel && manual.scrub && manual.mark && /1\s*段/.test(manual.countText),
      JSON.stringify(manual)
    );

    // 长视频切片：分析按钮可用性（短片也可能分析）
    const split = await page.evaluate(async () => {
      document.getElementById("vbb-workflow-split")?.click();
      await new Promise((r) => setTimeout(r, 30));
      const panel = !document.getElementById("vbb-split-panel")?.hidden;
      const analyzeEnabled = !document.getElementById("vbb-analyze")?.disabled;
      document.getElementById("vbb-analyze")?.click();
      const t0 = Date.now();
      let plan = false;
      while (Date.now() - t0 < 120000) {
        const el = document.getElementById("vbb-plan");
        if (el && !el.hidden) {
          plan = true;
          break;
        }
        const err = document.getElementById("vbb-error");
        if (err && !err.hidden && err.textContent) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      const summary = document.getElementById("vbb-plan-summary")?.textContent || "";
      const custom = Boolean(document.getElementById("vbb-mode-custom"));
      document.getElementById("vbb-workflow-single")?.click();
      return { panel, analyzeEnabled, plan, summary: summary.slice(0, 160), custom };
    });
    check(rows, "split.analyze", split.panel && split.analyzeEnabled && split.plan, split.summary || JSON.stringify(split));

    // 多选批次 + 排序按钮
    if (v2) {
      await waitBoot(page);
      const batchInput = await page.$("#vbb-file");
      await batchInput.uploadFile(v1, v2);
      await page.waitForFunction(() => {
        const list = document.getElementById("vbb-batch-list");
        return list && !list.hidden && list.querySelectorAll(".vbb-batch-row").length >= 2;
      }, { timeout: 120000 });
      const batch = await page.evaluate(async () => {
        const rowsEl = [...document.querySelectorAll(".vbb-batch-row")];
        const n = rowsEl.length;
        const editBtns = document.querySelectorAll(".vbb-batch-row .secondary-btn");
        const down = document.querySelector(".vbb-batch-row-move");
        const mergeVideo = !document.getElementById("vbb-merge-video")?.disabled;
        const one = document.getElementById("vbb-oneclick")?.textContent || "";
        // 点第一条编辑：应立刻有 boot/overlay
        editBtns[0]?.click();
        await new Promise((r) => setTimeout(r, 40));
        const boot = Boolean(document.querySelector(".vtrim-editor-boot, .vtrim-editor-overlay"));
        const t0 = Date.now();
        while (Date.now() - t0 < 15000) {
          if (document.querySelector(".vtrim-editor-overlay")) break;
          await new Promise((r) => setTimeout(r, 50));
        }
        const overlay = Boolean(document.querySelector(".vtrim-editor-overlay"));
        document.querySelector(".vtrim-editor-overlay [id$='-close']")?.click();
        await new Promise((r) => setTimeout(r, 120));
        // 多选禁切片
        document.getElementById("vbb-workflow-split")?.click();
        await new Promise((r) => setTimeout(r, 20));
        const stillNotSplit =
          document.querySelector("[data-vbb-workflow].is-active")?.dataset.vbbWorkflow !== "split" ||
          document.getElementById("vbb-split-panel")?.hidden;
        return {
          n,
          editCount: editBtns.length,
          hasMove: Boolean(down),
          mergeVideo,
          one,
          boot,
          overlay,
          stillNotSplit,
        };
      });
      check(
        rows,
        "batch.list.edit",
        batch.n >= 2 && batch.editCount >= 2 && batch.boot && batch.overlay && batch.mergeVideo,
        JSON.stringify(batch)
      );
      check(rows, "batch.no-split", batch.stillNotSplit, "多选不应进入长视频切片");
    } else {
      check(rows, "batch.list.edit", false, "缺少第二个视频，跳过");
      check(rows, "batch.no-split", false, "缺少第二个视频，跳过");
    }

    // 多图模式 UI
    await waitBoot(page);
    const imgUi = await page.evaluate(() => {
      document.getElementById("vbb-input-images")?.click();
      const panel = !document.getElementById("vbb-images-panel")?.hidden;
      const videoHidden = Boolean(document.querySelector("[data-vbb-video]")?.hasAttribute("hidden")) ||
        document.querySelector("[data-vbb-video]")?.hidden === true ||
        getComputedStyle(document.querySelector("[data-vbb-video]") || document.body).display === "none" ||
        !document.getElementById("vbb-file")?.offsetParent;
      // 上面可能不准：以 images panel 显示为准
      return {
        panel,
        hasHold: Boolean(document.getElementById("vbb-hold")),
        hasFill: Boolean(document.getElementById("vbb-fill")),
        hasGen: Boolean(document.getElementById("vbb-img-generate")),
        drop: Boolean(document.getElementById("vbb-img-drop")),
      };
    });
    check(rows, "images.ui", imgUi.panel && imgUi.hasHold && imgUi.hasFill && imgUi.hasGen, JSON.stringify(imgUi));

    if (images.length >= 2) {
      const imgInput = await page.$("#vbb-img-file");
      await imgInput.uploadFile(...images.slice(0, 3));
      await page.waitForFunction(() => {
        const b = document.getElementById("vbb-img-generate");
        return b && !b.disabled;
      }, { timeout: 60000 });
      await page.evaluate(() => document.getElementById("vbb-img-generate")?.click());
      await page.waitForFunction(() => {
        const a = document.getElementById("vbb-img-download");
        return a && !a.hidden && a.href && a.href.startsWith("blob:");
      }, { timeout: 180000 });
      const imgRes = await page.evaluate(async () => {
        const a = document.getElementById("vbb-img-download");
        const meta = document.getElementById("vbb-img-meta")?.textContent || "";
        const err = document.getElementById("vbb-img-error");
        let size = 0;
        try {
          const blob = await fetch(a.href).then((r) => r.blob());
          size = blob.size;
        } catch (_) {}
        return {
          ok: Boolean(a && !a.hidden),
          size,
          meta: meta.slice(0, 120),
          err: err && !err.hidden ? err.textContent : "",
        };
      });
      check(rows, "images.generate", imgRes.ok && imgRes.size > 1000, `${(imgRes.size / 1024).toFixed(1)}KB ${imgRes.meta}`);
    } else {
      check(rows, "images.generate", true, "无图片样本，仅测 UI（记 skip-pass）");
    }

    // 桌面视口再确认编辑按钮
    await page.setViewport({ width: 1280, height: 900, isMobile: false, hasTouch: false });
    await waitBoot(page);
    const desk = await page.$("#vbb-file");
    await desk.uploadFile(v1);
    await page.waitForFunction(() => !document.getElementById("vbb-edit-open")?.disabled, { timeout: 90000 });
    const deskEdit = await page.evaluate(async () => {
      document.getElementById("vbb-edit-open")?.click();
      const t0 = Date.now();
      while (Date.now() - t0 < 15000) {
        if (document.querySelector(".vtrim-editor-overlay")) break;
        await new Promise((r) => setTimeout(r, 40));
      }
      const overlay = Boolean(document.querySelector(".vtrim-editor-overlay"));
      // 点完成关闭不保存
      document.querySelector(".vtrim-editor-overlay [id$='-close']")?.click();
      return { overlay };
    });
    check(rows, "edit.desktop", deskEdit.overlay, JSON.stringify(deskEdit));
  } finally {
    await browser.close().catch(() => {});
    await new Promise((r) => server.close(r));
  }

  const passed = rows.filter((r) => r.ok).length;
  const failed = rows.filter((r) => !r.ok);
  const report = {
    at: new Date().toISOString(),
    port: PORT,
    videos,
    images,
    passed,
    total: rows.length,
    failed: failed.map((f) => f.id),
    rows,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log("\n==== FEATURE EVAL ====");
  console.log(`${passed}/${rows.length} passed → ${OUT}`);
  if (failed.length) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
