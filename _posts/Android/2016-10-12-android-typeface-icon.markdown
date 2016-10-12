---
layout: post
title:  "Android 使用Typeface 设置 icon"
date:   2016-2-22 11:26
categories: Android
comments: true
description: Android 使用Typeface 设置 icon
---

* content
{:toc}

## 在 https://icomoon.io/ 下载所需的 ttf 字体文件；

## 存放字体文件，可以在 assets 目录下；

## 设置 TextView 的字体 textView.setTypeface(Typeface.createFromAsset(context.getAssets(), "fonts/" + TypeFaceName));

## 设置Icon 例如：textView.setText("\ue913");  e913 这个规定可以在 https://icomoon.io/ 打包字体文件时获取得到。