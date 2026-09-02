(() => {
  "use strict";

  const P = window.DevToolsPure;
  const K = window.DevToolsExtraKit;
  if (!P || !K) return;
  const { $, $$, setError, toast, bindPanel, flushPendingFileInput, formatKb, EBind } = K;
  const escapeHtml = P.escapeHtml;

    let textInput;
    let textStatsEl;
  
    function refreshTextStats() {
      if (!textInput || !textStatsEl) return;
      const s = P.textStats(textInput.value);
      textStatsEl.textContent = `字符 ${s.chars} · 非空白 ${s.charsNoSpace} · 词 ${s.words} · 行 ${s.lines}（非空 ${s.nonEmptyLines}）`;
    }
  
    bindPanel("text", () => {
        textInput = $("#text-input");
        textStatsEl = $("#text-stats");
  
        textInput?.addEventListener("input", refreshTextStats);
    $$("[data-text-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        textInput.value = P.transformText(textInput.value, btn.dataset.textAction);
        refreshTextStats();
      });
    });
    if (textInput) refreshTextStats();
  
    
    });

  window.DevToolsExtraBoot = window.DevToolsExtraBoot || {};
  window.DevToolsExtraBoot["text"] = () => { try { refreshTextStats(); } catch (_) {} };
})();
