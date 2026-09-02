(() => {
  "use strict";

  const P = window.DevToolsPure;
  const K = window.DevToolsExtraKit;
  if (!P || !K) return;
  const { $, $$, setError, toast, bindPanel, flushPendingFileInput, formatKb, EBind } = K;
  const escapeHtml = P.escapeHtml;

    let tdA;
    let tdB;
    let tdResult;
    let tdValue;
    let tdError;
  
    function fillNowDate(input) {
      if (!input) return;
      input.value = P.formatDateTime(Date.now());
    }
  
    function fillNowTs(input, asMs) {
      if (!input) return;
      const now = Date.now();
      input.value = String(asMs ? now : Math.floor(now / 1000));
    }
  
    function calcTimeDiff() {
      try {
        const r = P.timeDiff(tdA.value, tdB.value);
        tdValue.textContent = r.text;
        tdResult.hidden = false;
        setError(tdError, "");
      } catch (err) {
        tdResult.hidden = true;
        setError(tdError, err.message || String(err));
      }
    }
  
    bindPanel("timediff", () => {
        tdA = $("#td-a");
        tdB = $("#td-b");
        tdResult = $("#td-result");
        tdValue = $("#td-result-value");
        tdError = $("#td-error");
  
        $("#td-now-a")?.addEventListener("click", () => fillNowDate(tdA));
    $("#td-now-b")?.addEventListener("click", () => fillNowDate(tdB));
    $("#td-ts-a")?.addEventListener("click", () => fillNowTs(tdA, false));
    $("#td-ts-b")?.addEventListener("click", () => fillNowTs(tdB, false));
    $("#td-ms-a")?.addEventListener("click", () => fillNowTs(tdA, true));
    $("#td-ms-b")?.addEventListener("click", () => fillNowTs(tdB, true));
    $("#td-calc")?.addEventListener("click", calcTimeDiff);
    [tdA, tdB].forEach((el) => {
      el?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") calcTimeDiff();
      });
    });
  
    // 默认演示：秒时间戳 vs 日期时间（面板按需挂载后再初始化）
    if (tdA && tdB) {
      fillNowTs(tdA, false);
      fillNowDate(tdB);
      tdB.value = P.formatDateTime(Date.now() + 86400000);
    }
  
    
    });
})();
