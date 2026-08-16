(() => {
  "use strict";

  const STORAGE_KEY = "devtools-theme-v1";
  const IDB_NAME = "devtools-theme";
  const IDB_STORE = "meta";
  const BG_IMAGE_KEY = "bgImage";

  /** @typedef {{ id: string, name: string, hint: string, vars: Record<string, string> }} ThemePreset */

  /** 护眼优先：避免纯黑/纯白与过饱和霓虹 */
  const PRESETS = /** @type {ThemePreset[]} */ ([
    {
      id: "default",
      name: "默认夜色",
      hint: "原站青绿暗色",
      vars: {
        "--bg-0": "#0b1220",
        "--bg-1": "#121a2b",
        "--ink": "#e8eef8",
        "--muted": "#93a0b8",
        "--line": "rgba(232, 238, 248, 0.12)",
        "--accent": "#2ec4b6",
        "--accent-2": "#f4a261",
        "--danger": "#ff6b7a",
        "--panel": "rgba(18, 26, 43, 0.78)",
        "--panel-strong": "rgba(14, 22, 38, 0.92)",
        "--shadow": "0 18px 50px rgba(0, 0, 0, 0.35)",
        "--bg-glow-a": "rgba(46, 196, 182, 0.35)",
        "--bg-glow-b": "rgba(244, 162, 97, 0.22)",
        "--bg-radial-a": "rgba(46, 196, 182, 0.18)",
        "--bg-radial-b": "rgba(244, 162, 97, 0.12)",
        "--bg-base-0": "#0b1220",
        "--bg-base-1": "#10182a",
        "--bg-base-2": "#0a101c",
        "--theme-scheme": "dark",
      },
    },
    {
      id: "sage",
      name: "鼠尾草绿",
      hint: "低刺激护眼暗色",
      vars: {
        "--bg-0": "#1a1f1c",
        "--bg-1": "#232a26",
        "--ink": "#e4ebe4",
        "--muted": "#9aab9e",
        "--line": "rgba(228, 235, 228, 0.12)",
        "--accent": "#7f9e8a",
        "--accent-2": "#c4a574",
        "--danger": "#d9898f",
        "--panel": "rgba(28, 34, 30, 0.82)",
        "--panel-strong": "rgba(22, 28, 24, 0.94)",
        "--shadow": "0 18px 48px rgba(0, 0, 0, 0.32)",
        "--bg-glow-a": "rgba(127, 158, 138, 0.28)",
        "--bg-glow-b": "rgba(196, 165, 116, 0.16)",
        "--bg-radial-a": "rgba(127, 158, 138, 0.14)",
        "--bg-radial-b": "rgba(196, 165, 116, 0.1)",
        "--bg-base-0": "#1a1f1c",
        "--bg-base-1": "#1f2621",
        "--bg-base-2": "#151a17",
        "--theme-scheme": "dark",
      },
    },
    {
      id: "dusk",
      name: "暮蓝",
      hint: "柔和蓝灰，长时间阅读",
      vars: {
        "--bg-0": "#151a24",
        "--bg-1": "#1c2432",
        "--ink": "#e2e8f2",
        "--muted": "#96a3b8",
        "--line": "rgba(226, 232, 242, 0.12)",
        "--accent": "#7aa2c4",
        "--accent-2": "#b8a08a",
        "--danger": "#d88a96",
        "--panel": "rgba(24, 31, 42, 0.84)",
        "--panel-strong": "rgba(18, 24, 34, 0.94)",
        "--shadow": "0 18px 48px rgba(0, 0, 0, 0.34)",
        "--bg-glow-a": "rgba(122, 162, 196, 0.26)",
        "--bg-glow-b": "rgba(184, 160, 138, 0.14)",
        "--bg-radial-a": "rgba(122, 162, 196, 0.14)",
        "--bg-radial-b": "rgba(184, 160, 138, 0.09)",
        "--bg-base-0": "#151a24",
        "--bg-base-1": "#1a2130",
        "--bg-base-2": "#10151e",
        "--theme-scheme": "dark",
      },
    },
    {
      id: "charcoal",
      name: "炭灰",
      hint: "低对比中性暗色",
      vars: {
        "--bg-0": "#1c1c1c",
        "--bg-1": "#262626",
        "--ink": "#e6e6e6",
        "--muted": "#a3a3a3",
        "--line": "rgba(230, 230, 230, 0.12)",
        "--accent": "#9db4a0",
        "--accent-2": "#c2b280",
        "--danger": "#d09090",
        "--panel": "rgba(32, 32, 32, 0.88)",
        "--panel-strong": "rgba(24, 24, 24, 0.95)",
        "--shadow": "0 16px 44px rgba(0, 0, 0, 0.4)",
        "--bg-glow-a": "rgba(157, 180, 160, 0.18)",
        "--bg-glow-b": "rgba(194, 178, 128, 0.12)",
        "--bg-radial-a": "rgba(157, 180, 160, 0.1)",
        "--bg-radial-b": "rgba(194, 178, 128, 0.08)",
        "--bg-base-0": "#1c1c1c",
        "--bg-base-1": "#222222",
        "--bg-base-2": "#161616",
        "--theme-scheme": "dark",
      },
    },
    {
      id: "fog",
      name: "雾灰浅色",
      hint: "浅色低眩光",
      vars: {
        "--bg-0": "#e8ecf1",
        "--bg-1": "#f3f5f8",
        "--ink": "#243044",
        "--muted": "#5b6b82",
        "--line": "rgba(36, 48, 68, 0.14)",
        "--accent": "#3d8f86",
        "--accent-2": "#b0784a",
        "--danger": "#c45b66",
        "--panel": "rgba(255, 255, 255, 0.78)",
        "--panel-strong": "rgba(255, 255, 255, 0.94)",
        "--shadow": "0 14px 40px rgba(36, 48, 68, 0.12)",
        "--bg-glow-a": "rgba(61, 143, 134, 0.16)",
        "--bg-glow-b": "rgba(176, 120, 74, 0.1)",
        "--bg-radial-a": "rgba(61, 143, 134, 0.1)",
        "--bg-radial-b": "rgba(176, 120, 74, 0.08)",
        "--bg-base-0": "#e8ecf1",
        "--bg-base-1": "#eef1f5",
        "--bg-base-2": "#dde3eb",
        "--theme-scheme": "light",
      },
    },
    {
      id: "sepia",
      name: "柔和琥珀",
      hint: "偏暖浅色，夜间也可",
      vars: {
        "--bg-0": "#ebe4d6",
        "--bg-1": "#f4efe5",
        "--ink": "#3a3228",
        "--muted": "#7a6e60",
        "--line": "rgba(58, 50, 40, 0.14)",
        "--accent": "#6f8f72",
        "--accent-2": "#b0895c",
        "--danger": "#b86a5c",
        "--panel": "rgba(255, 251, 244, 0.82)",
        "--panel-strong": "rgba(255, 252, 246, 0.95)",
        "--shadow": "0 14px 40px rgba(58, 50, 40, 0.12)",
        "--bg-glow-a": "rgba(111, 143, 114, 0.14)",
        "--bg-glow-b": "rgba(176, 137, 92, 0.12)",
        "--bg-radial-a": "rgba(111, 143, 114, 0.1)",
        "--bg-radial-b": "rgba(176, 137, 92, 0.08)",
        "--bg-base-0": "#ebe4d6",
        "--bg-base-1": "#f0eadf",
        "--bg-base-2": "#e2d9c8",
        "--theme-scheme": "light",
      },
    },
  ]);

  const CUSTOM_KEYS = [
    ["--bg-0", "bg0", "背景"],
    ["--ink", "ink", "文字"],
    ["--muted", "muted", "次要文字"],
    ["--accent", "accent", "强调色"],
    ["--accent-2", "accent2", "辅助强调"],
    ["--panel-strong", "panel", "面板底"],
  ];

  function $(sel, root = document) {
    return root.querySelector(sel);
  }

  function toast(msg) {
    window.DevToolsToast?.(msg) || window.showToast?.(msg);
    const el = $("#toast");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      el.hidden = true;
    }, 2200);
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("theme idb open failed"));
    });
  }

  async function idbGet(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbSet(key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbDel(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function defaultState() {
    return {
      preset: "default",
      custom: {},
      useCustom: false,
      bgImage: false,
      bgOverlay: 0.55,
      reduceMotionGlow: false,
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      return { ...defaultState(), ...parsed, custom: { ...defaultState().custom, ...(parsed.custom || {}) } };
    } catch (_) {
      return defaultState();
    }
  }

  function saveState(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {}
  }

  function presetById(id) {
    return PRESETS.find((p) => p.id === id) || PRESETS[0];
  }

  function hexToRgb(hex) {
    const h = String(hex || "").replace("#", "").trim();
    if (h.length === 3) {
      const r = parseInt(h[0] + h[0], 16);
      const g = parseInt(h[1] + h[1], 16);
      const b = parseInt(h[2] + h[2], 16);
      return { r, g, b };
    }
    if (h.length !== 6) return null;
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }

  function luminance(hex) {
    const rgb = hexToRgb(hex);
    if (!rgb) return 0.2;
    const a = [rgb.r, rgb.g, rgb.b].map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  }

  function deriveFromCustom(custom) {
    const base = { ...presetById("default").vars };
    const bg0 = custom["--bg-0"] || base["--bg-0"];
    const ink = custom["--ink"] || base["--ink"];
    const accent = custom["--accent"] || base["--accent"];
    const accent2 = custom["--accent-2"] || base["--accent-2"];
    const muted = custom["--muted"] || base["--muted"];
    const panelStrong = custom["--panel-strong"] || base["--panel-strong"];
    const light = luminance(bg0) > 0.55;
    const inkRgb = hexToRgb(ink) || { r: 232, g: 238, b: 248 };
    const accentRgb = hexToRgb(accent) || { r: 46, g: 196, b: 182 };
    const accent2Rgb = hexToRgb(accent2) || { r: 244, g: 162, b: 97 };
    return {
      ...base,
      "--bg-0": bg0,
      "--bg-1": custom["--bg-1"] || bg0,
      "--ink": ink,
      "--muted": muted,
      "--accent": accent,
      "--accent-2": accent2,
      "--panel-strong": panelStrong,
      "--panel": light ? "rgba(255,255,255,0.78)" : "rgba(18,26,43,0.78)",
      "--line": `rgba(${inkRgb.r}, ${inkRgb.g}, ${inkRgb.b}, ${light ? 0.14 : 0.12})`,
      "--bg-glow-a": `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, ${light ? 0.14 : 0.28})`,
      "--bg-glow-b": `rgba(${accent2Rgb.r}, ${accent2Rgb.g}, ${accent2Rgb.b}, ${light ? 0.1 : 0.18})`,
      "--bg-radial-a": `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, ${light ? 0.1 : 0.16})`,
      "--bg-radial-b": `rgba(${accent2Rgb.r}, ${accent2Rgb.g}, ${accent2Rgb.b}, ${light ? 0.08 : 0.1})`,
      "--bg-base-0": bg0,
      "--bg-base-1": custom["--bg-1"] || bg0,
      "--bg-base-2": bg0,
      "--theme-scheme": light ? "light" : "dark",
      "--shadow": light ? "0 14px 40px rgba(36, 48, 68, 0.12)" : "0 18px 50px rgba(0, 0, 0, 0.35)",
    };
  }

  function applyVars(vars) {
    const root = document.documentElement;
    Object.entries(vars).forEach(([k, v]) => {
      if (k.startsWith("--")) root.style.setProperty(k, v);
    });
    root.dataset.themeScheme = vars["--theme-scheme"] || "dark";
  }

  function clearInlineVars() {
    const root = document.documentElement;
    const preset = presetById("default");
    Object.keys(preset.vars).forEach((k) => root.style.removeProperty(k));
    root.style.removeProperty("--bg-image");
    root.style.removeProperty("--bg-image-overlay");
  }

  let state = loadState();
  let bgObjectUrl = "";

  function revokeBgUrl() {
    if (bgObjectUrl) {
      try {
        URL.revokeObjectURL(bgObjectUrl);
      } catch (_) {}
      bgObjectUrl = "";
    }
  }

  async function applyTheme() {
    const root = document.documentElement;
    let vars;
    if (state.useCustom) {
      vars = deriveFromCustom(state.custom || {});
      root.dataset.theme = "custom";
    } else {
      vars = { ...presetById(state.preset).vars };
      root.dataset.theme = state.preset || "default";
    }
    applyVars(vars);

    const overlay = Math.min(0.9, Math.max(0.15, Number(state.bgOverlay) || 0.55));
    root.style.setProperty("--bg-image-overlay", String(overlay));

    if (state.bgImage) {
      try {
        const blob = await idbGet(BG_IMAGE_KEY);
        if (blob instanceof Blob) {
          revokeBgUrl();
          bgObjectUrl = URL.createObjectURL(blob);
          root.style.setProperty("--bg-image", `url("${bgObjectUrl}")`);
          root.dataset.themeBg = "image";
        } else {
          root.style.removeProperty("--bg-image");
          root.dataset.themeBg = "none";
        }
      } catch (_) {
        root.style.removeProperty("--bg-image");
        root.dataset.themeBg = "none";
      }
    } else {
      revokeBgUrl();
      root.style.removeProperty("--bg-image");
      root.dataset.themeBg = "none";
    }

    document.body?.classList.toggle("theme-reduce-glow", Boolean(state.reduceMotionGlow));
    syncForm();
  }

  function syncForm() {
    const presetWrap = $("#theme-presets");
    if (presetWrap) {
      presetWrap.querySelectorAll("[data-theme-preset]").forEach((btn) => {
        const on = !state.useCustom && btn.dataset.themePreset === state.preset;
        btn.classList.toggle("is-active", on);
        btn.setAttribute("aria-pressed", on ? "true" : "false");
      });
    }
    const customFlag = $("#theme-use-custom");
    if (customFlag) customFlag.checked = Boolean(state.useCustom);
    const customBox = $("#theme-custom-box");
    if (customBox) customBox.hidden = !state.useCustom;

    CUSTOM_KEYS.forEach(([cssKey, id]) => {
      const input = $(`#theme-color-${id}`);
      if (!input) return;
      const val = state.custom[cssKey] || presetById(state.useCustom ? state.preset : state.preset).vars[cssKey] || "#0b1220";
      const hex = String(val).startsWith("#") ? val : state.custom[cssKey] || "#888888";
      if (/^#[0-9a-fA-F]{6}$/.test(hex)) input.value = hex;
    });

    const overlay = $("#theme-bg-overlay");
    const overlayVal = $("#theme-bg-overlay-val");
    if (overlay) overlay.value = String(Math.round((Number(state.bgOverlay) || 0.55) * 100));
    if (overlayVal) overlayVal.textContent = `${Math.round((Number(state.bgOverlay) || 0.55) * 100)}%`;

    const hasImg = $("#theme-bg-status");
    if (hasImg) hasImg.textContent = state.bgImage ? "已设置背景图（本地保存）" : "未设置背景图";

    const glow = $("#theme-reduce-glow");
    if (glow) glow.checked = Boolean(state.reduceMotionGlow);
  }

  function renderPresets() {
    const wrap = $("#theme-presets");
    if (!wrap) return;
    wrap.innerHTML = PRESETS.map(
      (p) => `<button type="button" class="theme-swatch" data-theme-preset="${p.id}" aria-pressed="false" title="${p.hint}">
        <span class="theme-swatch-preview" style="--sw-bg:${p.vars["--bg-0"]};--sw-ink:${p.vars["--ink"]};--sw-a:${p.vars["--accent"]}"></span>
        <span class="theme-swatch-name">${p.name}</span>
        <span class="hint tight">${p.hint}</span>
      </button>`
    ).join("");
  }

  function bindUi() {
    renderPresets();
    syncForm();

    $("#theme-open")?.addEventListener("click", () => {
      const dlg = $("#theme-dlg");
      if (dlg && typeof dlg.showModal === "function") dlg.showModal();
    });
    $("#theme-close")?.addEventListener("click", () => $("#theme-dlg")?.close?.());
    $("#theme-about-open")?.addEventListener("click", () => {
      const dlg = $("#theme-dlg");
      if (dlg && typeof dlg.showModal === "function") dlg.showModal();
    });

    $("#theme-presets")?.addEventListener("click", (e) => {
      const btn = e.target.closest?.("[data-theme-preset]");
      if (!btn) return;
      state.useCustom = false;
      state.preset = btn.dataset.themePreset;
      saveState(state);
      applyTheme();
      toast(`已切换：${presetById(state.preset).name}`);
    });

    $("#theme-use-custom")?.addEventListener("change", (e) => {
      state.useCustom = Boolean(e.target.checked);
      if (state.useCustom) {
        const base = presetById(state.preset).vars;
        CUSTOM_KEYS.forEach(([cssKey]) => {
          if (!state.custom[cssKey] && String(base[cssKey] || "").startsWith("#")) {
            state.custom[cssKey] = base[cssKey];
          }
        });
      }
      saveState(state);
      applyTheme();
    });

    CUSTOM_KEYS.forEach(([cssKey, id]) => {
      $(`#theme-color-${id}`)?.addEventListener("input", (e) => {
        state.useCustom = true;
        const flag = $("#theme-use-custom");
        if (flag) flag.checked = true;
        state.custom[cssKey] = e.target.value;
        if (cssKey === "--bg-0") state.custom["--bg-1"] = e.target.value;
        saveState(state);
        applyTheme();
      });
    });

    $("#theme-bg-overlay")?.addEventListener("input", (e) => {
      state.bgOverlay = Math.min(0.9, Math.max(0.15, Number(e.target.value) / 100));
      saveState(state);
      applyTheme();
    });

    $("#theme-bg-file")?.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      if (!String(file.type || "").startsWith("image/")) {
        toast("请选择图片文件");
        return;
      }
      if (file.size > 6 * 1024 * 1024) {
        toast("背景图请小于 6MB");
        return;
      }
      try {
        await idbSet(BG_IMAGE_KEY, file);
        state.bgImage = true;
        saveState(state);
        await applyTheme();
        toast("背景图已应用");
      } catch (err) {
        toast(err.message || "保存背景图失败");
      }
    });

    $("#theme-bg-clear")?.addEventListener("click", async () => {
      state.bgImage = false;
      saveState(state);
      try {
        await idbDel(BG_IMAGE_KEY);
      } catch (_) {}
      await applyTheme();
      toast("已清除背景图");
    });

    $("#theme-reduce-glow")?.addEventListener("change", (e) => {
      state.reduceMotionGlow = Boolean(e.target.checked);
      saveState(state);
      applyTheme();
    });

    $("#theme-reset")?.addEventListener("click", async () => {
      state = defaultState();
      saveState(state);
      try {
        await idbDel(BG_IMAGE_KEY);
      } catch (_) {}
      clearInlineVars();
      await applyTheme();
      toast("已恢复默认主题");
    });
  }

  // early apply before DOM for less flash — state already loaded
  applyTheme().catch(() => {});

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      bindUi();
      applyTheme().catch(() => {});
    });
  } else {
    bindUi();
  }

  window.DevToolsTheme = {
    presets: PRESETS,
    getState: () => ({ ...state, custom: { ...state.custom } }),
    apply: applyTheme,
    open() {
      const dlg = $("#theme-dlg");
      if (dlg && typeof dlg.showModal === "function") dlg.showModal();
    },
  };
})();
