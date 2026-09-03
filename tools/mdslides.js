(() => {
  "use strict";

  const SAMPLE = `# 标题页

本地 MD → 网页幻灯片

---

## 要点

- 纯前端演示
- 无需上传
- 支持基础 Markdown

---

## 结束

谢谢`;

  function $(sel) {
    return document.querySelector(sel);
  }

  function setErr(msg) {
    const el = $("#mdslides-error");
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = msg;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function mdInline(src) {
    let s = escapeHtml(src);
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\*(.+?)\*/g, "<em>$1</em>");
    s = s.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2">$1</a>');
    return s;
  }

  function mdBlock(src) {
    const lines = String(src || "").replace(/\r\n/g, "\n").split("\n");
    const out = [];
    let i = 0;
    let inCode = false;
    let code = [];
    while (i < lines.length) {
      const line = lines[i];
      if (line.startsWith("```")) {
        if (inCode) {
          out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
          code = [];
          inCode = false;
        } else {
          inCode = true;
        }
        i += 1;
        continue;
      }
      if (inCode) {
        code.push(line);
        i += 1;
        continue;
      }
      if (/^###\s+/.test(line)) out.push(`<h3>${mdInline(line.replace(/^###\s+/, ""))}</h3>`);
      else if (/^##\s+/.test(line)) out.push(`<h2>${mdInline(line.replace(/^##\s+/, ""))}</h2>`);
      else if (/^#\s+/.test(line)) out.push(`<h1>${mdInline(line.replace(/^#\s+/, ""))}</h1>`);
      else if (/^[-*]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
          items.push(`<li>${mdInline(lines[i].replace(/^[-*]\s+/, ""))}</li>`);
          i += 1;
        }
        out.push(`<ul>${items.join("")}</ul>`);
        continue;
      } else if (line.trim() === "") {
        out.push("");
      } else {
        out.push(`<p>${mdInline(line)}</p>`);
      }
      i += 1;
    }
    if (inCode) out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
    return out.join("\n");
  }

  function buildHtml(md, { autoSlide } = {}) {
    const parts = String(md || "")
      .replace(/\r\n/g, "\n")
      .split(/\n---\n/);
    const sections = parts
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => `<section>\n${mdBlock(p)}\n</section>`)
      .join("\n");
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>MD 幻灯片 · DevTools</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.css" />
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/theme/black.css" />
  <style>
    .reveal { font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
    .reveal h1, .reveal h2, .reveal h3 { text-transform: none; }
    .reveal code, .reveal pre { font-family: ui-monospace, Menlo, Consolas, monospace; }
  </style>
</head>
<body>
  <div class="reveal">
    <div class="slides">
${sections}
    </div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.js"><\/script>
  <script>
    Reveal.initialize({
      hash: true,
      slideNumber: true,
      transition: "fade",
      controlsTutorial: false
    });
    ${autoSlide ? "try { Reveal.toggleOverview(false); } catch (e) {}" : ""}
  <\/script>
</body>
</html>`;
  }

  function openDeck(auto) {
    setErr("");
    const src = $("#mdslides-src")?.value || "";
    if (!src.trim()) {
      setErr("请先输入 Markdown");
      return;
    }
    const html = buildHtml(src, { autoSlide: !!auto });
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (!win) {
      setErr("弹窗被拦截，请允许本站弹窗后重试");
      URL.revokeObjectURL(url);
      return;
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  let bound = false;
  function bind() {
    if (bound) return;
    bound = true;
    $("#mdslides-present")?.addEventListener("click", () => openDeck(true));
    $("#mdslides-preview")?.addEventListener("click", () => openDeck(false));
    $("#mdslides-sample")?.addEventListener("click", () => {
      const el = $("#mdslides-src");
      if (el) el.value = SAMPLE;
      setErr("");
    });
  }

  bind();
  document.addEventListener("devtools:route", (e) => {
    if (e.detail?.tool === "mdslides") bind();
  });
})();
