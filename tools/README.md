# DevTools

实用小工具集合（纯前端，数据不离开浏览器）。

在线地址：[https://afra55.github.io/tools/](https://afra55.github.io/tools/)

## 已实现

- 时间戳转换 / 时间差计算
- AHEX 颜色调节、HEX / RGB / HSL 互转
- Base64、图片转 Base64（预览）
- JSON 格式化、YAML ⇄ JSON
- 正则测试、文本 Diff
- URL 编解码、Query / JWT 解析
- UUID 生成、MD5 / SHA-256
- 文本处理、二维码生成/识别、代码卡片分享图、Cron、单位换算

默认按「时间 / 颜色 / 编码 / 数据 / 文本 / 其他」分组排列。可拖拽顶部导航手动排序，顺序会保存在浏览器本地；也可一键恢复默认排序。

## 本地预览

```bash
python3 -m http.server 8080 --directory .
```

打开 `http://localhost:8080/`。

## 测试

```bash
node tools/test/pure.test.js
# 可选浏览器冒烟（需静态服务）
# python3 -m http.server 8080 --directory tools
# 打开 /test/smoke.html
```

## 说明

目录自包含，后续可整体迁出为独立仓库。
