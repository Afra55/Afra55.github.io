(() => {
  "use strict";

  const panel = document.querySelector("#passvault");
  if (!panel) return;

  const $ = (sel, root = panel) => root.querySelector(sel);
  const STORE_KEY = "devtools-passvault-blob-v1";
  const DIR_META_KEY = "devtools-passvault-dir-meta-v1";
  const IDB_NAME = "devtools-passvault-fs";
  const IDB_STORE = "handles";
  const HANDLE_KEY = "dir";
  const BLOB_FILENAME = "passvault-blob.json";
  const ITER = 600000;
  const AUTO_LOCK_MS = 5 * 60 * 1000;
  let entries = [];
  let cryptoKey = null;
  let salt = null;
  let lockTimer = 0;
  let isNewVault = false;
  /** @type {FileSystemDirectoryHandle | null} */
  let dirHandle = null;
  let dirName = "";
  let dirPending = false;

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

  function saveBlobLocal(obj) {
    localStorage.setItem(STORE_KEY, JSON.stringify(obj));
  }

  function loadDirMeta() {
    try {
      return JSON.parse(localStorage.getItem(DIR_META_KEY) || "null");
    } catch (_) {
      return null;
    }
  }

  function saveDirMeta(meta) {
    if (!meta) localStorage.removeItem(DIR_META_KEY);
    else localStorage.setItem(DIR_META_KEY, JSON.stringify(meta));
  }

  function openIdb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("IndexedDB 打开失败"));
    });
  }

  async function idbGet(key) {
    const db = await openIdb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbPut(key, value) {
    const db = await openIdb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbDel(key) {
    const db = await openIdb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function fsSupported() {
    return typeof window.showDirectoryPicker === "function";
  }

  async function ensureDirPermission(handle, mode) {
    if (!handle) return false;
    const opts = { mode: mode || "readwrite" };
    try {
      if (handle.queryPermission) {
        const q = await handle.queryPermission(opts);
        if (q === "granted") return true;
      }
      if (handle.requestPermission) {
        const r = await handle.requestPermission(opts);
        return r === "granted";
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  async function readBlobFromDir(handle) {
    try {
      const fileHandle = await handle.getFileHandle(BLOB_FILENAME);
      const file = await fileHandle.getFile();
      return JSON.parse(await file.text());
    } catch (_) {
      return null;
    }
  }

  async function writeBlobToDir(handle, obj) {
    const fileHandle = await handle.getFileHandle(BLOB_FILENAME, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(obj, null, 2));
    await writable.close();
  }

  async function saveBlob(obj) {
    saveBlobLocal(obj);
    if (dirHandle && !dirPending) {
      const ok = await ensureDirPermission(dirHandle, "readwrite");
      if (!ok) {
        dirPending = true;
        paintStorageUi();
        throw new Error("文件夹写入权限不足，请点「重新连接文件夹」");
      }
      await writeBlobToDir(dirHandle, obj);
    }
  }

  function paintStorageUi() {
    const meta = $("#pv-store-meta");
    const reconnect = $("#pv-reconnect-dir");
    const clearBtn = $("#pv-clear-dir");
    const pick = $("#pv-pick-dir");
    if (pick) pick.hidden = !fsSupported();
    if (dirHandle && !dirPending) {
      if (meta) meta.textContent = `文件夹「${dirName || dirHandle.name}」/${BLOB_FILENAME}`;
      if (reconnect) reconnect.hidden = false;
      if (clearBtn) clearBtn.hidden = false;
    } else if (dirPending || (dirName && !dirHandle)) {
      if (meta) meta.textContent = `曾绑定「${dirName}」，需重新授权`;
      if (reconnect) reconnect.hidden = false;
      if (clearBtn) clearBtn.hidden = false;
    } else {
      if (meta) meta.textContent = "浏览器内";
      if (reconnect) reconnect.hidden = true;
      if (clearBtn) clearBtn.hidden = true;
    }
  }

  async function hydrateDir() {
    const meta = loadDirMeta();
    if (!meta?.name) {
      paintStorageUi();
      return;
    }
    dirName = meta.name;
    try {
      const handle = await idbGet(HANDLE_KEY);
      if (!handle) {
        dirPending = true;
        paintStorageUi();
        return;
      }
      const ok = await ensureDirPermission(handle, "readwrite");
      if (!ok) {
        dirHandle = handle;
        dirPending = true;
        paintStorageUi();
        return;
      }
      dirHandle = handle;
      dirPending = false;
      const disk = await readBlobFromDir(handle);
      if (disk?.salt && disk?.ciphertext) {
        saveBlobLocal({
          v: 1,
          salt: disk.salt,
          iter: disk.iter || ITER,
          iv: disk.iv,
          ciphertext: disk.ciphertext,
          updatedAt: disk.updatedAt || Date.now(),
        });
      }
    } catch (_) {
      dirPending = true;
    }
    paintStorageUi();
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
    await saveBlob({
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
    if (meta)
      meta.textContent = `解锁中 · 约 ${Math.round(AUTO_LOCK_MS / 60000)} 分钟无操作会自动上锁 · 共 ${entries.length} 条`;
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
    paintStorageUi();
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
      paintStorageUi();
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
    toast(dirHandle && !dirPending ? "条目已保存（含文件夹）" : "条目已保存");
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
      await saveBlob({
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

  function getEncryptedBackupFile() {
    const blob = loadBlob();
    if (!blob) return null;
    const name = `passvault-backup-${new Date().toISOString().slice(0, 10)}.json`;
    return new File([JSON.stringify(blob, null, 2)], name, { type: "application/json" });
  }

  async function bindDirectory(existing) {
    showError("");
    if (!fsSupported()) {
      showError("当前浏览器不支持选文件夹（请用最新 Chrome / Edge）");
      return;
    }
    try {
      let handle = existing || null;
      if (!handle) handle = await window.showDirectoryPicker({ mode: "readwrite" });
      const ok = await ensureDirPermission(handle, "readwrite");
      if (!ok) {
        showError("未获得文件夹权限");
        return;
      }
      dirHandle = handle;
      dirName = handle.name || "folder";
      dirPending = false;
      await idbPut(HANDLE_KEY, handle);
      saveDirMeta({ name: dirName, boundAt: Date.now() });

      const disk = await readBlobFromDir(handle);
      const local = loadBlob();
      if (disk?.salt && disk?.ciphertext) {
        const same =
          local &&
          local.salt === disk.salt &&
          local.iv === disk.iv &&
          local.ciphertext === disk.ciphertext;
        if (local && !same) {
          const useDisk = window.confirm(
            "文件夹里已有密码库备份。\n确定：用文件夹覆盖浏览器；\n取消：把浏览器内容写入文件夹。"
          );
          if (useDisk) {
            await saveBlob({
              v: 1,
              salt: disk.salt,
              iter: disk.iter || ITER,
              iv: disk.iv,
              ciphertext: disk.ciphertext,
              updatedAt: disk.updatedAt || Date.now(),
            });
            if (cryptoKey) lockVault("已改用文件夹中的库，请重新解锁");
            else {
              setGateMode(true);
              toast("已改用文件夹中的库，请用原主密码打开");
            }
          } else {
            await writeBlobToDir(handle, local);
            toast(`已将浏览器库写入「${dirName}」`);
          }
        } else {
          if (!local) {
            saveBlobLocal({
              v: 1,
              salt: disk.salt,
              iter: disk.iter || ITER,
              iv: disk.iv,
              ciphertext: disk.ciphertext,
              updatedAt: disk.updatedAt || Date.now(),
            });
            setGateMode(true);
          }
          toast(`已连接文件夹「${dirName}」`);
        }
      } else if (local) {
        await writeBlobToDir(handle, local);
        toast(`已绑定「${dirName}」，并写入现有库`);
      } else {
        toast(`已绑定「${dirName}」，创建库后会写入此目录`);
      }
      paintStorageUi();
    } catch (err) {
      if (err && err.name === "AbortError") return;
      showError("绑定失败：" + (err.message || err));
    }
  }

  async function clearDirectory() {
    if (!window.confirm("改回仅浏览器存储？文件夹里的文件不会删除。")) return;
    dirHandle = null;
    dirName = "";
    dirPending = false;
    try {
      await idbDel(HANDLE_KEY);
    } catch (_) {
      /* ignore */
    }
    saveDirMeta(null);
    paintStorageUi();
    toast("已改回仅浏览器本地");
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
  $("#pv-pick-dir")?.addEventListener("click", () => bindDirectory(null));
  $("#pv-reconnect-dir")?.addEventListener("click", async () => {
    try {
      const handle = await idbGet(HANDLE_KEY);
      await bindDirectory(handle || null);
    } catch (_) {
      await bindDirectory(null);
    }
  });
  $("#pv-clear-dir")?.addEventListener("click", () => clearDirectory());
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

  window.DevToolsPassvault = {
    hasVault: () => Boolean(loadBlob()),
    getEncryptedBackupFile,
  };

  hydrateDir()
    .then(() => setGateMode(Boolean(loadBlob())))
    .catch(() => setGateMode(Boolean(loadBlob())));
})();
