(() => {
  "use strict";

  const P = window.DevToolsPure;
  const K = window.DevToolsExtraKit;
  if (!P || !K) return;
  const { $, $$, setError, toast, bindPanel, flushPendingFileInput, formatKb, EBind } = K;
  const escapeHtml = P.escapeHtml;

    let urlRaw;
    let urlEnc;
    let urlError;
    bindPanel("url", () => {
        urlRaw = $("#url-raw");
        urlEnc = $("#url-enc");
        urlError = $("#url-error");
  
        $("#url-encode")?.addEventListener("click", () => {
      try {
        urlEnc.value = encodeURIComponent(urlRaw.value);
        setError(urlError, "");
      } catch (err) {
        setError(urlError, err.message || String(err));
      }
    });
    $("#url-decode")?.addEventListener("click", () => {
      try {
        urlRaw.value = decodeURIComponent(urlEnc.value);
        setError(urlError, "");
      } catch (err) {
        setError(urlError, "解码失败：内容不是合法的 URL 编码");
      }
    });
    $("#url-swap")?.addEventListener("click", () => {
      const t = urlRaw.value;
      urlRaw.value = urlEnc.value;
      urlEnc.value = t;
    });
  
    
    });
})();
