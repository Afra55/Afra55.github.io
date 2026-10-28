/**
 * 日常开口：槽位填充 / 变体中文（Node 测例 + 浏览器共用）
 * browser: globalThis.DevToolsEnspeakFill
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.DevToolsEnspeakFill = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function tidyEn(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .replace(/\s+([,.!?;:…])/g, "$1")
      .replace(/([([{])\s+/g, "$1")
      .replace(/\s+([)\]}])/g, "$1")
      .replace(/\s+'/g, "'")
      // 槽位自带 ?/! 时，架子末尾的 . 会叠成 ?. / !.（保留 ... 省略号）
      .replace(/\?\.+/g, "?")
      .replace(/!\.+/g, "!")
      .replace(/\?{2,}/g, "?")
      .replace(/!{2,}/g, "!")
      .replace(/\.{4,}/g, "...")
      .trim();
  }

  /**
   * 替换 {slot}；贴着单词的槽位自动补空格，避免 goingwith / thinkfor 粘连。
   */
  function fillEnTemplate(text, vars) {
    const map = vars && typeof vars === "object" ? vars : {};
    let out = String(text || "").replace(/\{([a-z0-9_]+)\}/gi, (match, key, offset, full) => {
      if (!Object.prototype.hasOwnProperty.call(map, key)) return match;
      let v = map[key] == null ? "" : String(map[key]);
      v = v.trim();
      if (!v) return "";
      const before = offset > 0 ? full[offset - 1] : "";
      const after = full[offset + match.length] || "";
      if (before && /[A-Za-z0-9']/.test(before) && /^[A-Za-z0-9']/.test(v)) v = ` ${v}`;
      if (after && /[A-Za-z0-9']/.test(after) && /[A-Za-z0-9']$/.test(v)) v = `${v} `;
      return v;
    });
    return tidyEn(out);
  }

  function tidyZh(text) {
    return String(text || "")
      .replace(/\s{2,}/g, " ")
      .replace(/(什么){2,}/g, "什么")
      .replace(/(一下){2,}/g, "一下")
      .replace(/你你/g, "你")
      .replace(/我我/g, "我")
      .replace(/？{2,}/g, "？")
      .replace(/！{2,}/g, "！")
      .trim();
  }

  /**
   * 变体中文：
   * - 有 fillZh：填入省略号，或接在意图句后
   * - 无 fillZh：只显示意图句（不把英文硬塞进括号）
   * - fillZh 以 ，/——/！ 开头：当作尾巴拼上，不用括号
   */
  function variantZhLine(frameZh, fillEn, fillZh) {
    const zh = String(frameZh || "").trim();
    const zf = String(fillZh || "").trim();
    if (!zh) return tidyZh(zf || "");
    if (!zf) return tidyZh(zh);

    if (/……|\.\.\.|…/.test(zh)) {
      return tidyZh(zh.replace(/……|\.\.\.|…/g, zf));
    }
    if (zh.includes(zf)) return tidyZh(zh);

    const m = zh.match(/^(.*?)([？?。！!]*)$/);
    if (!m) return tidyZh(`${zh}（${zf}）`);
    const stem = m[1];
    const punct = m[2] || "";

    // 尾巴型：最近怎么样？ + ，你呢 → 最近怎么样，你呢？
    if (/^[，,！!]/.test(zf) || zf.startsWith("——") || zf.startsWith("—")) {
      let tail = zf;
      let end = punct;
      if (/[？?。！!]$/.test(tail)) {
        end = "";
      }
      return tidyZh(`${stem}${tail}${end}`);
    }

    const inner = zf.replace(/[？?。！!]+$/g, "");
    return tidyZh(`${stem}（${inner}）${punct}`);
  }

  return { fillEnTemplate, variantZhLine, tidyEn, tidyZh };
});
