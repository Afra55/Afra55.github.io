#!/usr/bin/env node
"use strict";

/** 从 JS 源码中提取 const NAME = <literal> 的值（仅支持数组/对象字面量） */
function extractJsConst(source, name) {
  const re = new RegExp(`const\\s+${name}\\s*=\\s*`);
  const start = source.search(re);
  if (start < 0) throw new Error(`未找到 const ${name}`);
  let i = source.indexOf("=", start) + 1;
  while (source[i] === " " || source[i] === "\n" || source[i] === "\t") i += 1;
  const open = source[i];
  if (open !== "[" && open !== "{") {
    throw new Error(`const ${name} 不是数组/对象字面量`);
  }
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  for (let k = i; k < source.length; k += 1) {
    const c = source[k];
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      k += 1;
      while (k < source.length && source[k] !== q) {
        if (source[k] === "\\") k += 1;
        k += 1;
      }
      continue;
    }
    if (c === open) depth += 1;
    if (c === close) {
      depth -= 1;
      if (depth === 0) {
        // eslint-disable-next-line no-new-func
        return new Function(`return (${source.slice(i, k + 1)})`)();
      }
    }
  }
  throw new Error(`const ${name} 字面量未闭合`);
}

function extractJsSet(source, name) {
  const re = new RegExp(`const\\s+${name}\\s*=\\s*new\\s+Set\\s*\\(`);
  const start = source.search(re);
  if (start < 0) throw new Error(`未找到 const ${name} = new Set(...)`);
  let i = source.indexOf("(", start) + 1;
  while (source[i] === " " || source[i] === "\n" || source[i] === "\t") i += 1;
  if (source[i] !== "[") throw new Error(`const ${name} 的 Set 参数不是数组`);
  const open = "[";
  const close = "]";
  let depth = 0;
  for (let k = i; k < source.length; k += 1) {
    const c = source[k];
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      k += 1;
      while (k < source.length && source[k] !== q) {
        if (source[k] === "\\") k += 1;
        k += 1;
      }
      continue;
    }
    if (c === open) depth += 1;
    if (c === close) {
      depth -= 1;
      if (depth === 0) {
        // eslint-disable-next-line no-new-func
        const arr = new Function(`return (${source.slice(i, k + 1)})`)();
        return new Set(arr);
      }
    }
  }
  throw new Error(`const ${name} Set 数组未闭合`);
}

module.exports = { extractJsConst, extractJsSet };
