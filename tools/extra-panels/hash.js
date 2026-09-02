(() => {
  "use strict";

  const P = window.DevToolsPure;
  const K = window.DevToolsExtraKit;
  if (!P || !K) return;
  const { $, $$, setError, toast, bindPanel, flushPendingFileInput, formatKb, EBind } = K;
  const escapeHtml = P.escapeHtml;

    async function sha256(text) {
      const data = new TextEncoder().encode(text);
      const digest = await crypto.subtle.digest("SHA-256", data);
      return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    }
  
    bindPanel("hash", () => {
  
        $("#hash-run")?.addEventListener("click", async () => {
      const text = $("#hash-input").value;
      try {
        $("#hash-md5").textContent = P.md5(text);
        $("#hash-sha256").textContent = await sha256(text);
        setError($("#hash-error"), "");
      } catch (err) {
        setError($("#hash-error"), err.message || String(err));
      }
    });
  
    
    });
})();
