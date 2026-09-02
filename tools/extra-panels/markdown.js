(() => {
  "use strict";

  const P = window.DevToolsPure;
  const K = window.DevToolsExtraKit;
  if (!P || !K) return;
  const { $, $$, setError, toast, bindPanel, flushPendingFileInput, formatKb, EBind } = K;
  const escapeHtml = P.escapeHtml;

    let mdInput;
    let mdPreview;
  
    function renderMarkdown(src) {
      let html = String(src || "");
      html = html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
      html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
      html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");
      html = html.replace(/```[\s\S]*?```/g, (m) => {
        const inner = m.slice(3, -3).replace(/^\w*\n/, "");
        return `<pre class="mono">${inner}</pre>`;
      });
      html = html.replace(/`([^`]+)`/g, '<code class="mono">$1</code>');
      html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
      html = html.replace(/__(.+?)__/g, "<strong>$1</strong>");
      html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
      html = html.replace(/_(.+?)_/g, "<em>$1</em>");
      html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
      html = html.replace(/^[-*] (.+)$/gm, "<li>$1</li>");
      html = html.replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);
      html = html.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");
      html = html.replace(/((?:<li>.*<\/li>\n?)+)(?!<\/ul>)/g, (m) => `<ol>${m}</ol>`);
      html = html.replace(/\n{2,}/g, "</p><p>");
      html = `<p>${html}</p>`;
      html = html.replace(/<p>\s*(<h[1-6]>)/g, "$1").replace(/(<\/h[1-6]>)\s*<\/p>/g, "$1");
      html = html.replace(/<p>\s*(<pre)/g, "$1").replace(/(<\/pre>)\s*<\/p>/g, "$1");
      html = html.replace(/<p>\s*(<ul)/g, "$1").replace(/(<\/ul>)\s*<\/p>/g, "$1");
      html = html.replace(/<p>\s*(<ol)/g, "$1").replace(/(<\/ol>)\s*<\/p>/g, "$1");
      html = html.replace(/<p>\s*<\/p>/g, "");
      return html;
    }
  
    function refreshMarkdown() {
      if (mdPreview) mdPreview.innerHTML = renderMarkdown(mdInput?.value || "");
    }
    bindPanel("markdown", (root) => {
        if (root?.dataset?.mdInited === "1") return;
        mdInput = $("#md-input", root);
        mdPreview = $("#md-preview", root);
        if (!mdInput || !mdPreview) return;
  
        mdInput.addEventListener("input", refreshMarkdown);
        if (root.dataset) root.dataset.mdInited = "1";
        refreshMarkdown();
    });

  window.DevToolsExtraBoot = window.DevToolsExtraBoot || {};
  window.DevToolsExtraBoot["markdown"] = () => { try { refreshMarkdown(); } catch (_) {} };
})();
