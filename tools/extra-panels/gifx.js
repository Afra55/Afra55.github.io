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

    try {
      let gifxFile;
      let gifxFramesEl;
      let gifxMeta;
      let gifxError;
      let gifxFormat;
      let gifxFps;
      let gifxProgress;
      let gifxProgressFill;
      let gifxProgressText;
      let gifxZipBtn;
      let gifxVideoBtn;
      let gifxAbort;
      let gifxDownloadVideo;
      let gifxVideoPreview;
      const extracted = [];
      let videoUrl = "";
      let abortVideo = false;
  
      function setGifxProgress(visible, ratio, text) {
        if (!gifxProgress) return;
        gifxProgress.hidden = !visible;
        const pct = Math.max(0, Math.min(100, Math.round((ratio || 0) * 100)));
        if (gifxProgressFill) gifxProgressFill.style.width = `${pct}%`;
        if (gifxProgressText) gifxProgressText.textContent = text || `${pct}%`;
      }
  
      function clearExtracted() {
        extracted.splice(0).forEach((f) => {
          if (f.url) URL.revokeObjectURL(f.url);
        });
        if (gifxFramesEl) gifxFramesEl.innerHTML = "";
        if (gifxZipBtn) gifxZipBtn.disabled = true;
        if (gifxVideoBtn) gifxVideoBtn.disabled = true;
        if (videoUrl) {
          URL.revokeObjectURL(videoUrl);
          videoUrl = "";
        }
        if (gifxVideoPreview) {
          gifxVideoPreview.hidden = true;
          gifxVideoPreview.removeAttribute("src");
        }
        if (gifxDownloadVideo) {
          gifxDownloadVideo.hidden = true;
          gifxDownloadVideo.removeAttribute("href");
        }
        if (gifxMeta) gifxMeta.textContent = "上传 GIF 后可拆成逐帧图片，或导出 WebM 视频。";
        setGifxProgress(false, 0, "");
        setError(gifxError, "");
      }
  
      function canvasToBlob(canvas, type, quality) {
        return new Promise((resolve, reject) => {
          canvas.toBlob((blob) => {
            if (!blob) reject(new Error("导出图片失败"));
            else resolve(blob);
          }, type, quality);
        });
      }
  
      async function decodeGifWithImageDecoder(buffer) {
        if (typeof ImageDecoder !== "function") return null;
        try {
          const decoder = new ImageDecoder({ data: buffer, type: "image/gif" });
          await decoder.tracks.ready;
          const track = decoder.tracks.selectedTrack;
          if (!track || !track.frameCount) return null;
          const frames = [];
          for (let i = 0; i < track.frameCount; i++) {
            const result = await decoder.decode({ frameIndex: i });
            const frame = result.image;
            const canvas = document.createElement("canvas");
            canvas.width = frame.displayWidth || frame.codedWidth;
            canvas.height = frame.displayHeight || frame.codedHeight;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(frame, 0, 0);
            const delayUs = frame.duration || result.duration || 100000;
            const delay = Math.max(20, Math.round(delayUs / 1000));
            frame.close();
            frames.push({ canvas, delay, index: i });
            setGifxProgress(true, ((i + 1) / track.frameCount) * 0.7, `解码中… ${i + 1}/${track.frameCount}`);
          }
          decoder.close?.();
          return frames;
        } catch (_) {
          return null;
        }
      }
  
      function decodeGifWithOmggif(buffer) {
        if (typeof GifReader !== "function") throw new Error("GIF 解码库未加载");
        const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
        const reader = new GifReader(bytes);
        const width = reader.width;
        const height = reader.height;
        const count = reader.numFrames();
        const frames = [];
        const full = document.createElement("canvas");
        full.width = width;
        full.height = height;
        const fullCtx = full.getContext("2d", { willReadFrequently: true });
        fullCtx.clearRect(0, 0, width, height);
        let saved = null;
  
        for (let i = 0; i < count; i++) {
          const info = reader.frameInfo(i);
          if (i > 0) {
            const prev = reader.frameInfo(i - 1);
            if (prev.disposal === 2) {
              fullCtx.clearRect(prev.x, prev.y, prev.width, prev.height);
            } else if (prev.disposal === 3 && saved) {
              fullCtx.putImageData(saved, 0, 0);
            }
          }
          if (info.disposal === 3) {
            saved = fullCtx.getImageData(0, 0, width, height);
          } else {
            saved = null;
          }
  
          const imageData = fullCtx.getImageData(0, 0, width, height);
          reader.decodeAndBlitFrameRGBA(i, imageData.data);
          fullCtx.putImageData(imageData, 0, 0);
  
          const snap = document.createElement("canvas");
          snap.width = width;
          snap.height = height;
          snap.getContext("2d").drawImage(full, 0, 0);
          const delay = Math.max(20, (info.delay || 10) * 10);
          frames.push({ canvas: snap, delay, index: i });
          setGifxProgress(true, ((i + 1) / count) * 0.7, `解码中… ${i + 1}/${count}`);
        }
        return frames;
      }
  
      async function renderExtractedList() {
        if (!gifxFramesEl) return;
        gifxFramesEl.innerHTML = "";
        for (const frame of extracted) {
          const row = document.createElement("div");
          row.className = "gif-frame";
          const img = document.createElement("img");
          img.className = "gif-frame-thumb";
          img.src = frame.url;
          img.alt = `frame-${frame.index + 1}`;
          const meta = document.createElement("div");
          meta.className = "gif-frame-meta";
          const name = document.createElement("div");
          name.className = "gif-frame-name";
          name.textContent = `第 ${frame.index + 1} 帧 · ${frame.delay} ms · ${frame.width}×${frame.height}`;
          const controls = document.createElement("div");
          controls.className = "gif-frame-controls";
          const link = document.createElement("a");
          link.className = "secondary-btn";
          link.textContent = "下载此帧";
          link.href = frame.url;
          link.download = `frame-${String(frame.index + 1).padStart(3, "0")}.png`;
          controls.appendChild(link);
          meta.append(name, controls);
          row.append(img, meta);
          gifxFramesEl.appendChild(row);
        }
      }
  
      async function loadGifFile(file) {
        if (!file) return;
        clearExtracted();
        setGifxProgress(true, 0.02, "读取文件…");
        try {
          const buffer = await file.arrayBuffer();
          let frames = await decodeGifWithImageDecoder(buffer);
          if (!frames || !frames.length) {
            frames = decodeGifWithOmggif(buffer);
          }
          if (!frames.length) throw new Error("未解析到帧");
          setGifxProgress(true, 0.75, "导出帧图片…");
          for (let i = 0; i < frames.length; i++) {
            const frame = frames[i];
            const blob = await canvasToBlob(frame.canvas, "image/png");
            const url = URL.createObjectURL(blob);
            extracted.push({
              index: frame.index,
              delay: frame.delay,
              width: frame.canvas.width,
              height: frame.canvas.height,
              canvas: frame.canvas,
              pngBlob: blob,
              url,
            });
            setGifxProgress(true, 0.75 + ((i + 1) / frames.length) * 0.25, `导出帧… ${i + 1}/${frames.length}`);
          }
          await renderExtractedList();
          const totalMs = extracted.reduce((s, f) => s + f.delay, 0);
          if (gifxMeta) {
            gifxMeta.textContent = `${file.name} · ${extracted.length} 帧 · 约 ${(totalMs / 1000).toFixed(2)}s · ${extracted[0].width}×${extracted[0].height}`;
          }
          if (gifxZipBtn) gifxZipBtn.disabled = false;
          if (gifxVideoBtn) gifxVideoBtn.disabled = false;
          setGifxProgress(true, 1, `已拆出 ${extracted.length} 帧`);
          toast(`已拆出 ${extracted.length} 帧`);
        } catch (err) {
          clearExtracted();
          setError(gifxError, err.message || String(err));
        } finally {
          if (gifxFile) gifxFile.value = "";
        }
      }
  
      function pickMime() {
        const format = gifxFormat?.value || "png";
        if (format === "jpeg") return { type: "image/jpeg", ext: "jpg", quality: 0.92 };
        if (format === "webp") return { type: "image/webp", ext: "webp", quality: 0.92 };
        return { type: "image/png", ext: "png", quality: undefined };
      }
  
      async function downloadZip() {
        if (!extracted.length) return;
        if (typeof JSZip !== "function") {
          setError(gifxError, "JSZip 未加载");
          return;
        }
        try {
          setError(gifxError, "");
          setGifxProgress(true, 0.05, "打包中…");
          const zip = new JSZip();
          const fmt = pickMime();
          for (let i = 0; i < extracted.length; i++) {
            const frame = extracted[i];
            let blob = frame.pngBlob;
            if (fmt.type !== "image/png") {
              blob = await canvasToBlob(frame.canvas, fmt.type, fmt.quality);
            }
            const name = `frame-${String(i + 1).padStart(3, "0")}.${fmt.ext}`;
            zip.file(name, blob);
            setGifxProgress(true, ((i + 1) / extracted.length) * 0.85, `打包… ${i + 1}/${extracted.length}`);
          }
          const meta = extracted.map((f, i) => `${i + 1}\t${f.delay}ms\t${f.width}x${f.height}`).join("\n");
          zip.file("frames.txt", `index\tdelay\tsize\n${meta}\n`);
          const out = await zip.generateAsync({ type: "blob" }, (meta) => {
            setGifxProgress(true, 0.85 + (meta.percent / 100) * 0.15, `压缩… ${Math.round(meta.percent)}%`);
          });
          const url = URL.createObjectURL(out);
          const a = document.createElement("a");
          a.href = url;
          a.download = "gif-frames.zip";
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 2000);
          setGifxProgress(true, 1, `已打包 ${extracted.length} 帧`);
          toast("已下载 ZIP");
        } catch (err) {
          setError(gifxError, err.message || String(err));
          setGifxProgress(false, 0, "");
        }
      }
  
      function pickRecorderMime() {
        const candidates = [
          "video/webm;codecs=vp9",
          "video/webm;codecs=vp8",
          "video/webm",
        ];
        for (const type of candidates) {
          if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(type)) return type;
        }
        return "video/webm";
      }
  
      function wait(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
      }
  
      async function exportVideo() {
        if (!extracted.length) return;
        if (typeof MediaRecorder !== "function") {
          setError(gifxError, "当前浏览器不支持 MediaRecorder");
          return;
        }
        abortVideo = false;
        if (gifxAbort) gifxAbort.hidden = false;
        if (gifxVideoBtn) gifxVideoBtn.disabled = true;
        if (gifxZipBtn) gifxZipBtn.disabled = true;
        setError(gifxError, "");
        setGifxProgress(true, 0.02, "准备录制…");
  
        try {
          const width = extracted[0].width;
          const height = extracted[0].height;
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          const fps = Math.min(60, Math.max(5, Number(gifxFps?.value) || 20));
          const stream = canvas.captureStream(fps);
          const mimeType = pickRecorderMime();
          const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 });
          const chunks = [];
          recorder.ondataavailable = (e) => {
            if (e.data && e.data.size) chunks.push(e.data);
          };
  
          const stopped = new Promise((resolve, reject) => {
            recorder.onstop = () => resolve();
            recorder.onerror = (e) => reject(e.error || new Error("录制失败"));
          });
          recorder.start(100);
  
          // paint first frame immediately
          for (let i = 0; i < extracted.length; i++) {
            if (abortVideo) throw new Error("已取消");
            const frame = extracted[i];
            ctx.clearRect(0, 0, width, height);
            ctx.drawImage(frame.canvas, 0, 0);
            const track = stream.getVideoTracks()[0];
            if (track && typeof track.requestFrame === "function") {
              track.requestFrame();
            }
            setGifxProgress(true, ((i + 1) / extracted.length) * 0.95, `导出视频… ${i + 1}/${extracted.length}`);
            await wait(Math.max(20, frame.delay));
          }
          // hold last frame briefly so encoders flush
          await wait(120);
          recorder.stop();
          stream.getTracks().forEach((t) => t.stop());
          await stopped;
  
          const blob = new Blob(chunks, { type: mimeType.includes("webm") ? "video/webm" : mimeType });
          if (!blob.size) throw new Error("视频为空，请换 Chrome / Edge 再试");
          if (videoUrl) URL.revokeObjectURL(videoUrl);
          videoUrl = URL.createObjectURL(blob);
          if (gifxVideoPreview) {
            gifxVideoPreview.src = videoUrl;
            gifxVideoPreview.hidden = false;
          }
          if (gifxDownloadVideo) {
            gifxDownloadVideo.href = videoUrl;
            gifxDownloadVideo.hidden = false;
          }
          setGifxProgress(true, 1, `完成 · ${(blob.size / 1024).toFixed(1)} KB`);
          toast("视频已生成");
        } catch (err) {
          if (String(err && err.message) !== "已取消") {
            setError(gifxError, err.message || String(err));
            setGifxProgress(false, 0, "");
          } else {
            setGifxProgress(false, 0, "");
            toast("已取消导出");
          }
        } finally {
          abortVideo = false;
          if (gifxAbort) gifxAbort.hidden = true;
          if (gifxVideoBtn) gifxVideoBtn.disabled = !extracted.length;
          if (gifxZipBtn) gifxZipBtn.disabled = !extracted.length;
        }
      }
  
      bindPanel("gifx", () => {
            gifxFile = $("#gifx-file");
            gifxFramesEl = $("#gifx-frames");
            gifxMeta = $("#gifx-meta");
            gifxError = $("#gifx-error");
            gifxFormat = $("#gifx-format");
            gifxFps = $("#gifx-fps");
            gifxProgress = $("#gifx-progress");
            gifxProgressFill = $("#gifx-progress-fill");
            gifxProgressText = $("#gifx-progress-text");
            gifxZipBtn = $("#gifx-zip");
            gifxVideoBtn = $("#gifx-video");
            gifxAbort = $("#gifx-abort");
            gifxDownloadVideo = $("#gifx-download-video");
            gifxVideoPreview = $("#gifx-video-preview");
  
            gifxFile?.addEventListener("change", (e) => loadGifFile(e.target.files?.[0]));
      $("#gifx-clear")?.addEventListener("click", clearExtracted);
      window.DevToolsTemp?.registerCleanup(clearExtracted);
      gifxZipBtn?.addEventListener("click", downloadZip);
      gifxVideoBtn?.addEventListener("click", exportVideo);
      gifxAbort?.addEventListener("click", () => {
        abortVideo = true;
      });
      });
    } catch (err) {
      console.error("gif extract init failed", err);
    }
})();
