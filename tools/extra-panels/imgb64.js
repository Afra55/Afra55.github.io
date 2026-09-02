(() => {
  "use strict";

  const P = window.DevToolsPure;
  const K = window.DevToolsExtraKit;
  if (!P || !K) return;
  const { $, $$, setError, toast, bindPanel, flushPendingFileInput, formatKb, EBind } = K;
  const escapeHtml = P.escapeHtml;

    bindPanel("imgb64", () => {
  
        $("#img-file")?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        setError($("#img-error"), "请选择图片文件");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result || "");
        $("#img-b64").value = dataUrl;
        $("#img-preview").src = dataUrl;
        $("#img-meta").textContent = `${file.name} · ${(file.size / 1024).toFixed(1)} KB · ${file.type}`;
        setError($("#img-error"), "");
      };
      reader.onerror = () => setError($("#img-error"), "读取图片失败");
      reader.readAsDataURL(file);
    });
  
    
    });
})();
