"use strict";

/**
 * 日期提醒全屏层必须常驻 CSS（shell-overlays），不可只靠懒加载 panels/dateremind.css。
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const shellCss = fs.readFileSync(path.join(root, "styles/shell-overlays.css"), "utf8");
const panelCss = fs.readFileSync(path.join(root, "styles/panels/dateremind.css"), "utf8");
const appJs = fs.readFileSync(path.join(root, "app.js"), "utf8");
const drJs = fs.readFileSync(path.join(root, "dateremind.js"), "utf8");

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
}

t("index 常驻引入 shell-overlays.css", () => {
  assert.ok(/styles\/shell-overlays\.css\?v=/.test(indexHtml));
});

t("shell-overlays 含 fixed 全屏层", () => {
  assert.ok(/\.dateremind-fs\s*\{[\s\S]*?position:\s*fixed/.test(shellCss));
  assert.ok(shellCss.includes("z-index: 100045"));
  assert.ok(/\.dateremind-fs\[hidden\]/.test(shellCss));
});

t("面板 CSS 不再是全屏层唯一来源", () => {
  assert.ok(!/\.dateremind-fs\s*\{[\s\S]*?position:\s*fixed/.test(panelCss));
  assert.ok(panelCss.includes("shell-overlays.css"));
});

t("进站提醒先 ensure 面板再 checkOnVisit", () => {
  const fn = appJs.slice(
    appJs.indexOf("function scheduleDateremindReminders"),
    appJs.indexOf("function scheduleMemoClipboardWatch")
  );
  assert.ok(fn.includes('DevToolsPanels?.ensure?.("dateremind")'));
  assert.ok(fn.includes("checkOnVisit"));
});

t("弹出前有 CSS 兜底注入", () => {
  assert.ok(drJs.includes("ensureFullscreenCss"));
  assert.ok(drJs.includes("shell-overlays.css"));
});

console.log(`dateremind-fs-overlay.test.js: ${n} passed`);
