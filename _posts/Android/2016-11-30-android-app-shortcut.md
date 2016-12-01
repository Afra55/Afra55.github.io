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

## 本文

[http://afra55.github.io/2016/11/30/android-app-shortcut/](http://afra55.github.io/2016/11/30/android-app-shortcut/)

## 简介

Android 版本的 3D TOUCH。

![show_max_four_shourtcuts](https://raw.githubusercontent.com/Afra55/Afra55.github.io/master/blog_picture/shortcuts/show_max_four_shourtcuts.png)

## 创建一个静态的快捷方式

注：最多显示 4 个快捷方式，以静态的快捷方式优先。

1. 创建一个新的资源文件 (res/xml/shortcuts.xml) 。
2. 在 shortcuts.xml 文件中添加 `<shortcuts>` 根节点元素, 这个节点可以包含一些列 `<shortcut>` 元素， 每个`<shortcut>` 节点都包含一个 静态快捷方式的信息（icon，描述，对应的 intent 意图）。

		<?xml version="1.0" encoding="utf-8"?>
		<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">
		    <shortcut
		        android:shortcutId="add_website"
		        android:enabled="true"
		        android:icon="@drawable/add"

				<!-- shortcutShortLabel 需要限制在 10 个字符长度之内. -->
		        android:shortcutShortLabel="@string/add_new_website_short"

				<!-- shortcutLongLabel 需要限制在 25 个字符长度之内. -->
		        android:shortcutLongLabel="@string/add_new_website"
		        android:shortcutDisabledMessage="@string/disable_shortcut">

		        <intent
		            android:action="android.intent.action.VIEW"
		            android:targetPackage="com.afra55.trainingfirstapp"
		            android:targetClass="com.afra55.trainingfirstapp.module.shortcuts.ShortcutsActivity" />

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

1. Publish: 使用 `setDynamicShortcuts (List<ShortcutInfo> shortcutInfoList)` 方法去重新配置整个列表的动态捷径， 或者使用 `addDynamicShortcuts (List<ShortcutInfo> shortcutInfoList)` 去添加扩大现有的捷径列表。
2. Update: 使用 `updateShortcuts (List<ShortcutInfo> shortcutInfoList)` 去更新现有的捷径列表。 
3. Remove: 使用 `removeDynamicShortcuts (List<String> shortcutIds)` 通过 id 删除已有的动态快捷方式。

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

### 禁用快捷方式

调用  [disableShortcuts(List)](https://developer.android.com/reference/android/content/pm/ShortcutManager.html#disableShortcuts(java.util.List%3Cjava.lang.String%3E)) 或者  [disableShortcuts(List, CharSequence)](https://developer.android.com/reference/android/content/pm/ShortcutManager.html#disableShortcuts(java.util.List%3Cjava.lang.String%3E,%20java.lang.CharSequence)) 方法即可 disableShortcuts 的第二个参数用于显示提示错误信息，当用户点击这个被禁用的快捷方式时提示这个信息。

当用户把快捷方式放到手机桌面上 即在桌面上生成一个单独的桌面快捷方式时：

![shortcuts_desktop](https://raw.githubusercontent.com/Afra55/Afra55.github.io/master/blog_picture/shortcuts/shortcuts_desktop.png)

在这种情况下，禁用并不会移除桌面快捷方式，只会灰度化图标，并不可点击：

![shortcut_disable](https://raw.githubusercontent.com/Afra55/Afra55.github.io/master/blog_picture/shortcuts/shortcut_disable.gif)

当你更新了 app 并移除了一些静态的 快捷方式，那么桌面上的快捷方式 就会自动的被禁用。

### 多 intent

可以使用个 `setIntents(Intent[])` 来替代 `setIntent(Intent)`， 会显示最后一个 intent 其他的都会放到栈里。

例如设置一个静态的 多 intent 快捷方式：

		<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">
		    <shortcut
		        android:shortcutId="add_website"
		        android:enabled="true"
		        android:icon="@drawable/add"
		        android:shortcutShortLabel="@string/add_new_website_short"
		        android:shortcutLongLabel="@string/add_new_website"
		        android:shortcutDisabledMessage="@string/disable_shortcut">
		        <intent
		            android:action="com.afra55.trainingfirstapp.ADD_WEBSITE"
		            android:targetPackage="com.afra55.trainingfirstapp"
		            android:targetClass="com.afra55.trainingfirstapp.module.shortcuts.ShortcutsActivity" />
		
		        <intent
		            android:action="android.intent.action.VIEW"
		            android:targetPackage="com.afra55.trainingfirstapp"
		            android:targetClass="com.afra55.trainingfirstapp.module.surface_view.SurfaceViewTestActivity" />
		
		        <!-- 如果 shortcut 节点包含多个意图，则这个快捷方式会打开最后一个声明的意图，前面的意图会放到返回栈里. -->
		        <categories android:name="android.shortcut.conversation" />
		    </shortcut>
		</shortcuts>

![shortcut_multi_intent](https://raw.githubusercontent.com/Afra55/Afra55.github.io/master/blog_picture/shortcuts/shortcut_multi_intent.gif)

### 限制

当应用在 后台即前台没有 活动或服务时， 调用 setDynamicShortcuts(List), addDynamicShortcuts(List), 和 updateShortcuts(List) 三个方法是有次数限制的。你可以唤起应用到前台来充值这个次数，或者在 开发者设置里 点击  Reset ShortcutManager rate-limiting 设置：

![android_N_settings](https://raw.githubusercontent.com/Afra55/Afra55.github.io/master/blog_picture/shortcuts/android_N_settings.png)

还有一种方法是使用 adb 命令：

    adb shell cmd shortcut reset-throttling [ --user your-user-id ]

### 备份与还原

当在 应用在清单文件配置了  android:allowBackup="true" 时，才可以备份。而且还原的时候只有 放在 桌面的快捷方式 才会自动还原。有一点是 快捷方式的 icon 不会被备份，所以要在 app 里自己存储。

静态的快捷方式会在 app 重新安装的时候自动重新发布。动态的快捷方式则不会，只能在用户打开 app 的时候重新创建。

在 动态快捷方式无法备份还原的情况下但放在 桌面的快捷方式 可以被备份还原的情况下，可以在应用启动的时候 通过方法 getDynamicShortcuts() 来获取动态快捷方式的数量，然后判断是否需要重新发布 快捷方式。

下面举个例子：
		
		public class MainActivity extends Activity {
		    public void onCreate(Bundle savedInstanceState) {
		        super.onCreate(savedInstanceState);
		        ShortcutManager shortcutManager =
		                getSystemService(ShortcutManager.class);
		
				try{
					if (shortcutManager.getDynamicShortcuts().size() == 0) {
			            // 应用恢复. 需要重新发布动态快捷方式.

			            if (shortcutManager.getPinnedShortcuts().size() > 0) {
			                // 桌面的快捷方式已经被还原了 使用 updateShortcuts(List) 方法确保他们是最新的内容.
			            }
			        }
				}cache(Exception e){
					//...
				}
		        
		    }
		    // ...
		}
