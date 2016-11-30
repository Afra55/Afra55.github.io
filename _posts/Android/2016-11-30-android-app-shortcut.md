---
layout: post
title:  "Android App 快捷方式之 Android 版本的 3D Touch"
date:   2016-11-30 15:07
categories: Android
comments: true
description: Android版本的 3D Touch
---

* content
{:toc}

## 创建一个静态的快捷方式

1. 创建一个新的资源文件 (res/xml/shortcuts.xml) 。
2. 在 shortcuts.xml 文件中添加 `<shortcuts>` 根节点元素, 这个节点可以包含一些列 `<shortcut>` 元素， 每个`<shortcut>` 节点都包含一个 静态快捷方式的信息（icon，描述，对应的 intent 意图）。

		<?xml version="1.0" encoding="utf-8"?>
		<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">
		    <shortcut
		        android:shortcutId="add_website"
		        android:enabled="true"
		        android:icon="@drawable/add"
		        android:shortcutShortLabel="@string/add_new_website_short"
		        android:shortcutLongLabel="@string/add_new_website"
		        android:shortcutDisabledMessage="@string/disable_shortcut">
		        <intent
		            android:action="android.intent.action.VIEW"
		            android:targetPackage="com.afra55.trainingfirstapp"
		            android:targetClass="com.afra55.trainingfirstapp.module.shortcuts.ShortcutsActivity" />
		        <!-- 如果 shortcut 节点包含多个意图，则这个快捷方式会打开最后一个声明的意图. -->
		        <categories android:name="android.shortcut.conversation" />
		    </shortcut>
		    <!-- 在这里指定更多的快捷键. -->
		</shortcuts>

3. 在 AndroidManifest.xml 找到入口 Activity，配置节点:

		<meta-data android:name="android.app.shortcuts"
	                 android:resource="@xml/shortcuts" />

	例如：

		<manifest xmlns:android="http://schemas.android.com/apk/res/android"
		             package="com.example.myapplication">
		  <application ... >
		    <activity android:name="Main">
		      <intent-filter>
		        <action android:name="android.intent.action.MAIN" />
		        <category android:name="android.intent.category.LAUNCHER" />
		      </intent-filter>
		      <meta-data android:name="android.app.shortcuts"
		                 android:resource="@xml/shortcuts" />
		    </activity>
		  </application>
		</manifest>

通过以上 3部曲，就完成了 快捷方式的静态配置。

![shortcut_static_sample](https://raw.githubusercontent.com/Afra55/Afra55.github.io/master/blog_picture/shortcuts/shortcut_static_sample.gif)

## 动态创建快捷方式

### [ShortcutManager](https://developer.android.com/reference/android/content/pm/ShortcutManager.html) API 允许操作动态快捷方式（注：是动态，静态无法操作）的方法有以下三种：

- Publish: 使用 [setDynamicShortcuts (List<ShortcutInfo> shortcutInfoList)](https://developer.android.com/reference/android/content/pm/ShortcutManager.html#setDynamicShortcuts(java.util.List%3Candroid.content.pm.ShortcutInfo%3E)) 方法去重新配置整个列表的动态捷径， 或者使用 [addDynamicShortcuts (List<ShortcutInfo> shortcutInfoList)](https://developer.android.com/reference/android/content/pm/ShortcutManager.html#addDynamicShortcuts(java.util.List%3Candroid.content.pm.ShortcutInfo%3E)) 去添加扩大现有的捷径列表。
- Update: 使用 [updateShortcuts (List<ShortcutInfo> shortcutInfoList) ](https://developer.android.com/reference/android/content/pm/ShortcutManager.html#updateShortcuts(java.util.List%3Candroid.content.pm.ShortcutInfo%3E))去更新现有的捷径列表。 
- Remove: 使用 [removeDynamicShortcuts (List<String> shortcutIds)](https://developer.android.com/reference/android/content/pm/ShortcutManager.html#removeDynamicShortcuts(java.util.List%3Cjava.lang.String%3E)) 通过 id 删除已有的动态快捷方式。

下面就是一个创建动态快捷方式的例子：

		ShortcutManager shortcutManager = getSystemService(ShortcutManager.class);
		
		ShortcutInfo shortcut = new ShortcutInfo.Builder(this, "id1")
		    .setShortLabel("Web site")
		    .setLongLabel("Open the web site")
		    .setIcon(Icon.createWithResource(context, R.drawable.icon_website))
		    .setIntent(new Intent(Intent.ACTION_VIEW,
		                   Uri.parse("https://afra55.github.io/")))
		    .build();
		
		shortcutManager.setDynamicShortcuts(Arrays.asList(shortcut));

### 追踪快捷方式的使用

[void reportShortcutUsed (String shortcutId)](https://developer.android.com/reference/android/content/pm/ShortcutManager.html#reportShortcutUsed(java.lang.String))

应用在发布一个快捷方式的时候需要调用这个方法，下面的两种情景都应该调用:

- 用户选择给定ID的快捷方式;
- 者用户打开 app 手动完成对应于相同的快捷方式的操作比如更新删除该快捷方式。

这样应用程序就能通过这个信息来构建预加载模块，以便在操作时可以立即响应。