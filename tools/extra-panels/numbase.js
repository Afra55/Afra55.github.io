(() => {
  "use strict";

  const P = window.DevToolsPure;
  const K = window.DevToolsExtraKit;
  if (!P || !K) return;
  const { $, $$, setError, toast, bindPanel, flushPendingFileInput, formatKb, EBind } = K;
  const escapeHtml = P.escapeHtml;

    let nbInput;
    let nbFrom;
    let nbBin;
    let nbOct;
    let nbDec;
    let nbHex;
    let nbError;
  
    function convertBase() {
      if (!nbInput || !nbFrom || !nbBin || !nbOct || !nbDec || !nbHex) return;
      try {
        const raw = (nbInput.value || "").trim();
        if (!raw) throw new Error("请输入数值");
        const base = Number(nbFrom.value);
        const n = parseInt(raw, base);
        if (!Number.isFinite(n)) throw new Error("数值无效");
        nbBin.textContent = n.toString(2);
        nbOct.textContent = n.toString(8);
        nbDec.textContent = n.toString(10);
        nbHex.textContent = n.toString(16).toUpperCase();
        setError(nbError, "");
      } catch (err) {
        nbBin.textContent = nbOct.textContent = nbDec.textContent = nbHex.textContent = "—";
        setError(nbError, err.message || String(err));
      }
    }
    bindPanel("numbase", () => {
        nbInput = $("#nb-input");
        nbFrom = $("#nb-from");
        nbBin = $("#nb-bin");
        nbOct = $("#nb-oct");
        nbDec = $("#nb-dec");
        nbHex = $("#nb-hex");
        nbError = $("#nb-error");
  
        [nbInput, nbFrom].forEach((el) => el?.addEventListener("input", convertBase));
    nbFrom?.addEventListener("change", convertBase);
    if (nbInput) convertBase();
  
    
    });

  window.DevToolsExtraBoot = window.DevToolsExtraBoot || {};
  window.DevToolsExtraBoot["numbase"] = () => { try { convertBase(); } catch (_) {} };
})();
