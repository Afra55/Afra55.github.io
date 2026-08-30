(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);

  const panel = $("#morse");
  if (!panel) return;

  /** 国际摩尔斯电码（ITU-R M.1677-1 常用字符集） */
  const CHAR_TO_MORSE = {
    A: ".-",
    B: "-...",
    C: "-.-.",
    D: "-..",
    E: ".",
    F: "..-.",
    G: "--.",
    H: "....",
    I: "..",
    J: ".---",
    K: "-.-",
    L: ".-..",
    M: "--",
    N: "-.",
    O: "---",
    P: ".--.",
    Q: "--.-",
    R: ".-.",
    S: "...",
    T: "-",
    U: "..-",
    V: "...-",
    W: ".--",
    X: "-..-",
    Y: "-.--",
    Z: "--..",
    0: "-----",
    1: ".----",
    2: "..---",
    3: "...--",
    4: "....-",
    5: ".....",
    6: "-....",
    7: "--...",
    8: "---..",
    9: "----.",
    ".": ".-.-.-",
    ",": "--..--",
    "?": "..--..",
    "'": ".----.",
    "!": "-.-.--",
    "/": "-..-.",
    "(": "-.--.",
    ")": "-.--.-",
    "&": ".-...",
    ":": "---...",
    ";": "-.-.-.",
    "=": "-...-",
    "+": ".-.-.",
    "-": "-....-",
    _: "..--.-",
    '"': ".-..-.",
    $: "...-..-",
    "@": ".--.-.",
  };

  const MORSE_TO_CHAR = Object.fromEntries(
    Object.entries(CHAR_TO_MORSE).map(([ch, code]) => [code, ch])
  );

  const plainEl = $("#morse-plain");
  const codeEl = $("#morse-code");
  const metaEl = $("#morse-meta");
  const errorEl = $("#morse-error");
  const usePrettyEl = $("#morse-pretty");

  function setError(msg) {
    if (!errorEl) return;
    errorEl.hidden = !msg;
    errorEl.textContent = msg || "";
  }

  function displaySymbol(ch) {
    if (!usePrettyEl?.checked) return ch;
    return ch === "." ? "·" : ch;
  }

  function normalizeMorseInput(raw) {
    return String(raw ?? "")
      .replace(/[·•]/g, ".")
      .replace(/[−—–]/g, "-")
      .replace(/\t/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /** @returns {{ morse: string, skipped: string[], words: number, letters: number }} */
  function encodeText(text, { pretty = false } = {}) {
    const skipped = [];
    let letters = 0;
    const words = String(text ?? "")
      .split(/\s+/u)
      .filter(Boolean)
      .map((word) => {
        const parts = [];
        for (const ch of word) {
          const upper = ch.toUpperCase();
          const code = CHAR_TO_MORSE[upper];
          if (!code) {
            if (!skipped.includes(ch)) skipped.push(ch);
            continue;
          }
          letters += 1;
          const out = pretty ? code.replace(/\./g, "·") : code;
          parts.push(out);
        }
        return parts.join(" ");
      });
    return {
      morse: words.join(" / "),
      skipped,
      words: words.length,
      letters,
    };
  }

  /** @returns {{ text: string, unknown: string[] }} */
  function decodeMorse(raw) {
    const normalized = normalizeMorseInput(raw);
    if (!normalized) return { text: "", unknown: [] };
    const unknown = [];
    const words = normalized.split(/\s*\/\s*|\s{2,}/).filter(Boolean);
    const outWords = words.map((word) => {
      const letters = word.split(/\s+/).filter(Boolean);
      return letters
        .map((token) => {
          if (!/^[.\-]+$/u.test(token)) {
            unknown.push(token);
            return "";
          }
          const ch = MORSE_TO_CHAR[token];
          if (!ch) {
            unknown.push(token);
            return "";
          }
          return ch;
        })
        .join("");
    });
    return { text: outWords.join(" "), unknown };
  }

  function updateMetaFromEncode(result) {
    if (!metaEl) return;
    let msg = `已编码：${result.letters} 个字符，${result.words} 个单词`;
    if (result.skipped.length) {
      msg += `；未支持字符已跳过：${result.skipped.map((c) => JSON.stringify(c)).join(" ")}`;
    }
    metaEl.textContent = msg;
  }

  function updateMetaFromDecode(result) {
    if (!metaEl) return;
    let msg = `已解码：${result.text.length} 字符`;
    if (result.unknown.length) {
      msg += `；无法识别片段：${result.unknown.slice(0, 8).join(" ")}${result.unknown.length > 8 ? " …" : ""}`;
    }
    metaEl.textContent = msg;
  }

  function onEncode() {
    try {
      const pretty = !!usePrettyEl?.checked;
      const result = encodeText(plainEl?.value ?? "", { pretty });
      if (codeEl) codeEl.value = result.morse;
      updateMetaFromEncode(result);
      if (result.skipped.length && !result.letters) {
        setError("文本中没有可编码的拉丁字母/数字/标点；中文请先用拼音或英文");
      } else {
        setError("");
      }
    } catch (e) {
      setError(e?.message || "编码失败");
    }
  }

  function onDecode() {
    try {
      const result = decodeMorse(codeEl?.value ?? "");
      if (plainEl) plainEl.value = result.text;
      updateMetaFromDecode(result);
      setError(result.unknown.length && !result.text ? "无法识别电码，请检查 ·/- 与空格" : "");
    } catch (e) {
      setError(e?.message || "解码失败");
    }
  }

  function swapFields() {
    if (!plainEl || !codeEl) return;
    const t = plainEl.value;
    plainEl.value = codeEl.value;
    codeEl.value = t;
    setError("");
    if (metaEl) metaEl.textContent = "";
  }

  function clearFields() {
    if (plainEl) plainEl.value = "";
    if (codeEl) codeEl.value = "";
    if (metaEl) metaEl.textContent = "";
    setError("");
  }

  $("#morse-encode")?.addEventListener("click", onEncode);
  $("#morse-decode")?.addEventListener("click", onDecode);
  $("#morse-swap")?.addEventListener("click", swapFields);
  $("#morse-clear")?.addEventListener("click", clearFields);
  usePrettyEl?.addEventListener("change", () => {
    if (codeEl?.value.trim()) onEncode();
  });

  const selfTest = () => {
    const samples = [
      ["SOS", "... --- ..."],
      ["HELLO WORLD", ".... . .-.. .-.. --- / .-- --- .-. .-.. -.."],
      ["E", "."],
      ["", ""],
    ];
    for (const [text, morse] of samples) {
      const enc = encodeText(text).morse;
      if (enc !== morse) throw new Error(`encode "${text}": got "${enc}" want "${morse}"`);
      const dec = decodeMorse(morse).text;
      if (dec !== text) throw new Error(`decode "${morse}": got "${dec}" want "${text}"`);
    }
    const pretty = encodeText("SOS", { pretty: true }).morse;
    if (pretty !== "··· --- ···") throw new Error(`pretty SOS failed: ${pretty}`);
    if (decodeMorse("··· --- ···").text !== "SOS") throw new Error("pretty decode failed");
    return { ok: true };
  };

  window.MorseSelfTest = { encodeText, decodeMorse, CHAR_TO_MORSE, run: selfTest };

  try {
    selfTest();
  } catch (e) {
    console.error("morse self-test failed", e);
  }
})();
