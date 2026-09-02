(() => {
  "use strict";

  const P = window.DevToolsPure;
  const K = window.DevToolsExtraKit;
  if (!P || !K) return;
  const { $, $$, setError, toast, bindPanel, flushPendingFileInput, formatKb, EBind } = K;
  const escapeHtml = P.escapeHtml;

    bindPanel("yaml", () => {
  
        $("#yaml-to-json")?.addEventListener("click", () => {
      try {
        if (typeof jsyaml === "undefined") throw new Error("js-yaml 未加载");
        const data = jsyaml.load($("#yaml-in").value);
        $("#json-from-yaml").value = JSON.stringify(data, null, 2);
        setError($("#yaml-error"), "");
      } catch (err) {
        setError($("#yaml-error"), err.message || String(err));
      }
    });
    $("#json-to-yaml")?.addEventListener("click", () => {
      try {
        if (typeof jsyaml === "undefined") throw new Error("js-yaml 未加载");
        const data = JSON.parse($("#json-from-yaml").value);
        $("#yaml-in").value = jsyaml.dump(data);
        setError($("#yaml-error"), "");
      } catch (err) {
        setError($("#yaml-error"), err.message || String(err));
      }
    });
    if (document.documentElement.dataset.bootPanel === "yaml") {
      $("#yaml-to-json")?.click();
    }
  
    
    });
})();
