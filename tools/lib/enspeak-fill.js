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
   * @param {string} text
   * @param {Record<string, string|number|null|undefined>} vars
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
      // 前一字符是词字符，且填入以词字符开头 → 补空格
      if (before && /[A-Za-z0-9']/.test(before) && /^[A-Za-z0-9']/.test(v)) v = ` ${v}`;
      // 后一字符是词字符，且填入以词字符结尾 → 补空格
      if (after && /[A-Za-z0-9']/.test(after) && /[A-Za-z0-9']$/.test(v)) v = `${v} `;
      // 前一字符是词字符，填入以逗号等开场 → 不强制空格（Hi, there）
      return v;
    });
    return tidyEn(out);
  }

  /**
   * 变体中文行：优先用架子 zh 里的省略号换成填入；否则「中文（填入）」
   */
  function variantZhLine(frameZh, fillEn) {
    const zh = String(frameZh || "").trim();
    const fill = String(fillEn || "").trim();
    if (!zh) return fill ? `（${fill}）` : "";
    if (!fill) return zh;
    if (/……|\.\.\.|…/.test(zh)) {
      const mid = /^[A-Za-z0-9]/.test(fill) ? ` ${fill}` : fill;
      return zh.replace(/……|\.\.\.|…/g, mid).replace(/\s{2,}/g, " ").trim();
    }
    // 已含填入则不再叠
    if (zh.includes(fill)) return zh;
    return `${zh}（${fill}）`;
  }

  return { fillEnTemplate, variantZhLine, tidyEn };
});
