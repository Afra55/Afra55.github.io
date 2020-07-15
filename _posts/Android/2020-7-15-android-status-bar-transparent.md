---
layout: post
title:  "Android Status Bar 透明"
date:   2020-7-15 15:00
categories: Android
comments: true
description: Android Status Bar 透明
---

* content
{:toc}

## 状态栏透明

```
fun transparentStatusBar(window: Window) {
    try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS)
            window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS)
            val option =
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            val vis = window.decorView.systemUiVisibility
            window.decorView.systemUiVisibility = option or vis
            window.statusBarColor = Color.TRANSPARENT
        } else {
            window.addFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS)
        }
    } catch (e: Exception) {
    }
}
```
## 状态栏文字深色亮色切换
```
fun setStatusBarLightMode(
    window: Window,
    isLightMode: Boolean
) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        val decorView = window.decorView
        var vis = decorView.systemUiVisibility
        vis = if (isLightMode) {
            vis or View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
        } else {
            vis and View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR.inv()
        }
        decorView.systemUiVisibility = vis
    }
}
```
