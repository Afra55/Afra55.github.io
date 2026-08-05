---
layout: page
title: 永恒世界
icon: glyphicon-book
comments: false
permalink: /eternum/
---

* content
{:toc}

# 《Eternum》剧情导读

本栏目单独收录 [EternumVN Wiki](https://eternumvn.fandom.com/) 剧情摘要的简体中文译本（含插图）。与博客其他技术/生活文章分开存放。

游戏由 Caribdis 制作，成人向选择式视觉小说；下文为维基梗概翻译，不是逐句游戏台词。

## 章节目录

<ol class="eternum-chapter-list">
{% assign eternum_posts = site.categories.Eternum | sort: 'date' %}
{% for post in eternum_posts %}
  <li>
    <a href="{{ post.url | prepend: site.baseurl }}">{{ post.title }}</a>
    <span class="text-muted"> · {{ post.date | date: "%Y-%m-%d" }}</span>
  </li>
{% endfor %}
</ol>

{% if site.categories.Eternum.size == 0 %}
<p>暂无文章。</p>
{% endif %}
