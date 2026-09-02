(() => {
  "use strict";

  const P = window.DevToolsPure;
  const K = window.DevToolsExtraKit;
  if (!P || !K) return;
  const { $, $$, setError, toast, bindPanel, flushPendingFileInput, formatKb, EBind } = K;
  const escapeHtml = P.escapeHtml;

    let qInput;
    let qOut;
    let jwtInput;
    let jwtOut;
    let qError;
  
    bindPanel("query", () => {
        qInput = $("#q-input");
        qOut = $("#q-out");
        jwtInput = $("#jwt-input");
        jwtOut = $("#jwt-out");
        qError = $("#q-error");
  
        $("#q-parse")?.addEventListener("click", () => {
      try {
        const obj = P.parseQuery(qInput.value);
        qOut.textContent = JSON.stringify(obj, null, 2);
        setError(qError, "");
      } catch (err) {
        setError(qError, err.message || String(err));
      }
    });
  
    $("#jwt-parse")?.addEventListener("click", () => {
      try {
        const parsed = P.parseJwt(jwtInput.value);
        jwtOut.textContent = JSON.stringify(parsed, null, 2);
        setError(qError, "");
      } catch (err) {
        setError(qError, err.message || String(err));
      }
    });
  
    
    });
})();
