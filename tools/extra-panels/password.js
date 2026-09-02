(() => {
  "use strict";

  const P = window.DevToolsPure;
  const K = window.DevToolsExtraKit;
  if (!P || !K) return;
  const { $, $$, setError, toast, bindPanel, flushPendingFileInput, formatKb, EBind } = K;
  const escapeHtml = P.escapeHtml;

    try {
      let pwLength;
      let pwCount;
      let pwUpper;
      let pwLower;
      let pwNumber;
      let pwSymbol;
      let pwNoAmbiguous;
      let pwOutput;
      let pwMeta;
      let pwError;
      let pwGenerate;
  
      function genPasswords(fromClick) {
        try {
          if (!pwOutput) throw new Error("密码输出框未找到");
          const list = P.generatePasswords({
            length: Math.min(128, Math.max(4, Number(pwLength?.value) || 16)),
            count: Math.min(20, Math.max(1, Number(pwCount?.value) || 1)),
            upper: !!pwUpper?.checked,
            lower: !!pwLower?.checked,
            number: !!pwNumber?.checked,
            symbol: !!pwSymbol?.checked,
            noAmbiguous: !!pwNoAmbiguous?.checked,
          });
          pwOutput.value = list.join("\n");
          // Also mirror into a data attribute so dump/debug can see it
          pwOutput.dataset.count = String(list.length);
          if (pwMeta) pwMeta.textContent = `已生成 ${list.length} 个密码 · 长度 ${list[0]?.length || 0}`;
          setError(pwError, "");
          if (fromClick) toast(`已生成 ${list.length} 个密码`);
        } catch (err) {
          if (pwOutput) pwOutput.value = "";
          if (pwMeta) pwMeta.textContent = "";
          setError(pwError, err.message || String(err));
          if (fromClick) toast(err.message || "生成失败");
        }
      }
  
      bindPanel("password", () => {
            pwLength = $("#pw-length");
            pwCount = $("#pw-count");
            pwUpper = $("#pw-upper");
            pwLower = $("#pw-lower");
            pwNumber = $("#pw-number");
            pwSymbol = $("#pw-symbol");
            pwNoAmbiguous = $("#pw-no-ambiguous");
            pwOutput = $("#pw-output");
            pwMeta = $("#pw-meta");
            pwError = $("#pw-error");
            pwGenerate = $("#pw-generate");
  
            pwGenerate?.addEventListener("click", (e) => {
        e.preventDefault();
        genPasswords(true);
      });
      [pwLength, pwCount, pwUpper, pwLower, pwNumber, pwSymbol, pwNoAmbiguous].forEach((el) => {
        el?.addEventListener("input", () => genPasswords(false));
        el?.addEventListener("change", () => genPasswords(false));
      });
      genPasswords(false);
      });
    } catch (err) {
      console.error("password init failed", err);
    }
})();
