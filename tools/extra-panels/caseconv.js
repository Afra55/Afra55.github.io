(() => {
  "use strict";

  const P = window.DevToolsPure;
  const K = window.DevToolsExtraKit;
  if (!P || !K) return;
  const { $, $$, setError, toast, bindPanel, flushPendingFileInput, formatKb, EBind } = K;
  const escapeHtml = P.escapeHtml;

    try {
      let caseInput;
      let caseMeta;
      let caseMap;
  
      function refreshCaseConvert() {
        if (!caseInput) return;
        const result = P.convertCaseLines(caseInput.value);
        Object.keys(caseMap).forEach((key) => {
          const el = caseMap[key];
          if (!el) return;
          const value = result[key] || "";
          el.textContent = value || "—";
          el.title = value;
        });
        if (caseMeta) {
          caseMeta.textContent = result.count
            ? `已转换 ${result.count} 个名称`
            : "每行一个名称，自动识别并转换。";
        }
      }
  
      bindPanel("caseconv", () => {
            caseInput = $("#case-input");
            caseMeta = $("#case-meta");
            caseMap = {
              camel: $("#case-camel"),
              pascal: $("#case-pascal"),
              snake: $("#case-snake"),
              screaming: $("#case-screaming"),
              kebab: $("#case-kebab"),
              dot: $("#case-dot"),
              path: $("#case-path"),
              title: $("#case-title"),
            };
  
            caseInput?.addEventListener("input", refreshCaseConvert);
      $("#case-clear")?.addEventListener("click", () => {
        if (caseInput) caseInput.value = "";
        refreshCaseConvert();
      });
      $("#case-use-camel")?.addEventListener("click", () => {
        if (!caseInput || !caseMap.camel) return;
        const v = caseMap.camel.textContent;
        if (!v || v === "—") return;
        caseInput.value = v;
        refreshCaseConvert();
        toast("已填入 camelCase");
      });
      $("#case-use-snake")?.addEventListener("click", () => {
        if (!caseInput || !caseMap.snake) return;
        const v = caseMap.snake.textContent;
        if (!v || v === "—") return;
        caseInput.value = v;
        refreshCaseConvert();
        toast("已填入 snake_case");
      });
      $("#case-use-kebab")?.addEventListener("click", () => {
        if (!caseInput || !caseMap.kebab) return;
        const v = caseMap.kebab.textContent;
        if (!v || v === "—") return;
        caseInput.value = v;
        refreshCaseConvert();
        toast("已填入 kebab-case");
      });
      refreshCaseConvert();
      });
    } catch (err) {
      console.error("case convert init failed", err);
    }
})();
