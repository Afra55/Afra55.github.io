(() => {
  "use strict";

  const P = window.DevToolsPure;
  const K = window.DevToolsExtraKit;
  if (!P || !K) return;
  const { $, $$, setError, toast, bindPanel, flushPendingFileInput, formatKb, EBind } = K;
  const escapeHtml = P.escapeHtml;

    let cHex;
    let cRgb;
    let cHsl;
    let cSwatch;
    let cPreview;
    let cError;
    let colorSync = false;
  
    function applyColorSource(source) {
      if (colorSync) return;
      try {
        const value = source === "hex" ? cHex.value : source === "rgb" ? cRgb.value : cHsl.value;
        const color = P.colorFrom(source, value);
        colorSync = true;
        cHex.value = color.hex;
        cRgb.value = color.rgb;
        cHsl.value = color.hsl;
        cSwatch.style.backgroundColor = color.rgb;
        cPreview.textContent = color.hex;
        setError(cError, "");
      } catch (err) {
        setError(cError, err.message || String(err));
      } finally {
        colorSync = false;
      }
    }
  
    bindPanel("color", () => {
        cHex = $("#c-hex");
        cRgb = $("#c-rgb");
        cHsl = $("#c-hsl");
        cSwatch = $("#c-swatch");
        cPreview = $("#c-preview-hex");
        cError = $("#c-error");
  
        cHex?.addEventListener("input", () => applyColorSource("hex"));
    cRgb?.addEventListener("input", () => applyColorSource("rgb"));
    cHsl?.addEventListener("input", () => applyColorSource("hsl"));
    applyColorSource("hex");
  
    
    });
})();
