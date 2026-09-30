(() => {
  "use strict";

  const P = window.DevToolsPure;
  const K = window.DevToolsExtraKit;
  if (!P || !K) return;
  const { $, setError, toast, bindPanel, formatKb } = K;

  function sniffMimeFromB64(b64) {
    const s = String(b64 || "").replace(/\s+/g, "");
    if (s.startsWith("iVBORw0KGgo")) return "image/png";
    if (s.startsWith("/9j/")) return "image/jpeg";
    if (s.startsWith("R0lGOD")) return "image/gif";
    if (s.startsWith("UklGR")) return "image/webp";
    if (s.startsWith("Qk")) return "image/bmp";
    return "";
  }

  function normalizeB64(raw) {
    let b = String(raw || "").replace(/\s+/g, "");
    const rem = b.length % 4;
    if (rem === 1) b = b.slice(0, -1);
    else if (rem === 2) b += "==";
    else if (rem === 3) b += "=";
    return b;
  }

  function parseImageInput(text) {
    const raw = String(text || "").trim();
    if (!raw) throw new Error("请粘贴 Data URL 或纯 Base64");
    let mime = "";
    let b64 = "";
    const dataM = raw.match(/^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i);
    if (dataM) {
      mime = dataM[1].toLowerCase();
      b64 = normalizeB64(dataM[2]);
    } else {
      const wrapped = raw.match(
        /^[\s"'`（(【\[]*data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+?)[\s"'`）)】\]]*$/i
      );
      if (wrapped) {
        mime = wrapped[1].toLowerCase();
        b64 = normalizeB64(wrapped[2]);
      } else {
        b64 = normalizeB64(raw.replace(/^data:[^,]*,/i, ""));
        mime = sniffMimeFromB64(b64);
        if (!mime) {
          throw new Error("无法识别图片：请使用 data:image/...;base64, 前缀，或粘贴 PNG/JPEG/GIF/WebP 的纯 Base64");
        }
      }
    }
    if (b64.length < 24) throw new Error("Base64 过短，不像有效图片数据");
    let bytes;
    try {
      const bin = atob(b64);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } catch (_) {
      throw new Error("Base64 解码失败：请检查是否含非法字符或截断");
    }
    if (!bytes.length) throw new Error("解码结果为空");
    const dataUrl = `data:${mime};base64,${b64}`;
    return { mime, b64, bytes, dataUrl };
  }

  function extFromMime(mime) {
    const m = String(mime || "").toLowerCase();
    if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
    if (m.includes("webp")) return "webp";
    if (m.includes("gif")) return "gif";
    if (m.includes("bmp")) return "bmp";
    if (m.includes("svg")) return "svg";
    return "png";
  }

  bindPanel("imgb64", () => {
    const preview = $("#img-preview");
    const meta = $("#img-meta");
    const ta = $("#img-b64");
    const err = $("#img-error");
    const dl = $("#img-b64-download");
    let objectUrl = "";

    function revoke() {
      if (objectUrl) {
        try {
          URL.revokeObjectURL(objectUrl);
        } catch (_) {}
        objectUrl = "";
      }
    }

    function showDecoded({ mime, bytes, dataUrl }) {
      revoke();
      const blob = new Blob([bytes], { type: mime });
      objectUrl = URL.createObjectURL(blob);
      if (preview) {
        preview.src = dataUrl;
        preview.alt = "Base64 解码预览";
      }
      if (meta) {
        meta.textContent = `${mime} · ${formatKb ? formatKb(bytes.length) : `${(bytes.length / 1024).toFixed(1)} KB`}`;
      }
      if (dl) {
        dl.hidden = false;
        dl.href = objectUrl;
        dl.download = `image.${extFromMime(mime)}`;
      }
      if (ta && ta.value.trim() !== dataUrl) ta.value = dataUrl;
      setError(err, "");
    }

    $("#img-file")?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        setError(err, "请选择图片文件");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result || "");
        if (ta) ta.value = dataUrl;
        if (preview) {
          preview.src = dataUrl;
          preview.alt = file.name || "图片预览";
        }
        if (meta) meta.textContent = `${file.name} · ${(file.size / 1024).toFixed(1)} KB · ${file.type}`;
        revoke();
        if (dl) {
          dl.hidden = false;
          dl.href = dataUrl;
          dl.download = file.name || `image.${extFromMime(file.type)}`;
        }
        setError(err, "");
      };
      reader.onerror = () => setError(err, "读取图片失败");
      reader.readAsDataURL(file);
      e.target.value = "";
    });

    function decodeFromTextarea() {
      try {
        const parsed = parseImageInput(ta?.value || "");
        // 校验浏览器能否当图画出来
        const img = new Image();
        img.onload = () => {
          showDecoded(parsed);
          toast("已解码为图片");
        };
        img.onerror = () => setError(err, "解码后不是有效图片（可能是文本 Base64，请用「Base64」工具）");
        img.src = parsed.dataUrl;
      } catch (e) {
        setError(err, e.message || String(e));
        if (dl) dl.hidden = true;
      }
    }

    $("#img-b64-decode")?.addEventListener("click", decodeFromTextarea);
    ta?.addEventListener("paste", () => {
      window.setTimeout(() => {
        const v = String(ta.value || "").trim();
        if (/^data:image\//i.test(v) || v.length > 80) decodeFromTextarea();
      }, 0);
    });
  });
})();
