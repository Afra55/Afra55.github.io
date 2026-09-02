(() => {
  "use strict";

  const P = window.DevToolsPure;
  const K = window.DevToolsExtraKit;
  if (!P || !K) return;
  const { $, $$, setError, toast, bindPanel, flushPendingFileInput, formatKb, EBind } = K;
  const escapeHtml = P.escapeHtml;

    let cronInput;
  
    function runCron() {
      if (!cronInput) return;
      try {
        const expr = cronInput.value;
        $("#cron-desc").textContent = P.describeCron(expr);
        const next = P.nextCronTimes(expr, Date.now(), 8);
        $("#cron-next").textContent = next.map((ms, i) => `${i + 1}. ${P.formatDateTime(ms)}`).join("\n");
        setError($("#cron-error"), "");
      } catch (err) {
        $("#cron-desc").textContent = "";
        $("#cron-next").textContent = "";
        setError($("#cron-error"), err.message || String(err));
      }
    }
    bindPanel("cron", () => {
          cronInput = $("#cron-input");
  
        $("#cron-run")?.addEventListener("click", runCron);
    $("#cron-input")?.addEventListener("change", runCron);
    if ($("#cron-input")) runCron();
  
    
    });

  window.DevToolsExtraBoot = window.DevToolsExtraBoot || {};
  window.DevToolsExtraBoot["cron"] = () => { try { runCron(); } catch (_) {} };
})();
