"use strict";

/**
 * yt-dlp 本机桥：白名单参数 → spawn argv，禁止 shell / 任意附加参数。
 */

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const FEATURES = [
  "ytdlp-health",
  "ytdlp-probe",
  "ytdlp-formats",
  "ytdlp-playlist",
  "ytdlp-search",
  "ytdlp-download",
  "ytdlp-audio",
  "ytdlp-subs",
  "ytdlp-thumb",
  "ytdlp-metadata",
  "ytdlp-comments",
  "ytdlp-sponsorblock",
  "ytdlp-chapters",
  "ytdlp-live",
  "ytdlp-cookies",
  "ytdlp-proxy",
  "ytdlp-archive",
  "ytdlp-extractors",
  "ytdlp-update",
  "ytdlp-jobs",
  "ytdlp-job-cancel",
];

const BROWSERS = new Set([
  "chrome",
  "chromium",
  "chrome-beta",
  "chrome-canary",
  "edge",
  "edge-beta",
  "edge-dev",
  "firefox",
  "opera",
  "opera-gx",
  "brave",
  "vivaldi",
  "safari",
  "whale",
  "chromium-dev",
]);

const AUDIO_FORMATS = new Set(["best", "aac", "alac", "flac", "m4a", "mp3", "opus", "vorbis", "wav"]);
const MERGE_FORMATS = new Set(["mp4", "mkv", "webm", "mov", "avi", "flv"]);
const RECODE_FORMATS = new Set(["mp4", "mkv", "webm", "mov", "avi", "flv", "gif"]);
const SUB_FORMATS = new Set(["srt", "vtt", "ass", "lrc", "ttml"]);
const SB_CATS = new Set([
  "sponsor",
  "intro",
  "outro",
  "selfpromo",
  "preview",
  "filler",
  "interaction",
  "music_offtopic",
  "poi_highlight",
  "chapter",
  "all",
  "default",
]);
const SEARCH_PREFIX = /^(ytsearch|ytsearchdate|bvsearch|scsearch|nicksearch|ghsearch|bili[a-z]*search)\d*:/i;
const YT_PLAYER_CLIENTS = new Set(["web", "web_safari", "web_embedded", "android", "ios", "mweb", "tv", "tv_embedded"]);

function createYtdlp(deps) {
  const {
    whichSync,
    execFileAsync,
    resolveLocalPath,
    ensureWritableDir,
    mkdirpAllowed,
    revealLocalPath,
    localFsRoots,
    sendJson,
    readBody,
    parseJsonBody,
  } = deps;

  const JOBS = new Map();

  function whichYtdlp() {
    const envPath = String(process.env.YTDLP_PATH || "").trim();
    if (envPath && fs.existsSync(envPath)) return envPath;
    return (
      whichSync("yt-dlp") ||
      whichSync("yt-dlp.exe") ||
      whichSync("youtube-dl") ||
      whichSync("youtube-dl.exe") ||
      ""
    );
  }

  async function checkYtdlp() {
    const bin = whichYtdlp();
    if (!bin) {
      return {
        ok: false,
        error: "未找到 yt-dlp",
        setup:
          "请安装 yt-dlp 并加入 PATH。macOS: brew install yt-dlp；Windows: pipx install yt-dlp 或从 GitHub Releases 下载 yt-dlp.exe；Linux: pipx/pip/pacman/apt。也可设置环境变量 YTDLP_PATH。",
      };
    }
    try {
      const { stdout, stderr } = await execFileAsync(bin, ["--version"], { timeout: 12000 });
      const ver = String(stdout || stderr || "").trim().split(/\r?\n/)[0] || "ok";
      return { ok: true, version: ver.slice(0, 120), path: bin, binary: path.basename(bin) };
    } catch (err) {
      return { ok: false, error: err.message || String(err), path: bin };
    }
  }

  function createJob(type, meta = {}) {
    const id = crypto.randomBytes(6).toString("hex");
    const job = {
      id,
      type,
      status: "queued",
      progress: 0,
      message: "",
      logTail: [],
      artifacts: [],
      meta,
      error: "",
      child: null,
      pid: null,
      cancelRequested: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    JOBS.set(id, job);
    return job;
  }

  function touchJob(job, patch = {}) {
    Object.assign(job, patch, { updatedAt: Date.now() });
    if (patch.logLine) {
      job.logTail = [...(job.logTail || []), String(patch.logLine).slice(0, 500)].slice(-40);
    }
    return job;
  }

  function publicJob(job) {
    return {
      id: job.id,
      type: job.type,
      status: job.status,
      progress: job.progress,
      message: job.message,
      logTail: job.logTail || [],
      artifacts: (job.artifacts || []).map((a) => ({
        name: a.name,
        size: a.size,
        path: a.path || "",
      })),
      meta: job.meta,
      error: job.error,
      cancelRequested: Boolean(job.cancelRequested),
      pid: job.pid || null,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }

  function cancelJob(job) {
    job.cancelRequested = true;
    if (job.child && !job.child.killed) {
      try {
        job.child.kill("SIGTERM");
      } catch (_) {
        /* ignore */
      }
    }
    touchJob(job, { message: "正在取消…" });
    return publicJob(job);
  }

  function assertUrl(raw) {
    const u = String(raw || "").trim();
    if (!u || u.length > 2000) throw new Error("链接无效或过长");
    if (/[\r\n\0]/.test(u)) throw new Error("链接含非法字符");
    if (SEARCH_PREFIX.test(u)) return u;
    if (!/^https?:\/\//i.test(u)) throw new Error("仅允许 http(s) 链接或 ytsearch 等搜索前缀");
    let parsed;
    try {
      parsed = new URL(u);
    } catch {
      throw new Error("无法解析链接");
    }
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("非法协议");
    return u;
  }

  function parseUrlList(body) {
    const raw = body.urls || body.url || "";
    const list = Array.isArray(raw)
      ? raw
      : String(raw)
          .split(/[\n\r,]+/)
          .map((s) => s.trim())
          .filter(Boolean);
    if (!list.length) throw new Error("请提供至少一个链接");
    if (list.length > 80) throw new Error("一次最多 80 条链接");
    return list.map(assertUrl);
  }

  function optStr(v, max = 400) {
    const s = String(v ?? "").trim();
    if (!s) return "";
    if (s.length > max) throw new Error("参数过长");
    if (/[\r\n\0]/.test(s)) throw new Error("参数含非法字符");
    return s;
  }

  function optInt(v, min, max) {
    if (v == null || v === "") return null;
    const n = Number.parseInt(String(v), 10);
    if (!Number.isFinite(n)) throw new Error("数字无效");
    if (n < min || n > max) throw new Error(`数字需在 ${min}–${max}`);
    return n;
  }

  function optBool(v) {
    return v === true || v === "1" || v === "true" || v === "on";
  }

  function sanitizeFormat(raw) {
    const s = optStr(raw, 300);
    if (!s) return "";
    if (!/^[a-zA-Z0-9*+\-/\[\]().,:_<>=! |]+$/.test(s)) throw new Error("format 含非法字符");
    return s;
  }

  function sanitizeTemplate(raw) {
    const s = optStr(raw, 300) || "%(title).200B [%(id)s].%(ext)s";
    if (/[\r\n\0;|&`$]/.test(s)) throw new Error("输出模板含非法字符");
    return s;
  }

  function sanitizeProxy(raw) {
    const s = optStr(raw, 300);
    if (!s) return "";
    if (!/^(https?|socks5h?|socks4):\/\//i.test(s)) throw new Error("代理须为 http(s)/socks  URL");
    return s;
  }

  function sanitizeBrowser(raw) {
    const s = optStr(raw, 80);
    if (!s) return "";
    const [name, profile] = s.split(":");
    if (!BROWSERS.has(String(name).toLowerCase())) throw new Error("不支持的浏览器（cookies）");
    if (profile && /[;&|`$]/.test(profile)) throw new Error("浏览器配置名非法");
    return profile ? `${name.toLowerCase()}:${profile}` : name.toLowerCase();
  }

  function sanitizeLangs(raw) {
    const s = optStr(raw, 200);
    if (!s) return "";
    if (!/^[a-zA-Z0-9,.*_\-]+$/.test(s)) throw new Error("字幕语言格式无效");
    return s;
  }

  function sanitizeSb(raw) {
    const s = optStr(raw, 200);
    if (!s) return "";
    const parts = s.split(",").map((x) => x.trim()).filter(Boolean);
    for (const p of parts) {
      if (!SB_CATS.has(p)) throw new Error(`未知 SponsorBlock 分类: ${p}`);
    }
    return parts.join(",");
  }

  function sanitizeMatchFilter(raw) {
    const s = optStr(raw, 400);
    if (!s) return "";
    if (/[;&|`$\\]/.test(s)) throw new Error("match-filter 含非法字符");
    return s;
  }

  function sanitizePlaylistItems(raw) {
    const s = optStr(raw, 80);
    if (!s) return "";
    if (!/^[0-9,\- ]+$/.test(s)) throw new Error("playlist-items 仅允许数字、逗号和短横线");
    return s.replace(/\s+/g, "");
  }

  function sanitizeDate(raw) {
    const s = optStr(raw, 16);
    if (!s) return "";
    if (!/^\d{8}$/.test(s) && !/^now-\d+[dwmy]$/i.test(s)) throw new Error("日期须为 YYYYMMDD 或 now-1y");
    return s;
  }

  function sanitizeRate(raw) {
    const s = optStr(raw, 20);
    if (!s) return "";
    if (!/^\d+(\.\d+)?[KMG]?$/i.test(s)) throw new Error("限速格式如 2M、500K");
    return s;
  }

  function sanitizeExtractorArgs(raw) {
    const s = optStr(raw, 200);
    if (!s) return "";
    const m = /^youtube:player_client=([a-z0-9_,]+)$/i.exec(s);
    if (!m) throw new Error("extractor-args 目前仅允许 youtube:player_client=web,android,…");
    const clients = m[1].split(",").map((x) => x.trim()).filter(Boolean);
    for (const c of clients) {
      if (!YT_PLAYER_CLIENTS.has(c)) throw new Error(`未知 player_client: ${c}`);
    }
    return `youtube:player_client=${clients.join(",")}`;
  }

  function commonNetArgs(opts) {
    const args = ["--no-warnings", "--encoding", "utf-8", "--newline"];
    const cookiesBrowser = sanitizeBrowser(opts.cookiesFromBrowser);
    if (cookiesBrowser) args.push("--cookies-from-browser", cookiesBrowser);
    const cookiesFile = optStr(opts.cookiesFile, 500);
    if (cookiesFile) args.push("--cookies", cookiesFile);
    const proxy = sanitizeProxy(opts.proxy);
    if (proxy) args.push("--proxy", proxy);
    if (optBool(opts.geoBypass)) args.push("--geo-bypass");
    if (optBool(opts.forceIpv4)) args.push("--force-ipv4");
    if (optBool(opts.forceIpv6)) args.push("--force-ipv6");
    const retries = optInt(opts.retries, 0, 50);
    if (retries != null) args.push("--retries", String(retries));
    const fragRetries = optInt(opts.fragmentRetries, 0, 50);
    if (fragRetries != null) args.push("--fragment-retries", String(fragRetries));
    const conc = optInt(opts.concurrentFragments, 1, 16);
    if (conc != null) args.push("--concurrent-fragments", String(conc));
    const rate = sanitizeRate(opts.limitRate);
    if (rate) args.push("--limit-rate", rate);
    const sleep = optInt(opts.sleepInterval, 0, 120);
    if (sleep) args.push("--sleep-interval", String(sleep));
    const maxSleep = optInt(opts.maxSleepInterval, 0, 300);
    if (maxSleep) args.push("--max-sleep-interval", String(maxSleep));
    const ea = sanitizeExtractorArgs(opts.extractorArgs);
    if (ea) args.push("--extractor-args", ea);
    const socket = optInt(opts.socketTimeout, 5, 300);
    if (socket) args.push("--socket-timeout", String(socket));
    return args;
  }

  async function resolveCookiesFile(opts) {
    const cookiesFile = optStr(opts.cookiesFile, 500);
    if (!cookiesFile) return opts;
    const real = await resolveLocalPath(cookiesFile);
    return { ...opts, cookiesFile: real };
  }

  function summarizeInfo(info) {
    if (!info || typeof info !== "object") return null;
    if (info._type === "playlist" || Array.isArray(info.entries)) {
      const entries = (info.entries || []).slice(0, 500).map((e, i) => ({
        index: i + 1,
        id: e.id || e.url || "",
        title: e.title || e.id || `条目 ${i + 1}`,
        duration: Number(e.duration) || 0,
        url: e.url || e.webpage_url || "",
        uploader: e.uploader || e.channel || "",
      }));
      return {
        type: "playlist",
        id: info.id || "",
        title: info.title || "播放列表",
        uploader: info.uploader || info.channel || "",
        webpage_url: info.webpage_url || info.original_url || "",
        nEntries: Number(info.playlist_count) || entries.length,
        entries,
        extractor: info.extractor || info.extractor_key || "",
      };
    }
    const formats = Array.isArray(info.formats)
      ? info.formats
          .filter((f) => f && f.format_id && f.format_id !== "sb0")
          .map((f) => ({
            id: String(f.format_id),
            ext: f.ext || "",
            note: f.format_note || f.format || "",
            resolution: f.resolution || (f.height ? `${f.width || "?"}x${f.height}` : "audio"),
            height: Number(f.height) || 0,
            fps: Number(f.fps) || 0,
            vcodec: f.vcodec && f.vcodec !== "none" ? f.vcodec : "",
            acodec: f.acodec && f.acodec !== "none" ? f.acodec : "",
            abr: Number(f.abr) || 0,
            tbr: Number(f.tbr) || 0,
            filesize: Number(f.filesize || f.filesize_approx) || 0,
            language: f.language || "",
            protocol: f.protocol || "",
            dynamicRange: f.dynamic_range || "",
            videoOnly: Boolean(f.vcodec && f.vcodec !== "none" && (!f.acodec || f.acodec === "none")),
            audioOnly: Boolean(f.acodec && f.acodec !== "none" && (!f.vcodec || f.vcodec === "none")),
          }))
      : [];
    const subs = info.subtitles || {};
    const autoCaptions = info.automatic_captions || {};
    return {
      type: "video",
      id: info.id || "",
      title: info.title || info.id || "未命名",
      description: String(info.description || "").slice(0, 4000),
      duration: Number(info.duration) || 0,
      uploader: info.uploader || info.channel || info.creator || "",
      uploadDate: info.upload_date || "",
      viewCount: Number(info.view_count) || 0,
      likeCount: Number(info.like_count) || 0,
      webpage_url: info.webpage_url || info.original_url || "",
      thumbnail: info.thumbnail || (info.thumbnails || []).slice(-1)[0]?.url || "",
      extractor: info.extractor || info.extractor_key || "",
      isLive: Boolean(info.is_live || info.was_live),
      liveStatus: info.live_status || "",
      ageLimit: Number(info.age_limit) || 0,
      availability: info.availability || "",
      chapters: Array.isArray(info.chapters)
        ? info.chapters.map((c) => ({
            title: c.title || "",
            start: Number(c.start_time) || 0,
            end: Number(c.end_time) || 0,
          }))
        : [],
      subtitles: Object.keys(subs),
      automaticCaptions: Object.keys(autoCaptions).slice(0, 40),
      formats,
    };
  }

  async function runYtdlpJson(extraArgs, { timeout = 120000 } = {}) {
    const bin = whichYtdlp();
    if (!bin) throw new Error("未找到 yt-dlp");
    const args = ["-J", ...extraArgs];
    const { stdout, stderr } = await execFileAsync(bin, args, {
      timeout,
      maxBuffer: 80 * 1024 * 1024,
    });
    const text = String(stdout || "").trim();
    if (!text) throw new Error(String(stderr || "yt-dlp 无输出").slice(0, 2000));
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("yt-dlp JSON 解析失败：" + text.slice(0, 300));
    }
  }

  async function probe(body) {
    const urls = parseUrlList(body);
    const opts = await resolveCookiesFile(body);
    const net = commonNetArgs(opts);
    const results = [];
    for (const url of urls.slice(0, 20)) {
      const args = [...net, "--skip-download"];
      if (optBool(body.flat) || optBool(body.yesPlaylist) || SEARCH_PREFIX.test(url)) {
        args.push("--yes-playlist", "--flat-playlist");
      } else {
        args.push("--no-playlist");
      }
      try {
        const info = await runYtdlpJson([...args, url], { timeout: 180000 });
        results.push({ ok: true, url, info: summarizeInfo(info), rawType: info._type || "video" });
      } catch (err) {
        results.push({ ok: false, url, error: err.message || String(err) });
      }
    }
    return { ok: true, results };
  }

  function buildDownloadArgs(opts, urls, outDir) {
    const args = [...commonNetArgs(opts), "--progress"];
    args.push("-P", outDir);
    args.push("-o", sanitizeTemplate(opts.outputTemplate));
    if (optBool(opts.restrictFilenames)) args.push("--restrict-filenames");
    if (optBool(opts.windowsFilenames) || process.platform === "win32") args.push("--windows-filenames");
    if (optBool(opts.noOverwrites) || opts.overwrite === false) args.push("--no-overwrites");
    if (optBool(opts.forceOverwrites) || opts.overwrite === true) args.push("--force-overwrites");
    if (optBool(opts.keepVideo)) args.push("-k");
    if (optBool(opts.noPlaylist)) args.push("--no-playlist");
    if (optBool(opts.yesPlaylist)) args.push("--yes-playlist");
    if (optBool(opts.playlistRandom)) args.push("--playlist-random");
    if (optBool(opts.lazyPlaylist)) args.push("--lazy-playlist");
    if (optBool(opts.ignoreErrors)) args.push("--ignore-errors");

    const mode = String(opts.mode || "best");
    const height = optInt(opts.height, 144, 4320);
    const format = sanitizeFormat(opts.format);
    if (mode === "audio") {
      args.push("-x");
      const af = String(opts.audioFormat || "mp3").toLowerCase();
      if (!AUDIO_FORMATS.has(af)) throw new Error("不支持的音频格式");
      args.push("--audio-format", af);
      const aq = optInt(opts.audioQuality, 0, 10);
      if (aq != null) args.push("--audio-quality", String(aq));
    } else if (mode === "format" && format) {
      args.push("-f", format);
    } else if (mode === "height" && height) {
      args.push("-f", `bv*[height<=${height}]+ba/b[height<=${height}]/bv*+ba/b`);
    } else if (format) {
      args.push("-f", format);
    } else {
      args.push("-f", "bv*+ba/b");
    }
    const sort = optStr(opts.formatSort, 120);
    if (sort) {
      if (!/^[a-zA-Z0-9:+_,.\-]+$/.test(sort)) throw new Error("format-sort 非法");
      args.push("-S", sort);
    }
    const merge = String(opts.mergeOutputFormat || "").toLowerCase();
    if (merge) {
      if (!MERGE_FORMATS.has(merge)) throw new Error("合并容器不支持");
      args.push("--merge-output-format", merge);
    }
    const recode = String(opts.recodeVideo || "").toLowerCase();
    if (recode) {
      if (!RECODE_FORMATS.has(recode)) throw new Error("转码格式不支持");
      args.push("--recode-video", recode);
    }
    const remux = String(opts.remuxVideo || "").toLowerCase();
    if (remux) {
      if (!MERGE_FORMATS.has(remux)) throw new Error("remux 格式不支持");
      args.push("--remux-video", remux);
    }

    const items = sanitizePlaylistItems(opts.playlistItems);
    if (items) args.push("--playlist-items", items);
    const pStart = optInt(opts.playlistStart, 1, 100000);
    if (pStart) args.push("--playlist-start", String(pStart));
    const pEnd = optInt(opts.playlistEnd, 1, 100000);
    if (pEnd) args.push("--playlist-end", String(pEnd));
    const maxDl = optInt(opts.maxDownloads, 1, 10000);
    if (maxDl) args.push("--max-downloads", String(maxDl));
    const dateAfter = sanitizeDate(opts.dateAfter);
    if (dateAfter) args.push("--dateafter", dateAfter);
    const dateBefore = sanitizeDate(opts.dateBefore);
    if (dateBefore) args.push("--datebefore", dateBefore);
    const mf = sanitizeMatchFilter(opts.matchFilter);
    if (mf) args.push("--match-filter", mf);
    const minSize = sanitizeRate(opts.minFilesize);
    if (minSize) args.push("--min-filesize", minSize);
    const maxSize = sanitizeRate(opts.maxFilesize);
    if (maxSize) args.push("--max-filesize", maxSize);
    const age = optInt(opts.ageLimit, 0, 21);
    if (age != null) args.push("--age-limit", String(age));

    if (optBool(opts.writeSubs)) args.push("--write-subs");
    if (optBool(opts.writeAutoSubs)) args.push("--write-auto-subs");
    const langs = sanitizeLangs(opts.subLangs);
    if (langs) args.push("--sub-langs", langs);
    const conv = String(opts.convertSubs || "").toLowerCase();
    if (conv) {
      if (!SUB_FORMATS.has(conv)) throw new Error("字幕转换格式不支持");
      args.push("--convert-subs", conv);
    }
    if (optBool(opts.embedSubs)) args.push("--embed-subs");
    if (optBool(opts.writeThumbnail)) args.push("--write-thumbnail");
    if (optBool(opts.embedThumbnail)) args.push("--embed-thumbnail");
    if (optBool(opts.writeInfoJson)) args.push("--write-info-json");
    if (optBool(opts.writeDescription)) args.push("--write-description");
    if (optBool(opts.writeComments)) args.push("--write-comments");
    if (optBool(opts.writeLink)) args.push("--write-link");
    if (optBool(opts.embedMetadata)) args.push("--embed-metadata");
    if (optBool(opts.embedChapters)) args.push("--embed-chapters");
    if (optBool(opts.splitChapters)) args.push("--split-chapters");
    if (optBool(opts.writePlaylistMetafiles)) args.push("--write-playlist-metafiles");

    const sbMark = sanitizeSb(opts.sponsorblockMark);
    if (sbMark) args.push("--sponsorblock-mark", sbMark);
    const sbRm = sanitizeSb(opts.sponsorblockRemove);
    if (sbRm) args.push("--sponsorblock-remove", sbRm);

    if (optBool(opts.liveFromStart)) args.push("--live-from-start");
    const wait = optInt(opts.waitForVideo, 0, 86400);
    if (wait) args.push("--wait-for-video", String(wait));
    if (optBool(opts.hlsUseMpegts)) args.push("--hls-use-mpegts");
    if (optBool(opts.noPart)) args.push("--no-part");
    if (optBool(opts.preferFreeFormats)) args.push("--prefer-free-formats");
    if (optBool(opts.embedInfoJson)) args.push("--embed-info-json");

    if (optBool(opts.downloadArchive)) {
      args.push("--download-archive", path.join(outDir, ".ytdlp-archive.txt"));
    }

    if (optBool(opts.simulate)) args.push("--simulate");
    args.push("--", ...urls);
    return args;
  }

  function parseProgress(line, job) {
    const item = /Downloading item (\d+) of (\d+)/i.exec(line);
    if (item) {
      const cur = Number(item[1]);
      const total = Number(item[2]) || 1;
      touchJob(job, {
        progress: Math.min(0.99, (cur - 1) / total),
        message: `条目 ${cur}/${total}`,
        logLine: line,
        meta: { ...job.meta, playlistIndex: cur, playlistTotal: total },
      });
      return;
    }
    const pct = /\[download\]\s+([0-9.]+)%/.exec(line);
    if (pct) {
      const p = Number(pct[1]) / 100;
      const base = Number(job.meta.playlistIndex || 1) - 1;
      const total = Number(job.meta.playlistTotal) || 1;
      const overall = total > 1 ? (base + p) / total : p;
      touchJob(job, { progress: Math.min(0.99, overall), message: line.slice(0, 180), logLine: line });
      return;
    }
    if (/\[Merger\]|\[ExtractAudio\]|\[Fixup|\[Embed|Destination:|Deleting original/i.test(line)) {
      touchJob(job, { message: line.slice(0, 180), logLine: line });
    } else if (/ERROR:/i.test(line)) {
      touchJob(job, { logLine: line, message: line.slice(0, 180) });
    }
  }

  function spawnYtdlp(args) {
    const bin = whichYtdlp();
    if (!bin) throw new Error("未找到 yt-dlp");
    const child = spawn(bin, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return child;
  }

  async function collectNewFiles(dir, sinceMs) {
    const out = [];
    let entries = [];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const ent of entries) {
      if (!ent.isFile()) continue;
      if (ent.name === ".ytdlp-archive.txt") continue;
      const full = path.join(dir, ent.name);
      try {
        const st = await fs.promises.stat(full);
        if (st.mtimeMs >= sinceMs - 2000) out.push({ name: ent.name, path: full, size: st.size });
      } catch {
        /* skip */
      }
    }
    return out.sort((a, b) => b.size - a.size);
  }

  function runJobAsync(job, runner) {
    setImmediate(async () => {
      touchJob(job, { status: "running", progress: 0.01, message: "启动 yt-dlp…" });
      try {
        await runner(job);
        if (job.cancelRequested) {
          touchJob(job, { status: "cancelled", message: "已取消" });
        } else {
          touchJob(job, { status: "done", progress: 1, message: job.message || "完成" });
        }
      } catch (err) {
        touchJob(job, {
          status: job.cancelRequested ? "cancelled" : "error",
          error: err.message || String(err),
          message: job.cancelRequested ? "已取消" : "失败",
        });
      } finally {
        job.child = null;
        job.pid = null;
      }
    });
  }

  async function startDownload(body) {
    const urls = parseUrlList(body);
    const opts = await resolveCookiesFile(body);
    let outDir;
    if (opts.createOutDir) outDir = await mkdirpAllowed(opts.outDir || "");
    else outDir = await ensureWritableDir(opts.outDir || "");
    const args = buildDownloadArgs(opts, urls, outDir);
    const job = createJob("ytdlp-download", {
      urls,
      outDir,
      mode: opts.mode || "best",
      title: urls.length === 1 ? urls[0] : `${urls.length} 条链接`,
    });
    const started = Date.now();
    runJobAsync(job, async () => {
      await new Promise((resolve, reject) => {
        const child = spawnYtdlp(args);
        job.child = child;
        job.pid = child.pid || null;
        let errBuf = "";
        const onData = (buf) => {
          const text = buf.toString("utf8");
          errBuf = (errBuf + text).slice(-8000);
          for (const line of text.split(/\r?\n/)) {
            const t = line.trim();
            if (t) parseProgress(t, job);
          }
        };
        child.stdout.on("data", onData);
        child.stderr.on("data", onData);
        child.on("error", (err) => reject(err));
        child.on("close", (code) => {
          if (job.cancelRequested) {
            resolve();
            return;
          }
          if (code === 0) resolve();
          else reject(new Error(errBuf.slice(-1500) || `yt-dlp 退出码 ${code}`));
        });
      });
      job.artifacts = await collectNewFiles(outDir, started);
      touchJob(job, {
        message: job.artifacts.length ? `完成 · ${job.artifacts.length} 个文件` : "完成",
      });
    });
    return job;
  }

  async function listExtractors() {
    const bin = whichYtdlp();
    if (!bin) throw new Error("未找到 yt-dlp");
    const { stdout } = await execFileAsync(bin, ["--list-extractors"], { timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
    const names = String(stdout || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    return { ok: true, count: names.length, extractors: names };
  }

  async function selfUpdate() {
    const bin = whichYtdlp();
    if (!bin) throw new Error("未找到 yt-dlp");
    const { stdout, stderr } = await execFileAsync(bin, ["-U"], { timeout: 120000 });
    return { ok: true, output: String(stdout || stderr || "").slice(0, 4000) };
  }

  async function handle(req, res, ctx) {
    const origin = ctx.origin || "";
    let pathname = String(ctx.pathname || "");
    if (pathname.length > 1 && pathname.endsWith("/")) pathname = pathname.replace(/\/+$/, "");

    if (req.method === "GET" && (pathname === "/ytdlp/health" || pathname === "/ytdlp")) {
      const [ytdlp, ffmpeg, ffprobe] = await Promise.all([
        checkYtdlp(),
        deps.checkBinary ? deps.checkBinary("ffmpeg", ["-version"]) : Promise.resolve({ ok: false }),
        deps.checkBinary ? deps.checkBinary("ffprobe", ["-version"]) : Promise.resolve({ ok: false }),
      ]);
      sendJson(
        res,
        200,
        {
          ok: true,
          service: "devtools-ytdlp",
          features: FEATURES,
          ytdlp,
          ffmpeg,
          ffprobe,
          roots: localFsRoots(),
          browsers: [...BROWSERS],
          audioFormats: [...AUDIO_FORMATS],
          mergeFormats: [...MERGE_FORMATS],
          subFormats: [...SUB_FORMATS],
          sponsorblock: [...SB_CATS],
          playerClients: [...YT_PLAYER_CLIENTS],
        },
        origin
      );
      return true;
    }

    if (req.method === "POST" && pathname === "/ytdlp/probe") {
      const body = parseJsonBody(await readBody(req, 512 * 1024));
      const data = await probe(body);
      sendJson(res, 200, data, origin);
      return true;
    }

    if (req.method === "GET" && pathname === "/ytdlp/extractors") {
      const data = await listExtractors();
      sendJson(res, 200, data, origin);
      return true;
    }

    if (req.method === "POST" && pathname === "/ytdlp/update") {
      const data = await selfUpdate();
      sendJson(res, 200, data, origin);
      return true;
    }

    if (req.method === "GET" && pathname === "/ytdlp/jobs") {
      const jobs = [...JOBS.values()]
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 50)
        .map(publicJob);
      sendJson(res, 200, { ok: true, jobs }, origin);
      return true;
    }

    if (req.method === "GET" && pathname.startsWith("/ytdlp/jobs/")) {
      const id = pathname.slice("/ytdlp/jobs/".length).split("/")[0];
      const job = JOBS.get(id);
      if (!job) {
        sendJson(res, 404, { ok: false, error: "任务不存在" }, origin);
        return true;
      }
      sendJson(res, 200, { ok: true, job: publicJob(job) }, origin);
      return true;
    }

    if (req.method === "POST" && /^\/ytdlp\/jobs\/[^/]+\/cancel$/.test(pathname)) {
      const id = pathname.split("/")[3];
      const job = JOBS.get(id);
      if (!job) {
        sendJson(res, 404, { ok: false, error: "任务不存在" }, origin);
        return true;
      }
      sendJson(res, 200, { ok: true, job: cancelJob(job) }, origin);
      return true;
    }

    if (req.method === "POST" && (pathname === "/ytdlp/jobs" || pathname === "/ytdlp/download")) {
      const body = parseJsonBody(await readBody(req, 512 * 1024));
      const job = await startDownload(body);
      sendJson(res, 200, { ok: true, job: publicJob(job) }, origin);
      return true;
    }

    if (req.method === "POST" && pathname === "/ytdlp/reveal") {
      const body = parseJsonBody(await readBody(req));
      const revealed = await revealLocalPath(body.path || "");
      sendJson(res, 200, { ok: true, path: revealed.path, isDir: revealed.isDir }, origin);
      return true;
    }

    return false;
  }

  return {
    FEATURES,
    checkYtdlp,
    handle,
    buildDownloadArgs,
    assertUrl,
    JOBS,
  };
}

module.exports = createYtdlp;
module.exports.FEATURES = FEATURES;
