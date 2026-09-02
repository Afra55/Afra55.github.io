(() => {
  "use strict";

  const P = window.DevToolsPure;
  const K = window.DevToolsExtraKit;
  if (!P || !K) return;
  const { $, $$, setError, toast, bindPanel, flushPendingFileInput, formatKb, EBind } = K;
  const escapeHtml = P.escapeHtml;

    try {
      let eyePick;
      let eyeFile;
      let eyeSwatch;
      let eyeHex;
      let eyeRgb;
      let eyeAhex;
      let eyeImg;
      let eyeMeta;
      let eyeHint;
      let eyeError;
      const hasEyeDropper = "EyeDropper" in window;
  
      function applyPickedColor(hex) {
        if (!eyeHex || !eyeRgb || !eyeAhex || !eyeSwatch) return;
        const c = P.colorFrom("hex", hex);
        eyeSwatch.style.backgroundColor = c.rgb;
        eyeHex.textContent = c.hex;
        eyeRgb.textContent = c.rgb;
        eyeAhex.textContent = P.rgbStringToAhex(c.rgb);
        setError(eyeError, "");
      }
  
      bindPanel("eyedropper", () => {
            eyePick = $("#eye-pick");
            eyeFile = $("#eye-file");
            eyeSwatch = $("#eye-swatch");
            eyeHex = $("#eye-hex");
            eyeRgb = $("#eye-rgb");
            eyeAhex = $("#eye-ahex");
            eyeImg = $("#eye-img");
            eyeMeta = $("#eye-meta");
            eyeHint = $("#eye-hint");
            eyeError = $("#eye-error");
  
            if (!hasEyeDropper) {
        if (eyeHint) {
          eyeHint.textContent = "当前浏览器不支持屏幕取色，请改用「上传图片取色」。Chrome / Edge 桌面版通常支持。";
        }
        if (eyePick) {
          eyePick.disabled = true;
          eyePick.title = "当前浏览器不支持 EyeDropper API";
          eyePick.textContent = "屏幕取色（不可用）";
        }
      }
  
      eyePick?.addEventListener("click", async () => {
        if (!hasEyeDropper) {
          setError(eyeError, "当前浏览器不支持屏幕取色，请改用图片取色");
          toast("请改用图片取色");
          return;
        }
        if (!window.isSecureContext) {
          setError(eyeError, "屏幕取色需要 HTTPS 安全上下文");
          toast("需要 HTTPS 才能取色");
          return;
        }
        try {
          setError(eyeError, "");
          toast("请在屏幕上点选颜色…");
          const eyeDropper = new window.EyeDropper();
          const result = await eyeDropper.open();
          applyPickedColor(result.sRGBHex);
          if (eyeMeta) eyeMeta.textContent = `屏幕取色：${result.sRGBHex}`;
          toast(`已取色 ${result.sRGBHex}`);
        } catch (err) {
          if (String(err && err.name) === "AbortError") {
            toast("已取消取色");
            return;
          }
          setError(eyeError, `取色失败：${err.message || err}`);
          toast("取色失败");
        }
      });
  
      eyeFile?.addEventListener("change", (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const url = URL.createObjectURL(file);
        if (eyeImg) {
          eyeImg.hidden = false;
          eyeImg.src = url;
        }
        if (eyeMeta) eyeMeta.textContent = `点击图片任意位置取色 · ${file.name}`;
        setError(eyeError, "");
        toast("图片已加载，点击图片取色");
        e.target.value = "";
      });
  
      eyeImg?.addEventListener("click", (e) => {
        try {
          if (!eyeImg.naturalWidth) {
            setError(eyeError, "图片尚未加载完成");
            return;
          }
          const rect = eyeImg.getBoundingClientRect();
          const scaleX = eyeImg.naturalWidth / rect.width;
          const scaleY = eyeImg.naturalHeight / rect.height;
          const x = Math.max(0, Math.min(eyeImg.naturalWidth - 1, Math.floor((e.clientX - rect.left) * scaleX)));
          const y = Math.max(0, Math.min(eyeImg.naturalHeight - 1, Math.floor((e.clientY - rect.top) * scaleY)));
          const canvas = document.createElement("canvas");
          canvas.width = eyeImg.naturalWidth;
          canvas.height = eyeImg.naturalHeight;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(eyeImg, 0, 0);
          const data = ctx.getImageData(x, y, 1, 1).data;
          const hex = `#${[data[0], data[1], data[2]].map((n) => n.toString(16).toUpperCase().padStart(2, "0")).join("")}`;
          applyPickedColor(hex);
          if (eyeMeta) eyeMeta.textContent = `图片取色：(${x}, ${y}) ${hex}`;
          toast(`已取色 ${hex}`);
        } catch (err) {
          setError(eyeError, `图片取色失败：${err.message || err}`);
          toast("图片取色失败");
        }
      });
      applyPickedColor("#2EC4B6");
      });
    } catch (err) {
      console.error("eyedropper init failed", err);
    }
})();
