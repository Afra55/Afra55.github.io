(() => {
  "use strict";

  const TOOL_ID = "ipgeo";
  const CACHE_KEY = "devtools-ipgeo-cache-v1";
  const LEAFLET_CSS = "./vendor/leaflet/leaflet.css";
  const LEAFLET_IMG = "./vendor/leaflet/images/";

  const $ = (sel, el = document) => el.querySelector(sel);

  let root = null;
  let map = null;
  let marker = null;
  let lastResult = null;
  let bootPromise = null;
  let leafletCssReady = false;

  function showError(msg) {
    const el = root && $("#ipgeo-error", root);
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = String(msg);
  }

  function setStatus(msg) {
    const el = root && $("#ipgeo-status", root);
    if (el) el.textContent = msg || "";
  }

  function dash(v) {
    if (v === null || v === undefined || v === "") return "—";
    if (typeof v === "boolean") return v ? "是" : "否";
    return String(v);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function copyText(text) {
    const t = String(text || "");
    if (!t) return Promise.reject(new Error("无内容可复制"));
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(t);
    return new Promise((resolve, reject) => {
      try {
        const ta = document.createElement("textarea");
        ta.value = t;
        ta.setAttribute("readonly", "");
        ta.style.cssText = "position:fixed;left:-9999px;top:0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        if (ok) resolve();
        else reject(new Error("复制失败"));
      } catch (err) {
        reject(err);
      }
    });
  }

  function isValidIp(raw) {
    const s = String(raw || "").trim();
    if (!s) return false;
    if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(s)) {
      return s.split(".").every((p) => {
        const n = Number(p);
        return Number.isInteger(n) && n >= 0 && n <= 255;
      });
    }
    if (s.includes(":") && /^[0-9a-fA-F:.]+$/.test(s) && s.length <= 45) return true;
    return false;
  }

  function loadCacheStore() {
    try {
      return JSON.parse(sessionStorage.getItem(CACHE_KEY) || "{}") || {};
    } catch (_) {
      return {};
    }
  }

  function readCache(key) {
    const hit = loadCacheStore()[key];
    if (!hit?.data) return null;
    if (Date.now() - (hit.at || 0) > 30 * 60 * 1000) return null;
    return hit.data;
  }

  function saveCache(key, data) {
    try {
      const all = loadCacheStore();
      all[key] = { at: Date.now(), data };
      const keys = Object.keys(all);
      if (keys.length > 24) {
        keys
          .sort((a, b) => (all[a].at || 0) - (all[b].at || 0))
          .slice(0, keys.length - 24)
          .forEach((k) => delete all[k]);
      }
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(all));
    } catch (_) {}
  }

  async function fetchJson(url, { timeoutMs = 10000 } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function emptyInfo() {
    return {
      ip: "",
      type: "",
      hostname: "",
      continent: "",
      continentCode: "",
      country: "",
      countryCode: "",
      capital: "",
      borders: "",
      callingCode: "",
      isEu: null,
      region: "",
      regionCode: "",
      city: "",
      district: "",
      postal: "",
      latitude: null,
      longitude: null,
      timezone: "",
      timezoneAbbr: "",
      utcOffset: "",
      isDst: null,
      currency: "",
      currencyName: "",
      languages: "",
      asn: "",
      asnNumber: null,
      asName: "",
      org: "",
      isp: "",
      domain: "",
      mobile: null,
      proxy: null,
      hosting: null,
      anycast: null,
      flagEmoji: "",
      flagImg: "",
      sources: [],
      rawBySource: {},
      providerErrors: [],
      queriedAt: "",
    };
  }

  function fromIpwho(raw) {
    if (!raw || raw.success === false) {
      throw new Error(String(raw?.message || raw?.error || "ipwho.is 查询失败"));
    }
    const conn = raw.connection || {};
    const tz = raw.timezone || {};
    const flag = raw.flag || {};
    const info = emptyInfo();
    info.ip = raw.ip || "";
    info.type = raw.type || "";
    info.continent = raw.continent || "";
    info.continentCode = raw.continent_code || "";
    info.country = raw.country || "";
    info.countryCode = raw.country_code || "";
    info.capital = raw.capital || "";
    info.borders = raw.borders || "";
    info.callingCode = raw.calling_code || "";
    info.isEu = raw.is_eu == null ? null : Boolean(raw.is_eu);
    info.region = raw.region || "";
    info.regionCode = raw.region_code || "";
    info.city = raw.city || "";
    info.postal = raw.postal || "";
    info.latitude = Number.isFinite(Number(raw.latitude)) ? Number(raw.latitude) : null;
    info.longitude = Number.isFinite(Number(raw.longitude)) ? Number(raw.longitude) : null;
    info.timezone = tz.id || "";
    info.timezoneAbbr = tz.abbr || "";
    info.utcOffset = tz.utc || "";
    info.isDst = tz.is_dst == null ? null : Boolean(tz.is_dst);
    info.asn = conn.asn != null ? `AS${conn.asn}` : "";
    info.asnNumber = conn.asn != null ? Number(conn.asn) : null;
    info.org = conn.org || "";
    info.isp = conn.isp || "";
    info.domain = conn.domain || "";
    info.flagEmoji = flag.emoji || "";
    info.flagImg = flag.img || "";
    info.sources = ["ipwho.is"];
    info.rawBySource = { "ipwho.is": raw };
    return info;
  }

  function fromIpsb(raw, ipHint) {
    if (!raw || (!raw.ip && !ipHint)) throw new Error("ip.sb 无数据");
    const info = emptyInfo();
    info.ip = raw.ip || ipHint || "";
    info.type = String(info.ip).includes(":") ? "IPv6" : "IPv4";
    info.continentCode = raw.continent_code || "";
    info.country = raw.country || "";
    info.countryCode = raw.country_code || "";
    info.region = raw.region || "";
    info.city = raw.city || "";
    info.latitude = Number.isFinite(Number(raw.latitude)) ? Number(raw.latitude) : null;
    info.longitude = Number.isFinite(Number(raw.longitude)) ? Number(raw.longitude) : null;
    info.timezone = raw.timezone || "";
    info.utcOffset = raw.offset != null ? String(raw.offset) : "";
    info.asn = raw.asn != null ? `AS${raw.asn}` : "";
    info.asnNumber = raw.asn != null ? Number(raw.asn) : null;
    info.asName = raw.asn_organization || "";
    info.org = raw.organization || raw.asn_organization || "";
    info.isp = raw.isp || "";
    info.sources = ["ip.sb"];
    info.rawBySource = { "ip.sb": raw };
    return info;
  }

  function fromIpinfo(raw) {
    if (!raw?.ip) throw new Error("ipinfo.io 无数据");
    const info = emptyInfo();
    info.ip = raw.ip;
    info.type = raw.ip.includes(":") ? "IPv6" : "IPv4";
    info.hostname = raw.hostname || "";
    info.countryCode = raw.country || "";
    info.region = raw.region || "";
    info.city = raw.city || "";
    info.postal = raw.postal || "";
    info.timezone = raw.timezone || "";
    info.anycast = raw.anycast == null ? null : Boolean(raw.anycast);
    if (raw.loc && typeof raw.loc === "string") {
      const [a, b] = raw.loc.split(",");
      const lat = Number(a);
      const lon = Number(b);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        info.latitude = lat;
        info.longitude = lon;
      }
    }
    const org = String(raw.org || "");
    const m = org.match(/^(AS\d+)\s*(.*)$/i);
    if (m) {
      info.asn = m[1].toUpperCase();
      info.asnNumber = Number(m[1].replace(/^AS/i, ""));
      info.asName = m[2] || "";
      info.org = m[2] || org;
      info.isp = m[2] || org;
    } else if (org) {
      info.org = org;
      info.isp = org;
    }
    info.sources = ["ipinfo.io"];
    info.rawBySource = { "ipinfo.io": raw };
    return info;
  }

  function fromIpapi(raw) {
    if (!raw || raw.error) {
      throw new Error(String(raw?.reason || raw?.message || "ipapi.co 查询失败"));
    }
    const info = emptyInfo();
    info.ip = raw.ip || "";
    info.type = raw.version || (String(raw.ip || "").includes(":") ? "IPv6" : "IPv4");
    info.continentCode = raw.continent_code || "";
    info.country = raw.country_name || raw.country || "";
    info.countryCode = raw.country_code || raw.country || "";
    info.callingCode = raw.country_calling_code || raw.calling_code || "";
    info.isEu = raw.in_eu == null ? null : Boolean(raw.in_eu);
    info.region = raw.region || "";
    info.regionCode = raw.region_code || "";
    info.city = raw.city || "";
    info.postal = raw.postal || "";
    info.latitude = Number.isFinite(Number(raw.latitude)) ? Number(raw.latitude) : null;
    info.longitude = Number.isFinite(Number(raw.longitude)) ? Number(raw.longitude) : null;
    info.timezone = raw.timezone || "";
    info.utcOffset = raw.utc_offset || "";
    info.currency = raw.currency || "";
    info.currencyName = raw.currency_name || "";
    info.languages = raw.languages || "";
    info.asn = raw.asn || "";
    info.org = raw.org || "";
    info.isp = raw.org || "";
    info.sources = ["ipapi.co"];
    info.rawBySource = { "ipapi.co": raw };
    return info;
  }

  function mergeInfo(base, extra) {
    if (!extra) return base;
    const out = {
      ...base,
      sources: [...new Set([...(base.sources || []), ...(extra.sources || [])])],
      rawBySource: { ...(base.rawBySource || {}), ...(extra.rawBySource || {}) },
      providerErrors: [...(base.providerErrors || []), ...(extra.providerErrors || [])],
    };
    for (const key of Object.keys(extra)) {
      if (key === "sources" || key === "rawBySource" || key === "providerErrors") continue;
      const cur = out[key];
      const next = extra[key];
      const empty = cur === null || cur === undefined || cur === "";
      if (empty && next !== null && next !== undefined && next !== "") out[key] = next;
    }
    return out;
  }

  async function lookupProviders(ip) {
    const target = String(ip || "").trim();
    const errors = [];
    const runners = [
      [
        "ipwho.is",
        async () => {
          const url = target ? `https://ipwho.is/${encodeURIComponent(target)}` : "https://ipwho.is/";
          return fromIpwho(await fetchJson(url));
        },
      ],
      [
        "ip.sb",
        async () => {
          const url = target
            ? `https://api.ip.sb/geoip/${encodeURIComponent(target)}`
            : "https://api.ip.sb/geoip";
          return fromIpsb(await fetchJson(url), target);
        },
      ],
      [
        "ipinfo.io",
        async () => {
          const url = target
            ? `https://ipinfo.io/${encodeURIComponent(target)}/json`
            : "https://ipinfo.io/json";
          return fromIpinfo(await fetchJson(url));
        },
      ],
      [
        "ipapi.co",
        async () => {
          const url = target
            ? `https://ipapi.co/${encodeURIComponent(target)}/json/`
            : "https://ipapi.co/json/";
          return fromIpapi(await fetchJson(url));
        },
      ],
    ];

    let info = null;
    for (const [name, fn] of runners) {
      try {
        const part = await fn();
        info = info ? mergeInfo(info, part) : part;
        if (info.latitude != null && info.longitude != null && (info.country || info.countryCode)) break;
      } catch (err) {
        errors.push(`${name}: ${err.message || err}`);
      }
    }
    if (!info) throw new Error(errors.length ? `全部数据源失败：${errors.join("；")}` : "查询失败");

    if (!info.hostname || info.anycast == null || !info.currency) {
      try {
        const tip = info.ip || target;
        if (tip && (!info.hostname || info.anycast == null)) {
          const extra = await fromIpinfo(
            await fetchJson(`https://ipinfo.io/${encodeURIComponent(tip)}/json`)
          );
          info = mergeInfo(info, extra);
        }
      } catch (err) {
        errors.push(`ipinfo.io(补全): ${err.message || err}`);
      }
      if (!info.currency) {
        try {
          const tip = info.ip || target;
          if (tip) {
            const extra = await fromIpapi(
              await fetchJson(`https://ipapi.co/${encodeURIComponent(tip)}/json/`)
            );
            info = mergeInfo(info, extra);
          }
        } catch (err) {
          errors.push(`ipapi.co(补全): ${err.message || err}`);
        }
      }
    }

    info.providerErrors = errors;
    info.queriedAt = new Date().toISOString();
    return info;
  }

  async function resolveMyIp() {
    const cached = readCache("__mine__");
    if (cached?.ip) return cached.ip;
    for (const url of ["https://api.ipify.org?format=json", "https://api64.ipify.org?format=json"]) {
      try {
        const j = await fetchJson(url, { timeoutMs: 8000 });
        if (j?.ip) return String(j.ip);
      } catch (_) {}
    }
    return "";
  }

  function placeLine(info) {
    const parts = [info.city, info.region, info.country || info.countryCode].filter(Boolean);
    return parts.length ? parts.join(" · ") : "位置未知";
  }

  function ensureLeafletCss() {
    if (leafletCssReady) return Promise.resolve();
    if ([...document.querySelectorAll('link[data-vendor-css="leaflet"]')].length) {
      leafletCssReady = true;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      const v = encodeURIComponent(window.TOOLS_BUILD || "");
      link.href = v ? `${LEAFLET_CSS}?v=${v}` : LEAFLET_CSS;
      link.dataset.vendorCss = "leaflet";
      link.onload = () => {
        leafletCssReady = true;
        resolve();
      };
      link.onerror = () => {
        leafletCssReady = true;
        resolve();
      };
      document.head.appendChild(link);
    });
  }

  function getL() {
    return window.L || window.leaflet || null;
  }

  function ensureMap() {
    const L = getL();
    const el = root && $("#ipgeo-map", root);
    if (!L || !el) return null;
    if (map) {
      setTimeout(() => map.invalidateSize(), 40);
      return map;
    }
    if (L.Icon?.Default) {
      L.Icon.Default.mergeOptions({
        iconUrl: `${LEAFLET_IMG}marker-icon.png`,
        iconRetinaUrl: `${LEAFLET_IMG}marker-icon-2x.png`,
        shadowUrl: `${LEAFLET_IMG}marker-shadow.png`,
      });
    }
    map = L.map(el, { zoomControl: true, attributionControl: true, scrollWheelZoom: true });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    map.setView([20, 0], 2);
    return map;
  }

  function updateMap(info) {
    const card = $("#ipgeo-map-card", root);
    const meta = $("#ipgeo-map-meta", root);
    const lat = Number(info?.latitude);
    const lon = Number(info?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      if (card) card.hidden = true;
      if (meta) meta.textContent = "";
      return;
    }
    if (card) card.hidden = false;
    const L = getL();
    if (!L) {
      if (meta) meta.textContent = `坐标 ${lat.toFixed(5)}, ${lon.toFixed(5)}（地图库未加载）`;
      return;
    }
    ensureMap();
    const zoom = Math.abs(lat) < 1 && Math.abs(lon) < 1 ? 3 : 11;
    map.setView([lat, lon], zoom);
    if (marker) marker.remove();
    marker = L.marker([lat, lon]).addTo(map);
    marker.bindPopup(
      `<strong class="mono">${escapeHtml(info.ip || "")}</strong><br>${escapeHtml(placeLine(info))}<br><span class="mono">${lat.toFixed(5)}, ${lon.toFixed(5)}</span>`
    );
    if (meta) meta.textContent = `坐标 ${lat.toFixed(5)}, ${lon.toFixed(5)} · 底图 OpenStreetMap`;
    setTimeout(() => map.invalidateSize(), 60);
  }

  function fieldHtml(label, value) {
    const empty = value === null || value === undefined || value === "";
    return `<div class="ipgeo-field">
      <span class="ipgeo-field-label">${escapeHtml(label)}</span>
      <span class="ipgeo-field-value mono${empty ? " is-empty" : ""}">${escapeHtml(dash(value))}</span>
    </div>`;
  }

  function sectionHtml(title, fields) {
    return `<section class="ipgeo-section panel-card">
      <h2>${escapeHtml(title)}</h2>
      <div class="ipgeo-grid">${fields.map(([k, v]) => fieldHtml(k, v)).join("")}</div>
    </section>`;
  }

  function renderHero(info) {
    const hero = $("#ipgeo-hero", root);
    if (!hero) return;
    hero.hidden = false;
    const flag = $("#ipgeo-flag", root);
    const ipEl = $("#ipgeo-ip", root);
    const place = $("#ipgeo-place", root);
    const org = $("#ipgeo-org", root);
    const meta = $("#ipgeo-hero-meta", root);
    const copyBtn = $("#ipgeo-copy-ip", root);
    if (flag) flag.textContent = info.flagEmoji || "🌐";
    if (ipEl) ipEl.textContent = info.ip || "—";
    if (place) place.textContent = placeLine(info);
    if (org) org.textContent = [info.isp || info.org, info.asn].filter(Boolean).join(" · ") || "—";
    if (meta) {
      const chips = [];
      if (info.type) chips.push(`<span>${escapeHtml(info.type)}</span>`);
      if (info.timezone) chips.push(`<span>${escapeHtml(info.timezone)}</span>`);
      if (info.postal) chips.push(`<span>邮编 ${escapeHtml(info.postal)}</span>`);
      if (info.latitude != null && info.longitude != null) {
        chips.push(
          `<span>${escapeHtml(`${Number(info.latitude).toFixed(4)}, ${Number(info.longitude).toFixed(4)}`)}</span>`
        );
      }
      meta.innerHTML = chips.join("");
    }
    if (copyBtn) copyBtn.disabled = !info.ip;
  }

  function renderSections(info) {
    const host = $("#ipgeo-sections", root);
    if (!host) return;
    const currency =
      info.currency && info.currencyName
        ? `${info.currency}（${info.currencyName}）`
        : info.currency || info.currencyName || "";
    host.hidden = false;
    host.innerHTML = [
      sectionHtml("网络", [
        ["IP", info.ip],
        ["类型", info.type],
        ["主机名 / 反向解析", info.hostname],
        ["ASN", info.asn],
        ["AS 名称", info.asName],
        ["组织", info.org],
        ["运营商 (ISP)", info.isp],
        ["域名", info.domain],
        ["移动网络", info.mobile],
        ["代理 / VPN", info.proxy],
        ["托管 / 机房", info.hosting],
        ["Anycast", info.anycast],
      ]),
      sectionHtml("地理位置", [
        ["大洲", info.continent],
        ["大洲代码", info.continentCode],
        ["国家 / 地区", info.country],
        ["国家代码", info.countryCode],
        ["首都", info.capital],
        ["接壤", info.borders],
        ["国际区号", info.callingCode ? `+${String(info.callingCode).replace(/^\+/, "")}` : ""],
        ["欧盟成员", info.isEu],
        ["省 / 州", info.region],
        ["省州代码", info.regionCode],
        ["城市", info.city],
        ["区县", info.district],
        ["邮编", info.postal],
        ["纬度", info.latitude],
        ["经度", info.longitude],
      ]),
      sectionHtml("时区与货币", [
        ["时区", info.timezone],
        ["时区缩写", info.timezoneAbbr],
        ["UTC 偏移", info.utcOffset],
        ["夏令时", info.isDst],
        ["货币", currency],
        ["语言", info.languages],
      ]),
      sectionHtml("查询元数据", [
        ["数据源", (info.sources || []).join(" → ")],
        ["查询时间", info.queriedAt],
        ["备用源错误", (info.providerErrors || []).length ? (info.providerErrors || []).join("；") : "无"],
      ]),
    ].join("");
  }

  function renderRaw(info) {
    const wrap = $("#ipgeo-raw-wrap", root);
    const pre = $("#ipgeo-raw", root);
    if (!wrap || !pre) return;
    wrap.hidden = false;
    pre.textContent = JSON.stringify(info, null, 2);
  }

  function renderAll(info) {
    lastResult = info;
    renderHero(info);
    renderSections(info);
    renderRaw(info);
    updateMap(info);
  }

  async function runLookup({ mine = false } = {}) {
    if (!root) return;
    showError("");
    const input = $("#ipgeo-input", root);
    let ip = String(input?.value || "").trim();

    if (mine) {
      setStatus("正在解析本机公网 IP…");
      ip = await resolveMyIp();
      if (input) input.value = ip;
      if (!ip) setStatus("未能单独解析本机 IP，改由地理 API 直接识别…");
    } else if (ip && !isValidIp(ip)) {
      showError("IP 格式不正确，请输入合法的 IPv4 / IPv6。");
      return;
    }

    const cacheKey = ip || "__auto__";
    const cached = readCache(cacheKey);
    if (cached) {
      setStatus(`已用会话缓存（${new Date(cached.queriedAt || Date.now()).toLocaleString()}）`);
      renderAll(cached);
      return;
    }

    setStatus(ip ? `正在查询 ${ip}…` : "正在查询本机公网 IP…");
    const lookupBtn = $("#ipgeo-lookup", root);
    const mineBtn = $("#ipgeo-mine", root);
    if (lookupBtn) lookupBtn.disabled = true;
    if (mineBtn) mineBtn.disabled = true;
    try {
      await ensureLeafletCss();
      const info = await lookupProviders(ip);
      saveCache(cacheKey, info);
      if (info.ip) saveCache(info.ip, info);
      if (mine || !ip) saveCache("__mine__", { ip: info.ip });
      if (input && info.ip && !String(input.value || "").trim()) input.value = info.ip;
      setStatus(`完成 · 来源 ${(info.sources || []).join(" / ")}`);
      renderAll(info);
    } catch (err) {
      showError(err.message || String(err));
      setStatus("查询失败");
    } finally {
      if (lookupBtn) lookupBtn.disabled = false;
      if (mineBtn) mineBtn.disabled = false;
    }
  }

  function bind() {
    if (!root || root.dataset.ipgeoBound === "1") return;
    root.dataset.ipgeoBound = "1";
    $("#ipgeo-lookup", root)?.addEventListener("click", () => {
      runLookup({ mine: false }).catch((err) => showError(err.message || String(err)));
    });
    $("#ipgeo-mine", root)?.addEventListener("click", () => {
      runLookup({ mine: true }).catch((err) => showError(err.message || String(err)));
    });
    $("#ipgeo-input", root)?.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        runLookup({ mine: false }).catch((err) => showError(err.message || String(err)));
      }
    });
    $("#ipgeo-copy-ip", root)?.addEventListener("click", () => {
      const ip = lastResult?.ip;
      if (!ip) return;
      copyText(ip)
        .then(() => setStatus(`已复制 IP：${ip}`))
        .catch((err) => showError(err.message || String(err)));
    });
    $("#ipgeo-copy-json", root)?.addEventListener("click", () => {
      if (!lastResult) return;
      copyText(JSON.stringify(lastResult, null, 2))
        .then(() => setStatus("已复制 JSON"))
        .catch((err) => showError(err.message || String(err)));
    });
  }

  async function boot() {
    if (bootPromise) return bootPromise;
    bootPromise = (async () => {
      root = document.getElementById(TOOL_ID);
      if (!root) return;
      bind();
      await ensureLeafletCss();
      let autoIp = "";
      if (location.hash.includes("?")) {
        try {
          autoIp = String(new URLSearchParams(location.hash.split("?")[1] || "").get("ip") || "").trim();
        } catch (_) {}
      }
      if (autoIp && isValidIp(autoIp)) {
        const input = $("#ipgeo-input", root);
        if (input) input.value = autoIp;
        await runLookup({ mine: false });
      } else if (!lastResult) {
        await runLookup({ mine: true });
      } else {
        ensureMap();
      }
    })().finally(() => {
      bootPromise = null;
    });
    return bootPromise;
  }

  const start = () => {
    boot().catch((err) => showError(err.message || String(err)));
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();

  window.addEventListener("devtools:route", () => {
    const head = location.hash.replace(/^#/, "").split(/[/?]/)[0];
    if (head === TOOL_ID) start();
  });
})();
