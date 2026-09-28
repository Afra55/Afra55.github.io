# v2g-suite 源分片

运行时仍加载拼接后的 `../v2g-suite.js`（Pages 无需构建）。

| 分片 | 内容 |
|------|------|
| `00-prelude.js` | IIFE 头、依赖注入 |
| `10-shared-encode.js` | 黑盒/gifski/FFmpeg 编码核 |
| `20-v2g-ui.js` | 视频转 GIF 面板 |
| `30-vsplit.js` | 视频切片 |
| `40-vbb.js` | 黑盒批处理 |
| `99-epilogue.js` | catch / IIFE 尾 |

```bash
# 改分片后重新拼接
node tools/scripts/build-v2g-suite.cjs

# 校验分片与产物一致
node tools/scripts/build-v2g-suite.cjs --check
node tools/scripts/verify-arch.cjs
```

若曾直接热修了 `v2g-suite.js`：`node tools/scripts/build-v2g-suite.cjs --split` 再核对 diff。
