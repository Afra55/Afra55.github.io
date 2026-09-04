(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);

  const panel = $("#feedbackhub");
  if (!panel) return;

  const OWNER = "Afra55";
  const REPO = "Afra55.github.io";
  const listEl = $("#fb-list");
  const metaEl = $("#fb-meta");
  const errEl = $("#fb-error");
  const filterEl = $("#fb-filter");
  const onlyDev = $("#fb-only-devtools");

  let cache = [];
  let sourceLabel = "";

  function showError(msg) {
    if (!errEl) return;
    if (!msg) {
      errEl.hidden = true;
      errEl.textContent = "";
      return;
    }
    errEl.hidden = false;
    errEl.textContent = msg;
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function toolMeta(id) {
    const meta = window.DEVTOOLS_REGISTRY?.meta || {};
    const hit = meta[id];
    if (hit && typeof hit === "object") return hit.name || id;
    if (typeof hit === "string") return hit;
    return id;
  }

  function parseToolId(title) {
    const t = String(title || "").trim();
    const m = t.match(/^devtools\/([a-z0-9_-]+)$/i);
    return m ? m[1] : "";
  }

  function fmtTime(iso) {
    try {
      return new Date(iso).toLocaleString();
    } catch (_) {
      return iso || "";
    }
  }

  function filtered() {
    const q = String(filterEl?.value || "")
      .trim()
      .toLowerCase();
    const only = onlyDev?.checked !== false;
    return cache.filter((row) => {
      if (only && !row.toolId) return false;
      if (!q) return true;
      const hay = `${row.toolId} ${row.toolName} ${row.title} ${row.excerpt} ${row.author}`.toLowerCase();
      return hay.includes(q);
    });
  }

  function render() {
    if (!listEl) return;
    const rows = filtered();
    if (!rows.length) {
      listEl.innerHTML = `<p class="hint tight">暂无评价线程。用户在<strong>其它工具页底部</strong>留言后，合入/同步快照会出现在这里；也可直接打开 GitHub Discussions。</p>`;
      if (metaEl) metaEl.textContent = `${sourceLabel || "已加载"} · 0 条`;
      return;
    }
    listEl.innerHTML = "";
    for (const row of rows) {
      const card = document.createElement("article");
      card.className = "fb-card panel-card";
      const toolLabel = row.toolId ? `${row.toolName}（${row.toolId}）` : row.title;
      card.innerHTML = `
        <div class="fb-card-head">
          <strong>${escapeHtml(toolLabel)}</strong>
          <span class="hint tight">${escapeHtml(fmtTime(row.updatedAt))}</span>
        </div>
        <p class="hint tight fb-card-meta">创建 ${escapeHtml(fmtTime(row.createdAt))} · 作者 ${escapeHtml(row.author || "—")} · 回复 ${row.comments} · ${escapeHtml(row.category || "")}</p>
        <p class="fb-excerpt">${escapeHtml(row.excerpt || "（尚无正文）")}</p>
        <div class="btn-row tool-actions" style="flex-wrap:wrap;margin-top:0.45rem">
          ${row.toolId ? `<a class="secondary-btn" href="#${escapeHtml(row.toolId)}">打开工具</a>` : ""}
          <a class="primary-btn" href="${escapeHtml(row.url)}" target="_blank" rel="noopener noreferrer">去 GitHub 回复</a>
        </div>`;
      listEl.appendChild(card);
    }
    if (metaEl) metaEl.textContent = `${sourceLabel || "已加载"} · 显示 ${rows.length} / 共 ${cache.length}`;
  }

  function normalizeNodes(nodes) {
    return (nodes || []).map((n) => {
      const toolId = parseToolId(n.title);
      const body = String(n.bodyText || n.body || "").replace(/\s+/g, " ").trim();
      return {
        number: n.number,
        title: n.title,
        url: n.url,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
        comments: n.comments?.totalCount ?? n.commentCount ?? 0,
        category: n.category?.name || "",
        author: n.author?.login || "",
        excerpt: body.slice(0, 180),
        toolId,
        toolName: toolId ? toolMeta(toolId) : n.title,
      };
    });
  }

  /** 浏览器直打 GraphQL 易触发未认证限流；仅作可选增强 */
  async function fetchLive() {
    const query = `query($owner:String!,$name:String!){
      repository(owner:$owner,name:$name){
        discussions(first:100,orderBy:{field:UPDATED_AT,direction:DESC}){
          nodes{
            number title url createdAt updatedAt bodyText
            comments{ totalCount }
            category{ name }
            author{ login }
          }
        }
      }
    }`;
    const res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        variables: { owner: OWNER, name: REPO },
      }),
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.message || `GitHub HTTP ${res.status}`);
    }
    if (data.errors?.length) {
      throw new Error(data.errors.map((e) => e.message).join("; "));
    }
    return normalizeNodes(data.data?.repository?.discussions?.nodes);
  }

  async function fetchSnapshot() {
    const ver = window.TOOLS_BUILD || "";
    const url = `./data/giscus-discussions.json?v=${encodeURIComponent(ver)}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`本地快照 ${res.status}`);
    const data = await res.json();
    return {
      rows: normalizeNodes(data.nodes || data.discussions || []),
      generatedAt: data.generatedAt || "",
    };
  }

  function isRateLimitMsg(msg) {
    return /rate limit/i.test(String(msg || ""));
  }

  /** 默认用站点快照（CI/脚本生成），避免浏览器 API 限流红字 */
  async function refresh({ tryLive = false } = {}) {
    showError("");
    if (metaEl) metaEl.textContent = "加载中…";

    let snapRows = [];
    let snapAt = "";
    try {
      const snap = await fetchSnapshot();
      snapRows = snap.rows;
      snapAt = snap.generatedAt || "";
    } catch (snapErr) {
      if (!tryLive) {
        cache = [];
        sourceLabel = "";
        showError(`无法加载评价快照：${snapErr.message}`);
        render();
        return;
      }
    }

    if (!tryLive) {
      cache = snapRows;
      sourceLabel = snapAt ? `站点快照 ${new Date(snapAt).toLocaleString()}` : "站点快照";
      render();
      return;
    }

    try {
      const rows = await fetchLive();
      cache = rows;
      sourceLabel = "实时 GitHub";
      showError("");
      render();
    } catch (liveErr) {
      cache = snapRows;
      sourceLabel = snapAt ? `站点快照 ${new Date(snapAt).toLocaleString()}` : "站点快照";
      if (isRateLimitMsg(liveErr.message)) {
        showError("");
        render();
        if (metaEl) {
          metaEl.textContent = `${sourceLabel} · 显示 ${filtered().length} / 共 ${cache.length}（GitHub 限流，已用快照）`;
        }
      } else {
        showError(`实时刷新未成功，仍显示快照。${liveErr.message}`);
        render();
      }
    }
  }

  $("#fb-refresh")?.addEventListener("click", () => refresh({ tryLive: true }).catch(() => {}));
  $("#fb-reload-snap")?.addEventListener("click", () => refresh({ tryLive: false }).catch(() => {}));
  filterEl?.addEventListener("input", () => render());
  onlyDev?.addEventListener("change", () => render());

  window.addEventListener("devtools:route", (ev) => {
    if (ev.detail?.tool === "feedbackhub") refresh({ tryLive: false }).catch(() => {});
  });

  if (location.hash.replace(/^#/, "").split("?")[0] === "feedbackhub") {
    refresh({ tryLive: false }).catch(() => {});
  }
})();
