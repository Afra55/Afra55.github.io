(() => {
  "use strict";

  const P = window.DevToolsPure;
  if (!P) {
    console.error("DevToolsPure missing");
    return;
  }

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function setError(el, msg) {
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = msg;
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
    }, 1400);
  }

  // ---- Time diff ----
  const tdA = $("#td-a");
  const tdB = $("#td-b");
  const tdResult = $("#td-result");
  const tdValue = $("#td-result-value");
  const tdError = $("#td-error");

  function fillNowDate(input) {
    input.value = P.formatDateTime(Date.now());
  }

  function fillNowTs(input, asMs) {
    const now = Date.now();
    input.value = String(asMs ? now : Math.floor(now / 1000));
  }

  function calcTimeDiff() {
    try {
      const r = P.timeDiff(tdA.value, tdB.value);
      tdValue.textContent = r.text;
      tdResult.hidden = false;
      setError(tdError, "");
    } catch (err) {
      tdResult.hidden = true;
      setError(tdError, err.message || String(err));
    }
  }

  $("#td-now-a")?.addEventListener("click", () => fillNowDate(tdA));
  $("#td-now-b")?.addEventListener("click", () => fillNowDate(tdB));
  $("#td-ts-a")?.addEventListener("click", () => fillNowTs(tdA, false));
  $("#td-ts-b")?.addEventListener("click", () => fillNowTs(tdB, false));
  $("#td-ms-a")?.addEventListener("click", () => fillNowTs(tdA, true));
  $("#td-ms-b")?.addEventListener("click", () => fillNowTs(tdB, true));
  $("#td-calc")?.addEventListener("click", calcTimeDiff);
  [tdA, tdB].forEach((el) => {
    el?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") calcTimeDiff();
    });
  });

  // 默认演示：秒时间戳 vs 日期时间
  fillNowTs(tdA, false);
  fillNowDate(tdB);
  tdB.value = P.formatDateTime(Date.now() + 86400000);

  // ---- Color convert ----
  const cHex = $("#c-hex");
  const cRgb = $("#c-rgb");
  const cHsl = $("#c-hsl");
  const cSwatch = $("#c-swatch");
  const cPreview = $("#c-preview-hex");
  const cError = $("#c-error");
  let colorSync = false;

  function applyColorSource(source) {
    if (colorSync) return;
    try {
      const value = source === "hex" ? cHex.value : source === "rgb" ? cRgb.value : cHsl.value;
      const color = P.colorFrom(source, value);
      colorSync = true;
      cHex.value = color.hex;
      cRgb.value = color.rgb;
      cHsl.value = color.hsl;
      cSwatch.style.backgroundColor = color.rgb;
      cPreview.textContent = color.hex;
      setError(cError, "");
    } catch (err) {
      setError(cError, err.message || String(err));
    } finally {
      colorSync = false;
    }
  }

  cHex?.addEventListener("input", () => applyColorSource("hex"));
  cRgb?.addEventListener("input", () => applyColorSource("rgb"));
  cHsl?.addEventListener("input", () => applyColorSource("hsl"));
  applyColorSource("hex");

  // ---- URL ----
  const urlRaw = $("#url-raw");
  const urlEnc = $("#url-enc");
  const urlError = $("#url-error");
  $("#url-encode")?.addEventListener("click", () => {
    try {
      urlEnc.value = encodeURIComponent(urlRaw.value);
      setError(urlError, "");
    } catch (err) {
      setError(urlError, err.message || String(err));
    }
  });
  $("#url-decode")?.addEventListener("click", () => {
    try {
      urlRaw.value = decodeURIComponent(urlEnc.value);
      setError(urlError, "");
    } catch (err) {
      setError(urlError, "解码失败：内容不是合法的 URL 编码");
    }
  });
  $("#url-swap")?.addEventListener("click", () => {
    const t = urlRaw.value;
    urlRaw.value = urlEnc.value;
    urlEnc.value = t;
  });

  // ---- Query / JWT ----
  const qInput = $("#q-input");
  const qOut = $("#q-out");
  const jwtInput = $("#jwt-input");
  const jwtOut = $("#jwt-out");
  const qError = $("#q-error");

  $("#q-parse")?.addEventListener("click", () => {
    try {
      const obj = P.parseQuery(qInput.value);
      qOut.textContent = JSON.stringify(obj, null, 2);
      setError(qError, "");
    } catch (err) {
      setError(qError, err.message || String(err));
    }
  });

  $("#jwt-parse")?.addEventListener("click", () => {
    try {
      const parsed = P.parseJwt(jwtInput.value);
      jwtOut.textContent = JSON.stringify(parsed, null, 2);
      setError(qError, "");
    } catch (err) {
      setError(qError, err.message || String(err));
    }
  });

  // ---- UUID ----
  function genUuid() {
    const count = Math.min(200, Math.max(1, Number($("#uuid-count").value) || 1));
    const upper = $("#uuid-upper").checked;
    const noHyphen = $("#uuid-nohyphen").checked;
    const list = [];
    for (let i = 0; i < count; i++) list.push(P.formatUuid(P.uuidv4(), { upper, noHyphen }));
    $("#uuid-out").value = list.join("\n");
  }
  $("#uuid-gen")?.addEventListener("click", genUuid);
  genUuid();

  // ---- Hash ----
  async function sha256(text) {
    const data = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  $("#hash-run")?.addEventListener("click", async () => {
    const text = $("#hash-input").value;
    try {
      $("#hash-md5").textContent = P.md5(text);
      $("#hash-sha256").textContent = await sha256(text);
      setError($("#hash-error"), "");
    } catch (err) {
      setError($("#hash-error"), err.message || String(err));
    }
  });

  // ---- Text ----
  const textInput = $("#text-input");
  const textStatsEl = $("#text-stats");

  function refreshTextStats() {
    const s = P.textStats(textInput.value);
    textStatsEl.textContent = `字符 ${s.chars} · 非空白 ${s.charsNoSpace} · 词 ${s.words} · 行 ${s.lines}（非空 ${s.nonEmptyLines}）`;
  }

  textInput?.addEventListener("input", refreshTextStats);
  $$("[data-text-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      textInput.value = P.transformText(textInput.value, btn.dataset.textAction);
      refreshTextStats();
    });
  });
  refreshTextStats();

  // ---- Case convert ----
  try {
    const caseInput = $("#case-input");
    const caseMeta = $("#case-meta");
    const caseMap = {
      camel: $("#case-camel"),
      pascal: $("#case-pascal"),
      snake: $("#case-snake"),
      screaming: $("#case-screaming"),
      kebab: $("#case-kebab"),
      dot: $("#case-dot"),
      path: $("#case-path"),
      title: $("#case-title"),
    };

    function refreshCaseConvert() {
      if (!caseInput) return;
      const result = P.convertCaseLines(caseInput.value);
      Object.keys(caseMap).forEach((key) => {
        const el = caseMap[key];
        if (!el) return;
        const value = result[key] || "";
        el.textContent = value || "—";
        el.title = value;
      });
      if (caseMeta) {
        caseMeta.textContent = result.count
          ? `已转换 ${result.count} 个名称`
          : "每行一个名称，自动识别并转换。";
      }
    }

    caseInput?.addEventListener("input", refreshCaseConvert);
    $("#case-clear")?.addEventListener("click", () => {
      if (caseInput) caseInput.value = "";
      refreshCaseConvert();
    });
    $("#case-use-camel")?.addEventListener("click", () => {
      if (!caseInput || !caseMap.camel) return;
      const v = caseMap.camel.textContent;
      if (!v || v === "—") return;
      caseInput.value = v;
      refreshCaseConvert();
      toast("已填入 camelCase");
    });
    $("#case-use-snake")?.addEventListener("click", () => {
      if (!caseInput || !caseMap.snake) return;
      const v = caseMap.snake.textContent;
      if (!v || v === "—") return;
      caseInput.value = v;
      refreshCaseConvert();
      toast("已填入 snake_case");
    });
    $("#case-use-kebab")?.addEventListener("click", () => {
      if (!caseInput || !caseMap.kebab) return;
      const v = caseMap.kebab.textContent;
      if (!v || v === "—") return;
      caseInput.value = v;
      refreshCaseConvert();
      toast("已填入 kebab-case");
    });
    refreshCaseConvert();
  } catch (err) {
    console.error("case convert init failed", err);
  }

  // ---- Coordinate convert ----
  try {
    const coordInput = $("#coord-input");
    const coordSystem = $("#coord-system");
    const coordMeta = $("#coord-meta");
    const coordError = $("#coord-error");
    const systems = ["wgs84", "gcj02", "bd09", "cgcs2000"];
    const coordOut = Object.fromEntries(
      systems.map((key) => [
        key,
        {
          decimal: $(`#coord-${key}`),
          dms: $(`#coord-${key}-dms`),
        },
      ])
    );

    function refreshCoordConvert() {
      if (!coordInput || !coordSystem) return;
      const text = coordInput.value;
      if (!String(text || "").trim()) {
        systems.forEach((key) => {
          if (coordOut[key].decimal) coordOut[key].decimal.textContent = "—";
          if (coordOut[key].dms) coordOut[key].dms.textContent = "—";
        });
        setError(coordError, "");
        if (coordMeta) {
          coordMeta.textContent = "每行一组坐标，顺序为经度在前、纬度在后。CGCS2000 按 WGS84 近似处理。";
        }
        return;
      }
      try {
        const result = P.convertCoordinateLines(coordSystem.value, text);
        systems.forEach((key) => {
          const decimal = result.decimal[key] || "";
          const dms = result.dms[key] || "";
          if (coordOut[key].decimal) {
            coordOut[key].decimal.textContent = decimal || "—";
            coordOut[key].decimal.title = decimal;
          }
          if (coordOut[key].dms) {
            coordOut[key].dms.textContent = dms || "—";
            coordOut[key].dms.title = dms;
          }
        });
        setError(coordError, result.fail ? `${result.error}（失败 ${result.fail} 行）` : "");
        if (coordMeta) {
          coordMeta.textContent = result.fail
            ? `成功 ${result.ok} 行 · 失败 ${result.fail} 行`
            : `已转换 ${result.ok} 组坐标`;
        }
      } catch (err) {
        systems.forEach((key) => {
          if (coordOut[key].decimal) coordOut[key].decimal.textContent = "—";
          if (coordOut[key].dms) coordOut[key].dms.textContent = "—";
        });
        setError(coordError, err.message || String(err));
        if (coordMeta) coordMeta.textContent = "请检查输入格式：lng,lat";
      }
    }

    function useCoordResult(system) {
      const el = coordOut[system]?.decimal;
      if (!coordInput || !el) return;
      const v = el.textContent || "";
      const cleaned = v
        .split(/\r\n|\n|\r/)
        .map((line) => line.trim())
        .filter((line) => line && line !== "—")
        .join("\n");
      if (!cleaned) return;
      coordInput.value = cleaned;
      if (coordSystem) coordSystem.value = system;
      refreshCoordConvert();
      toast(`已填入 ${system.toUpperCase()}`);
    }

    coordInput?.addEventListener("input", refreshCoordConvert);
    coordSystem?.addEventListener("change", refreshCoordConvert);
    $("#coord-clear")?.addEventListener("click", () => {
      if (coordInput) coordInput.value = "";
      refreshCoordConvert();
    });
    $("#coord-use-wgs84")?.addEventListener("click", () => useCoordResult("wgs84"));
    $("#coord-use-gcj02")?.addEventListener("click", () => useCoordResult("gcj02"));
    $("#coord-use-bd09")?.addEventListener("click", () => useCoordResult("bd09"));
    refreshCoordConvert();
  } catch (err) {
    console.error("coord convert init failed", err);
  }

  // ---- Diff ----
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  $("#diff-run")?.addEventListener("click", () => {
    const rows = P.diffLines($("#diff-a").value, $("#diff-b").value);
    $("#diff-out").innerHTML = rows
      .map((row) => {
        const cls = row.type === "add" ? "diff-add" : row.type === "del" ? "diff-del" : "diff-same";
        const mark = row.type === "add" ? "+" : row.type === "del" ? "-" : " ";
        return `<div class="${cls}"><span class="diff-mark">${mark}</span>${escapeHtml(row.text)}</div>`;
      })
      .join("");
  });

  // ---- YAML ----
  $("#yaml-to-json")?.addEventListener("click", () => {
    try {
      if (typeof jsyaml === "undefined") throw new Error("js-yaml 未加载");
      const data = jsyaml.load($("#yaml-in").value);
      $("#json-from-yaml").value = JSON.stringify(data, null, 2);
      setError($("#yaml-error"), "");
    } catch (err) {
      setError($("#yaml-error"), err.message || String(err));
    }
  });
  $("#json-to-yaml")?.addEventListener("click", () => {
    try {
      if (typeof jsyaml === "undefined") throw new Error("js-yaml 未加载");
      const data = JSON.parse($("#json-from-yaml").value);
      $("#yaml-in").value = jsyaml.dump(data);
      setError($("#yaml-error"), "");
    } catch (err) {
      setError($("#yaml-error"), err.message || String(err));
    }
  });
  $("#yaml-to-json")?.click();

  // ---- Image Base64 ----
  $("#img-file")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError($("#img-error"), "请选择图片文件");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      $("#img-b64").value = dataUrl;
      $("#img-preview").src = dataUrl;
      $("#img-meta").textContent = `${file.name} · ${(file.size / 1024).toFixed(1)} KB · ${file.type}`;
      setError($("#img-error"), "");
    };
    reader.onerror = () => setError($("#img-error"), "读取图片失败");
    reader.readAsDataURL(file);
  });

  // ---- QR generate + decode ----
  function generateQr() {
    const box = $("#qr-box");
    const text = $("#qr-text").value.trim();
    box.innerHTML = "";
    if (!text) {
      setError($("#qr-error"), "请输入内容");
      return;
    }
    try {
      if (typeof QRCode === "undefined") throw new Error("QRCode 库未加载");
      // eslint-disable-next-line no-new
      new QRCode(box, {
        text,
        width: 180,
        height: 180,
        colorDark: "#0b1220",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.M,
      });
      setError($("#qr-error"), "");
    } catch (err) {
      setError($("#qr-error"), err.message || String(err));
    }
  }
  $("#qr-gen")?.addEventListener("click", generateQr);
  generateQr();

  const qrVideo = $("#qr-video");
  const qrCanvas = $("#qr-scan-canvas");
  const qrPreview = $("#qr-scan-preview");
  const qrDecoded = $("#qr-decoded");
  const qrDecodeMeta = $("#qr-decode-meta");
  const qrDecodeError = $("#qr-decode-error");
  const qrCamStart = $("#qr-cam-start");
  const qrCamStop = $("#qr-cam-stop");
  let qrStream = null;
  let qrScanTimer = 0;
  let qrScanning = false;

  function decodeImageData(imageData) {
    if (typeof jsQR !== "function") throw new Error("jsQR 库未加载");
    return jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: "attemptBoth",
    });
  }

  function showDecoded(text, meta) {
    qrDecoded.value = text;
    qrDecodeMeta.textContent = meta || "";
    setError(qrDecodeError, "");
    toast("已识别二维码");
  }

  function decodeFromImageElement(img, meta) {
    const canvas = qrCanvas;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const maxSide = 1200;
    let w = img.naturalWidth || img.videoWidth || img.width;
    let h = img.naturalHeight || img.videoHeight || img.height;
    if (!w || !h) throw new Error("无法读取图像尺寸");
    const scale = Math.min(1, maxSide / Math.max(w, h));
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(img, 0, 0, w, h);
    const code = decodeImageData(ctx.getImageData(0, 0, w, h));
    if (!code) throw new Error("未识别到二维码，请换更清晰的图片试试");
    showDecoded(code.data, meta || `已识别 · ${w}×${h}`);
    return code.data;
  }

  function stopCamera() {
    qrScanning = false;
    if (qrScanTimer) {
      cancelAnimationFrame(qrScanTimer);
      qrScanTimer = 0;
    }
    if (qrStream) {
      qrStream.getTracks().forEach((t) => t.stop());
      qrStream = null;
    }
    if (qrVideo) {
      qrVideo.pause();
      qrVideo.srcObject = null;
      qrVideo.hidden = true;
    }
    if (qrCamStop) qrCamStop.hidden = true;
    if (qrCamStart) qrCamStart.hidden = false;
  }

  function scanCameraFrame() {
    if (!qrScanning || !qrVideo) return;
    if (qrVideo.readyState >= 2) {
      try {
        const canvas = qrCanvas;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const w = qrVideo.videoWidth;
        const h = qrVideo.videoHeight;
        if (w && h) {
          canvas.width = w;
          canvas.height = h;
          ctx.drawImage(qrVideo, 0, 0, w, h);
          const code = decodeImageData(ctx.getImageData(0, 0, w, h));
          if (code) {
            showDecoded(code.data, `摄像头识别 · ${w}×${h}`);
            stopCamera();
            return;
          }
        }
      } catch (_) {
        // keep scanning
      }
    }
    qrScanTimer = requestAnimationFrame(scanCameraFrame);
  }

  $("#qr-file")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    stopCamera();
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        qrPreview.hidden = false;
        qrPreview.src = url;
        decodeFromImageElement(img, `图片识别 · ${file.name}`);
      } catch (err) {
        setError(qrDecodeError, err.message || String(err));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setError(qrDecodeError, "图片加载失败");
    };
    img.src = url;
    e.target.value = "";
  });

  qrCamStart?.addEventListener("click", async () => {
    setError(qrDecodeError, "");
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(qrDecodeError, "当前浏览器不支持摄像头");
      return;
    }
    try {
      stopCamera();
      qrStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" } },
      });
      qrPreview.hidden = true;
      qrVideo.hidden = false;
      qrVideo.srcObject = qrStream;
      await qrVideo.play();
      qrScanning = true;
      qrCamStart.hidden = true;
      qrCamStop.hidden = false;
      qrDecodeMeta.textContent = "摄像头扫描中…对准二维码即可";
      scanCameraFrame();
    } catch (err) {
      stopCamera();
      setError(qrDecodeError, `无法打开摄像头：${err.message || err}`);
    }
  });

  qrCamStop?.addEventListener("click", () => {
    stopCamera();
    qrDecodeMeta.textContent = "已关闭摄像头";
  });

  window.addEventListener("pagehide", stopCamera);

  // ---- Cron ----
  function runCron() {
    try {
      const expr = $("#cron-input").value;
      $("#cron-desc").textContent = P.describeCron(expr);
      const next = P.nextCronTimes(expr, Date.now(), 8);
      $("#cron-next").textContent = next.map((ms, i) => `${i + 1}. ${P.formatDateTime(ms)}`).join("\n");
      setError($("#cron-error"), "");
    } catch (err) {
      $("#cron-desc").textContent = "";
      $("#cron-next").textContent = "";
      setError($("#cron-error"), err.message || String(err));
    }
  }
  $("#cron-run")?.addEventListener("click", runCron);
  $("#cron-input")?.addEventListener("change", runCron);
  runCron();

  // ---- Units ----
  const unitCat = $("#unit-cat");
  const unitFrom = $("#unit-from");
  const unitTo = $("#unit-to");
  const unitFromVal = $("#unit-from-val");
  const unitToVal = $("#unit-to-val");
  const unitHint = $("#unit-hint");

  function fillUnitSelects() {
    const cat = unitCat.value;
    const table = P.UNIT_TABLES[cat];
    const units = cat === "temp" ? table.units : Object.keys(table.units);
    unitFrom.innerHTML = units.map((u) => `<option value="${u}">${u}</option>`).join("");
    unitTo.innerHTML = units.map((u) => `<option value="${u}">${u}</option>`).join("");
    if (cat === "length") {
      unitFrom.value = "m";
      unitTo.value = "cm";
    } else if (cat === "weight") {
      unitFrom.value = "kg";
      unitTo.value = "g";
    } else {
      unitFrom.value = "C";
      unitTo.value = "F";
    }
    convertUnits();
  }

  function convertUnits() {
    try {
      const out = P.convertUnit(unitCat.value, unitFromVal.value, unitFrom.value, unitTo.value);
      unitToVal.value = Number(out.toPrecision(12));
      unitHint.textContent = `${unitFromVal.value} ${unitFrom.value} = ${unitToVal.value} ${unitTo.value}`;
    } catch (err) {
      unitHint.textContent = err.message || String(err);
    }
  }

  unitCat?.addEventListener("change", fillUnitSelects);
  [unitFrom, unitTo, unitFromVal].forEach((el) => el?.addEventListener("input", convertUnits));
  fillUnitSelects();

  // ---- Share card ----
  const scInput = $("#sc-input");
  const scLang = $("#sc-lang");
  const scTheme = $("#sc-theme");
  const scTitle = $("#sc-title");
  const scWatermark = $("#sc-watermark");
  const scLines = $("#sc-lines");
  const scPretty = $("#sc-pretty");
  const scDots = $("#sc-dots");
  const scDotsEl = $("#sc-dots-el");
  const scCard = $("#sc-card");
  const scCode = $("#sc-code");
  const scCardTitle = $("#sc-card-title");
  const scCardWatermark = $("#sc-card-watermark");
  const scMeta = $("#sc-meta");
  const scError = $("#sc-error");
  const scCapture = $("#sc-capture");

  const LANG_LABEL = {
    json: "JSON",
    kotlin: "Kotlin / Compose",
    java: "Java",
    javascript: "JavaScript",
    python: "Python",
    xml: "XML / HTML",
    text: "纯文本",
  };

  function refreshShareCard() {
    if (!scCard || !scCode) return;
    try {
      const rendered = P.renderShareCode(scInput.value, {
        lang: scLang.value,
        prettyJson: !!scPretty?.checked,
        lineNumbers: !!scLines?.checked,
      });
      scCode.innerHTML = rendered.html;
      scCard.className = `share-card theme-${scTheme.value}`;
      scCardTitle.textContent = scTitle.value.trim() || "untitled";
      const mark = scWatermark.value.trim();
      scCardWatermark.textContent = mark;
      scCardWatermark.hidden = !mark;
      if (scDotsEl) scDotsEl.hidden = !scDots?.checked;
      scMeta.textContent = `预览 · ${LANG_LABEL[rendered.lang] || rendered.lang} · ${rendered.lineCount} 行`;
      setError(scError, "");
    } catch (err) {
      setError(scError, err.message || String(err));
    }
  }

  [
    scInput,
    scLang,
    scTheme,
    scTitle,
    scWatermark,
    scLines,
    scPretty,
    scDots,
  ].forEach((el) => {
    el?.addEventListener("input", refreshShareCard);
    el?.addEventListener("change", refreshShareCard);
  });
  $("#sc-refresh")?.addEventListener("click", refreshShareCard);

  $("#sc-export")?.addEventListener("click", async () => {
    refreshShareCard();
    if (typeof html2canvas !== "function") {
      setError(scError, "html2canvas 未加载");
      return;
    }
    try {
      const canvas = await html2canvas(scCapture, {
        backgroundColor: null,
        scale: 2,
        useCORS: true,
        logging: false,
      });
      const link = document.createElement("a");
      const name = (scTitle.value.trim() || "code-card").replace(/[^\w.-]+/g, "_");
      link.download = `${name}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      scMeta.textContent = `已导出 ${canvas.width}×${canvas.height} PNG`;
      toast("已导出图片");
      setError(scError, "");
    } catch (err) {
      setError(scError, `导出失败：${err.message || err}`);
    }
  });

  refreshShareCard();


  // ---- Number base ----
  const nbInput = $("#nb-input");
  const nbFrom = $("#nb-from");
  const nbBin = $("#nb-bin");
  const nbOct = $("#nb-oct");
  const nbDec = $("#nb-dec");
  const nbHex = $("#nb-hex");
  const nbError = $("#nb-error");

  function convertBase() {
    try {
      const raw = (nbInput.value || "").trim();
      if (!raw) throw new Error("请输入数值");
      const base = Number(nbFrom.value);
      const n = parseInt(raw, base);
      if (!Number.isFinite(n)) throw new Error("数值无效");
      nbBin.textContent = n.toString(2);
      nbOct.textContent = n.toString(8);
      nbDec.textContent = n.toString(10);
      nbHex.textContent = n.toString(16).toUpperCase();
      setError(nbError, "");
    } catch (err) {
      nbBin.textContent = nbOct.textContent = nbDec.textContent = nbHex.textContent = "—";
      setError(nbError, err.message || String(err));
    }
  }
  [nbInput, nbFrom].forEach((el) => el?.addEventListener("input", convertBase));
  nbFrom?.addEventListener("change", convertBase);
  convertBase();

  // ---- Markdown preview ----
  const mdInput = $("#md-input");
  const mdPreview = $("#md-preview");

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
  mdInput?.addEventListener("input", refreshMarkdown);
  refreshMarkdown();

  // ---- EyeDropper / image color picker ----
  try {
    const eyePick = $("#eye-pick");
    const eyeFile = $("#eye-file");
    const eyeSwatch = $("#eye-swatch");
    const eyeHex = $("#eye-hex");
    const eyeRgb = $("#eye-rgb");
    const eyeAhex = $("#eye-ahex");
    const eyeImg = $("#eye-img");
    const eyeMeta = $("#eye-meta");
    const eyeHint = $("#eye-hint");
    const eyeError = $("#eye-error");
    const hasEyeDropper = "EyeDropper" in window;

    function applyPickedColor(hex) {
      if (!eyeHex || !eyeRgb || !eyeAhex || !eyeSwatch) return;
      const c = P.colorFrom("hex", hex);
      eyeSwatch.style.backgroundColor = c.rgb;
      eyeHex.textContent = c.hex;
      eyeRgb.textContent = c.rgb;
      eyeAhex.textContent = P.rgbStringToAhex(c.rgb);
      setError(eyeError, "");
    }

    if (!hasEyeDropper) {
      if (eyeHint) {
        eyeHint.textContent = "当前浏览器不支持屏幕取色，请改用「上传图片取色」。Chrome / Edge 桌面版通常支持。";
      }
      if (eyePick) {
        eyePick.disabled = true;
        eyePick.title = "当前浏览器不支持 EyeDropper API";
        eyePick.textContent = "屏幕取色（不可用）";
      }
    }

    eyePick?.addEventListener("click", async () => {
      if (!hasEyeDropper) {
        setError(eyeError, "当前浏览器不支持屏幕取色，请改用图片取色");
        toast("请改用图片取色");
        return;
      }
      if (!window.isSecureContext) {
        setError(eyeError, "屏幕取色需要 HTTPS 安全上下文");
        toast("需要 HTTPS 才能取色");
        return;
      }
      try {
        setError(eyeError, "");
        toast("请在屏幕上点选颜色…");
        const eyeDropper = new window.EyeDropper();
        const result = await eyeDropper.open();
        applyPickedColor(result.sRGBHex);
        if (eyeMeta) eyeMeta.textContent = `屏幕取色：${result.sRGBHex}`;
        toast(`已取色 ${result.sRGBHex}`);
      } catch (err) {
        if (String(err && err.name) === "AbortError") {
          toast("已取消取色");
          return;
        }
        setError(eyeError, `取色失败：${err.message || err}`);
        toast("取色失败");
      }
    });

    eyeFile?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      if (eyeImg) {
        eyeImg.hidden = false;
        eyeImg.src = url;
      }
      if (eyeMeta) eyeMeta.textContent = `点击图片任意位置取色 · ${file.name}`;
      setError(eyeError, "");
      toast("图片已加载，点击图片取色");
      e.target.value = "";
    });

    eyeImg?.addEventListener("click", (e) => {
      try {
        if (!eyeImg.naturalWidth) {
          setError(eyeError, "图片尚未加载完成");
          return;
        }
        const rect = eyeImg.getBoundingClientRect();
        const scaleX = eyeImg.naturalWidth / rect.width;
        const scaleY = eyeImg.naturalHeight / rect.height;
        const x = Math.max(0, Math.min(eyeImg.naturalWidth - 1, Math.floor((e.clientX - rect.left) * scaleX)));
        const y = Math.max(0, Math.min(eyeImg.naturalHeight - 1, Math.floor((e.clientY - rect.top) * scaleY)));
        const canvas = document.createElement("canvas");
        canvas.width = eyeImg.naturalWidth;
        canvas.height = eyeImg.naturalHeight;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(eyeImg, 0, 0);
        const data = ctx.getImageData(x, y, 1, 1).data;
        const hex = `#${[data[0], data[1], data[2]].map((n) => n.toString(16).toUpperCase().padStart(2, "0")).join("")}`;
        applyPickedColor(hex);
        if (eyeMeta) eyeMeta.textContent = `图片取色：(${x}, ${y}) ${hex}`;
        toast(`已取色 ${hex}`);
      } catch (err) {
        setError(eyeError, `图片取色失败：${err.message || err}`);
        toast("图片取色失败");
      }
    });
    applyPickedColor("#2EC4B6");
  } catch (err) {
    console.error("eyedropper init failed", err);
  }

  // ---- Password generator ----
  try {
    const pwLength = $("#pw-length");
    const pwCount = $("#pw-count");
    const pwUpper = $("#pw-upper");
    const pwLower = $("#pw-lower");
    const pwNumber = $("#pw-number");
    const pwSymbol = $("#pw-symbol");
    const pwNoAmbiguous = $("#pw-no-ambiguous");
    const pwOutput = $("#pw-output");
    const pwMeta = $("#pw-meta");
    const pwError = $("#pw-error");
    const pwGenerate = $("#pw-generate");

    function genPasswords(fromClick) {
      try {
        if (!pwOutput) throw new Error("密码输出框未找到");
        const list = P.generatePasswords({
          length: Math.min(128, Math.max(4, Number(pwLength?.value) || 16)),
          count: Math.min(20, Math.max(1, Number(pwCount?.value) || 1)),
          upper: !!pwUpper?.checked,
          lower: !!pwLower?.checked,
          number: !!pwNumber?.checked,
          symbol: !!pwSymbol?.checked,
          noAmbiguous: !!pwNoAmbiguous?.checked,
        });
        pwOutput.value = list.join("\n");
        // Also mirror into a data attribute so dump/debug can see it
        pwOutput.dataset.count = String(list.length);
        if (pwMeta) pwMeta.textContent = `已生成 ${list.length} 个密码 · 长度 ${list[0]?.length || 0}`;
        setError(pwError, "");
        if (fromClick) toast(`已生成 ${list.length} 个密码`);
      } catch (err) {
        if (pwOutput) pwOutput.value = "";
        if (pwMeta) pwMeta.textContent = "";
        setError(pwError, err.message || String(err));
        if (fromClick) toast(err.message || "生成失败");
      }
    }

    pwGenerate?.addEventListener("click", (e) => {
      e.preventDefault();
      genPasswords(true);
    });
    [pwLength, pwCount, pwUpper, pwLower, pwNumber, pwSymbol, pwNoAmbiguous].forEach((el) => {
      el?.addEventListener("input", () => genPasswords(false));
      el?.addEventListener("change", () => genPasswords(false));
    });
    genPasswords(false);
  } catch (err) {
    console.error("password init failed", err);
  }

  // ---- GIF maker ----
  try {
    const gifFile = $("#gif-file");
    const gifFramesEl = $("#gif-frames");
    const gifDelay = $("#gif-delay");
    const gifWidth = $("#gif-width");
    const gifQuality = $("#gif-quality");
    const gifMeta = $("#gif-meta");
    const gifError = $("#gif-error");
    const gifProgress = $("#gif-progress");
    const gifProgressFill = $("#gif-progress-fill");
    const gifProgressText = $("#gif-progress-text");
    const gifPreview = $("#gif-preview");
    const gifDownload = $("#gif-download");
    const gifGenerate = $("#gif-generate");
    const gifAbort = $("#gif-abort");
    const MAX_GIF_FRAMES = 40;
    const frames = [];
    let frameSeq = 0;
    let activeGif = null;
    let previewUrl = "";

    function defaultDelay() {
      return Math.min(10000, Math.max(20, Number(gifDelay?.value) || 500));
    }

    function revokePreview() {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        previewUrl = "";
      }
      if (gifPreview) {
        gifPreview.hidden = true;
        gifPreview.removeAttribute("src");
      }
      if (gifDownload) {
        gifDownload.hidden = true;
        gifDownload.removeAttribute("href");
      }
    }

    function setProgress(visible, ratio, text) {
      if (!gifProgress) return;
      gifProgress.hidden = !visible;
      const pct = Math.max(0, Math.min(100, Math.round((ratio || 0) * 100)));
      if (gifProgressFill) gifProgressFill.style.width = `${pct}%`;
      if (gifProgressText) gifProgressText.textContent = text || `${pct}%`;
    }

    function updateGifMeta() {
      if (!gifMeta) return;
      if (!frames.length) {
        gifMeta.textContent = "选择至少 2 张图片。单帧建议不超过 1280px，张数过多会较慢。";
        return;
      }
      const totalMs = frames.reduce((sum, f) => sum + (Number(f.delay) || 0), 0);
      gifMeta.textContent = `已添加 ${frames.length} 帧 · 循环约 ${(totalMs / 1000).toFixed(2)}s`;
    }

    function renderFrameList() {
      if (!gifFramesEl) return;
      gifFramesEl.innerHTML = "";
      frames.forEach((frame, index) => {
        const row = document.createElement("div");
        row.className = "gif-frame";
        row.dataset.id = frame.id;

        const img = document.createElement("img");
        img.className = "gif-frame-thumb";
        img.src = frame.url;
        img.alt = frame.name;

        const meta = document.createElement("div");
        meta.className = "gif-frame-meta";
        const name = document.createElement("div");
        name.className = "gif-frame-name";
        name.textContent = `${index + 1}. ${frame.name}`;
        const controls = document.createElement("div");
        controls.className = "gif-frame-controls";
        const delayLabel = document.createElement("label");
        delayLabel.textContent = "时长 ms";
        const delayInput = document.createElement("input");
        delayInput.className = "mono meta-input";
        delayInput.type = "number";
        delayInput.min = "20";
        delayInput.max = "10000";
        delayInput.step = "10";
        delayInput.value = String(frame.delay);
        delayInput.addEventListener("input", () => {
          frame.delay = Math.min(10000, Math.max(20, Number(delayInput.value) || 20));
          updateGifMeta();
        });
        controls.append(delayLabel, delayInput);
        meta.append(name, controls);

        const actions = document.createElement("div");
        actions.className = "gif-frame-actions";
        const mkBtn = (label, cls, handler) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = cls;
          btn.textContent = label;
          btn.addEventListener("click", handler);
          return btn;
        };
        actions.append(
          mkBtn("上移", "ghost-btn", () => {
            if (index <= 0) return;
            const [item] = frames.splice(index, 1);
            frames.splice(index - 1, 0, item);
            renderFrameList();
            updateGifMeta();
          }),
          mkBtn("下移", "ghost-btn", () => {
            if (index >= frames.length - 1) return;
            const [item] = frames.splice(index, 1);
            frames.splice(index + 1, 0, item);
            renderFrameList();
            updateGifMeta();
          }),
          mkBtn("删除", "ghost-btn", () => {
            URL.revokeObjectURL(frame.url);
            frames.splice(index, 1);
            renderFrameList();
            updateGifMeta();
            revokePreview();
          })
        );

        row.append(img, meta, actions);
        gifFramesEl.appendChild(row);
      });
    }

    function loadImageFile(file) {
      return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => resolve({ img, url, name: file.name || "image", width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error(`无法读取图片：${file.name || "unknown"}`));
        };
        img.src = url;
      });
    }

    function fitSize(srcW, srcH, maxW) {
      const widthCap = Math.min(1280, Math.max(64, Number(maxW) || 480));
      if (srcW <= widthCap) return { width: srcW, height: srcH };
      const scale = widthCap / srcW;
      return {
        width: Math.max(1, Math.round(srcW * scale)),
        height: Math.max(1, Math.round(srcH * scale)),
      };
    }

    async function addFiles(fileList) {
      const files = [...(fileList || [])].filter((f) => f.type.startsWith("image/"));
      if (!files.length) {
        setError(gifError, "请选择图片文件");
        return;
      }
      setError(gifError, "");
      for (const file of files) {
        if (frames.length >= MAX_GIF_FRAMES) {
          setError(gifError, `最多 ${MAX_GIF_FRAMES} 帧`);
          break;
        }
        try {
          const loaded = await loadImageFile(file);
          frames.push({
            id: `f${Date.now()}_${frameSeq++}`,
            url: loaded.url,
            name: loaded.name,
            delay: defaultDelay(),
            width: loaded.width,
            height: loaded.height,
            img: loaded.img,
          });
        } catch (err) {
          setError(gifError, err.message || String(err));
        }
      }
      renderFrameList();
      updateGifMeta();
      revokePreview();
      if (gifFile) gifFile.value = "";
    }

    function setBusy(busy) {
      if (gifGenerate) gifGenerate.disabled = !!busy;
      if (gifAbort) gifAbort.hidden = !busy;
      if (gifFile) gifFile.disabled = !!busy;
    }

    function abortGif() {
      if (activeGif) {
        try {
          activeGif.abort();
        } catch (_) {}
        activeGif = null;
      }
      setBusy(false);
      setProgress(false, 0, "");
      toast("已取消生成");
    }

    async function generateGif() {
      if (typeof GIF !== "function") {
        setError(gifError, "gif.js 未加载");
        return;
      }
      if (frames.length < 2) {
        setError(gifError, "至少需要 2 张图片");
        return;
      }
      setError(gifError, "");
      revokePreview();
      setBusy(true);
      setProgress(true, 0.02, "准备帧… 0%");
      let cleanupWorker = null;

      try {
        const maxW = Number(gifWidth?.value) || 480;
        const quality = Math.min(30, Math.max(1, Number(gifQuality?.value) || 10));
        let outW = 0;
        let outH = 0;
        frames.forEach((frame) => {
          const size = fitSize(frame.width, frame.height, maxW);
          outW = Math.max(outW, size.width);
          outH = Math.max(outH, size.height);
        });

        const canvas = document.createElement("canvas");
        canvas.width = outW;
        canvas.height = outH;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });

        setProgress(true, 0.02, "准备编码器…");
        const workerSource = await fetch(new URL("./vendor/gif.worker.js", document.baseURI || window.location.href)).then((r) => {
          if (!r.ok) throw new Error("无法加载 gif.worker.js");
          return r.text();
        });
        const workerScript = URL.createObjectURL(new Blob([workerSource], { type: "application/javascript" }));
        cleanupWorker = () => {
          try {
            URL.revokeObjectURL(workerScript);
          } catch (_) {}
        };
        const gif = new GIF({
          workers: 2,
          quality,
          width: outW,
          height: outH,
          workerScript,
          repeat: 0,
          background: "#000000",
        });
        activeGif = gif;

        frames.forEach((frame, idx) => {
          const size = fitSize(frame.width, frame.height, maxW);
          const x = Math.round((outW - size.width) / 2);
          const y = Math.round((outH - size.height) / 2);
          ctx.fillStyle = "#000000";
          ctx.fillRect(0, 0, outW, outH);
          ctx.drawImage(frame.img, x, y, size.width, size.height);
          gif.addFrame(ctx, {
            delay: Math.min(10000, Math.max(20, Number(frame.delay) || defaultDelay())),
            copy: true,
          });
          setProgress(true, ((idx + 1) / frames.length) * 0.15, `准备帧… ${idx + 1}/${frames.length}`);
        });

        const blob = await new Promise((resolve, reject) => {
          gif.on("progress", (p) => {
            const ratio = 0.15 + p * 0.85;
            setProgress(true, ratio, `编码中… ${Math.round(p * 100)}%`);
          });
          gif.on("finished", (b) => resolve(b));
          gif.on("abort", () => reject(new Error("已取消")));
          try {
            gif.render();
          } catch (err) {
            reject(err);
          }
        });

        previewUrl = URL.createObjectURL(blob);
        if (gifPreview) {
          gifPreview.src = previewUrl;
          gifPreview.hidden = false;
        }
        if (gifDownload) {
          gifDownload.href = previewUrl;
          gifDownload.hidden = false;
        }
        setProgress(true, 1, `完成 · ${(blob.size / 1024).toFixed(1)} KB`);
        toast("GIF 已生成");
        if (gifMeta) {
          gifMeta.textContent = `已生成 ${outW}×${outH} · ${frames.length} 帧 · ${(blob.size / 1024).toFixed(1)} KB`;
        }
      } catch (err) {
        if (String(err && err.message) !== "已取消") {
          setError(gifError, err.message || String(err));
          setProgress(false, 0, "");
        }
      } finally {
        if (typeof cleanupWorker === "function") cleanupWorker();
        activeGif = null;
        setBusy(false);
      }
    }

    gifFile?.addEventListener("change", (e) => addFiles(e.target.files));
    $("#gif-clear")?.addEventListener("click", () => {
      frames.splice(0).forEach((f) => URL.revokeObjectURL(f.url));
      renderFrameList();
      updateGifMeta();
      revokePreview();
      setError(gifError, "");
      setProgress(false, 0, "");
    });
    $("#gif-apply-delay")?.addEventListener("click", () => {
      const delay = defaultDelay();
      frames.forEach((f) => {
        f.delay = delay;
      });
      renderFrameList();
      updateGifMeta();
      toast(`已统一为 ${delay} ms`);
    });
    gifGenerate?.addEventListener("click", generateGif);
    gifAbort?.addEventListener("click", abortGif);
    updateGifMeta();
  } catch (err) {
    console.error("gif maker init failed", err);
  }

  // ---- GIF extract / to video ----
  try {
    const gifxFile = $("#gifx-file");
    const gifxFramesEl = $("#gifx-frames");
    const gifxMeta = $("#gifx-meta");
    const gifxError = $("#gifx-error");
    const gifxFormat = $("#gifx-format");
    const gifxFps = $("#gifx-fps");
    const gifxProgress = $("#gifx-progress");
    const gifxProgressFill = $("#gifx-progress-fill");
    const gifxProgressText = $("#gifx-progress-text");
    const gifxZipBtn = $("#gifx-zip");
    const gifxVideoBtn = $("#gifx-video");
    const gifxAbort = $("#gifx-abort");
    const gifxDownloadVideo = $("#gifx-download-video");
    const gifxVideoPreview = $("#gifx-video-preview");
    const extracted = [];
    let videoUrl = "";
    let abortVideo = false;

    function setGifxProgress(visible, ratio, text) {
      if (!gifxProgress) return;
      gifxProgress.hidden = !visible;
      const pct = Math.max(0, Math.min(100, Math.round((ratio || 0) * 100)));
      if (gifxProgressFill) gifxProgressFill.style.width = `${pct}%`;
      if (gifxProgressText) gifxProgressText.textContent = text || `${pct}%`;
    }

    function clearExtracted() {
      extracted.splice(0).forEach((f) => {
        if (f.url) URL.revokeObjectURL(f.url);
      });
      if (gifxFramesEl) gifxFramesEl.innerHTML = "";
      if (gifxZipBtn) gifxZipBtn.disabled = true;
      if (gifxVideoBtn) gifxVideoBtn.disabled = true;
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
        videoUrl = "";
      }
      if (gifxVideoPreview) {
        gifxVideoPreview.hidden = true;
        gifxVideoPreview.removeAttribute("src");
      }
      if (gifxDownloadVideo) {
        gifxDownloadVideo.hidden = true;
        gifxDownloadVideo.removeAttribute("href");
      }
      if (gifxMeta) gifxMeta.textContent = "上传 GIF 后可拆成逐帧图片，或导出 WebM 视频。";
      setGifxProgress(false, 0, "");
      setError(gifxError, "");
    }

    function canvasToBlob(canvas, type, quality) {
      return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (!blob) reject(new Error("导出图片失败"));
          else resolve(blob);
        }, type, quality);
      });
    }

    async function decodeGifWithImageDecoder(buffer) {
      if (typeof ImageDecoder !== "function") return null;
      try {
        const decoder = new ImageDecoder({ data: buffer, type: "image/gif" });
        await decoder.tracks.ready;
        const track = decoder.tracks.selectedTrack;
        if (!track || !track.frameCount) return null;
        const frames = [];
        for (let i = 0; i < track.frameCount; i++) {
          const result = await decoder.decode({ frameIndex: i });
          const frame = result.image;
          const canvas = document.createElement("canvas");
          canvas.width = frame.displayWidth || frame.codedWidth;
          canvas.height = frame.displayHeight || frame.codedHeight;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(frame, 0, 0);
          const delayUs = frame.duration || result.duration || 100000;
          const delay = Math.max(20, Math.round(delayUs / 1000));
          frame.close();
          frames.push({ canvas, delay, index: i });
          setGifxProgress(true, ((i + 1) / track.frameCount) * 0.7, `解码中… ${i + 1}/${track.frameCount}`);
        }
        decoder.close?.();
        return frames;
      } catch (_) {
        return null;
      }
    }

    function decodeGifWithOmggif(buffer) {
      if (typeof GifReader !== "function") throw new Error("GIF 解码库未加载");
      const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
      const reader = new GifReader(bytes);
      const width = reader.width;
      const height = reader.height;
      const count = reader.numFrames();
      const frames = [];
      const full = document.createElement("canvas");
      full.width = width;
      full.height = height;
      const fullCtx = full.getContext("2d", { willReadFrequently: true });
      fullCtx.clearRect(0, 0, width, height);
      let saved = null;

      for (let i = 0; i < count; i++) {
        const info = reader.frameInfo(i);
        if (i > 0) {
          const prev = reader.frameInfo(i - 1);
          if (prev.disposal === 2) {
            fullCtx.clearRect(prev.x, prev.y, prev.width, prev.height);
          } else if (prev.disposal === 3 && saved) {
            fullCtx.putImageData(saved, 0, 0);
          }
        }
        if (info.disposal === 3) {
          saved = fullCtx.getImageData(0, 0, width, height);
        } else {
          saved = null;
        }

        const imageData = fullCtx.getImageData(0, 0, width, height);
        reader.decodeAndBlitFrameRGBA(i, imageData.data);
        fullCtx.putImageData(imageData, 0, 0);

        const snap = document.createElement("canvas");
        snap.width = width;
        snap.height = height;
        snap.getContext("2d").drawImage(full, 0, 0);
        const delay = Math.max(20, (info.delay || 10) * 10);
        frames.push({ canvas: snap, delay, index: i });
        setGifxProgress(true, ((i + 1) / count) * 0.7, `解码中… ${i + 1}/${count}`);
      }
      return frames;
    }

    async function renderExtractedList() {
      if (!gifxFramesEl) return;
      gifxFramesEl.innerHTML = "";
      for (const frame of extracted) {
        const row = document.createElement("div");
        row.className = "gif-frame";
        const img = document.createElement("img");
        img.className = "gif-frame-thumb";
        img.src = frame.url;
        img.alt = `frame-${frame.index + 1}`;
        const meta = document.createElement("div");
        meta.className = "gif-frame-meta";
        const name = document.createElement("div");
        name.className = "gif-frame-name";
        name.textContent = `第 ${frame.index + 1} 帧 · ${frame.delay} ms · ${frame.width}×${frame.height}`;
        const controls = document.createElement("div");
        controls.className = "gif-frame-controls";
        const link = document.createElement("a");
        link.className = "secondary-btn";
        link.textContent = "下载此帧";
        link.href = frame.url;
        link.download = `frame-${String(frame.index + 1).padStart(3, "0")}.png`;
        controls.appendChild(link);
        meta.append(name, controls);
        row.append(img, meta);
        gifxFramesEl.appendChild(row);
      }
    }

    async function loadGifFile(file) {
      if (!file) return;
      clearExtracted();
      setGifxProgress(true, 0.02, "读取文件…");
      try {
        const buffer = await file.arrayBuffer();
        let frames = await decodeGifWithImageDecoder(buffer);
        if (!frames || !frames.length) {
          frames = decodeGifWithOmggif(buffer);
        }
        if (!frames.length) throw new Error("未解析到帧");
        setGifxProgress(true, 0.75, "导出帧图片…");
        for (let i = 0; i < frames.length; i++) {
          const frame = frames[i];
          const blob = await canvasToBlob(frame.canvas, "image/png");
          const url = URL.createObjectURL(blob);
          extracted.push({
            index: frame.index,
            delay: frame.delay,
            width: frame.canvas.width,
            height: frame.canvas.height,
            canvas: frame.canvas,
            pngBlob: blob,
            url,
          });
          setGifxProgress(true, 0.75 + ((i + 1) / frames.length) * 0.25, `导出帧… ${i + 1}/${frames.length}`);
        }
        await renderExtractedList();
        const totalMs = extracted.reduce((s, f) => s + f.delay, 0);
        if (gifxMeta) {
          gifxMeta.textContent = `${file.name} · ${extracted.length} 帧 · 约 ${(totalMs / 1000).toFixed(2)}s · ${extracted[0].width}×${extracted[0].height}`;
        }
        if (gifxZipBtn) gifxZipBtn.disabled = false;
        if (gifxVideoBtn) gifxVideoBtn.disabled = false;
        setGifxProgress(true, 1, `已拆出 ${extracted.length} 帧`);
        toast(`已拆出 ${extracted.length} 帧`);
      } catch (err) {
        clearExtracted();
        setError(gifxError, err.message || String(err));
      } finally {
        if (gifxFile) gifxFile.value = "";
      }
    }

    function pickMime() {
      const format = gifxFormat?.value || "png";
      if (format === "jpeg") return { type: "image/jpeg", ext: "jpg", quality: 0.92 };
      if (format === "webp") return { type: "image/webp", ext: "webp", quality: 0.92 };
      return { type: "image/png", ext: "png", quality: undefined };
    }

    async function downloadZip() {
      if (!extracted.length) return;
      if (typeof JSZip !== "function") {
        setError(gifxError, "JSZip 未加载");
        return;
      }
      try {
        setError(gifxError, "");
        setGifxProgress(true, 0.05, "打包中…");
        const zip = new JSZip();
        const fmt = pickMime();
        for (let i = 0; i < extracted.length; i++) {
          const frame = extracted[i];
          let blob = frame.pngBlob;
          if (fmt.type !== "image/png") {
            blob = await canvasToBlob(frame.canvas, fmt.type, fmt.quality);
          }
          const name = `frame-${String(i + 1).padStart(3, "0")}.${fmt.ext}`;
          zip.file(name, blob);
          setGifxProgress(true, ((i + 1) / extracted.length) * 0.85, `打包… ${i + 1}/${extracted.length}`);
        }
        const meta = extracted.map((f, i) => `${i + 1}\t${f.delay}ms\t${f.width}x${f.height}`).join("\n");
        zip.file("frames.txt", `index\tdelay\tsize\n${meta}\n`);
        const out = await zip.generateAsync({ type: "blob" }, (meta) => {
          setGifxProgress(true, 0.85 + (meta.percent / 100) * 0.15, `压缩… ${Math.round(meta.percent)}%`);
        });
        const url = URL.createObjectURL(out);
        const a = document.createElement("a");
        a.href = url;
        a.download = "gif-frames.zip";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        setGifxProgress(true, 1, `已打包 ${extracted.length} 帧`);
        toast("已下载 ZIP");
      } catch (err) {
        setError(gifxError, err.message || String(err));
        setGifxProgress(false, 0, "");
      }
    }

    function pickRecorderMime() {
      const candidates = [
        "video/webm;codecs=vp9",
        "video/webm;codecs=vp8",
        "video/webm",
      ];
      for (const type of candidates) {
        if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(type)) return type;
      }
      return "video/webm";
    }

    function wait(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async function exportVideo() {
      if (!extracted.length) return;
      if (typeof MediaRecorder !== "function") {
        setError(gifxError, "当前浏览器不支持 MediaRecorder");
        return;
      }
      abortVideo = false;
      if (gifxAbort) gifxAbort.hidden = false;
      if (gifxVideoBtn) gifxVideoBtn.disabled = true;
      if (gifxZipBtn) gifxZipBtn.disabled = true;
      setError(gifxError, "");
      setGifxProgress(true, 0.02, "准备录制…");

      try {
        const width = extracted[0].width;
        const height = extracted[0].height;
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        const fps = Math.min(60, Math.max(5, Number(gifxFps?.value) || 20));
        const stream = canvas.captureStream(fps);
        const mimeType = pickRecorderMime();
        const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 });
        const chunks = [];
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size) chunks.push(e.data);
        };

        const stopped = new Promise((resolve, reject) => {
          recorder.onstop = () => resolve();
          recorder.onerror = (e) => reject(e.error || new Error("录制失败"));
        });
        recorder.start(100);

        // paint first frame immediately
        for (let i = 0; i < extracted.length; i++) {
          if (abortVideo) throw new Error("已取消");
          const frame = extracted[i];
          ctx.clearRect(0, 0, width, height);
          ctx.drawImage(frame.canvas, 0, 0);
          const track = stream.getVideoTracks()[0];
          if (track && typeof track.requestFrame === "function") {
            track.requestFrame();
          }
          setGifxProgress(true, ((i + 1) / extracted.length) * 0.95, `导出视频… ${i + 1}/${extracted.length}`);
          await wait(Math.max(20, frame.delay));
        }
        // hold last frame briefly so encoders flush
        await wait(120);
        recorder.stop();
        stream.getTracks().forEach((t) => t.stop());
        await stopped;

        const blob = new Blob(chunks, { type: mimeType.includes("webm") ? "video/webm" : mimeType });
        if (!blob.size) throw new Error("视频为空，请换 Chrome / Edge 再试");
        if (videoUrl) URL.revokeObjectURL(videoUrl);
        videoUrl = URL.createObjectURL(blob);
        if (gifxVideoPreview) {
          gifxVideoPreview.src = videoUrl;
          gifxVideoPreview.hidden = false;
        }
        if (gifxDownloadVideo) {
          gifxDownloadVideo.href = videoUrl;
          gifxDownloadVideo.hidden = false;
        }
        setGifxProgress(true, 1, `完成 · ${(blob.size / 1024).toFixed(1)} KB`);
        toast("视频已生成");
      } catch (err) {
        if (String(err && err.message) !== "已取消") {
          setError(gifxError, err.message || String(err));
          setGifxProgress(false, 0, "");
        } else {
          setGifxProgress(false, 0, "");
          toast("已取消导出");
        }
      } finally {
        abortVideo = false;
        if (gifxAbort) gifxAbort.hidden = true;
        if (gifxVideoBtn) gifxVideoBtn.disabled = !extracted.length;
        if (gifxZipBtn) gifxZipBtn.disabled = !extracted.length;
      }
    }

    gifxFile?.addEventListener("change", (e) => loadGifFile(e.target.files?.[0]));
    $("#gifx-clear")?.addEventListener("click", clearExtracted);
    gifxZipBtn?.addEventListener("click", downloadZip);
    gifxVideoBtn?.addEventListener("click", exportVideo);
    gifxAbort?.addEventListener("click", () => {
      abortVideo = true;
    });
  } catch (err) {
    console.error("gif extract init failed", err);
  }

  // ---- Video to GIF ----
  try {
    const v2gFile = $("#v2g-file");
    const v2gVideo = $("#v2g-video");
    const v2gMeta = $("#v2g-meta");
    const v2gError = $("#v2g-error");
    const v2gFps = $("#v2g-fps");
    const v2gWidth = $("#v2g-width");
    const v2gMaxsec = $("#v2g-maxsec");
    const v2gStart = $("#v2g-start");
    const v2gQuality = $("#v2g-quality");
    const v2gGenerate = $("#v2g-generate");
    const v2gAbort = $("#v2g-abort");
    const v2gProgress = $("#v2g-progress");
    const v2gProgressFill = $("#v2g-progress-fill");
    const v2gProgressText = $("#v2g-progress-text");
    const v2gPreview = $("#v2g-preview");
    const v2gDownload = $("#v2g-download");
    const MAX_V2G_FRAMES = 300;
    const MAX_V2G_SECONDS = 600;
    let videoObjectUrl = "";
    let gifObjectUrl = "";
    let activeV2gGif = null;
    let abortV2g = false;

    function setV2gProgress(visible, ratio, text) {
      if (!v2gProgress) return;
      v2gProgress.hidden = !visible;
      const pct = Math.max(0, Math.min(100, Math.round((ratio || 0) * 100)));
      if (v2gProgressFill) v2gProgressFill.style.width = `${pct}%`;
      if (v2gProgressText) v2gProgressText.textContent = text || `${pct}%`;
    }

    function revokeV2gGif() {
      if (gifObjectUrl) {
        URL.revokeObjectURL(gifObjectUrl);
        gifObjectUrl = "";
      }
      if (v2gPreview) {
        v2gPreview.hidden = true;
        v2gPreview.removeAttribute("src");
      }
      if (v2gDownload) {
        v2gDownload.hidden = true;
        v2gDownload.removeAttribute("href");
      }
    }

    function clearV2g() {
      abortV2g = true;
      if (activeV2gGif) {
        try {
          activeV2gGif.abort();
        } catch (_) {}
        activeV2gGif = null;
      }
      if (videoObjectUrl) {
        URL.revokeObjectURL(videoObjectUrl);
        videoObjectUrl = "";
      }
      if (v2gVideo) {
        v2gVideo.pause?.();
        v2gVideo.removeAttribute("src");
        v2gVideo.load?.();
        v2gVideo.hidden = true;
      }
      revokeV2gGif();
      if (v2gGenerate) v2gGenerate.disabled = true;
      if (v2gAbort) v2gAbort.hidden = true;
      setV2gProgress(false, 0, "");
      setError(v2gError, "");
      if (v2gMeta) {
        v2gMeta.textContent =
          "支持 MP4 / WebM / MOV（实况照片可先导出为影片再上传）。上传后「最长秒数」默认等于视频时长；很长时转换会较慢、文件也会较大。";
      }
      if (v2gMaxsec) {
        v2gMaxsec.value = "";
        v2gMaxsec.max = String(MAX_V2G_SECONDS);
      }
      if (v2gStart) v2gStart.value = "0";
      if (v2gFile) v2gFile.value = "";
      abortV2g = false;
    }

    function seekVideo(video, time) {
      return new Promise((resolve, reject) => {
        if (!Number.isFinite(time)) {
          reject(new Error("无效的时间点"));
          return;
        }
        const onSeeked = () => {
          video.removeEventListener("seeked", onSeeked);
          video.removeEventListener("error", onError);
          resolve();
        };
        const onError = () => {
          video.removeEventListener("seeked", onSeeked);
          video.removeEventListener("error", onError);
          reject(new Error("视频定位失败"));
        };
        video.addEventListener("seeked", onSeeked);
        video.addEventListener("error", onError);
        const maxT = Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.001) : time;
        const target = Math.max(0, Math.min(time, maxT));
        if (Math.abs((video.currentTime || 0) - target) < 0.001) {
          video.removeEventListener("seeked", onSeeked);
          video.removeEventListener("error", onError);
          resolve();
          return;
        }
        video.currentTime = target;
      });
    }

    function waitFrame() {
      return new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      });
    }

    async function loadVideoFile(file) {
      if (!file) return;
      clearV2g();
      setError(v2gError, "");
      setV2gProgress(true, 0.05, "加载视频…");
      try {
        videoObjectUrl = URL.createObjectURL(file);
        if (!v2gVideo) throw new Error("视频预览未找到");
        v2gVideo.hidden = false;
        v2gVideo.muted = true;
        v2gVideo.playsInline = true;
        v2gVideo.preload = "auto";
        await new Promise((resolve, reject) => {
          const onMeta = () => {
            cleanup();
            resolve();
          };
          const onErr = () => {
            cleanup();
            reject(new Error("无法读取该视频（格式可能不受当前浏览器支持）"));
          };
          const cleanup = () => {
            v2gVideo.removeEventListener("loadedmetadata", onMeta);
            v2gVideo.removeEventListener("error", onErr);
          };
          v2gVideo.addEventListener("loadedmetadata", onMeta);
          v2gVideo.addEventListener("error", onErr);
          v2gVideo.src = videoObjectUrl;
          v2gVideo.load();
        });
        // Some WebM blobs report Infinity until more data is parsed
        let duration = Number(v2gVideo.duration) || 0;
        if (!Number.isFinite(duration) || duration <= 0) {
          const start = Date.now();
          while (Date.now() - start < 2500) {
            await new Promise((r) => setTimeout(r, 100));
            duration = Number(v2gVideo.duration) || 0;
            if (Number.isFinite(duration) && duration > 0) break;
          }
        }
        if ((!Number.isFinite(duration) || duration <= 0) && v2gVideo.videoWidth) {
          duration = 0; // unknown; conversion will use playback capture
        }
        if (!v2gVideo.videoWidth || !v2gVideo.videoHeight) throw new Error("视频时长或尺寸无效");
        if (v2gMaxsec) {
          if (Number.isFinite(duration) && duration > 0) {
            const secs = Math.min(MAX_V2G_SECONDS, Math.max(0.5, Math.round(duration * 10) / 10));
            v2gMaxsec.value = String(secs);
            v2gMaxsec.max = String(Math.max(MAX_V2G_SECONDS, Math.ceil(secs)));
          } else {
            v2gMaxsec.value = "";
            v2gMaxsec.placeholder = "时长未知，请手动填写";
          }
        }
        if (v2gStart) v2gStart.value = "0";
        if (v2gMeta) {
          const durText = Number.isFinite(duration) && duration > 0 ? `${duration.toFixed(2)}s` : "时长未知";
          const maxTip =
            Number.isFinite(duration) && duration > 0
              ? ` · 最长秒数已设为 ${v2gMaxsec?.value || "—"}s`
              : "";
          v2gMeta.textContent = `${file.name} · ${durText} · ${v2gVideo.videoWidth}×${v2gVideo.videoHeight}${maxTip}`;
        }
        if (v2gGenerate) v2gGenerate.disabled = false;
        setV2gProgress(true, 1, "视频已加载，可开始转换");
        toast("视频已加载");
      } catch (err) {
        clearV2g();
        setError(v2gError, err.message || String(err));
      }
    }

    async function convertVideoToGif() {
      if (!v2gVideo || !v2gVideo.src) {
        setError(v2gError, "请先选择视频");
        return;
      }
      if (typeof GIF !== "function") {
        setError(v2gError, "gif.js 未加载");
        return;
      }
      abortV2g = false;
      revokeV2gGif();
      setError(v2gError, "");
      if (v2gGenerate) v2gGenerate.disabled = true;
      if (v2gAbort) v2gAbort.hidden = false;
      setV2gProgress(true, 0.02, "准备抽帧…");

      let cleanupWorker = null;
      try {
        const fps = Math.min(15, Math.max(2, Number(v2gFps?.value) || 8));
        const maxW = Math.min(720, Math.max(64, Number(v2gWidth?.value) || 360));
        const startSec = Math.max(0, Number(v2gStart?.value) || 0);
        const quality = Math.min(30, Math.max(1, Number(v2gQuality?.value) || 12));
        let duration = Number(v2gVideo.duration) || 0;
        const hasDuration = Number.isFinite(duration) && duration > 0;
        if (hasDuration && startSec >= duration) throw new Error("起始时间超出视频长度");
        const rawMax = Number(v2gMaxsec?.value);
        let maxSec;
        if (Number.isFinite(rawMax) && rawMax > 0) {
          maxSec = Math.min(MAX_V2G_SECONDS, Math.max(0.5, rawMax));
        } else if (hasDuration) {
          maxSec = Math.min(MAX_V2G_SECONDS, Math.max(0.5, duration - startSec));
        } else {
          maxSec = 6;
        }
        const endSec = hasDuration ? Math.min(duration, startSec + maxSec) : startSec + maxSec;
        const span = Math.max(0.05, endSec - startSec);
        const delay = Math.round(1000 / fps);
        const naturalFrames = Math.max(2, Math.floor(span * fps) + 1);
        let frameCount = Math.min(MAX_V2G_FRAMES, naturalFrames);
        const framesCapped = naturalFrames > MAX_V2G_FRAMES;

        const srcW = v2gVideo.videoWidth || 0;
        const srcH = v2gVideo.videoHeight || 0;
        if (!srcW || !srcH) throw new Error("无法读取视频尺寸");
        const scale = srcW > maxW ? maxW / srcW : 1;
        const outW = Math.max(1, Math.round(srcW * scale));
        const outH = Math.max(1, Math.round(srcH * scale));

        const canvas = document.createElement("canvas");
        canvas.width = outW;
        canvas.height = outH;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });

        const workerSource = await fetch(new URL("./vendor/gif.worker.js", document.baseURI || window.location.href)).then((r) => {
          if (!r.ok) throw new Error("无法加载 gif.worker.js");
          return r.text();
        });
        const workerScript = URL.createObjectURL(new Blob([workerSource], { type: "application/javascript" }));
        cleanupWorker = () => {
          try {
            URL.revokeObjectURL(workerScript);
          } catch (_) {}
        };

        const gif = new GIF({
          workers: 2,
          quality,
          width: outW,
          height: outH,
          workerScript,
          repeat: 0,
          background: "#000000",
        });
        activeV2gGif = gif;

        const paint = () => {
          ctx.fillStyle = "#000000";
          ctx.fillRect(0, 0, outW, outH);
          ctx.drawImage(v2gVideo, 0, 0, outW, outH);
          gif.addFrame(ctx, { delay, copy: true });
        };

        if (hasDuration) {
          for (let i = 0; i < frameCount; i++) {
            if (abortV2g) throw new Error("已取消");
            const t = startSec + (span * i) / Math.max(1, frameCount - 1);
            await seekVideo(v2gVideo, t);
            await waitFrame();
            paint();
            setV2gProgress(true, ((i + 1) / frameCount) * 0.45, `抽帧… ${i + 1}/${frameCount}`);
          }
        } else {
          // Playback capture fallback when duration is unknown/Infinity
          v2gVideo.currentTime = startSec;
          await waitFrame();
          try {
            await v2gVideo.play();
          } catch (_) {}
          const startedAt = performance.now();
          let captured = 0;
          let lastAt = -Infinity;
          while (captured < frameCount) {
            if (abortV2g) throw new Error("已取消");
            if (v2gVideo.ended) break;
            const elapsed = (performance.now() - startedAt) / 1000;
            if (elapsed > maxSec + 0.5) break;
            const now = performance.now();
            if (now - lastAt >= delay * 0.9) {
              paint();
              captured += 1;
              lastAt = now;
              setV2gProgress(true, (captured / frameCount) * 0.45, `抽帧… ${captured}/${frameCount}`);
            }
            await waitFrame();
          }
          v2gVideo.pause();
          frameCount = Math.max(2, captured);
          if (captured < 2) throw new Error("未能从视频抓取足够帧");
        }

        const blob = await new Promise((resolve, reject) => {
          gif.on("progress", (p) => {
            setV2gProgress(true, 0.45 + p * 0.55, `编码 GIF… ${Math.round(p * 100)}%`);
          });
          gif.on("finished", (b) => resolve(b));
          gif.on("abort", () => reject(new Error("已取消")));
          try {
            gif.render();
          } catch (err) {
            reject(err);
          }
        });

        gifObjectUrl = URL.createObjectURL(blob);
        if (v2gPreview) {
          v2gPreview.src = gifObjectUrl;
          v2gPreview.hidden = false;
        }
        if (v2gDownload) {
          v2gDownload.href = gifObjectUrl;
          v2gDownload.hidden = false;
        }
        setV2gProgress(true, 1, `完成 · ${frameCount} 帧 · ${outW}×${outH} · ${(blob.size / 1024).toFixed(1)} KB`);
        if (v2gMeta) {
          const effFps = frameCount > 1 ? (frameCount - 1) / span : fps;
          const capTip = framesCapped
            ? ` · 为控制体积已抽稀到 ${frameCount} 帧（约 ${effFps.toFixed(1)} FPS）`
            : "";
          v2gMeta.textContent = `已转换 ${frameCount} 帧 · ${span.toFixed(1)}s · ${fps} FPS · ${outW}×${outH} · ${(blob.size / 1024).toFixed(1)} KB${capTip}`;
        }
        toast("GIF 已生成");
      } catch (err) {
        if (String(err && err.message) !== "已取消") {
          setError(v2gError, err.message || String(err));
          setV2gProgress(false, 0, "");
        } else {
          setV2gProgress(false, 0, "");
          toast("已取消转换");
        }
      } finally {
        if (typeof cleanupWorker === "function") cleanupWorker();
        activeV2gGif = null;
        abortV2g = false;
        if (v2gAbort) v2gAbort.hidden = true;
        if (v2gGenerate) v2gGenerate.disabled = !v2gVideo?.src;
      }
    }

    v2gFile?.addEventListener("change", (e) => loadVideoFile(e.target.files?.[0]));
    $("#v2g-clear")?.addEventListener("click", clearV2g);
    v2gGenerate?.addEventListener("click", convertVideoToGif);
    v2gAbort?.addEventListener("click", () => {
      abortV2g = true;
      if (activeV2gGif) {
        try {
          activeV2gGif.abort();
        } catch (_) {}
      }
    });
  } catch (err) {
    console.error("video to gif init failed", err);
  }

  // Rebind copy buttons added dynamically in HTML for new panels
  // ---- ADB bridge client (P0–P3) ----
  try {
    const ADB_STORE_BASE = "devtools-adb-base";
    const ADB_STORE_TOKEN = "devtools-adb-token";
    const adbBaseInput = $("#adb-base");
    const adbTokenInput = $("#adb-token");
    const adbDot = $("#adb-dot");
    const adbStatusTitle = $("#adb-status-title");
    const adbStatusText = $("#adb-status-text");
    const adbError = $("#adb-error");
    const adbWorkspace = $("#adb-workspace");
    const adbDeviceList = $("#adb-device-list");
    const adbDeviceMeta = $("#adb-device-meta");
    const adbSelectedMeta = $("#adb-selected-meta");
    const adbFsList = $("#adb-fs-list");
    const adbFsPath = $("#adb-fs-path");
    const adbFsMeta = $("#adb-fs-meta");
    const adbInfoMeta = $("#adb-info-meta");
    const adbAppsList = $("#adb-apps-list");
    const adbAppsMeta = $("#adb-apps-meta");
    const adbJobsList = $("#adb-jobs-list");
    const adbJobsMeta = $("#adb-jobs-meta");
    const adbInstallMeta = $("#adb-install-meta");
    const adbApkName = $("#adb-apk-name");
    let adbConnected = false;
    let adbDevices = [];
    let adbSelected = "";
    let adbChecked = new Set();
    let adbPollTimer = 0;
    let adbJobTimer = 0;
    let adbApps = [];
    let adbApkFile = null;
    let adbTab = "info";
    let adbPermPackage = "";

    function adbBase() {
      return String(adbBaseInput?.value || "http://127.0.0.1:17888").replace(/\/+$/, "");
    }

    function adbToken() {
      return String(adbTokenInput?.value || "devtools-adb");
    }

    function persistAdbSettings() {
      try {
        localStorage.setItem(ADB_STORE_BASE, adbBase());
        localStorage.setItem(ADB_STORE_TOKEN, adbToken());
      } catch (_) {
        /* ignore */
      }
    }

    function restoreAdbSettings() {
      try {
        const base = localStorage.getItem(ADB_STORE_BASE);
        const token = localStorage.getItem(ADB_STORE_TOKEN);
        if (base && adbBaseInput) adbBaseInput.value = base;
        if (token && adbTokenInput) adbTokenInput.value = token;
      } catch (_) {
        /* ignore */
      }
    }

    function setAdbStatus(kind, title, text) {
      if (adbDot) {
        adbDot.classList.remove("is-ok", "is-warn", "is-err");
        if (kind) adbDot.classList.add(kind);
      }
      if (adbStatusTitle) adbStatusTitle.textContent = title;
      if (adbStatusText) adbStatusText.textContent = text;
    }

    function formatBytes(n) {
      const num = Number(n);
      if (!Number.isFinite(num)) return "";
      if (num < 1024) return `${num} B`;
      if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
      if (num < 1024 * 1024 * 1024) return `${(num / (1024 * 1024)).toFixed(1)} MB`;
      return `${(num / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }

    function joinRemote(dir, name) {
      const base = String(dir || "/sdcard").replace(/\/+$/, "") || "/sdcard";
      return `${base}/${String(name || "").replace(/^\/+/, "")}`;
    }

    function checkedSerials() {
      return [...adbChecked];
    }

    function targetSerials(preferChecked) {
      const list = preferChecked ? checkedSerials() : [];
      if (list.length) return list;
      return adbSelected ? [adbSelected] : [];
    }

    function updateSelectedMeta() {
      if (!adbSelectedMeta) return;
      const n = adbChecked.size;
      adbSelectedMeta.textContent = adbSelected
        ? `当前：${adbSelected}${n ? ` · 已勾选 ${n} 台` : " · 未勾选批量设备"}`
        : "请选择当前设备；勾选用于批量安装与截图";
      if (adbInstallMeta) {
        adbInstallMeta.textContent = n
          ? `将安装到勾选的 ${n} 台设备`
          : adbSelected
            ? `未勾选时，「安装到勾选设备」会回退到当前设备`
            : "请先选择设备";
      }
    }

    async function adbFetch(pathname, options = {}) {
      const headers = Object.assign({}, options.headers || {});
      if (options.auth !== false) headers["X-Adb-Token"] = adbToken();
      const res = await fetch(`${adbBase()}${pathname}`, {
        ...options,
        headers,
        cache: "no-store",
      });
      const type = res.headers.get("content-type") || "";
      if (type.includes("application/json")) {
        const data = await res.json();
        if (!res.ok || data.ok === false) {
          throw new Error(data.error || `请求失败 (${res.status})`);
        }
        return data;
      }
      if (!res.ok) {
        let msg = `请求失败 (${res.status})`;
        try {
          const data = await res.json();
          if (data?.error) msg = data.error;
        } catch (_) {
          /* ignore */
        }
        throw new Error(msg);
      }
      return res;
    }

    function requireCurrentSerial() {
      if (!adbSelected) throw new Error("请先选择当前设备");
      return adbSelected;
    }

    function switchAdbTab(tab) {
      adbTab = tab;
      $$(".adb-tab").forEach((btn) => {
        btn.classList.toggle("is-active", btn.dataset.adbTab === tab);
      });
      $$("[data-adb-panel]").forEach((panel) => {
        panel.hidden = panel.dataset.adbPanel !== tab;
      });
      if (tab === "apps" && adbSelected && !adbApps.length) loadApps().catch(() => {});
      if (tab === "jobs") refreshJobs().catch(() => {});
      if (tab === "info" && adbSelected) loadSnapshot({ silent: true }).catch(() => {});
      if (tab === "network" && adbSelected) {
        refreshProxy({ silent: true }).catch(() => {});
        refreshForwards({ silent: true }).catch(() => {});
      }
      if (tab === "developer" && adbSelected) refreshDeveloper({ silent: true }).catch(() => {});
    }

    function renderAdbDevices() {
      if (!adbDeviceList) return;
      if (!adbDevices.length) {
        adbDeviceList.innerHTML = `<div class="adb-fs-empty">未检测到设备。请检查 USB 调试授权后点「刷新设备」。</div>`;
        if (adbDeviceMeta) adbDeviceMeta.textContent = "0 台";
        updateSelectedMeta();
        return;
      }
      if (adbDeviceMeta) adbDeviceMeta.textContent = `${adbDevices.length} 台`;
      adbDeviceList.innerHTML = adbDevices
        .map((d) => {
          const title = d.model || d.product || d.serial;
          const active = d.serial === adbSelected ? " is-active" : "";
          const checked = adbChecked.has(d.serial) ? "checked" : "";
          return `<div class="adb-device${active}" data-serial-wrap="${escapeHtml(d.serial)}">
            <input class="adb-device-check" type="checkbox" data-adb-check="${escapeHtml(d.serial)}" ${checked} aria-label="勾选 ${escapeHtml(d.serial)}" />
            <button type="button" class="adb-device-body linkish" data-serial="${escapeHtml(d.serial)}">
              <strong>${escapeHtml(title)}</strong>
              <span>${escapeHtml(d.serial)} · ${escapeHtml(d.state)}</span>
            </button>
          </div>`;
        })
        .join("");
      updateSelectedMeta();
    }

    function fillAdbInfo(info) {
      const set = (id, value) => {
        const el = $(id);
        if (el) el.textContent = value || "—";
      };
      if (!info) {
        ["#adb-info-serial", "#adb-info-state", "#adb-info-model", "#adb-info-android", "#adb-info-screen", "#adb-info-battery", "#adb-info-storage", "#adb-info-build"].forEach((id) => set(id, "—"));
        if (adbInfoMeta) adbInfoMeta.textContent = "未选择设备";
        return;
      }
      set("#adb-info-serial", info.serial || info.serialno);
      set("#adb-info-state", info.state);
      set("#adb-info-model", [info.manufacturer, info.model].filter(Boolean).join(" / "));
      set(
        "#adb-info-android",
        [info.androidVersion && `Android ${info.androidVersion}`, info.sdk && `SDK ${info.sdk}`]
          .filter(Boolean)
          .join(" · ")
      );
      set("#adb-info-screen", [info.screen, info.density && `${info.density} dpi`].filter(Boolean).join(" / "));
      set("#adb-info-battery", info.battery);
      set("#adb-info-storage", info.storage);
      set("#adb-info-build", [info.abi, info.buildId].filter(Boolean).join(" · "));
      if (adbInfoMeta) {
        adbInfoMeta.textContent = info.ready === false ? info.message || "设备未就绪" : "已加载";
      }
    }

    function renderFsEntries(pathValue, entries) {
      if (!adbFsList) return;
      if (!entries?.length) {
        adbFsList.innerHTML = `<div class="adb-fs-empty">目录为空</div>`;
        return;
      }
      adbFsList.innerHTML = entries
        .map((item) => {
          const full = joinRemote(pathValue, item.name);
          const isDir = item.type === "dir";
          const meta = [isDir ? "文件夹" : formatBytes(item.size), item.date].filter(Boolean).join(" · ");
          const openBtn = isDir
            ? `<button type="button" class="linkish" data-adb-open="${escapeHtml(full)}">${escapeHtml(item.name)}/</button>`
            : `<span class="mono">${escapeHtml(item.name)}</span>`;
          return `<div class="adb-fs-row">
            ${openBtn}
            <span class="adb-fs-meta">${escapeHtml(meta)}</span>
            <div class="adb-fs-actions">
              ${isDir ? `<button type="button" class="ghost-btn" data-adb-open="${escapeHtml(full)}">打开</button>` : `<button type="button" class="secondary-btn" data-adb-dl="${escapeHtml(full)}" data-adb-dl-name="${escapeHtml(item.name)}">下载</button>`}
              <button type="button" class="ghost-btn" data-adb-rename="${escapeHtml(full)}" data-adb-rename-name="${escapeHtml(item.name)}">重命名</button>
              <button type="button" class="ghost-btn" data-adb-move="${escapeHtml(full)}">移动</button>
              <button type="button" class="ghost-btn" data-adb-copy="${escapeHtml(full)}">复制</button>
              <button type="button" class="ghost-btn" data-adb-del="${escapeHtml(full)}" data-adb-del-name="${escapeHtml(item.name)}">删除</button>
            </div>
          </div>`;
        })
        .join("");
    }

    function renderApps() {
      if (!adbAppsList) return;
      const q = String($("#adb-apps-filter")?.value || "")
        .trim()
        .toLowerCase();
      const list = adbApps.filter((app) => !q || app.packageName.toLowerCase().includes(q));
      if (adbAppsMeta) adbAppsMeta.textContent = `${list.length}/${adbApps.length} · ${adbSelected || "未选择"}`;
      if (!list.length) {
        adbAppsList.innerHTML = `<div class="adb-fs-empty">无匹配应用</div>`;
        return;
      }
      adbAppsList.innerHTML = list
        .slice(0, 400)
        .map((app) => {
          const kind = app.isSystem ? "系统" : "三方";
          return `<div class="adb-fs-row">
            <div>
              <strong class="mono">${escapeHtml(app.packageName)}</strong>
              <div class="adb-fs-meta">${kind}${app.apkPath ? ` · ${escapeHtml(app.apkPath)}` : ""}</div>
            </div>
            <span></span>
            <div class="adb-fs-actions">
              <button type="button" class="ghost-btn" data-adb-app-select="${escapeHtml(app.packageName)}">选中</button>
              <button type="button" class="primary-btn" data-adb-app-open="${escapeHtml(app.packageName)}">打开</button>
              <button type="button" class="secondary-btn" data-adb-app-info="${escapeHtml(app.packageName)}">详情</button>
              <button type="button" class="ghost-btn" data-adb-app-stop="${escapeHtml(app.packageName)}">强停</button>
              <button type="button" class="ghost-btn" data-adb-app-clear="${escapeHtml(app.packageName)}">清数据</button>
              <button type="button" class="secondary-btn" data-adb-app-backup="${escapeHtml(app.packageName)}">备份APK</button>
              <button type="button" class="ghost-btn" data-adb-app-disable="${escapeHtml(app.packageName)}">停用</button>
              <button type="button" class="ghost-btn" data-adb-app-enable="${escapeHtml(app.packageName)}">启用</button>
              <button type="button" class="ghost-btn" data-adb-app-uninstall="${escapeHtml(app.packageName)}">卸载</button>
            </div>
          </div>`;
        })
        .join("");
      if (list.length > 400) {
        adbAppsList.insertAdjacentHTML(
          "beforeend",
          `<div class="adb-fs-empty">仅显示前 400 条，请用过滤缩小范围</div>`
        );
      }
    }

    function jobTypeLabel(type) {
      return (
        {
          install: "安装 APK",
          screenshot: "截图",
          record: "录屏",
          backup: "备份 APK",
        }[type] || type
      );
    }

    function renderJobs(jobs) {
      if (!adbJobsList) return;
      if (!jobs?.length) {
        adbJobsList.innerHTML = `<div class="adb-fs-empty">暂无任务</div>`;
        if (adbJobsMeta) adbJobsMeta.textContent = "暂无任务";
        return;
      }
      if (adbJobsMeta) adbJobsMeta.textContent = `${jobs.length} 条最近任务`;
      adbJobsList.innerHTML = jobs
        .map((job) => {
          const items = (job.items || [])
            .map((it) => `<li>${escapeHtml(it.serial || "")}: ${escapeHtml(it.status)} ${escapeHtml(it.message || "")}</li>`)
            .join("");
          const arts = (job.artifacts || [])
            .map(
              (a) =>
                `<button type="button" class="secondary-btn" data-adb-art-job="${escapeHtml(job.id)}" data-adb-art-name="${escapeHtml(a.name)}">下载 ${escapeHtml(a.name)}</button>`
            )
            .join("");
          return `<div class="adb-job">
            <div class="adb-job-head">
              <strong>${escapeHtml(jobTypeLabel(job.type))} · ${escapeHtml(job.status)}</strong>
              <span>${escapeHtml(String(job.progress || 0))}%</span>
            </div>
            <div class="gif-progress" style="margin-top:0.45rem">
              <div class="gif-progress-track"><span class="gif-progress-fill" style="width:${Number(job.progress) || 0}%"></span></div>
            </div>
            <p class="adb-job-msg">${escapeHtml(job.message || job.error || "")}</p>
            ${items ? `<ul class="adb-job-items">${items}</ul>` : ""}
            ${arts ? `<div class="adb-job-arts">${arts}</div>` : ""}
          </div>`;
        })
        .join("");
    }

    async function loadAdbInfo(serial) {
      if (!serial) {
        fillAdbInfo(null);
        return;
      }
      try {
        const data = await adbFetch(`/device/info?serial=${encodeURIComponent(serial)}`);
        fillAdbInfo(data.info);
      } catch (err) {
        fillAdbInfo({ serial, state: "error", ready: false, message: err.message || String(err) });
        setError(adbError, err.message || String(err));
      }
    }

    async function loadFs(pathValue) {
      if (!adbSelected) return;
      const pathText = pathValue || adbFsPath?.value || "/sdcard";
      if (adbFsPath) adbFsPath.value = pathText;
      if (adbFsMeta) adbFsMeta.textContent = "加载中…";
      try {
        const data = await adbFetch(
          `/fs/list?serial=${encodeURIComponent(adbSelected)}&path=${encodeURIComponent(pathText)}`
        );
        renderFsEntries(data.path, data.entries || []);
        if (adbFsPath) adbFsPath.value = data.path;
        if (adbFsMeta) adbFsMeta.textContent = `${(data.entries || []).length} 项 · ${data.path}`;
        setError(adbError, "");
      } catch (err) {
        if (adbFsList) adbFsList.innerHTML = `<div class="adb-fs-empty">${escapeHtml(err.message || String(err))}</div>`;
        if (adbFsMeta) adbFsMeta.textContent = "读取失败";
        setError(adbError, err.message || String(err));
      }
    }

    async function loadApps() {
      if (!adbSelected) return;
      if (adbAppsMeta) adbAppsMeta.textContent = "加载中…";
      const kind = $("#adb-apps-kind")?.value || "third";
      const data = await adbFetch(
        `/apps?serial=${encodeURIComponent(adbSelected)}&kind=${encodeURIComponent(kind)}`
      );
      adbApps = data.apps || [];
      renderApps();
    }

    async function loadSnapshot({ silent = false } = {}) {
      const serial = requireCurrentSerial();
      const snapMeta = $("#adb-snap-meta");
      const out = $("#adb-snap-out");
      if (snapMeta) snapMeta.textContent = "加载中…";
      const data = await adbFetch(`/device/snapshot?serial=${encodeURIComponent(serial)}`);
      const text = [
        `前台:\n${data.foreground || "—"}`,
        `uptime: ${data.uptime || "—"}`,
        `屏幕常亮(stay_on_while_plugged_in): ${data.stayOnWhilePluggedIn || "—"}`,
        `\n磁盘:\n${data.disk || "—"}`,
        `\n内存:\n${data.meminfo || "—"}`,
        `\n进程:\n${data.top || "—"}`,
      ].join("\n");
      if (out) out.textContent = text;
      if (snapMeta) snapMeta.textContent = "已更新";
      if (!silent) toast("快照已刷新");
    }

    async function deviceControl(action) {
      const serial = requireCurrentSerial();
      const data = await adbFetch("/device/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serial, action }),
      });
      toast(data.message || "已执行");
      return data;
    }

    async function fetchLogcat() {
      const serial = requireCurrentSerial();
      const lines = Number($("#adb-log-lines")?.value || 400);
      const packageName = String($("#adb-log-package")?.value || "").trim();
      const query = String($("#adb-log-query")?.value || "").trim();
      const params = new URLSearchParams({
        serial,
        lines: String(lines),
      });
      if (packageName) params.set("package", packageName);
      if (query) params.set("query", query);
      if ($("#adb-log-meta")) $("#adb-log-meta").textContent = "拉取中…";
      const data = await adbFetch(`/logcat?${params.toString()}`);
      if ($("#adb-log-out")) $("#adb-log-out").textContent = data.text || "(无日志)";
      if ($("#adb-log-meta")) $("#adb-log-meta").textContent = `已拉取 ${data.lines || 0} 行`;
    }

    async function selectAdbDevice(serial) {
      adbSelected = serial;
      renderAdbDevices();
      await loadAdbInfo(serial);
      await loadFs(adbFsPath?.value || "/sdcard");
      if (adbTab === "apps") await loadApps();
      if (adbTab === "info") await loadSnapshot({ silent: true }).catch(() => {});
    }

    async function refreshAdbDevices({ silent = false } = {}) {
      const data = await adbFetch("/devices");
      adbDevices = data.devices || [];
      const serialSet = new Set(adbDevices.map((d) => d.serial));
      adbChecked = new Set([...adbChecked].filter((s) => serialSet.has(s)));
      if (!adbSelected || !serialSet.has(adbSelected)) {
        const ready = adbDevices.find((d) => d.state === "device");
        adbSelected = (ready || adbDevices[0] || {}).serial || "";
      }
      if (!adbChecked.size && adbSelected) adbChecked.add(adbSelected);
      renderAdbDevices();
      if (adbSelected) {
        await loadAdbInfo(adbSelected);
        await loadFs(adbFsPath?.value || "/sdcard");
      } else {
        fillAdbInfo(null);
        if (adbFsList) adbFsList.innerHTML = `<div class="adb-fs-empty">请选择设备</div>`;
      }
      const adbLine = data.adb?.version || "adb ok";
      setAdbStatus(
        adbDevices.length ? "is-ok" : "is-warn",
        adbDevices.length ? `已连接 · ${adbDevices.length} 台设备` : "已连接桥 · 无设备",
        `${adbLine}。支持文件 / 安装 / 应用 / 截图录屏。`
      );
      if (!silent) toast(adbDevices.length ? `已刷新 ${adbDevices.length} 台设备` : "桥已连接，未发现设备");
    }

    async function connectAdbBridge({ fromPoll = false } = {}) {
      persistAdbSettings();
      setError(adbError, "");
      try {
        const health = await adbFetch("/health", { auth: false });
        if (!health.adb?.ok) {
          adbConnected = true;
          if (adbWorkspace) adbWorkspace.hidden = true;
          if ($("#adb-refresh")) $("#adb-refresh").disabled = true;
          setAdbStatus("is-err", "桥已启动，但未找到 adb", health.adb?.error || "请安装 platform-tools 并确保 adb 在 PATH 中");
          setError(adbError, health.adb?.error || "本机未找到 adb 命令");
          return false;
        }
        adbConnected = true;
        if (adbWorkspace) adbWorkspace.hidden = false;
        if ($("#adb-refresh")) $("#adb-refresh").disabled = false;
        await refreshAdbDevices({ silent: fromPoll });
        return true;
      } catch (err) {
        adbConnected = false;
        if (adbWorkspace) adbWorkspace.hidden = true;
        if ($("#adb-refresh")) $("#adb-refresh").disabled = true;
        setAdbStatus(
          "is-err",
          "未连接本机桥",
          fromPoll
            ? "已下载完整包的话，请解压并运行启动脚本（同目录需有 server.js），保持窗口打开；正在等待桥启动…"
            : "请先下载完整 ZIP 并运行启动脚本，再点连接。需本机已安装 adb。"
        );
        if (!fromPoll) setError(adbError, err.message || "无法连接本机桥");
        return false;
      }
    }

    function startAdbWaitPoll() {
      clearInterval(adbPollTimer);
      let tries = 0;
      adbPollTimer = setInterval(async () => {
        tries += 1;
        const ok = await connectAdbBridge({ fromPoll: true });
        if (ok || tries >= 60) clearInterval(adbPollTimer);
      }, 2000);
    }

    function downloadBlobFile(blob, filename) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }

    async function fetchTextAsset(path) {
      const res = await fetch(path, { cache: "no-cache" });
      if (!res.ok) throw new Error(`无法读取 ${path}（${res.status}）`);
      return res.text();
    }

    async function downloadAdbBridgeBundle(platform) {
      if (typeof JSZip === "undefined") throw new Error("JSZip 未加载，无法打包下载");
      const map = {
        mac: {
          scriptPath: "./adb-bridge/start-mac.command",
          scriptName: "start-adb-bridge.command",
          zipName: "devtools-adb-bridge-mac.zip",
          runHint: "解压后在终端执行：chmod +x start-adb-bridge.command && ./start-adb-bridge.command\n也可在 Finder 中双击 start-adb-bridge.command。",
        },
        win: {
          scriptPath: "./adb-bridge/start-win.bat",
          scriptName: "start-adb-bridge.bat",
          zipName: "devtools-adb-bridge-win.zip",
          runHint:
            "解压后优先双击 start-adb-bridge.cmd（更不易闪退）；也可双击 start-adb-bridge.bat。请保持窗口打开。",
        },
        linux: {
          scriptPath: "./adb-bridge/start-linux.sh",
          scriptName: "start-adb-bridge.sh",
          zipName: "devtools-adb-bridge-linux.zip",
          runHint: "解压后执行：chmod +x start-adb-bridge.sh && ./start-adb-bridge.sh",
        },
      };
      const cfg = map[platform];
      if (!cfg) throw new Error("未知平台");
      const [serverJs, scriptRaw] = await Promise.all([
        fetchTextAsset("./adb-bridge/server.js"),
        fetchTextAsset(cfg.scriptPath),
      ]);
      // Windows cmd.exe is fragile with LF-only / UTF-8 Chinese .bat files.
      const scriptText =
        platform === "win" ? String(scriptRaw).replace(/\r?\n/g, "\r\n") : scriptRaw;
      if (!/ADB_BRIDGE_TOKEN|devtools-adb-bridge|DevTools local ADB bridge/.test(serverJs)) {
        throw new Error("server.js 内容异常，请刷新页面后重试");
      }
      const readme = [
        "DevTools ADB Bridge 完整包",
        "",
        "本压缩包必须同时保留：",
        "  - server.js          （桥接服务，缺它会提示找不到 server.js）",
        "  - " + cfg.scriptName + "  （启动脚本）",
        "",
        "使用步骤：",
        "1. 解压到任意文件夹（两个文件放在同一目录）",
        "2. 本机已安装 Node.js 与 adb，并可用 adb devices",
        "3. " + cfg.runHint.replace(/\n/g, "\n   "),
        "4. 回到网页点击「连接本机桥」",
        "",
        "若窗口一闪而过：",
        "- Windows：请重新下载本完整包（已修复编码闪退）；窗口结束时会 pause",
        "- Windows 日志：%USERPROFILE%\\.devtools-adb-bridge\\last-start.log",
        "- Windows 也会复制到桌面：devtools-adb-bridge-last-start.log",
        "- macOS：chmod +x " + cfg.scriptName + " 后运行；或 bash " + cfg.scriptName,
        "- 确认未重复打开多个桥（端口占用会自动换端口并提示）",
        "",
        "默认地址 http://127.0.0.1:17888  Token: devtools-adb",
        "",
      ].join("\n");
      const zip = new JSZip();
      zip.file("server.js", serverJs);
      zip.file(cfg.scriptName, scriptText, {
        unixPermissions: platform === "win" ? undefined : 0o755,
      });
      if (platform === "win") {
        // Outer wrapper always pauses, even if the .bat hits a parser error.
        const wrapper = [
          "@echo off",
          'cd /d "%~dp0"',
          'cmd /d /c ""%~dp0start-adb-bridge.bat" & echo. & echo Log: %USERPROFILE%\\.devtools-adb-bridge\\last-start.log & echo Desktop copy: devtools-adb-bridge-last-start.log & pause"',
          "",
        ].join("\r\n");
        zip.file("start-adb-bridge.cmd", wrapper);
      }
      zip.file(platform === "win" ? "README.txt" : "使用说明.txt", readme.replace(/\r?\n/g, platform === "win" ? "\r\n" : "\n"));
      const blob = await zip.generateAsync({
        type: "blob",
        platform: platform === "win" ? "DOS" : "UNIX",
      });
      downloadBlobFile(blob, cfg.zipName);
      setAdbStatus(
        "is-warn",
        "等待本机桥启动…",
        "完整包已下载。请解压后运行启动脚本（同目录需有 server.js），并保持窗口打开；网页会自动重试连接。"
      );
      toast("已下载完整包，请解压后运行");
      startAdbWaitPoll();
    }

    function downloadAdbScriptAndWait(anchor) {
      const platform = anchor?.dataset?.adbBundle;
      if (platform) {
        downloadAdbBridgeBundle(platform).catch((err) => {
          setError(adbError, err.message || String(err));
          setAdbStatus("is-err", "下载失败", err.message || String(err));
        });
        return;
      }
      const href = anchor?.getAttribute("href");
      const filename = anchor?.getAttribute("download") || "start-adb-bridge";
      if (href) {
        const a = document.createElement("a");
        a.href = href;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      setAdbStatus("is-warn", "等待本机桥启动…", "脚本开始下载。请双击运行，并保持终端窗口打开；网页会自动重试连接。");
      toast("请运行下载的启动脚本");
      startAdbWaitPoll();
    }

    async function uploadAdbFiles(fileList) {
      if (!adbSelected) return;
      const files = [...fileList];
      if (!files.length) return;
      const dir = adbFsPath?.value || "/sdcard";
      setError(adbError, "");
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (adbFsMeta) adbFsMeta.textContent = `上传中 ${i + 1}/${files.length}：${file.name}`;
        const buffer = new Uint8Array(await file.arrayBuffer());
        await adbFetch(
          `/fs/upload?serial=${encodeURIComponent(adbSelected)}&path=${encodeURIComponent(dir)}&name=${encodeURIComponent(file.name)}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/octet-stream",
              "X-Filename": encodeURIComponent(file.name),
            },
            body: buffer,
          }
        );
      }
      toast(`已上传 ${files.length} 个文件`);
      await loadFs(dir);
    }

    async function downloadAdbFile(remotePath, name) {
      if (!adbSelected) return;
      if (adbFsMeta) adbFsMeta.textContent = `下载中：${name || remotePath}`;
      const res = await adbFetch(
        `/fs/download?serial=${encodeURIComponent(adbSelected)}&path=${encodeURIComponent(remotePath)}`
      );
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name || "download.bin";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast("已开始下载到电脑");
      if (adbFsMeta) adbFsMeta.textContent = `已下载 ${name || ""}`;
    }

    async function downloadArtifact(jobId, name) {
      const res = await adbFetch(`/jobs/${encodeURIComponent(jobId)}/artifact/${encodeURIComponent(name)}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast("已开始下载");
    }

    function watchJobs() {
      clearInterval(adbJobTimer);
      adbJobTimer = setInterval(() => {
        if (!adbConnected) return;
        if (adbTab === "jobs" || document.visibilityState === "visible") {
          refreshJobs({ silent: true }).catch(() => {});
        }
      }, 1500);
    }

    async function refreshJobs({ silent = false } = {}) {
      const data = await adbFetch("/jobs");
      renderJobs(data.jobs || []);
      if (!silent) toast("任务已刷新");
    }

    async function trackJob(job) {
      switchAdbTab("jobs");
      toast(`任务已创建：${jobTypeLabel(job.type)}`);
      await refreshJobs({ silent: true });
      watchJobs();
    }

    async function startInstall(serials) {
      if (!adbApkFile) throw new Error("请先选择 APK");
      if (!serials.length) throw new Error("请选择设备");
      const buffer = new Uint8Array(await adbApkFile.arrayBuffer());
      const uploaded = await adbFetch(`/upload?name=${encodeURIComponent(adbApkFile.name)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Filename": encodeURIComponent(adbApkFile.name),
        },
        body: buffer,
      });
      const data = await adbFetch("/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uploadId: uploaded.uploadId,
          serials,
          replace: Boolean($("#adb-apk-replace")?.checked),
        }),
      });
      await trackJob(data.job);
    }

    function setApkButtonsEnabled(on) {
      if ($("#adb-apk-install-selected")) $("#adb-apk-install-selected").disabled = !on;
      if ($("#adb-apk-install-current")) $("#adb-apk-install-current").disabled = !on;
      if ($("#adb-apk-analyze")) $("#adb-apk-analyze").disabled = !on;
    }

    function setPermTarget(pkg) {
      adbPermPackage = pkg || "";
      if ($("#adb-perm-target")) {
        $("#adb-perm-target").textContent = adbPermPackage
          ? `权限目标：${adbPermPackage}`
          : "先点某个应用的「选中」再授予/撤销";
      }
    }

    async function showAppInfo(packageName) {
      const serial = requireCurrentSerial();
      const data = await adbFetch(
        `/apps/info?serial=${encodeURIComponent(serial)}&package=${encodeURIComponent(packageName)}`
      );
      const el = $("#adb-app-detail");
      if (!el) return;
      el.hidden = false;
      el.textContent = [
        `包名: ${data.packageName}`,
        `版本: ${data.versionName || "—"} (${data.versionCode || "—"})`,
        `SDK: min ${data.minSdk || "—"} / target ${data.targetSdk || "—"}`,
        `启动 Activity: ${data.launchActivity || "—"}`,
        `已授予权限 (${(data.grantedPermissions || []).length}):`,
        ...(data.grantedPermissions || []).slice(0, 40),
        "",
        `声明权限 (${(data.permissions || []).length}):`,
        ...(data.permissions || []).slice(0, 40),
        "",
        "预览:",
        data.rawPreview || "",
      ].join("\n");
      setPermTarget(packageName);
      switchAdbTab("apps");
    }

    async function analyzeSelectedApk() {
      if (!adbApkFile) throw new Error("请先选择 APK");
      const buffer = new Uint8Array(await adbApkFile.arrayBuffer());
      const uploaded = await adbFetch(`/upload?name=${encodeURIComponent(adbApkFile.name)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Filename": encodeURIComponent(adbApkFile.name),
        },
        body: buffer,
      });
      const data = await adbFetch("/apk/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId: uploaded.uploadId }),
      });
      const el = $("#adb-apk-info");
      if (!el) return;
      el.hidden = false;
      el.textContent = [
        `文件: ${data.filename || adbApkFile.name}`,
        `大小: ${formatBytes(data.size || adbApkFile.size)}`,
        `解析工具: ${data.tool || "无"}`,
        data.note || "",
        `应用名: ${data.label || "—"}`,
        `包名: ${data.packageName || "—"}`,
        `版本: ${data.versionName || "—"} (${data.versionCode || "—"})`,
        `SDK: min ${data.minSdk || "—"} / target ${data.targetSdk || "—"}`,
        `启动: ${data.launchActivity || "—"}`,
        `权限 (${(data.permissions || []).length}):`,
        ...(data.permissions || []).slice(0, 60),
        "",
        data.rawPreview || "",
      ]
        .filter((line) => line !== "")
        .join("\n");
      toast("APK 信息已解析");
    }

    async function refreshProxy({ silent = false } = {}) {
      const serial = requireCurrentSerial();
      const data = await adbFetch(`/network/proxy?serial=${encodeURIComponent(serial)}`);
      if ($("#adb-proxy-host") && data.host) $("#adb-proxy-host").value = data.host;
      if ($("#adb-proxy-port") && data.port) $("#adb-proxy-port").value = data.port;
      if ($("#adb-proxy-meta")) {
        $("#adb-proxy-meta").textContent = data.httpProxy
          ? `当前代理：${data.httpProxy}`
          : "当前未设置 HTTP 代理";
      }
      if (!silent) toast("代理状态已刷新");
    }

    async function refreshForwards({ silent = false } = {}) {
      const serial = requireCurrentSerial();
      const data = await adbFetch(`/network/forward?serial=${encodeURIComponent(serial)}`);
      const lines = [];
      lines.push("forward:");
      if (!(data.forwards || []).length) lines.push("  (无)");
      for (const f of data.forwards || []) {
        lines.push(`  ${f.serial}  ${f.local}  ->  ${f.remote}`);
      }
      lines.push("reverse:");
      const reverses = (data.reverses || []).filter((r) => r.local || r.raw);
      if (!reverses.length) lines.push("  (无)");
      for (const r of reverses) {
        lines.push(r.local ? `  ${r.local}  ->  ${r.remote}` : `  ${r.raw}`);
      }
      if ($("#adb-fwd-out")) $("#adb-fwd-out").textContent = lines.join("\n");
      if ($("#adb-forward-meta")) {
        $("#adb-forward-meta").textContent = `forward ${(data.forwards || []).length} · reverse ${reverses.length}`;
      }
      if (!silent) toast("转发列表已刷新");
    }

    async function refreshDeveloper({ silent = false } = {}) {
      const serial = requireCurrentSerial();
      const data = await adbFetch(`/developer?serial=${encodeURIComponent(serial)}`);
      if ($("#adb-dev-show-touches")) $("#adb-dev-show-touches").textContent = data.showTouches ? "开" : "关";
      if ($("#adb-dev-pointer")) $("#adb-dev-pointer").textContent = data.pointerLocation ? "开" : "关";
      if ($("#adb-dev-layout")) $("#adb-dev-layout").textContent = data.layoutBounds ? "开" : "关";
      if ($("#adb-dev-scales")) {
        $("#adb-dev-scales").textContent = `window ${data.windowAnimationScale} / transition ${data.transitionAnimationScale} / animator ${data.animatorDurationScale}`;
      }
      if ($("#adb-dev-meta")) $("#adb-dev-meta").textContent = "已同步当前设备状态";
      if (!silent) toast("开发者选项已刷新");
    }

    restoreAdbSettings();
    setAdbStatus("is-err", "未连接本机桥", "使用本工具需要本机已安装 adb。请下载完整 ZIP（含 server.js）并运行后连接。");

    $("#adb-connect")?.addEventListener("click", () => connectAdbBridge());
    $("#adb-refresh")?.addEventListener("click", () =>
      refreshAdbDevices().catch((err) => setError(adbError, err.message || String(err)))
    );
    adbBaseInput?.addEventListener("change", persistAdbSettings);
    adbTokenInput?.addEventListener("change", persistAdbSettings);

    $("#adb-dl-mac")?.addEventListener("click", (e) => {
      e.preventDefault();
      downloadAdbScriptAndWait($("#adb-dl-mac"));
    });
    $("#adb-dl-win")?.addEventListener("click", (e) => {
      e.preventDefault();
      downloadAdbScriptAndWait($("#adb-dl-win"));
    });
    $("#adb-dl-linux")?.addEventListener("click", (e) => {
      e.preventDefault();
      downloadAdbScriptAndWait($("#adb-dl-linux"));
    });

    $$(".adb-tab").forEach((btn) => {
      btn.addEventListener("click", () => switchAdbTab(btn.dataset.adbTab));
    });

    $("#adb-select-all")?.addEventListener("click", () => {
      adbChecked = new Set(adbDevices.map((d) => d.serial));
      renderAdbDevices();
    });
    $("#adb-select-none")?.addEventListener("click", () => {
      adbChecked = new Set();
      renderAdbDevices();
    });

    adbDeviceList?.addEventListener("click", (e) => {
      const check = e.target.closest("[data-adb-check]");
      if (check) return;
      const btn = e.target.closest("[data-serial]");
      if (!btn) return;
      selectAdbDevice(btn.dataset.serial).catch((err) => setError(adbError, err.message || String(err)));
    });
    adbDeviceList?.addEventListener("change", (e) => {
      const check = e.target.closest("[data-adb-check]");
      if (!check) return;
      const serial = check.dataset.adbCheck;
      if (check.checked) adbChecked.add(serial);
      else adbChecked.delete(serial);
      updateSelectedMeta();
    });

    $("#adb-fs-go")?.addEventListener("click", () => loadFs(adbFsPath?.value || "/sdcard"));
    $("#adb-fs-refresh")?.addEventListener("click", () => loadFs(adbFsPath?.value || "/sdcard"));
    $("#adb-fs-home")?.addEventListener("click", () => loadFs("/sdcard"));
    $("#adb-fs-download-dir")?.addEventListener("click", () => loadFs("/sdcard/Download"));
    adbFsPath?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") loadFs(adbFsPath.value || "/sdcard");
    });
    $("#adb-fs-up")?.addEventListener("click", () => {
      const cur = adbFsPath?.value || "/sdcard";
      const parts = cur.replace(/\/+$/, "").split("/");
      if (parts.length <= 2) {
        loadFs("/sdcard");
        return;
      }
      parts.pop();
      loadFs(parts.join("/") || "/sdcard");
    });
    $("#adb-fs-mkdir")?.addEventListener("click", async () => {
      if (!adbSelected) return;
      const name = window.prompt("新建文件夹名称");
      if (!name || !name.trim()) return;
      const target = joinRemote(adbFsPath?.value || "/sdcard", name.trim());
      try {
        await adbFetch("/fs/mkdir", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ serial: adbSelected, path: target }),
        });
        toast("已创建文件夹");
        await loadFs(adbFsPath?.value || "/sdcard");
      } catch (err) {
        setError(adbError, err.message || String(err));
      }
    });
    $("#adb-fs-upload")?.addEventListener("change", async (e) => {
      try {
        await uploadAdbFiles(e.target.files || []);
      } catch (err) {
        setError(adbError, err.message || String(err));
      } finally {
        e.target.value = "";
      }
    });

    adbFsList?.addEventListener("click", async (e) => {
      const openBtn = e.target.closest("[data-adb-open]");
      if (openBtn) {
        loadFs(openBtn.dataset.adbOpen);
        return;
      }
      const dlBtn = e.target.closest("[data-adb-dl]");
      if (dlBtn) {
        try {
          await downloadAdbFile(dlBtn.dataset.adbDl, dlBtn.dataset.adbDlName);
        } catch (err) {
          setError(adbError, err.message || String(err));
        }
        return;
      }
      const renameBtn = e.target.closest("[data-adb-rename]");
      if (renameBtn) {
        const next = window.prompt("新名称", renameBtn.dataset.adbRenameName || "");
        if (!next || !next.trim()) return;
        try {
          await adbFetch("/fs/rename", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ serial: adbSelected, path: renameBtn.dataset.adbRename, name: next.trim() }),
          });
          toast("已重命名");
          await loadFs(adbFsPath?.value || "/sdcard");
        } catch (err) {
          setError(adbError, err.message || String(err));
        }
        return;
      }
      const moveBtn = e.target.closest("[data-adb-move]");
      if (moveBtn) {
        const to = window.prompt("移动到（完整路径）", adbFsPath?.value || "/sdcard");
        if (!to || !to.trim()) return;
        try {
          await adbFetch("/fs/move", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ serial: adbSelected, from: moveBtn.dataset.adbMove, to: to.trim() }),
          });
          toast("已移动");
          await loadFs(adbFsPath?.value || "/sdcard");
        } catch (err) {
          setError(adbError, err.message || String(err));
        }
        return;
      }
      const copyBtn = e.target.closest("[data-adb-copy]");
      if (copyBtn) {
        const to = window.prompt("复制到（完整路径）", `${adbFsPath?.value || "/sdcard"}/copy-${Date.now()}`);
        if (!to || !to.trim()) return;
        try {
          await adbFetch("/fs/copy", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ serial: adbSelected, from: copyBtn.dataset.adbCopy, to: to.trim() }),
          });
          toast("已复制");
          await loadFs(adbFsPath?.value || "/sdcard");
        } catch (err) {
          setError(adbError, err.message || String(err));
        }
        return;
      }
      const delBtn = e.target.closest("[data-adb-del]");
      if (delBtn) {
        const name = delBtn.dataset.adbDelName || delBtn.dataset.adbDel;
        if (!window.confirm(`确认删除「${name}」？此操作不可恢复。`)) return;
        try {
          await adbFetch("/fs/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ serial: adbSelected, path: delBtn.dataset.adbDel }),
          });
          toast("已删除");
          await loadFs(adbFsPath?.value || "/sdcard");
        } catch (err) {
          setError(adbError, err.message || String(err));
        }
      }
    });

    $("#adb-apk-file")?.addEventListener("change", (e) => {
      adbApkFile = e.target.files?.[0] || null;
      if (adbApkName) {
        adbApkName.textContent = adbApkFile
          ? `${adbApkFile.name}（${formatBytes(adbApkFile.size)}）`
          : "尚未选择 APK";
      }
      setApkButtonsEnabled(Boolean(adbApkFile));
    });
    $("#adb-apk-analyze")?.addEventListener("click", () =>
      analyzeSelectedApk().catch((err) => setError(adbError, err.message || String(err)))
    );
    $("#adb-apk-install-selected")?.addEventListener("click", async () => {
      try {
        await startInstall(targetSerials(true));
      } catch (err) {
        setError(adbError, err.message || String(err));
      }
    });
    $("#adb-apk-install-current")?.addEventListener("click", async () => {
      try {
        if (!adbSelected) throw new Error("请先选择当前设备");
        await startInstall([adbSelected]);
      } catch (err) {
        setError(adbError, err.message || String(err));
      }
    });

    $("#adb-apps-refresh")?.addEventListener("click", () =>
      loadApps().catch((err) => setError(adbError, err.message || String(err)))
    );
    async function runPermAction(action) {
      if (!adbPermPackage) throw new Error("请先在应用列表点「选中」");
      const permission = String($("#adb-perm-name")?.value || "").trim();
      if (!permission) throw new Error("请填写权限名");
      await adbFetch("/apps/permission", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serial: requireCurrentSerial(),
          packageName: adbPermPackage,
          action,
          permission,
        }),
      });
      toast(action === "grant" ? "已授予权限" : "已撤销权限");
    }
    $("#adb-perm-grant")?.addEventListener("click", () =>
      runPermAction("grant").catch((err) => setError(adbError, err.message || String(err)))
    );
    $("#adb-perm-revoke")?.addEventListener("click", () =>
      runPermAction("revoke").catch((err) => setError(adbError, err.message || String(err)))
    );

    $("#adb-proxy-refresh")?.addEventListener("click", () =>
      refreshProxy().catch((err) => setError(adbError, err.message || String(err)))
    );
    $("#adb-proxy-set")?.addEventListener("click", async () => {
      try {
        const data = await adbFetch("/network/proxy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            serial: requireCurrentSerial(),
            host: $("#adb-proxy-host")?.value || "",
            port: $("#adb-proxy-port")?.value || "",
          }),
        });
        toast(data.message || "代理已设置");
        await refreshProxy({ silent: true });
      } catch (err) {
        setError(adbError, err.message || String(err));
      }
    });
    $("#adb-proxy-clear")?.addEventListener("click", async () => {
      try {
        const data = await adbFetch("/network/proxy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ serial: requireCurrentSerial(), clear: true }),
        });
        toast(data.message || "代理已清除");
        if ($("#adb-proxy-host")) $("#adb-proxy-host").value = "";
        if ($("#adb-proxy-port")) $("#adb-proxy-port").value = "";
        await refreshProxy({ silent: true });
      } catch (err) {
        setError(adbError, err.message || String(err));
      }
    });
    $("#adb-fwd-refresh")?.addEventListener("click", () =>
      refreshForwards().catch((err) => setError(adbError, err.message || String(err)))
    );
    $("#adb-fwd-add")?.addEventListener("click", async () => {
      try {
        const data = await adbFetch("/network/forward", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            serial: requireCurrentSerial(),
            direction: $("#adb-fwd-dir")?.value || "forward",
            local: $("#adb-fwd-local")?.value || "",
            remote: $("#adb-fwd-remote")?.value || "",
          }),
        });
        toast(data.message || "已添加转发");
        await refreshForwards({ silent: true });
      } catch (err) {
        setError(adbError, err.message || String(err));
      }
    });
    $("#adb-fwd-remove")?.addEventListener("click", async () => {
      try {
        const data = await adbFetch("/network/forward", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            serial: requireCurrentSerial(),
            direction: $("#adb-fwd-dir")?.value || "forward",
            local: $("#adb-fwd-local")?.value || "",
            remove: true,
          }),
        });
        toast(data.message || "已移除");
        await refreshForwards({ silent: true });
      } catch (err) {
        setError(adbError, err.message || String(err));
      }
    });
    $("#adb-fwd-clear")?.addEventListener("click", async () => {
      try {
        if (!window.confirm("确认清除当前方向的全部端口转发？")) return;
        const data = await adbFetch("/network/forward", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            serial: requireCurrentSerial(),
            direction: $("#adb-fwd-dir")?.value || "forward",
            removeAll: true,
          }),
        });
        toast(data.message || "已清除");
        await refreshForwards({ silent: true });
      } catch (err) {
        setError(adbError, err.message || String(err));
      }
    });

    $("#adb-dev-refresh")?.addEventListener("click", () =>
      refreshDeveloper().catch((err) => setError(adbError, err.message || String(err)))
    );
    $("#adb-open-dev-page")?.addEventListener("click", () =>
      deviceControl("open_developer").catch((err) => setError(adbError, err.message || String(err)))
    );
    $$("[data-adb-dev]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          const key = btn.dataset.adbDev;
          const raw = btn.dataset.adbDevVal;
          const value = raw === "1" || raw === "true";
          const data = await adbFetch("/developer", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ serial: requireCurrentSerial(), key, value }),
          });
          toast(data.message || "已更新");
          await refreshDeveloper({ silent: true });
        } catch (err) {
          setError(adbError, err.message || String(err));
        }
      });
    });
    $("#adb-anim-apply")?.addEventListener("click", async () => {
      try {
        const data = await adbFetch("/developer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            serial: requireCurrentSerial(),
            key: "animation_scale_all",
            value: $("#adb-anim-scale")?.value || "1",
          }),
        });
        toast(data.message || "动画倍率已应用");
        await refreshDeveloper({ silent: true });
      } catch (err) {
        setError(adbError, err.message || String(err));
      }
    });
    $("#adb-apps-kind")?.addEventListener("change", () =>
      loadApps().catch((err) => setError(adbError, err.message || String(err)))
    );
    $("#adb-apps-filter")?.addEventListener("input", () => renderApps());
    adbAppsList?.addEventListener("click", async (e) => {
      const selectBtn = e.target.closest("[data-adb-app-select]");
      const openBtn = e.target.closest("[data-adb-app-open]");
      const infoBtn = e.target.closest("[data-adb-app-info]");
      const stopBtn = e.target.closest("[data-adb-app-stop]");
      const clearBtn = e.target.closest("[data-adb-app-clear]");
      const backupBtn = e.target.closest("[data-adb-app-backup]");
      const disableBtn = e.target.closest("[data-adb-app-disable]");
      const enableBtn = e.target.closest("[data-adb-app-enable]");
      const uninstallBtn = e.target.closest("[data-adb-app-uninstall]");
      try {
        if (selectBtn) {
          setPermTarget(selectBtn.dataset.adbAppSelect);
          toast("已选中应用");
          return;
        }
        if (openBtn) {
          await adbFetch("/apps/action", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              serial: adbSelected,
              packageName: openBtn.dataset.adbAppOpen,
              action: "open",
            }),
          });
          toast("已尝试打开应用");
          return;
        }
        if (infoBtn) {
          await showAppInfo(infoBtn.dataset.adbAppInfo);
          return;
        }
        if (stopBtn) {
          await adbFetch("/apps/action", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              serial: adbSelected,
              packageName: stopBtn.dataset.adbAppStop,
              action: "force-stop",
            }),
          });
          toast("已强制停止");
          return;
        }
        if (clearBtn) {
          if (!window.confirm(`确认清除 ${clearBtn.dataset.adbAppClear} 的数据？`)) return;
          await adbFetch("/apps/action", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              serial: adbSelected,
              packageName: clearBtn.dataset.adbAppClear,
              action: "clear",
            }),
          });
          toast("已清除数据");
          return;
        }
        if (backupBtn) {
          const data = await adbFetch("/apps/backup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              serial: adbSelected,
              packageName: backupBtn.dataset.adbAppBackup,
              async: true,
            }),
          });
          await trackJob(data.job);
          return;
        }
        if (disableBtn) {
          if (!window.confirm(`确认停用 ${disableBtn.dataset.adbAppDisable}？`)) return;
          await adbFetch("/apps/action", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              serial: adbSelected,
              packageName: disableBtn.dataset.adbAppDisable,
              action: "disable",
            }),
          });
          toast("已请求停用");
          return;
        }
        if (enableBtn) {
          await adbFetch("/apps/action", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              serial: adbSelected,
              packageName: enableBtn.dataset.adbAppEnable,
              action: "enable",
            }),
          });
          toast("已请求启用");
          return;
        }
        if (uninstallBtn) {
          if (!window.confirm(`确认卸载 ${uninstallBtn.dataset.adbAppUninstall}？此操作不可恢复。`)) return;
          await adbFetch("/apps/action", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              serial: adbSelected,
              packageName: uninstallBtn.dataset.adbAppUninstall,
              action: "uninstall",
            }),
          });
          toast("已卸载");
          await loadApps();
        }
      } catch (err) {
        setError(adbError, err.message || String(err));
      }
    });

    $("#adb-shot-selected")?.addEventListener("click", async () => {
      try {
        const serials = targetSerials(true);
        if (!serials.length) throw new Error("请选择设备");
        const data = await adbFetch("/media/screenshot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ serials }),
        });
        await trackJob(data.job);
      } catch (err) {
        setError(adbError, err.message || String(err));
      }
    });
    $("#adb-shot-current")?.addEventListener("click", async () => {
      try {
        if (!adbSelected) throw new Error("请先选择当前设备");
        const data = await adbFetch("/media/screenshot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ serials: [adbSelected] }),
        });
        await trackJob(data.job);
      } catch (err) {
        setError(adbError, err.message || String(err));
      }
    });
    $("#adb-record-current")?.addEventListener("click", async () => {
      try {
        if (!adbSelected) throw new Error("请先选择当前设备");
        const seconds = Number($("#adb-record-sec")?.value || 30);
        const data = await adbFetch("/media/record", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ serial: adbSelected, seconds }),
        });
        await trackJob(data.job);
      } catch (err) {
        setError(adbError, err.message || String(err));
      }
    });

    $("#adb-jobs-refresh")?.addEventListener("click", () =>
      refreshJobs().catch((err) => setError(adbError, err.message || String(err)))
    );
    adbJobsList?.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-adb-art-job]");
      if (!btn) return;
      try {
        await downloadArtifact(btn.dataset.adbArtJob, btn.dataset.adbArtName);
      } catch (err) {
        setError(adbError, err.message || String(err));
      }
    });

    $("#adb-snap-refresh")?.addEventListener("click", () =>
      loadSnapshot().catch((err) => setError(adbError, err.message || String(err)))
    );
    $("#adb-stay-on")?.addEventListener("click", () =>
      deviceControl("stay_awake_on").catch((err) => setError(adbError, err.message || String(err)))
    );
    $("#adb-stay-off")?.addEventListener("click", () =>
      deviceControl("stay_awake_off").catch((err) => setError(adbError, err.message || String(err)))
    );
    $("#adb-open-dev")?.addEventListener("click", () =>
      deviceControl("open_developer").catch((err) => setError(adbError, err.message || String(err)))
    );
    $("#adb-open-log")?.addEventListener("click", () =>
      deviceControl("open_logging").catch((err) => setError(adbError, err.message || String(err)))
    );
    $("#adb-usb-install")?.addEventListener("click", () =>
      deviceControl("enable_usb_install").catch((err) => setError(adbError, err.message || String(err)))
    );
    $("#adb-open-unknown")?.addEventListener("click", () =>
      deviceControl("open_install_unknown").catch((err) => setError(adbError, err.message || String(err)))
    );

    $("#adb-log-fetch")?.addEventListener("click", () =>
      fetchLogcat().catch((err) => setError(adbError, err.message || String(err)))
    );
    $("#adb-log-clear")?.addEventListener("click", async () => {
      try {
        const serial = requireCurrentSerial();
        if (!window.confirm("确认清空设备 logcat 缓冲？")) return;
        await adbFetch("/logcat/clear", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ serial }),
        });
        toast("已清空日志缓冲");
      } catch (err) {
        setError(adbError, err.message || String(err));
      }
    });
    $("#adb-log-copy")?.addEventListener("click", async () => {
      const text = $("#adb-log-out")?.textContent || "";
      if (!text || text === "尚未拉取") return;
      try {
        await navigator.clipboard.writeText(text);
        toast("日志已复制");
      } catch (_) {
        toast("复制失败");
      }
    });
    $("#adb-log-download")?.addEventListener("click", () => {
      const text = $("#adb-log-out")?.textContent || "";
      if (!text || text === "尚未拉取") return;
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `logcat-${adbSelected || "device"}-${Date.now()}.txt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });

    $("#adb-tap-run")?.addEventListener("click", async () => {
      try {
        await adbFetch("/input", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            serial: requireCurrentSerial(),
            action: "tap",
            x: Number($("#adb-tap-x")?.value),
            y: Number($("#adb-tap-y")?.value),
          }),
        });
        toast("已点击");
      } catch (err) {
        setError(adbError, err.message || String(err));
      }
    });
    $("#adb-swipe-run")?.addEventListener("click", async () => {
      try {
        await adbFetch("/input", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            serial: requireCurrentSerial(),
            action: "swipe",
            x1: Number($("#adb-swipe-x1")?.value),
            y1: Number($("#adb-swipe-y1")?.value),
            x2: Number($("#adb-swipe-x2")?.value),
            y2: Number($("#adb-swipe-y2")?.value),
            duration: Number($("#adb-swipe-ms")?.value || 300),
          }),
        });
        toast("已滑动");
      } catch (err) {
        setError(adbError, err.message || String(err));
      }
    });
    $$("[data-adb-key]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await adbFetch("/input", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              serial: requireCurrentSerial(),
              action: "key",
              key: btn.dataset.adbKey,
            }),
          });
          toast(`按键 ${btn.dataset.adbKey}`);
        } catch (err) {
          setError(adbError, err.message || String(err));
        }
      });
    });
    $("#adb-input-text-run")?.addEventListener("click", async () => {
      try {
        await adbFetch("/input", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            serial: requireCurrentSerial(),
            action: "text",
            text: $("#adb-input-text")?.value || "",
          }),
        });
        toast("已输入文本");
      } catch (err) {
        setError(adbError, err.message || String(err));
      }
    });
    $("#adb-clip-run")?.addEventListener("click", async () => {
      try {
        const data = await adbFetch("/clipboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            serial: requireCurrentSerial(),
            text: $("#adb-clip-text")?.value || "",
          }),
        });
        toast(data.note || "已推送剪贴板");
      } catch (err) {
        setError(adbError, err.message || String(err));
      }
    });

    const ua = navigator.userAgent || "";
    if (/Windows/i.test(ua)) {
      $("#adb-dl-win")?.classList.add("primary-btn");
      $("#adb-dl-win")?.classList.remove("secondary-btn");
    } else if (/Mac OS|Macintosh/i.test(ua)) {
      $("#adb-dl-mac")?.classList.add("primary-btn");
      $("#adb-dl-mac")?.classList.remove("secondary-btn");
    } else {
      $("#adb-dl-linux")?.classList.add("primary-btn");
      $("#adb-dl-linux")?.classList.remove("secondary-btn");
    }

    connectAdbBridge({ fromPoll: true }).catch(() => {});
  } catch (err) {
    console.error("adb tool init failed", err);
  }

  $$("[data-copy]").forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", async () => {
      const target = document.getElementById(btn.dataset.copy);
      const text = target?.textContent || "";
      if (!text || text === "—") return;
      try {
        await navigator.clipboard.writeText(text);
        toast("已复制");
      } catch (_) {
        toast("复制失败");
      }
    });
  });
  $$("[data-copy-value]").forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", async () => {
      const target = document.getElementById(btn.dataset.copyValue);
      const text = target?.value || "";
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        toast("已复制");
      } catch (_) {
        toast("复制失败");
      }
    });
  });
})();
