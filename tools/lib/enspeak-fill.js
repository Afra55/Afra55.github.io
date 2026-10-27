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

  /**
   * 变体中文：
   * - 有 fillZh：填入省略号或接在意图句后
   * - 无 fillZh：只显示意图句（不把英文硬塞进括号）
   */
  function variantZhLine(frameZh, fillEn, fillZh) {
    const zh = String(frameZh || "").trim();
    const zf = String(fillZh || "").trim();
    if (!zh) return zf || "";
    if (!zf) {
      // 无中文槽位：保留意图；省略号可留作提示
      return zh;
    }
    if (/……|\.\.\.|…/.test(zh)) {
      return zh.replace(/……|\.\.\.|…/g, zf).replace(/\s{2,}/g, " ").trim();
    }
    if (zh.includes(zf)) return zh;
    // 句末标点前插入槽位意：最近怎么样？ + 最近这段时间 → 最近怎么样（最近这段时间）？
    const m = zh.match(/^(.*?)([？?。！!]*)$/);
    if (m) return `${m[1]}（${zf}）${m[2] || ""}`;
    return `${zh}（${zf}）`;
  }

  return { fillEnTemplate, variantZhLine, tidyEn };
});
