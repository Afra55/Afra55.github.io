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
