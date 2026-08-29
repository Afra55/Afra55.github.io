(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(s) {
    return escapeHtml(s);
  }

  function toast(msg) {
    let el = document.getElementById("adb-cmds-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "adb-cmds-toast";
      el.className = "adb-cmds-toast";
      document.body.appendChild(el);
    }
    el.textContent = String(msg || "");
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      el.hidden = true;
    }, 1800);
  }

  async function copyText(text) {
    const s = String(text || "");
    if (!s) return false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(s);
        return true;
      }
    } catch (_) {}
    try {
      const ta = document.createElement("textarea");
      ta.value = s;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch (_) {
      return false;
    }
  }

  const searchEl = $("#adb-cmds-search");
  const listEl = $("#adb-cmds-list");
  const metaEl = $("#adb-cmds-meta");
  let data = null;
  let filter = "";

  async function loadData() {
    if (data) return data;
    const res = await fetch("./lib/adb-commands.json");
    if (!res.ok) throw new Error("无法加载 ADB 命令数据");
    data = await res.json();
    return data;
  }

  function render() {
    if (!listEl || !data) return;
    const q = filter.trim().toLowerCase();
    const total = data.reduce((s, g) => s + (g.commands?.length || 0), 0);
    let shown = 0;
    const html = data
      .map((group) => {
        const items = (group.commands || []).filter((item) => {
          if (!q) return true;
          const hay = `${group.category} ${item.cmd} ${item.desc}`.toLowerCase();
          return hay.includes(q);
        });
        shown += items.length;
        if (!items.length) return "";
        return `<section class="adb-cmds-group">
          <h2 class="adb-cmds-cat">${escapeHtml(group.category)}</h2>
          <ul class="adb-cmds-items">
            ${items
              .map(
                (item) => `<li class="adb-cmd-row">
              <button type="button" class="adb-cmd-copy mono" data-cmd="${escapeAttr(item.cmd)}" title="点击复制">${escapeHtml(item.cmd)}</button>
              <p class="adb-cmd-desc">${escapeHtml(item.desc)}</p>
            </li>`
              )
              .join("")}
          </ul>
        </section>`;
      })
      .join("");
    listEl.innerHTML = html || `<p class="hint adb-cmds-empty">没有匹配的命令，请换个关键词。</p>`;
    if (metaEl) {
      metaEl.textContent = q ? `显示 ${shown} / ${total} 条 · 点击命令可复制` : `共 ${total} 条 · 点击命令可复制`;
    }
  }

  async function boot() {
    if (!listEl) return;
    try {
      await loadData();
      render();
    } catch (err) {
      listEl.innerHTML = `<p class="error">${escapeHtml(err.message || String(err))}</p>`;
    }
  }

  searchEl?.addEventListener("input", () => {
    filter = searchEl.value || "";
    render();
  });

  listEl?.addEventListener("click", async (e) => {
    const btn = e.target.closest?.(".adb-cmd-copy");
    if (!btn?.dataset.cmd) return;
    const ok = await copyText(btn.dataset.cmd);
    toast(ok ? "已复制命令" : "复制失败，请手动选择");
  });

  boot();
})();
