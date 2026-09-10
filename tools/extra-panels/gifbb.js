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
    AUTO_PACK_ZIP_KEY, blackboxUseMaxBytes, compressExistingGifToBlackbox,
  } = M;
  const formatLocalPickMeta = K.formatLocalPickMeta;
  const attachLocalVideoPreview = K.attachLocalVideoPreview;
  const waitVideoMetadata = K.waitVideoMetadata;

    try {
      let gifbbFile;
      let gifbbMeta;
      let gifbbError;
      let gifbbList;
      let gifbbRun;
      let gifbbZip;
      let gifbbClear;
      let gifbbAbort;
      /** @type {{ file: File, outBlob?: Blob, status: string, note: string, error?: string, previewIdx?: boolean, jobProgress?: number, jobText?: string }[]} */
      let gifbbItems = [];
      let gifbbBusy = false;
      let abortGifbb = false;
      let gifbbZipUrl = "";
      let gifbbPreviewIdx = -1;
      /** @type {string[]} */
      let gifbbPreviewUrls = [];
  
      function gifbbBaseName(file) {
        const name = String(file?.name || "clip.gif");
        return name.replace(/\.gif$/i, "").replace(/[^\w\u4e00-\u9fff.-]+/g, "_") || "clip";
      }

      async function readGifDim(file) {
        try {
          const buf = await file.slice(0, 10).arrayBuffer();
          const d = new DataView(buf);
          if (d.byteLength < 10) return null;
          const w = d.getUint16(6, true);
          const h = d.getUint16(8, true);
          return w > 0 && h > 0 ? { w, h } : null;
        } catch (_) {
          return null;
        }
      }

      // 原图信息：尺寸(头部解析) + 时长/帧数(ImageDecoder 尽力而为)
      async function readGifInfo(file) {
        const dim = await readGifDim(file);
        const info = { w: dim?.w || 0, h: dim?.h || 0, ms: 0, frames: 0 };
        try {
          if (typeof ImageDecoder === "function") {
            const dec = new ImageDecoder({ data: await file.arrayBuffer(), type: "image/gif" });
            await dec.completed;
            const n = dec.tracks?.selectedTrack?.frameCount || 0;
            let ms = 0;
            for (let i = 0; i < n; i++) {
              const { image } = await dec.decode({ frameIndex: i });
              ms += Number(image.duration) || 0;
            }
            info.frames = n;
            info.ms = ms;
            dec.close?.();
          }
        } catch (_) {}
        return info;
      }

      function fmtDur(ms) {
        const s = Math.max(0, Number(ms) || 0) / 1000;
        if (!s) return "";
        if (s < 10) return `${s.toFixed(1)}s`;
        const m = Math.floor(s / 60);
        const r = Math.round(s % 60);
        return m > 0 ? `${m}:${String(r).padStart(2, "0")}` : `${Math.round(s)}s`;
      }

      function gifbbMetaText(item) {
        const bits = [];
        const info = item.info;
        if (info && (info.w || info.h)) bits.push(`${info.w}×${info.h}`);
        const dur = fmtDur(info?.ms);
        if (dur) bits.push(dur);
        bits.push(formatKb(item.file.size));
        if (item.note) bits.push(item.note);
        if (item.error) bits.push(item.error);
        return bits.join(" · ");
      }
  
      function gifbbOutName(item) {
        const base = gifbbBaseName(item.file);
        if (item.status === "skip") return `${base}.gif`;
        return `${base}-blackbox.gif`;
      }
  
      function buildGifbbProgressDom() {
        const box = document.createElement("div");
        box.className = "vsplit-clip-progress";
        box.hidden = true;
        box.innerHTML =
          '<div class="vsplit-clip-progress-head">' +
          '<span class="hint tight vsplit-clip-progress-text">等待中…</span>' +
          '<span class="mono vsplit-clip-progress-pct">—</span>' +
          "</div>" +
          '<div class="gif-progress-track" aria-hidden="true"><span class="gif-progress-fill"></span></div>';
        return box;
      }
  
      function syncGifbbProgressDom(box, job) {
        if (!box) return;
        const status = job?.jobStatus || "";
        // 与黑盒 GIF 一致：成功后隐藏进度条，只保留文案信息
        const show = status === "pending" || status === "running" || status === "error";
        box.hidden = !show;
        if (!show) return;
        box.dataset.status = status;
        const ratio = Math.max(0, Math.min(1, Number(job.jobProgress) || 0));
        const pct = Math.round(ratio * 100);
        const fill = box.querySelector(".gif-progress-fill");
        const textEl = box.querySelector(".vsplit-clip-progress-text");
        const pctEl = box.querySelector(".vsplit-clip-progress-pct");
        const running = status === "running";
        if (fill) {
          const width = status === "pending" ? 0 : Math.max(pct, running && pct < 6 ? 6 : pct);
          fill.style.width = `${width}%`;
          fill.classList.toggle("is-active", running);
          fill.classList.toggle("is-busy", running);
        }
        if (textEl) {
          textEl.textContent =
            job.jobText ||
            (status === "pending"
              ? "等待中…"
              : status === "running"
                ? "处理中…"
                : status === "done"
                  ? "完成"
                  : status === "error"
                    ? "失败"
                    : "");
        }
        if (pctEl) pctEl.textContent = status === "pending" ? "—" : `${pct}%`;
      }
  
      function setGifbbButtons() {
        const done = gifbbItems.filter((it) => it.outBlob).length;
        if (gifbbRun) gifbbRun.disabled = gifbbItems.length === 0 || gifbbBusy;
        if (gifbbZip) gifbbZip.disabled = done < 1 || gifbbBusy;
        if (gifbbClear) gifbbClear.disabled = gifbbBusy && gifbbItems.length === 0;
        if (gifbbAbort) gifbbAbort.hidden = !gifbbBusy;
      }
  
      function renderGifbbList() {
        if (!gifbbList) return;
        gifbbItems.forEach((it) => {
          if (it.gifUrl) {
            try { URL.revokeObjectURL(it.gifUrl); } catch (_) {}
            it.gifUrl = "";
          }
        });
        gifbbList.innerHTML = "";
        if (!gifbbItems.length) {
          gifbbList.hidden = true;
          if (gifbbMeta) gifbbMeta.textContent = "未选择 GIF";
          setGifbbButtons();
          return;
        }
        gifbbList.hidden = false;
        const total = gifbbItems.reduce((s, it) => s + (it.file.size || 0), 0);
        if (gifbbMeta) {
          gifbbMeta.textContent = `已选 ${gifbbItems.length} 个 · 共 ${formatKb(total)} · 自动开始压黑盒（≤6MB 的会跳过）`;
        }
        gifbbItems.forEach((item, idx) => {
          const row = document.createElement("div");
          row.className = "gif-frame vsplit-clip";
          row.dataset.gifbbIdx = String(idx);
          const top = document.createElement("div");
          top.className = "vsplit-clip-top";
          const head = document.createElement("div");
          head.className = "vbb-clip-head";
          const title = document.createElement("strong");
          title.className = "vbb-clip-title";
          title.textContent = item.file.name;
          head.appendChild(title);
          const metaText = gifbbMetaText(item);
          if (metaText) {
            const meta = document.createElement("span");
            meta.className = "hint tight vbb-clip-meta";
            meta.textContent = metaText;
            head.appendChild(meta);
          }
          const actions = document.createElement("div");
          actions.className = "btn-row";
          if (item.outBlob) {
            const dlBtn = document.createElement("button");
            dlBtn.type = "button";
            dlBtn.className = "secondary-btn";
            dlBtn.textContent = "下载 GIF";
            dlBtn.addEventListener("click", () => {
              triggerLocalDownload(item.outBlob, gifbbOutName(item));
            });
            actions.appendChild(dlBtn);
            const previewBtn = document.createElement("button");
            previewBtn.type = "button";
            previewBtn.className = "ghost-btn vbb-preview-btn";
            previewBtn.textContent = gifbbPreviewIdx === idx ? "收起预览" : "预览";
            previewBtn.addEventListener("click", () => toggleGifbbPreview(idx));
            actions.appendChild(previewBtn);
          }
          top.append(head, actions);
          row.appendChild(top);
          const progressBox = buildGifbbProgressDom();
          row.appendChild(progressBox);
          syncGifbbProgressDom(progressBox, {
            jobStatus: item.jobStatus || "",
            jobProgress: item.jobProgress || 0,
            jobText: item.jobText || "",
          });
          if (item.outBlob && gifbbPreviewIdx === idx) {
            const wrap = document.createElement("div");
            wrap.className = "vbb-clip-preview-wrap";
            if (!item.gifUrl) item.gifUrl = URL.createObjectURL(item.outBlob);
            const img = document.createElement("img");
            img.className = "vsplit-clip-gif";
            img.alt = item.file.name;
            img.loading = "lazy";
            img.decoding = "async";
            img.src = item.gifUrl;
            wrap.appendChild(img);
            row.appendChild(wrap);
          }
          gifbbList.appendChild(row);
        });
        setGifbbButtons();
      }

      function toggleGifbbPreview(idx) {
        const next = gifbbPreviewIdx === idx ? -1 : idx;
        gifbbPreviewIdx = next;
        renderGifbbList();
      }
  
      function clearGifbb() {
        if (gifbbBusy) abortGifbb = true;
        gifbbItems = [];
        abortGifbb = false;
        gifbbBusy = false;
        if (gifbbZipUrl) {
          try {
            URL.revokeObjectURL(gifbbZipUrl);
          } catch (_) {}
        }
        gifbbZipUrl = "";
        if (gifbbFile) gifbbFile.value = "";
        setError(gifbbError, "");
        setGifbbProgress(false);
        renderGifbbList();
      }
  
      function loadGifbbFiles(fileList) {
        const files = [...(fileList || [])].filter((f) => {
          const type = String(f.type || "").toLowerCase();
          const name = String(f.name || "");
          return type === "image/gif" || /\.gif$/i.test(name);
        });
        if (!files.length) {
          setError(gifbbError, "请选择 GIF 文件");
          return;
        }
        setError(gifbbError, "");
        gifbbPreviewIdx = -1;
        gifbbItems = files.map((file) => ({
          file,
          status: "pending",
          jobStatus: "",
          jobProgress: 0,
          jobText: "",
          note: "",
          info: null,
        }));
        renderGifbbList();
        toast(`已添加 ${files.length} 个 GIF，自动开始压黑盒`);
        // 先补原图尺寸/时长/大小信息，再自动压缩
        Promise.all(
          gifbbItems.map((item) =>
            readGifInfo(item.file)
              .then((info) => {
                item.info = info;
              })
              .catch(() => {})
          )
        ).then(() => {
          renderGifbbList();
          runGifbbCompress().catch((err) => setError(gifbbError, err.message || String(err)));
        });
      }
  
      // 顶部总进度条（与黑盒 GIF(vbb) 同款 gif-progress 样式）
      function setGifbbProgress(visible, ratio, text, opts = {}) {
        const box = document.getElementById("gifbb-progress");
        if (!box) return;
        box.hidden = !visible;
        const fill = document.getElementById("gifbb-progress-fill");
        const pctEl = document.getElementById("gifbb-progress-pct");
        const textEl = document.getElementById("gifbb-progress-text");
        const subEl = document.getElementById("gifbb-progress-sub");
        if (!visible) {
          if (fill) fill.style.width = "0%";
          if (pctEl) pctEl.hidden = true;
          if (subEl) { subEl.hidden = true; }
          return;
        }
        const pct = Math.max(0, Math.min(100, Math.round((ratio || 0) * 100)));
        const busy = Boolean(opts.busy) || (pct > 0 && pct < 100);
        if (fill) {
          fill.style.width = `${Math.max(pct, busy && pct < 8 ? 8 : pct)}%`;
          fill.classList.toggle("is-active", busy);
          fill.classList.toggle("is-busy", Boolean(opts.busy));
        }
        if (pctEl) { pctEl.textContent = `${pct}%`; pctEl.hidden = false; }
        if (textEl) textEl.textContent = String(text || "");
        if (subEl) {
          if (opts.sub) {
            subEl.textContent = String(opts.sub);
            subEl.hidden = false;
          } else {
            subEl.hidden = true;
          }
        }
      }

      async function runGifbbCompress() {
        if (!gifbbItems.length || gifbbBusy) return;
        gifbbBusy = true;
        abortGifbb = false;
        setError(gifbbError, "");
        setGifbbButtons();
        let ok = 0;
        let skip = 0;
        let fail = 0;
        const total = gifbbItems.length;
        setGifbbProgress(true, 0, `压缩 0/${total}`, { busy: true });
        try {
          for (let i = 0; i < total; i++) {
            if (abortGifbb) throw new Error("已取消");
            const item = gifbbItems[i];
            item.status = "working";
            item.jobStatus = "running";
            item.jobProgress = 0;
            item.jobText = "准备…";
            item.note = "";
            item.error = "";
            item.outBlob = undefined;
            renderGifbbList();
            try {
              const before = item.file.size;
              if (before <= blackboxUseMaxBytes()) {
                item.outBlob = item.file;
                item.status = "skip";
                item.jobStatus = "done";
                item.note = `已符合黑盒 · ${formatKb(before)} · 未压缩`;
                skip++;
              } else {
                item.jobText = `压缩中 · ${formatKb(before)}`;
                const result = await compressExistingGifToBlackbox(item.file, (ratio, text) => {
                  item.jobProgress = Math.max(0, Math.min(1, Number(ratio) || 0));
                  item.jobText = text || "压缩中…";
                  const overall = (i + (item.jobProgress || 0)) / total;
                  setGifbbProgress(true, overall, `压缩 ${i + 1}/${total}`, { sub: item.jobText, busy: true });
                  renderGifbbList();
                }, () => abortGifbb);
                item.outBlob = result.blob;
                item.status = result.ok ? "done" : "warn";
                item.jobStatus = "done";
                const after = result.blob.size;
                const saved =
                  before > 0 ? Math.max(0, Math.round((1 - after / before) * 100)) : 0;
                if (result.skipped) {
                  item.note = `已符合黑盒 · ${formatKb(after)}`;
                  skip++;
                } else if (result.ok) {
                  item.note = `${formatKb(before)} → ${formatKb(after)} · 约省 ${saved}% · ${result.compressRounds} 轮`;
                  ok++;
                } else if (after >= before) {
                  // 压不动：绝不返回更大的文件，保留原图
                  item.note = `未能压小 · 已保留原图（${formatKb(after)}，超 6MB）`;
                  item.error = "未压进 6MB";
                  fail++;
                } else {
                  item.note = `仍 ${formatKb(after)}（超 6MB）· 已压 ${result.compressRounds} 轮`;
                  item.error = "未压进 6MB";
                  fail++;
                }
              }
            } catch (err) {
              item.status = "error";
              item.jobStatus = "error";
              item.error = err.message || String(err);
              fail++;
            }
            if (item.jobStatus === "running") item.jobStatus = "done";
            setGifbbProgress(true, (i + 1) / total, `压缩 ${Math.min(i + 1, total)}/${total}`, { busy: i + 1 < total });
            renderGifbbList();
          }
          if (abortGifbb) toast("已取消");
          else if (fail) toast(`完成：${ok + skip} 个成功，${fail} 个有问题`);
          else toast(`全部完成（${skip} 个跳过，${ok} 个已压缩）`);
        } catch (err) {
          if (String(err?.message) !== "已取消") setError(gifbbError, err.message || String(err));
          else toast("已取消");
        } finally {
          gifbbBusy = false;
          abortGifbb = false;
          setGifbbProgress(false);
          setGifbbButtons();
        }
      }
  
      async function packGifbbResults() {
        const ready = gifbbItems.filter((it) => it.outBlob);
        if (!ready.length) {
          toast("请先处理 GIF");
          return;
        }
        const packed = await zipBlobs(
          ready.map((it) => ({ name: gifbbOutName(it), blob: it.outBlob })),
          "blackbox-gifs.zip"
        );
        if (gifbbZipUrl) {
          try {
            URL.revokeObjectURL(gifbbZipUrl);
          } catch (_) {}
        }
        gifbbZipUrl = packed.url;
        triggerLocalDownload(packed.blob, packed.name);
        toast(`已打包 ${ready.length} 个 GIF`);
      }
  
      bindPanel("gifbb", (root) => {
        root = root || document.getElementById("gifbb");
        gifbbFile = $("#gifbb-file", root);
        gifbbMeta = $("#gifbb-meta", root);
        gifbbError = $("#gifbb-error", root);
        gifbbList = $("#gifbb-list", root);
        gifbbRun = $("#gifbb-run", root);
        gifbbZip = $("#gifbb-zip", root);
        gifbbClear = $("#gifbb-clear", root);
        gifbbAbort = $("#gifbb-abort", root);
  
        if (gifbbFile && !gifbbFile.dataset.gifbbBound) {
          gifbbFile.dataset.gifbbBound = "1";
          gifbbFile.addEventListener("change", (e) => {
            loadGifbbFiles(e.target.files);
          });
        }
  
      gifbbRun?.addEventListener("click", () => {
        runGifbbCompress().catch((err) => setError(gifbbError, err.message || String(err)));
      });
      gifbbZip?.addEventListener("click", () => {
        packGifbbResults().catch((err) => setError(gifbbError, err.message || String(err)));
      });
      const allowScaleEl = $("#gifbb-allow-scale");
      if (allowScaleEl) {
        try {
          allowScaleEl.checked = localStorage.getItem("devtools-gifbb-scale-v1") !== "0";
        } catch (_) {}
        allowScaleEl.addEventListener("change", () => {
          try {
            localStorage.setItem("devtools-gifbb-scale-v1", allowScaleEl.checked ? "1" : "0");
          } catch (_) {}
          if (gifbbMeta) {
            gifbbMeta.textContent = allowScaleEl.checked
              ? "已开启：必要时缩小尺寸/画质以保证压进 6MB"
              : "已关闭：保持原始尺寸，仅降色/压缩，可能无法压进 6MB";
          }
        });
      }
      gifbbClear?.addEventListener("click", clearGifbb);
      gifbbAbort?.addEventListener("click", () => {
        abortGifbb = true;
      });
      window.DevToolsTemp?.registerCleanup(clearGifbb);
      renderGifbbList();
      flushPendingFileInput(gifbbFile, (files) => loadGifbbFiles(files));
      });
    } catch (err) {
      if (String(err?.message) !== "skip gifbb") console.error("gifbb init failed", err);
    }
})();
