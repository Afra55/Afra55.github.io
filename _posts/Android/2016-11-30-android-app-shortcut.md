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