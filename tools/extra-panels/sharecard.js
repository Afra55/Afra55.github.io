(() => {
  "use strict";

  const P = window.DevToolsPure;
  const K = window.DevToolsExtraKit;
  if (!P || !K) return;
  const { $, $$, setError, toast, bindPanel, flushPendingFileInput, formatKb, EBind } = K;
  const escapeHtml = P.escapeHtml;

  const M = window.DevToolsExtraMedia || {};
  const {
    mergeGifBlobs, compressGifBlob, getFfmpegInstance, ensureFfmpegAssets, fetchFileBytes,
    ensureFfmpegInputWritten, loadGifsicle, buildGifCompressArgs, buildBlackboxSoftCompressArgs,
    buildBlackboxHardCompressArgs, gifCompressSummary, readGifWatermarkOptions, drawGifTextWatermark,
    encodeAnimatedWebpFromStillFrames, isAutoPackZipEnabled, setAutoPackZipEnabled, syncAutoPackZipToggles,
    bindAutoPackZipToggles, canEncodeStillWebp, gifQualityToWebpQuality, gifQualityToMaxColors,
    terminateFfmpegInstance, paintFfmpegWarmHint, prewarmFfmpegEngine, TOOLS_VERSION, GIF_TOOL_VERSION,
    AUTO_PACK_ZIP_KEY,
  } = M;
  const formatLocalPickMeta = K.formatLocalPickMeta;
  const attachLocalVideoPreview = K.attachLocalVideoPreview;
  const waitVideoMetadata = K.waitVideoMetadata;

    let scInput;
    let scLang;
    let scTheme;
    let scTitle;
    let scWatermark;
    let scLines;
    let scPretty;
    let scDots;
    let scDotsEl;
    let scCard;
    let scCode;
    let scCardTitle;
    let scCardWatermark;
    let scMeta;
    let scError;
    let scCapture;
  
    const LANG_LABEL = {
      json: "JSON",
      kotlin: "Kotlin / Compose",
      java: "Java",
      javascript: "JavaScript",
      python: "Python",
      xml: "XML / HTML",
      text: "纯文本",
    };
  
    function refreshShareCard() {
      if (!scCard || !scCode) return;
      try {
        const rendered = P.renderShareCode(scInput.value, {
          lang: scLang.value,
          prettyJson: !!scPretty?.checked,
          lineNumbers: !!scLines?.checked,
        });
        scCode.innerHTML = rendered.html;
        scCard.className = `share-card theme-${scTheme.value}`;
        scCardTitle.textContent = scTitle.value.trim() || "untitled";
        const mark = scWatermark.value.trim();
        scCardWatermark.textContent = mark;
        scCardWatermark.hidden = !mark;
        if (scDotsEl) scDotsEl.hidden = !scDots?.checked;
        scMeta.textContent = `预览 · ${LANG_LABEL[rendered.lang] || rendered.lang} · ${rendered.lineCount} 行`;
        setError(scError, "");
      } catch (err) {
        setError(scError, err.message || String(err));
      }
    }
  
    bindPanel("sharecard", () => {
      scInput = $("#sc-input");
      scLang = $("#sc-lang");
      scTheme = $("#sc-theme");
      scTitle = $("#sc-title");
      scWatermark = $("#sc-watermark");
      scLines = $("#sc-lines");
      scPretty = $("#sc-pretty");
      scDots = $("#sc-dots");
      scDotsEl = $("#sc-dots-el");
      scCard = $("#sc-card");
      scCode = $("#sc-code");
      scCardTitle = $("#sc-card-title");
      scCardWatermark = $("#sc-card-watermark");
      scMeta = $("#sc-meta");
      scError = $("#sc-error");
      scCapture = $("#sc-capture");
  
      [scInput, scLang, scTheme, scTitle, scWatermark, scLines, scPretty, scDots].forEach((el) => {
        el?.addEventListener("input", refreshShareCard);
        el?.addEventListener("change", refreshShareCard);
      });
  
      $("#sc-refresh")?.addEventListener("click", refreshShareCard);
  
      $("#sc-export")?.addEventListener("click", async () => {
        refreshShareCard();
        if (typeof html2canvas !== "function") {
          setError(scError, "html2canvas 未加载");
          return;
        }
        try {
          const canvas = await html2canvas(scCapture, {
            backgroundColor: null,
            scale: 2,
            useCORS: true,
            logging: false,
          });
          const link = document.createElement("a");
          const name = (scTitle.value.trim() || "code-card").replace(/[^\w.-]+/g, "_");
          link.download = `${name}.png`;
          link.href = canvas.toDataURL("image/png");
          link.click();
          scMeta.textContent = `已导出 ${canvas.width}×${canvas.height} PNG`;
          toast("已导出图片");
          setError(scError, "");
        } catch (err) {
          setError(scError, `导出失败：${err.message || err}`);
        }
      });
  
      refreshShareCard();
    });

  window.DevToolsExtraBoot = window.DevToolsExtraBoot || {};
  window.DevToolsExtraBoot["sharecard"] = () => { try { refreshShareCard(); } catch (_) {} };
})();
