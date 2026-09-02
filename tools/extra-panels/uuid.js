(() => {
  "use strict";

  const P = window.DevToolsPure;
  const K = window.DevToolsExtraKit;
  if (!P || !K) return;
  const { $, $$, setError, toast, bindPanel, flushPendingFileInput, formatKb, EBind } = K;
  const escapeHtml = P.escapeHtml;

    let countEl;
    let outEl;
  
    function genUuid() {
      if (!countEl || !outEl) return;
      const count = Math.min(200, Math.max(1, Number(countEl.value) || 1));
      const upper = $("#uuid-upper")?.checked;
      const noHyphen = $("#uuid-nohyphen")?.checked;
      const list = [];
      for (let i = 0; i < count; i++) list.push(P.formatUuid(P.uuidv4(), { upper, noHyphen }));
      outEl.value = list.join("\n");
    }
    bindPanel("uuid", () => {
          countEl = $("#uuid-count");
          outEl = $("#uuid-out");
  
        $("#uuid-gen")?.addEventListener("click", genUuid);
    if ($("#uuid-count")) genUuid();
  
    
    });

  window.DevToolsExtraBoot = window.DevToolsExtraBoot || {};
  window.DevToolsExtraBoot["uuid"] = () => { try { genUuid(); } catch (_) {} };
})();
