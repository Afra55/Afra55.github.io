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

  // ---- Diff ----
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
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

  // Rebind copy buttons added dynamically in HTML for new panels
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
