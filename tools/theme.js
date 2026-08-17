(() => {
  "use strict";

  const STORAGE_KEY = "devtools-theme-v1";
  const IDB_NAME = "devtools-theme";
  const IDB_STORE = "meta";
  const BG_IMAGE_KEY = "bgImage";

  /** @typedef {{ id: string, name: string, hint: string, vars: Record<string, string> }} ThemePreset */

  /**
   * 预设原则：对比清晰、导航可读；避开纯黑/霓虹紫、奶油衬托陶土红。
   * 每套必须带 --link / --link-hover，否则说明文字链接会发灰或发青。
   */
  const PRESETS = /** @type {ThemePreset[]} */ ([
    {
      id: "default",
      name: "深海青绿",
      hint: "原站气质，侧栏跟色",
      vars: {
        "--bg-0": "#0b1320",
        "--bg-1": "#131c2e",
        "--ink": "#eef3fb",
        "--muted": "#9aabc4",
        "--line": "rgba(238, 243, 251, 0.13)",
        "--accent": "#2ec4b6",
        "--accent-2": "#f0a46a",
        "--link": "#6ef0e2",
        "--link-hover": "#b4fff7",
        "--danger": "#ff6b7a",
        "--panel": "rgba(15, 23, 38, 0.84)",
        "--panel-strong": "rgba(11, 18, 32, 0.96)",
        "--shadow": "0 18px 50px rgba(0, 0, 0, 0.36)",
        "--bg-glow-a": "rgba(46, 196, 182, 0.26)",
        "--bg-glow-b": "rgba(240, 164, 106, 0.14)",
        "--bg-radial-a": "rgba(46, 196, 182, 0.14)",
        "--bg-radial-b": "rgba(240, 164, 106, 0.09)",
        "--bg-base-0": "#0b1320",
        "--bg-base-1": "#10192a",
        "--bg-base-2": "#090f1a",
        "--theme-scheme": "dark",
      },
    },
    {
      id: "pine",
      name: "松林夜色",
      hint: "墨绿护眼，长时间好用",
      vars: {
        "--bg-0": "#101714",
        "--bg-1": "#182019",
        "--ink": "#e7efe8",
        "--muted": "#95a99a",
        "--line": "rgba(231, 239, 232, 0.13)",
        "--accent": "#5fbf8a",
        "--accent-2": "#c9a66a",
        "--link": "#8ad4ab",
        "--link-hover": "#c2efd4",
        "--danger": "#e08b8b",
        "--panel": "rgba(20, 28, 24, 0.88)",
        "--panel-strong": "rgba(14, 22, 18, 0.96)",
        "--shadow": "0 18px 48px rgba(0, 0, 0, 0.34)",
        "--bg-glow-a": "rgba(95, 191, 138, 0.2)",
        "--bg-glow-b": "rgba(201, 166, 106, 0.1)",
        "--bg-radial-a": "rgba(95, 191, 138, 0.11)",
        "--bg-radial-b": "rgba(201, 166, 106, 0.07)",
        "--bg-base-0": "#101714",
        "--bg-base-1": "#151d17",
        "--bg-base-2": "#0c120e",
        "--theme-scheme": "dark",
      },
    },
    {
      id: "ink",
      name: "墨蓝",
      hint: "冷静蓝灰，阅读友好",
      vars: {
        "--bg-0": "#0e1520",
        "--bg-1": "#161f2d",
        "--ink": "#e9eff8",
        "--muted": "#93a4bb",
        "--line": "rgba(233, 239, 248, 0.13)",
        "--accent": "#6aa3d4",
        "--accent-2": "#c4a07e",
        "--link": "#8fc4ef",
        "--link-hover": "#c8e6ff",
        "--danger": "#e0909a",
        "--panel": "rgba(18, 26, 38, 0.88)",
        "--panel-strong": "rgba(12, 19, 30, 0.96)",
        "--shadow": "0 18px 48px rgba(0, 0, 0, 0.35)",
        "--bg-glow-a": "rgba(106, 163, 212, 0.2)",
        "--bg-glow-b": "rgba(196, 160, 126, 0.1)",
        "--bg-radial-a": "rgba(106, 163, 212, 0.11)",
        "--bg-radial-b": "rgba(196, 160, 126, 0.07)",
        "--bg-base-0": "#0e1520",
        "--bg-base-1": "#131b28",
        "--bg-base-2": "#0a1018",
        "--theme-scheme": "dark",
      },
    },
    {
      id: "graphite",
      name: "石墨",
      hint: "中性深灰，低干扰",
      vars: {
        "--bg-0": "#141416",
        "--bg-1": "#1e1e22",
        "--ink": "#f2f2f4",
        "--muted": "#a3a3ab",
        "--line": "rgba(242, 242, 244, 0.13)",
        "--accent": "#7db8ae",
        "--accent-2": "#c9ae86",
        "--link": "#9ad4c8",
        "--link-hover": "#d0f3ea",
        "--danger": "#e09898",
        "--panel": "rgba(26, 26, 30, 0.9)",
        "--panel-strong": "rgba(18, 18, 22, 0.97)",
        "--shadow": "0 16px 44px rgba(0, 0, 0, 0.42)",
        "--bg-glow-a": "rgba(125, 184, 174, 0.14)",
        "--bg-glow-b": "rgba(201, 174, 134, 0.09)",
        "--bg-radial-a": "rgba(125, 184, 174, 0.08)",
        "--bg-radial-b": "rgba(201, 174, 134, 0.06)",
        "--bg-base-0": "#141416",
        "--bg-base-1": "#1a1a1e",
        "--bg-base-2": "#101012",
        "--theme-scheme": "dark",
      },
    },
    {
      id: "paper",
      name: "纸白",
      hint: "干净浅色，菜单同步变亮",
      vars: {
        "--bg-0": "#f1f3f7",
        "--bg-1": "#fafbfc",
        "--ink": "#1a2738",
        "--muted": "#55657c",
        "--line": "rgba(26, 39, 56, 0.14)",
        "--accent": "#1a7f74",
        "--accent-2": "#a86a38",
        "--link": "#0e655c",
        "--link-hover": "#094841",
        "--danger": "#c24b58",
        "--panel": "rgba(255, 255, 255, 0.9)",
        "--panel-strong": "rgba(255, 255, 255, 0.98)",
        "--shadow": "0 14px 36px rgba(26, 39, 56, 0.1)",
        "--bg-glow-a": "rgba(26, 127, 116, 0.1)",
        "--bg-glow-b": "rgba(168, 106, 56, 0.07)",
        "--bg-radial-a": "rgba(26, 127, 116, 0.07)",
        "--bg-radial-b": "rgba(168, 106, 56, 0.05)",
        "--bg-base-0": "#f1f3f7",
        "--bg-base-1": "#f5f7fa",
        "--bg-base-2": "#e6eaf0",
        "--theme-scheme": "light",
      },
    },
    {
      id: "sky",
      name: "晴空",
      hint: "冷调浅色，蓝强调清晰",
      vars: {
        "--bg-0": "#e8eef6",
        "--bg-1": "#f5f8fc",
        "--ink": "#182640",
        "--muted": "#546680",
        "--line": "rgba(24, 38, 64, 0.14)",
        "--accent": "#2a6ca8",
        "--accent-2": "#b87334",
        "--link": "#1a5a96",
        "--link-hover": "#124270",
        "--danger": "#c24b58",
        "--panel": "rgba(255, 255, 255, 0.92)",
        "--panel-strong": "rgba(255, 255, 255, 0.98)",
        "--shadow": "0 14px 36px rgba(24, 38, 64, 0.1)",
        "--bg-glow-a": "rgba(42, 108, 168, 0.1)",
        "--bg-glow-b": "rgba(184, 115, 52, 0.07)",
        "--bg-radial-a": "rgba(42, 108, 168, 0.07)",
        "--bg-radial-b": "rgba(184, 115, 52, 0.05)",
        "--bg-base-0": "#e8eef6",
        "--bg-base-1": "#eef3f9",
        "--bg-base-2": "#dce4ef",
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
      const next = { ...defaultState(), ...parsed, custom: { ...defaultState().custom, ...(parsed.custom || {}) } };
      // 旧预设 id 映射到新一套
      const legacy = { sage: "pine", dusk: "ink", charcoal: "graphite", fog: "paper", sepia: "sky" };
      if (legacy[next.preset]) next.preset = legacy[next.preset];
      if (!PRESETS.some((p) => p.id === next.preset)) next.preset = "default";
      return next;
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

  function rgbToHex(r, g, b) {
    const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
    return `#${[clamp(r), clamp(g), clamp(b)].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
  }

  function mixHex(hex, towardWhite, amount) {
    const rgb = hexToRgb(hex);
    if (!rgb) return hex;
    const t = towardWhite ? 255 : 0;
    return rgbToHex(
      rgb.r + (t - rgb.r) * amount,
      rgb.g + (t - rgb.g) * amount,
      rgb.b + (t - rgb.b) * amount
    );
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

  function ensureLinkVars(vars) {
    const light = (vars["--theme-scheme"] || "dark") === "light";
    const accent = vars["--accent"] || "#2bbbad";
    if (!vars["--link"]) vars["--link"] = light ? mixHex(accent, false, 0.22) : mixHex(accent, true, 0.35);
    if (!vars["--link-hover"]) vars["--link-hover"] = light ? mixHex(accent, false, 0.4) : mixHex(accent, true, 0.55);
    return vars;
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
    return ensureLinkVars({
      ...base,
      "--bg-0": bg0,
      "--bg-1": custom["--bg-1"] || bg0,
      "--ink": ink,
      "--muted": muted,
      "--accent": accent,
      "--accent-2": accent2,
      "--panel-strong": panelStrong,
      "--panel": light ? "rgba(255,255,255,0.86)" : "rgba(16,24,40,0.82)",
      "--line": `rgba(${inkRgb.r}, ${inkRgb.g}, ${inkRgb.b}, ${light ? 0.15 : 0.14})`,
      "--bg-glow-a": `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, ${light ? 0.12 : 0.24})`,
      "--bg-glow-b": `rgba(${accent2Rgb.r}, ${accent2Rgb.g}, ${accent2Rgb.b}, ${light ? 0.08 : 0.14})`,
      "--bg-radial-a": `rgba(${accentRgb.r}, ${accentRgb.g}, ${accentRgb.b}, ${light ? 0.08 : 0.12})`,
      "--bg-radial-b": `rgba(${accent2Rgb.r}, ${accent2Rgb.g}, ${accent2Rgb.b}, ${light ? 0.06 : 0.08})`,
      "--bg-base-0": bg0,
      "--bg-base-1": custom["--bg-1"] || bg0,
      "--bg-base-2": bg0,
      "--theme-scheme": light ? "light" : "dark",
      "--shadow": light ? "0 14px 40px rgba(28, 42, 61, 0.12)" : "0 18px 50px rgba(0, 0, 0, 0.35)",
      "--link": light ? mixHex(accent, false, 0.22) : mixHex(accent, true, 0.35),
      "--link-hover": light ? mixHex(accent, false, 0.4) : mixHex(accent, true, 0.55),
    });
  }

  function applyVars(vars) {
    const root = document.documentElement;
    const finalVars = ensureLinkVars({ ...vars });
    Object.entries(finalVars).forEach(([k, v]) => {
      if (k.startsWith("--")) root.style.setProperty(k, v);
    });
    root.dataset.themeScheme = finalVars["--theme-scheme"] || "dark";
  }

  function clearInlineVars() {
    const root = document.documentElement;
    const preset = presetById("default");
    Object.keys(preset.vars).forEach((k) => root.style.removeProperty(k));
    root.style.removeProperty("--bg-image");
    root.style.removeProperty("--bg-image-overlay");
    root.style.removeProperty("--link");
    root.style.removeProperty("--link-hover");
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
    window.dispatchEvent(new CustomEvent("devtools:theme", { detail: { preset: state.preset, scheme: vars["--theme-scheme"] } }));
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
      const val = state.custom[cssKey] || presetById(state.preset).vars[cssKey] || "#0b1220";
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
