(() => {
  "use strict";

  const MEDIA_IDS = new Set(["gifmaker", "vsplit", "vbb", "vtrim", "audio"]);

  /** 新增工具时：在 app.js 的 TOOL_GROUPS / TOOL_META / ABOUT_DESC 同步更新 */
  function $(sel, root = document) {
    return root.querySelector(sel);
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function toast(msg) {
    const el = $("#toast");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    el.classList.add("is-show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      el.classList.remove("is-show");
      setTimeout(() => {
        el.hidden = true;
      }, 200);
    }, 2000);
  }

  function isLikelyMobile() {
    return window.matchMedia("(max-width: 900px), (pointer: coarse)").matches;
  }

  /** 分享落地到关于页；标题要让对方一眼知道这是什么站 */
  const SHARE_SITE_TITLE = "DevTools · 本地实用小工具合集";
  const SHARE_SITE_TEXT =
    "时间戳、颜色、JSON、备忘录、GIF/视频、ADB 等 · 浏览器本地处理，数据不上传。可用 Chrome/Edge 安装到桌面。打开即可用：";

  function shareUrl() {
    try {
      const u = new URL(location.href);
      u.hash = "about";
      u.search = "";
      return u.toString();
    } catch (_) {
      return `${location.origin}${location.pathname || "/"}#about`;
    }
  }

  function sharePayload() {
    const url = shareUrl();
    return {
      title: SHARE_SITE_TITLE,
      text: SHARE_SITE_TEXT,
      url,
    };
  }

  async function copyShareLink() {
    const url = shareUrl();
    const urlEl = $("#about-share-url");
    if (urlEl) {
      urlEl.hidden = false;
      urlEl.textContent = url;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        toast("链接已复制");
        return true;
      }
    } catch (_) {}
    try {
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      if (ok) {
        toast("链接已复制");
        return true;
      }
    } catch (_) {}
    toast("复制失败，请手动长按链接");
    return false;
  }

  async function shareSite() {
    const data = sharePayload();
    const urlEl = $("#about-share-url");
    if (urlEl) {
      urlEl.hidden = false;
      urlEl.textContent = data.url;
    }

    // 微信等会抓取当前 document.title，而不一定用 share() 的 title
    const prevTitle = document.title;
    document.title = data.title;
    const restoreTitle = () => {
      try {
        document.title = prevTitle;
      } catch (_) {}
    };

    if (typeof navigator.share === "function") {
      try {
        // 优先带 url；部分 WebView 只接受 text
        if (!navigator.canShare || navigator.canShare(data)) {
          await navigator.share(data);
          restoreTitle();
          toast("已打开系统分享");
          return;
        }
      } catch (err) {
        if (err && (err.name === "AbortError" || /abort|cancel|取消/i.test(String(err.message || "")))) {
          restoreTitle();
          toast("已取消分享");
          return;
        }
        try {
          await navigator.share({ title: data.title, text: `${data.text}\n${data.url}` });
          restoreTitle();
          toast("已打开系统分享");
          return;
        } catch (err2) {
          if (err2 && (err2.name === "AbortError" || /abort|cancel|取消/i.test(String(err2.message || "")))) {
            restoreTitle();
            toast("已取消分享");
            return;
          }
        }
      }
    }

    restoreTitle();
    await copyShareLink();
    if (!isLikelyMobile()) toast("当前环境不支持系统分享，已复制链接");
  }

  function syncShareHint() {
    const hint = $(".about-share-hint");
    if (!hint) return;
    if (typeof navigator.share === "function") {
      hint.textContent = isLikelyMobile()
        ? "点「分享本站」可调起微信 / 系统分享；也可复制链接。"
        : "可复制链接发送给他人；若系统支持也会调起分享面板。";
    } else {
      hint.textContent = "当前浏览器不支持系统分享，请用「复制链接」发给朋友。";
    }
  }

  function renderAbout() {
    const host = $("#about-catalog");
    if (!host) return;
    const catalog = window.DevToolsCatalog;
    if (!catalog?.groups?.length) {
      host.innerHTML = `<p class="hint">工具目录加载中…刷新页面即可。</p>`;
      return;
    }

    const meta = catalog.meta || {};
    const about = catalog.about || {};
    const version = window.TOOLS_VERSION || document.getElementById("site-tools-version")?.textContent || "";

    const verEl = $("#about-version");
    if (verEl) verEl.textContent = version ? `当前版本 ${version}` : "";

    const urlEl = $("#about-share-url");
    if (urlEl && !urlEl.textContent) urlEl.textContent = shareUrl();
    syncShareHint();

    host.innerHTML = catalog.groups
      .map((g) => {
        const cards = (g.tools || [])
          .map((id) => {
            const name = meta[id]?.name || id;
            const desc = about[id] || meta[id]?.aliases?.slice(0, 4).join(" · ") || "本地实用工具";
            const href = MEDIA_IDS.has(id) ? `#media/${id}` : `#${id}`;
            return `<article class="about-card">
              <div class="about-card-head">
                <h3>${escapeHtml(name)}</h3>
                <a class="secondary-btn about-go" href="${href}">打开</a>
              </div>
              <p class="hint tight">${escapeHtml(desc)}</p>
            </article>`;
          })
          .join("");
        return `<section class="about-group" data-about-group="${escapeHtml(g.id)}">
          <h2 class="subhead">${escapeHtml(g.label)}</h2>
          <div class="about-grid">${cards}</div>
        </section>`;
      })
      .join("");
  }

  function bindShare() {
    $("#about-share")?.addEventListener("click", () => {
      shareSite().catch(() => copyShareLink());
    });
    $("#about-copy-link")?.addEventListener("click", () => {
      copyShareLink().catch(() => {});
    });
    syncShareHint();
  }

  function boot() {
    bindShare();
    renderAbout();
    if (!window.DevToolsCatalog) {
      let n = 0;
      const t = setInterval(() => {
        n += 1;
        if (window.DevToolsCatalog || n > 40) {
          clearInterval(t);
          renderAbout();
        }
      }, 50);
    }
    window.addEventListener("devtools:catalog", renderAbout);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.DevToolsAbout = { render: renderAbout, share: shareSite, copyLink: copyShareLink };
})();
