# DevTools

实用小工具集合（纯前端，数据不离开浏览器）。

在线地址（GitHub Pages）：[https://afra55.github.io/tools/](https://afra55.github.io/tools/)

## 已实现

- **时间戳转换**：秒 / 毫秒时间戳 ⇄ `YYYY-MM-DD HH:mm:ss`，支持本地时区与 UTC
- **AHEX 颜色**：解析 `#AARRGGBB`（如 `#FF000000`），预览颜色、透明度与 RGB 通道

## 预留

页面底部已预留扩展位，后续可继续加入 Base64、JSON、正则等工具。

## 本地预览

直接用浏览器打开 `index.html`，或任意静态服务器：

```bash
python3 -m http.server 8080 --directory .
```

然后访问 `http://localhost:8080/`。

## 说明

当前托管在 [Afra55.github.io](https://github.com/Afra55/Afra55.github.io) 的 `/tools` 目录下，目录自包含，后续如需拆成独立仓库可直接迁出本目录。
