(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);

  const panel = $("#xorenc");
  if (!panel) return;

  const plainEl = $("#xor-plain");
  const cipherEl = $("#xor-cipher");
  const keyHalfEl = $("#xor-key-half");
  const keyAllEl = $("#xor-key-all");
  const metaEl = $("#xor-meta");
  const errorEl = $("#xor-error");
  const fileIn = $("#xor-file-in");
  const fileMetaEl = $("#xor-file-meta");

  function setError(msg) {
    if (!errorEl) return;
    errorEl.hidden = !msg;
    errorEl.textContent = msg || "";
  }

  function clampKey(raw, fallback) {
    const n = Number.parseInt(String(raw ?? "").trim(), 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(255, Math.max(0, n & 0xff));
  }

  function readKeys() {
    return {
      keyHalf: clampKey(keyHalfEl?.value, 4),
      keyAll: clampKey(keyAllEl?.value, 7),
    };
  }

  /** @param {Uint8Array|ArrayBuffer} input */
  function xorCryptBytes(input, keyHalf, keyAll, decrypt = false) {
    const src = input instanceof Uint8Array ? input : new Uint8Array(input);
    const arr = new Uint8Array(src);
    const size = arr.length;
    const half = Math.floor(size / 2);
    if (!decrypt) {
      for (let v = 0; v < half; v++) arr[v] ^= keyHalf;
      for (let v = 0; v < size; v++) arr[v] ^= keyAll;
    } else {
      for (let v = 0; v < size; v++) arr[v] ^= keyAll;
      for (let v = 0; v < half; v++) arr[v] ^= keyHalf;
    }
    return arr;
  }

  function bytesToText(bytes) {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }

  function textToBytes(str) {
    return new TextEncoder().encode(str);
  }

  function encryptText(str, keyHalf, keyAll) {
    return bytesToText(xorCryptBytes(textToBytes(str), keyHalf, keyAll, false));
  }

  function decryptText(str, keyHalf, keyAll) {
    return bytesToText(xorCryptBytes(textToBytes(str), keyHalf, keyAll, true));
  }

  function updateMeta(kind, byteLen) {
    if (!metaEl) return;
    const { keyHalf, keyAll } = readKeys();
    metaEl.textContent = `${kind} · UTF-8 ${byteLen} 字节 · 前半 XOR=${keyHalf}，全量 XOR=${keyAll}`;
  }

  function onEncryptText() {
    try {
      const { keyHalf, keyAll } = readKeys();
      const src = plainEl?.value ?? "";
      const out = encryptText(src, keyHalf, keyAll);
      if (cipherEl) cipherEl.value = out;
      updateMeta("已加密", textToBytes(src).length);
      setError("");
    } catch (e) {
      setError(e?.message || "加密失败");
    }
  }

  function onDecryptText() {
    try {
      const { keyHalf, keyAll } = readKeys();
      const src = cipherEl?.value ?? "";
      const out = decryptText(src, keyHalf, keyAll);
      if (plainEl) plainEl.value = out;
      updateMeta("已解密", textToBytes(src).length);
      setError("");
    } catch (e) {
      setError(e?.message || "解密失败");
    }
  }

  function swapText() {
    if (!plainEl || !cipherEl) return;
    const t = plainEl.value;
    plainEl.value = cipherEl.value;
    cipherEl.value = t;
    setError("");
  }

  function clearText() {
    if (plainEl) plainEl.value = "";
    if (cipherEl) cipherEl.value = "";
    if (metaEl) metaEl.textContent = "";
    setError("");
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
  }

  function fileBaseName(name) {
    const i = name.lastIndexOf(".");
    return i > 0 ? name.slice(0, i) : name;
  }

  async function readFileBytes(file) {
    return new Uint8Array(await file.arrayBuffer());
  }

  async function onEncryptFile() {
    const file = fileIn?.files?.[0];
    if (!file) {
      setError("请先选择要加密的文件");
      return;
    }
    try {
      const { keyHalf, keyAll } = readKeys();
      const bytes = await readFileBytes(file);
      const out = xorCryptBytes(bytes, keyHalf, keyAll, false);
      downloadBlob(new Blob([out], { type: "application/octet-stream" }), `${fileBaseName(file.name)}.xorenc`);
      if (fileMetaEl) {
        fileMetaEl.textContent = `已加密下载：${file.name}（${bytes.length} 字节 → ${file.name}.xorenc）`;
      }
      setError("");
    } catch (e) {
      setError(e?.message || "文件加密失败");
    }
  }

  async function onDecryptFile() {
    const file = fileIn?.files?.[0];
    if (!file) {
      setError("请先选择要解密的文件");
      return;
    }
    try {
      const { keyHalf, keyAll } = readKeys();
      const bytes = await readFileBytes(file);
      const out = xorCryptBytes(bytes, keyHalf, keyAll, true);
      let name = file.name;
      if (/\.xorenc$/i.test(name)) name = name.replace(/\.xorenc$/i, "");
      else name = `${fileBaseName(name)}.dec`;
      downloadBlob(new Blob([out], { type: "application/octet-stream" }), name);
      if (fileMetaEl) {
        fileMetaEl.textContent = `已解密下载：${file.name}（${bytes.length} 字节 → ${name}）`;
      }
      setError("");
    } catch (e) {
      setError(e?.message || "文件解密失败");
    }
  }

  $("#xor-encrypt")?.addEventListener("click", onEncryptText);
  $("#xor-decrypt")?.addEventListener("click", onDecryptText);
  $("#xor-swap")?.addEventListener("click", swapText);
  $("#xor-clear")?.addEventListener("click", clearText);
  $("#xor-file-encrypt")?.addEventListener("click", () => onEncryptFile().catch((e) => setError(e.message)));
  $("#xor-file-decrypt")?.addEventListener("click", () => onDecryptFile().catch((e) => setError(e.message)));
  fileIn?.addEventListener("change", () => {
    const f = fileIn.files?.[0];
    if (fileMetaEl) fileMetaEl.textContent = f ? `已选择：${f.name}（${f.size} 字节）` : "";
  });

  // ---- 自测（控制台可调用 XorEncSelfTest.run()） ----
  const selfTest = () => {
    const samples = ["你好吗?", "Hello XOR", "abc", "a", ""];
    for (const s of samples) {
      const enc = encryptText(s, 4, 7);
      const dec = decryptText(enc, 4, 7);
      if (dec !== s) throw new Error(`roundtrip failed: "${s}" -> "${enc}" -> "${dec}"`);
    }
    const fileSample = new Uint8Array([0, 1, 2, 3, 4, 5, 255]);
    const encB = xorCryptBytes(fileSample, 4, 7, false);
    const decB = xorCryptBytes(encB, 4, 7, true);
    if (decB.some((b, i) => b !== fileSample[i])) throw new Error("file bytes roundtrip failed");
    const kotlinSample = encryptText("你好吗?", 4, 7);
    return { ok: true, kotlinSample };
  };

  window.XorEncSelfTest = { encryptText, decryptText, xorCryptBytes, run: selfTest };

  try {
    const t = selfTest();
    if (t.kotlinSample !== "羣榺◐8") {
      console.warn("xorenc: Kotlin sample mismatch", t.kotlinSample);
    }
  } catch (e) {
    console.error("xorenc self-test failed", e);
  }
})();
