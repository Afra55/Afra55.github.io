---
layout: post
title:  "Java 按中文拼音排序"
date:   2017-06-21 14:07
categories: Java
comments: true
description: Sorts according to Chinese Pinyin！
---

* content
{:toc}

## 本文

[http://afra55.github.io/2017/05/05/get_android_device_sn/](http://afra55.github.io/2017/05/05/get_android_device_sn/)

## 前情提要

在中国，经常需要按照拼音顺序进行排序，已满足各种需求。

## 排序代码

    Collections.sort(info, new Comparator<NormalChildListForSearchBean>(){
                public int compare(NormalChildListForSearchBean o1, NormalChildListForSearchBean o2) {
                    Comparator cmp = (Collator.getInstance(Locale.CHINA));
                    return cmp.compare(o1.getUserNamePinyin(), o2.getUserNamePinyin());
        }
    });

