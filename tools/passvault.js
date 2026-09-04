(() => {
  "use strict";

  const panel = document.querySelector("#passvault");
  if (!panel) return;

  const $ = (sel, root = panel) => root.querySelector(sel);
  const STORE_KEY = "devtools-passvault-blob-v1";
  const ITER = 600000;
  const AUTO_LOCK_MS = 5 * 60 * 1000;

  let entries = [];
  let cryptoKey = null;
  let salt = null;
  let lockTimer = 0;
  let isNewVault = false;

  function showError(msg) {
    const el = $("#pv-error");
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = String(msg);
  }

  function toast(msg) {
    try {
      window.DevToolsExtraKit?.toast?.(msg);
    } catch (_) {
      /* ignore */
    }
  }

  function b64(buf) {
    const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
    let s = "";
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }

  function fromB64(str) {
    const bin = atob(String(str || ""));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function loadBlob() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  function saveBlob(obj) {
    localStorage.setItem(STORE_KEY, JSON.stringify(obj));
  }

  async function deriveKey(password, saltBytes, iter) {
    const enc = new TextEncoder();
    const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, [
      "deriveKey",
    ]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: saltBytes, iterations: iter || ITER, hash: "SHA-256" },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function encryptEntries(list, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plain = new TextEncoder().encode(JSON.stringify({ entries: list || [] }));
    const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain);
    return { iv: b64(iv), ciphertext: b64(cipher) };
  }

  async function decryptEntries(blob, key) {
    const iv = fromB64(blob.iv);
    const data = fromB64(blob.ciphertext);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
    const json = JSON.parse(new TextDecoder().decode(plain));
    return Array.isArray(json.entries) ? json.entries : [];
  }

  async function persist() {
    if (!cryptoKey || !salt) throw new Error("未解锁");
    const { iv, ciphertext } = await encryptEntries(entries, cryptoKey);
    saveBlob({
      v: 1,
      salt: b64(salt),
      iter: ITER,
      iv,
      ciphertext,
      updatedAt: Date.now(),
    });
  }

  function bumpActivity() {
    window.clearTimeout(lockTimer);
    if (!cryptoKey) return;
    lockTimer = window.setTimeout(() => lockVault("已自动上锁（闲置超时）"), AUTO_LOCK_MS);
    const meta = $("#pv-session-meta");
    if (meta) meta.textContent = `解锁中 · 约 ${Math.round(AUTO_LOCK_MS / 60000)} 分钟无操作会自动上锁 · 共 ${entries.length} 条`;
  }

  function setGateMode(hasVault) {
    isNewVault = !hasVault;
    const row = $("#pv-master2-row");
    const hint = $("#pv-gate-hint");
    const btn = $("#pv-unlock");
    if (row) row.hidden = hasVault;
    if (hint) {
      hint.textContent = hasVault
        ? "输入主密码打开本机密码库。"
        : "首次使用：设置主密码（请牢记），将创建空库。";
    }
    if (btn) btn.textContent = hasVault ? "打开密码库" : "创建并打开";
  }

  function lockVault(reason) {
    entries = [];
    cryptoKey = null;
    salt = null;
    window.clearTimeout(lockTimer);
    $("#pv-open").hidden = true;
    $("#pv-locked").hidden = false;
    $("#pv-editor").hidden = true;
    const m = $("#pv-master");
    const m2 = $("#pv-master2");
    if (m) m.value = "";
    if (m2) m2.value = "";
    setGateMode(Boolean(loadBlob()));
    if (reason) toast(reason);
    showError("");
  }

  function uid() {
    return `e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function genPassword(len = 20) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
    const bytes = crypto.getRandomValues(new Uint8Array(len));
    let out = "";
    for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length];
    return out;
  }

  async function copyText(text) {
    const s = String(text || "");
    if (!s) return;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(s);
      else {
        const ta = document.createElement("textarea");
        ta.value = s;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      toast("已复制");
      bumpActivity();
    } catch (e) {
      showError("复制失败：" + (e.message || e));
    }
  }

  function renderList() {
    const box = $("#pv-list");
    const count = $("#pv-count");
    if (!box) return;
    const q = String($("#pv-filter")?.value || "")
      .trim()
      .toLowerCase();
    const list = entries
      .filter((e) => {
        if (!q) return true;
        const hay = [e.title, e.user, e.url, e.notes].map((x) => String(x || "").toLowerCase()).join(" ");
        return hay.includes(q);
      })
      .sort((a, b) => String(a.title || "").localeCompare(String(b.title || ""), "zh"));
    if (count) count.textContent = q ? `显示 ${list.length} / ${entries.length}` : `${entries.length} 条`;
    if (!list.length) {
      box.innerHTML = `<p class="hint tight">${q ? "没有匹配条目" : "还没有条目 · 点「新增」"}</p>`;
      return;
    }
    box.innerHTML = list
      .map((e) => {
        const title = escapeHtml(e.title || "(无标题)");
        const user = escapeHtml(e.user || "");
        const url = escapeHtml(e.url || "");
        return `<article class="pv-item" data-id="${escapeHtml(e.id)}">
          <div class="pv-item-main">
            <strong>${title}</strong>
            <span class="hint tight mono">${user}</span>
            ${url ? `<span class="hint tight mono pv-url">${url}</span>` : ""}
          </div>
          <div class="pv-item-actions">
            <button type="button" class="ghost-btn" data-pv-copy-user="${escapeHtml(e.id)}">复制账号</button>
            <button type="button" class="ghost-btn" data-pv-copy-pass="${escapeHtml(e.id)}">复制密码</button>
            <button type="button" class="secondary-btn" data-pv-edit="${escapeHtml(e.id)}">编辑</button>
          </div>
        </article>`;
      })
      .join("");
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function openEditor(entry) {
    const ed = $("#pv-editor");
    if (!ed) return;
    ed.hidden = false;
    $("#pv-edit-id").value = entry?.id || "";
    $("#pv-editor-title").textContent = entry?.id ? "编辑条目" : "新增条目";
    $("#pv-title").value = entry?.title || "";
    $("#pv-user").value = entry?.user || "";
    $("#pv-pass").value = entry?.password || "";
    $("#pv-pass").type = "password";
    $("#pv-pass-show").textContent = "显示";
    $("#pv-url").value = entry?.url || "";
    $("#pv-notes").value = entry?.notes || "";
    const del = $("#pv-delete");
    if (del) del.hidden = !entry?.id;
    bumpActivity();
    $("#pv-title")?.focus();
  }

  async function unlock() {
    showError("");
    if (!window.crypto?.subtle) {
      showError("当前浏览器不支持 Web Crypto，无法使用本地密码库。");
      return;
    }
    const pass = String($("#pv-master")?.value || "");
    if (pass.length < 8) {
      showError("主密码至少 8 位");
      return;
    }
    const blob = loadBlob();
    try {
      if (!blob) {
        const pass2 = String($("#pv-master2")?.value || "");
        if (pass !== pass2) {
          showError("两次主密码不一致");
          return;
        }
        salt = crypto.getRandomValues(new Uint8Array(16));
        cryptoKey = await deriveKey(pass, salt, ITER);
        entries = [];
        await persist();
      } else {
        salt = fromB64(blob.salt);
        cryptoKey = await deriveKey(pass, salt, blob.iter || ITER);
        entries = await decryptEntries(blob, cryptoKey);
      }
      $("#pv-locked").hidden = true;
      $("#pv-open").hidden = false;
      $("#pv-master").value = "";
      if ($("#pv-master2")) $("#pv-master2").value = "";
      renderList();
      bumpActivity();
      toast("密码库已打开");
    } catch (_) {
      cryptoKey = null;
      salt = null;
      entries = [];
      showError("主密码不对，或备份已损坏");
    }
  }

  async function saveEntry() {
    bumpActivity();
    showError("");
    const id = String($("#pv-edit-id")?.value || "");
    const title = String($("#pv-title")?.value || "").trim();
    if (!title) {
      showError("请填写标题");
      return;
    }
    const next = {
      id: id || uid(),
      title,
      user: String($("#pv-user")?.value || "").trim(),
      password: String($("#pv-pass")?.value || ""),
      url: String($("#pv-url")?.value || "").trim(),
      notes: String($("#pv-notes")?.value || "").trim(),
      updatedAt: Date.now(),
    };
    const idx = entries.findIndex((e) => e.id === next.id);
    if (idx >= 0) entries[idx] = next;
    else entries.unshift(next);
    await persist();
    $("#pv-editor").hidden = true;
    renderList();
    bumpActivity();
    toast("条目已保存");
  }

  async function deleteEntry() {
    const id = String($("#pv-edit-id")?.value || "");
    if (!id) return;
    if (!window.confirm("删除该条目？此操作写入加密库后不可撤销。")) return;
    entries = entries.filter((e) => e.id !== id);
    await persist();
    $("#pv-editor").hidden = true;
    renderList();
    bumpActivity();
    toast("已删除");
  }

  function exportBackup() {
    bumpActivity();
    const blob = loadBlob();
    if (!blob) {
      showError("没有可导出的库");
      return;
    }
    const name = `passvault-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(blob, null, 2)], { type: "application/json" }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
    toast("已导出加密备份（仍需主密码才能打开）");
  }

  async function importBackup(file) {
    showError("");
    try {
      const text = await file.text();
      const obj = JSON.parse(text);
      if (!obj?.salt || !obj?.iv || !obj?.ciphertext) throw new Error("不是有效的加密备份");
      if (loadBlob() && !window.confirm("本机已有密码库，导入将覆盖。确定？")) return;
      saveBlob({
        v: 1,
        salt: obj.salt,
        iter: obj.iter || ITER,
        iv: obj.iv,
        ciphertext: obj.ciphertext,
        updatedAt: Date.now(),
      });
      lockVault();
      setGateMode(true);
      toast("备份已导入，请用原主密码打开");
    } catch (e) {
      showError(e.message || String(e));
    }
  }

  function findEntry(id) {
    return entries.find((e) => e.id === id);
  }

  $("#pv-unlock")?.addEventListener("click", () => unlock());
  $("#pv-master")?.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") unlock();
  });
  $("#pv-master2")?.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") unlock();
  });
  $("#pv-lock")?.addEventListener("click", () => lockVault("已上锁"));
  $("#pv-add")?.addEventListener("click", () => openEditor(null));
  $("#pv-editor-close")?.addEventListener("click", () => {
    $("#pv-editor").hidden = true;
  });
  $("#pv-save")?.addEventListener("click", () => saveEntry().catch((e) => showError(e.message)));
  $("#pv-delete")?.addEventListener("click", () => deleteEntry().catch((e) => showError(e.message)));
  $("#pv-export")?.addEventListener("click", () => exportBackup());
  $("#pv-filter")?.addEventListener("input", () => {
    bumpActivity();
    renderList();
  });
  $("#pv-pass-show")?.addEventListener("click", () => {
    const input = $("#pv-pass");
    const btn = $("#pv-pass-show");
    if (!input) return;
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    if (btn) btn.textContent = show ? "隐藏" : "显示";
    bumpActivity();
  });
  $("#pv-pass-gen")?.addEventListener("click", () => {
    $("#pv-pass").value = genPassword(20);
    $("#pv-pass").type = "text";
    $("#pv-pass-show").textContent = "隐藏";
    bumpActivity();
  });
  $("#pv-import")?.addEventListener("click", () => $("#pv-import-file")?.click());
  $("#pv-import-file")?.addEventListener("change", (ev) => {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (file) importBackup(file);
  });
  $("#pv-list")?.addEventListener("click", (ev) => {
    const edit = ev.target.closest?.("[data-pv-edit]");
    if (edit) {
      openEditor(findEntry(edit.getAttribute("data-pv-edit")));
      return;
    }
    const cu = ev.target.closest?.("[data-pv-copy-user]");
    if (cu) {
      const e = findEntry(cu.getAttribute("data-pv-copy-user"));
      if (e) copyText(e.user);
      return;
    }
    const cp = ev.target.closest?.("[data-pv-copy-pass]");
    if (cp) {
      const e = findEntry(cp.getAttribute("data-pv-copy-pass"));
      if (e) copyText(e.password);
    }
  });

  ["pointerdown", "keydown"].forEach((evt) => {
    panel.addEventListener(evt, () => {
      if (cryptoKey) bumpActivity();
    });
  });

  setGateMode(Boolean(loadBlob()));
})();
