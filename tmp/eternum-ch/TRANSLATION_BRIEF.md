# Eternum 章节简体中文翻译任务说明

## 目标
按已合入的第一章体例，把 EternumVN Wiki 对应 Chapter 的**完整剧情摘要**译成简体中文博客文，并插入该章全部剧情插图。

## 范本（必须对齐）
阅读：`/workspace/_posts/Life/2026-8-4-eternum-chapter-1-chinese-plot.markdown`

要点：
1. YAML front matter：`layout: post`，`categories: Life`，`comments: true`，中文 title/description
2. 开头 `* content` + `{:toc}`
3. 说明来源是维基剧情摘要（非逐句游戏台词），成人向，主角 Orion 18 岁
4. 用 `## 中文小标题` 对应原文每个 `== Section ==`（可意译标题，但顺序与覆盖完整）
5. 插图格式严格：
```html
<p align="center">
  <img src="{{ site.baseurl }}/blog_picture/eternum-chN.resources/LOCAL_FILENAME.jpg" alt="中文说明" width="640">
</p>

*图注。*
```
6. `LOCAL_FILENAME` **必须**使用 manifest 里的 `local` 字段，不可臆造
7. 角色首次出现：`中文名（English）`；专名附英文
8. 分支选项写清「可选择…」；成人场景用剧情向简述，不删情节
9. 文末「译注与来源」链到对应 wiki 页
10. **完整覆盖**：英文摘要每个情节点都要译到，不要写成过度缩略的梗概；可写成顺畅中文，但信息量要对齐第一章完成度

## 输入文件
- 原文：`/workspace/tmp/eternum-ch/chapter_N.wiki`
- 图片清单：`/workspace/tmp/eternum-ch/manifest_chN.json`（`images` 数组按文中出现顺序）
- 图片目录：`/workspace/blog_picture/eternum-chN.resources/`

## 输出文件
`/workspace/_posts/Life/2026-8-5-eternum-chapter-N-chinese-plot.markdown`
（N 为章节号；若同日多章，时间可递增：ch2 10:00, ch3 11:00 …）

## 完成后自检
- 文中引用的每张图文件真实存在
- manifest 中每张图至少出现一次（除非原文 File 重复）
- 原文每个一级/二级情节段落有对应中文
