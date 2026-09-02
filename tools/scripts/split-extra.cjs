#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const EXTRA = path.join(ROOT, "extra.js");
const KIT = path.join(ROOT, "lib/extra-kit.js");
const MEDIA = path.join(ROOT, "lib/extra-media.js");
const BOOT = path.join(ROOT, "lib/extra-bootstrap.js");
const PANELS = path.join(ROOT, "extra-panels");

const src = fs.readFileSync(EXTRA, "utf8");
const lines = src.split("\n");

function findLine(needle, from = 0) {
  const i = lines.findIndex((l, idx) => idx >= from && l.includes(needle));
  if (i < 0) throw new Error(`marker not found: ${needle}`);
  return i + 1;
}

function extractBetween(start, end) {
  const s = src.indexOf(start);
  if (s < 0) throw new Error(`start missing: ${start}`);
  const e = src.indexOf(end, s + start.length);
  if (e < 0) throw new Error(`end missing after ${start}: ${end}`);
  return src.slice(s, e).trim();
}

const kitEndLine = findLine("// ---- Time diff ----") - 1;
const mediaStartLine = lines.findIndex((l) => l.includes("const TOOLS_VERSION")) + 1;
const mediaEndLine = kitEndLine;

// 跳过 extra.js 顶部的 P / EBind / bindPanel，由 kit 外壳统一声明
const kitStart = lines.findIndex((l) => l.includes("function flushPendingFileInput"));
const kitBody = lines
  .slice(kitStart, mediaStartLine - 1)
  .filter((l) => !/^\s*const EBind =/.test(l) && !/^\s*const bindPanel =/.test(l))
  .join("\n");

const kitOut = `(() => {
  "use strict";

  const P = window.DevToolsPure;
  if (!P) {
    console.error("DevToolsPure missing");
    return;
  }

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

${kitBody}

  const EBind = () => window.DevToolsExtraBind;
  const bindPanel = (id, fn) => EBind()?.register?.(id, fn);

  window.DevToolsExtraKit = {
    P,
    escapeHtml: P.escapeHtml,
    $,
    $$,
    flushPendingFileInput,
    setError,
    toast,
    formatKb,
    formatLocalPickMeta,
    attachLocalVideoPreview,
    waitVideoMetadata,
    bindPanel,
    EBind,
  };
})();
`;

const mediaOut = `(() => {
  "use strict";

  const P = window.DevToolsPure;
  if (!P) return;
  const K = window.DevToolsExtraKit;
  const $ = K.$;
  const $$ = K.$$;
  const setError = K.setError;
  const toast = K.toast;
  const formatKb = K.formatKb;
  const escapeHtml = P.escapeHtml;

${lines.slice(mediaStartLine - 1, mediaEndLine).join("\n")}

  window.DevToolsExtraMedia = {
    isAutoPackZipEnabled, setAutoPackZipEnabled, syncAutoPackZipToggles, bindAutoPackZipToggles,
    canEncodeStillWebp, gifQualityToWebpQuality, gifQualityToMaxColors, resolveFfmpegVendorBase,
    loadFfmpegMods, fetchFileBytes, ffmpegInputKey, guessVideoExt, ensureFfmpegInputWritten,
    clearFfmpegInputCache, openFfmpegIdb, idbGetAsset, idbPutAsset, deleteFfmpegIndexedDb,
    purgePersistedEngine, createEngineObjectURL, fetchArrayBufferProgress, loadEngineBuffer,
    ensureFfmpegAssets, getFfmpegInstance, terminateFfmpegInstance, paintFfmpegWarmHint,
    setFfmpegWarmProgress, injectFfmpegPreloadLinks, isGifmakerActive, prewarmFfmpegEngine,
    scheduleFfmpegPrewarm, bindFfmpegPrewarmTriggers, encodeAnimatedWebpFromStillFrames,
    paintToolsVersion, loadGifsicle, buildGifCompressArgs, buildBlackboxSoftCompressArgs,
    buildBlackboxHardCompressArgs, gifCompressSummary, readGifWatermarkOptions,
    drawGifTextWatermark, compressGifBlob, mergeGifBlobs, TOOLS_VERSION, GIF_TOOL_VERSION,
    AUTO_PACK_ZIP_KEY, FFMPEG_SEG_FILE_BYTES,
    formatLocalPickMeta: K.formatLocalPickMeta,
    attachLocalVideoPreview: K.attachLocalVideoPreview,
    waitVideoMetadata: K.waitVideoMetadata,
    escapeHtml,
  };
  bindAutoPackZipToggles?.();
  bindFfmpegPrewarmTriggers?.();
  paintToolsVersion?.();
})();
`;

/** @type {{ id: string, file: string, start: string, end: string, media?: boolean, boot?: string }[]} */
const CHUNKS = [
  { id: "timediff", file: "timediff.js", start: "// ---- Time diff ----", end: "// ---- Color convert ----" },
  { id: "color", file: "color.js", start: "// ---- Color convert ----", end: "// ---- URL ----" },
  { id: "url", file: "url.js", start: "// ---- URL ----", end: "// ---- Query / JWT ----" },
  { id: "query", file: "query.js", start: "// ---- Query / JWT ----", end: "// ---- UUID ----" },
  { id: "uuid", file: "uuid.js", start: "// ---- UUID ----", end: "// ---- Hash ----", boot: "genUuid" },
  { id: "hash", file: "hash.js", start: "// ---- Hash ----", end: "// ---- Text ----" },
  { id: "text", file: "text.js", start: "// ---- Text ----", end: "// ---- Case convert ----", boot: "refreshTextStats" },
  { id: "caseconv", file: "caseconv.js", start: "// ---- Case convert ----", end: "// ---- Coordinate convert ----" },
  { id: "coord", file: "coord.js", start: "// ---- Coordinate convert ----", end: "// ---- 文本比对（见 diff.js） ----" },
  { id: "yaml", file: "yaml.js", start: "// ---- YAML ----", end: "// ---- Image Base64 ----" },
  { id: "imgb64", file: "imgb64.js", start: "// ---- Image Base64 ----", end: "// ---- QR generate + decode ----" },
  { id: "qrcode", file: "qrcode.js", start: "// ---- QR generate + decode ----", end: "// ---- Cron ----", boot: "generateQr" },
  { id: "cron", file: "cron.js", start: "// ---- Cron ----", end: "// ---- Units ----", boot: "runCron" },
  { id: "units", file: "units.js", start: "// ---- Units ----", end: "// ---- Share card ----", boot: "fillUnitSelects" },
  { id: "sharecard", file: "sharecard.js", start: "// ---- Share card ----", end: "// ---- Number base ----", media: true, boot: "refreshShareCard" },
  { id: "numbase", file: "numbase.js", start: "// ---- Number base ----", end: "// ---- Markdown preview ----", boot: "convertBase" },
  { id: "markdown", file: "markdown.js", start: "// ---- Markdown preview ----", end: "  function bootExtraPanel", boot: "refreshMarkdown" },
  { id: "eyedropper", file: "eyedropper.js", start: "// ---- EyeDropper / image color picker ----", end: "// ---- Password generator ----" },
  { id: "password", file: "password.js", start: "// ---- Password generator ----", end: "// ---- GIF maker ----" },
  { id: "gifmaker", file: "gifmaker.js", start: "// ---- GIF maker ----", end: "// ---- GIF extract / to video ----", media: true },
  { id: "gifx", file: "gifx.js", start: "// ---- GIF extract / to video ----", end: "// ---- Video to GIF ----", media: true },
  { id: "v2g", file: "v2g-suite.js", start: "// ---- Video to GIF ----", end: "// ---- 已有 GIF 压黑盒（gifbb，独立工具） ----", media: true },
  { id: "gifbb", file: "gifbb.js", start: "// ---- 已有 GIF 压黑盒（gifbb，独立工具） ----", end: "// ---- Compress existing GIF ----", media: true },
  { id: "gifc", file: "gifc.js", start: "// ---- Compress existing GIF ----", end: "// ---- Edit existing GIF (crop / trim frames) ----", media: true },
  { id: "gife", file: "gife.js", start: "// ---- Edit existing GIF (crop / trim frames) ----", end: "// ---- Merge GIFs ----", media: true },
  { id: "gifm", file: "gifm.js", start: "// ---- Merge GIFs ----", end: "// Rebind copy buttons added dynamically in HTML for new panels", media: true },
  { id: "adb", file: "adb.js", start: "// ---- ADB bridge client (P0–P3) ----", end: '  $$("[data-copy]").forEach', media: true },
];

function panelWrapper(body, chunk) {
  let inner = body;
  inner = inner.replace(/^}\);\/\/[^\n]*\n?/, "");
  inner = inner.replace(/^\/\/[^\n]+\n/, "");

  const mediaDestructure = chunk.media
    ? `
  const M = window.DevToolsExtraMedia || {};
  const {
    mergeGifBlobs, compressGifBlob, getFfmpegInstance, ensureFfmpegAssets, fetchFileBytes,
    ensureFfmpegInputWritten, loadGifsicle, buildGifCompressArgs, buildBlackboxSoftCompressArgs,
    buildBlackboxHardCompressArgs, gifCompressSummary, readGifWatermarkOptions, drawGifTextWatermark,
    encodeAnimatedWebpFromStillFrames, isAutoPackZipEnabled, setAutoPackZipEnabled, syncAutoPackZipToggles,
    bindAutoPackZipToggles, canEncodeStillWebp, gifQualityToWebpQuality, gifQualityToMaxColors,
    terminateFfmpegInstance, paintFfmpegWarmHint, prewarmFfmpegEngine, TOOLS_VERSION, GIF_TOOL_VERSION,
    AUTO_PACK_ZIP_KEY, FFMPEG_SEG_FILE_BYTES,
  } = M;
  const formatLocalPickMeta = K.formatLocalPickMeta;
  const attachLocalVideoPreview = K.attachLocalVideoPreview;
  const waitVideoMetadata = K.waitVideoMetadata;
`
    : "";

  const bootHook = chunk.boot
    ? `
  window.DevToolsExtraBoot = window.DevToolsExtraBoot || {};
  window.DevToolsExtraBoot["${chunk.id}"] = () => { try { ${chunk.boot}(); } catch (_) {} };
`
    : "";

  return `(() => {
  "use strict";

  const P = window.DevToolsPure;
  const K = window.DevToolsExtraKit;
  if (!P || !K) return;
  const { $, $$, setError, toast, bindPanel, flushPendingFileInput, formatKb, EBind } = K;
  const escapeHtml = P.escapeHtml;
${mediaDestructure}
  ${inner.split("\n").join("\n  ")}
${bootHook}})();
`;
}

const copyStart = src.indexOf('  $$("[data-copy]")');
const copyEnd = src.indexOf("  EBind()?.bindMounted?.();");
const copyBlock = src.slice(copyStart, copyEnd).trim();

const bootOut =
  `(() => {
  "use strict";

  const K = window.DevToolsExtraKit;
  if (!K) return;
  const { $$, toast, EBind } = K;

  function bootExtraPanel(toolId) {
    const id = String(toolId || "").trim();
    if (!id) return;
    EBind()?.bind?.(id);
    window.DevToolsExtraBoot?.[id]?.();
  }

  window.addEventListener("devtools:route", (e) => {
    const d = e.detail || {};
    const id = String(d.tool || "").trim();
    bootExtraPanel(id);
  });

` +
  copyBlock +
  `

  EBind()?.bindMounted?.();
})();
`;

fs.mkdirSync(PANELS, { recursive: true });
fs.writeFileSync(KIT, kitOut);
fs.writeFileSync(MEDIA, mediaOut);
fs.writeFileSync(BOOT, bootOut);

const toolFiles = {};
const extraPanelTools = new Set();
const mediaTools = new Set();

for (const chunk of CHUNKS) {
  const body = extractBetween(chunk.start, chunk.end);
  fs.writeFileSync(path.join(PANELS, chunk.file), panelWrapper(body, chunk));
  toolFiles[chunk.id] = `./extra-panels/${chunk.file}`;
  extraPanelTools.add(chunk.id);
  if (chunk.media) mediaTools.add(chunk.id);
}

toolFiles.vsplit = toolFiles.v2g;
toolFiles.vbb = toolFiles.v2g;
extraPanelTools.add("vsplit");
extraPanelTools.add("vbb");

fs.writeFileSync(
  EXTRA,
  `(() => {\n  "use strict";\n  console.warn("extra.js deprecated: use per-tool extra-panels via DevToolsLazy");\n})();\n`
);

fs.writeFileSync(
  path.join(ROOT, "lib/extra-panels-manifest.json"),
  JSON.stringify({ toolFiles, extraPanelTools: [...extraPanelTools].sort(), mediaTools: [...mediaTools].sort() }, null, 2)
);

console.log("split-extra: done", Object.keys(toolFiles).length, "tools");
