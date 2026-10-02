
      // ---- One-click blackbox split planner (vbb) ----
      let vbbFile;
      let vbbVideo;
      let vbbMeta;
      let vbbError;
      let vbbAnalyze;
      let vbbRun;
      let vbbOneclick;
      let vbbAdvanced;
      let vbbSplitPanel;
      let vbbWorkflowHint;
      let vbbMerge;
      let vbbAbort;
      let vbbZip;
      let vbbMergedDl;
      let vbbMergedPreview;
      let vbbMergedBlock;
      let vbbMergedMeta;
      let vbbResultSummary;
      let vbbProgress;
      /** 一键黑盒：只显示每个 GIF 卡片的进度，隐藏总进度条 */
      let vbbSuppressGlobalProgress = false;
      let vbbProgressFill;
      let vbbProgressText;
      let vbbProgressSub;
      let vbbProgressPct;
      let vbbPlan;
      let vbbPlanSummary;
      let vbbPlanList;
      let vbbList;
      let vbbBatchList;
      let vbbResultBlock;
      let vbbCustomRow;
      let vbbTargetSpan;
      let vbbTargetRange;
      let vbbTargetLabel;
      let vbbEqualizeHint;
      let vbbEqualize;
      let vbbManualPanel;
      let vbbScrub;
      let vbbPlay;
      let vbbManualNow;
      let vbbManualCount;
      let vbbManualDraft;
      let vbbMarkTap;
      let vbbMarkUndo;
      let vbbMarkClear;
      let vbbNudgeM1;
      let vbbNudgeM01;
      let vbbNudgeP01;
      let vbbNudgeP1;
      let vbbScrubMarks;
      let vbbMarkChips;
      let vbbJumpTime;
      let vbbJumpGo;
      let vbbLongHint;
      const VBB_LONG_VIDEO_SEC = 180;
      const VBB_MANUAL_SEEK_DEBOUNCE_MS = 120;
      const VBB_SAMPLE_SPAN = 2.5;
      const VBB_SAFETY = 0.85;
      /** 清晰优先：按接近预算规划段长（略留余量，避免实测偶发超限） */
      const VBB_CLARITY_FILL = 0.97;
      const VBB_MAX_CLIPS = 50;
      const VBB_MIN_SPAN = 0.5;
      const VBB_CLARITY_MAX_SPAN = 20;
      const VBB_DURATION_MAX_SPAN = 30;
      /** Soft keep≈0.72 对应约 1–2 轮 --lossy 轻压 */
      const VBB_SOFT_COMPRESS_KEEP = 0.72;
      const VBB_DEFAULT_META = "";
      const VBB_WORKFLOW_HINTS = {
        single:
          "选视频 → 可选编辑 → 一键黑盒。",
        split: "长视频切片：先点「① 分析切分方案」查看段数与预估，调整满意后点「② 按方案生成 GIF」。",
        manual: "手动打点：拖到起点/终点点「打起点」「打终点」，标记多段后点「一键黑盒」。",
      };
      const VBB_BATCH_MANUAL_HINT =
        "多选 · 打点仅作用于当前预览视频；切换列表条目会保留各自的点。未打点的条目按整段/编辑范围转 GIF。";
  
      let vbbSourceFile = null;
      /** @type {{ file: File, duration: number, srcW: number, srcH: number, edit?: object, marks?: {start:number,end:number}[], draftStart?: number|null }[]} */
      let vbbBatchFiles = [];
      /** 批量模式当前预览/编辑的下标；单文件模式为 -1 */
      let vbbEditBatchIdx = -1;
      /** 单文件可选 trim/crop（整段模式） */
      let vbbSingleEdit = null;
      let vbbObjectUrl = "";
      let vbbBusy = false;
      let vbbFileEdit = null;
      let vbbFileEditLabel = null;
      let vbbEditOpen = null;
      let vbbEditReset = null;
      let vbbEditOpening = false;
      let vbbPreviewWrap = null;
      let vbbScrubSeekWanted = null;
      let vbbScrubSeekInflight = false;
      let vbbScrubSeekToken = 0;
      let vbbScrubRaf = 0;
      let abortVbb = false;
      let vbbMode = "duration";
      let vbbWorkflow = "single";
      /** 自定义段时长参考值（均分开启时仅用于算段数，不直接覆盖为实际每段时长） */
      let vbbSegmentTarget = 12;
      let vbbAnalysis = null;
      let vbbClips = [];
      let vbbZipUrl = "";
      let vbbMergedUrl = "";
      /** 仅预览当前选中片段，避免手机同时解码多个大 GIF 白屏 */
      let vbbPreviewIdx = -1;
      /** @type {{start:number,end:number}[]} */
      let vbbMarks = [];
      /** @type {number|null} */
      let vbbDraftStart = null;
      let vbbPlaying = false;
      let vbbScrubbing = false;
      const VBB_SCRUB_STEPS = 1000;
      let vbbSeekTimer = 0;
      let vbbPendingSeek = null;
  
      function parseVbbJumpTime(raw) {
        const text = String(raw || "").trim();
        if (!text) return null;
        if (/^\d+(\.\d+)?$/.test(text)) return Number(text);
        const m = text.match(/^(\d+):(\d+(?:\.\d+)?)$/);
        if (m) return Number(m[1]) * 60 + Number(m[2]);
        const h = text.match(/^(\d+):(\d+):(\d+(?:\.\d+)?)$/);
        if (h) return Number(h[1]) * 3600 + Number(h[2]) * 60 + Number(h[3]);
        return null;
      }
  
      function pauseVbbPreview() {
        try {
          vbbVideo?.pause?.();
        } catch (_) {}
        vbbPlaying = false;
      }
  
      function vbbScrubValueToTime(value) {
        const d = vbbVideoDuration();
        if (!(d > 0)) return 0;
        return (Number(value) / VBB_SCRUB_STEPS) * d;
      }
  
      function vbbTimeToScrubValue(sec) {
        const d = vbbVideoDuration();
        if (!(d > 0)) return 0;
        return Math.round((Math.max(0, Math.min(sec, d)) / d) * VBB_SCRUB_STEPS);
      }
  
      function syncVbbScrubFromVideo() {
        if (!vbbScrub || vbbScrubbing) return;
        const d = vbbVideoDuration();
        const has = Boolean(vbbSourceFile && d > 0);
        vbbScrub.disabled = !has || vbbBusy || !isVbbManualMode();
        if (!has) {
          vbbScrub.value = "0";
          return;
        }
        vbbScrub.max = String(VBB_SCRUB_STEPS);
        vbbScrub.value = String(vbbTimeToScrubValue(vbbMarkTime()));
      }
  
      function applyVbbSeek(sec, opts = {}) {
        if (!vbbVideo?.src) return;
        const d = vbbVideoDuration();
        const t = Math.max(0, Math.min(d || 0, Number(sec) || 0));
        if (!opts.keepPlaying) pauseVbbPreview();
        // 拖进度走 pumpVbbScrubSeek；其它跳转直接设 currentTime（勿密集 fastSeek）
        try {
          vbbVideo.currentTime = t;
        } catch (_) {}
        if (!opts.fromScrub) syncVbbScrubFromVideo();
        paintVbbNow();
        if (opts.fromEdit) syncVbbEditUi();
      }

      function pumpVbbScrubSeek() {
        if (!vbbVideo?.src || vbbScrubSeekInflight) return;
        if (vbbScrubSeekWanted == null) return;
        const d = vbbVideoDuration();
        const t = Math.max(0, Math.min(d || 0, vbbScrubSeekWanted));
        vbbScrubSeekWanted = null;
        if (Math.abs((Number(vbbVideo.currentTime) || 0) - t) < 0.04 && !vbbVideo.seeking) {
          paintVbbNow();
          return;
        }
        const token = vbbScrubSeekToken;
        vbbScrubSeekInflight = true;
        let settled = false;
        const finish = () => {
          if (settled || token !== vbbScrubSeekToken) return;
          settled = true;
          window.clearTimeout(watchdog);
          vbbVideo.removeEventListener("seeked", finish);
          vbbVideo.removeEventListener("error", finish);
          vbbScrubSeekInflight = false;
          paintVbbNow();
          if (vbbScrubSeekWanted != null) pumpVbbScrubSeek();
        };
        const watchdog = window.setTimeout(finish, 320);
        vbbVideo.addEventListener("seeked", finish);
        vbbVideo.addEventListener("error", finish);
        try {
          vbbVideo.currentTime = t;
        } catch (_) {
          finish();
          return;
        }
        if (!vbbVideo.seeking && Math.abs((Number(vbbVideo.currentTime) || 0) - t) < 0.04) {
          finish();
        }
      }

      function scheduleVbbScrubSeek(sec) {
        pauseVbbPreview();
        vbbScrubSeekWanted = sec;
        if (vbbScrubRaf) return;
        vbbScrubRaf = requestAnimationFrame(() => {
          vbbScrubRaf = 0;
          pumpVbbScrubSeek();
        });
      }

      function flushVbbScrubSeek() {
        if (vbbScrubRaf) {
          cancelAnimationFrame(vbbScrubRaf);
          vbbScrubRaf = 0;
        }
        vbbScrubSeekToken += 1;
        vbbScrubSeekInflight = false;
        if (vbbScrubSeekWanted != null) {
          const t = vbbScrubSeekWanted;
          vbbScrubSeekWanted = null;
          applyVbbSeek(t, { fromScrub: true });
        }
      }
  
      function scheduleVbbSeek(sec, opts = {}) {
        if (opts.fromScrub) {
          scheduleVbbScrubSeek(sec);
          vbbPendingSeek = null;
          return;
        }
        vbbPendingSeek = { sec, opts };
        clearTimeout(vbbSeekTimer);
        vbbSeekTimer = window.setTimeout(() => {
          vbbSeekTimer = 0;
          if (vbbPendingSeek) {
            applyVbbSeek(vbbPendingSeek.sec, vbbPendingSeek.opts);
            vbbPendingSeek = null;
          }
        }, opts.immediate ? 0 : VBB_MANUAL_SEEK_DEBOUNCE_MS);
      }
  
      function flushVbbSeek() {
        clearTimeout(vbbSeekTimer);
        vbbSeekTimer = 0;
        flushVbbScrubSeek();
        if (vbbPendingSeek) {
          applyVbbSeek(vbbPendingSeek.sec, { ...vbbPendingSeek.opts, immediate: true });
          vbbPendingSeek = null;
        }
      }
  
      function paintVbbNow() {
        const hasVideo = Boolean(vbbSourceFile && vbbVideo?.src);
        const d = vbbVideoDuration();
        const t = vbbScrubbing ? vbbScrubValueToTime(vbbScrub?.value) : vbbMarkTime();
        if (vbbManualNow) {
          vbbManualNow.textContent = hasVideo ? `${formatVbbClock(t)} / ${formatVbbClock(d)}` : "0:00 / 0:00";
        }
        const count = completeVbbMarks().length;
        if (vbbManualCount) {
          vbbManualCount.textContent = vbbMarks.length ? `${count}/${vbbMarks.length} 段` : "0 段";
        }
        if (vbbManualDraft) {
          if (vbbDraftStart != null) {
            vbbManualDraft.hidden = false;
            vbbManualDraft.textContent = `已设起点 ${formatVbbClock(vbbDraftStart)} · 拖到终点后点「打终点」`;
          } else {
            vbbManualDraft.hidden = true;
            vbbManualDraft.textContent = "";
          }
        }
        if (vbbMarkTap) vbbMarkTap.textContent = vbbDraftStart == null ? "打起点" : "打终点";
        if (vbbPlay) vbbPlay.textContent = vbbPlaying ? "暂停" : "播放";
        if (!vbbScrubbing) syncVbbScrubFromVideo();
      }
  
      function paintVbbScrubMarks() {
        if (!vbbScrubMarks) return;
        const d = vbbVideoDuration();
        vbbScrubMarks.innerHTML = "";
        if (!(d > 0) || !isVbbManualMode()) return;
        const addDot = (t, kind) => {
          const dot = document.createElement("button");
          dot.type = "button";
          dot.className = `vsplit-scrub-mark is-${kind} is-jump`;
          dot.style.left = `${(t / d) * 100}%`;
          dot.title = `${kind === "start" ? "起点" : "终点"} ${formatVbbClock(t)}`;
          dot.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            seekVbbPreview(t, { keepPlaying: true });
          });
          vbbScrubMarks.appendChild(dot);
        };
        if (vbbDraftStart != null) addDot(vbbDraftStart, "start");
        vbbMarks.forEach((mark) => {
          if (mark.start != null) addDot(mark.start, "start");
          if (mark.end != null) addDot(mark.end, "end");
        });
      }
  
      function paintVbbMarkChips() {
        if (!vbbMarkChips) return;
        const marks = completeVbbMarks();
        vbbMarkChips.innerHTML = "";
        vbbMarkChips.hidden = !marks.length;
        marks.forEach((mark, idx) => {
          const chip = document.createElement("button");
          chip.type = "button";
          chip.className = "vsplit-mark-chip";
          chip.textContent = `#${String(idx + 1).padStart(2, "0")} ${formatVbbClock(mark.start)}→${formatVbbClock(mark.end)}`;
          chip.addEventListener("click", () => seekVbbPreview(mark.start, { keepPlaying: true }));
          vbbMarkChips.appendChild(chip);
        });
      }
  
      function syncVbbLongHint() {
        const d = vbbVideoDuration();
        const show = isVbbManualMode() && d >= VBB_LONG_VIDEO_SEC;
        if (vbbLongHint) vbbLongHint.hidden = !show;
      }
  
      function paintVbbManualControls() {
        const manual = isVbbManualMode();
        if (vbbManualPanel) vbbManualPanel.hidden = !manual;
        if (vbbAdvanced) vbbAdvanced.hidden = manual || isVbbBatchMode();
        if (vbbVideo) {
          if (manual && vbbVideo.src) {
            vbbVideo.controls = false;
            vbbVideo.hidden = false;
            vbbVideo.preload = "metadata";
          } else if (vbbVideo.src) {
            vbbVideo.controls = true;
          }
        }
        syncVbbLongHint();
        const canMark = manual && Boolean(vbbSourceFile && vbbVideo?.src) && !vbbBusy;
        if (vbbScrub) vbbScrub.disabled = !canMark;
        if (vbbPlay) vbbPlay.disabled = !canMark;
        [vbbNudgeM1, vbbNudgeM01, vbbNudgeP01, vbbNudgeP1, vbbJumpGo].forEach((btn) => {
          if (btn) btn.disabled = !canMark;
        });
        if (vbbJumpTime) vbbJumpTime.disabled = !canMark;
        if (vbbMarkTap) vbbMarkTap.disabled = !canMark;
        if (vbbMarkUndo) {
          vbbMarkUndo.disabled = !canMark || (vbbDraftStart == null && !vbbMarks.length);
          vbbMarkUndo.textContent = vbbDraftStart != null ? "取消起点" : "取消上一段";
        }
        if (vbbMarkClear) vbbMarkClear.disabled = !canMark || (!vbbMarks.length && vbbDraftStart == null);
        if (vbbOneclick && isVbbManualMode() && !isVbbBatchMode()) {
          const count = completeVbbMarks().length;
          vbbOneclick.textContent = count > 0 ? `一键黑盒（${count} 段）` : "一键黑盒";
        }
        const batchHint = $("#vbb-manual-batch-hint");
        if (batchHint) batchHint.hidden = !(manual && isVbbBatchMode());
        paintVbbNow();
        paintVbbScrubMarks();
        paintVbbMarkChips();
      }
  
      function isVbbManualMode() {
        return vbbWorkflow === "manual";
      }
  
      function isVbbSplitMode() {
        return vbbWorkflow === "split" && !isVbbBatchMode();
      }

      function completeMarksList(marks) {
        return (Array.isArray(marks) ? marks : []).filter(
          (m) => m && m.start != null && m.end != null && m.end - m.start >= VBB_MIN_SPAN - 0.001
        );
      }

      /** 把当前全局打点写回多选当前条目 */
      function persistActiveVbbMarks() {
        if (!isVbbBatchMode()) return;
        if (vbbEditBatchIdx < 0 || vbbEditBatchIdx >= vbbBatchFiles.length) return;
        const item = vbbBatchFiles[vbbEditBatchIdx];
        if (!item) return;
        item.marks = vbbMarks.map((m) => ({ start: m.start, end: m.end }));
        item.draftStart = vbbDraftStart;
      }

      function loadItemVbbMarks(item) {
        const marks = Array.isArray(item?.marks) ? item.marks.map((m) => ({ start: m.start, end: m.end })) : [];
        vbbMarks = marks;
        vbbDraftStart = item?.draftStart != null && Number.isFinite(Number(item.draftStart)) ? Number(item.draftStart) : null;
      }

      function countVbbBatchManualSegments() {
        let n = 0;
        vbbBatchFiles.forEach((item, idx) => {
          const marks =
            idx === vbbEditBatchIdx ? completeVbbMarks() : completeMarksList(item?.marks);
          n += marks.length;
        });
        return n;
      }
  
      function vbbVideoDuration() {
        return Math.max(0, Number(vbbVideo?.duration) || 0);
      }
  
      function vbbMarkTime() {
        if (!vbbVideo?.src) return 0;
        return Math.max(0, Math.min(vbbVideoDuration(), Number(vbbVideo.currentTime) || 0));
      }
  
      function normalizeVbbMark(start, end) {
        const d = vbbVideoDuration();
        let s = Math.max(0, Math.min(Number(start) || 0, d));
        let e = Math.max(0, Math.min(Number(end) || 0, d));
        if (e < s) [s, e] = [e, s];
        if (e - s < VBB_MIN_SPAN - 0.001) return null;
        return { start: s, end: e };
      }
  
      function completeVbbMarks() {
        return vbbMarks.filter((m) => m && m.start != null && m.end != null && m.end - m.start >= VBB_MIN_SPAN - 0.001);
      }
  
      function computeVbbManualRanges() {
        const d = vbbVideoDuration();
        if (!(d > 0)) throw new Error("无法读取视频时长");
        const marks = completeVbbMarks();
        if (!marks.length) throw new Error("请先标记至少一段完整的起点和终点");
        return marks.map((m) => {
          const start = Math.max(0, Math.min(m.start, d));
          const end = Math.max(start + VBB_MIN_SPAN, Math.min(m.end, d));
          return { start, span: end - start };
        });
      }
  
      function seekVbbPreview(sec, opts = {}) {
        if (!vbbVideo?.src) return;
        if (opts.debounced) {
          scheduleVbbSeek(sec, opts);
          return;
        }
        flushVbbSeek();
        applyVbbSeek(sec, opts);
        if (!opts.silent) paintVbbManualControls();
      }
  
      function paintVbbManualUi() {
        paintVbbManualControls();
      }
  
      function clearVbbMarks() {
        vbbMarks = [];
        vbbDraftStart = null;
        persistActiveVbbMarks();
        paintVbbManualUi();
      }
  
      function tapVbbMark() {
        if (!isVbbManualMode() || !vbbSourceFile || !vbbVideo?.src) {
          toast("请先选择视频");
          return;
        }
        const t = vbbMarkTime();
        if (vbbDraftStart == null) {
          vbbDraftStart = t;
          persistActiveVbbMarks();
          paintVbbManualUi();
          toast(`起点 ${formatVbbClock(t)}`);
          return;
        }
        if (vbbMarks.length >= VBB_MAX_CLIPS) {
          toast(`最多 ${VBB_MAX_CLIPS} 段`);
          return;
        }
        const next = normalizeVbbMark(vbbDraftStart, t);
        if (!next) {
          toast(`终点至少距起点 ${VBB_MIN_SPAN} 秒`);
          return;
        }
        vbbMarks.push(next);
        vbbMarks.sort((a, b) => a.start - b.start);
        vbbDraftStart = null;
        persistActiveVbbMarks();
        paintVbbManualUi();
        toast(`已添加 · ${(next.end - next.start).toFixed(1)}s`);
      }
  
      function undoVbbMark() {
        if (vbbDraftStart != null) {
          vbbDraftStart = null;
          persistActiveVbbMarks();
          paintVbbManualUi();
          toast("已取消起点");
          return;
        }
        if (!vbbMarks.length) {
          toast("没有可取消的标记");
          return;
        }
        const last = vbbMarks[vbbMarks.length - 1];
        if (last?.end != null && last?.start != null) {
          vbbMarks.pop();
          vbbDraftStart = last.start;
          persistActiveVbbMarks();
          paintVbbManualUi();
          toast("已取消上一段终点");
          return;
        }
        vbbMarks.pop();
        persistActiveVbbMarks();
        paintVbbManualUi();
        toast("已删除上一段");
      }
  
      function nudgeVbbPreview(delta) {
        if (!vbbVideo?.src) return;
        seekVbbPreview(vbbMarkTime() + Number(delta || 0));
      }
  
      function isVbbBatchMode() {
        return vbbBatchFiles.length > 1;
      }

      function makeVbbEditState(duration, srcW, srcH) {
        const d = Math.max(0, Number(duration) || 0);
        const w = Math.max(1, Math.round(Number(srcW) || 1));
        const h = Math.max(1, Math.round(Number(srcH) || 1));
        return {
          trimStart: 0,
          trimEnd: d,
          cropOn: false,
          crop: { x: 0, y: 0, w, h },
        };
      }

      function ensureVbbItemEdit(item) {
        if (!item) return null;
        if (!item.edit) {
          item.edit = makeVbbEditState(item.duration, item.srcW, item.srcH);
        }
        return item.edit;
      }

      function vbbEditIsDirty(edit, duration, srcW, srcH) {
        if (!edit) return false;
        const d = Math.max(0, Number(duration) || 0);
        const fullTrim =
          Math.abs(Number(edit.trimStart) || 0) < 0.05 &&
          Math.abs((Number(edit.trimEnd) || 0) - d) < 0.05;
        if (!fullTrim) return true;
        if (!edit.cropOn) return false;
        const c = edit.crop || {};
        const w = Math.max(1, Math.round(Number(srcW) || 1));
        const h = Math.max(1, Math.round(Number(srcH) || 1));
        return !(
          Math.abs(Number(c.x) || 0) < 2 &&
          Math.abs(Number(c.y) || 0) < 2 &&
          Math.abs((Number(c.w) || 0) - w) < 2 &&
          Math.abs((Number(c.h) || 0) - h) < 2
        );
      }

      function vbbEditBadge(edit, duration, srcW, srcH) {
        if (!vbbEditIsDirty(edit, duration, srcW, srcH)) return "";
        const bits = [];
        const d = Math.max(0, Number(duration) || 0);
        const fullTrim =
          Math.abs(Number(edit.trimStart) || 0) < 0.05 &&
          Math.abs((Number(edit.trimEnd) || 0) - d) < 0.05;
        if (!fullTrim) {
          const span = Math.max(0, (Number(edit.trimEnd) || 0) - (Number(edit.trimStart) || 0));
          bits.push(`裁 ${span.toFixed(1)}s`);
        }
        if (edit.cropOn) bits.push("裁画面");
        return bits.join(" · ");
      }

      function getActiveVbbEditItem() {
        if (isVbbBatchMode()) {
          if (vbbEditBatchIdx < 0 || vbbEditBatchIdx >= vbbBatchFiles.length) return null;
          return vbbBatchFiles[vbbEditBatchIdx];
        }
        if (!vbbSourceFile || !vbbVideo?.src) return null;
        if (!vbbSingleEdit) {
          vbbSingleEdit = makeVbbEditState(
            Number(vbbVideo.duration) || 0,
            vbbVideo.videoWidth || 0,
            vbbVideo.videoHeight || 0
          );
        }
        return {
          file: vbbSourceFile,
          duration: Number(vbbVideo.duration) || 0,
          srcW: vbbVideo.videoWidth || 0,
          srcH: vbbVideo.videoHeight || 0,
          edit: vbbSingleEdit,
        };
      }

      function canShowVbbFileEdit() {
        if (vbbBusy) return false;
        if (isVbbManualMode() || isVbbSplitMode()) return false;
        if (isVbbBatchMode()) return vbbEditBatchIdx >= 0 && Boolean(vbbBatchFiles[vbbEditBatchIdx]);
        return Boolean(vbbSourceFile) && vbbWorkflow === "single";
      }

      function clampVbbEdit(edit, duration, srcW, srcH) {
        if (!edit) return;
        const d = Math.max(0, Number(duration) || 0);
        let start = Math.max(0, Math.min(d, Number(edit.trimStart) || 0));
        let end = Math.max(0, Math.min(d, Number(edit.trimEnd) || d));
        if (end - start < VBB_MIN_SPAN) {
          if (start + VBB_MIN_SPAN <= d) end = start + VBB_MIN_SPAN;
          else {
            end = d;
            start = Math.max(0, end - VBB_MIN_SPAN);
          }
        }
        edit.trimStart = start;
        edit.trimEnd = end;
        const w = Math.max(1, Math.round(Number(srcW) || 1));
        const h = Math.max(1, Math.round(Number(srcH) || 1));
        const c = edit.crop || { x: 0, y: 0, w, h };
        let cx = Math.max(0, Math.round(Number(c.x) || 0));
        let cy = Math.max(0, Math.round(Number(c.y) || 0));
        let cw = Math.max(2, Math.round(Number(c.w) || w));
        let ch = Math.max(2, Math.round(Number(c.h) || h));
        if (cx + cw > w) cw = Math.max(2, w - cx);
        if (cy + ch > h) ch = Math.max(2, h - cy);
        if (cw > w) {
          cw = w;
          cx = 0;
        }
        if (ch > h) {
          ch = h;
          cy = 0;
        }
        edit.crop = { x: cx, y: cy, w: cw, h: ch };
      }

      function resolveVbbEncodeEdits(item, file, duration, srcW, srcH) {
        const edit = item?.edit || (item === null ? vbbSingleEdit : null);
        let startSec = 0;
        let span = Math.max(0, Number(duration) || 0);
        if (edit) {
          clampVbbEdit(edit, duration, srcW, srcH);
          startSec = Number(edit.trimStart) || 0;
          span = Math.max(VBB_MIN_SPAN, (Number(edit.trimEnd) || span) - startSec);
          if (startSec + span > duration) span = Math.max(VBB_MIN_SPAN, duration - startSec);
        }
        return { startSec, span, edit };
      }

      async function resolveVbbEncodeCrop(file, edit, srcW, srcH) {
        if (edit?.cropOn && edit.crop) {
          return normalizeV2gCrop(edit.crop, srcW, srcH);
        }
        return vbbResolveCrop(file);
      }

      function paintVbbEditStatusLabel(el, { badge, name, batch }) {
        if (!el) return;
        el.replaceChildren();
        if (badge) {
          const tag = document.createElement("span");
          tag.className = "vbb-edit-badge";
          tag.textContent = `已编辑 · ${badge}`;
          if (batch) {
            el.append(`「${name || "视频"}」 `, tag);
          } else {
            el.append(tag, " · 可选裁时长 / 裁画面");
          }
        } else if (batch) {
          el.textContent = `「${name || "视频"}」 · 未编辑`;
        } else {
          el.textContent = "未编辑 · 可选裁时长 / 裁画面";
        }
      }

      function syncVbbEditUi() {
        const show = canShowVbbFileEdit();
        if (vbbFileEdit) {
          vbbFileEdit.hidden = !show;
          if (!show) vbbFileEdit.classList.remove("is-edited");
        }
        if (!show) return;
        const item = getActiveVbbEditItem();
        if (!item) return;
        const edit = ensureVbbItemEdit(item);
        clampVbbEdit(edit, item.duration, item.srcW, item.srcH);
        const badge = vbbEditBadge(edit, item.duration, item.srcW, item.srcH);
        const name = item.file?.name || "视频";
        const dirty = Boolean(badge);
        if (vbbFileEdit) vbbFileEdit.classList.toggle("is-edited", dirty);
        paintVbbEditStatusLabel(vbbFileEditLabel, {
          badge,
          name,
          batch: isVbbBatchMode(),
        });
        const enabled = !vbbBusy && !vbbEditOpening;
        if (vbbEditOpen) vbbEditOpen.disabled = !enabled;
        if (vbbEditReset) vbbEditReset.disabled = !enabled || !vbbEditIsDirty(edit, item.duration, item.srcW, item.srcH);
      }

      async function ensureVbbVtrimEditor() {
        if (window.DevToolsVtrimEditor?.open) return window.DevToolsVtrimEditor;
        const load = window.DevToolsLazy?.loadScript;
        if (typeof load !== "function") throw new Error("脚本加载器不可用");
        await load("./lib/vtrim-editor.js");
        if (!window.DevToolsVtrimEditor?.open) throw new Error("视频编辑器加载失败");
        return window.DevToolsVtrimEditor;
      }

      async function openVbbEditEditor(targetItem) {
        if (vbbBusy || vbbEditOpening) return;
        const item = targetItem || getActiveVbbEditItem();
        if (!item?.file) {
          toast("请先选择视频");
          return;
        }
        ensureVbbItemEdit(item);
        clampVbbEdit(item.edit, item.duration, item.srcW, item.srcH);
        const draft = {
          trimStart: item.edit.trimStart,
          trimEnd: item.edit.trimEnd,
          cropOn: Boolean(item.edit.cropOn),
          crop: item.edit.crop ? { ...item.edit.crop } : { x: 0, y: 0, w: item.srcW, h: item.srcH },
        };
        vbbEditOpening = true;
        syncVbbEditUi();
        renderVbbBatchList({ keepSelection: true });
        try {
          const editor = await ensureVbbVtrimEditor();
          pauseVbbPreview();
          const next = await editor.open({
            file: item.file,
            title: item.file.name || "视频",
            initial: draft,
          });
          if (next) {
            item.edit = {
              trimStart: Number(next.trimStart) || 0,
              trimEnd: Number(next.trimEnd) || item.duration,
              cropOn: Boolean(next.cropOn),
              crop: next.crop
                ? { ...next.crop }
                : { x: 0, y: 0, w: item.srcW, h: item.srcH },
            };
            clampVbbEdit(item.edit, item.duration, item.srcW, item.srcH);
            if (!isVbbBatchMode()) vbbSingleEdit = item.edit;
            applyVbbSeek(Number(item.edit.trimStart) || 0, { keepPlaying: false });
            syncVbbEditPreview();
            toast(
              vbbEditIsDirty(item.edit, item.duration, item.srcW, item.srcH)
                ? "已保存编辑 · 预览为裁切后片段"
                : "已恢复为原片范围"
            );
          } else {
            toast("已关闭，未保存本次改动");
          }
        } catch (err) {
          setError(vbbError, err?.message || String(err));
        } finally {
          vbbEditOpening = false;
          syncVbbEditUi();
          renderVbbBatchList({ keepSelection: true });
          syncVbbBatchMeta();
        }
      }

      function resetActiveVbbEdit() {
        const item = getActiveVbbEditItem();
        if (!item) return;
        item.edit = makeVbbEditState(item.duration, item.srcW, item.srcH);
        if (!isVbbBatchMode()) vbbSingleEdit = item.edit;
        syncVbbEditUi();
        syncVbbEditPreview();
        applyVbbSeek(0, { keepPlaying: false });
        renderVbbBatchList({ keepSelection: true });
        syncVbbBatchMeta();
        toast("已重置该视频的编辑");
      }

      /** 主预览跟随当前编辑：裁时长循环 + 裁画面 clip-path */
      function syncVbbEditPreview() {
        const item = getActiveVbbEditItem();
        const video = vbbVideo;
        const wrap = vbbPreviewWrap;
        if (!video) return;
        if (!item?.edit || !vbbEditIsDirty(item.edit, item.duration, item.srcW, item.srcH)) {
          video.style.clipPath = "";
          video.style.webkitClipPath = "";
          wrap?.classList.remove("is-edit-preview");
          return;
        }
        wrap?.classList.add("is-edit-preview");
        const edit = item.edit;
        if (edit.cropOn && edit.crop && item.srcW > 0 && item.srcH > 0) {
          const c = edit.crop;
          const top = (Math.max(0, c.y) / item.srcH) * 100;
          const left = (Math.max(0, c.x) / item.srcW) * 100;
          const bottom = Math.max(0, 100 - ((c.y + c.h) / item.srcH) * 100);
          const right = Math.max(0, 100 - ((c.x + c.w) / item.srcW) * 100);
          const inset = `inset(${top}% ${right}% ${bottom}% ${left}%)`;
          video.style.clipPath = inset;
          video.style.webkitClipPath = inset;
        } else {
          video.style.clipPath = "";
          video.style.webkitClipPath = "";
        }
      }

      function enforceVbbEditPlaybackWindow() {
        if (isVbbManualMode() || vbbBusy || !vbbVideo?.src) return;
        const item = getActiveVbbEditItem();
        if (!item?.edit || !vbbEditIsDirty(item.edit, item.duration, item.srcW, item.srcH)) return;
        const start = Math.max(0, Number(item.edit.trimStart) || 0);
        const end = Math.max(start + VBB_MIN_SPAN, Number(item.edit.trimEnd) || item.duration);
        const t = Number(vbbVideo.currentTime) || 0;
        if (t < start - 0.08) {
          applyVbbSeek(start, { keepPlaying: !vbbVideo.paused });
          return;
        }
        if (t >= end - 0.05) {
          if (!vbbVideo.paused) applyVbbSeek(start, { keepPlaying: true });
          else applyVbbSeek(Math.max(start, end - 0.05), { keepPlaying: false });
        }
      }

      async function selectVbbBatchItem(idx, { force = false } = {}) {
        if (!isVbbBatchMode()) return;
        if (!force && idx === vbbEditBatchIdx && vbbVideo?.src) {
          syncVbbEditUi();
          paintVbbManualUi();
          return;
        }
        const item = vbbBatchFiles[idx];
        if (!item) return;
        persistActiveVbbMarks();
        pauseVbbPreview();
        if (vbbObjectUrl) {
          try {
            URL.revokeObjectURL(vbbObjectUrl);
          } catch (_) {}
          vbbObjectUrl = "";
        }
        vbbEditBatchIdx = idx;
        vbbSourceFile = item.file;
        ensureVbbItemEdit(item);
        loadItemVbbMarks(item);
        vbbObjectUrl = URL.createObjectURL(item.file);
        attachLocalVideoPreview(vbbVideo, vbbObjectUrl);
        await waitVideoMetadata(vbbVideo);
        if (vbbVideo) {
          vbbVideo.hidden = false;
          vbbVideo.controls = !isVbbManualMode();
        }
        const edit = item.edit;
        clampVbbEdit(edit, item.duration, item.srcW, item.srcH);
        const seekTo = isVbbManualMode()
          ? vbbDraftStart != null
            ? vbbDraftStart
            : completeVbbMarks()[0]?.start ?? 0
          : edit.trimStart;
        applyVbbSeek(seekTo, { keepPlaying: false });
        renderVbbBatchList({ keepSelection: true });
        syncVbbEditUi();
        syncVbbEditPreview();
        paintVbbManualUi();
        setVbbButtons();
      }

      /** 从多选列表移除一条：释放预览 URL、清 edit/marks；余 1 条时退回单文件模式 */
      async function removeVbbBatchItem(idx) {
        if (vbbBusy || vbbEditOpening) return;
        if (idx < 0 || idx >= vbbBatchFiles.length) return;
        const removing = vbbBatchFiles[idx];
        if (!removing) return;
        const wasActive = idx === vbbEditBatchIdx;
        if (!wasActive) persistActiveVbbMarks();
        else {
          pauseVbbPreview();
          if (vbbObjectUrl) {
            try {
              URL.revokeObjectURL(vbbObjectUrl);
            } catch (_) {}
            vbbObjectUrl = "";
          }
          vbbMarks = [];
          vbbDraftStart = null;
        }
        removing.edit = null;
        removing.marks = null;
        removing.draftStart = null;
        vbbBatchFiles.splice(idx, 1);

        if (!vbbBatchFiles.length) {
          clearVbb();
          toast("已移除该视频");
          return;
        }

        if (vbbBatchFiles.length === 1) {
          const only = vbbBatchFiles[0];
          const savedEdit = only.edit ? { ...only.edit, crop: only.edit.crop ? { ...only.edit.crop } : null } : null;
          const savedMarks = Array.isArray(only.marks) ? only.marks.map((m) => ({ start: m.start, end: m.end })) : [];
          const savedDraft = only.draftStart != null ? Number(only.draftStart) : null;
          const keepWorkflow = vbbWorkflow === "manual" ? "manual" : "single";
          const file = only.file;
          await loadVbbFile(file);
          vbbWorkflow = keepWorkflow;
          if (savedEdit) {
            vbbSingleEdit = {
              trimStart: Number(savedEdit.trimStart) || 0,
              trimEnd: Number(savedEdit.trimEnd) || Number(vbbVideo?.duration) || 0,
              cropOn: Boolean(savedEdit.cropOn),
              crop: savedEdit.crop
                ? { ...savedEdit.crop }
                : makeVbbEditState(Number(vbbVideo?.duration) || 0, vbbVideo?.videoWidth || 0, vbbVideo?.videoHeight || 0).crop,
            };
          }
          vbbMarks = savedMarks;
          vbbDraftStart = Number.isFinite(savedDraft) ? savedDraft : null;
          syncVbbWorkflowUi();
          syncVbbEditUi();
          setVbbButtons();
          toast("已移除 · 余 1 个视频");
          return;
        }

        let nextIdx = vbbEditBatchIdx;
        if (wasActive) nextIdx = Math.min(idx, vbbBatchFiles.length - 1);
        else if (idx < vbbEditBatchIdx) nextIdx = vbbEditBatchIdx - 1;
        vbbEditBatchIdx = -1;
        await selectVbbBatchItem(Math.max(0, nextIdx), { force: true });
        syncVbbBatchMeta();
        syncVbbWorkflowUi();
        toast("已移除该视频");
      }
  
      function vbbGifBaseName(file) {
        const name = String(file?.name || "clip");
        return name.replace(/\.[^.]+$/i, "").replace(/[^\w\u4e00-\u9fff.-]+/g, "_") || "clip";
      }
  
      function vbbGifDownloadName(clip, idx) {
        if (clip?.sourceName) return `${clip.sourceName}.gif`;
        return `bb-${String((idx ?? 0) + 1).padStart(2, "0")}.gif`;
      }

      /** 每个 GIF 编码完成后立刻下载（默认关；与打包 zip / 合并不冲突） */
      const VBB_AUTO_DL_EACH_KEY = "devtools-vbb-auto-dl-each-v1";

      function isVbbAutoDlEachEnabled() {
        try {
          return localStorage.getItem(VBB_AUTO_DL_EACH_KEY) === "1";
        } catch (_) {
          return false;
        }
      }

      function setVbbAutoDlEachEnabled(on) {
        try {
          localStorage.setItem(VBB_AUTO_DL_EACH_KEY, on ? "1" : "0");
        } catch (_) {}
      }

      function maybeAutoDownloadVbbGif(clip, idx) {
        if (!isVbbAutoDlEachEnabled() || !clip?.gifBlob) return false;
        if (clip.error || clip.gifBlob.size > V2G_BLACKBOX_MAX_BYTES) return false;
        try {
          triggerLocalDownload(clip.gifBlob, vbbGifDownloadName(clip, idx));
          return true;
        } catch (_) {
          return false;
        }
      }

      /** 当前「压缩时长」对应的加速倍率（相对该段 span） */
      function vbbSpeedFactorForSpan(span) {
        const lim = vbbSpeedLimitSec();
        const s = Number(span) || 0;
        if (lim > 0 && s > lim) return Math.max(1, Math.min(16, s / lim));
        return 1;
      }
  
      function isLikelyVideoFile(file) {
        if (!file) return false;
        if (String(file.type || "").startsWith("video/")) return true;
        return /\.(mp4|webm|mov|m4v)$/i.test(String(file.name || ""));
      }
  
      function isLikelyMobileBrowser() {
        return (
          window.matchMedia("(max-width: 900px)").matches ||
          /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || "")
        );
      }
  
      function shouldPinVbbScroll() {
        return isLikelyMobileBrowser();
      }
  
      let vbbScrollGuardReady = false;
      let vbbUserScrollUntil = 0;
      let vbbProgrammaticScroll = false;
  
      function markVbbUserScroll() {
        if (vbbProgrammaticScroll) return;
        vbbUserScrollUntil = Date.now() + 480;
      }
  
      function isVbbUserScrolling() {
        return Date.now() < vbbUserScrollUntil;
      }
  
      function ensureVbbScrollGuard() {
        if (vbbScrollGuardReady) return;
        vbbScrollGuardReady = true;
        const opts = { passive: true, capture: true };
        window.addEventListener("touchstart", markVbbUserScroll, opts);
        window.addEventListener("touchmove", markVbbUserScroll, opts);
        window.addEventListener("wheel", markVbbUserScroll, opts);
        const shell = document.querySelector(".shell");
        if (shell) {
          shell.addEventListener("touchstart", markVbbUserScroll, opts);
          shell.addEventListener("touchmove", markVbbUserScroll, opts);
          shell.addEventListener("wheel", markVbbUserScroll, opts);
          shell.addEventListener("scroll", markVbbUserScroll, opts);
        }
      }
  
      function vbbScrollRoot() {
        const shell = document.querySelector(".shell");
        if (window.matchMedia("(min-width: 901px)").matches && shell) return shell;
        return document.scrollingElement || document.documentElement;
      }
  
      function readVbbScrollTop(root) {
        if (!root || root === document.documentElement || root === document.scrollingElement) {
          return window.scrollY || 0;
        }
        return root.scrollTop || 0;
      }
  
      function writeVbbScrollTop(root, top) {
        const y = Math.max(0, Number(top) || 0);
        if (!root || root === document.documentElement || root === document.scrollingElement) {
          window.scrollTo({ top: y, left: 0, behavior: "auto" });
          return;
        }
        root.scrollTop = y;
      }
  
      function restoreVbbScrollLater(top) {
        const root = vbbScrollRoot();
        const apply = () => {
          vbbProgrammaticScroll = true;
          writeVbbScrollTop(root, top);
          requestAnimationFrame(() => {
            vbbProgrammaticScroll = false;
          });
        };
        requestAnimationFrame(() => {
          apply();
          requestAnimationFrame(apply);
        });
      }
  
      function pinVbbViewport(mutator) {
        if (!shouldPinVbbScroll() || isVbbUserScrolling()) return mutator();
        const top = readVbbScrollTop(vbbScrollRoot());
        const out = mutator();
        restoreVbbScrollLater(top);
        return out;
      }
  
      function runVbbLayoutUpdate(mutator, { pin = false } = {}) {
        if (pin && shouldPinVbbScroll() && !isVbbUserScrolling()) return pinVbbViewport(mutator);
        return mutator();
      }
  
      function blurVbbActionButton(el) {
        if (!shouldPinVbbScroll() || !el) return;
        requestAnimationFrame(() => {
          try {
            el.blur();
          } catch (_) {}
        });
      }
  
      async function probeVbbVideoFile(file, videoEl = vbbVideo) {
        if (!file || !videoEl) throw new Error("无法读取视频");
        const url = URL.createObjectURL(file);
        try {
          attachLocalVideoPreview(videoEl, url);
          await waitVideoMetadata(videoEl);
          const duration = Number(videoEl.duration) || 0;
          const srcW = videoEl.videoWidth || 0;
          const srcH = videoEl.videoHeight || 0;
          if (!(duration >= VBB_MIN_SPAN)) throw new Error(`${file.name || "视频"}：太短，至少约 ${VBB_MIN_SPAN} 秒`);
          if (!srcW) throw new Error(`${file.name || "视频"}：无法读取尺寸`);
          return { file, duration, srcW, srcH };
        } finally {
          URL.revokeObjectURL(url);
          videoEl.pause?.();
          videoEl.removeAttribute("src");
          videoEl.load?.();
          videoEl.hidden = true;
        }
      }
  
      function renderVbbBatchList(opts = {}) {
        if (!vbbBatchList) return;
        if (!isVbbBatchMode()) {
          vbbBatchList.hidden = true;
          vbbBatchList.innerHTML = "";
          return;
        }
        vbbBatchList.hidden = false;
        vbbBatchList.innerHTML = "";
        vbbBatchFiles.forEach((item, idx) => {
          ensureVbbItemEdit(item);
          const row = document.createElement("div");
          row.className = "vbb-batch-row hint tight" + (idx === vbbEditBatchIdx ? " is-active" : "");
          row.dataset.vbbBatchIdx = String(idx);
          const main = document.createElement("div");
          main.className = "vbb-batch-row-main";
          const name = document.createElement("span");
          name.className = "vbb-batch-row-name";
          name.textContent = `${idx + 1}. ${item.file.name}`;
          const meta = document.createElement("span");
          meta.className = "vbb-batch-row-meta";
          const badge = vbbEditBadge(item.edit, item.duration, item.srcW, item.srcH);
          const markCount =
            idx === vbbEditBatchIdx ? completeVbbMarks().length : completeMarksList(item.marks).length;
          const markBadge = markCount > 0 ? `${markCount} 段打点` : "";
          const baseMeta = [`${item.duration.toFixed(1)}s`, formatKb(item.file.size), `${item.srcW}×${item.srcH}`]
            .filter(Boolean)
            .join(" · ");
          meta.append(baseMeta);
          if (markBadge) {
            meta.append(" · ", markBadge);
          } else if (badge) {
            const tag = document.createElement("span");
            tag.className = "vbb-edit-badge";
            tag.textContent = `已编辑 · ${badge}`;
            meta.append(" · ", tag);
            row.classList.add("is-edited");
          } else if (!isVbbManualMode()) {
            meta.append(" · 未编辑");
          }
          main.appendChild(name);
          main.appendChild(meta);
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "secondary-btn";
          btn.textContent = "编辑";
          btn.disabled = vbbBusy || vbbEditOpening || isVbbManualMode();
          btn.hidden = isVbbManualMode();
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            openVbbEditEditor(item).catch((err) => setError(vbbError, err.message || String(err)));
          });
          const previewBtn = document.createElement("button");
          previewBtn.type = "button";
          previewBtn.className = "ghost-btn";
          previewBtn.textContent = idx === vbbEditBatchIdx ? "预览中" : "预览";
          previewBtn.disabled = vbbBusy;
          previewBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            selectVbbBatchItem(idx).catch((err) => setError(vbbError, err.message || String(err)));
          });
          const removeBtn = document.createElement("button");
          removeBtn.type = "button";
          removeBtn.className = "ghost-btn vbb-batch-row-remove";
          removeBtn.setAttribute("aria-label", `移除 ${item.file.name || "视频"}`);
          removeBtn.title = "从多选中移除";
          removeBtn.textContent = "×";
          removeBtn.disabled = vbbBusy || vbbEditOpening;
          removeBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            removeVbbBatchItem(idx).catch((err) => setError(vbbError, err.message || String(err)));
          });
          const actions = document.createElement("div");
          actions.className = "vbb-batch-row-actions";
          actions.appendChild(previewBtn);
          if (!isVbbManualMode()) actions.appendChild(btn);
          actions.appendChild(removeBtn);
          row.appendChild(main);
          row.appendChild(actions);
          row.addEventListener("click", () => {
            if (vbbBusy) return;
            selectVbbBatchItem(idx).catch((err) => setError(vbbError, err.message || String(err)));
          });
          vbbBatchList.appendChild(row);
        });
        if (!opts.keepSelection && vbbEditBatchIdx < 0 && vbbBatchFiles.length) {
          // 首次渲染由调用方 select；此处不自动异步选中，避免重复
        }
      }
  
      function syncVbbBatchMeta() {
        if (!vbbMeta) return;
        if (!isVbbBatchMode()) return;
        const totalDur = vbbBatchFiles.reduce((sum, item) => sum + item.duration, 0);
        const totalSize = vbbBatchFiles.reduce((sum, item) => sum + (item.file.size || 0), 0);
        const edited = vbbBatchFiles.filter((item) =>
          vbbEditIsDirty(item.edit, item.duration, item.srcW, item.srcH)
        ).length;
        const marked = countVbbBatchManualSegments();
        const tip = isVbbManualMode()
          ? ` · 打点仅作用于当前视频${marked ? ` · 共 ${marked} 段` : ""} · 点 × 可移除`
          : ` · 点「编辑」裁时长/画面，再「一键黑盒」· 点 × 可移除`;
        vbbMeta.replaceChildren();
        vbbMeta.append(
          `已选 ${vbbBatchFiles.length} 个视频 · 共 ${totalDur.toFixed(1)}s · ${formatKb(totalSize)}`
        );
        if (edited && !isVbbManualMode()) {
          const tag = document.createElement("span");
          tag.className = "vbb-edit-badge";
          tag.textContent = `已编辑 ${edited} 个`;
          vbbMeta.append(" · ", tag);
        }
        vbbMeta.append(tip);
      }
  
      /** 总进度条与各片段进度并存 */
      function vbbFfmpegPhaseText(raw) {
        const t = String(raw || "").trim();
        if (!t) return "";
        return t
          .replace(/准备\s*FFmpeg\s*引擎/gi, "准备引擎")
          .replace(/载入本地编码器[^…]*/g, "载入编码器")
          .replace(/加载引擎/g, "载入引擎")
          .replace(/双通道调色板编码/g, "调色板编码")
          .replace(/分析调色板/g, "分析调色板")
          .replace(/写入\s*GIF\s*帧/g, "写入帧")
          .replace(/读取\s*GIF/g, "读取结果")
          .replace(/本地载入/g, "载入视频")
          .replace(/抽取片段/g, "截取片段")
          .replace(/准备编码/g, "准备编码")
          .replace(/编码中请稍候/g, "编码中")
          .trim();
      }

      function vbbStageText(text) {
        const t = String(text || "").trim();
        if (!t) return "";
        if (/^(完成|失败|等待|编码|合并|分析|整段转换|批量转换)/.test(t) && t.length <= 24) return t;

        let m;
        if ((m = t.match(/^黑盒编码\s*·\s*(\d+)\s*FPS/i))) return `试 ${m[1]} 帧/秒`;
        if ((m = t.match(/^黑盒压缩\s*·\s*(\d+)\s*FPS(?:\s*·\s*(.+))?$/i))) {
          const tail = m[2] ? vbbStageText(m[2]) : "";
          return tail ? `压缩 ${m[1]} FPS · ${tail}` : `压缩 ${m[1]} 帧/秒`;
        }
        if ((m = t.match(/^黑盒加宽\s*·\s*(\d+)/i))) return `加宽至 ${m[1]}px`;
        if ((m = t.match(/^试\s*(\d+)\s*帧\/秒/i))) return t;
        if ((m = t.match(/^压缩\s*(\d+)\s*FPS/i))) return t;
        if ((m = t.match(/^加宽至\s*(\d+)px/i))) return t;
        if (/^沿用方案/.test(t)) return t.replace(/\s*·\s*/g, " · ");
        if ((m = t.match(/^沿用后超限降宽\s*·\s*(\d+)/i))) return `方案超限，降宽至 ${m[1]}px`;

        if (/^(完成|失败|等待|编码|合并|分析|压缩|降宽)/.test(t) && t.length <= 12) return t;
        const fps = t.match(/(\d+)FPS/);
        if (fps && /压缩|编码/.test(t)) return `${fps[1]} FPS`;
        if (/降宽/.test(t)) {
          const w = t.match(/→\s*(\d+)/) || t.match(/宽\s*(\d+)/);
          return w ? `降宽 ${w[1]}` : "降宽";
        }
        if (/沿用/.test(t)) return t.includes("方案") ? "沿用方案" : "沿用";
        if (/样片|分析/.test(t)) return t.replace(/编码样片/, "样片").replace(/分析中\s*[·.]?\s*/, "分析 ");

        if ((m = t.match(/^(\d+)FPS\s*·\s*(.+)$/i))) {
          const head = vbbFfmpegPhaseText(m[2].split("·")[0]?.trim());
          return head ? `${m[1]} FPS · ${head}` : `${m[1]} FPS`;
        }

        return t
          .replace(/超限→黑盒|仍超限[，,]?\s*改走黑盒/g, "超限")
          .replace(/清晰 GIF|锐度 GIF/g, (m) => m.replace(" GIF", ""))
          .replace(/时长黑盒|手动黑盒|批量黑盒|黑盒回退|黑盒完成|黑盒编码|改走黑盒|压黑盒|黑盒压缩|黑盒加宽|符合黑盒|黑盒/g, "")
          .replace(/\s*·\s*/g, " · ")
          .replace(/(^·|·$)/g, "")
          .trim();
      }

      function formatVbbJobStage(text) {
        const raw = String(text || "").trim();
        if (!raw) return "处理中…";
        return vbbTickerLine(raw) || vbbStageText(raw) || raw;
      }

      function bumpVbbEncodeProgress(ratio, main, stageText, opts = {}) {
        const stage = formatVbbJobStage(stageText);
        setVbbProgress(true, ratio, main, { sub: stage, busy: opts.busy !== false });
        return stage;
      }
  
      function vbbTickerLine(text) {
        const t = String(text || "").trim();
        if (!t) return "";
        if (/已用时|%\s*·|编码中|请稍候/.test(t)) {
          const elapsed = t.match(/已用时\s*(\d+)\s*s/i);
          const pct = t.match(/(\d+)\s*%/);
          const phaseRaw = t.split("·")[0]?.trim() || "";
          const phase = vbbFfmpegPhaseText(phaseRaw) || vbbStageText(phaseRaw);
          const stalled = /编码中|请稍候/.test(t);
          const parts = [];
          if (phase) parts.push(phase);
          else if (phaseRaw && !/^\d+%?$/.test(phaseRaw)) parts.push(vbbStageText(phaseRaw) || phaseRaw.slice(0, 12));
          if (pct) parts.push(`${pct[1]}%`);
          if (elapsed) parts.push(`${elapsed[1]}s`);
          if (stalled && (!pct || Number(pct[1]) < 99)) parts.push("编码中");
          if (parts.length) return parts.join(" · ");
        }
        return vbbStageText(t) || t;
      }
  
      function formatVbbProgressLine(main, sub, pct) {
        const m = vbbStageText(String(main || "").trim());
        const rawSub = String(sub || "").trim();
        const s = rawSub ? (/已用时|%\s*·|编码中|请稍候/.test(rawSub) ? vbbTickerLine(rawSub) : vbbStageText(rawSub) || rawSub) : "";
        const bits = [];
        if (m) bits.push(m);
        if (s && s !== m && !m.includes(s)) bits.push(s);
        const line = bits.join(" · ");
        return line || (pct != null ? `${pct}%` : "");
      }
  
      function vbbClipProgressLine(i, total, { reuse = false } = {}) {
        const bits = [`${i + 1}/${total}`];
        if (reuse) bits.push("沿用");
        return bits.join(" · ");
      }
  
      function setVbbProgress(visible, ratio, text, opts = {}) {
        if (!vbbProgress) return;
        // 一键黑盒：进度只放在每个 GIF 卡片里，总进度条不显示
        if (vbbSuppressGlobalProgress) {
          if (!vbbProgress.hidden) {
            vbbProgress.hidden = true;
            if (vbbProgressFill) {
              vbbProgressFill.style.width = "0%";
              vbbProgressFill.classList.remove("is-active", "is-busy");
            }
            if (vbbProgressPct) vbbProgressPct.hidden = true;
            if (vbbProgressSub) {
              vbbProgressSub.hidden = true;
              vbbProgressSub.classList.remove("is-empty");
            }
          }
          return;
        }
        // 进度 UI 节流：中间态最多 ~90ms 刷一次，隐藏/0/100% 等重要更新不节流（省手机 CPU/防卡顿）
        const r = Number(ratio) || 0;
        const important = !visible || r <= 0 || r >= 1;
        const now = Date.now();
        if (!important && now - (setVbbProgress._last || 0) < 90) return;
        setVbbProgress._last = now;
        const pin = Boolean(visible && vbbProgress.hidden);
        runVbbLayoutUpdate(() => {
          vbbProgress.hidden = !visible;
          if (!visible) {
            if (vbbProgressFill) {
              vbbProgressFill.style.width = "0%";
              vbbProgressFill.classList.remove("is-active", "is-busy");
            }
            if (vbbProgressPct) vbbProgressPct.hidden = true;
            if (vbbProgressSub) {
              vbbProgressSub.hidden = true;
              vbbProgressSub.classList.remove("is-empty");
            }
            return;
          }
          const pct = Math.max(0, Math.min(100, Math.round((ratio || 0) * 100)));
          const busy = Boolean(opts.busy) || (pct > 0 && pct < 100);
          if (vbbProgressFill) {
            vbbProgressFill.style.width = `${Math.max(pct, busy && pct < 8 ? 8 : pct)}%`;
            vbbProgressFill.classList.toggle("is-active", busy);
            vbbProgressFill.classList.toggle("is-busy", Boolean(opts.busy));
          }
          if (vbbProgressPct) {
            vbbProgressPct.textContent = `${pct}%`;
            vbbProgressPct.hidden = false;
          }
          const line = formatVbbProgressLine(text, opts.sub, pct);
          if (vbbProgressText) vbbProgressText.textContent = line;
          if (vbbProgressSub) {
            vbbProgressSub.hidden = true;
            vbbProgressSub.classList.remove("is-empty");
          }
        }, { pin });
      }
  
      function hideVbbMergedBlock() {
        if (vbbMergedUrl) {
          try {
            URL.revokeObjectURL(vbbMergedUrl);
          } catch (_) {}
        }
        vbbMergedUrl = "";
        if (vbbMergedPreview) {
          vbbMergedPreview.hidden = true;
          vbbMergedPreview.removeAttribute("src");
        }
        if (vbbMergedDl) {
          vbbMergedDl.hidden = true;
          vbbMergedDl.removeAttribute("href");
        }
        if (vbbMergedBlock) vbbMergedBlock.hidden = true;
        if (vbbMergedMeta) vbbMergedMeta.textContent = "";
      }
  
      function showVbbMergedBlock(blob, info = {}) {
        hideVbbMergedBlock();
        vbbMergedUrl = URL.createObjectURL(blob);
        if (vbbMergedPreview) {
          vbbMergedPreview.src = vbbMergedUrl;
          vbbMergedPreview.hidden = false;
        }
        if (vbbMergedDl) {
          vbbMergedDl.href = vbbMergedUrl;
          vbbMergedDl.download = info.downloadName || "blackbox-merged.gif";
          vbbMergedDl.hidden = false;
        }
        if (vbbMergedBlock) vbbMergedBlock.hidden = false;
        if (vbbMergedMeta) {
          const bits = [formatKb(blob.size)];
          if (info.beforeSize && info.beforeSize > blob.size) {
            bits.push(`${formatKb(info.beforeSize)} → ${formatKb(blob.size)}`);
          }
          if (info.compressRounds > 0) bits.push(`已压 ${info.compressRounds} 轮`);
          bits.push(blob.size <= V2G_BLACKBOX_MAX_BYTES ? `≤${blackboxBudgetLabel()}` : `仍超 ${blackboxBudgetLabel()}`);
          vbbMergedMeta.textContent = bits.join(" · ");
        }
        if (vbbResultBlock) vbbResultBlock.hidden = false;
      }
  
      function setVbbClipJob(idx, patch = {}) {
        const c = vbbClips[idx];
        if (!c) return;
        if (patch.status != null) c.jobStatus = patch.status;
        if (patch.progress != null) c.jobProgress = Math.max(0, Math.min(1, Number(patch.progress) || 0));
        if (patch.text != null) {
          const polished = vbbStageText(String(patch.text || ""));
          c.jobText = polished || String(patch.text || "");
        }
        const row = vbbList?.querySelector(`[data-vbb-clip="${idx}"]`);
        if (row) syncClipProgressDom(row.querySelector(".vsplit-clip-progress"), c);
      }
  
      function clearVbbClipJobs() {
        vbbClips.forEach((c) => {
          c.jobStatus = "";
          c.jobProgress = 0;
          c.jobText = "";
        });
      }
  
      function resetVbbAbort() {
        abortVbb = false;
        abortV2g = false;
      }
  
      function formatVbbClock(sec) {
        const s = Math.max(0, Number(sec) || 0);
        const m = Math.floor(s / 60);
        const r = Math.floor(s % 60);
        const tenths = Math.round((s - Math.floor(s)) * 10);
        const tail = tenths ? `.${tenths}` : "";
        return `${m}:${String(r).padStart(2, "0")}${tail}`;
      }
  
      /** GIF 实际播放时长（秒）：优先按帧数/帧率，否则用编码 span */
      function vbbEncodedGifDurationSec(encoded) {
        if (!encoded) return 0;
        const fps = Math.max(1, Number(encoded.fps) || 15);
        const frames = Number(encoded.frameCount) || 0;
        if (frames > 1) return (frames - 1) / fps;
        const span = Number(encoded.span);
        return span > 0 ? span : 0;
      }
  
      function attachVbbEncodedMeta(clip, encoded) {
        if (!clip || !encoded) return;
        clip.gifOutW = Number(encoded.outW) || 0;
        clip.gifOutH = Number(encoded.outH) || 0;
        // UI 帧率用成片有效播放 fps（GIF 厘秒量化后）
        const play = Number(encoded.playbackFps) || (typeof gifEffectivePlaybackFps === "function" ? gifEffectivePlaybackFps(encoded.fps) : 0);
        clip.gifFps = play || Number(encoded.fps) || 0;
        clip.gifSpeed = Math.max(1, Number(encoded.speed) || 1);
        clip.gifDuration = vbbEncodedGifDurationSec(encoded);
      }
  
      function simplifyVbbGifNote(note, { mobile = false } = {}) {
        const raw = String(note || "").trim();
        if (!raw || !mobile) return raw;
        const out = [];
        for (const part of raw.split(" · ").filter(Boolean)) {
          if (/^沿用/.test(part)) {
            out.push("沿用");
            continue;
          }
          if (/超限/.test(part)) {
            out.push("超限");
            continue;
          }
          const fps = part.match(/^(\d+)FPS$/);
          if (fps) {
            out.push(`${fps[1]}FPS`);
            continue;
          }
          const dim = part.match(/^(\d+)×\d+$/);
          if (dim) {
            out.push(`${dim[1]}宽`);
            continue;
          }
          if (/^宽≤/.test(part) || /^已压 /.test(part)) continue;
          const qm = part.match(/^画质\s*(\d+)/);
          if (qm) {
            out.push(`画质${qm[1]}`);
            continue;
          }
          if (/^已降宽/.test(part)) {
            out.push(part.replace("已降宽", "降宽"));
            continue;
          }
          if (out.length < 2) out.push(part);
        }
        return out.slice(0, 3).join(" · ");
      }
  
      function formatVbbClipTitle(c, idx) {
        if (c.sourceFile) return c.sourceFile;
        if (c.sourceName) return c.sourceName;
        const n = `#${String(idx + 1).padStart(2, "0")}`;
        if (!(Number(c.start) > 0) && vbbWorkflow === "single" && !isVbbBatchMode()) {
          return vbbSourceFile?.name || "整段 GIF";
        }
        return `${n}  ${formatVbbClock(c.start)}–${formatVbbClock(c.start + c.span)}`;
      }
  
      /** 紧凑体积：6.00 MB → 10MB / 55.7 KB → 56KB */
      function fmtShortBytes(n) {
        const b = Math.max(0, Number(n) || 0);
        if (b >= 1024 * 1024) {
          const mb = b / 1024 / 1024;
          return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10}`.replace(/\.0$/, "") + "MB";
        }
        return `${Math.max(1, Math.round(b / 1024))}KB`;
      }

      function formatVbbClipMeta(c, { mobile = false } = {}) {
        if (c.error && !c.gifBlob) return c.error;
        if (!c.gifBlob) {
          if (c.jobStatus === "running" || c.jobStatus === "pending") return c.jobText || "";
          return c.error || "";
        }
        // 顺序固定：帧率 · 尺寸 · 体积 · 时长（其余附加信息尽量少）
        const bits = [];
        const fps = Number(c.gifFps) || 0;
        const speed = Math.max(1, Number(c.gifSpeed) || 1);
        if (fps) {
          if (speed > 1.02) {
            bits.push(`${fps}FPS·${speed.toFixed(1)}×倍速`);
          } else {
            bits.push(`${fps}FPS`);
          }
        }
        const w = Number(c.gifOutW) || 0;
        const h = Number(c.gifOutH) || 0;
        if (w && h) bits.push(`${w}×${h}`);
        bits.push(fmtShortBytes(c.gifBlob.size));
        const videoSec = Number(c.gifDuration) > 0 ? Number(c.gifDuration) : Number(c.span) || 0;
        if (videoSec > 0) bits.push(formatVsplitSpanSec(videoSec));
        const extra = simplifyVbbGifNote(c.gifNote, { mobile });
        if (extra) {
          extra.split(" · ").forEach((part) => {
            if (!part) return;
            if (/^\d+\s*×\s*\d+$/.test(part) || /^GIF\s*\d+×\d+$/.test(part)) return; // 尺寸已在前面
            if (/^\d+\s*FPS$/i.test(part)) return; // 帧率已在最前
            if (/^宽/.test(part)) return; // 宽度不再展示
            if (/^已压|^超限|^已抽稀|^降宽|^沿用|^耗时|^加速|^已重启|^画质|^\d+\s*色/.test(part)) bits.push(part);
          });
        }
        if (c.error) bits.push(c.error);
        return bits.join(" · ");
      }
  
      function applyVbbClipEncoded(clip, encoded, extraBits = []) {
        if (!clip || !encoded?.blob) return;
        // 硬闸：超上限绝不挂成功下载（编码层也会抛错；此处双保险）
        if (encoded.blob.size > V2G_BLACKBOX_MAX_BYTES) {
          clip.gifBlob = null;
          clip.gifUrl = "";
          clip.error = `超过 ${blackboxBudgetLabel()}（${formatKb(encoded.blob.size)}）· 未交付下载`;
          clip.gifNote = "";
          attachVbbEncodedMeta(clip, encoded);
          return;
        }
        clip.error = "";
        clip.gifBlob = encoded.blob;
        clip.gifUrl = "";
        attachVbbEncodedMeta(clip, encoded);
        const bits = [];
        extraBits.forEach((b) => {
          if (b) bits.push(b);
        });
        const fpsLabel =
          typeof formatBlackboxFpsLabel === "function"
            ? formatBlackboxFpsLabel(encoded)
            : encoded.fps
              ? `${encoded.fps} FPS`
              : "";
        if (fpsLabel) bits.push(fpsLabel.replace(/FPS$/i, "FPS"));
        if (encoded.outW && encoded.outH) bits.push(`${encoded.outW}×${encoded.outH}`);
        // 质量档位：gifski 显示自适应量化 quality，ffmpeg 回退显示色数
        if (encoded.engine === "gifski" && Number.isFinite(Number(encoded.gifskiQuality))) {
          bits.push(`画质 ${Number(encoded.gifskiQuality)}${encoded.quality > 1 ? `(档${encoded.quality})` : ""}`);
        } else if (encoded.maxColors) {
          bits.push(`${encoded.maxColors} 色`);
        }
        if (encoded.compressRounds > 0) bits.push(`已压 ${encoded.compressRounds} 轮`);
        if (encoded.maxW) bits.push(`宽≤${encoded.maxW}`);
        if (encoded.framesCapped && encoded.frameCount) bits.push(`已抽稀 ${encoded.frameCount} 帧`);
        clip.gifNote = bits.filter(Boolean).join(" · ");
      }
  
      function clearVbbResults() {
        vbbClips.forEach((c) => {
          try {
            if (c.gifUrl) URL.revokeObjectURL(c.gifUrl);
          } catch (_) {}
        });
        vbbClips = [];
        vbbPreviewIdx = -1;
        if (vbbList) vbbList.innerHTML = "";
        if (vbbZipUrl) {
          try {
            URL.revokeObjectURL(vbbZipUrl);
          } catch (_) {}
        }
        vbbZipUrl = "";
        hideVbbMergedBlock();
        if (vbbZip) vbbZip.disabled = true;
        if (vbbResultBlock) vbbResultBlock.hidden = true;
        if (vbbResultSummary) {
          vbbResultSummary.textContent = "";
          vbbResultSummary.hidden = true;
        }
      }
  
      function setVbbButtons() {
        const hasVideo = isVbbBatchMode()
          ? vbbBatchFiles.length > 0
          : Boolean(vbbVideo?.src && vbbSourceFile);
        const hasPlan = Boolean(vbbAnalysis?.active?.ranges?.length);
        const manualCount = completeVbbMarks().length;
        const gifCount = vbbClips.filter((c) => c.gifBlob).length;
        if (vbbOneclick) {
          // 多选不强制每条都有打点（未打点的走整段/编辑）；单文件手动模式仍需至少一段
          const manualNeedMarks = isVbbManualMode() && !isVbbBatchMode() && manualCount < 1;
          vbbOneclick.hidden = isVbbSplitMode();
          vbbOneclick.disabled = !hasVideo || vbbBusy || manualNeedMarks || isVbbSplitMode();
          if (isVbbBatchMode()) {
            if (isVbbManualMode()) {
              const segs = countVbbBatchManualSegments();
              vbbOneclick.textContent = segs > 0
                ? `一键黑盒（${vbbBatchFiles.length} 个 · ${segs} 段）`
                : `一键黑盒（${vbbBatchFiles.length} 个）`;
            } else {
              vbbOneclick.textContent = `一键黑盒（${vbbBatchFiles.length} 个）`;
            }
          } else if (isVbbManualMode()) {
            vbbOneclick.textContent = manualCount > 0 ? `一键黑盒（${manualCount} 段）` : "一键黑盒";
          } else {
            vbbOneclick.textContent = "一键黑盒";
          }
        }
        if (vbbAnalyze) vbbAnalyze.disabled = !hasVideo || vbbBusy || isVbbBatchMode() || isVbbManualMode();
        const mergeVideoBtn = $("#vbb-merge-video");
        if (mergeVideoBtn) {
          // 仅在「整段视频」流程（含多选整段）出现；切片/打点模式隐藏
          mergeVideoBtn.hidden = isVbbSplitMode() || isVbbManualMode();
          mergeVideoBtn.disabled = !isVbbBatchMode() || vbbBusy;
        }
        if (vbbRun) {
          vbbRun.disabled = !hasPlan || vbbBusy || isVbbBatchMode() || isVbbManualMode();
          vbbRun.classList.toggle("is-ready", hasPlan && !vbbBusy && isVbbSplitMode());
        }
        // 合并 GIF：只要有 ≥2 个已生成的 GIF 就能合并（批量模式下同样可用）
        if (vbbMerge) vbbMerge.disabled = gifCount < 2 || vbbBusy;
        if (vbbZip) vbbZip.disabled = gifCount < 1 || vbbBusy;
        if (isVbbManualMode()) paintVbbManualControls();
      }
  
      function syncVbbWorkflowUi() {
        const batch = isVbbBatchMode();
        const workflowRow = document.querySelector(".blackbox-workflow-row");
        if (workflowRow) workflowRow.hidden = false;
        const splitBtn = $("#vbb-workflow-split");
        if (splitBtn) {
          // 多选时隐藏「长视频切片」入口（非 disabled）；单文件长视频仍显示
          splitBtn.hidden = batch;
          splitBtn.disabled = false;
          splitBtn.title = "";
          if (batch && vbbWorkflow === "split") vbbWorkflow = "single";
        }
        $("#vbb-workflow-single")?.classList.toggle("is-active", vbbWorkflow === "single");
        $("#vbb-workflow-split")?.classList.toggle("is-active", vbbWorkflow === "split");
        $("#vbb-workflow-manual")?.classList.toggle("is-active", vbbWorkflow === "manual");
        const showSplit = isVbbSplitMode();
        if (vbbSplitPanel) vbbSplitPanel.hidden = !showSplit;
        if (vbbWorkflowHint) {
          if (batch && isVbbManualMode()) {
            vbbWorkflowHint.textContent = VBB_BATCH_MANUAL_HINT;
          } else if (batch) {
            vbbWorkflowHint.textContent = `多选下请用整段或手动打点。点「编辑」单独裁时长/裁画面；可切到「手动打点」按当前视频打点。旗舰/桌面可并行 ${Math.max(1, Number(currentMediaPerf().batchConcurrency) || 1)} 路（均衡/省电仍逐个）。`;
          } else {
            vbbWorkflowHint.textContent = VBB_WORKFLOW_HINTS[vbbWorkflow] || VBB_WORKFLOW_HINTS.single;
          }
        }
        if (vbbAdvanced) vbbAdvanced.hidden = isVbbManualMode() || batch;
        // 压时长对所有流程生效/显示（整段 / 手动打点 / 长视频切片 / 拼接后转黑盒）
        const speedRow = $("#vbb-speed-row");
        if (speedRow) speedRow.hidden = false;
        paintVbbManualUi();
        syncVbbEditUi();
        if (batch) {
          renderVbbBatchList({ keepSelection: true });
          syncVbbBatchMeta();
        }
        setVbbButtons();
      }
  
      async function packDownloadVbbGifs({ auto = false } = {}) {
        const gifs = vbbClips.map((c, i) => ({ c, i })).filter((x) => x.c.gifBlob);
        if (!gifs.length) {
          if (!auto) toast("请先生成 GIF");
          return false;
        }
        const packed = await zipBlobs(
          gifs.map((x) => ({ name: vbbGifDownloadName(x.c, x.i), blob: x.c.gifBlob })),
          "blackbox-clips.zip"
        );
        if (vbbZipUrl) {
          try {
            URL.revokeObjectURL(vbbZipUrl);
          } catch (_) {}
        }
        vbbZipUrl = packed.url;
        triggerLocalDownload(packed.blob, packed.name);
        if (!auto) toast(`已打包 ${gifs.length} 个 GIF`);
        setVbbButtons();
        return true;
      }
  
      function syncVbbModeUi() {
        $("#vbb-mode-custom")?.classList.toggle("is-active", vbbMode === "custom");
        if (vbbCustomRow) vbbCustomRow.hidden = vbbMode !== "custom";
      }
  
      function isVbbEqualize() {
        return Boolean(vbbEqualize?.checked);
      }
  
      function buildVbbRanges(duration, targetSpan, equalize) {
        const d = Number(duration) || 0;
        const part = Math.max(VBB_MIN_SPAN, Number(targetSpan) || VBB_MIN_SPAN);
        if (!(d > 0)) throw new Error("无法读取视频时长");
        const needed = Math.max(1, Math.ceil(d / part - 1e-9));
        const useEqual = Boolean(equalize) || needed > VBB_MAX_CLIPS;
        // 均分，或触顶段数上限：每段等长
        if (useEqual) {
          const n = Math.min(VBB_MAX_CLIPS, needed);
          const ranges = [];
          for (let i = 0; i < n; i++) {
            const start = (i * d) / n;
            const end = ((i + 1) * d) / n;
            ranges.push({ start, span: end - start });
          }
          return ranges;
        }
        const ranges = [];
        let start = 0;
        while (start < d - 1e-9) {
          const remaining = d - start;
          // 剩余不足一段、或切完会留下过短尾巴：并入末段
          if (remaining <= part + 1e-6 || remaining - part < VBB_MIN_SPAN) {
            ranges.push({ start, span: remaining });
            break;
          }
          ranges.push({ start, span: part });
          start += part;
        }
        if (!ranges.length) ranges.push({ start: 0, span: d });
        return ranges;
      }
  
      function typicalVbbSpan(ranges, fallback) {
        if (!ranges?.length) return Math.max(VBB_MIN_SPAN, Number(fallback) || VBB_MIN_SPAN);
        const avg = ranges.reduce((sum, r) => sum + r.span, 0) / ranges.length;
        const first = ranges[0].span;
        if (ranges.every((r) => Math.abs(r.span - first) < 0.08)) return avg;
        return first;
      }
  
      function formatVbbRangesSpanTip(ranges, equalize = false) {
        if (!ranges?.length) return "";
        const avg = ranges.reduce((sum, r) => sum + r.span, 0) / ranges.length;
        const first = ranges[0].span;
        const last = ranges[ranges.length - 1].span;
        if (equalize || ranges.length === 1 || ranges.every((r) => Math.abs(r.span - first) < 0.08)) {
          return `每段 ${avg.toFixed(1)}s`;
        }
        if (Math.abs(last - first) < 0.08) {
          return `每段 ${first.toFixed(1)}s`;
        }
        return `前${ranges.length - 1}段 ${first.toFixed(1)}s · 末段 ${last.toFixed(1)}s`;
      }
  
      function syncVbbEqualizeUi(active) {
        const equalize = isVbbEqualize();
        if (vbbTargetLabel) {
          vbbTargetLabel.textContent = equalize ? "每段时长（秒）" : "目标段时长（秒）";
        }
        if (vbbEqualizeHint) {
          vbbEqualizeHint.textContent = equalize
            ? "各段等长；滑块数值与下方预估一致"
            : "默认关：前面按目标时长切，末段吃剩余";
        }
        if (!vbbTargetSpan || !vbbTargetRange) return;
        if (equalize && active?.ranges?.length) {
          const span = Number(active.typicalSpan ?? typicalVbbSpan(active.ranges, active.maxSpan));
          if (!(span > 0)) return;
          const shown = Number(span.toFixed(1));
          vbbTargetSpan.value = String(shown);
          vbbTargetRange.value = String(shown);
          return;
        }
        const shown = Number((vbbSegmentTarget || Number(vbbTargetSpan.value) || VBB_MIN_SPAN).toFixed(1));
        vbbTargetSpan.value = String(shown);
        vbbTargetRange.value = String(shown);
      }
  
      function vbbWidthLadder(srcW) {
        const hard = srcW > 0 ? srcW : V2G_BLACKBOX_WIDTH_HARD_FALLBACK;
        const start = Math.min(V2G_BLACKBOX_BASE_W, hard);
        const list = [];
        for (let w = start; w <= hard + 0.1; w += V2G_BLACKBOX_WIDTH_STEP) {
          list.push(Math.min(hard, Math.round(w)));
        }
        if (!list.length) list.push(Math.max(64, hard || V2G_BLACKBOX_BASE_W));
        const last = list[list.length - 1];
        if (last < hard) list.push(hard);
        return [...new Set(list)];
      }
  
      function vbbSampleBaseWidth(srcW) {
        return Math.min(V2G_BLACKBOX_BASE_W, srcW > 0 ? srcW : V2G_BLACKBOX_BASE_W);
      }
  
      function estimateVbbBytesAtWidth(bps15, span, width, srcW) {
        const s = Math.max(VBB_MIN_SPAN, Number(span) || VBB_MIN_SPAN);
        const baseW = vbbSampleBaseWidth(srcW);
        const w = Math.max(64, Number(width) || baseW);
        const scale = (w / Math.max(1, baseW)) ** 2;
        return Math.round(bps15 * s * scale);
      }
  
      function estimateVbbBytesAtFpsWidth(bps15, span, fps, width, srcW) {
        const f = Math.max(1, Number(fps) || 15);
        return Math.round(estimateVbbBytesAtWidth(bps15, span, width, srcW) * (f / 15));
      }
  
        function resolveBlackboxEstimateFpsList(span) {
          // 与 resolveBlackboxFpsList 保持一致，否则预估与实际不符
          return resolveBlackboxFpsList(span, 0);
        }
  
      /**
       * 对齐 encodeBlackboxClip 加宽：仅当当前体积 < 5MB 才尝试加宽，
       * 并取仍 ≤预算的最大宽（加宽重编码不带压缩）。
       */
      function resolveVbbWidenWidthForEst(bps15, span, fps, srcW, startBytes, startW) {
        const budget = V2G_BLACKBOX_MAX_BYTES;
        const widenGate = V2G_BLACKBOX_WIDEN_BYTES;
        let best = Math.max(64, Number(startW) || vbbSampleBaseWidth(srcW));
        let bestBytes = Math.max(1, Number(startBytes) || estimateVbbBytesAtFpsWidth(bps15, span, fps, best, srcW));
        if (bestBytes >= widenGate) return { maxW: best, bytes: bestBytes };
        for (const w of vbbWidthLadder(srcW)) {
          if (w <= best) continue;
          const est = estimateVbbBytesAtFpsWidth(bps15, span, fps, w, srcW);
          if (est <= budget) {
            best = w;
            bestBytes = est;
          } else break;
        }
        return { maxW: best, bytes: bestBytes };
      }
  
      /**
       * 对齐 encodeBlackboxClip：
       * - ≤24s 从 15 起；≈30s 从 12 起（20 仅短片余量提帧，估算不预判）
       * - 每档先 420 宽；超限轻柔压缩；体积有余再加宽
       */
      function estimateVbbBlackboxPlan(bps15, span, srcW) {
        const s = Math.max(VBB_MIN_SPAN, Number(span) || VBB_MIN_SPAN);
        const maxBytes = V2G_BLACKBOX_MAX_BYTES;
        const baseW = vbbSampleBaseWidth(srcW);
        const fpsList = resolveBlackboxEstimateFpsList(s);
  
        for (let i = 0; i < fpsList.length; i++) {
          const fps = fpsList[i];
          const isLast = i >= fpsList.length - 1;
          const atBase = estimateVbbBytesAtFpsWidth(bps15, s, fps, baseW, srcW);
  
          if (atBase <= maxBytes) {
            const wide = resolveVbbWidenWidthForEst(bps15, s, fps, srcW, atBase, baseW);
            return { bytes: wide.bytes, fps, compressRounds: 0, maxW: wide.maxW };
          }
  
          const soft = Math.round(atBase * VBB_SOFT_COMPRESS_KEEP);
          if (soft <= maxBytes) {
            // 实装：轻压进预算后若有余量，会用不带压缩的更宽重编码加宽（compressRounds 归零）
            if (soft < V2G_BLACKBOX_WIDEN_BYTES) {
              const wide = resolveVbbWidenWidthForEst(bps15, s, fps, srcW, soft, baseW);
              if (wide.maxW > baseW) {
                return { bytes: wide.bytes, fps, compressRounds: 0, maxW: wide.maxW };
              }
            }
            return {
              bytes: Math.min(maxBytes, Math.max(soft, Math.round(maxBytes * 0.88))),
              fps,
              compressRounds: 1,
              maxW: baseW,
            };
          }
  
          if (isLast) {
            return { bytes: maxBytes, fps, compressRounds: 2, maxW: baseW };
          }
        }
  
        return { bytes: maxBytes, fps: 12, compressRounds: 2, maxW: baseW };
      }
  
      function estimateVbbBytesBlackbox(bps15, span, srcW) {
        return estimateVbbBlackboxPlan(bps15, span, srcW).bytes;
      }
  
      function estimateVbbFps(bps15, span, mode, width, srcW) {
        if (mode !== "duration" && mode !== "blackbox") return 15;
        return estimateVbbBlackboxPlan(bps15, span, srcW).fps;
      }
  
      function estimateVbbCompressRounds(bps15, span, mode, srcW) {
        if (mode !== "duration" && mode !== "blackbox") return 0;
        return estimateVbbBlackboxPlan(bps15, span, srcW).compressRounds;
      }
  
      function estimateVbbBytes(bps15, span, mode, width, srcW) {
        const s = Math.max(VBB_MIN_SPAN, Number(span) || VBB_MIN_SPAN);
        if (mode === "duration" || mode === "blackbox") {
          return estimateVbbBytesBlackbox(bps15, s, srcW);
        }
        return estimateVbbBytesAtWidth(bps15, s, width || vbbSampleBaseWidth(srcW), srcW);
      }
  
      function formatVbbFpsTip(fps) {
        return `${fps || 15}FPS`;
      }
  
      function resolveVbbWidthForSpan(bps15, span, srcW) {
        const budget = V2G_BLACKBOX_MAX_BYTES * VBB_SAFETY;
        let best = vbbSampleBaseWidth(srcW);
        for (const w of vbbWidthLadder(srcW)) {
          if (estimateVbbBytesAtWidth(bps15, span, w, srcW) <= budget) best = w;
          else break;
        }
        return best;
      }
  
      function resolveVbbSpanForWidth(bps15, width, srcW) {
        const baseW = vbbSampleBaseWidth(srcW);
        const scale = (Math.max(baseW, Number(width) || baseW) / Math.max(1, baseW)) ** 2;
        const span = (V2G_BLACKBOX_MAX_BYTES * VBB_SAFETY) / Math.max(1, bps15 * scale);
        return Math.max(VBB_MIN_SPAN, Math.min(VBB_CLARITY_MAX_SPAN, span));
      }
  
      function describeVbbExpect(mode, targetSpan, clarityMax, durationMax, maxW, estFps, compressRounds) {
        const fps = estFps || 15;
        const compressTip = compressRounds > 0 ? `，预计压${compressRounds}轮` : "";
        if (mode === "clarity") return `不压缩 · ≤${blackboxBudgetLabel()}`;
        if (mode === "sharp") return `缩短加宽 · 不压缩 · ≤${blackboxBudgetLabel()}`;
        if (mode === "duration")
          return `≤${blackboxBudgetLabel()}${compressTip}`;
        if (targetSpan < clarityMax - 0.05) {
          return `短于清晰档 · 目标宽${maxW || "?"} · 不压缩`;
        }
        if (targetSpan <= clarityMax + 0.05) return "接近清晰优先 · 尽量不压缩";
        if (targetSpan <= durationMax + 0.05) {
          return `超过清晰安全时长 · 走黑盒（预计 ${fps}FPS${compressTip}）`;
        }
        return `目标偏长 · 走黑盒（预计 ${fps}FPS${compressTip}），个别段可能接近 ${blackboxBudgetLabel()} 上限`;
      }
  
      function annotateVbbPlan(plan, bps15, srcW) {
        const avgSpan = plan.avgSpan;
        const typicalSpan = plan.typicalSpan || typicalVbbSpan(plan.ranges, avgSpan);
        const maxW = plan.maxW || vbbSampleBaseWidth(srcW);
        const capped = plan.count >= VBB_MAX_CLIPS && typicalSpan > plan.maxSpan * 1.02;
        let note = plan.note;
        let encode = plan.encode;
        let unsafe = false;
        if (capped) {
          unsafe = true;
          note = `${note} · 已达 ${VBB_MAX_CLIPS} 段上限，单段约 ${typicalSpan.toFixed(1)}s`;
        }
        const estMode = encode === "blackbox" ? "duration" : "clarity";
        let estBytes;
        let estFps;
        let estCompressRounds = 0;
        let outMaxW = maxW;
        if (estMode === "duration") {
          const bb = estimateVbbBlackboxPlan(bps15, typicalSpan, srcW);
          estBytes = bb.bytes;
          estFps = bb.fps;
          estCompressRounds = bb.compressRounds;
          outMaxW = bb.maxW || maxW;
        } else {
          estBytes = estimateVbbBytes(bps15, typicalSpan, estMode, maxW, srcW);
          estFps = 15;
        }
        if ((encode === "clarity" || encode === "sharp") && estBytes > V2G_BLACKBOX_MAX_BYTES) {
          unsafe = true;
          note = `${note} · 预估超 ${blackboxBudgetLabel()}`;
        }
        if ((encode === "clarity" || encode === "sharp") && typicalSpan > plan.maxSpan * 1.05) {
          unsafe = true;
          note = `${note} · 实际单段长于安全时长`;
        }
        return {
          ...plan,
          typicalSpan,
          note,
          encode,
          unsafe,
          maxW: outMaxW,
          estBytes,
          estFps,
          estCompressRounds,
        };
      }
  
      function makeVbbPlanVariant(key, label, duration, maxSpan, bps15, note, opts = {}) {
        const hardCap = key === "duration" ? VBB_DURATION_MAX_SPAN : VBB_CLARITY_MAX_SPAN;
        const safeMax = Math.max(VBB_MIN_SPAN, Math.min(maxSpan, hardCap));
        const ranges = buildVbbRanges(duration, safeMax, isVbbEqualize());
        const avgSpan = ranges.reduce((a, r) => a + r.span, 0) / Math.max(1, ranges.length);
        const typicalSpan = typicalVbbSpan(ranges, safeMax);
        const encode = opts.encode || (key === "duration" ? "blackbox" : key === "sharp" ? "sharp" : "clarity");
        const srcW = opts.srcW || 0;
        const maxW = opts.maxW || vbbSampleBaseWidth(srcW);
        return annotateVbbPlan(
          {
            key,
            label,
            maxSpan: safeMax,
            ranges,
            count: ranges.length,
            avgSpan,
            typicalSpan,
            estBytes: estimateVbbBytes(bps15, typicalSpan, encode === "blackbox" ? "duration" : "clarity", maxW, srcW),
            note,
            encode,
            maxW,
          },
          bps15,
          srcW
        );
      }
  
      function makeSharpPlan(duration, bps15, srcW, clarityMax) {
        const ladder = vbbWidthLadder(srcW);
        const topW = ladder[ladder.length - 1] || vbbSampleBaseWidth(srcW);
        let targetSpan = resolveVbbSpanForWidth(bps15, topW, srcW);
        targetSpan = Math.max(VBB_MIN_SPAN, Math.min(clarityMax, targetSpan));
        const wideAtClarity = resolveVbbWidthForSpan(bps15, clarityMax, srcW);
        if (wideAtClarity > vbbSampleBaseWidth(srcW) + 1) {
          const spanForTop = resolveVbbSpanForWidth(bps15, topW, srcW);
          if (spanForTop >= clarityMax - 0.05) {
            targetSpan = clarityMax;
          } else {
            targetSpan = Math.max(VBB_MIN_SPAN, Math.min(clarityMax, spanForTop));
          }
        }
        const maxW = resolveVbbWidthForSpan(bps15, targetSpan, srcW);
        return makeVbbPlanVariant(
          "sharp",
          "锐度优先",
          duration,
          targetSpan,
          bps15,
          `宽${maxW} · 缩短加宽 · 不压缩 · ≤${blackboxBudgetLabel()}`,
          { encode: "sharp", maxW, srcW }
        );
      }
  
      function rebuildVbbDerivedPlans() {
        if (!vbbAnalysis) return;
        const { duration, bps15, srcW, clarityMax, durationMax } = vbbAnalysis;
        if (!(duration > 0) || !(bps15 > 0) || !(clarityMax > 0)) return;
        vbbAnalysis.clarity = makeVbbPlanVariant(
          "clarity",
          "清晰优先",
          duration,
          clarityMax,
          bps15,
          `宽420 · 贴紧${blackboxBudgetLabel()} · 不压缩`,
          { encode: "clarity", maxW: V2G_BLACKBOX_BASE_W, srcW }
        );
        vbbAnalysis.sharp = makeSharpPlan(duration, bps15, srcW, clarityMax);
        vbbAnalysis.durationPlan = makeVbbPlanVariant(
          "duration",
          "时长优先",
          duration,
          durationMax,
          bps15,
          "可降帧/压缩 · 段更长、段数更少",
          { encode: "blackbox", maxW: V2G_BLACKBOX_BASE_W, srcW }
        );
      }
  
      function resolveActiveVbbPlan() {
        if (!vbbAnalysis) return null;
        const { duration, bps15, clarity, sharp, durationPlan, srcW } = vbbAnalysis;
        if (vbbMode === "clarity") return { ...clarity, encode: clarity.encode || "clarity", maxW: clarity.maxW || vbbSampleBaseWidth(srcW) };
        if (vbbMode === "sharp") return { ...sharp, encode: "sharp", maxW: sharp.maxW || vbbSampleBaseWidth(srcW) };
        if (vbbMode === "duration") return { ...durationPlan, encode: "blackbox", maxW: durationPlan.maxW || vbbSampleBaseWidth(srcW) };
        let target = Number(vbbSegmentTarget || vbbTargetSpan?.value);
        if (!(target > 0)) target = clarity.maxSpan;
        target = Math.max(VBB_MIN_SPAN, Math.min(VBB_DURATION_MAX_SPAN, target));
        const ranges = buildVbbRanges(duration, target, isVbbEqualize());
        const avgSpan = ranges.reduce((a, r) => a + r.span, 0) / Math.max(1, ranges.length);
        const typicalSpan = typicalVbbSpan(ranges, target);
        if (typicalSpan > clarity.maxSpan + 0.05) {
          const estPlan = estimateVbbBlackboxPlan(bps15, typicalSpan, srcW);
          return annotateVbbPlan(
            {
              key: "custom",
              label: "自定义时长",
              maxSpan: target,
              ranges,
              count: ranges.length,
              avgSpan,
              typicalSpan,
              estBytes: estPlan.bytes,
              estFps: estPlan.fps,
              estCompressRounds: estPlan.compressRounds,
              note: describeVbbExpect(
                "custom",
                typicalSpan,
                clarity.maxSpan,
                durationPlan.maxSpan,
                V2G_BLACKBOX_BASE_W,
                estPlan.fps,
                estPlan.compressRounds
              ),
              encode: "blackbox",
              maxW: V2G_BLACKBOX_BASE_W,
            },
            bps15,
            srcW
          );
        }
        const maxW = resolveVbbWidthForSpan(bps15, typicalSpan, srcW);
        const encode = maxW > vbbSampleBaseWidth(srcW) + 1 ? "sharp" : "clarity";
        const estFps = 15;
        return annotateVbbPlan(
          {
            key: "custom",
            label: "自定义时长",
            maxSpan: target,
            ranges,
            count: ranges.length,
            avgSpan,
            typicalSpan,
            estBytes: estimateVbbBytes(bps15, typicalSpan, "clarity", maxW, srcW),
            estFps,
            estCompressRounds: 0,
            note: describeVbbExpect("custom", typicalSpan, clarity.maxSpan, durationPlan.maxSpan, maxW, estFps, 0),
            encode,
            maxW,
          },
          bps15,
          srcW
        );
      }
  
      function paintVbbPlan() {
        const planWasHidden = Boolean(vbbPlan?.hidden);
        const willShowPlan = Boolean(vbbAnalysis);
        const pin = planWasHidden && willShowPlan;
        runVbbLayoutUpdate(() => {
          if (!vbbAnalysis) {
            if (vbbPlan) vbbPlan.hidden = true;
            setVbbButtons();
            return;
          }
          const active = resolveActiveVbbPlan();
          vbbAnalysis.active = active;
          if (vbbPlan) vbbPlan.hidden = false;
          if (vbbAdvanced) vbbAdvanced.open = true;
          syncVbbModeUi();
  
          if (vbbPlanSummary && active) {
            const widthTip = active.maxW ? ` · 目标宽 ${active.maxW}` : "";
            const fpsTip = ` · ${formatVbbFpsTip(active.estFps || 15, active.estCompressRounds || 0)}`;
            const warn = active.unsafe ? " ⚠ 可能超预算，执行时超限会降宽或改走黑盒。" : "";
            vbbPlanSummary.textContent = `将生成 ${active.count} 个切片 · ${formatVbbRangesSpanTip(active.ranges, isVbbEqualize())}${widthTip}${fpsTip} · 预估约 ${formatKb(active.estBytes)}/段 · ${active.note}（体积为估算；各段预览在生成后显示）${warn}`;
          }
  
          if (vbbPlanList) vbbPlanList.innerHTML = "";
  
          if (vbbTargetSpan && vbbTargetRange && vbbAnalysis) {
            const min = VBB_MIN_SPAN;
            const max = Math.max(
              vbbAnalysis.clarity.maxSpan,
              vbbAnalysis.sharp?.maxSpan || 0,
              vbbAnalysis.durationPlan.maxSpan
            );
            vbbTargetRange.min = String(Number(min.toFixed(1)));
            vbbTargetRange.max = String(Number(max.toFixed(1)));
            let cur = Number(vbbTargetSpan.value);
            if (!(cur >= min && cur <= max)) {
              cur = Math.min(max, Math.max(min, vbbAnalysis.clarity.maxSpan));
              vbbSegmentTarget = cur;
              vbbTargetSpan.value = String(Number(cur.toFixed(1)));
            }
            vbbTargetRange.value = String(Number(cur.toFixed(1)));
            vbbTargetSpan.min = vbbTargetRange.min;
            vbbTargetSpan.max = vbbTargetRange.max;
          }
  
          syncVbbEqualizeUi(active);
  
          setVbbButtons();
        }, { pin });
      }
  
      function syncVbbResultSummary() {
        const gifCount = vbbClips.filter((c) => c.gifBlob).length;
        const failCount = vbbClips.filter((c) => c.error && !c.gifBlob).length;
        if (vbbResultBlock) vbbResultBlock.hidden = vbbClips.length === 0;
        if (vbbResultSummary && vbbClips.length) {
          const totalBytes = vbbClips.reduce((sum, c) => sum + (c.gifBlob?.size || 0), 0);
          const bits = [`${vbbClips.length} 段`];
          if (gifCount) bits.push(`${gifCount} 个 GIF · ${formatKb(totalBytes)}`);
          if (failCount) bits.push(`${failCount} 段失败`);
          vbbResultSummary.textContent = bits.join(" · ");
          vbbResultSummary.hidden = bits.length === 0;
        } else if (vbbResultSummary) {
          vbbResultSummary.hidden = true;
        }
      }
  
      function buildVbbClipPreviewWrap(c, idx) {
        if (!c.gifBlob || vbbPreviewIdx !== idx) return null;
        if (!c.gifUrl) c.gifUrl = URL.createObjectURL(c.gifBlob);
        const wrap = document.createElement("div");
        wrap.className = "vbb-clip-preview-wrap";
        const img = document.createElement("img");
        img.className = "vsplit-clip-gif";
        img.alt = `片段 ${idx + 1}`;
        img.loading = "lazy";
        img.decoding = "async";
        img.src = c.gifUrl;
        wrap.appendChild(img);
        return wrap;
      }
  
      function buildVbbClipActions(c, idx) {
        const actions = document.createElement("div");
        actions.className = "btn-row";
        if (!c.gifBlob) return actions;
        const shareOk = typeof preferShareToGallery === "function" && preferShareToGallery();
        const dlBtn = document.createElement("button");
        dlBtn.type = "button";
        dlBtn.className = "secondary-btn";
        dlBtn.textContent = shareOk ? "分享到相册" : "下载 GIF";
        dlBtn.title = shareOk ? "调起系统分享，可选存到相册" : "";
        dlBtn.addEventListener("click", () => {
          if (!c.gifBlob) return;
          if (shareOk && typeof shareMediaBlob === "function") {
            shareMediaBlob(c.gifBlob, vbbGifDownloadName(c, idx), {
              title: vbbGifDownloadName(c, idx),
              fallbackDownload: true,
            }).then((r) => {
              if (r.shared) toast("已调起系统分享 · 可选存到相册");
            });
            return;
          }
          triggerLocalDownload(c.gifBlob, vbbGifDownloadName(c, idx));
        });
        actions.appendChild(dlBtn);
        const previewBtn = document.createElement("button");
        previewBtn.type = "button";
        previewBtn.className = "ghost-btn vbb-preview-btn";
        previewBtn.textContent = vbbPreviewIdx === idx ? "收起预览" : "预览";
        previewBtn.addEventListener("click", () => toggleVbbClipPreview(idx));
        actions.appendChild(previewBtn);
        return actions;
      }
  
      function buildVbbClipRow(c, idx) {
        const row = document.createElement("div");
        row.className = "gif-frame vsplit-clip";
        row.dataset.vbbClip = String(idx);
        const top = document.createElement("div");
        top.className = "vsplit-clip-top";
        const head = document.createElement("div");
        head.className = "vbb-clip-head";
        const title = document.createElement("strong");
        title.className = "vbb-clip-title";
        title.textContent = formatVbbClipTitle(c, idx);
        head.appendChild(title);
        const metaText = formatVbbClipMeta(c, { mobile: isLikelyMobileBrowser() });
        if (metaText) {
          const meta = document.createElement("span");
          meta.className = "hint tight vbb-clip-meta";
          meta.textContent = metaText;
          head.appendChild(meta);
        }
        top.append(head, buildVbbClipActions(c, idx));
        row.appendChild(top);
        const progressBox = buildClipProgressDom();
        row.appendChild(progressBox);
        syncClipProgressDom(progressBox, c);
        const preview = buildVbbClipPreviewWrap(c, idx);
        if (preview) row.appendChild(preview);
        return row;
      }
  
      function toggleVbbClipPreview(idx) {
        const next = vbbPreviewIdx === idx ? -1 : idx;
        const prev = vbbPreviewIdx;
        vbbPreviewIdx = next;
        if (prev >= 0 && prev !== next) {
          vbbList?.querySelector(`[data-vbb-clip="${prev}"]`)?.querySelector(".vbb-clip-preview-wrap")?.remove();
          const prevBtn = vbbList?.querySelector(`[data-vbb-clip="${prev}"] .vbb-preview-btn`);
          if (prevBtn) prevBtn.textContent = "预览";
        }
        if (next < 0) return;
        const c = vbbClips[next];
        const row = vbbList?.querySelector(`[data-vbb-clip="${next}"]`);
        if (!row || !c?.gifBlob) return;
        row.querySelector(".vbb-clip-preview-wrap")?.remove();
        const preview = buildVbbClipPreviewWrap(c, next);
        if (preview) row.appendChild(preview);
        const btn = row.querySelector(".vbb-preview-btn");
        if (btn) btn.textContent = "收起预览";
      }
  
      function refreshVbbClipRow(idx) {
        const c = vbbClips[idx];
        const row = vbbList?.querySelector(`[data-vbb-clip="${idx}"]`);
        if (!c || !row) return;
        const title = row.querySelector(".vbb-clip-title");
        if (title) title.textContent = formatVbbClipTitle(c, idx);
        const head = row.querySelector(".vbb-clip-head");
        const metaText = formatVbbClipMeta(c, { mobile: isLikelyMobileBrowser() });
        let meta = row.querySelector(".vbb-clip-meta");
        if (metaText) {
          if (!meta && head) {
            meta = document.createElement("span");
            meta.className = "hint tight vbb-clip-meta";
            head.appendChild(meta);
          }
          if (meta) meta.textContent = metaText;
        } else if (meta) {
          meta.remove();
        }
        const top = row.querySelector(".vsplit-clip-top");
        const oldActions = row.querySelector(".vsplit-clip-top .btn-row");
        const nextActions = buildVbbClipActions(c, idx);
        if (oldActions) oldActions.replaceWith(nextActions);
        else if (top) top.appendChild(nextActions);
        syncClipProgressDom(row.querySelector(".vsplit-clip-progress"), c);
        syncVbbResultSummary();
        setVbbButtons();
      }
  
      function renderVbbResults() {
        if (!vbbList) return;
        const prevCount = vbbList.childElementCount;
        const blockWasHidden = Boolean(vbbResultBlock?.hidden);
        const pin = blockWasHidden || prevCount !== vbbClips.length;
        runVbbLayoutUpdate(() => {
          vbbList.innerHTML = "";
          syncVbbResultSummary();
          vbbClips.forEach((c, idx) => {
            vbbList.appendChild(buildVbbClipRow(c, idx));
          });
          setVbbButtons();
        }, { pin });
      }
  
      function clearVbb() {
        if (vbbBusy) {
          abortVbb = true;
          abortV2g = true;
          terminateFfmpegInstance({ revokeAssets: false });
          scheduleFfmpegPrewarm();
        }
        vbbBusy = false;
        vbbSourceFile = null;
        vbbBatchFiles = [];
        vbbEditBatchIdx = -1;
        vbbSingleEdit = null;
        vbbAnalysis = null;
        clearVbbResults();
        if (vbbObjectUrl) {
          URL.revokeObjectURL(vbbObjectUrl);
          vbbObjectUrl = "";
        }
        if (vbbVideo) {
          vbbVideo.pause?.();
          vbbVideo.removeAttribute("src");
          vbbVideo.load?.();
          vbbVideo.hidden = true;
        }
        if (vbbFile) vbbFile.value = "";
        if (vbbAbort) vbbAbort.hidden = true;
        if (vbbPlan) vbbPlan.hidden = true;
        if (vbbPlanList) vbbPlanList.innerHTML = "";
        clearVbbMarks();
        clearTimeout(vbbSeekTimer);
        vbbSeekTimer = 0;
        vbbPendingSeek = null;
        flushVbbScrubSeek();
        setVbbProgress(false, 0, "");
        setError(vbbError, "");
        if (vbbMeta) vbbMeta.textContent = VBB_DEFAULT_META;
        renderVbbBatchList();
        syncVbbEditUi();
        resetVbbAbort();
        syncVbbWorkflowUi();
        setVbbButtons();
      }
  
      async function loadVbbFiles(fileList) {
        const files = [...(fileList || [])].filter(isLikelyVideoFile);
        if (!files.length) {
          setError(vbbError, "未识别为视频文件，请选择 MP4 / WebM / MOV 等格式");
          toast("未识别为视频文件");
          return;
        }
        if (files.length === 1) {
          await loadVbbFile(files[0]);
          return;
        }
        clearVbb();
        vbbWorkflow = "single";
        syncVbbWorkflowUi();
        setError(vbbError, "");
        toast(`已选择 ${files.length} 个视频，仅本机处理，不会上传`);
        const probed = [];
        for (const file of files) {
          const item = await probeVbbVideoFile(file);
          ensureVbbItemEdit(item);
          probed.push(item);
        }
        vbbBatchFiles = probed;
        renderVbbBatchList();
        syncVbbBatchMeta();
        setVbbButtons();
        await selectVbbBatchItem(0, { force: true });
        toast("全部视频已就绪 · 可逐个预览/打点或「编辑」，点 × 可移除，再「一键黑盒」");
      }
  
      async function loadVbbFile(file) {
        if (!file) return;
        clearVbb();
        vbbBatchFiles = [];
        vbbEditBatchIdx = -1;
        renderVbbBatchList();
        vbbSourceFile = file;
        setError(vbbError, "");
        if (vbbMeta) vbbMeta.textContent = formatLocalPickMeta(file, "正在读取时长…");
        toast("已选择，仅本机处理，不会上传");
        vbbObjectUrl = URL.createObjectURL(file);
        attachLocalVideoPreview(vbbVideo, vbbObjectUrl);
        await waitVideoMetadata(vbbVideo);
        const duration = Number(vbbVideo.duration) || 0;
        if (!(duration > 0) || !vbbVideo.videoWidth) throw new Error("视频时长或尺寸无效");
        if (duration < VBB_MIN_SPAN) throw new Error(`视频太短，至少约 ${VBB_MIN_SPAN} 秒`);
        vbbSingleEdit = makeVbbEditState(duration, vbbVideo.videoWidth, vbbVideo.videoHeight);
        if (vbbMeta) {
          vbbMeta.textContent = formatLocalPickMeta(
            file,
            `${duration.toFixed(1)}s · ${vbbVideo.videoWidth}×${vbbVideo.videoHeight}`
          );
        }
        if (isVbbManualMode() && duration >= VBB_LONG_VIDEO_SEC) {
          toast("长视频手动打点：拖动时自动暂停，建议少播放；也可先在「视频切分」打点");
        }
        syncVbbScrubFromVideo();
        syncVbbWorkflowUi();
        syncVbbEditUi();
        setVbbButtons();
        toast(vbbWorkflow === "single" ? "视频已就绪 · 可点「编辑」裁时长/画面，再「一键黑盒」" : "视频已就绪，点「一键黑盒」即可");
      }
  
      async function runVbbManualBlackbox() {
        if (!vbbSourceFile || !vbbVideo?.src || vbbBusy) return;
        const ranges = computeVbbManualRanges();
        const srcW = vbbVideo.videoWidth || 0;
        const srcH = vbbVideo.videoHeight || 0;
        abortVbb = false;
        vbbBusy = true;
        setVbbButtons();
        if (vbbAbort) vbbAbort.hidden = false;
        setError(vbbError, "");
        clearVbbResults();
        vbbClips = ranges.map((r) => ({
          start: r.start,
          span: r.span,
          gifBlob: null,
          gifUrl: "",
          gifNote: "",
          gifDuration: 0,
          error: "",
          jobStatus: "pending",
          jobProgress: 0,
          jobText: "等待中…",
        }));
        renderVbbResults();
        try {
          await prewarmFfmpegEngine().catch(() => {});
          const fileBytes = vbbSourceFile?.size || 0;
          const hugeFile = fileBytes >= 120 * 1024 * 1024;
          const mobile = isLikelyMobileBrowser();
          if (mobile && (hugeFile || ranges.some((r) => r.span >= 90))) {
            toast("长片段在手机上易内存不足，建议每段控制在 30s 内或用电脑");
          }
          if (hugeFile || ranges.length >= 4) {
            try {
              const ff = await getFfmpegInstance();
              await ensureFfmpegInputWritten(ff, vbbSourceFile, () => {});
            } catch (_) {}
          }
          const vbbCrop = await vbbResolveCrop(vbbSourceFile);
          for (let i = 0; i < ranges.length; i++) {
            if (abortVbb) throw new Error("已取消");
            const r = ranges[i];
            const reuse = resolveVbbSegmentReuse(ranges, i, null, "blackbox", vbbSpeedFactorForSpan(r.span));
            const followTip = reuse.fromCache ? " · 沿用方案" : "";
            setVbbClipJob(i, { status: "running", progress: 0.02, text: "准备编码…" });
            setVbbProgress(true, i / ranges.length, vbbClipProgressLine(i, ranges.length, { reuse: Boolean(reuse.fromCache) }), {
              sub: `${formatVbbClock(r.start)}–${formatVbbClock(r.start + r.span)}`,
              busy: true,
            });
            const encoded = await encodeBlackboxClip({
              file: vbbSourceFile,
              startSec: r.start,
              span: r.span,
              srcW,
              srcH,
              isAborted: () => abortVbb,
              seed: reuse.seed || undefined,
              speedLimitSec: vbbSpeedLimitSec(),
              crop: vbbCrop,
              onProgress: (local, text) => {
                const p = (i + Math.min(0.98, local)) / ranges.length;
                const stage = bumpVbbEncodeProgress(p, vbbClipProgressLine(i, ranges.length, { reuse: Boolean(reuse.fromCache) }), text);
                setVbbClipJob(i, { status: "running", progress: Math.min(0.98, local), text: stage });
              },
            });
            if (abortVbb) throw new Error("已取消");
            applyVbbClipEncoded(vbbClips[i], encoded, reuse.fromCache ? ["沿用方案"] : []);
            if (vbbClips[i].error || !vbbClips[i].gifBlob) {
              setVbbClipJob(i, { status: "error", progress: 1, text: "失败" });
              refreshVbbClipRow(i);
              continue;
            }
            saveVbbSpanScheme(r.span, snapshotVbbEncodeSeed(encoded, {}), "blackbox");
            setVbbClipJob(i, { status: "done", progress: 1, text: "完成" });
            notifyVbbProgress(i, ranges.length);
            maybeAutoDownloadVbbGif(vbbClips[i], i);
            refreshVbbClipRow(i);
            if (mobile && i < ranges.length - 1) {
              await new Promise((r) => setTimeout(r, hugeFile ? 180 : 80));
            }
          }
          setVbbProgress(true, 1, `完成 · ${ranges.length} 段`);
          toast(
            isVbbAutoDlEachEnabled()
              ? `已完成 ${ranges.length} 段 · 已逐个自动下载`
              : `已完成 ${ranges.length} 段 · 可逐条下载或打包`
          );
        } catch (err) {
          if (String(err?.message) !== "已取消") setError(vbbError, err.message || String(err));
          else toast("已取消");
          setVbbProgress(false, 0, "");
        } finally {
          vbbBusy = false;
          resetVbbAbort();
          if (vbbAbort) vbbAbort.hidden = true;
          setVbbButtons();
        }
      }
  
      // 目标时长（秒）：0=不压缩时长；源更长则加速到该时长内
      function vbbSpeedLimitSec() {
        try {
          if (!$("#vbb-speed-limit")?.checked) return 0;
          const sec = Number($("#vbb-speed-sec")?.value);
          if (!(sec > 0)) return 0;
          return Math.max(3, Math.min(120, sec));
        } catch (_) {
          return 0;
        }
      }

      /** 完成通知：按范围设置决定「每个」还是「仅全部完成」 */
      function notifyVbbProgress(index, total) {
        try {
          DN.unlockAudio?.(); // 长任务后音频常被挂起，响前再解锁一次
          if (DN.scope?.() === "done") {
            if (Number(index) >= Number(total) - 1) DN.notifyDone?.();
          } else {
            DN.notifyDone?.();
          }
        } catch (_) {}
      }

      /** 处理期间防息屏 + 首次点击解锁提示音，结束后释放 */
      function withVbbWake(fn) {
        try { DN.unlockAudio?.(); } catch (_) {}
        try { DN.acquire?.(); } catch (_) {}
        return Promise.resolve()
          .then(fn)
          .finally(() => {
            try { DN.release?.(); } catch (_) {}
          });
      }

      // ---- 自动裁剪纯色边框（视频版「去色边」） ----
      const vbbCropCache = new Map();

      function vbbAutoCropEnabled() {
        return Boolean($("#vbb-auto-crop")?.checked);
      }

      function vbbColorsNear(a, b, tol) {
        return Math.abs(a.r - b.r) <= tol && Math.abs(a.g - b.g) <= tol && Math.abs(a.b - b.b) <= tol;
      }

      /** 从一帧里估算纯色边框，返回保留区域（不含边框）；无边则 null
       *  四边各自独立判定：只有一边是纯色边也能裁掉。
       *  偏保守：容差收紧 + 离群更严 + 边色须像黑/白边（或对边同色），避免深色 UI 被当成边框吃掉。 */
      function detectFrameContentRect(img, tol) {
        const w = img.width;
        const h = img.height;
        const data = img.data;
        const px = (x, y) => {
          const i = (y * w + x) * 4;
          return { r: data[i], g: data[i + 1], b: data[i + 2] };
        };
        const near = (a, b) =>
          Math.abs(a.r - b.r) <= tol && Math.abs(a.g - b.g) <= tol && Math.abs(a.b - b.b) <= tol;
        const luma = (c) => 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
        /** 边色像黑边/白边，或与对边同色（灰底 letterbox）才裁，避免深色界面「整行纯色」误伤 */
        const looksLikeBorder = (c, opposite) => {
          if (!c) return false;
          const y = luma(c);
          if (y <= 30 || y >= 225) return true;
          return Boolean(opposite && near(c, opposite));
        };
        /** 该行/该列是否「纯色」，是则返回平均色，否则 null。
         *  离群 ≤1.2%：只吞压缩噪点，不把状态栏/细线当边框。 */
        const OUTLIER_RATIO = 0.012;
        const lineColor = (get, n) => {
          let r = 0;
          let g = 0;
          let b = 0;
          for (let i = 0; i < n; i++) {
            const p = get(i);
            r += p.r;
            g += p.g;
            b += p.b;
          }
          const avg = { r: r / n, g: g / n, b: b / n };
          const limit = Math.max(1, Math.floor(n * OUTLIER_RATIO));
          let bad = 0;
          for (let i = 0; i < n; i++) {
            if (!near(get(i), avg)) {
              bad += 1;
              if (bad > limit) return null;
            }
          }
          return avg;
        };
        const rowAt = (y) => (i) => px(i, y);
        const colAt = (x) => (i) => px(x, i);
        let top = 0;
        let bottom = h - 1;
        let left = 0;
        let right = w - 1;
        const cTop = lineColor(rowAt(0), w);
        const cBottom = lineColor(rowAt(h - 1), w);
        const cLeft = lineColor(colAt(0), h);
        const cRight = lineColor(colAt(w - 1), h);
        // 单边最多吃 18%：再深多半是内容区「碰巧纯色」，不是 letterbox
        const maxTop = Math.floor(h * 0.18);
        const maxBottom = Math.floor(h * 0.18);
        const maxLeft = Math.floor(w * 0.18);
        const maxRight = Math.floor(w * 0.18);
        if (looksLikeBorder(cTop, cBottom)) {
          while (top < bottom && top < maxTop) {
            const c = lineColor(rowAt(top), w);
            if (!c || !near(c, cTop)) break;
            top++;
          }
        }
        if (looksLikeBorder(cBottom, cTop)) {
          while (bottom > top && h - 1 - bottom < maxBottom) {
            const c = lineColor(rowAt(bottom), w);
            if (!c || !near(c, cBottom)) break;
            bottom--;
          }
        }
        if (looksLikeBorder(cLeft, cRight)) {
          while (left < right && left < maxLeft) {
            const c = lineColor(colAt(left), h);
            if (!c || !near(c, cLeft)) break;
            left++;
          }
        }
        if (looksLikeBorder(cRight, cLeft)) {
          while (right > left && w - 1 - right < maxRight) {
            const c = lineColor(colAt(right), h);
            if (!c || !near(c, cRight)) break;
            right--;
          }
        }
        // 回退 1px，避免贴齐内容抗锯齿被啃掉
        if (top > 0) top -= 1;
        if (bottom < h - 1) bottom += 1;
        if (left > 0) left -= 1;
        if (right < w - 1) right += 1;
        if (right <= left || bottom <= top) return null;
        if (top === 0 && left === 0 && right === w - 1 && bottom === h - 1) return null;
        return { left, top, right, bottom, w, h };
      }

      /** 采样多帧取「内容并集」（各边取最浅裁），只裁所有帧都同意是边框的区域；无边框返回 null */
      async function detectVideoCrop(file) {
        if (!file) return null;
        // v3：并集裁 + 更严边色，旧缓存会裁多，必须换 key
        const cacheKey = `v3|${file.name}|${file.size}|${file.lastModified || 0}`;
        if (vbbCropCache.has(cacheKey)) return vbbCropCache.get(cacheKey);
        let result = null;
        const url = URL.createObjectURL(file);
        const v = document.createElement("video");
        v.muted = true;
        v.playsInline = true;
        v.preload = "auto";
        v.src = url;
        try {
          await new Promise((resolve, reject) => {
            const to = setTimeout(() => reject(new Error("读取视频超时")), 30000);
            v.onloadeddata = () => { clearTimeout(to); resolve(); };
            v.onerror = () => { clearTimeout(to); reject(new Error("无法读取视频")); };
          });
          const vw = v.videoWidth || 0;
          const vh = v.videoHeight || 0;
          if (vw < 16 || vh < 16) throw new Error("视频尺寸无效");
          const cw = Math.min(360, vw);
          const ch = Math.max(1, Math.round(vh * (cw / vw)));
          const canvas = document.createElement("canvas");
          canvas.width = cw;
          canvas.height = ch;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          const dur = Number.isFinite(v.duration) ? v.duration : 0;
          const marks = dur > 0.6 ? [0.2, 0.5, 0.8].map((r) => Math.min(dur * r, Math.max(0, dur - 0.05))) : [0];
          let acc = null;
          let hits = 0;
          for (const t of marks) {
            await new Promise((resolve) => {
              if (Math.abs(v.currentTime - t) < 0.02) { resolve(); return; }
              const to = setTimeout(resolve, 8000);
              v.onseeked = () => { clearTimeout(to); resolve(); };
              try { v.currentTime = t; } catch (_) { clearTimeout(to); resolve(); }
            });
            ctx.drawImage(v, 0, 0, cw, ch);
            // tol 14：旧 24 在深色录屏里容易把导航栏/底栏当边框
            const rect = detectFrameContentRect(ctx.getImageData(0, 0, cw, ch), 14);
            if (!rect) continue;
            hits += 1;
            // 内容并集 = 各边取最小裁切量（任一帧有内容就保留）
            acc = acc
              ? {
                  left: Math.min(acc.left, rect.left),
                  top: Math.min(acc.top, rect.top),
                  right: Math.max(acc.right, rect.right),
                  bottom: Math.max(acc.bottom, rect.bottom),
                  w: rect.w,
                  h: rect.h,
                }
              : rect;
          }
          if (acc && hits > 0 && acc.right > acc.left && acc.bottom > acc.top) {
            const sx = vw / acc.w;
            const sy = vh / acc.h;
            const x = Math.max(0, Math.round(acc.left * sx));
            const y = Math.max(0, Math.round(acc.top * sy));
            let w = Math.round((acc.right - acc.left + 1) * sx);
            let h = Math.round((acc.bottom - acc.top + 1) * sy);
            if (x + w > vw) w = vw - x;
            if (y + h > vh) h = vh - y;
            // 至少裁掉 6 源像素才算有效，避免缩略图取整抖一下
            if (w >= 8 && h >= 8 && (w < vw - 6 || h < vh - 6)) result = { x, y, w, h };
          }
        } catch (_) {
          result = null;
        } finally {
          try { URL.revokeObjectURL(url); } catch (_) {}
          try { v.removeAttribute("src"); v.load(); } catch (_) {}
        }
        vbbCropCache.set(cacheKey, result);
        return result;
      }

      /** 按开关取裁剪矩形（关闭时 null） */
      async function vbbResolveCrop(file) {
        if (!vbbAutoCropEnabled()) return null;
        try {
          return await detectVideoCrop(file);
        } catch (_) {
          return null;
        }
      }

      // 把已选的多个视频按顺序拼接成一个 MP4，再走单段黑盒。
      // 含义：先合为一条成片，再整段黑盒（不是各转 GIF 再拼）。
      // 只要画面；中间片帧率对齐黑盒主档，避免双重抽帧顿挫。
      // 各段若做过「编辑」（裁时长/裁画面），拼接时一并带上。
      async function mergeVbbVideosToOne() {
        if (!isVbbBatchMode() || vbbBusy) return;
        abortVbb = false;
        vbbBusy = true;
        setVbbButtons();
        if (vbbAbort) vbbAbort.hidden = false;
        setError(vbbError, "");
        const items = vbbBatchFiles.slice();
        const total = items.length;
        const names = [];
        try {
          await prewarmFfmpegEngine().catch(() => {});
          const ffmpeg = await getFfmpegInstance();
          for (let i = 0; i < total; i++) {
            if (abortVbb) throw new Error("已取消");
            setVbbProgress(true, (i / total) * 0.45, `拼接 · 写入 ${i + 1}/${total}`, {
              sub: items[i].file.name,
              busy: true,
            });
            const ext = v2gSourceExt(items[i].file);
            const nm = `mj${i}.${ext}`;
            await ffmpeg.writeFile(nm, await fetchFileBytes(items[i].file));
            names.push(nm);
          }
          const W = Math.max(2, Math.round((items[0].srcW || 1280) / 2) * 2);
          const H = Math.max(2, Math.round((items[0].srcH || 720) / 2) * 2);
          const wins = items.map((item) => {
            ensureVbbItemEdit(item);
            const win = resolveVbbEncodeEdits(item, item.file, item.duration, item.srcW, item.srcH);
            const crop =
              win.edit?.cropOn && win.edit.crop
                ? typeof normalizeV2gCrop === "function"
                  ? normalizeV2gCrop(win.edit.crop, item.srcW, item.srcH)
                  : win.edit.crop
                : null;
            return { ...win, crop };
          });
          const totalSpan = wins.reduce((s, w) => s + Math.max(0, Number(w.span) || 0), 0);
          const mergeFps = Math.max(
            12,
            Math.min(30, Math.round(Number(typeof blackboxPrimaryFps === "function" ? blackboxPrimaryFps(totalSpan) : 20) || 20))
          );
          const vparts = names
            .map((_, i) => {
              const win = wins[i];
              const start = Math.max(0, Number(win.startSec) || 0);
              const span = Math.max(0.05, Number(win.span) || 0.05);
              const crop = win.crop
                ? `crop=${Math.max(2, win.crop.w)}:${Math.max(2, win.crop.h)}:${Math.max(0, win.crop.x)}:${Math.max(0, win.crop.y)},`
                : "";
              // 先按编辑裁时长/画面，再统一尺寸与帧率后 concat
              return (
                `[${i}:v]trim=start=${start}:duration=${span},setpts=PTS-STARTPTS,` +
                `${crop}scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
                `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p,fps=${mergeFps}[v${i}]`
              );
            })
            .join(";");
          const vlist = names.map((_, i) => `[v${i}]`).join("");
          const baseArgs = [];
          names.forEach((nm) => baseArgs.push("-i", nm));
          const filter = `${vparts};${vlist}concat=n=${total}:v=1:a=0[v]`;
          const args = [
            ...baseArgs,
            "-filter_complex",
            filter,
            "-map",
            "[v]",
            "-an",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            "-y",
            "merged.mp4",
          ];
          setVbbProgress(true, 0.5, `拼接编码中（${mergeFps}fps）…`, { busy: true });
          const code = await ffmpeg.exec(args).catch(() => 1);
          if (abortVbb) throw new Error("已取消");
          if (code !== 0) throw new Error(`拼接失败（code=${code}）`);
          const data = await ffmpeg.readFile("merged.mp4");
          const raw = data instanceof Uint8Array ? data : new Uint8Array(data);
          const bytes = new Uint8Array(raw.byteLength);
          bytes.set(raw);
          const blob = new Blob([bytes], { type: "video/mp4" });
          if (!blob.size) throw new Error("拼接结果为空");
          const mergedFile = new File([blob], `merged-${Date.now()}.mp4`, { type: "video/mp4" });
          setVbbProgress(true, 0.92, `拼接完成 · ${formatKb(blob.size)} · 开始转黑盒 GIF…`);
          vbbBusy = false;
          if (vbbAbort) vbbAbort.hidden = true;
          await loadVbbFile(mergedFile);
          toast("已拼接，开始生成黑盒 GIF…");
          await runVbbSingleBlackbox();
        } catch (err) {
          if (String(err?.message) !== "已取消") setError(vbbError, err.message || String(err));
          else toast("已取消");
          setVbbProgress(false, 0, "");
        } finally {
          try {
            for (const nm of names) await getFfmpegInstance().then((ff) => ff.deleteFile(nm)).catch(() => {});
            const ff = await getFfmpegInstance();
            await ff.deleteFile("merged.mp4");
          } catch (_) {}
          vbbBusy = false;
          resetVbbAbort();
          if (vbbAbort) vbbAbort.hidden = true;
          setVbbButtons();
        }
      }

      function isLikelyMemoryError(err) {
        const msg = String(err && (err.message || err) || "");
        return /memory|OOM|out of memory|Allocation failed|Array buffer allocation|Cannot allocate|oom/i.test(msg);
      }

      async function runVbbBatchBlackbox() {
        if (!isVbbBatchMode() || vbbBusy) return;
        persistActiveVbbMarks();
        abortVbb = false;
        vbbBusy = true;
        vbbSuppressGlobalProgress = true; // 只留卡片进度
        setVbbButtons();
        if (vbbAbort) vbbAbort.hidden = false;
        setError(vbbError, "");
        clearVbbResults();
        /** @type {{ item: any, startSec: number, span: number, edit: any, sourceName: string, fromMark: boolean }[]} */
        const jobs = [];
        vbbBatchFiles.forEach((item) => {
          ensureVbbItemEdit(item);
          const marks = completeMarksList(item.marks);
          if (vbbWorkflow === "manual" && marks.length) {
            marks.forEach((m, mi) => {
              jobs.push({
                item,
                startSec: m.start,
                span: Math.max(VBB_MIN_SPAN, m.end - m.start),
                edit: item.edit,
                sourceName: `${vbbGifBaseName(item.file)}-${String(mi + 1).padStart(2, "0")}`,
                fromMark: true,
              });
            });
            return;
          }
          const win = resolveVbbEncodeEdits(item, item.file, item.duration, item.srcW, item.srcH);
          jobs.push({
            item,
            startSec: win.startSec,
            span: win.span,
            edit: win.edit,
            sourceName: vbbGifBaseName(item.file),
            fromMark: false,
          });
        });
        const total = jobs.length;
        if (!total) {
          vbbBusy = false;
          vbbSuppressGlobalProgress = false;
          if (vbbAbort) vbbAbort.hidden = true;
          setVbbButtons();
          toast("没有可转换的片段");
          return;
        }
        vbbClips = jobs.map((job) => ({
          start: job.startSec,
          span: job.span,
          sourceName: job.sourceName,
          sourceFile: job.item.file.name || "video",
          gifBlob: null,
          gifUrl: "",
          gifNote: "",
          gifDuration: 0,
          error: "",
          jobStatus: "pending",
          jobProgress: 0,
          jobText: "等待中…",
        }));
        renderVbbResults();
        let ok = 0;
        let doneCount = 0;
        const finishedIdx = new Set();
        // 沿用成功方案(fps/宽)：时长一致(±0.08s)时复用；并行时靠 span 缓存共享
        let reuseSeed = null;
        const pool = [];
        let conc = 1;
        try {
          await prewarmFfmpegEngine().catch(() => {});
          conc = resolveBatchConcurrency(total);
          // 旗舰/桌面：预开 N 路独立 FFmpeg Worker；gifski/gifsicle 仍上锁串行
          if (conc > 1 && typeof createFfmpegInstance === "function") {
            try {
              for (let s = 0; s < conc; s++) {
                if (abortVbb) throw new Error("已取消");
                pool.push(await createFfmpegInstance());
              }
              toast(`并行 ${conc} 路转换 · ${currentMediaPerf().label}`);
              vbbLog(`[vbb] batch parallel concurrency=${conc} total=${total}`);
            } catch (err) {
              vbbLog(`[vbb] parallel pool fail → serial: ${err?.message || err}`);
              while (pool.length) {
                try {
                  destroyFfmpegInstance?.(pool.pop());
                } catch (_) {}
              }
              conc = 1;
              toast("并行引擎启动失败 · 改为逐个转换");
            }
          }

          const encodeOne = async (i, ffmpegLease) => {
            if (abortVbb) throw new Error("已取消");
            const job = jobs[i];
            const item = job.item;
            setVbbClipJob(i, { status: "running", progress: 0.02, text: conc > 1 ? `并行编码…` : "准备编码…" });
              const win = { startSec: job.startSec, span: job.span, edit: job.edit };
              const cachedSeed = loadVbbSpanScheme(win.span, vbbSpeedFactorForSpan(win.span));
              const seedForItem =
                cachedSeed ||
                (reuseSeed && Math.abs((Number(reuseSeed.span) || 0) - (Number(win.span) || 0)) < 0.08
                  && Math.abs((Number(reuseSeed.speed) || 1) - vbbSpeedFactorForSpan(win.span)) < 0.05
                  ? reuseSeed
                  : null);
              const t0 = performance.now();
              const usedSeed = Boolean(seedForItem);
              try {
                // 串行才重启单例：并行用租赁实例，避免互踢
                if (conc <= 1 && i > 0 && !ffmpegLease) {
                  try {
                    terminateFfmpegInstance({ revokeAssets: false });
                  } catch (_) {}
                  await new Promise((r) => setTimeout(r, 50));
                }
                const vbbCrop = await resolveVbbEncodeCrop(item.file, win.edit, item.srcW, item.srcH);
                const encoded = await encodeBlackboxClip({
                  file: item.file,
                  startSec: win.startSec,
                  span: win.span,
                  srcW: item.srcW,
                  srcH: item.srcH,
                  seed: seedForItem,
                  speedLimitSec: vbbSpeedLimitSec(),
                  crop: vbbCrop,
                  ffmpeg: ffmpegLease || null,
                  isAborted: () => abortVbb,
                  onProgress: (local, text) => {
                    const stage = vbbTickerLine(text) || (conc > 1 ? "并行编码" : "编码");
                    setVbbClipJob(i, {
                      status: "running",
                      progress: Math.min(0.98, 0.05 + Math.min(0.9, local) * 0.9),
                      text: stage,
                    });
                    const overall = (doneCount + Math.min(0.95, Number(local) || 0)) / total;
                    setVbbProgress(true, overall, `批量转换 · ${doneCount}/${total}${conc > 1 ? ` · ${conc}路` : ""}`, {
                      sub: item.file.name,
                      busy: true,
                    });
                  },
                });
                if (abortVbb) throw new Error("已取消");
                applyVbbClipEncoded(vbbClips[i], encoded);
                if (encoded && encoded.fps) {
                  reuseSeed = {
                    fps: encoded.fps,
                    maxW: encoded.maxW,
                    span: win.span,
                    speed: Math.max(1, Number(encoded.speed) || 1),
                  };
                  saveVbbSpanScheme(win.span, reuseSeed, "blackbox");
                }
                const elapsedSec = (performance.now() - t0) / 1000;
                const editBits = [];
                if (job.fromMark) editBits.push("打点");
                if (win.startSec > 0.05 || Math.abs(win.span - item.duration) > 0.05) {
                  editBits.push(`裁 ${win.span.toFixed(1)}s`);
                }
                if (win.edit?.cropOn) editBits.push("裁画面");
                vbbClips[i].gifNote = [
                  vbbClips[i].gifNote,
                  ...editBits,
                  encoded.speed > 1 ? `加速${Number(encoded.speed).toFixed(1)}×` : "",
                  conc > 1 ? `${conc}路并行` : "",
                  `耗时${elapsedSec.toFixed(1)}s${usedSeed ? "·沿用" : ""}`,
                ]
                  .filter(Boolean)
                  .join(" · ");
                setVbbClipJob(i, { status: "done", progress: 1, text: "完成" });
                notifyVbbProgress(i, total);
                ok += 1;
                maybeAutoDownloadVbbGif(vbbClips[i], i);
                refreshVbbClipRow(i);
                vbbLog(
                  `[vbb] #${i + 1} ${usedSeed ? "seed" : "ladder"} ${Math.round(elapsedSec * 1000)}ms · ${encoded.fps}FPS · ${encoded.outW}×${encoded.outH} · ${formatKb(encoded.blob.size)} · ${encoded.compressRounds || 0}轮 · conc=${conc}`
                );
                return { ok: true };
            } catch (err) {
              if (String(err?.message) === "已取消") throw err;
              const elapsedSec = (performance.now() - t0) / 1000;
              vbbLog(`[vbb] #${i + 1} FAIL ${Math.round(elapsedSec * 1000)}ms · ${err?.message || err}`);
              vbbClips[i].error = err.message || String(err);
              setVbbClipJob(i, { status: "error", progress: 0, text: "失败" });
              refreshVbbClipRow(i);
              return { ok: false, memory: isLikelyMemoryError(err), err };
            } finally {
              if (!finishedIdx.has(i)) {
                finishedIdx.add(i);
                doneCount += 1;
              }
              setVbbProgress(true, doneCount / total, `批量转换 · ${doneCount}/${total}${conc > 1 ? ` · ${conc}路` : ""}`, {
                busy: doneCount < total,
              });
            }
          };

          if (conc <= 1) {
            for (let i = 0; i < total; i++) {
              if (abortVbb) throw new Error("已取消");
              await encodeOne(i, null);
            }
          } else {
            let nextIdx = 0;
            let forceSerialRest = false;
            const workers = Array.from({ length: conc }, (_, slot) =>
              (async () => {
                const lease = pool[slot] || null;
                while (true) {
                  if (abortVbb) throw new Error("已取消");
                  if (forceSerialRest) return;
                  const i = nextIdx++;
                  if (i >= total) return;
                  const result = await encodeOne(i, lease);
                  // 并行中途 OOM：停掉后续并行，剩余改串行（本 worker 退出；主流程再扫失败项）
                  if (result && result.memory) {
                    forceSerialRest = true;
                    vbbLog(`[vbb] parallel OOM at #${i + 1} → stop new parallel work`);
                    return;
                  }
                }
              })()
            );
            await Promise.all(workers);
            // 若 OOM 中断：对仍 pending 的条目串行补跑
            if (forceSerialRest) {
              toast("内存紧张 · 剩余改为逐个转换");
              while (pool.length) {
                try {
                  destroyFfmpegInstance?.(pool.pop());
                } catch (_) {}
              }
              conc = 1;
              for (let i = 0; i < total; i++) {
                if (abortVbb) throw new Error("已取消");
                if (vbbClips[i]?.gifBlob || vbbClips[i]?.jobStatus === "done") continue;
                if (vbbClips[i]?.error && !isLikelyMemoryError({ message: vbbClips[i].error })) continue;
                // 内存失败或未跑的：清错重试
                vbbClips[i].error = "";
                finishedIdx.delete(i);
                setVbbClipJob(i, { status: "pending", progress: 0, text: "串行补跑…" });
                await encodeOne(i, null);
              }
            }
          }

          if (abortVbb) throw new Error("已取消");
          renderVbbResults();
          setVbbProgress(true, 1, `批量完成 · ${ok}/${total}`);
          if (ok > 0) {
            const autoDl = isVbbAutoDlEachEnabled();
            toast(
              ok === total
                ? autoDl
                  ? `批量完成 · ${ok} 个 · 已逐个自动下载（仍可合并/打包）`
                  : `批量完成 · ${ok} 个 · 可在下方逐条下载或点「打包下载」`
                : autoDl
                  ? `批量完成 · 成功 ${ok}/${total} · 成功项已自动下载`
                  : `批量完成 · 成功 ${ok}/${total} · 可在下方逐条下载或点「打包下载」`
            );
          } else {
            throw new Error("全部转换失败，请查看各条错误信息");
          }
        } catch (err) {
          if (String(err?.message) !== "已取消") setError(vbbError, err.message || String(err));
          else toast("已取消");
          setVbbProgress(false, 0, "");
        } finally {
          while (pool.length) {
            try {
              destroyFfmpegInstance?.(pool.pop());
            } catch (_) {}
          }
          vbbBusy = false;
          vbbSuppressGlobalProgress = false;
          resetVbbAbort();
          if (vbbAbort) vbbAbort.hidden = true;
          setVbbButtons();
        }
      }

        async function runVbbSingleBlackbox() {
          if (!vbbSourceFile || !vbbVideo?.src || vbbBusy) return;
          const duration = Number(vbbVideo.duration) || 0;
          if (!(duration >= VBB_MIN_SPAN)) throw new Error(`视频太短，至少约 ${VBB_MIN_SPAN} 秒`);
          const srcW = vbbVideo.videoWidth || 0;
          const srcH = vbbVideo.videoHeight || 0;
          if (!vbbSingleEdit) vbbSingleEdit = makeVbbEditState(duration, srcW, srcH);
          const win = resolveVbbEncodeEdits({ edit: vbbSingleEdit, duration, srcW, srcH }, vbbSourceFile, duration, srcW, srcH);
          abortVbb = false;
          vbbBusy = true;
          vbbSuppressGlobalProgress = true; // 只留卡片进度
          setVbbButtons();
        if (vbbAbort) vbbAbort.hidden = false;
        setError(vbbError, "");
        clearVbbResults();
        vbbClips = [
          {
            start: win.startSec,
            span: win.span,
            sourceName: vbbGifBaseName(vbbSourceFile),
            gifBlob: null,
            gifUrl: "",
            gifNote: "",
            gifDuration: 0,
            error: "",
            jobStatus: "pending",
            jobProgress: 0,
            jobText: "等待中…",
          },
        ];
        renderVbbResults();
        const durationLabel = `${win.span.toFixed(1)}s`;
        try {
          await prewarmFfmpegEngine().catch(() => {});
          bumpVbbEncodeProgress(0.03, "整段转换", "准备编码器…");
          setVbbClipJob(0, { status: "running", progress: 0.02, text: "准备编码…" });
          const vbbCrop = await resolveVbbEncodeCrop(vbbSourceFile, win.edit, srcW, srcH);
          const encoded = await encodeBlackboxClip({
            file: vbbSourceFile,
            startSec: win.startSec,
            span: win.span,
            srcW,
            srcH,
            speedLimitSec: vbbSpeedLimitSec(),
            crop: vbbCrop,
            isAborted: () => abortVbb,
            onProgress: (local, text) => {
              const p = Math.min(0.98, 0.05 + Math.min(0.93, local) * 0.93);
              const stage = bumpVbbEncodeProgress(p, "整段转换", text);
              setVbbClipJob(0, {
                status: "running",
                progress: Math.min(0.98, 0.08 + Math.min(0.9, local) * 0.9),
                text: stage,
              });
            },
          });
          if (abortVbb) throw new Error("已取消");
          applyVbbClipEncoded(vbbClips[0], encoded);
          const editBits = [];
          if (win.startSec > 0.05 || Math.abs(win.span - duration) > 0.05) editBits.push(`裁 ${win.span.toFixed(1)}s`);
          if (win.edit?.cropOn) editBits.push("裁画面");
          vbbClips[0].gifNote = [
            vbbClips[0].gifNote,
            ...editBits,
            encoded.speed > 1 ? `加速${Number(encoded.speed).toFixed(1)}×` : "",
          ]
            .filter(Boolean)
            .join(" · ");
          setVbbClipJob(0, { status: "done", progress: 1, text: "完成" });
          notifyVbbProgress(0, 1);
          maybeAutoDownloadVbbGif(vbbClips[0], 0);
          refreshVbbClipRow(0);
          const doneBits = [
            formatKb(encoded.blob.size),
            encoded.fps ? `${encoded.fps} FPS` : "",
            encoded.outW && encoded.outH ? `${encoded.outW}×${encoded.outH}` : "",
          ].filter(Boolean);
          setVbbProgress(true, 1, `完成 · ${doneBits.join(" · ")}`, { sub: `时长 ${durationLabel}` });
          toast(
            isVbbAutoDlEachEnabled()
              ? `已完成 · ${formatKb(encoded.blob.size)} · 已自动下载`
              : `已完成 · ${formatKb(encoded.blob.size)} · 可点下方「下载 GIF」`
          );
        } catch (err) {
          if (String(err?.message) !== "已取消") setError(vbbError, err.message || String(err));
          else toast("已取消");
          setVbbProgress(false, 0, "");
        } finally {
          vbbBusy = false;
          vbbSuppressGlobalProgress = false;
          resetVbbAbort();
          if (vbbAbort) vbbAbort.hidden = true;
          setVbbButtons();
        }
      }

      async function runVbbOneClick() {
        if (vbbBusy) return;
        if (isVbbBatchMode()) {
          await runVbbBatchBlackbox().catch((err) => setError(vbbError, err.message || String(err)));
          return;
        }
        if (!vbbSourceFile) return;
        if (isVbbSplitMode()) {
          toast("长视频切片请先「分析切分方案」，确认后再「按方案生成 GIF」");
          return;
        }
        if (vbbWorkflow === "single") {
          await runVbbSingleBlackbox().catch((err) => setError(vbbError, err.message || String(err)));
          return;
        }
        if (vbbWorkflow === "manual") {
          await runVbbManualBlackbox().catch((err) => setError(vbbError, err.message || String(err)));
        }
      }
  
      async function runVbbAnalyze() {
        if (!vbbSourceFile || !vbbVideo?.src || vbbBusy) return;
        abortVbb = false;
        vbbBusy = true;
        setVbbButtons();
        if (vbbAbort) vbbAbort.hidden = false;
        setError(vbbError, "");
        clearVbbResults();
        try {
          const duration = Number(vbbVideo.duration) || 0;
          if (!(duration >= VBB_MIN_SPAN)) throw new Error(`视频太短，至少约 ${VBB_MIN_SPAN} 秒`);
          const srcW = vbbVideo.videoWidth || 0;
          const srcH = vbbVideo.videoHeight || 0;
          const sampleSpan = Math.min(VBB_SAMPLE_SPAN, Math.max(VBB_MIN_SPAN, duration));
          const sampleStart = Math.max(0, Math.min(Math.max(0, duration - sampleSpan), duration * 0.4));
          setVbbProgress(true, 0.08, "分析样片", {
            sub: `${sampleSpan.toFixed(1)}s`,
            busy: true,
          });
          if (vbbMeta) vbbMeta.textContent = `分析中 · 样片 ${sampleSpan.toFixed(1)}s…`;
          await prewarmFfmpegEngine().catch(() => {});
          const sample = await encodeBlackboxGif({
            file: vbbSourceFile,
            fps: 15,
            maxW: V2G_BLACKBOX_BASE_W,
            quality: V2G_BLACKBOX_QUALITY,
            startSec: sampleStart,
            span: sampleSpan,
            srcW,
            srcH,
            skipWatermark: true,
            skipBright: true,
            brightness: 0,
            isAborted: () => abortVbb,
            stageLabel: "样片",
            onProgress: (local, text) => {
              const pct = 0.08 + Math.min(0.82, local * 0.82);
              setVbbProgress(true, pct, "分析样片", {
                sub: vbbTickerLine(text) || `${sampleSpan.toFixed(1)}s`,
                busy: true,
              });
              if (vbbMeta) vbbMeta.textContent = `分析中 · ${vbbTickerLine(text) || "样片"}`;
            },
          });
          if (abortVbb) throw new Error("已取消");
          if (!sample?.blob?.size) throw new Error("样片编码失败");
          const bps15 = sample.blob.size / Math.max(0.5, sample.span || sampleSpan);
          const clarityMax = Math.max(
            VBB_MIN_SPAN,
            Math.min(VBB_CLARITY_MAX_SPAN, (V2G_BLACKBOX_MAX_BYTES * VBB_CLARITY_FILL) / bps15)
          );
          const durationMax = Math.max(
            clarityMax,
            Math.min(
              VBB_DURATION_MAX_SPAN,
              (V2G_BLACKBOX_MAX_BYTES * 0.92) / Math.max(1, bps15 * (10 / 15) * 0.55)
            )
          );
          const clarity = makeVbbPlanVariant(
            "clarity",
            "清晰优先",
            duration,
            clarityMax,
            bps15,
            `宽420 · 贴紧${blackboxBudgetLabel()} · 不压缩`,
            { encode: "clarity", maxW: V2G_BLACKBOX_BASE_W, srcW }
          );
          const sharp = makeSharpPlan(duration, bps15, srcW, clarityMax);
          const durationPlan = makeVbbPlanVariant(
            "duration",
            "时长优先",
            duration,
            durationMax,
            bps15,
            "可降帧/压缩 · 段更长、段数更少",
            { encode: "blackbox", maxW: V2G_BLACKBOX_BASE_W, srcW }
          );
          vbbAnalysis = {
            duration,
            srcW,
            srcH,
            bps15,
            sampleBytes: sample.blob.size,
            sampleSpan: sample.span || sampleSpan,
            clarityMax,
            durationMax,
            clarity,
            sharp,
            durationPlan,
            active: null,
          };
          if (vbbTargetSpan) vbbTargetSpan.value = String(Number(clarity.maxSpan.toFixed(1)));
          if (vbbTargetRange) vbbTargetRange.value = vbbTargetSpan.value;
          vbbSegmentTarget = clarity.maxSpan;
          vbbMode = "duration";
          paintVbbPlan();
          setVbbProgress(
            true,
            1,
            `分析完成 · ${formatKb(sample.blob.size)} / ${vbbAnalysis.sampleSpan.toFixed(1)}s`
          );
          toast(`分析完成 · 默认 ${durationPlan.count} 段 · 可调整方案后点「② 按方案生成 GIF」`);
          if (isLikelyMobileBrowser() && (duration >= 90 || (vbbSourceFile?.size || 0) >= 200 * 1024 * 1024)) {
            toast("大视频在手机上易内存不足。已优化分段写入；仍建议少段处理或用电脑。");
          }
        } catch (err) {
          if (String(err && err.message) !== "已取消") setError(vbbError, err.message || String(err));
          else toast("已取消分析");
          if (String(err && err.message) === "已取消") setVbbProgress(false, 0, "");
        } finally {
          vbbBusy = false;
          resetVbbAbort();
          if (vbbAbort) vbbAbort.hidden = true;
          setVbbButtons();
        }
      }
  
      async function runVbbExecute() {
        const plan = resolveActiveVbbPlan();
        if (!vbbSourceFile || !plan?.ranges?.length || vbbBusy) return;
        vbbAnalysis.active = plan;
        abortVbb = false;
        vbbBusy = true;
        setVbbButtons();
        if (vbbAbort) vbbAbort.hidden = false;
        setError(vbbError, "");
        clearVbbResults();
        const srcW = vbbVideo?.videoWidth || vbbAnalysis?.srcW || 0;
        const srcH = vbbVideo?.videoHeight || vbbAnalysis?.srcH || 0;
        const isAborted = () => abortVbb;
        const mobile = isLikelyMobileBrowser();
        const fileBytes = vbbSourceFile?.size || 0;
        const hugeFile = fileBytes >= 120 * 1024 * 1024;
        const longJob = (vbbAnalysis?.duration || 0) >= 90 || plan.ranges.length >= 8 || hugeFile;
        if (mobile && longJob) {
          toast(
            hugeFile
              ? "源视频较大：已改为整片只写入一次并按段抽取，仍可能因内存不足失败。"
              : "视频较长：手机可能因内存不足白屏。已改为按需预览；建议分段处理或用电脑。"
          );
        }
        try {
          await prewarmFfmpegEngine().catch(() => {});
          // 大文件先写入一次，后续片段复用，避免每段再 arrayBuffer 整文件
          if (hugeFile || plan.ranges.length >= 4) {
            try {
              const ff = await getFfmpegInstance();
              await ensureFfmpegInputWritten(ff, vbbSourceFile, () => {});
            } catch (_) {}
          }
          let firstSeed = null;
          vbbClips = plan.ranges.map((r) => ({
            start: r.start,
            span: r.span,
            gifBlob: null,
            gifUrl: "",
            gifNote: "",
            gifDuration: 0,
            error: "",
            jobStatus: "pending",
            jobProgress: 0,
            jobText: "等待中…",
          }));
          renderVbbResults();
          const vbbCrop = await vbbResolveCrop(vbbSourceFile);
          for (let i = 0; i < plan.ranges.length; i++) {
            if (abortVbb) throw new Error("已取消");
            const r = plan.ranges[i];
            const clip = vbbClips[i];
            const reuse = resolveVbbSegmentReuse(
              plan.ranges,
              i,
              firstSeed,
              plan.encode,
              vbbSpeedFactorForSpan(r.span)
            );
            const reuseSeed = reuse.seed;
            const activeEncode = reuse.fromCache && reuse.encode ? reuse.encode : plan.encode;
            const isWide = activeEncode === "clarity" || activeEncode === "sharp";
            const encodeTag = activeEncode === "sharp" ? "锐度" : activeEncode === "clarity" ? "清晰" : "";
            const clipLine = (extra = {}) =>
              vbbClipProgressLine(i, plan.ranges.length, {
                reuse: Boolean(reuse.fromCache || (reuseSeed && i > 0)),
                ...extra,
              });
            const timeRange = `${formatVbbClock(r.start)}–${formatVbbClock(r.start + r.span)}`;
            const mainLine = () => (encodeTag ? `${clipLine()} · ${encodeTag}` : clipLine());
            const bumpProgress = (localP, sub = timeRange) =>
              setVbbProgress(true, (i + localP) / plan.ranges.length, mainLine(), { sub, busy: true });
            setVbbClipJob(i, { status: "running", progress: 0.02, text: encodeTag ? `${encodeTag}…` : "编码…" });
            setVbbProgress(true, i / plan.ranges.length, mainLine(), { sub: timeRange, busy: true });
            try {
              let encoded;
              let usedFallback = false;
              let usedWidth = reuseSeed && !reuseSeed.usedFallback
                ? reuseSeed.maxW
                : plan.maxW || V2G_BLACKBOX_BASE_W;
              if (isWide && !(reuseSeed && reuseSeed.usedFallback)) {
                const tryEncodeWide = async (maxW, localBase, localSpan) =>
                  encodeBlackboxGif({
                    file: vbbSourceFile,
                    fps: reuseSeed?.fps || 15,
                    maxW,
                    quality: V2G_BLACKBOX_QUALITY,
                    startSec: r.start,
                    span: r.span,
                    srcW,
                    srcH,
                    speed: vbbSpeedFactorForSpan(r.span),
                    crop: vbbCrop,
                    skipWatermark: true,
                    skipBright: true,
                    brightness: 0,
                    isAborted,
                    stageLabel: `#${i + 1}`,
                    onProgress: (local, text) => {
                      const p = localBase + Math.min(1, local) * localSpan;
                      const stage = vbbTickerLine(text) || `宽${maxW}`;
                      setVbbClipJob(i, { status: "running", progress: Math.min(0.98, p), text: stage });
                      bumpProgress(p, stage);
                    },
                  });
  
                encoded = await tryEncodeWide(usedWidth, 0, 0.55);
                if (!encoded?.blob) throw new Error("未产出 GIF");
                encoded = { ...encoded, compressRounds: encoded.compressRounds || 0, maxW: usedWidth };
                while (encoded?.blob?.size > V2G_BLACKBOX_MAX_BYTES && usedWidth > V2G_BLACKBOX_BASE_W) {
                  usedWidth = Math.max(V2G_BLACKBOX_BASE_W, usedWidth - V2G_BLACKBOX_WIDTH_STEP);
                  setVbbClipJob(i, { status: "running", progress: 0.55, text: `降宽 ${usedWidth}` });
                  bumpProgress(0.55, `降宽 ${usedWidth}`);
                  encoded = await tryEncodeWide(usedWidth, 0.55, 0.25);
                  encoded = { ...encoded, compressRounds: 0, maxW: usedWidth };
                }
                if (reuseSeed && encoded?.blob?.size < V2G_BLACKBOX_WIDEN_BYTES && encoded?.blob?.size <= V2G_BLACKBOX_MAX_BYTES) {
                  const hardMax = srcW > 0 ? srcW : V2G_BLACKBOX_WIDTH_HARD_FALLBACK;
                  let nextW = usedWidth + V2G_BLACKBOX_WIDTH_STEP;
                  while (nextW <= hardMax) {
                    if (isAborted()) throw new Error("已取消");
                    const wider = await tryEncodeWide(nextW, 0.72, 0.15);
                    if (wider?.blob?.size > V2G_BLACKBOX_MAX_BYTES) break;
                    encoded = { ...wider, compressRounds: 0, maxW: nextW };
                    usedWidth = nextW;
                    if (encoded.outW > 0 && encoded.outW < nextW - 2) break;
                    nextW += V2G_BLACKBOX_WIDTH_STEP;
                  }
                }
                if (encoded?.blob?.size > V2G_BLACKBOX_MAX_BYTES) {
                  setVbbClipJob(i, { status: "running", progress: 0.8, text: "超限压缩…" });
                  bumpProgress(0.8, "超限压缩");
                  encoded = await encodeBlackboxClip({
                    file: vbbSourceFile,
                    startSec: r.start,
                    span: r.span,
                    srcW,
                    srcH,
                    isAborted,
                    seed: reuseSeed || null,
                    speedLimitSec: vbbSpeedLimitSec(),
                    crop: vbbCrop,
                    onProgress: (local, text) => {
                      const p = 0.8 + Math.min(0.18, local) * 0.18;
                      const stage = vbbTickerLine(text) || "压缩";
                      setVbbClipJob(i, { status: "running", progress: Math.min(0.98, p), text: stage });
                      bumpProgress(p, stage);
                    },
                  });
                  usedFallback = true;
                }
              } else {
                encoded = await encodeBlackboxClip({
                  file: vbbSourceFile,
                  startSec: r.start,
                  span: r.span,
                  srcW,
                  srcH,
                  isAborted,
                  seed: reuseSeed || null,
                  speedLimitSec: vbbSpeedLimitSec(),
                  crop: vbbCrop,
                  onProgress: (local, text) => {
                    const p = Math.min(0.98, Number(local) || 0);
                    const stage = vbbTickerLine(text) || "编码…";
                    setVbbClipJob(i, { status: "running", progress: p, text: stage });
                    bumpProgress(p, stage);
                  },
                });
                if (reuseSeed?.usedFallback) usedFallback = true;
                if (encoded?.maxW) usedWidth = encoded.maxW;
              }
              if (!encoded?.blob) throw new Error("未产出 GIF");
              if (encoded.blob.size > V2G_BLACKBOX_MAX_BYTES) {
                throw new Error(`仍超 ${blackboxBudgetLabel()}（${formatKb(encoded.blob.size)}）`);
              }
              attachVbbEncodedMeta(clip, encoded);
              // 延迟创建 ObjectURL：列表默认不解码预览
              clip.gifUrl = "";
              const bits = [];
              if (reuse.fromCache) bits.push("沿用方案");
              else if (reuseSeed) bits.push("沿用#01");
              if (usedFallback) bits.push("超限");
              else if (isWide && usedWidth !== (plan.maxW || V2G_BLACKBOX_BASE_W)) bits.push(`已降宽${usedWidth}`);
              if (encoded.fps) bits.push(`${encoded.playbackFps || encoded.fps}FPS`);
              if (encoded.outW && encoded.outH) bits.push(`${encoded.outW}×${encoded.outH}`);
              if (encoded.compressRounds > 0) bits.push(`已压 ${encoded.compressRounds} 轮`);
              if (encoded.maxW) bits.push(`宽≤${encoded.maxW}`);
              else if (isWide && !usedFallback) bits.push(`宽≤${usedWidth}`);
              if (encoded.framesCapped) bits.push(`已抽稀 ${encoded.frameCount} 帧`);
              clip.gifBlob = encoded.blob;
              clip.gifNote = bits.join(" · ");
              clip.error = "";
              if (i === 0) firstSeed = snapshotVbbEncodeSeed(encoded, { usedWidth, usedFallback });
              saveVbbSpanScheme(
                r.span,
                snapshotVbbEncodeSeed(encoded, { usedWidth, usedFallback }),
                usedFallback ? "blackbox" : activeEncode
              );
              setVbbClipJob(i, {
                status: "done",
                progress: 1,
                text: "完成",
              });
              notifyVbbProgress(i, plan.ranges.length);
              maybeAutoDownloadVbbGif(clip, i);
            } catch (err) {
              if (String(err && err.message) === "已取消") throw err;
              clip.error = err.message || String(err);
              setVbbClipJob(i, { status: "error", progress: 1, text: "失败" });
            }
            // 只刷新列表元数据，不自动展开全部预览
            refreshVbbClipRow(i);
            // 让出主线程，便于 Safari 回收临时内存
            const pauseMs = mobile ? (hugeFile ? 220 : 120) : 16;
            await new Promise((r) => setTimeout(r, pauseMs));
            const recycleEvery = mobile ? (hugeFile ? 1 : 2) : hugeFile ? 2 : 4;
            if ((i + 1) % recycleEvery === 0 && i < plan.ranges.length - 1) {
              try {
                terminateFfmpegInstance({ revokeAssets: false });
              } catch (_) {}
              await new Promise((r) => setTimeout(r, mobile ? 160 : 40));
              await prewarmFfmpegEngine().catch(() => {});
              try {
                const ff = await getFfmpegInstance();
                await ensureFfmpegInputWritten(ff, vbbSourceFile, () => {});
              } catch (_) {}
            }
          }
          const gifs = vbbClips.map((c, i) => ({ c, i })).filter((x) => x.c.gifBlob);
          const failN = vbbClips.filter((c) => c.error || !c.gifBlob).length;
          setVbbProgress(true, 1, `完成 · 成功 ${gifs.length}/${vbbClips.length}`);
          clearVbbClipJobs();
          renderVbbResults();
          setVbbButtons();
          if (gifs.length) {
            if (isAutoPackZipEnabled()) {
              await packDownloadVbbGifs({ auto: true });
              toast(
                failN
                  ? `完成，${failN} 段有问题 · 已打包下载 GIF`
                  : `已生成 ${gifs.length} 个 GIF · 已打包下载（可点「预览」查看）`
              );
            } else {
              toast(
                failN
                  ? `完成，${failN} 段有问题 · 可点「打包下载全部 GIF」`
                  : `已生成 ${gifs.length} 个 GIF · 可点「打包下载全部 GIF」预览后自行打包`
              );
            }
            if (typeof maybeAutoShareGallery === "function") {
              await maybeAutoShareGallery(
                gifs.map((x) => ({ name: vbbGifDownloadName(x.c, x.i), blob: x.c.gifBlob })),
                { zipName: "blackbox-clips.zip", title: "黑盒 GIF", zipBlobs }
              );
            }
          } else {
            toast(failN ? `完成，${failN} 段有问题` : "未生成 GIF");
          }
        } catch (err) {
          if (String(err && err.message) !== "已取消") setError(vbbError, err.message || String(err));
          else toast("已取消");
          clearVbbClipJobs();
          renderVbbResults();
        } finally {
          vbbBusy = false;
          resetVbbAbort();
          if (vbbAbort) vbbAbort.hidden = true;
          setVbbButtons();
        }
      }
  
      async function runVbbMerge() {
        const blobs = vbbClips.map((c) => c.gifBlob).filter(Boolean);
        if (vbbBusy) return;
        if (blobs.length < 2) {
          // 原来是静默 return，点了像没反应 → 给出明确提示
          toast("至少要 2 条已生成的 GIF 才能合并");
          setError(vbbError, "至少要 2 条已生成的 GIF 才能合并");
          return;
        }
        vbbBusy = true;
        setVbbButtons();
        setError(vbbError, "");
        hideVbbMergedBlock();
        try {
          let blob = await mergeGifBlobs(blobs, (ratio, text) =>
            setVbbProgress(true, ratio * 0.55, "合并 GIF", { sub: text, busy: ratio < 1 })
          );
          const mergedBefore = blob.size;
          let compressRounds = 0;
          if (blob.size > V2G_BLACKBOX_MAX_BYTES) {
            setVbbProgress(true, 0.58, "超限压缩", { busy: true });
            const compressed = await M.compressExistingGifToBlackbox(blob, (ratio, text) =>
              setVbbProgress(true, 0.58 + ratio * 0.4, "压缩", { sub: vbbTickerLine(text), busy: ratio < 1 })
            , () => abortVbb);
            blob = compressed.blob;
            compressRounds = compressed.compressRounds || 0;
            if (!compressed.ok || blob.size > V2G_BLACKBOX_MAX_BYTES) {
              setError(
                vbbError,
                `合并后仍超 ${blackboxBudgetLabel()}（${formatKb(blob.size)}）· 已压 ${compressRounds} 轮，未提供下载。建议减少段数或缩短片段`
              );
              setVbbProgress(true, 1, `合并失败 · 仍超 ${blackboxBudgetLabel()}`);
              toast(`合并失败：仍超 ${blackboxBudgetLabel()}（${formatKb(blob.size)}）`);
              return;
            }
          }
          showVbbMergedBlock(blob, {
            beforeSize: mergedBefore,
            compressRounds,
            downloadName: "blackbox-merged.gif",
          });
          setVbbProgress(true, 1, `合并完成 · ${formatKb(blob.size)} · ≤${blackboxBudgetLabel()}`);
          toast("已合并为一条 GIF");
        } catch (err) {
          setVbbProgress(false, 0, "");
          setError(vbbError, err.message || String(err));
        } finally {
          vbbBusy = false;
          setVbbButtons();
        }
      }
  
      function bindVbbOnce(el, key, handler) {
        if (!el || el.dataset[key]) return;
        el.dataset[key] = "1";
        el.addEventListener("click", handler);
      }
  
      bindPanel("vbb", (root) => {
        root = root || document.getElementById("vbb");
        ensureVbbScrollGuard();
        try {
          revealAutoShareGalleryUi?.();
        } catch (_) {}
        vbbFile = $("#vbb-file", root);
        vbbVideo = $("#vbb-video", root);
        vbbMeta = $("#vbb-meta", root);
        const vbbMaxMb = $("#vbb-max-mb", root);
        if (vbbMaxMb) {
          const snapMb = (raw) => {
            const n = Math.max(1, Math.min(200, Number(raw) || 10));
            if (vbbMaxMb.tagName === "SELECT") {
              const opts = [...vbbMaxMb.options].map((o) => Number(o.value)).filter((x) => x > 0);
              if (!opts.includes(n)) {
                let best = opts[0] || 10;
                let bestD = Math.abs(best - n);
                for (const o of opts) {
                  const d = Math.abs(o - n);
                  if (d < bestD) {
                    best = o;
                    bestD = d;
                  }
                }
                return best;
              }
            }
            return n;
          };
          try { vbbMaxMb.value = String(snapMb(blackboxMaxMb())); } catch (_) {}
          vbbMaxMb.addEventListener("change", () => {
            const v = setBlackboxMaxMb(snapMb(vbbMaxMb.value));
            vbbMaxMb.value = String(v);
            toast(`黑盒上限已设为 ${v} MB`);
          });
        }
        // ---- 性能档 + 分块编码（仅手机显示分块）：建议值预填 + 记住用户改过的值 ----
        (function bindVbbPerfAndChunk() {
          const perfEl = $("#vbb-perf", root);
          if (perfEl && typeof readMediaPerfMode === "function") {
            try { perfEl.value = readMediaPerfMode(); } catch (_) { perfEl.value = "auto"; }
            const tipPerf = () => {
              try {
                const p = mediaPerfProfile();
                toast(`性能：${p.label}（${p.tier}）· 帧上限 ${p.gifskiMaxFrames} · 加宽探 ${p.widenProbes} 次`);
              } catch (_) {}
            };
            perfEl.addEventListener("change", () => {
              const mode = setMediaPerfMode(perfEl.value);
              perfEl.value = mode;
              tipPerf();
              // 切换档位后刷新分块建议
              try { vbbVideo?.dispatchEvent(new Event("loadedmetadata")); } catch (_) {}
            });
          }
          const enable = $("#vbb-chunk-enable", root);
          const countEl = $("#vbb-chunk-count", root);
          const hintEl = $("#vbb-chunk-hint", root);
          if (!enable && !countEl) return;
          // 上次编码中途被系统杀掉（OOM）→ 自动调大分块数，避免再撞同一堵墙
          try {
            if (localStorage.getItem("devtools-vbb-running")) {
              localStorage.removeItem("devtools-vbb-running");
              const prev = readVbbChunkCfg();
              const next = Math.min(64, Math.max(2, (prev.count || 1) * 2));
              saveVbbChunkCfg({ on: true, count: next });
              setTimeout(() => toast(`上次处理因内存不足被系统中断，已把分块数调到 ${next}`), 400);
            }
          } catch (_) {}
          const cfg = readVbbChunkCfg();
          let userSet = cfg.count != null; // 用户手动改过 → 不再跟随建议值
          const hasSavedOn = (() => {
            try {
              const raw = localStorage.getItem(VBB_CHUNK_KEY);
              if (!raw) return false;
              const j = JSON.parse(raw);
              return Object.prototype.hasOwnProperty.call(j, "on");
            } catch (_) {
              return false;
            }
          })();
          if (enable) {
            if (hasSavedOn) enable.checked = cfg.on;
            else enable.checked = Boolean(currentMediaPerf().preferChunkByDefault);
          }
          if (countEl && userSet) countEl.value = String(cfg.count);
          const sync = () => {
            const rec = vbbRecommendChunkCount();
            if (countEl) {
              countEl.disabled = enable ? !enable.checked : false;
              // 未手改 → 用「自动」档，由编码器按内存预算分块
              if (!userSet) countEl.value = "";
            }
            if (hintEl) {
              hintEl.textContent = "";
              hintEl.hidden = true;
            }
          };
          const persist = () => {
            const raw = String(countEl && countEl.value != null ? countEl.value : "").trim();
            const n = Math.floor(Number(raw));
            saveVbbChunkCfg({ on: enable ? enable.checked : true, count: n >= 1 ? Math.min(64, n) : null });
          };
          enable?.addEventListener("change", () => { persist(); sync(); });
          countEl?.addEventListener("change", () => {
            userSet = String(countEl.value || "").trim() !== "";
            persist();
          });
          // 每换一支视频都重新按「当前视频」自动填写建议块数（上一支手改的值不沿用到新视频）
          vbbVideo?.addEventListener("loadedmetadata", () => { userSet = false; sync(); });
          sync();
        })();
        // ---- 多图 → GIF：只有一个「每张时长」输入，宽度/质量按黑盒规则自动 ----
        (function bindVbbImages() {
          const imagesPanel = $("#vbb-images-panel", root);
          const videoBtn = $("#vbb-input-video", root);
          const imagesBtn = $("#vbb-input-images", root);
          const fileInput = $("#vbb-img-file", root);
          const dropEl = $("#vbb-img-drop", root);
          const listEl = $("#vbb-img-list", root);
          const holdRange = $("#vbb-hold", root);
          const holdNum = $("#vbb-hold-num", root);
          const previewEl = $("#vbb-img-preview", root);
          const resultEl = $("#vbb-img-result", root);
          const resultWrap = $("#vbb-img-result-wrap", root);
          const fillSel = $("#vbb-fill", root);
          const metaEl = $("#vbb-img-meta", root);
          const genBtn = $("#vbb-img-generate", root);
          const dlEl = $("#vbb-img-download", root);
          const errEl = $("#vbb-img-error", root);
          const progEl = $("#vbb-img-progress", root);
          const progFill = $("#vbb-img-progress-fill", root);
          const progPct = $("#vbb-img-progress-pct", root);
          const progText = $("#vbb-img-progress-text", root);
          if (!imagesPanel || !holdRange || !fileInput) return;

          const MAX_IMAGES = 60;
          const st = {
            items: [],
            hold: 1,
            blob: null,
            url: "",
            playTimer: 0,
            playIdx: 0,
            encTimer: 0,
            gen: 0,
            busy: false,
            autoNote: "",
            fill: "auto",
            manualDone: false,
          };
          const setErr = (m) => setError(errEl, m || "");
          const setMeta = (m) => {
            if (metaEl) metaEl.textContent = m || "";
          };
          const setProg = (on, ratio, text) => {
            if (!progEl) return;
            progEl.hidden = !on;
            const r = Math.max(0, Math.min(1, Number(ratio) || 0));
            if (progFill) progFill.style.width = `${Math.round(r * 100)}%`;
            if (progPct) progPct.textContent = `${Math.round(r * 100)}%`;
            if (progText && text) progText.textContent = text;
          };
          const bytesOf = (data) => {
            const src = data instanceof Uint8Array ? data : new Uint8Array(data);
            const copy = new Uint8Array(src.byteLength);
            copy.set(src);
            return copy;
          };
          const fmt = (n) => (typeof formatKb === "function" ? formatKb(n) : `${Math.round(n / 1024)}KB`);

          function updateButtons() {
            const has = st.items.length > 0;
            // 生成按钮始终可点：自动预览编码期间点了就作废自动任务、立刻手动生成（不再等它跑完）
            if (genBtn) genBtn.disabled = !has;
            if (dlEl) dlEl.hidden = !(st.url && st.manualDone);
          }

          const previewNoteEl = $("#vbb-img-preview-note", root);
          const setPreviewNote = (m) => {
            if (previewNoteEl) previewNoteEl.textContent = m || "";
          };

          function clearItems() {
            stopPlay();
            window.clearTimeout(st.encTimer);
            st.gen += 1; // 作废在跑的编码
            st.items.forEach((it) => {
              try {
                URL.revokeObjectURL(it.url);
              } catch (_) {}
            });
            st.items = [];
            invalidateResult();
            if (previewEl) {
              previewEl.hidden = true;
              previewEl.removeAttribute("src");
            }
            setPreviewNote("");
            setProg(false, 0);
            renderList();
            updateButtons();
          }

          /** 图片集合变化 → 作废旧结果（并恢复自动预览编码） */
          function invalidateResult() {
            st.manualDone = false;
            if (st.url) {
              try {
                URL.revokeObjectURL(st.url);
              } catch (_) {}
            }
            st.url = "";
            st.blob = null;
            if (resultWrap) resultWrap.hidden = true;
            if (resultEl) {
              resultEl.hidden = true;
              resultEl.removeAttribute("src");
            }
            if (dlEl) {
              dlEl.hidden = true;
              dlEl.removeAttribute("href");
            }
          }

          function stopPlay() {
            if (st.playTimer) {
              clearInterval(st.playTimer);
              st.playTimer = 0;
            }
          }
          function startPlay() {
            stopPlay();
            if (!previewEl || st.items.length === 0) return;
            previewEl.hidden = false;
            st.playIdx = Math.min(st.playIdx, st.items.length - 1);
            previewEl.src = st.items[st.playIdx].url;
            setPreviewNote(`第 ${st.playIdx + 1}/${st.items.length} 张 · 每张 ${st.hold}s`);
            if (st.items.length < 2) return;
            st.playTimer = setInterval(() => {
              st.playIdx = (st.playIdx + 1) % st.items.length;
              try {
                previewEl.src = st.items[st.playIdx].url;
              } catch (_) {}
              setPreviewNote(`第 ${st.playIdx + 1}/${st.items.length} 张 · 每张 ${st.hold}s`);
            }, Math.max(100, Math.round(st.hold * 1000)));
          }

          function renderList() {
            if (!listEl) return;
            listEl.innerHTML = st.items
              .map(
                (it, i) =>
                  `<div class="vbb-img-item" data-i="${i}" draggable="true">` +
                  `<img src="${it.url}" alt="" loading="lazy" />` +
                  `<span class="vbb-img-name">${escapeHtml(String(it.file.name || "").slice(0, 18))}</span>` +
                  `<span class="vbb-img-ops">` +
                  `<button type="button" class="ghost-btn" data-img-move="-1" data-i="${i}" title="前移"${
                    i === 0 ? " disabled" : ""
                  }>‹</button>` +
                  `<button type="button" class="ghost-btn" data-img-move="1" data-i="${i}" title="后移"${
                    i === st.items.length - 1 ? " disabled" : ""
                  }>›</button>` +
                  `<button type="button" class="ghost-btn" data-img-rm="${i}" title="移除">✕</button>` +
                  `</span></div>`
              )
              .join("");
          }

          function scheduleEncode(delay = 520) {
            window.clearTimeout(st.encTimer);
            if (!st.items.length) return;
            // 点过「生成」后不再自动重编码：改时长只影响下次手动生成，预览保持不动
            if (st.manualDone) return;
            st.encTimer = window.setTimeout(() => void requestEncode(false), delay);
          }

          /** 取图片边缘平均色做填充色：尺寸不一时比纯黑边好看（自动，无需用户输入） */
          function edgeColorOf(ctx, w, h) {
            try {
              const pts = [];
              const step = Math.max(1, Math.floor(Math.min(w, h) / 24));
              for (let x = 0; x < w; x += step) {
                pts.push([x, 1], [x, h - 2]);
              }
              for (let y = 0; y < h; y += step) {
                pts.push([1, y], [w - 2, y]);
              }
              let r = 0;
              let g = 0;
              let b = 0;
              let n = 0;
              for (const [x, y] of pts) {
                const d = ctx.getImageData(Math.min(w - 1, Math.max(0, x)), Math.min(h - 1, Math.max(0, y)), 1, 1).data;
                r += d[0];
                g += d[1];
                b += d[2];
                n += 1;
              }
              if (!n) return "#000";
              return `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`;
            } catch (_) {
              return "#000";
            }
          }

          async function normalizePng(item, W, H, fill) {
            const bmp = await createImageBitmap(item.file);
            const canvas = document.createElement("canvas");
            canvas.width = W;
            canvas.height = H;
            const ctx = canvas.getContext("2d");
            if (fill !== "transparent") {
              // 填充色：自动 = 该图边缘平均色（比纯黑边好看）；黑/白按选择
              let pad = "#000";
              if (fill === "white") pad = "#fff";
              else if (fill !== "black") {
                const tmp = document.createElement("canvas");
                tmp.width = bmp.width;
                tmp.height = bmp.height;
                const tctx = tmp.getContext("2d");
                tctx.drawImage(bmp, 0, 0);
                pad = edgeColorOf(tctx, bmp.width, bmp.height);
              }
              ctx.fillStyle = pad;
              ctx.fillRect(0, 0, W, H);
            }
            const scale = Math.min(W / bmp.width, H / bmp.height);
            const dw = Math.max(1, Math.round(bmp.width * scale));
            const dh = Math.max(1, Math.round(bmp.height * scale));
            ctx.drawImage(bmp, Math.round((W - dw) / 2), Math.round((H - dh) / 2), dw, dh);
            bmp.close?.();
            return await new Promise((res) => canvas.toBlob((b) => res(b), "image/png"));
          }

          /** 一次编码：多图 → 调色板 GIF（temp 文件名带 runId，避免并发互相覆盖） */
          async function encodeOnce(ff, W, H, colors, onRatio, runId, fill) {
            const rid = String(runId || 0);
            const names = [];
            for (let i = 0; i < st.items.length; i += 1) {
              const nm = `vim-${rid}-${i}.png`;
              const png = await normalizePng(st.items[i], W, H, fill);
              await ff.writeFile(nm, await fetchFileBytes(png));
              names.push(nm);
              onRatio?.(0.1 + (i / st.items.length) * 0.35, `处理图片 ${i + 1}/${st.items.length}`);
            }
            const hold = Math.max(0.1, st.hold);
            onRatio?.(0.5, "编码 GIF…");
            // 透明填充需保留 alpha（GIF 只支持 1-bit 透明）
            const vf =
              fill === "transparent"
                ? `scale=${W}:${H}:flags=lanczos,split[a][b];` +
                  `[a]palettegen=max_colors=${colors}:stats_mode=full:reserve_transparent=1[p];` +
                  `[b][p]paletteuse=dither=sierra2:alpha_threshold=128:diff_mode=rectangle`
                : `scale=${W}:${H}:flags=lanczos,split[a][b];` +
                  `[a]palettegen=max_colors=${colors}:stats_mode=full[p];` +
                  `[b][p]paletteuse=dither=sierra2:diff_mode=rectangle`;
            // 用 image2 定帧率：每帧时长 = hold（精确，不会像 concat 那样多算末帧）
            const fps = Math.max(0.02, 1 / hold);
            const outName = `vim-out-${rid}.gif`;
            const code = await ff.exec([
              "-framerate", fps.toFixed(6),
              "-start_number", "0",
              "-i", `vim-${rid}-%d.png`,
              "-vf", vf,
              "-loop", "0", "-y", outName,
            ]);
            if (code !== 0) throw new Error(`编码失败（code=${code}）`);
            const data = await ff.readFile(outName);
            let blob = new Blob([bytesOf(data)], { type: "image/gif" });
            onRatio?.(0.75, "优化 GIF…");
            try {
              blob = await compressGifBlob(blob, "standard", () => {});
            } catch (_) {}
            for (const nm of names) {
              try {
                await ff.deleteFile(nm);
              } catch (_) {}
            }
            try {
              await ff.deleteFile(outName);
            } catch (_) {}
            return blob;
          }

          // 串行化：同一时刻只跑一个编码，避免「点生成」与防抖自动编码抢 ffmpeg 实例/临时文件
          let encodeChain = Promise.resolve();
          function requestEncode(isManual) {
            const myGen = ++st.gen; // 作废在跑/排队的旧任务
            encodeChain = encodeChain
              .catch(() => {})
              .then(() => (myGen === st.gen ? encode(isManual, myGen) : null))
              .catch(() => {});
            return encodeChain;
          }

          async function encode(isManual, myGen) {
            if (!st.items.length) return;
            st.busy = true;
            updateButtons();
            setErr("");
            if (isManual) setProg(true, 0.02, "准备…");
            try {
              const W0 = V2G_BLACKBOX_BASE_W;
              const colors0 = gifQualityToMaxColors(V2G_BLACKBOX_QUALITY);
              const first = st.items[0];
              const ratio0 = first.w > 0 && first.h > 0 ? first.h / first.w : 0.5625;
              const H0 = Math.max(2, Math.round((W0 * ratio0) / 2) * 2);
              const ff = await getFfmpegInstance((ratio, text) => {
                if (isManual) setProg(true, 0.02 + (Number(ratio) || 0) * 0.08, text || "加载编码器…");
              });
              let blob = await encodeOnce(ff, W0, H0, colors0, (r, t) => {
                if (isManual) setProg(true, r, t);
              }, myGen, st.fill);
              // 超黑盒上限 → 自动降级（先降宽度，再降色数）
              const budget = blackboxMaxMb() * 1024 * 1024;
              let W = W0;
              let colors = colors0;
              let round = 0;
              while (blob.size > budget && round < 5) {
                round += 1;
                W = Math.max(120, Math.round(W0 * Math.pow(0.82, round)));
                colors = round >= 3 ? Math.max(96, Math.round(colors0 / 2)) : colors0;
                const H = Math.max(2, Math.round((W * ratio0) / 2) * 2);
                if (isManual) setProg(true, 0.8, `超上限，自动降到 ${W}px / ${colors} 色…`);
                blob = await encodeOnce(ff, W, H, colors, () => {}, myGen, st.fill);
              }
              if (myGen !== st.gen) return; // 期间又改了时长 → 丢弃这次结果
              // 体积有余（< 上限的 5/6）→ 与黑盒视频一致：自动加宽，把预算用在清晰度上
              const widenGate = Math.round(budget * (5 / 6));
              let srcMinW = 0;
              try {
                const ws = st.items.map((i) => Number(i.w) || 0).filter((w) => w > 0);
                srcMinW = ws.length ? Math.min(...ws) : 0;
              } catch (_) {}
              if (blob.size < widenGate && srcMinW > W) {
                let lo = W;
                let hi = srcMinW;
                for (let i = 0; i < 6 && hi - lo > 16; i += 1) {
                  const mid = Math.max(lo + 2, Math.round((lo + hi) / 4) * 2);
                  if (mid >= hi) break;
                  if (isManual) setProg(true, 0.86, `有余量，加宽试探 ${mid}px…`);
                  const Hm = Math.max(2, Math.round((mid * ratio0) / 2) * 2);
                  const cand = await encodeOnce(ff, mid, Hm, colors, () => {}, myGen, st.fill);
                  if (myGen !== st.gen) return;
                  if (cand.size <= budget) {
                    blob = cand;
                    W = mid;
                    lo = mid;
                  } else {
                    hi = mid;
                  }
                }
              }
              if (myGen !== st.gen) return; // 期间又改了时长 → 丢弃这次结果
              if (blob.size > budget) {
                if (isManual) {
                  setErr(`无法压到 ${Math.round(budget / (1024 * 1024))}MB（当前 ${fmt(blob.size)}）· 未提供下载`);
                  setProg(false, 0);
                }
                return;
              }
              if (st.url) {
                try {
                  URL.revokeObjectURL(st.url);
                } catch (_) {}
              }
              st.blob = blob;
              st.url = URL.createObjectURL(blob);
              if (previewEl) {
                previewEl.hidden = false;
              }
              // 只有点「生成」才显示结果图（自动预览编码不出结果，避免提前出现）
              if (isManual) {
                if (resultWrap) resultWrap.hidden = false;
                if (resultEl) {
                  resultEl.hidden = false;
                  resultEl.src = st.url;
                }
                stopPlay(); // 生成后停止轮播，省电；改时长会重新开始
                if (dlEl) {
                  dlEl.hidden = false;
                  dlEl.href = st.url;
                  dlEl.download = `images-${st.items.length}x${String(st.hold).replace(".", "_")}s.gif`;
                }
              }
              setPreviewNote(`第 ${(st.playIdx || 0) + 1}/${st.items.length} 张 · 每张 ${st.hold}s`);
              st.autoNote = `自动：宽 ${W} · ${colors} 色`;
              const fpsTxt = String(Math.round((1 / Math.max(0.1, st.hold)) * 10) / 10);
              setMeta(
                `${st.items.length} 张 · 每张 ${st.hold}s · ${fpsTxt} fps · 共 ${(st.items.length * st.hold).toFixed(1)}s · ${st.autoNote} · ${fmt(
                  blob.size
                )}${round ? ` · 已自动降级 ${round} 次` : ""}`
              );
              setProg(false, 0);
            } catch (err) {
              if (isManual) setErr(err?.message || String(err));
              setProg(false, 0);
            } finally {
              st.busy = false;
              updateButtons();
            }
          }

          function syncHold(v, fromRange) {
            let n = Number(v);
            if (!Number.isFinite(n)) n = 1;
            // 白名单 0.5 步进（与下拉档位一致）
            n = Math.max(0.5, Math.min(5, Math.round(n * 2) / 2));
            st.hold = n;
            if (fromRange && holdNum) holdNum.value = String(n);
            if (!fromRange && holdRange) holdRange.value = String(n);
            startPlay();
            scheduleEncode();
          }

          function setMode(mode) {
            const images = mode === "images";
            root.classList.toggle("is-images-mode", images);
            imagesPanel.hidden = !images;
            videoBtn?.classList.toggle("is-active", !images);
            imagesBtn?.classList.toggle("is-active", images);
            if (images) {
              startPlay();
              scheduleEncode();
            } else {
              stopPlay();
            }
          }

          videoBtn?.addEventListener("click", () => setMode("video"));
          imagesBtn?.addEventListener("click", () => setMode("images"));

          fileInput.addEventListener("change", () => {
            void addFiles(fileInput.files);
            fileInput.value = "";
          });
          $("#vbb-img-clear", root)?.addEventListener("click", () => {
            clearItems();
            setMeta("拖入图片即可");
          });
          holdRange.addEventListener("input", () => syncHold(holdRange.value, true));
          holdNum?.addEventListener("change", () => syncHold(holdNum.value, false));
          holdNum?.addEventListener("input", () => syncHold(holdNum.value, false));
          // 填充方式：自动色（默认）/ 黑 / 白 / 透明
          if (fillSel) {
            try {
              const v = localStorage.getItem("devtools-vbb-img-fill");
              if (v) fillSel.value = v;
            } catch (_) {}
            st.fill = fillSel.value || "auto";
            fillSel.addEventListener("change", () => {
              st.fill = fillSel.value || "auto";
              try {
                localStorage.setItem("devtools-vbb-img-fill", st.fill);
              } catch (_) {}
              invalidateResult();
              if (!st.manualDone) scheduleEncode(200);
            });
          }
          genBtn?.addEventListener("click", () => {
            if (!st.items.length) {
              setErr("先拖入图片再生成");
              return;
            }
            // 自动预览编码还在跑 → 直接作废它并立刻手动生成（requestEncode 会 ++gen 作废旧任务）
            st.manualDone = true; // 之后改时长不再自动重编码
            void requestEncode(true);
          });
          listEl?.addEventListener("click", (e) => {
            const rm = e.target.closest?.("[data-img-rm]");
            if (rm) {
              const i = Number(rm.dataset.imgRm);
              const it = st.items[i];
              if (it) {
                try {
                  URL.revokeObjectURL(it.url);
                } catch (_) {}
                st.items.splice(i, 1);
              }
              invalidateResult();
              renderList();
              updateButtons();
              startPlay();
              scheduleEncode(200);
              return;
            }
            const mv = e.target.closest?.("[data-img-move]");
            if (mv) {
              const i = Number(mv.dataset.i);
              const dir = Number(mv.dataset.imgMove);
              const j = i + dir;
              if (j >= 0 && j < st.items.length) {
                const [it] = st.items.splice(i, 1);
                st.items.splice(j, 0, it);
                invalidateResult();
                renderList();
                startPlay();
                scheduleEncode(200);
              }
            }
          });
          // 拖拽排序（桌面）
          listEl?.addEventListener("dragover", (e) => {
            if (e.target.closest?.(".vbb-img-item")) e.preventDefault();
          });
          listEl?.addEventListener("drop", (e) => {
            e.preventDefault();
            const from = Number(e.dataTransfer?.getData("text/plain"));
            const to = Number(e.target.closest?.(".vbb-img-item")?.dataset?.i);
            if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return;
            const [it] = st.items.splice(from, 1);
            st.items.splice(to, 0, it);
            invalidateResult();
            renderList();
            scheduleEncode(200);
          });
          listEl?.addEventListener("dragstart", (e) => {
            const it = e.target.closest?.(".vbb-img-item");
            if (!it) return;
            try {
              e.dataTransfer.setData("text/plain", it.dataset.i);
            } catch (_) {}
          });

          // 面板拖入图片
          const panelEl = $("#vbb", root) || root;
          ["dragenter", "dragover"].forEach((ev) =>
            panelEl.addEventListener(ev, (e) => {
              if (!e.dataTransfer) return;
              e.preventDefault();
              dropEl?.classList.add("is-over");
            })
          );
          panelEl.addEventListener("dragleave", (e) => {
            if (e.target === panelEl || e.target === dropEl) dropEl?.classList.remove("is-over");
          });
          panelEl.addEventListener("drop", (e) => {
            dropEl?.classList.remove("is-over");
            const files = [...(e.dataTransfer?.files || [])];
            if (!files.length) return;
            const onlyImages = files.every(
              (f) => /^image\//.test(f.type || "") || /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name || "")
            );
            if (!onlyImages) return; // 视频交给原流程
            e.preventDefault();
            setMode("images");
            void addFiles(files);
          });

          async function addFiles(fileList) {
            const files = [...(fileList || [])].filter(
              (f) => /^image\//.test(f.type || "") || /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name || "")
            );
            if (!files.length) {
              setErr("没有可用的图片（支持 PNG / JPG / WebP / GIF / BMP）");
              return;
            }
            setErr("");
            const room = MAX_IMAGES - st.items.length;
            if (room <= 0) {
              setErr(`最多 ${MAX_IMAGES} 张`);
              return;
            }
            if (files.length > room) setErr(`最多 ${MAX_IMAGES} 张，已忽略多余的 ${files.length - room} 张`);
            for (const f of files.slice(0, room)) {
              const url = URL.createObjectURL(f);
              let w = 0;
              let h = 0;
              try {
                const bmp = await createImageBitmap(f);
                w = bmp.width;
                h = bmp.height;
                bmp.close?.();
              } catch (_) {}
              st.items.push({ file: f, url, w, h });
            }
            invalidateResult();
            renderList();
            updateButtons();
            startPlay();
            scheduleEncode();
          }

          // 初始：按黑盒默认值
          syncHold(holdRange.value, true);
          setMeta("拖入图片即可");
        })();

        const vbbSpeedChk = $("#vbb-speed-limit", root);
        const vbbSpeedSec = $("#vbb-speed-sec", root);
        const vbbAutoDlEach = $("#vbb-auto-dl-each", root);
        if (vbbAutoDlEach) {
          try {
            vbbAutoDlEach.checked = isVbbAutoDlEachEnabled();
          } catch (_) {}
          vbbAutoDlEach.addEventListener("change", () => {
            const on = Boolean(vbbAutoDlEach.checked);
            setVbbAutoDlEachEnabled(on);
            toast(on ? "已开启：每段 GIF 完成后立刻下载" : "已关闭：需手动下载或打包");
          });
        }
        if (vbbSpeedChk) {
          try { vbbSpeedChk.checked = localStorage.getItem("devtools-vbb-speed-on") === "1"; } catch (_) {}
          vbbSpeedChk.addEventListener("change", () => {
            try { localStorage.setItem("devtools-vbb-speed-on", vbbSpeedChk.checked ? "1" : "0"); } catch (_) {}
          });
        }
        if (vbbSpeedSec) {
          const snapSpeed = (raw) => {
            const n = Math.max(3, Math.min(120, Number(raw) || 20));
            if (vbbSpeedSec.tagName !== "SELECT") return n;
            const opts = [...vbbSpeedSec.options].map((o) => Number(o.value)).filter((x) => x > 0);
            if (opts.includes(n)) return n;
            let best = opts[0] || 20;
            let bestD = Math.abs(best - n);
            for (const o of opts) {
              const d = Math.abs(o - n);
              if (d < bestD) {
                best = o;
                bestD = d;
              }
            }
            return best;
          };
          try {
            const sv = localStorage.getItem("devtools-vbb-speed-sec");
            if (sv) vbbSpeedSec.value = String(snapSpeed(sv));
          } catch (_) {}
          vbbSpeedSec.addEventListener("change", () => {
            const v = snapSpeed(vbbSpeedSec.value);
            vbbSpeedSec.value = String(v);
            try { localStorage.setItem("devtools-vbb-speed-sec", String(v)); } catch (_) {}
          });
        }
        // 完成通知 / 防息屏设置（默认全开，范围默认「每个都提示」）
        const vbbWakeChk = $("#vbb-wake-lock", root);
        const vbbSoundChk = $("#vbb-notify-sound", root);
        const vbbVibChk = $("#vbb-notify-vibrate", root);
        const vbbScopeSel = $("#vbb-notify-scope", root);
        if (vbbWakeChk) {
          vbbWakeChk.checked = DN.wakeEnabled?.() ?? true;
          vbbWakeChk.addEventListener("change", () => DN.setWakeEnabled?.(vbbWakeChk.checked));
        }
        if (vbbSoundChk) {
          vbbSoundChk.checked = DN.soundEnabled?.() ?? true;
          vbbSoundChk.addEventListener("change", () => {
            DN.setSound?.(vbbSoundChk.checked);
            if (vbbSoundChk.checked) DN.unlockAudio?.();
          });
        }
        if (vbbVibChk) {
          vbbVibChk.checked = DN.vibrateEnabled?.() ?? true;
          vbbVibChk.addEventListener("change", () => {
            DN.setVibrate?.(vbbVibChk.checked);
            if (vbbVibChk.checked) {
              try { navigator.vibrate?.([80]); } catch (_) {}
            }
          });
        }
        if (vbbScopeSel) {
          vbbScopeSel.value = DN.scope?.() === "done" ? "done" : "each";
          vbbScopeSel.addEventListener("change", () => DN.setScope?.(vbbScopeSel.value));
        }
        const vbbCropChk = $("#vbb-auto-crop", root);
        if (vbbCropChk) {
          try { vbbCropChk.checked = localStorage.getItem("devtools-vbb-auto-crop") === "1"; } catch (_) {}
          vbbCropChk.addEventListener("change", () => {
            try { localStorage.setItem("devtools-vbb-auto-crop", vbbCropChk.checked ? "1" : "0"); } catch (_) {}
            toast(vbbCropChk.checked ? "已开启：自动裁剪纯色边框" : "已关闭自动裁剪");
          });
        }
        vbbError = $("#vbb-error", root);
        vbbAnalyze = $("#vbb-analyze", root);
        vbbRun = $("#vbb-run", root);
        vbbOneclick = $("#vbb-oneclick", root);
        vbbAdvanced = $("#vbb-advanced", root);
        vbbSplitPanel = $("#vbb-split-panel", root);
        vbbWorkflowHint = $("#vbb-workflow-hint", root);
        vbbMerge = $("#vbb-merge", root);
        vbbAbort = $("#vbb-abort", root);
        vbbZip = $("#vbb-zip", root);
        vbbMergedDl = $("#vbb-merged-dl", root);
        vbbMergedPreview = $("#vbb-merged-preview", root);
        vbbMergedBlock = $("#vbb-merged-block", root);
        vbbMergedMeta = $("#vbb-merged-meta", root);
        vbbResultSummary = $("#vbb-result-summary", root);
        vbbProgress = $("#vbb-progress", root);
        vbbProgressFill = $("#vbb-progress-fill", root);
        vbbProgressText = $("#vbb-progress-text", root);
        vbbProgressSub = $("#vbb-progress-sub", root);
        vbbProgressPct = $("#vbb-progress-pct", root);
        vbbPlan = $("#vbb-plan", root);
        vbbPlanSummary = $("#vbb-plan-summary", root);
        vbbPlanList = $("#vbb-plan-list", root);
        vbbList = $("#vbb-list", root);
        vbbBatchList = $("#vbb-batch-list", root);
        vbbResultBlock = $("#vbb-result-block", root);
        vbbCustomRow = $("#vbb-custom-row", root);
        vbbTargetSpan = $("#vbb-target-span", root);
        vbbTargetRange = $("#vbb-target-range", root);
        vbbTargetLabel = $("#vbb-target-label", root);
        vbbEqualizeHint = $("#vbb-equalize-hint", root);
        vbbEqualize = $("#vbb-equalize", root);
        vbbManualPanel = $("#vbb-manual-panel", root);
        vbbScrub = $("#vbb-scrub", root);
        vbbPlay = $("#vbb-play", root);
        vbbManualNow = $("#vbb-manual-now", root);
        vbbManualCount = $("#vbb-manual-count", root);
        vbbManualDraft = $("#vbb-manual-draft", root);
        vbbMarkTap = $("#vbb-mark-tap", root);
        vbbMarkUndo = $("#vbb-mark-undo", root);
        vbbMarkClear = $("#vbb-mark-clear", root);
        vbbNudgeM1 = $("#vbb-nudge-m1", root);
        vbbNudgeM01 = $("#vbb-nudge-m01", root);
        vbbNudgeP01 = $("#vbb-nudge-p01", root);
        vbbNudgeP1 = $("#vbb-nudge-p1", root);
        vbbScrubMarks = $("#vbb-scrub-marks", root);
        vbbMarkChips = $("#vbb-mark-chips", root);
        vbbJumpTime = $("#vbb-jump-time", root);
        vbbJumpGo = $("#vbb-jump-go", root);
        vbbLongHint = $("#vbb-long-hint", root);
        vbbPreviewWrap = $("#vbb-preview-wrap", root);
        vbbFileEdit = $("#vbb-file-edit", root);
        vbbFileEditLabel = $("#vbb-file-edit-label", root);
        vbbEditOpen = $("#vbb-edit-open", root);
        vbbEditReset = $("#vbb-edit-reset", root);
        vbbEditOpen?.addEventListener("click", () => {
          openVbbEditEditor().catch((err) => setError(vbbError, err?.message || String(err)));
        });
        vbbEditReset?.addEventListener("click", () => resetActiveVbbEdit());
        const syncCustomTarget = (raw) => {
          if (!vbbAnalysis) return;
          const choices = [8, 10, 12, 15, 16, 20, 24, 30];
          const min = Number(vbbTargetRange?.min) || choices[0];
          const max = Number(vbbTargetRange?.max) || choices[choices.length - 1];
          let val = Math.max(min, Math.min(max, Number(raw) || min));
          // 白名单就近吸附，手机点选更稳
          let best = choices[0];
          let bestD = Math.abs(best - val);
          for (const c of choices) {
            if (c < min - 0.01 || c > max + 0.01) continue;
            const d = Math.abs(c - val);
            if (d < bestD) {
              best = c;
              bestD = d;
            }
          }
          val = best;
          vbbSegmentTarget = val;
          if (vbbTargetSpan) vbbTargetSpan.value = String(val);
          if (vbbTargetRange) vbbTargetRange.value = String(val);
          if (vbbMode !== "custom") vbbMode = "custom";
          paintVbbPlan();
        };
        if (vbbFile && !vbbFile.dataset.vbbBound) {
          vbbFile.dataset.vbbBound = "1";
          vbbFile.addEventListener("click", () => {
            vbbFile.value = "";
          });
          vbbFile.addEventListener("change", (e) => {
            loadVbbFiles(e.target.files).catch((err) => {
              clearVbb();
              setError(vbbError, err.message || String(err));
            });
          });
        }
        $("#vbb-clear", root)?.addEventListener("click", clearVbb);
        vbbTargetSpan?.addEventListener("change", () => syncCustomTarget(vbbTargetSpan.value));
        vbbTargetSpan?.addEventListener("input", () => syncCustomTarget(vbbTargetSpan.value));
        vbbTargetRange?.addEventListener("input", () => syncCustomTarget(vbbTargetRange.value));
        vbbEqualize?.addEventListener("change", () => {
          rebuildVbbDerivedPlans();
          paintVbbPlan();
        });
        bindVbbOnce($("#vbb-mode-custom", root), "vbbModeBound", () => {
          vbbMode = "custom";
          paintVbbPlan();
        });
        const workflowRow = root.querySelector(".blackbox-workflow-row");
        if (workflowRow && !workflowRow.dataset.vbbWorkflowBound) {
          workflowRow.dataset.vbbWorkflowBound = "1";
          workflowRow.addEventListener("click", (e) => {
            const btn = e.target.closest("[data-vbb-workflow]");
            if (!btn || !workflowRow.contains(btn)) return;
            if (btn.disabled) return;
            const next = String(btn.dataset.vbbWorkflow || "").trim();
            if (!next || next === vbbWorkflow) return;
            if (isVbbBatchMode() && next === "split") {
              toast("多选时请用「整段视频」或「手动打点」");
              return;
            }
            if (isVbbBatchMode() && vbbWorkflow === "manual") persistActiveVbbMarks();
            vbbWorkflow = next;
            if (isVbbBatchMode() && next === "manual") {
              const cur = vbbBatchFiles[vbbEditBatchIdx];
              if (cur) loadItemVbbMarks(cur);
            }
            if (next === "manual") pauseVbbPreview();
            syncVbbWorkflowUi();
            if (next === "manual") {
              const d = vbbVideoDuration();
              if (d >= VBB_LONG_VIDEO_SEC) {
                toast("长视频：拖动定位即可，播放会占用更多内存");
              } else if (isVbbBatchMode()) {
                toast("打点仅作用于当前预览视频");
              }
            }
          });
        }
      window.DevToolsTemp?.registerCleanup(clearVbb);
      // 供预估准确性测试读取（不影响 UI）
      window.DevToolsVbb = {
        getBps15: () => vbbAnalysis?.bps15 ?? null,
        getSrcW: () => vbbAnalysis?.srcW ?? 0,
        getActivePlan: () => (vbbAnalysis ? resolveActiveVbbPlan() : null),
        getClips: () => vbbClips.slice(),
        formatClipTitle: (c, idx) => formatVbbClipTitle(c, idx),
        formatClipMeta: (c, opts) => formatVbbClipMeta(c, opts || {}),
        shouldReuseFirstPlan: (ranges, index) => shouldReuseVbbFirstPlan(ranges, index),
        loadSpanScheme: (span, speed) => loadVbbSpanScheme(span, speed),
        saveSpanScheme: (span, seed, enc) => saveVbbSpanScheme(span, seed, enc),
        spanSchemeKey: (span, speed) => vbbSpanSchemeKey(span, speed),
        estimateBlackbox: (span) => {
          if (!vbbAnalysis) return null;
          return estimateVbbBlackboxPlan(vbbAnalysis.bps15, span, vbbAnalysis.srcW);
        },
        isEqualize: () => isVbbEqualize(),
        getMode: () => vbbMode,
        setMode: (mode) => {
          if (!vbbAnalysis) return;
          vbbMode = String(mode || "duration");
          paintVbbPlan();
        },
        getWorkflow: () => vbbWorkflow,
        getMarks: () => vbbMarks.map((m) => ({ ...m })),
        getDraftStart: () => vbbDraftStart,
        computeManualRanges: () => computeVbbManualRanges(),
      };
      vbbAnalyze?.addEventListener("click", (e) => {
        const btn = e.currentTarget;
        withVbbWake(() => runVbbAnalyze())
          .catch((err) => setError(vbbError, err.message || String(err)))
          .finally(() => blurVbbActionButton(btn));
      });
        vbbOneclick?.addEventListener("click", () => withVbbWake(() => runVbbOneClick()).catch((err) => setError(vbbError, err.message || String(err))));
        $("#vbb-merge-video")?.addEventListener("click", () =>
          withVbbWake(() => mergeVbbVideosToOne()).catch((err) => setError(vbbError, err.message || String(err)))
        );
      vbbRun?.addEventListener("click", (e) => {
        const btn = e.currentTarget;
        withVbbWake(() => runVbbExecute())
          .catch((err) => setError(vbbError, err.message || String(err)))
          .finally(() => blurVbbActionButton(btn));
      });
      vbbMerge?.addEventListener("click", () => withVbbWake(() => runVbbMerge()).catch((err) => setError(vbbError, err.message || String(err))));
      vbbZip?.addEventListener("click", () => {
        packDownloadVbbGifs().catch((err) => setError(vbbError, err.message || String(err)));
      });
      vbbAbort?.addEventListener("click", () => {
        abortVbb = true;
        abortV2g = true;
        terminateFfmpegInstance({ revokeAssets: false });
        scheduleFfmpegPrewarm();
      });
      vbbJumpGo?.addEventListener("click", () => {
        const t = parseVbbJumpTime(vbbJumpTime?.value);
        if (t == null) {
          toast("时间格式无效，如 2:30 或 150");
          return;
        }
        seekVbbPreview(t);
      });
      vbbJumpTime?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") vbbJumpGo?.click();
      });
      vbbPlay?.addEventListener("click", () => {
        if (!vbbVideo?.src) return;
        if (vbbVideo.paused) {
          const d = vbbVideoDuration();
          if (d >= VBB_LONG_VIDEO_SEC) toast("长视频播放较耗内存，建议拖动定位");
          vbbVideo.play().catch(() => {});
        } else {
          pauseVbbPreview();
        }
      });
      vbbVideo?.addEventListener("play", () => {
        vbbPlaying = true;
        if (vbbPlay) vbbPlay.textContent = "暂停";
      });
      vbbVideo?.addEventListener("pause", () => {
        vbbPlaying = false;
        if (vbbPlay) vbbPlay.textContent = "播放";
      });
      vbbVideo?.addEventListener("timeupdate", () => {
        if (isVbbManualMode()) {
          if (!vbbScrubbing) paintVbbNow();
          return;
        }
        enforceVbbEditPlaybackWindow();
      });
      vbbVideo?.addEventListener("seeked", () => {
        if (!isVbbManualMode()) return;
        paintVbbNow();
      });
      vbbScrub?.addEventListener("input", () => {
        if (!vbbVideo?.src) return;
        vbbScrubbing = true;
        pauseVbbPreview();
        const t = vbbScrubValueToTime(vbbScrub.value);
        paintVbbNow();
        scheduleVbbSeek(t, { fromScrub: true, keepPlaying: false });
      });
      vbbScrub?.addEventListener("change", () => {
        vbbScrubbing = false;
        flushVbbSeek();
        paintVbbManualControls();
      });
      vbbMarkTap?.addEventListener("click", tapVbbMark);
      vbbMarkUndo?.addEventListener("click", undoVbbMark);
      vbbMarkClear?.addEventListener("click", () => {
        clearVbbMarks();
        toast("已清空标记");
      });
      vbbNudgeM1?.addEventListener("click", () => nudgeVbbPreview(-1));
      vbbNudgeM01?.addEventListener("click", () => nudgeVbbPreview(-0.1));
      vbbNudgeP01?.addEventListener("click", () => nudgeVbbPreview(0.1));
      vbbNudgeP1?.addEventListener("click", () => nudgeVbbPreview(1));
      syncVbbWorkflowUi();
      syncVbbModeUi();
      setVbbButtons();
      flushPendingFileInput(vbbFile, (files) =>
        loadVbbFiles(files).catch((err) => {
          clearVbb();
          setError(vbbError, err.message || String(err));
        })
      );
  