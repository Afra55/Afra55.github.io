
      // ---- Video split (shares FFmpeg / blackbox encoder) ----
      let vsplitFile;
      let vsplitVideo;
      let vsplitMeta;
      let vsplitError;
      let vsplitCount;
      let vsplitCountRow;
      let vsplitDurationRow;
      let vsplitManualRow;
      let vsplitManualTransport;
      let vsplitStage;
      let vsplitScrub;
      let vsplitScrubHome;
      let vsplitScrubBlock;
      let vsplitFsScrubSlot;
      let vsplitScrubHit;
      let vsplitScrubMarks;
      let vsplitMarkPicker;
      let vsplitMarkChips;
      let vsplitScrubHint;
      let vsplitPlay;
      let vsplitMute;
      let vsplitFs;
      let vsplitFsHost;
      let vsplitFsOpenBtn;
      let vsplitFsClose;
      let vsplitFsPlay;
      let vsplitFsMute;
      let vsplitFsMark;
      let vsplitFsUndo;
      let vsplitFsNow;
      let vsplitFsStatus;
      let vsplitFsNote;
      let vsplitFsFlash;
      let vsplitPreviewWrap;
      let vsplitManualNow;
      let vsplitManualCount;
      let vsplitManualDraft;
      let vsplitMarksEl;
      let vsplitMarkTap;
      let vsplitMarkUndo;
      let vsplitMarkClear;
      let vsplitAddBtns;
      let vsplitEditBar;
      let vsplitEditTitle;
      let vsplitEditApply;
      let vsplitEditDelStart;
      let vsplitEditDelEnd;
      let vsplitEditDone;
      let vsplitQuickExport;
      let vsplitQuickCut;
      let vsplitQuickHq;
      let vsplitNudgeM1;
      let vsplitNudgeM01;
      let vsplitNudgeP01;
      let vsplitNudgeP1;
      let vsplitH;
      let vsplitM;
      let vsplitS;
      let vsplitFps;
      let vsplitWidth;
      let vsplitQuality;
      let vsplitCut;
      let vsplitGifHq;
      let vsplitMerge;
      let vsplitAbort;
      let vsplitList;
      let vsplitZipVideo;
      let vsplitZipGif;
      let vsplitMergedDl;
      let vsplitMergedPreview;
      let vsplitProgress;
      let vsplitProgressFill;
      let vsplitProgressText;
      let vsplitProgressSub;
      let vsplitProgressPct;
      const VSPLIT_MAX_CLIPS = 50;
      const VSPLIT_MIN_SPAN = 0.5;
      const VSPLIT_DEFAULT_META =
        "支持 MP4 / WebM / MOV。选择后仅本机读取，不会上传。可等分、按时长或手动选段；关闭页面会释放本次视频和 GIF。";
      let vsplitSourceFile = null;
      let vsplitObjectUrl = "";
      let vsplitClips = [];
      let vsplitBusy = false;
      let abortVsplit = false;
      let vsplitZipVideoUrl = "";
      let vsplitZipGifUrl = "";
      let vsplitMergedUrl = "";
      let vsplitMode = "count";
      /** @type {{start:number|null,end:number|null}[]} */
      let vsplitMarks = [];
      /** @type {number|null} */
      let vsplitDraftStart = null;
      let vsplitEditIdx = -1;
      /** 附近标记弹层里高亮的端点（你刚点到的） */
      let vsplitPickerHighlight = null;
      /** @type {"start"|"end"} */
      let vsplitEditFocus = "start";
      let vsplitScrubbing = false;
      let vsplitPlaying = false;
      const VSPLIT_MUTE_KEY = "devtools-vsplit-muted";
      let vsplitMuted = true;
      try {
        const savedMute = localStorage.getItem(VSPLIT_MUTE_KEY);
        if (savedMute === "0") vsplitMuted = false;
        if (savedMute === "1") vsplitMuted = true;
      } catch (_) {
        /* ignore */
      }
      let vsplitFsOpen = false;
      let vsplitFsNoteTimer = 0;
      let vsplitFsPulseTimer = 0;
      let vsplitFsFlashTimer = 0;
      let vsplitFsStatusTimer = 0;
      let vsplitFsFeedbackRaf = 0;
      let vsplitFsScrubPaintRaf = 0;
      const VSPLIT_SCRUB_STEPS = 1000;
      /** 按住滑块上下滑：微调窗口（秒） */
      const VSPLIT_FINE_WINDOW = 4;
      const scrubGesture = {
        active: false,
        pointerId: null,
        startX: 0,
        startY: 0,
        anchorTime: 0,
        fine: false,
      };
  
      function setVsplitProgress(visible, ratio, text, opts = {}) {
        if (!vsplitProgress) return;
        vsplitProgress.hidden = !visible;
        if (!visible) {
          if (vsplitProgressFill) {
            vsplitProgressFill.style.width = "0%";
            vsplitProgressFill.classList.remove("is-active", "is-busy");
          }
          if (vsplitProgressPct) vsplitProgressPct.hidden = true;
          if (vsplitProgressSub) vsplitProgressSub.hidden = true;
          return;
        }
        const pct = Math.max(0, Math.min(100, Math.round((ratio || 0) * 100)));
        const busy = Boolean(opts.busy) || (pct > 0 && pct < 100);
        if (vsplitProgressFill) {
          vsplitProgressFill.style.width = `${Math.max(pct, busy && pct < 8 ? 8 : pct)}%`;
          vsplitProgressFill.classList.toggle("is-active", busy);
          vsplitProgressFill.classList.toggle("is-busy", Boolean(opts.busy));
        }
        if (vsplitProgressPct) {
          vsplitProgressPct.textContent = `${pct}%`;
          vsplitProgressPct.hidden = false;
        }
        if (vsplitProgressText) vsplitProgressText.textContent = text || `${pct}%`;
        if (vsplitProgressSub) {
          vsplitProgressSub.textContent = opts.sub || "";
          vsplitProgressSub.hidden = !opts.sub;
        }
      }
  
      function buildClipProgressDom() {
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
  
      function formatPendingWaitText(job) {
        const status = job?.jobStatus || "";
        const t = String(job?.jobText || "").trim();
        const isWait = !t || t === "等待中…" || t === "等待中";
        if (status !== "pending" || !isWait) return "";
        const origin = Number(job.jobQueuedAt) || 0;
        if (!(origin > 0)) return "";
        const ms = Math.max(0, Date.now() - origin);
        const sec = ms >= 10000 ? Math.round(ms / 1000) : Math.max(0.1, Math.round(ms / 100) / 10);
        return `${sec}s`;
      }

      function syncClipProgressDom(box, job) {
        if (!box) return;
        const status = job?.jobStatus || "";
        // 生成成功后隐藏进度条，只保留文案信息（时长/宽高/尺寸）
        const show = status === "pending" || status === "running" || status === "error";
        box.hidden = !show;
        if (!show) return;
        // 运行中节流 DOM 写入（≤90ms 一次），状态切换(完成/失败)始终刷新
        if (status === "running") {
          const now = Date.now();
          if (now - (box._lastSync || 0) < 90) return;
          box._lastSync = now;
        }
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
          const waitLabel =
            typeof formatPendingWaitText === "function" ? formatPendingWaitText(job) : "";
          textEl.textContent =
            waitLabel ||
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
  
      function setVsplitClipJob(idx, patch = {}) {
        const c = vsplitClips[idx];
        if (!c) return;
        if (patch.status != null) c.jobStatus = patch.status;
        if (patch.progress != null) c.jobProgress = Math.max(0, Math.min(1, Number(patch.progress) || 0));
        if (patch.text != null) c.jobText = String(patch.text || "");
        const row = vsplitList?.querySelector(`[data-vsplit-clip="${idx}"]`);
        if (row) syncClipProgressDom(row.querySelector(".vsplit-clip-progress"), c);
      }
  
      function clearVsplitClipJobs() {
        vsplitClips.forEach((c) => {
          c.jobStatus = "";
          c.jobProgress = 0;
          c.jobText = "";
        });
      }
  
      function formatClock(sec) {
        const s = Math.max(0, Number(sec) || 0);
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const r = Math.floor(s % 60);
        const tenths = Math.round((s - Math.floor(s)) * 10);
        const tail = tenths ? `.${tenths}` : "";
        if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}${tail}`;
        return `${m}:${String(r).padStart(2, "0")}${tail}`;
      }
  
      /** 片段时长文案，如 7.0秒 */
      function formatVsplitSpanSec(sec) {
        const s = Math.max(0, Number(sec) || 0);
        const rounded = Math.round(s * 10) / 10;
        return `${rounded.toFixed(1)}秒`;
      }
  
      function formatVsplitMarkRangeLabel(mark, idx) {
        const n = `#${String(idx + 1).padStart(2, "0")}`;
        const s = mark?.start == null ? "—" : formatClock(mark.start);
        const e = mark?.end == null ? "—" : formatClock(mark.end);
        if (mark && isMarkComplete(mark)) {
          return `${n} ${s}→${e} · 共${formatVsplitSpanSec(mark.end - mark.start)}`;
        }
        return `${n} ${s}→${e}`;
      }
  
      function revokeUrl(url) {
        if (!url) return;
        try {
          URL.revokeObjectURL(url);
        } catch (_) {}
      }
  
      function hideDownloadLink(el) {
        if (!el) return;
        el.hidden = true;
        el.removeAttribute("href");
      }
  
      function revokeVsplitGifOutputs() {
        revokeUrl(vsplitZipGifUrl);
        revokeUrl(vsplitMergedUrl);
        vsplitZipGifUrl = "";
        vsplitMergedUrl = "";
        if (vsplitZipGif) vsplitZipGif.disabled = true;
        hideDownloadLink(vsplitMergedDl);
        if (vsplitMergedPreview) {
          vsplitMergedPreview.hidden = true;
          vsplitMergedPreview.removeAttribute("src");
        }
      }
  
      function revokeVsplitDownloads() {
        revokeUrl(vsplitZipVideoUrl);
        vsplitZipVideoUrl = "";
        if (vsplitZipVideo) vsplitZipVideo.disabled = true;
        revokeVsplitGifOutputs();
      }
  
      function resetVsplitAbort() {
        abortVsplit = false;
        abortV2g = false;
      }
  
      function clearVsplitClips() {
        vsplitClips.forEach((c) => {
          try {
            if (c.videoUrl) URL.revokeObjectURL(c.videoUrl);
          } catch (_) {}
          try {
            if (c.gifUrl) URL.revokeObjectURL(c.gifUrl);
          } catch (_) {}
        });
        vsplitClips = [];
        if (vsplitList) vsplitList.innerHTML = "";
        revokeVsplitDownloads();
      }
  
      function isMarkComplete(m) {
        return (
          m &&
          Number.isFinite(m.start) &&
          Number.isFinite(m.end) &&
          m.start != null &&
          m.end != null &&
          m.end - m.start >= VSPLIT_MIN_SPAN - 0.001
        );
      }
  
      function completeVsplitMarks() {
        return vsplitMarks.filter(isMarkComplete);
      }
  
      function setVsplitButtons() {
        const hasVideo = Boolean(vsplitSourceFile && vsplitVideo?.src);
        const hasClips = vsplitClips.length > 0;
        const completeMarks = completeVsplitMarks();
        const hasComplete = completeMarks.length > 0;
        const videoCount = vsplitClips.filter((c) => c.videoBlob).length;
        const gifCount = vsplitClips.filter((c) => c.gifBlob).length;
        const editing = vsplitEditIdx >= 0;
        const canManualCut = vsplitMode !== "manual" || hasComplete;
        if (vsplitCut) {
          vsplitCut.disabled = !hasVideo || vsplitBusy || !canManualCut;
          vsplitCut.textContent = vsplitMode === "manual" ? "按标记切成视频" : "切成视频";
        }
        const canGif = hasClips || (vsplitMode === "manual" && hasComplete);
        if (vsplitGifHq) vsplitGifHq.disabled = !canGif || vsplitBusy;
        if (vsplitMerge) vsplitMerge.disabled = gifCount < 2 || vsplitBusy;
        if (vsplitZipVideo) vsplitZipVideo.disabled = videoCount < 1 || vsplitBusy;
        if (vsplitZipGif) vsplitZipGif.disabled = gifCount < 1 || vsplitBusy;
        if (vsplitPlay) {
          vsplitPlay.disabled = !hasVideo || vsplitBusy || vsplitMode !== "manual";
          vsplitPlay.textContent = vsplitPlaying ? "暂停" : "播放";
        }
        paintVsplitMuteButtons(hasVideo && !vsplitBusy && vsplitMode === "manual");
        const markLabel = vsplitDraftStart == null ? "打起点" : "打终点";
        if (vsplitMarkTap) {
          vsplitMarkTap.disabled = !hasVideo || vsplitBusy || editing;
          vsplitMarkTap.textContent = markLabel;
        }
        if (vsplitFsOpenBtn) {
          vsplitFsOpenBtn.disabled = !hasVideo || vsplitBusy || vsplitMode !== "manual";
          vsplitFsOpenBtn.hidden = vsplitMode !== "manual";
        }
        if (vsplitFsPlay) {
          vsplitFsPlay.disabled = !hasVideo || vsplitBusy;
          vsplitFsPlay.textContent = vsplitPlaying ? "暂停" : "播放";
        }
        if (vsplitFsMark) {
          vsplitFsMark.disabled = !hasVideo || vsplitBusy || editing;
          vsplitFsMark.textContent = markLabel;
        }
        const canUndoLast =
          !editing && hasVideo && !vsplitBusy && (vsplitDraftStart != null || vsplitMarks.length > 0);
        const undoLabel = vsplitDraftStart != null ? "取消起点" : "取消上一段";
        if (vsplitMarkUndo) {
          vsplitMarkUndo.hidden = false;
          vsplitMarkUndo.disabled = !canUndoLast;
          vsplitMarkUndo.textContent = undoLabel;
        }
        if (vsplitFsUndo) {
          vsplitFsUndo.disabled = !canUndoLast;
          vsplitFsUndo.textContent = undoLabel;
        }
        if (vsplitMarkClear) {
          vsplitMarkClear.disabled =
            (!vsplitMarks.length && vsplitDraftStart == null) || vsplitBusy || editing;
        }
        if (vsplitScrub) vsplitScrub.disabled = !hasVideo || vsplitBusy || vsplitMode !== "manual";
        [vsplitNudgeM1, vsplitNudgeM01, vsplitNudgeP01, vsplitNudgeP1].forEach((btn) => {
          if (btn) btn.disabled = !hasVideo || vsplitBusy || vsplitMode !== "manual";
        });
        if (vsplitAddBtns) vsplitAddBtns.hidden = editing;
        if (vsplitEditBar) vsplitEditBar.hidden = !editing;
        if (vsplitQuickExport) {
          vsplitQuickExport.hidden = !(vsplitMode === "manual" && hasComplete);
        }
        if (vsplitQuickCut) vsplitQuickCut.disabled = !hasVideo || vsplitBusy || !canManualCut;
        if (vsplitQuickHq) vsplitQuickHq.disabled = !canGif || vsplitBusy;
        if (editing) {
          const mark = vsplitMarks[vsplitEditIdx];
          if (vsplitEditApply) {
            vsplitEditApply.disabled = !hasVideo || vsplitBusy;
            vsplitEditApply.textContent = vsplitEditFocus === "start" ? "设为起点" : "设为终点";
          }
          if (vsplitEditDelStart) vsplitEditDelStart.disabled = !mark || mark.start == null || vsplitBusy;
          if (vsplitEditDelEnd) vsplitEditDelEnd.disabled = !mark || mark.end == null || vsplitBusy;
          $$("#vsplit-edit-focus [data-edit-focus]").forEach((btn) => {
            btn.classList.toggle("is-active", btn.dataset.editFocus === vsplitEditFocus);
          });
          if (vsplitEditTitle) {
            const n = String(vsplitEditIdx + 1).padStart(2, "0");
            const focusLabel = vsplitEditFocus === "start" ? "起点" : "终点";
            vsplitEditTitle.textContent = `编辑 #${n} · 拖滑块即调${focusLabel}`;
          }
        }
      }
  
      function syncVsplitMode() {
        const isCount = vsplitMode === "count";
        const isDuration = vsplitMode === "duration";
        const isManual = vsplitMode === "manual";
        $("#vsplit-mode-n")?.classList.toggle("is-active", isCount);
        $("#vsplit-mode-t")?.classList.toggle("is-active", isDuration);
        $("#vsplit-mode-m")?.classList.toggle("is-active", isManual);
        if (vsplitCountRow) vsplitCountRow.hidden = !isCount;
        if (vsplitDurationRow) vsplitDurationRow.hidden = !isDuration;
        if (vsplitManualRow) vsplitManualRow.hidden = !isManual;
        if (vsplitManualTransport) vsplitManualTransport.hidden = !isManual;
        if (vsplitMarksEl) vsplitMarksEl.hidden = true;
        vsplitStage?.classList.toggle("is-manual", isManual);
        if (!isManual) {
          pauseVsplitPreview();
          exitVsplitEdit();
          exitVsplitFullscreen({ restoreVideo: true });
        }
        if (vsplitVideo) {
          if (isManual) vsplitVideo.removeAttribute("controls");
          else vsplitVideo.setAttribute("controls", "");
        }
        if (isManual) {
          syncVsplitScrubFromVideo();
          paintVsplitNow();
          paintVsplitMarks();
        }
        setVsplitButtons();
      }
  
      function roundVsplitTime(sec) {
        const n = Number(sec);
        if (!Number.isFinite(n)) return 0;
        return Math.round(Math.max(0, n) * 10) / 10;
      }
  
      function vsplitVideoNow() {
        return Number(vsplitVideo?.currentTime) || 0;
      }
  
      function vsplitVideoDuration() {
        const d = Number(vsplitVideo?.duration);
        return Number.isFinite(d) && d > 0 ? d : 0;
      }
  
      function pauseVsplitPreview() {
        try {
          vsplitVideo?.pause?.();
        } catch (_) {}
        vsplitPlaying = false;
        if (vsplitPlay) vsplitPlay.textContent = "播放";
        if (vsplitFsPlay) vsplitFsPlay.textContent = "播放";
      }
  
      function paintVsplitMuteButtons(enabled) {
        const label = vsplitMuted ? "开声音" : "静音";
        const title = vsplitMuted ? "当前静音，点此开声音" : "当前有声，点此静音";
        [vsplitMute, vsplitFsMute].forEach((btn) => {
          if (!btn) return;
          if (enabled != null) btn.disabled = !enabled;
          btn.textContent = label;
          btn.title = title;
          btn.setAttribute("aria-pressed", vsplitMuted ? "true" : "false");
          btn.classList.toggle("is-muted", vsplitMuted);
        });
      }
  
      function applyVsplitMute() {
        if (!vsplitVideo) return;
        vsplitVideo.muted = Boolean(vsplitMuted);
        if (!vsplitMuted) {
          try {
            vsplitVideo.volume = 1;
          } catch (_) {
            /* ignore */
          }
          vsplitVideo.removeAttribute("muted");
        } else {
          vsplitVideo.setAttribute("muted", "");
        }
        paintVsplitMuteButtons();
      }
  
      function toggleVsplitMute() {
        vsplitMuted = !vsplitMuted;
        try {
          localStorage.setItem(VSPLIT_MUTE_KEY, vsplitMuted ? "1" : "0");
        } catch (_) {
          /* ignore */
        }
        applyVsplitMute();
        toast(vsplitMuted ? "已静音" : "已开声音");
      }
  
      async function toggleVsplitPlay() {
        if (!vsplitVideo || !vsplitSourceFile || vsplitMode !== "manual") return;
        if (vsplitPlaying || !vsplitVideo.paused) {
          pauseVsplitPreview();
          return;
        }
        applyVsplitMute();
        try {
          await vsplitVideo.play();
          vsplitPlaying = true;
          if (vsplitPlay) vsplitPlay.textContent = "暂停";
          if (vsplitFsPlay) vsplitFsPlay.textContent = "暂停";
        } catch (err) {
          // 部分浏览器禁止带声音自动播：回退静音再试一次
          if (!vsplitMuted) {
            vsplitMuted = true;
            applyVsplitMute();
            try {
              await vsplitVideo.play();
              vsplitPlaying = true;
              if (vsplitPlay) vsplitPlay.textContent = "暂停";
              if (vsplitFsPlay) vsplitFsPlay.textContent = "暂停";
              toast("浏览器限制有声播放，已改为静音；可再点「开声音」");
              setVsplitButtons();
              return;
            } catch (_) {
              /* fall through */
            }
          }
          vsplitPlaying = false;
          toast(err?.message || "无法播放");
        }
        setVsplitButtons();
      }
  
      function paintVsplitFsChrome() {
        if (!vsplitFsOpen) return;
        const now = vsplitScrubbing ? scrubValueToTime(vsplitScrub?.value) : vsplitVideoNow();
        const dur = vsplitVideoDuration();
        if (vsplitFsNow) {
          if (!vsplitSourceFile || !(dur > 0)) vsplitFsNow.textContent = "0:00 / 0:00";
          else vsplitFsNow.textContent = `${formatClock(now)} / ${formatClock(dur)}`;
        }
        if (vsplitFsStatus) {
          const done = completeVsplitMarks().length;
          const phase = vsplitDraftStart == null ? "等待打起点" : "正在打终点";
          vsplitFsStatus.textContent = `已完成 ${done} 段 · ${phase}`;
        }
        if (vsplitFsPlay) vsplitFsPlay.textContent = vsplitPlaying ? "暂停" : "播放";
        paintVsplitMuteButtons();
        if (vsplitFsMark) {
          vsplitFsMark.textContent = vsplitDraftStart == null ? "打起点" : "打终点";
        }
        if (vsplitFsUndo) {
          const canUndo =
            vsplitEditIdx < 0 &&
            Boolean(vsplitSourceFile) &&
            (vsplitDraftStart != null || vsplitMarks.length > 0);
          vsplitFsUndo.disabled = !canUndo || vsplitBusy;
          vsplitFsUndo.textContent = vsplitDraftStart != null ? "取消起点" : "取消上一段";
        }
      }
  
      function clearVsplitFsFeedbackTimers() {
        if (vsplitFsNoteTimer) window.clearTimeout(vsplitFsNoteTimer);
        if (vsplitFsPulseTimer) window.clearTimeout(vsplitFsPulseTimer);
        if (vsplitFsFlashTimer) window.clearTimeout(vsplitFsFlashTimer);
        if (vsplitFsStatusTimer) window.clearTimeout(vsplitFsStatusTimer);
        if (vsplitFsFeedbackRaf) window.cancelAnimationFrame(vsplitFsFeedbackRaf);
        if (vsplitFsScrubPaintRaf) window.cancelAnimationFrame(vsplitFsScrubPaintRaf);
        vsplitFsNoteTimer = 0;
        vsplitFsPulseTimer = 0;
        vsplitFsFlashTimer = 0;
        vsplitFsStatusTimer = 0;
        vsplitFsFeedbackRaf = 0;
        vsplitFsScrubPaintRaf = 0;
      }
  
      function bumpVsplitFsStatus() {
        if (!vsplitFsStatus) return;
        vsplitFsStatus.classList.remove("is-bump");
        vsplitFsStatus.classList.add("is-bump");
        if (vsplitFsStatusTimer) window.clearTimeout(vsplitFsStatusTimer);
        vsplitFsStatusTimer = window.setTimeout(() => {
          vsplitFsStatus.classList.remove("is-bump");
          vsplitFsStatusTimer = 0;
        }, 280);
      }
  
      function pulseVsplitFsMarkBtn(kind) {
        if (!vsplitFsMark) return;
        vsplitFsMark.classList.remove("is-pulse", "is-pulse-start", "is-pulse-end");
        vsplitFsMark.classList.add("is-pulse", kind === "end" ? "is-pulse-end" : "is-pulse-start");
        if (vsplitFsPulseTimer) window.clearTimeout(vsplitFsPulseTimer);
        vsplitFsPulseTimer = window.setTimeout(() => {
          vsplitFsMark.classList.remove("is-pulse", "is-pulse-start", "is-pulse-end");
          vsplitFsPulseTimer = 0;
        }, 200);
      }
  
      function ensureVsplitFsFlashOnTop() {
        if (!vsplitFsFlash || !vsplitFsHost) return;
        // 仅在需要时挪闪层，避免每次打点 appendChild 触发合成重建
        if (vsplitFsHost.lastElementChild !== vsplitFsFlash) {
          vsplitFsHost.appendChild(vsplitFsFlash);
        }
      }
  
      function flashVsplitFsFrame(kind) {
        if (!vsplitFsFlash || !vsplitFsHost) return;
        ensureVsplitFsFlashOnTop();
        const endClass = kind === "end" ? "is-end" : "is-start";
        // 不用 offsetWidth 强制回流；用 animation 重启
        vsplitFsFlash.classList.remove("is-pop", "is-start", "is-end");
        vsplitFsFlash.style.animation = "none";
        vsplitFsFlash.classList.add(endClass);
        // 下一帧再开动画，避免与打点 DOM 重绘抢同一帧
        requestAnimationFrame(() => {
          if (!vsplitFsOpen || !vsplitFsFlash) return;
          vsplitFsFlash.style.animation = "";
          vsplitFsFlash.classList.add("is-pop");
        });
        if (vsplitFsFlashTimer) window.clearTimeout(vsplitFsFlashTimer);
        vsplitFsFlashTimer = window.setTimeout(() => {
          vsplitFsFlash.classList.remove("is-pop", "is-start", "is-end");
          vsplitFsFlash.style.animation = "";
          vsplitFsFlashTimer = 0;
        }, 450);
      }
  
      function showVsplitFsNote(text, kind) {
        if (!vsplitFsNote) return;
        vsplitFsNote.hidden = false;
        vsplitFsNote.textContent = text || "";
        vsplitFsNote.classList.remove("is-on", "is-start", "is-end");
        vsplitFsNote.classList.add("is-on", kind === "end" ? "is-end" : "is-start");
        if (vsplitFsNoteTimer) window.clearTimeout(vsplitFsNoteTimer);
        vsplitFsNoteTimer = window.setTimeout(() => {
          vsplitFsNote.classList.remove("is-on");
          vsplitFsNoteTimer = 0;
        }, 900);
      }
  
      function buzzVsplitFs() {
        try {
          if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
            navigator.vibrate(12);
          }
        } catch (_) {}
      }
  
      /** 全屏打点节奏反馈；非全屏仍走 toast。视觉反馈延后一帧，避免与圆点重绘同帧卡死。 */
      function notifyVsplitMarkFeedback(message, kind) {
        if (!vsplitFsOpen) {
          toast(message);
          return;
        }
        ensureVsplitFsChromeVisible();
        paintVsplitFsChrome();
        buzzVsplitFs();
        if (vsplitFsFeedbackRaf) window.cancelAnimationFrame(vsplitFsFeedbackRaf);
        vsplitFsFeedbackRaf = requestAnimationFrame(() => {
          vsplitFsFeedbackRaf = 0;
          if (!vsplitFsOpen) return;
          pulseVsplitFsMarkBtn(kind);
          flashVsplitFsFrame(kind);
          bumpVsplitFsStatus();
          showVsplitFsNote(message, kind);
        });
      }
  
      function ensureVsplitFsVideoSurface() {
        if (!vsplitFsOpen || !vsplitVideo || !vsplitFsHost) return;
        if (vsplitVideo.parentElement !== vsplitFsHost) {
          if (vsplitFsFlash && vsplitFsFlash.parentElement === vsplitFsHost) {
            vsplitFsHost.insertBefore(vsplitVideo, vsplitFsFlash);
          } else {
            vsplitFsHost.appendChild(vsplitVideo);
          }
        }
        vsplitVideo.hidden = false;
        vsplitVideo.classList.add("is-fs");
        ensureVsplitFsFlashOnTop();
      }
  
      function ensureVsplitFsChromeVisible() {
        if (!vsplitFsOpen || !vsplitFs) return;
        vsplitFs.hidden = false;
        vsplitFs.querySelector(".vsplit-fs-top")?.style && (vsplitFs.querySelector(".vsplit-fs-top").style.visibility = "");
        vsplitFs.querySelector(".vsplit-fs-bottom")?.style &&
          (vsplitFs.querySelector(".vsplit-fs-bottom").style.visibility = "");
        ensureVsplitFsVideoSurface();
      }
  
      function enterVsplitFullscreen() {
        if (!vsplitVideo || !vsplitSourceFile || vsplitMode !== "manual" || !vsplitFs || !vsplitFsHost) return;
        if (vsplitFsOpen) return;
        if (vsplitEditIdx >= 0) exitVsplitEdit();
        vsplitFsOpen = true;
        vsplitFs.hidden = false;
        document.body.classList.add("vsplit-fs-open");
        // 只挪一次 video；先放视频再保证闪层在上，减少解码表面重建次数
        if (vsplitVideo.parentElement !== vsplitFsHost) {
          if (vsplitFsFlash && vsplitFsFlash.parentElement === vsplitFsHost) {
            vsplitFsHost.insertBefore(vsplitVideo, vsplitFsFlash);
          } else {
            vsplitFsHost.appendChild(vsplitVideo);
          }
        }
        ensureVsplitFsFlashOnTop();
        // 进度条 + 打点圆点一并带进全屏，避免无法拖进度
        if (vsplitScrubBlock && vsplitFsScrubSlot && vsplitScrubBlock.parentElement !== vsplitFsScrubSlot) {
          vsplitFsScrubSlot.appendChild(vsplitScrubBlock);
        }
        ensureVsplitFsVideoSurface();
        vsplitVideo.hidden = false;
        vsplitVideo.classList.add("is-fs");
        paintVsplitFsChrome();
        paintVsplitScrubMarks();
        syncVsplitScrubFromVideo();
        setVsplitButtons();
        // 进入后尽量继续播，便于边看边打点
        if (vsplitVideo.paused) {
          toggleVsplitPlay().catch(() => {});
        }
      }
  
      function exitVsplitFullscreen(opts = {}) {
        if (!vsplitFsOpen && !opts.force) {
          // 仍确保视频回到预览区
          if (opts.restoreVideo !== false && vsplitVideo && vsplitPreviewWrap && vsplitVideo.parentElement !== vsplitPreviewWrap) {
            vsplitPreviewWrap.appendChild(vsplitVideo);
          }
          if (vsplitScrubBlock && vsplitScrubHome && vsplitScrubBlock.parentElement !== vsplitScrubHome) {
            vsplitScrubHome.appendChild(vsplitScrubBlock);
          }
          return;
        }
        vsplitFsOpen = false;
        clearVsplitFsFeedbackTimers();
        if (vsplitFsFlash) vsplitFsFlash.style.animation = "";
        if (vsplitFsNote) {
          vsplitFsNote.hidden = true;
          vsplitFsNote.classList.remove("is-on", "is-start", "is-end");
          vsplitFsNote.textContent = "";
        }
        vsplitFsMark?.classList.remove("is-pulse", "is-pulse-start", "is-pulse-end");
        vsplitFsStatus?.classList.remove("is-bump");
        vsplitFsFlash?.classList.remove("is-pop", "is-start", "is-end");
        if (vsplitFs) vsplitFs.hidden = true;
        document.body.classList.remove("vsplit-fs-open");
        if (vsplitVideo) {
          vsplitVideo.classList.remove("is-fs");
          if (opts.restoreVideo !== false && vsplitPreviewWrap && vsplitVideo.parentElement !== vsplitPreviewWrap) {
            vsplitPreviewWrap.appendChild(vsplitVideo);
          }
        }
        if (vsplitScrubBlock && vsplitScrubHome && vsplitScrubBlock.parentElement !== vsplitScrubHome) {
          vsplitScrubHome.appendChild(vsplitScrubBlock);
        }
        /* 全屏期间只刷了 scrub；退出后补一次完整列表 */
        try {
          paintVsplitMarks();
        } catch (err) {
          console.error(err);
          paintVsplitScrubMarks();
        }
        syncVsplitScrubFromVideo();
        paintVsplitNow();
        setVsplitButtons();
      }
  
      function scrubValueToTime(raw) {
        const dur = vsplitVideoDuration();
        if (!(dur > 0)) return 0;
        if (scrubGesture.fine) {
          const steps = Math.max(1, Number(vsplitScrub?.max) || VSPLIT_SCRUB_STEPS);
          const v = Math.max(0, Math.min(steps, Number(raw) || 0));
          const ratio = v / steps;
          const half = VSPLIT_FINE_WINDOW / 2;
          const t = scrubGesture.anchorTime - half + ratio * VSPLIT_FINE_WINDOW;
          return Math.max(0, Math.min(dur, t));
        }
        const steps = Math.max(1, Number(vsplitScrub?.max) || VSPLIT_SCRUB_STEPS);
        const v = Math.max(0, Math.min(steps, Number(raw) || 0));
        return (v / steps) * dur;
      }
  
      function timeToScrubValue(sec) {
        const dur = vsplitVideoDuration();
        if (!(dur > 0)) return 0;
        const steps = Math.max(1, Number(vsplitScrub?.max) || VSPLIT_SCRUB_STEPS);
        if (scrubGesture.fine) {
          const half = VSPLIT_FINE_WINDOW / 2;
          const lo = scrubGesture.anchorTime - half;
          const ratio = (Math.max(0, Math.min(sec, dur)) - lo) / VSPLIT_FINE_WINDOW;
          return Math.round(Math.max(0, Math.min(1, ratio)) * steps);
        }
        return Math.round((Math.max(0, Math.min(sec, dur)) / dur) * steps);
      }
  
      function syncVsplitScrubFromVideo() {
        if (!vsplitScrub || vsplitScrubbing) return;
        const dur = vsplitVideoDuration();
        const has = Boolean(vsplitSourceFile && dur > 0);
        vsplitScrub.disabled = !has || vsplitBusy || vsplitMode !== "manual";
        if (!has) {
          vsplitScrub.value = "0";
          return;
        }
        vsplitScrub.max = String(VSPLIT_SCRUB_STEPS);
        vsplitScrub.value = String(timeToScrubValue(Number(vsplitVideo?.currentTime) || 0));
      }
  
      function seekVsplitPreview(sec, opts = {}) {
        if (!vsplitVideo) return;
        const dur = vsplitVideoDuration();
        let t = Number(sec) || 0;
        if (dur > 0) t = Math.max(0, Math.min(t, Math.max(0, dur - 0.001)));
        if (!opts.keepPlaying) pauseVsplitPreview();
        try {
          if (typeof vsplitVideo.fastSeek === "function") vsplitVideo.fastSeek(t);
          else vsplitVideo.currentTime = t;
        } catch (_) {}
        if (vsplitFsOpen) ensureVsplitFsVideoSurface();
        if (!opts.fromScrub) syncVsplitScrubFromVideo();
        paintVsplitNow();
      }
  
      function nudgeVsplitPreview(delta) {
        const now = vsplitScrubbing ? scrubValueToTime(vsplitScrub?.value) : vsplitVideoNow();
        seekVsplitPreview(now + delta);
        if (vsplitEditIdx >= 0) applyScrubToEditFocus({ silent: true });
      }
  
      function paintScrubHint() {
        if (!vsplitScrubHint) return;
        if (scrubGesture.fine) {
          const half = (VSPLIT_FINE_WINDOW / 2).toFixed(1);
          vsplitScrubHint.textContent = `微调中 · 窗口 ±${half}s（松手回粗调）`;
          return;
        }
        if (vsplitEditIdx >= 0) {
          vsplitScrubHint.textContent = "编辑中只显示本段绿/橙点 · 上方可点「退出编辑」· 上下滑微调";
          return;
        }
        vsplitScrubHint.textContent = "绿起点 / 橙终点同行 · 点圆点或芯片进入编辑 · 上下滑微调";
      }
  
      function onVsplitScrubInput() {
        if (!vsplitScrub || !vsplitSourceFile) return;
        vsplitScrubbing = true;
        pauseVsplitPreview();
        const t = scrubValueToTime(vsplitScrub.value);
        seekVsplitPreview(t, { fromScrub: true });
        if (vsplitFsOpen) ensureVsplitFsChromeVisible();
        if (vsplitManualNow) {
          const dur = vsplitVideoDuration();
          vsplitManualNow.textContent = `${formatClock(t)} / ${formatClock(dur)}`;
        }
        paintScrubHint();
      }
  
      function onVsplitScrubCommit() {
        onVsplitScrubInput();
        vsplitScrubbing = false;
        scrubGesture.active = false;
        scrubGesture.fine = false;
        scrubGesture.pointerId = null;
        syncVsplitScrubFromVideo();
        if (vsplitEditIdx >= 0) applyScrubToEditFocus({ silent: true });
        if (vsplitFsOpen) {
          ensureVsplitFsChromeVisible();
          paintVsplitScrubMarks();
        }
        paintVsplitNow();
        paintScrubHint();
      }
  
      function beginScrubGesture(ev) {
        if (!vsplitSourceFile || vsplitMode !== "manual") return;
        const t = vsplitVideoNow();
        scrubGesture.active = true;
        scrubGesture.pointerId = ev.pointerId;
        scrubGesture.startX = ev.clientX;
        scrubGesture.startY = ev.clientY;
        scrubGesture.anchorTime = t;
        scrubGesture.fine = false;
        vsplitScrubbing = true;
        pauseVsplitPreview();
        paintScrubHint();
      }
  
      function moveScrubGesture(ev) {
        if (!scrubGesture.active) return;
        if (scrubGesture.pointerId != null && ev.pointerId !== scrubGesture.pointerId) return;
        const dy = scrubGesture.startY - ev.clientY;
        if (!scrubGesture.fine && Math.abs(dy) > 28) {
          scrubGesture.fine = true;
          scrubGesture.anchorTime = scrubValueToTime(vsplitScrub?.value) || vsplitVideoNow();
          if (vsplitScrub) vsplitScrub.value = String(Math.round(VSPLIT_SCRUB_STEPS / 2));
          toast("已进入微调");
        }
        if (!vsplitScrub) return;
        // 水平仍走 range 原生值；微调时 value→time 用局部窗口
        onVsplitScrubInput();
      }
  
      function clearVsplitMarks() {
        vsplitMarks = [];
        vsplitDraftStart = null;
        hideVsplitMarkPicker();
        exitVsplitEdit();
        paintVsplitMarks();
        setVsplitButtons();
      }
  
      function invalidateVsplitOutputsFromMarks() {
        if (vsplitClips.length) clearVsplitClips();
        setVsplitButtons();
      }
  
      function exitVsplitEdit() {
        vsplitEditIdx = -1;
        vsplitEditFocus = "start";
        hideVsplitMarkPicker();
        setVsplitButtons();
        paintVsplitMarks();
      }
  
      function enterVsplitEdit(idx) {
        if (idx < 0 || idx >= vsplitMarks.length) return;
        const mark = vsplitMarks[idx];
        if (!mark) return;
        /* 全屏编辑栏被隐藏；进编辑还会重绘下方长列表，手机易白屏 */
        if (vsplitFsOpen) {
          const jump = mark.start != null ? mark.start : mark.end;
          if (jump != null) seekVsplitPreview(jump, { keepPlaying: true });
          return;
        }
        pauseVsplitPreview();
        vsplitDraftStart = null;
        vsplitEditIdx = idx;
        hideVsplitMarkPicker();
        vsplitEditFocus = mark.start == null && mark.end != null ? "end" : "start";
        const jump = vsplitEditFocus === "end" ? mark.end : mark.start;
        if (jump != null) seekVsplitPreview(jump);
        paintVsplitDraft();
        paintVsplitMarks();
        setVsplitButtons();
        toast(`编辑 #${String(idx + 1).padStart(2, "0")}`);
      }
  
      function paintVsplitNow() {
        const now = vsplitScrubbing ? scrubValueToTime(vsplitScrub?.value) : vsplitVideoNow();
        const dur = vsplitVideoDuration();
        if (vsplitManualNow) {
          if (!vsplitSourceFile || !(dur > 0)) vsplitManualNow.textContent = "0:00 / 0:00";
          else vsplitManualNow.textContent = `${formatClock(now)} / ${formatClock(dur)}`;
        }
        if (vsplitManualCount) {
          const done = completeVsplitMarks().length;
          const total = vsplitMarks.length;
          vsplitManualCount.textContent = total ? `${done}/${total} 段` : "0 段";
        }
        if (!vsplitScrubbing) syncVsplitScrubFromVideo();
        // 播放 timeupdate 很频繁：不在这里重绘圆点/芯片，避免布局抖动导致打点按钮点不中
        paintScrubHint();
        paintVsplitFsChrome();
      }
  
      function paintVsplitDraft() {
        if (!vsplitManualDraft) return;
        if (vsplitEditIdx >= 0) {
          const mark = vsplitMarks[vsplitEditIdx];
          const s = mark?.start == null ? "—" : formatClock(mark.start);
          const e = mark?.end == null ? "—" : formatClock(mark.end);
          const focusLabel = vsplitEditFocus === "start" ? "起点" : "终点";
          vsplitManualDraft.hidden = false;
          vsplitManualDraft.textContent = `编辑中 ${s} → ${e} · 拖滑块松手即更新${focusLabel}`;
          return;
        }
        if (vsplitDraftStart == null) {
          vsplitManualDraft.hidden = true;
          vsplitManualDraft.textContent = "";
          return;
        }
        vsplitManualDraft.hidden = false;
        vsplitManualDraft.textContent = `已设起点 ${formatClock(vsplitDraftStart)} · 拖到终点后点「打终点」`;
      }
  
      function collectVsplitScrubEndpoints() {
        const list = [];
        // 编辑某段时只暴露该段端点，避免点到被隐藏的其它标记
        if (vsplitEditIdx >= 0) {
          const mark = vsplitMarks[vsplitEditIdx];
          if (!mark) return list;
          if (mark.start != null) {
            list.push({ t: Number(mark.start), kind: "start", idx: vsplitEditIdx, draft: false });
          }
          if (mark.end != null) {
            list.push({ t: Number(mark.end), kind: "end", idx: vsplitEditIdx, draft: false });
          }
          return list;
        }
        if (vsplitDraftStart != null) {
          list.push({ t: Number(vsplitDraftStart), kind: "start", idx: -1, draft: true });
        }
        vsplitMarks.forEach((mark, idx) => {
          if (mark.start != null) list.push({ t: Number(mark.start), kind: "start", idx, draft: false });
          if (mark.end != null) list.push({ t: Number(mark.end), kind: "end", idx, draft: false });
        });
        return list;
      }
  
      function hideVsplitMarkPicker() {
        const hadHighlight = !!vsplitPickerHighlight;
        const wasOpen = Boolean(vsplitMarkPicker && !vsplitMarkPicker.hidden);
        if (vsplitMarkPicker) {
          vsplitMarkPicker.hidden = true;
          vsplitMarkPicker.innerHTML = "";
        }
        vsplitPickerHighlight = null;
        if (hadHighlight || wasOpen) paintVsplitScrubMarks();
      }
  
      function showVsplitMarkPicker(near, clientX, preferred) {
        if (!vsplitMarkPicker || !vsplitScrubHit) return;
        const hitRect = vsplitScrubHit.getBoundingClientRect();
        // near 可能已按距离排序；先记下最近点，再按时间排列表
        const items = near.filter((ep) => !ep.draft && ep.idx >= 0);
        if (!items.length) {
          hideVsplitMarkPicker();
          return;
        }
        const prefer =
          (preferred &&
            items.find((ep) => ep.idx === preferred.idx && ep.kind === preferred.kind)) ||
          items[0];
        items.sort(
          (a, b) =>
            a.t - b.t ||
            a.idx - b.idx ||
            (a.kind === b.kind ? 0 : a.kind === "start" ? -1 : 1)
        );
        vsplitPickerHighlight = prefer ? { idx: prefer.idx, kind: prefer.kind } : null;
        vsplitMarkPicker.innerHTML = "";
        const title = document.createElement("p");
        title.className = "vsplit-mark-picker-title";
        title.textContent = `附近 ${items.length} 个标记（按时间）· 高亮为你点到的：`;
        vsplitMarkPicker.appendChild(title);
        items.forEach((ep) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.setAttribute("role", "option");
          const isNearest =
            prefer && ep.idx === prefer.idx && ep.kind === prefer.kind;
          if (isNearest) {
            btn.className = "is-nearest";
            btn.setAttribute("aria-selected", "true");
          } else {
            btn.setAttribute("aria-selected", "false");
          }
          const kindLabel = ep.kind === "end" ? "终点" : "起点";
          const badge = isNearest ? `<span class="vsplit-mark-picker-badge">当前</span>` : "";
          const mark = vsplitMarks[ep.idx];
          let rangeHtml = "";
          if (mark && isMarkComplete(mark)) {
            rangeHtml = ` <span class="mono vsplit-mark-picker-range">${formatClock(mark.start)}→${formatClock(mark.end)} · 共${formatVsplitSpanSec(mark.end - mark.start)}</span>`;
          } else if (mark) {
            const s = mark.start == null ? "—" : formatClock(mark.start);
            const e = mark.end == null ? "—" : formatClock(mark.end);
            rangeHtml = ` <span class="mono vsplit-mark-picker-range">${s}→${e}</span>`;
          }
          btn.innerHTML = `${badge}<strong>#${String(ep.idx + 1).padStart(2, "0")} ${kindLabel}</strong> <span class="mono">${formatClock(ep.t)}</span>${rangeHtml}`;
          btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            hideVsplitMarkPicker();
            selectVsplitEditEndpoint(ep.idx, ep.kind);
          });
          vsplitMarkPicker.appendChild(btn);
        });
        const left = Math.max(8, Math.min(clientX - hitRect.left - 40, hitRect.width - 160));
        vsplitMarkPicker.style.left = `${left}px`;
        vsplitMarkPicker.style.top = `1.1rem`;
        vsplitMarkPicker.hidden = false;
        paintVsplitScrubMarks();
        const nearestBtn = vsplitMarkPicker.querySelector("button.is-nearest");
        if (nearestBtn?.scrollIntoView) {
          try {
            nearestBtn.scrollIntoView({ block: "nearest", behavior: "auto" });
          } catch (_) {
            /* ignore */
          }
        }
      }
  
      function resolveVsplitMarkTap(clientX) {
        if (!vsplitScrubMarks) return null;
        const rect = vsplitScrubMarks.getBoundingClientRect();
        if (!(rect.width > 0)) return null;
        const dur = vsplitVideoDuration();
        if (!(dur > 0)) return null;
        const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const t = pct * dur;
        const pxThresh = 32;
        const timeThresh = Math.max((pxThresh / rect.width) * dur, 0.12);
        const near = collectVsplitScrubEndpoints()
          .map((ep) => ({ ...ep, dist: Math.abs(ep.t - t) }))
          .filter((ep) => ep.dist <= timeThresh)
          .sort((a, b) => a.dist - b.dist || a.idx - b.idx);
        return { t, near, timeThresh };
      }
  
      let vsplitChipPaintSig = "";
      let vsplitChipScrollIdx = -2;
  
      function scrollVsplitActiveChipIntoView() {
        if (vsplitFsOpen || vsplitEditIdx < 0) return;
        if (vsplitEditIdx === vsplitChipScrollIdx) return;
        const active =
          vsplitMarkChips?.querySelector(".vsplit-mark-chip-wrap.is-active") ||
          vsplitMarkChips?.querySelector(".vsplit-mark-chip.is-active");
        if (active?.scrollIntoView) {
          try {
            active.scrollIntoView({ inline: "center", block: "nearest", behavior: "auto" });
          } catch (_) {
            /* ignore */
          }
        }
        vsplitChipScrollIdx = vsplitEditIdx;
      }
  
      function paintVsplitMarkChips() {
        if (!vsplitMarkChips) return;
        /* 全屏芯片已 CSS 隐藏，跳过重建减轻 DOM 抖动 */
        if (vsplitFsOpen) return;
        if (vsplitMode !== "manual" || !vsplitMarks.length) {
          vsplitMarkChips.hidden = true;
          vsplitMarkChips.innerHTML = "";
          vsplitChipPaintSig = "";
          vsplitChipScrollIdx = -2;
          return;
        }
        const sig = `${vsplitEditIdx}|${vsplitMarks
          .map((m) => `${m.start ?? "x"}:${m.end ?? "x"}`)
          .join(",")}`;
        if (sig === vsplitChipPaintSig && vsplitMarkChips.childElementCount === vsplitMarks.length) {
          $$("#vsplit-mark-chips .vsplit-mark-chip-wrap").forEach((wrap, idx) => {
            const on = vsplitEditIdx === idx;
            wrap.classList.toggle("is-active", on);
            wrap.querySelector(".vsplit-mark-chip")?.classList.toggle("is-active", on);
          });
          scrollVsplitActiveChipIntoView();
          if (vsplitEditIdx < 0) vsplitChipScrollIdx = -2;
          return;
        }
        vsplitChipPaintSig = sig;
        vsplitMarkChips.hidden = false;
        vsplitMarkChips.innerHTML = "";
        vsplitMarks.forEach((mark, idx) => {
          const wrap = document.createElement("div");
          wrap.className =
            "vsplit-mark-chip-wrap" +
            (vsplitEditIdx === idx ? " is-active" : "") +
            (isMarkComplete(mark) ? "" : " is-incomplete");
          const chip = document.createElement("button");
          chip.type = "button";
          chip.className =
            "vsplit-mark-chip" +
            (vsplitEditIdx === idx ? " is-active" : "") +
            (isMarkComplete(mark) ? "" : " is-incomplete");
          const s = mark.start == null ? "—" : formatClock(mark.start);
          const e = mark.end == null ? "—" : formatClock(mark.end);
          chip.textContent = formatVsplitMarkRangeLabel(mark, idx);
          chip.title = isMarkComplete(mark)
            ? `编辑第 ${idx + 1} 段 · ${s}→${e} · 共${formatVsplitSpanSec(mark.end - mark.start)}`
            : `编辑第 ${idx + 1} 段 · ${s}→${e}`;
          chip.addEventListener("click", () => {
            // 全屏打点时芯片只作跳转预览，禁止进入编辑（编辑栏在全屏被隐藏）
            if (vsplitFsOpen) {
              const jump = mark.start != null ? mark.start : mark.end;
              if (jump != null) seekVsplitPreview(jump, { keepPlaying: true });
              return;
            }
            hideVsplitMarkPicker();
            if (vsplitEditIdx === idx) {
              const next = vsplitEditFocus === "start" && mark.end != null ? "end" : "start";
              if (next === "start" && mark.start == null && mark.end != null) selectVsplitEditEndpoint(idx, "end");
              else selectVsplitEditEndpoint(idx, next);
              return;
            }
            enterVsplitEdit(idx);
          });
          const del = document.createElement("button");
          del.type = "button";
          del.className = "vsplit-mark-chip-del";
          del.setAttribute("aria-label", `删除第 ${idx + 1} 段`);
          del.title = `删除第 ${idx + 1} 段`;
          del.textContent = "×";
          del.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            if (vsplitFsOpen || vsplitBusy) return;
            const label = formatVsplitMarkRangeLabel(mark, idx);
            if (!window.confirm(`删除第 ${idx + 1} 段？\n${label}`)) return;
            if (vsplitEditIdx === idx) exitVsplitEdit();
            else if (vsplitEditIdx > idx) vsplitEditIdx -= 1;
            vsplitMarks.splice(idx, 1);
            invalidateVsplitOutputsFromMarks();
            paintVsplitMarks();
            paintVsplitNow();
            toast("已删除片段");
          });
          wrap.append(chip, del);
          vsplitMarkChips.appendChild(wrap);
        });
        scrollVsplitActiveChipIntoView();
        if (vsplitEditIdx < 0) vsplitChipScrollIdx = -2;
      }
  
      function onVsplitMarksTrackPointer(e) {
        if (vsplitMode !== "manual" || vsplitBusy || vsplitFsOpen) return;
        if (e.target.closest(".vsplit-scrub-mark")) return;
        if (e.target.closest(".vsplit-mark-picker")) return;
        const resolved = resolveVsplitMarkTap(e.clientX);
        if (!resolved || !resolved.near.length) {
          hideVsplitMarkPicker();
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        const actionable = resolved.near.filter((ep) => !ep.draft && ep.idx >= 0);
        if (!actionable.length) return;
        if (actionable.length === 1) {
          hideVsplitMarkPicker();
          selectVsplitEditEndpoint(actionable[0].idx, actionable[0].kind);
          return;
        }
        showVsplitMarkPicker(actionable, e.clientX, actionable[0]);
      }
  
      function paintVsplitScrubMarks() {
        if (!vsplitScrubMarks) return;
        if (vsplitFsOpen && vsplitScrubbing) return;
        if (vsplitMode !== "manual") {
          vsplitScrubMarks.innerHTML = "";
          paintVsplitMarkChips();
          return;
        }
        const dur = vsplitVideoDuration();
        if (!(dur > 0)) {
          vsplitScrubMarks.innerHTML = "";
          if (!vsplitFsOpen) paintVsplitMarkChips();
          return;
        }
        const frag = document.createDocumentFragment();
        const addDot = (t, kind, opts = {}) => {
          if (t == null || !Number.isFinite(t)) return;
          const { active = false, idx = -1, editable = false, picked = false } = opts;
          const dot = document.createElement("button");
          dot.type = "button";
          dot.className =
            `vsplit-scrub-mark is-${kind}` +
            (active ? " is-active" : "") +
            (picked ? " is-picked" : "") +
            (editable ? " is-editable" : "");
          const pct = Math.max(0, Math.min(100, (Number(t) / dur) * 100));
          dot.style.left = `${pct}%`;
          dot.dataset.t = String(t);
          if (idx >= 0) dot.dataset.idx = String(idx);
          if (active || picked) dot.style.zIndex = "5";
          const label = kind === "start" ? "起点" : "终点";
          const jumpToDot = (e) => {
            e.preventDefault();
            e.stopPropagation();
            seekVsplitPreview(t, { keepPlaying: true });
          };
          if (vsplitFsOpen) {
            dot.classList.add("is-jump");
            dot.setAttribute(
              "aria-label",
              idx >= 0 ? `跳到第 ${idx + 1} 段${label}` : `跳到${label}`
            );
            dot.addEventListener("pointerdown", (e) => {
              if (e.button != null && e.button !== 0) return;
              e.stopPropagation();
              seekVsplitPreview(t, { keepPlaying: true });
            });
            dot.addEventListener("click", jumpToDot);
          } else if (editable && idx >= 0) {
            dot.setAttribute(
              "aria-label",
              `${picked ? "当前点到 · " : ""}选中第 ${idx + 1} 段${label}`
            );
            dot.addEventListener("pointerdown", (e) => {
              e.stopPropagation();
            });
            dot.addEventListener("click", (e) => {
              e.preventDefault();
              e.stopPropagation();
              // 非编辑态：附近多个时弹出列表；编辑态只有本段点，直接切换端点
              if (vsplitEditIdx < 0) {
                const resolved = resolveVsplitMarkTap(e.clientX);
                const actionable = resolved
                  ? resolved.near.filter((ep) => !ep.draft && ep.idx >= 0)
                  : [];
                if (actionable.length > 1) {
                  showVsplitMarkPicker(actionable, e.clientX, { idx, kind });
                  return;
                }
              }
              selectVsplitEditEndpoint(idx, kind);
            });
          } else {
            dot.tabIndex = -1;
            dot.setAttribute("aria-hidden", "true");
          }
          frag.appendChild(dot);
        };
  
        /* 全屏圆点只跳进度，不进编辑 */
        const canEditDots = !vsplitBusy && !vsplitFsOpen;
        if (vsplitEditIdx >= 0) {
          const mark = vsplitMarks[vsplitEditIdx];
          if (mark) {
            addDot(mark.start, "start", {
              active: vsplitEditFocus === "start",
              idx: vsplitEditIdx,
              editable: canEditDots,
            });
            addDot(mark.end, "end", {
              active: vsplitEditFocus === "end",
              idx: vsplitEditIdx,
              editable: canEditDots,
            });
          }
        } else {
          if (vsplitDraftStart != null) addDot(vsplitDraftStart, "start", { editable: false });
          vsplitMarks.forEach((mark, idx) => {
            const pickStart =
              vsplitPickerHighlight &&
              vsplitPickerHighlight.idx === idx &&
              vsplitPickerHighlight.kind === "start";
            const pickEnd =
              vsplitPickerHighlight &&
              vsplitPickerHighlight.idx === idx &&
              vsplitPickerHighlight.kind === "end";
            addDot(mark.start, "start", {
              idx,
              editable: canEditDots,
              active: !!pickStart,
              picked: !!pickStart,
            });
            addDot(mark.end, "end", {
              idx,
              editable: canEditDots,
              active: !!pickEnd,
              picked: !!pickEnd,
            });
          });
        }
        vsplitScrubMarks.replaceChildren(frag);
        if (!vsplitFsOpen) paintVsplitMarkChips();
      }
  
      function selectVsplitEditEndpoint(idx, kind) {
        if (idx < 0 || idx >= vsplitMarks.length) return;
        const focus = kind === "end" ? "end" : "start";
        const mark = vsplitMarks[idx];
        if (!mark) return;
        if (focus === "start" && mark.start == null) return;
        if (focus === "end" && mark.end == null) return;
        const jump = focus === "end" ? mark.end : mark.start;
        /* 全屏禁止进编辑：会 paintVsplitMarks 重绘下方列表导致白屏/闪退 */
        if (vsplitFsOpen) {
          if (jump != null) seekVsplitPreview(jump, { keepPlaying: true });
          return;
        }
        hideVsplitMarkPicker();
        if (vsplitEditIdx !== idx) {
          vsplitDraftStart = null;
          vsplitEditIdx = idx;
          pauseVsplitPreview();
        }
        vsplitEditFocus = focus;
        if (jump != null) seekVsplitPreview(jump, { keepPlaying: true });
        setVsplitButtons();
        paintVsplitDraft();
        paintVsplitMarks();
        paintVsplitScrubMarks();
      }
  
      function sortVsplitMarks() {
        vsplitMarks.sort((a, b) => {
          const as = a.start == null ? Number.POSITIVE_INFINITY : a.start;
          const bs = b.start == null ? Number.POSITIVE_INFINITY : b.start;
          const ae = a.end == null ? Number.POSITIVE_INFINITY : a.end;
          const be = b.end == null ? Number.POSITIVE_INFINITY : b.end;
          return as - bs || ae - be;
        });
      }
  
      function normalizeMarkPair(start, end, opts = {}) {
        const dur = vsplitVideoDuration();
        let s = start == null ? null : roundVsplitTime(start);
        let e = end == null ? null : roundVsplitTime(end);
        if (s != null && e != null) {
          if (e < s) {
            const tmp = s;
            s = e;
            e = tmp;
          }
          if (dur > 0) {
            s = Math.min(s, Math.max(0, dur - VSPLIT_MIN_SPAN));
            e = Math.min(Math.max(e, s + VSPLIT_MIN_SPAN), dur);
          }
          if (e - s < VSPLIT_MIN_SPAN - 0.001) {
            if (!opts.silent) toast(`每段至少 ${VSPLIT_MIN_SPAN} 秒`);
            return null;
          }
        } else if (dur > 0) {
          if (s != null) s = Math.max(0, Math.min(s, dur));
          if (e != null) e = Math.max(0, Math.min(e, dur));
        }
        return { start: s, end: e };
      }
  
      function updateVsplitMark(idx, nextStart, nextEnd, opts = {}) {
        const next = normalizeMarkPair(nextStart, nextEnd, opts);
        if (!next) return false;
        vsplitMarks[idx] = next;
        if (!opts.skipSort && isMarkComplete(next)) sortVsplitMarks();
        invalidateVsplitOutputsFromMarks();
        paintVsplitMarks();
        paintVsplitNow();
        return true;
      }
  
      function applyScrubToEditFocus(opts = {}) {
        if (vsplitEditIdx < 0) return;
        const mark = vsplitMarks[vsplitEditIdx];
        if (!mark) return;
        const t = roundVsplitTime(vsplitScrubbing ? scrubValueToTime(vsplitScrub?.value) : vsplitVideoNow());
        pauseVsplitPreview();
        if (vsplitEditFocus === "start") {
          if (mark.end != null && t >= mark.end) {
            if (!opts.silent) toast("起点需早于终点");
            return;
          }
          updateVsplitMark(vsplitEditIdx, t, mark.end, { skipSort: true });
          if (!opts.silent) toast(`起点 ${formatClock(t)}`);
        } else {
          if (mark.start != null && t <= mark.start) {
            if (!opts.silent) toast("终点需晚于起点");
            return;
          }
          updateVsplitMark(vsplitEditIdx, mark.start, t, { skipSort: true });
          if (!opts.silent) toast(`终点 ${formatClock(t)}`);
        }
        setVsplitButtons();
      }
  
      function deleteEditEndpoint(which) {
        if (vsplitEditIdx < 0) return;
        const mark = vsplitMarks[vsplitEditIdx];
        if (!mark) return;
        if (which === "start") mark.start = null;
        else mark.end = null;
        if (mark.start == null && mark.end == null) {
          vsplitMarks.splice(vsplitEditIdx, 1);
          exitVsplitEdit();
          invalidateVsplitOutputsFromMarks();
          paintVsplitMarks();
          paintVsplitNow();
          toast("片段已删除");
          return;
        }
        vsplitEditFocus = which === "start" ? "end" : "start";
        invalidateVsplitOutputsFromMarks();
        paintVsplitMarks();
        paintVsplitNow();
        setVsplitButtons();
        toast(which === "start" ? "已删起点" : "已删终点");
      }
  
      function paintVsplitMarks() {
        paintVsplitDraft();
        paintVsplitScrubMarks();
        // 大块分段列表已去掉：横向芯片 + 进度条圆点即可编辑/切换/删除
        if (vsplitMarksEl) {
          vsplitMarksEl.innerHTML = "";
          vsplitMarksEl.hidden = true;
        }
        setVsplitButtons();
      }
  
      function currentMarkTime() {
        return roundVsplitTime(vsplitScrubbing ? scrubValueToTime(vsplitScrub?.value) : vsplitVideoNow());
      }
  
      function flushVsplitMarkPaint() {
        try {
          if (vsplitFsOpen) {
            ensureVsplitFsChromeVisible();
            // 全屏：文案立刻更新；圆点合并到下一帧，避开与闪层反馈抢主线程
            paintVsplitDraft();
            paintVsplitNow();
            setVsplitButtons();
            if (vsplitScrubbing) return;
            if (!vsplitFsScrubPaintRaf) {
              vsplitFsScrubPaintRaf = requestAnimationFrame(() => {
                vsplitFsScrubPaintRaf = 0;
                if (!vsplitFsOpen || vsplitScrubbing) return;
                paintVsplitScrubMarks();
              });
            }
            return;
          }
          paintVsplitMarks();
          paintVsplitNow();
          setVsplitButtons();
        } catch (err) {
          console.error(err);
          toast(err?.message || "标记刷新失败");
        }
      }
  
      let vsplitMarkTapCooldownUntil = 0;
      function tapVsplitMark() {
        try {
          if (!vsplitSourceFile || !vsplitVideo?.src) {
            toast("请先选择视频");
            return;
          }
          if (vsplitEditIdx >= 0) {
            toast("请先退出编辑再打点");
            return;
          }
          const nowMs = performance.now();
          const t = currentMarkTime();
          if (vsplitDraftStart == null) {
            vsplitDraftStart = t;
            vsplitMarkTapCooldownUntil = 0;
            flushVsplitMarkPaint();
            notifyVsplitMarkFeedback(`起点 ${formatClock(t)}`, "start");
            return;
          }
          // 同一段内防连点误触终点（新起点会清冷却）
          if (nowMs < vsplitMarkTapCooldownUntil) return;
          if (vsplitMarks.length >= VSPLIT_MAX_CLIPS) {
            toast(`最多 ${VSPLIT_MAX_CLIPS} 段`);
            return;
          }
          const start = vsplitDraftStart;
          const end = t;
          // 必须真实拉开最短时长；勿靠 normalize 自动拉长，否则播放中连点会狂造段
          if (Math.abs(end - start) < VSPLIT_MIN_SPAN - 0.001) {
            toast(`终点至少距起点 ${VSPLIT_MIN_SPAN} 秒，请继续播放或拖动`);
            return;
          }
          const next = normalizeMarkPair(start, end);
          if (!next || !isMarkComplete(next)) {
            toast(`每段至少 ${VSPLIT_MIN_SPAN} 秒`);
            return;
          }
          // 与最近一段几乎重合则忽略，防止同位置连点重复入库
          const last = vsplitMarks[vsplitMarks.length - 1];
          if (
            last &&
            Math.abs((last.start ?? -1) - next.start) < 0.08 &&
            Math.abs((last.end ?? -1) - next.end) < 0.08
          ) {
            toast("与上一段重复，已忽略");
            vsplitDraftStart = null;
            flushVsplitMarkPaint();
            return;
          }
          vsplitMarks.push(next);
          sortVsplitMarks();
          vsplitDraftStart = null;
          vsplitMarkTapCooldownUntil = nowMs + 300;
          invalidateVsplitOutputsFromMarks();
          flushVsplitMarkPaint();
          notifyVsplitMarkFeedback(`已添加 · ${(next.end - next.start).toFixed(1)}s`, "end");
        } catch (err) {
          console.error(err);
          try {
            toast(err?.message || "打点失败，请重试");
          } catch (_) {}
        }
      }
  
      let vsplitMarkTapArmed = false;
      function fireVsplitMarkTap(e) {
        if (vsplitMarkTap?.disabled && e?.currentTarget === vsplitMarkTap) return;
        if (vsplitFsMark?.disabled && e?.currentTarget === vsplitFsMark) return;
        if (e?.type === "pointerup") {
          if (e.button != null && e.button !== 0) return;
          // 仅触摸/手写笔走 pointerup；鼠标仍用 click，避免桌面双触发
          if (!e.pointerType || e.pointerType === "mouse") return;
          e.preventDefault();
          vsplitMarkTapArmed = true;
          window.setTimeout(() => {
            vsplitMarkTapArmed = false;
          }, 450);
          tapVsplitMark();
          return;
        }
        if (e?.type === "click" && vsplitMarkTapArmed) return;
        tapVsplitMark();
      }
  
      function seekToLatestVsplitMark() {
        let t = 0;
        if (vsplitDraftStart != null) t = vsplitDraftStart;
        else {
          const last = vsplitMarks[vsplitMarks.length - 1];
          if (last) t = last.end != null ? last.end : last.start != null ? last.start : 0;
        }
        seekVsplitPreview(t, { keepPlaying: true });
      }
  
      function undoVsplitDraft() {
        vsplitDraftStart = null;
        flushVsplitMarkPaint();
        seekToLatestVsplitMark();
        notifyVsplitMarkFeedback("已取消起点", "start");
      }
  
      function undoVsplitLastMark() {
        if (vsplitEditIdx >= 0) {
          toast("请先退出编辑");
          return;
        }
        // 1) 有未完成起点草稿 → 只取消起点
        if (vsplitDraftStart != null) {
          undoVsplitDraft();
          return;
        }
        if (!vsplitMarks.length) {
          toast("没有可取消的标记");
          return;
        }
        const lastIdx = vsplitMarks.length - 1;
        const last = vsplitMarks[lastIdx];
        // 2) 上一段已有终点 → 只取消终点，起点回到「待打终点」
        if (last && last.end != null && last.start != null) {
          const start = last.start;
          vsplitMarks.splice(lastIdx, 1);
          vsplitDraftStart = start;
          invalidateVsplitOutputsFromMarks();
          flushVsplitMarkPaint();
          seekToLatestVsplitMark();
          notifyVsplitMarkFeedback(`已取消终点 · 起点保留 ${formatClock(start)}`, "start");
          return;
        }
        // 3) 仅剩起点（或不完整段）→ 取消该起点
        vsplitMarks.splice(lastIdx, 1);
        invalidateVsplitOutputsFromMarks();
        flushVsplitMarkPaint();
        seekToLatestVsplitMark();
        notifyVsplitMarkFeedback("已取消起点", "start");
      }
  
      function ensureVsplitClipsFromMarks() {
        if (vsplitClips.length) return;
        if (vsplitMode !== "manual") return;
        const marks = completeVsplitMarks();
        if (!marks.length) return;
        vsplitClips = marks.map((m) => ({
          start: m.start,
          span: Math.max(VSPLIT_MIN_SPAN, m.end - m.start),
          videoBlob: null,
          videoUrl: "",
          copied: false,
          gifBlob: null,
          gifUrl: "",
          gifNote: "",
          error: "",
          jobStatus: "",
          jobProgress: 0,
          jobText: "",
        }));
        renderVsplitList();
      }
  
      function computeVsplitRanges(duration) {
        const d = Number(duration) || 0;
        if (!(d > 0)) throw new Error("无法读取视频时长");
        const ranges = [];
        if (vsplitMode === "manual") {
          const marks = completeVsplitMarks();
          if (!marks.length) throw new Error("请先标记至少一段完整的起点和终点");
          const skipped = vsplitMarks.length - marks.length;
          if (skipped > 0) toast(`已跳过 ${skipped} 段未完成`);
          marks.forEach((m) => {
            const start = Math.max(0, Math.min(m.start, d));
            const end = Math.max(start + VSPLIT_MIN_SPAN, Math.min(m.end, d));
            const span = end - start;
            if (span < VSPLIT_MIN_SPAN - 0.001) throw new Error("存在过短片段，请调整后再切");
            ranges.push({ start, span });
          });
          return ranges;
        }
        if (vsplitMode === "count") {
          const n = Math.min(VSPLIT_MAX_CLIPS, Math.max(2, Math.round(Number(vsplitCount?.value) || 2)));
          const part = d / n;
          if (part < VSPLIT_MIN_SPAN) throw new Error("每段太短，请减少份数");
          for (let i = 0; i < n; i++) {
            const start = i * part;
            const end = i === n - 1 ? d : (i + 1) * part;
            ranges.push({ start, span: Math.max(VSPLIT_MIN_SPAN, end - start) });
          }
        } else {
          const h = Math.max(0, Number(vsplitH?.value) || 0);
          const m = Math.max(0, Number(vsplitM?.value) || 0);
          const s = Math.max(0, Number(vsplitS?.value) || 0);
          const part = h * 3600 + m * 60 + s;
          if (part < VSPLIT_MIN_SPAN) throw new Error("每段时长至少 0.5 秒");
          let start = 0;
          let i = 0;
          while (start < d - 0.04 && i < VSPLIT_MAX_CLIPS) {
            const span = Math.min(part, d - start);
            if (span < VSPLIT_MIN_SPAN && i > 0) break;
            ranges.push({ start, span: Math.max(span, Math.min(VSPLIT_MIN_SPAN, d - start)) });
            start += part;
            i += 1;
          }
          if (!ranges.length) throw new Error("无法按此时长切分");
        }
        return ranges;
      }
  
      function renderVsplitList() {
        if (!vsplitList) return;
        vsplitList.innerHTML = "";
        vsplitClips.forEach((c, idx) => {
          const row = document.createElement("div");
          row.className = "gif-frame vsplit-clip";
          row.dataset.vsplitClip = String(idx);
          const top = document.createElement("div");
          top.className = "vsplit-clip-top";
          const title = document.createElement("strong");
          title.textContent = `#${String(idx + 1).padStart(2, "0")}  ${formatClock(c.start)}–${formatClock(c.start + c.span)} · 共${formatVsplitSpanSec(c.span)}`;
          const meta = document.createElement("span");
          meta.className = "hint tight";
          const bits = [];
          if (c.videoBlob) bits.push(`视频 ${formatKb(c.videoBlob.size)}`);
          if (c.gifBlob) bits.push(`GIF ${formatKb(c.gifBlob.size)}`);
          if (c.gifNote) bits.push(c.gifNote);
          if (c.error) bits.push(c.error);
          meta.textContent = bits.join(" · ");
          const actions = document.createElement("div");
          actions.className = "btn-row";
          if (c.videoUrl) {
            const a = document.createElement("a");
            a.className = "secondary-btn";
            a.href = c.videoUrl;
            a.download = `clip-${String(idx + 1).padStart(2, "0")}.mp4`;
            a.textContent = "下载视频";
            actions.appendChild(a);
          }
          if (c.gifUrl) {
            const a = document.createElement("a");
            a.className = "secondary-btn";
            a.href = c.gifUrl;
            a.download = `clip-${String(idx + 1).padStart(2, "0")}.gif`;
            a.textContent = "下载 GIF";
            actions.appendChild(a);
          }
          top.append(title, meta, actions);
          row.appendChild(top);
          const progressBox = buildClipProgressDom();
          row.appendChild(progressBox);
          syncClipProgressDom(progressBox, c);
          if (c.gifUrl) {
            const img = document.createElement("img");
            img.className = "vsplit-clip-gif";
            img.alt = `片段 ${idx + 1} GIF 预览`;
            img.src = c.gifUrl;
            row.appendChild(img);
          }
          vsplitList.appendChild(row);
        });
        setVsplitButtons();
      }
  
      async function readClipBytes(ffmpeg, name) {
        try {
          const data = await ffmpeg.readFile(name);
          const raw = data instanceof Uint8Array ? data : new Uint8Array(data);
          if (!raw.byteLength) return null;
          const bytes = new Uint8Array(raw.byteLength);
          bytes.set(raw);
          return bytes;
        } catch (_) {
          return null;
        }
      }
  
      async function cutOneClip(ffmpeg, inName, start, span, outName) {
        const ss = String(start);
        const tt = String(span);
        const attempts = [
          ["copy", ["-ss", ss, "-t", tt, "-i", inName, "-c", "copy", "-avoid_negative_ts", "make_zero", "-movflags", "+faststart", "-y", outName]],
          ["mpeg4", ["-ss", ss, "-t", tt, "-i", inName, "-an", "-c:v", "mpeg4", "-q:v", "7", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-y", outName]],
          ["x264", ["-ss", ss, "-t", tt, "-i", inName, "-an", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-y", outName]],
        ];
        for (const [kind, args] of attempts) {
          try {
            await ffmpeg.deleteFile(outName);
          } catch (_) {}
          try {
            const code = await ffmpeg.exec(args);
            const bytes = code === 0 ? await readClipBytes(ffmpeg, outName) : null;
            if (bytes && bytes.byteLength > 32) return { bytes, copied: kind === "copy" };
          } catch (_) {}
        }
        return { bytes: null, copied: false };
      }
  
      async function zipBlobs(entries, zipName) {
        if (typeof JSZip !== "function") throw new Error("JSZip 未加载");
        const zip = new JSZip();
        entries.forEach((e) => zip.file(e.name, e.blob));
        const blob = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(blob);
        return { blob, url, name: zipName };
      }
  
      function triggerLocalDownload(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => {
          try {
            URL.revokeObjectURL(url);
          } catch (_) {}
        }, 2000);
      }
  
      async function packDownloadVsplitVideos({ auto = false } = {}) {
        const videos = vsplitClips.map((c, i) => ({ c, i })).filter((x) => x.c.videoBlob);
        if (!videos.length) {
          if (!auto) toast("请先点「切成视频」");
          return false;
        }
        const packed = await zipBlobs(
          videos.map((x) => ({ name: `clip-${String(x.i + 1).padStart(2, "0")}.mp4`, blob: x.c.videoBlob })),
          "clips-video.zip"
        );
        revokeUrl(vsplitZipVideoUrl);
        vsplitZipVideoUrl = packed.url;
        triggerLocalDownload(packed.blob, packed.name);
        if (!auto) toast(`已打包 ${videos.length} 个视频`);
        setVsplitButtons();
        return true;
      }
  
      async function packDownloadVsplitGifs({ auto = false } = {}) {
        const gifs = vsplitClips.map((c, i) => ({ c, i })).filter((x) => x.c.gifBlob);
        if (!gifs.length) {
          if (!auto) toast("请先生成 GIF");
          return false;
        }
        const packed = await zipBlobs(
          gifs.map((x) => ({ name: `clip-${String(x.i + 1).padStart(2, "0")}.gif`, blob: x.c.gifBlob })),
          "clips-gif.zip"
        );
        revokeUrl(vsplitZipGifUrl);
        vsplitZipGifUrl = packed.url;
        triggerLocalDownload(packed.blob, packed.name);
        if (!auto) toast(`已打包 ${gifs.length} 个 GIF`);
        setVsplitButtons();
        return true;
      }
  
      function clearVsplit() {
        if (vsplitBusy) {
          abortVsplit = true;
          abortV2g = true;
          terminateFfmpegInstance({ revokeAssets: false });
          scheduleFfmpegPrewarm();
        }
        vsplitBusy = false;
        vsplitSourceFile = null;
        pauseVsplitPreview();
        exitVsplitFullscreen({ force: true });
        clearVsplitMarks();
        clearVsplitClips();
        if (vsplitObjectUrl) {
          URL.revokeObjectURL(vsplitObjectUrl);
          vsplitObjectUrl = "";
        }
        if (vsplitVideo) {
          vsplitVideo.pause?.();
          vsplitVideo.removeAttribute("src");
          vsplitVideo.load?.();
          vsplitVideo.hidden = true;
        }
        if (vsplitFile) vsplitFile.value = "";
        if (vsplitAbort) vsplitAbort.hidden = true;
        setVsplitProgress(false, 0, "");
        setError(vsplitError, "");
        if (vsplitMeta) vsplitMeta.textContent = VSPLIT_DEFAULT_META;
        paintVsplitNow();
        resetVsplitAbort();
        setVsplitButtons();
      }
  
      async function loadVsplitFile(file) {
        if (!file) return;
        clearVsplit();
        vsplitSourceFile = file;
        setError(vsplitError, "");
        if (vsplitMeta) vsplitMeta.textContent = formatLocalPickMeta(file, "正在读取时长…");
        toast("已选择，仅本机处理，不会上传");
        vsplitObjectUrl = URL.createObjectURL(file);
        attachLocalVideoPreview(vsplitVideo, vsplitObjectUrl);
        applyVsplitMute();
        await waitVideoMetadata(vsplitVideo);
        const duration = Number(vsplitVideo.duration) || 0;
        if (!(duration > 0) || !vsplitVideo.videoWidth) throw new Error("视频时长或尺寸无效");
        if (vsplitMeta) {
          vsplitMeta.textContent = formatLocalPickMeta(
            file,
            `${duration.toFixed(1)}s · ${vsplitVideo.videoWidth}×${vsplitVideo.videoHeight}`
          );
        }
        setVsplitButtons();
        paintVsplitNow();
        syncVsplitScrubFromVideo();
        if (vsplitMode === "manual") {
          vsplitVideo?.removeAttribute("controls");
          paintVsplitMarks();
        }
        toast("视频已就绪");
      }
  
      async function runVsplitCut() {
        if (!vsplitSourceFile || !vsplitVideo?.src || vsplitBusy) return;
        abortVsplit = false;
        vsplitBusy = true;
        setVsplitButtons();
        if (vsplitAbort) vsplitAbort.hidden = false;
        setError(vsplitError, "");
        clearVsplitClips();
        try {
          const duration = Number(vsplitVideo.duration) || 0;
          const ranges = computeVsplitRanges(duration);
          setVsplitProgress(true, 0.02, "本地读取视频（不上传）…", { sub: `共 ${ranges.length} 段`, busy: true });
          await prewarmFfmpegEngine().catch(() => {});
          const ffmpeg = await getFfmpegInstance();
          const ext = v2gSourceExt(vsplitSourceFile);
          const inName = `split-in.${ext}`;
          await ffmpeg.writeFile(
            inName,
            await fetchFileBytes(vsplitSourceFile, (ratio, text) => {
              setVsplitProgress(true, 0.02 + Math.min(0.1, (Number(ratio) || 0) * 0.1), text || "本地读取（不上传）…", {
                sub: `共 ${ranges.length} 段`,
                busy: true,
              });
            })
          );
          try {
            vsplitClips = ranges.map((r) => ({
              start: r.start,
              span: r.span,
              videoBlob: null,
              videoUrl: "",
              copied: false,
              gifBlob: null,
              gifUrl: "",
              gifNote: "",
              error: "",
              jobStatus: "pending",
              jobProgress: 0,
              jobText: "等待切分",
            }));
            renderVsplitList();
            for (let i = 0; i < ranges.length; i++) {
              if (abortVsplit) throw new Error("已取消");
              const r = ranges[i];
              const outName = `clip-${i}.mp4`;
              setVsplitClipJob(i, { status: "running", progress: 0.08, text: "切分视频…" });
              setVsplitProgress(true, (i + 0.05) / ranges.length, `切分视频 · ${i + 1}/${ranges.length}`, {
                sub: `${formatClock(r.start)}–${formatClock(r.start + r.span)} · 共${formatVsplitSpanSec(r.span)}`,
                busy: true,
              });
              const { bytes, copied } = await cutOneClip(ffmpeg, inName, r.start, r.span, outName);
              const blob = bytes ? new Blob([bytes], { type: "video/mp4" }) : null;
              const c = vsplitClips[i];
              c.videoBlob = blob;
              c.videoUrl = blob ? URL.createObjectURL(blob) : "";
              c.copied = copied;
              c.error = blob ? "" : "视频切片失败（仍可转 GIF）";
              setVsplitClipJob(i, {
                status: blob ? "done" : "error",
                progress: 1,
                text: blob ? "切分完成" : "切分失败",
              });
              try {
                await ffmpeg.deleteFile(outName);
              } catch (_) {}
              renderVsplitList();
            }
          } finally {
            try {
              await ffmpeg.deleteFile(inName);
            } catch (_) {}
          }
          const videos = vsplitClips.map((c, i) => ({ c, i })).filter((x) => x.c.videoBlob);
          const failN = vsplitClips.filter((c) => !c.videoBlob).length;
          setVsplitProgress(true, 1, `切分完成 · ${vsplitClips.length} 段`);
          setVsplitButtons();
          if (videos.length) {
            if (isAutoPackZipEnabled()) {
              await packDownloadVsplitVideos({ auto: true });
              toast(
                failN
                  ? `已切 ${vsplitClips.length} 段（${failN} 段失败）· 已打包下载视频`
                  : `已切成 ${vsplitClips.length} 段 · 已打包下载全部视频`
              );
            } else {
              toast(
                failN
                  ? `已切 ${vsplitClips.length} 段（${failN} 段失败）· 可点「打包下载全部视频」`
                  : `已切成 ${vsplitClips.length} 段 · 可点「打包下载全部视频」`
              );
            }
          } else {
            toast(failN ? `切分失败 ${failN} 段` : `已切成 ${vsplitClips.length} 段`);
          }
          clearVsplitClipJobs();
          renderVsplitList();
        } catch (err) {
          if (String(err && err.message) !== "已取消") setError(vsplitError, err.message || String(err));
          else toast("已取消切分");
          if (String(err && err.message) === "已取消") setVsplitProgress(false, 0, "");
          clearVsplitClipJobs();
          renderVsplitList();
        } finally {
          vsplitBusy = false;
          resetVsplitAbort();
          if (vsplitAbort) vsplitAbort.hidden = true;
          setVsplitButtons();
        }
      }
  
      async function runVsplitGifs(mode) {
        if (!vsplitSourceFile || vsplitBusy) return;
        if (vsplitMode === "manual") ensureVsplitClipsFromMarks();
        if (!vsplitClips.length) return;
        abortVsplit = false;
        vsplitBusy = true;
        setVsplitButtons();
        if (vsplitAbort) vsplitAbort.hidden = false;
        setError(vsplitError, "");
        revokeVsplitGifOutputs();
        const fps = Math.max(2, Number(vsplitFps?.value) || 60);
        const maxW = Math.max(64, Number(vsplitWidth?.value) || 1280);
        const quality = Math.min(30, Math.max(1, Number(vsplitQuality?.value) || 1));
        const srcW = vsplitVideo?.videoWidth || 0;
        const srcH = vsplitVideo?.videoHeight || 0;
        const isAborted = () => abortVsplit;
        try {
          await prewarmFfmpegEngine().catch(() => {});
          vsplitClips.forEach((c, idx) => {
            setVsplitClipJob(idx, { status: "pending", progress: 0, text: "等待转 GIF" });
          });
          renderVsplitList();
          for (let i = 0; i < vsplitClips.length; i++) {
            if (abortVsplit) throw new Error("已取消");
            const c = vsplitClips[i];
            if (c.gifUrl) {
              try {
                URL.revokeObjectURL(c.gifUrl);
              } catch (_) {}
            }
            c.gifBlob = null;
            c.gifUrl = "";
            c.gifNote = "";
            c.error = "";
            const label = mode === "blackbox" ? "黑盒 GIF" : "高清 GIF";
            setVsplitClipJob(i, { status: "running", progress: 0.02, text: `${label}…` });
            setVsplitProgress(true, i / vsplitClips.length, `${label} · ${i + 1}/${vsplitClips.length}`, {
              sub: `${formatClock(c.start)}–${formatClock(c.start + c.span)} · 共${formatVsplitSpanSec(c.span)}`,
              busy: true,
            });
            try {
              const encoded =
                mode === "blackbox"
                  ? await encodeBlackboxClip({
                      file: vsplitSourceFile,
                      startSec: c.start,
                      span: c.span,
                      srcW,
                      srcH,
                      isAborted,
                      onProgress: (local, text) => {
                        const p = Math.min(0.98, Number(local) || 0);
                        setVsplitClipJob(i, { status: "running", progress: p, text: text || `${label}…` });
                        setVsplitProgress(true, (i + p) / vsplitClips.length, `${label} · ${i + 1}/${vsplitClips.length}`, {
                          sub: text,
                          busy: true,
                        });
                      },
                    })
                  : await encodeBlackboxGif({
                      file: vsplitSourceFile,
                      fps,
                      maxW,
                      quality,
                      gifskiQuality: manualGifskiQuality(quality),
                      startSec: c.start,
                      span: c.span,
                      srcW,
                      srcH,
                      skipWatermark: true,
                      skipBright: true,
                      brightness: 0,
                      allowWide: true,
                      isAborted,
                      stageLabel: `#${i + 1}`,
                      onProgress: (local, text) => {
                        const p = Math.min(0.98, Number(local) || 0);
                        setVsplitClipJob(i, { status: "running", progress: p, text: text || `${label}…` });
                        setVsplitProgress(true, (i + p) / vsplitClips.length, `${label} · ${i + 1}/${vsplitClips.length}`, {
                          sub: text,
                          busy: true,
                        });
                      },
                    });
              if (!encoded?.blob) throw new Error("未产出 GIF");
              c.gifBlob = encoded.blob;
              c.gifUrl = URL.createObjectURL(encoded.blob);
              c.gifNote = encoded.framesCapped ? `已抽稀 ${encoded.frameCount} 帧` : `${encoded.outW}×${encoded.outH}`;
              setVsplitClipJob(i, { status: "done", progress: 1, text: "GIF 完成" });
            } catch (err) {
              if (String(err && err.message) === "已取消") throw err;
              c.error = err.message || String(err);
              setVsplitClipJob(i, { status: "error", progress: 1, text: "GIF 失败" });
            }
            renderVsplitList();
          }
          const gifs = vsplitClips.map((c, i) => ({ c, i })).filter((x) => x.c.gifBlob);
          const failN = vsplitClips.filter((c) => c.error).length;
          setVsplitProgress(true, 1, `GIF 完成 · 成功 ${gifs.length}/${vsplitClips.length}`);
          setVsplitButtons();
          if (gifs.length) {
            if (isAutoPackZipEnabled()) {
              await packDownloadVsplitGifs({ auto: true });
              toast(failN ? `完成，${failN} 段失败 · 已打包下载 GIF` : `已生成 ${gifs.length} 个 GIF · 已打包下载`);
            } else {
              toast(
                failN
                  ? `完成，${failN} 段失败 · 可点「打包下载全部 GIF」`
                  : `已生成 ${gifs.length} 个 GIF · 可点「打包下载全部 GIF」`
              );
            }
            if (typeof maybeAutoShareGallery === "function") {
              await maybeAutoShareGallery(
                gifs.map((x) => ({ name: `clip-${String(x.i + 1).padStart(2, "0")}.gif`, blob: x.c.gifBlob })),
                { zipName: "clips-gif.zip", title: "切片 GIF", zipBlobs }
              );
            }
          } else {
            toast(failN ? `完成，${failN} 段失败` : "未生成 GIF");
          }
          clearVsplitClipJobs();
          renderVsplitList();
        } catch (err) {
          if (String(err && err.message) !== "已取消") setError(vsplitError, err.message || String(err));
          else toast("已取消");
          clearVsplitClipJobs();
          renderVsplitList();
        } finally {
          vsplitBusy = false;
          resetVsplitAbort();
          if (vsplitAbort) vsplitAbort.hidden = true;
          setVsplitButtons();
        }
      }
  
      async function runVsplitMerge() {
        const blobs = vsplitClips.map((c) => c.gifBlob).filter(Boolean);
        if (blobs.length < 2 || vsplitBusy) return;
        vsplitBusy = true;
        setVsplitButtons();
        setError(vsplitError, "");
        try {
          const blob = await mergeGifBlobs(blobs, (ratio, text) =>
            setVsplitProgress(true, ratio, "合并 GIF", { sub: text, busy: ratio < 1 })
          );
          if (vsplitMergedUrl) URL.revokeObjectURL(vsplitMergedUrl);
          vsplitMergedUrl = URL.createObjectURL(blob);
          if (vsplitMergedPreview) {
            vsplitMergedPreview.src = vsplitMergedUrl;
            vsplitMergedPreview.hidden = false;
          }
          if (vsplitMergedDl) {
            vsplitMergedDl.href = vsplitMergedUrl;
            vsplitMergedDl.hidden = false;
          }
          setVsplitProgress(true, 1, `合并完成 · ${formatKb(blob.size)}`);
          toast("已合并为一条 GIF");
        } catch (err) {
          setError(vsplitError, err.message || String(err));
        } finally {
          vsplitBusy = false;
          resetVsplitAbort();
          setVsplitButtons();
        }
      }
  
      bindPanel("vsplit", () => {
        const root = document.getElementById("vsplit");
        try {
          revealAutoShareGalleryUi?.();
        } catch (_) {}
        vsplitFile = $("#vsplit-file", root);
        vsplitVideo = $("#vsplit-video", root);
        vsplitMeta = $("#vsplit-meta", root);
        vsplitError = $("#vsplit-error", root);
        vsplitCount = $("#vsplit-count", root);
        vsplitCountRow = $("#vsplit-count-row", root);
        vsplitDurationRow = $("#vsplit-duration-row", root);
        vsplitManualRow = $("#vsplit-manual-row", root);
        vsplitManualTransport = $("#vsplit-manual-transport", root);
        vsplitStage = $("#vsplit-stage", root);
        vsplitScrub = $("#vsplit-scrub", root);
        vsplitScrubHome = $("#vsplit-scrub-home", root);
        vsplitScrubBlock = $("#vsplit-scrub-block", root);
        vsplitFsScrubSlot = $("#vsplit-fs-scrub-slot");
        vsplitScrubHit = $("#vsplit-scrub-hit", root);
        vsplitScrubMarks = $("#vsplit-scrub-marks", root);
        vsplitMarkPicker = $("#vsplit-mark-picker", root);
        vsplitMarkChips = $("#vsplit-mark-chips", root);
        vsplitScrubHint = $("#vsplit-scrub-hint", root);
        vsplitPlay = $("#vsplit-play", root);
        vsplitMute = $("#vsplit-mute", root);
        vsplitFs = $("#vsplit-fs");
        vsplitFsHost = $("#vsplit-fs-host");
        vsplitFsOpenBtn = $("#vsplit-fs-open", root);
        vsplitFsClose = $("#vsplit-fs-close");
        vsplitFsPlay = $("#vsplit-fs-play");
        vsplitFsMute = $("#vsplit-fs-mute");
        vsplitFsMark = $("#vsplit-fs-mark");
        vsplitFsUndo = $("#vsplit-fs-undo");
        vsplitFsNow = $("#vsplit-fs-now");
        vsplitFsStatus = $("#vsplit-fs-status");
        vsplitFsNote = $("#vsplit-fs-note");
        vsplitFsFlash = $("#vsplit-fs-flash");
        vsplitPreviewWrap = $("#vsplit-preview-wrap", root);
        vsplitManualNow = $("#vsplit-manual-now", root);
        vsplitManualCount = $("#vsplit-manual-count", root);
        vsplitManualDraft = $("#vsplit-manual-draft", root);
        vsplitMarksEl = $("#vsplit-marks", root);
        vsplitMarkTap = $("#vsplit-mark-tap", root);
        vsplitMarkUndo = $("#vsplit-mark-undo", root);
        vsplitMarkClear = $("#vsplit-mark-clear", root);
        vsplitAddBtns = $("#vsplit-add-btns", root);
        vsplitEditBar = $("#vsplit-edit-bar", root);
        vsplitEditTitle = $("#vsplit-edit-title", root);
        vsplitEditApply = $("#vsplit-edit-apply", root);
        vsplitEditDelStart = $("#vsplit-edit-del-start", root);
        vsplitEditDelEnd = $("#vsplit-edit-del-end", root);
        vsplitEditDone = $("#vsplit-edit-done", root);
        vsplitQuickExport = $("#vsplit-quick-export", root);
        vsplitQuickCut = $("#vsplit-quick-cut", root);
        vsplitQuickHq = $("#vsplit-quick-hq", root);
        vsplitNudgeM1 = $("#vsplit-nudge-m1", root);
        vsplitNudgeM01 = $("#vsplit-nudge-m01", root);
        vsplitNudgeP01 = $("#vsplit-nudge-p01", root);
        vsplitNudgeP1 = $("#vsplit-nudge-p1", root);
        vsplitH = $("#vsplit-h", root);
        vsplitM = $("#vsplit-m", root);
        vsplitS = $("#vsplit-s", root);
        vsplitFps = $("#vsplit-fps", root);
        vsplitWidth = $("#vsplit-width", root);
        vsplitQuality = $("#vsplit-quality", root);
        vsplitCut = $("#vsplit-cut", root);
        vsplitGifHq = $("#vsplit-gif-hq", root);
        vsplitMerge = $("#vsplit-merge", root);
        vsplitAbort = $("#vsplit-abort", root);
        vsplitList = $("#vsplit-list", root);
        vsplitZipVideo = $("#vsplit-zip-video", root);
        vsplitZipGif = $("#vsplit-zip-gif", root);
        vsplitMergedDl = $("#vsplit-merged-dl", root);
        vsplitMergedPreview = $("#vsplit-merged-preview", root);
        vsplitProgress = $("#vsplit-progress", root);
        vsplitProgressFill = $("#vsplit-progress-fill", root);
        vsplitProgressText = $("#vsplit-progress-text", root);
        vsplitProgressSub = $("#vsplit-progress-sub", root);
        vsplitProgressPct = $("#vsplit-progress-pct", root);
  
      $("#vsplit-mode-n")?.addEventListener("click", () => {
        vsplitMode = "count";
        vsplitDraftStart = null;
        exitVsplitEdit();
        syncVsplitMode();
      });
      $("#vsplit-mode-t")?.addEventListener("click", () => {
        vsplitMode = "duration";
        vsplitDraftStart = null;
        exitVsplitEdit();
        syncVsplitMode();
      });
      $("#vsplit-mode-m")?.addEventListener("click", () => {
        vsplitMode = "manual";
        syncVsplitMode();
      });
      vsplitPlay?.addEventListener("click", () => {
        toggleVsplitPlay().catch(() => {});
      });
      vsplitMute?.addEventListener("click", () => toggleVsplitMute());
      vsplitFsOpenBtn?.addEventListener("click", () => enterVsplitFullscreen());
      vsplitFsClose?.addEventListener("click", () => exitVsplitFullscreen());
      vsplitFsPlay?.addEventListener("click", () => {
        toggleVsplitPlay().catch(() => {});
      });
      vsplitFsMute?.addEventListener("click", () => toggleVsplitMute());
      vsplitFsMark?.addEventListener("pointerup", (e) => fireVsplitMarkTap(e));
      vsplitFsMark?.addEventListener("click", (e) => fireVsplitMarkTap(e));
      vsplitFsUndo?.addEventListener("click", () => undoVsplitLastMark());
      document.addEventListener("keydown", (e) => {
        if (!vsplitFsOpen) return;
        if (e.key === "Escape") {
          e.preventDefault();
          exitVsplitFullscreen();
        }
      });
      vsplitMarkTap?.addEventListener("pointerup", (e) => fireVsplitMarkTap(e));
      vsplitMarkTap?.addEventListener("click", (e) => fireVsplitMarkTap(e));
      vsplitMarkUndo?.addEventListener("click", () => undoVsplitLastMark());
      vsplitMarkClear?.addEventListener("click", () => {
        clearVsplitMarks();
        invalidateVsplitOutputsFromMarks();
        paintVsplitNow();
        toast("已清空标记");
      });
      vsplitEditApply?.addEventListener("click", () => applyScrubToEditFocus());
      vsplitEditDelStart?.addEventListener("click", () => deleteEditEndpoint("start"));
      vsplitEditDelEnd?.addEventListener("click", () => deleteEditEndpoint("end"));
      vsplitEditDone?.addEventListener("click", () => {
        exitVsplitEdit();
        paintVsplitNow();
      });
      vsplitQuickCut?.addEventListener("click", () => runVsplitCut().catch((err) => setError(vsplitError, err.message || String(err))));
      vsplitQuickHq?.addEventListener("click", () => {
        runVsplitGifs("hq").catch((err) => setError(vsplitError, err.message || String(err)));
      });
      vsplitZipVideo?.addEventListener("click", () => {
        packDownloadVsplitVideos().catch((err) => setError(vsplitError, err.message || String(err)));
      });
      vsplitZipGif?.addEventListener("click", () => {
        packDownloadVsplitGifs().catch((err) => setError(vsplitError, err.message || String(err)));
      });
      $("#vsplit-edit-focus")?.addEventListener("click", (e) => {
        const btn = e.target?.closest?.("[data-edit-focus]");
        if (!btn || vsplitEditIdx < 0) return;
        e.preventDefault();
        const nextFocus = btn.dataset.editFocus === "end" ? "end" : "start";
        if (nextFocus === vsplitEditFocus) return;
        vsplitEditFocus = nextFocus;
        const mark = vsplitMarks[vsplitEditIdx];
        if (mark) {
          const jump = vsplitEditFocus === "end" ? mark.end : mark.start;
          // 切换端点时仅预览跳转，不自动写入；保留播放状态
          if (jump != null) seekVsplitPreview(jump, { keepPlaying: true });
        }
        setVsplitButtons();
        paintVsplitDraft();
        paintVsplitScrubMarks();
      });
      function bindVsplitNudgeRepeat(btn, delta) {
        if (!btn) return;
        const step = Math.abs(Number(delta) || 0);
        const isFine = step > 0 && step <= 0.15;
        const holdDelay = isFine ? 560 : 500;
        const repeatMs = isFine ? 220 : 130;
        let holdTimer = 0;
        let repeatTimer = 0;
        let holding = false;
        let lastStartAt = 0;
        let lastTickAt = 0;
        btn.style.webkitUserSelect = "none";
        btn.style.userSelect = "none";
        btn.style.webkitTouchCallout = "none";
        const stop = () => {
          if (holdTimer) window.clearTimeout(holdTimer);
          if (repeatTimer) window.clearInterval(repeatTimer);
          holdTimer = 0;
          repeatTimer = 0;
          holding = false;
        };
        const tick = () => {
          if (btn.disabled) {
            stop();
            return;
          }
          const now = Date.now();
          // iOS 上 touchstart + pointerdown 会各来一次，合并成一步
          if (lastTickAt && now - lastTickAt < 90) return;
          lastTickAt = now;
          nudgeVsplitPreview(delta);
        };
        const start = () => {
          if (holding || btn.disabled) return;
          holding = true;
          lastStartAt = Date.now();
          window.getSelection?.()?.removeAllRanges?.();
          tick();
          holdTimer = window.setTimeout(() => {
            holdTimer = 0;
            if (!holding || btn.disabled) return;
            repeatTimer = window.setInterval(tick, repeatMs);
          }, holdDelay);
        };
        const onPointerDown = (e) => {
          if (e.pointerType === "mouse" && e.button != null && e.button !== 0) return;
          e.preventDefault();
          start();
        };
        const onTouchStart = (e) => {
          // 拦 iOS 选字。pointer 可能随后才到，这里也允许起步；holding/合并计步保证只走一次
          e.preventDefault();
          start();
        };
        btn.addEventListener("pointerdown", onPointerDown, { passive: false });
        btn.addEventListener("pointerup", stop);
        btn.addEventListener("pointercancel", stop);
        btn.addEventListener("touchstart", onTouchStart, { passive: false });
        btn.addEventListener("touchend", stop);
        btn.addEventListener("touchcancel", stop);
        btn.addEventListener(
          "touchmove",
          (e) => {
            if (!holding) return;
            e.preventDefault();
          },
          { passive: false }
        );
        btn.addEventListener("contextmenu", (e) => e.preventDefault());
        btn.addEventListener("selectstart", (e) => e.preventDefault());
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          if (holding) return;
          if (lastStartAt && Date.now() - lastStartAt < 800) return;
          if (btn.disabled) return;
          tick();
        });
      }
  
      bindVsplitNudgeRepeat(vsplitNudgeM1, -1);
      bindVsplitNudgeRepeat(vsplitNudgeM01, -0.1);
      bindVsplitNudgeRepeat(vsplitNudgeP01, 0.1);
      bindVsplitNudgeRepeat(vsplitNudgeP1, 1);
      vsplitScrub?.addEventListener("pointerdown", (ev) => beginScrubGesture(ev));
      vsplitScrub?.addEventListener("pointermove", (ev) => moveScrubGesture(ev));
      vsplitScrub?.addEventListener("input", () => onVsplitScrubInput());
      vsplitScrub?.addEventListener("change", () => onVsplitScrubCommit());
      vsplitScrub?.addEventListener("pointerup", () => onVsplitScrubCommit());
      vsplitScrub?.addEventListener("pointercancel", () => onVsplitScrubCommit());
      vsplitScrub?.addEventListener("touchend", () => onVsplitScrubCommit(), { passive: true });
      vsplitScrubMarks?.addEventListener("pointerdown", (ev) => onVsplitMarksTrackPointer(ev));
      document.addEventListener("pointerdown", (ev) => {
        if (!vsplitMarkPicker || vsplitMarkPicker.hidden) return;
        if (ev.target.closest("#vsplit-mark-picker, #vsplit-scrub-marks, #vsplit-mark-chips")) return;
        hideVsplitMarkPicker();
      });
      const onVsplitTime = () => {
        if (vsplitMode !== "manual" || vsplitScrubbing) return;
        vsplitPlaying = Boolean(vsplitVideo && !vsplitVideo.paused);
        paintVsplitNow();
        if (vsplitPlay) vsplitPlay.textContent = vsplitPlaying ? "暂停" : "播放";
        if (vsplitFsPlay) vsplitFsPlay.textContent = vsplitPlaying ? "暂停" : "播放";
      };
      vsplitVideo?.addEventListener("timeupdate", onVsplitTime);
      vsplitVideo?.addEventListener("seeked", onVsplitTime);
      vsplitVideo?.addEventListener("play", () => {
        vsplitPlaying = true;
        if (vsplitPlay) vsplitPlay.textContent = "暂停";
        if (vsplitFsPlay) vsplitFsPlay.textContent = "暂停";
      });
      vsplitVideo?.addEventListener("pause", () => {
        vsplitPlaying = false;
        if (vsplitPlay) vsplitPlay.textContent = "播放";
        if (vsplitFsPlay) vsplitFsPlay.textContent = "播放";
      });
      vsplitVideo?.addEventListener("ended", () => {
        vsplitPlaying = false;
        if (vsplitPlay) vsplitPlay.textContent = "播放";
        if (vsplitFsPlay) vsplitFsPlay.textContent = "播放";
      });
      vsplitVideo?.addEventListener("loadedmetadata", () => {
        syncVsplitScrubFromVideo();
        paintVsplitNow();
      });
            vsplitFile?.addEventListener("change", (e) => {
        loadVsplitFile(e.target.files?.[0]).catch((err) => {
          clearVsplit();
          setError(vsplitError, err.message || String(err));
        });
      });
      $("#vsplit-clear")?.addEventListener("click", clearVsplit);
      window.DevToolsTemp?.registerCleanup(clearVsplit);
      window.DevToolsVsplit = {
        getMode: () => vsplitMode,
        getMarks: () => vsplitMarks.map((m) => ({ ...m })),
        getDraftStart: () => vsplitDraftStart,
        getEditIdx: () => vsplitEditIdx,
        isFullscreen: () => vsplitFsOpen,
        enterFullscreen: () => enterVsplitFullscreen(),
        exitFullscreen: () => exitVsplitFullscreen(),
        undoLast: () => undoVsplitLastMark(),
        enterEdit: (idx) => enterVsplitEdit(idx),
        setMarks: (marks) => {
          vsplitMarks = (Array.isArray(marks) ? marks : [])
            .map((m) => normalizeMarkPair(m.start, m.end, { silent: true }))
            .filter(Boolean)
            .filter(isMarkComplete)
            .slice(0, VSPLIT_MAX_CLIPS);
          sortVsplitMarks();
          vsplitDraftStart = null;
          exitVsplitEdit();
          invalidateVsplitOutputsFromMarks();
          paintVsplitMarks();
          paintVsplitNow();
        },
        computeRanges: (duration) => computeVsplitRanges(duration),
      };
      vsplitCut?.addEventListener("click", () => runVsplitCut().catch((err) => setError(vsplitError, err.message || String(err))));
      vsplitGifHq?.addEventListener("click", () => runVsplitGifs("hq").catch((err) => setError(vsplitError, err.message || String(err))));
      vsplitMerge?.addEventListener("click", () => runVsplitMerge().catch((err) => setError(vsplitError, err.message || String(err))));
      vsplitAbort?.addEventListener("click", () => {
        abortVsplit = true;
        abortV2g = true;
        terminateFfmpegInstance({ revokeAssets: false });
        scheduleFfmpegPrewarm();
      });
      syncVsplitMode();
      applyVsplitMute();
      setVsplitButtons();
      flushPendingFileInput(vsplitFile, (files) =>
        loadVsplitFile(files?.[0]).catch((err) => {
          clearVsplit();
          setError(vsplitError, err.message || String(err));
        })
      );
  
  
      });