#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const TOOLS = path.resolve(__dirname, "..");
const STYLE = path.join(TOOLS, "style.css");
const NAV = path.join(TOOLS, "workspace-nav.css");

const REQUIRED = [
  {
    label: "desktop app-layout grid",
    test: (css) => /grid-template-columns:\s*13\.5rem\s+minmax\(0,\s*1fr\)/.test(css),
  },
  {
    label: "mobile header collapse",
    test: (css) => /@media\s*\(max-width:\s*900px\)/.test(css) && /\.header-action-collapse[\s\S]*display:\s*none/.test(css),
  },
  {
    label: "mobile header more menu",
    test: (css) => /\.header-more-wrap[\s\S]*display:\s*block/.test(css),
  },
  {
    label: "mobile site-header padding",
    test: (css) => /@media\s*\(max-width:\s*700px\)/.test(css) && /\.site-header/.test(css),
  },
  {
    label: "mobile panel padding",
    test: (css) => /@media\s*\(max-width:\s*600px\)/.test(css) && /\.panel-head/.test(css),
  },
  {
    label: "reduced motion nav-bar",
    test: (css) => /prefers-reduced-motion/.test(css) && /\.nav-bar/.test(css),
  },
  {
    label: "shell layout marker",
    test: (css) => /shell-layout-protected/.test(css),
  },
];

function main() {
  const style = fs.readFileSync(STYLE, "utf8");
  const nav = fs.existsSync(NAV) ? fs.readFileSync(NAV, "utf8") : "";
  const combined = `${style}\n${nav}`;
  const missing = [];

  for (const item of REQUIRED) {
    if (!item.test(combined)) missing.push(item.label);
  }

  if (missing.length) {
    console.error("audit-shell-css FAILED — missing:");
    missing.forEach((m) => console.error(`  - ${m}`));
    process.exit(1);
  }

  console.log("audit-shell-css ok");
}

main();
