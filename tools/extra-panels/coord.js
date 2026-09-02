(() => {
  "use strict";

  const P = window.DevToolsPure;
  const K = window.DevToolsExtraKit;
  if (!P || !K) return;
  const { $, $$, setError, toast, bindPanel, flushPendingFileInput, formatKb, EBind } = K;
  const escapeHtml = P.escapeHtml;

    try {
      let coordInput;
      let coordSystem;
      let coordMeta;
      let coordError;
      const systems = ["wgs84", "gcj02", "bd09", "cgcs2000"];
      let coordOut;
  
      function refreshCoordConvert() {
        if (!coordInput || !coordSystem) return;
        const text = coordInput.value;
        if (!String(text || "").trim()) {
          systems.forEach((key) => {
            if (coordOut[key].decimal) coordOut[key].decimal.textContent = "—";
            if (coordOut[key].dms) coordOut[key].dms.textContent = "—";
          });
          setError(coordError, "");
          if (coordMeta) {
            coordMeta.textContent = "每行一组坐标，顺序为经度在前、纬度在后。CGCS2000 按 WGS84 近似处理。";
          }
          return;
        }
        try {
          const result = P.convertCoordinateLines(coordSystem.value, text);
          systems.forEach((key) => {
            const decimal = result.decimal[key] || "";
            const dms = result.dms[key] || "";
            if (coordOut[key].decimal) {
              coordOut[key].decimal.textContent = decimal || "—";
              coordOut[key].decimal.title = decimal;
            }
            if (coordOut[key].dms) {
              coordOut[key].dms.textContent = dms || "—";
              coordOut[key].dms.title = dms;
            }
          });
          setError(coordError, result.fail ? `${result.error}（失败 ${result.fail} 行）` : "");
          if (coordMeta) {
            coordMeta.textContent = result.fail
              ? `成功 ${result.ok} 行 · 失败 ${result.fail} 行`
              : `已转换 ${result.ok} 组坐标`;
          }
        } catch (err) {
          systems.forEach((key) => {
            if (coordOut[key].decimal) coordOut[key].decimal.textContent = "—";
            if (coordOut[key].dms) coordOut[key].dms.textContent = "—";
          });
          setError(coordError, err.message || String(err));
          if (coordMeta) coordMeta.textContent = "请检查输入格式：lng,lat";
        }
      }
  
      function useCoordResult(system) {
        const el = coordOut[system]?.decimal;
        if (!coordInput || !el) return;
        const v = el.textContent || "";
        const cleaned = v
          .split(/\r\n|\n|\r/)
          .map((line) => line.trim())
          .filter((line) => line && line !== "—")
          .join("\n");
        if (!cleaned) return;
        coordInput.value = cleaned;
        if (coordSystem) coordSystem.value = system;
        refreshCoordConvert();
        toast(`已填入 ${system.toUpperCase()}`);
      }
  
      bindPanel("coord", () => {
            coordInput = $("#coord-input");
            coordSystem = $("#coord-system");
            coordMeta = $("#coord-meta");
            coordError = $("#coord-error");
            coordOut = Object.fromEntries(
              systems.map((key) => [
                key,
                {
                  decimal: $(`#coord-${key}`),
                  dms: $(`#coord-${key}-dms`),
                },
              ])
            );
  
            coordInput?.addEventListener("input", refreshCoordConvert);
      coordSystem?.addEventListener("change", refreshCoordConvert);
      $("#coord-clear")?.addEventListener("click", () => {
        if (coordInput) coordInput.value = "";
        refreshCoordConvert();
      });
      $("#coord-use-wgs84")?.addEventListener("click", () => useCoordResult("wgs84"));
      $("#coord-use-gcj02")?.addEventListener("click", () => useCoordResult("gcj02"));
      $("#coord-use-bd09")?.addEventListener("click", () => useCoordResult("bd09"));
      refreshCoordConvert();
      });
    } catch (err) {
      console.error("coord convert init failed", err);
    }
})();
