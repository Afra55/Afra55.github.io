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


## 工具类

这个工具类实现了 一个简单的 创建，查询，移除 打开相应网站的快捷方式的 功能。 源码来自 Android Sample：

[https://github.com/Afra55/TrainingFirstApp/blob/e90256b500dd3029be84e3885bcd0b8f110e55a0/app/src/main/java/com/afra55/trainingfirstapp/utils/ShortcutHelper.java](https://github.com/Afra55/TrainingFirstApp/blob/e90256b500dd3029be84e3885bcd0b8f110e55a0/app/src/main/java/com/afra55/trainingfirstapp/utils/ShortcutHelper.java)


代码：

	package com.afra55.trainingfirstapp.utils;
	
	import android.content.Context;
	import android.content.Intent;
	import android.content.pm.ShortcutInfo;
	import android.content.pm.ShortcutManager;
	import android.graphics.Bitmap;
	import android.graphics.BitmapFactory;
	import android.graphics.drawable.Icon;
	import android.net.Uri;
	import android.os.AsyncTask;
	import android.os.Build;
	import android.os.Handler;
	import android.os.Looper;
	import android.os.PersistableBundle;
	import android.support.annotation.RequiresApi;
	import android.util.Log;
	import android.widget.Toast;
	
	import com.afra55.trainingfirstapp.R;
	
	import java.io.BufferedInputStream;
	import java.io.IOException;
	import java.io.InputStream;
	import java.net.URL;
	import java.net.URLConnection;
	import java.util.ArrayList;
	import java.util.Collections;
	import java.util.HashSet;
	import java.util.List;
	
	@RequiresApi(api = Build.VERSION_CODES.N_MR1)
	public class ShortcutHelper {
	    private static final String TAG = ShortcutHelper.class.getName();
	
	    private static final String EXTRA_LAST_REFRESH =
	            "com.afra55.trainingfirstapp.EXTRA_LAST_REFRESH";
	
	    private static final long REFRESH_INTERVAL_MS = 60 * 60 * 1000;
	
	    private final Context mContext;
	
	    private final ShortcutManager mShortcutManager;
	
	    public ShortcutHelper(Context context) {
	        mContext = context;
	        mShortcutManager = mContext.getSystemService(ShortcutManager.class);
	    }
	
	    public void maybeRestoreAllDynamicShortcuts() {
	        try {
	            if (mShortcutManager.getDynamicShortcuts().size() == 0) {
	                // NOTE: 如果应用总是有动态的快捷方式, 在这里重新发布他们。
	                // 当应用在另一个设备 被还原时，所有的动态的快捷方式都不会被还原，只有放在桌面的快捷方式才会被还原.
	                if (mShortcutManager.getPinnedShortcuts().size() > 0) {
	                    // 桌面的快捷方式已经被还原了 使用 updateShortcuts(List) 方法确保他们是最新的内容.
	                }
	            }
	        } catch (Exception e) {
	            e.printStackTrace();
	        }
	    }
	
	    public void reportShortcutUsed(String id) {
	        mShortcutManager.reportShortcutUsed(id);
	    }
	
	    /**
	     * 调用 ShortcutManager 的方法后，判断是否被限制.
	     */
	    private void callShortcutManager(boolean r) {
	        if (!r) {
	            showToast(mContext, "Call to ShortcutManager is rate-limited");
	        }
	    }
	
	    /**
	     * 获取所有的可变的快捷方式.
	     */
	    public List<ShortcutInfo> getShortcuts() {
	        // 加载可变的动态快捷方式和加载在桌面的快捷方式，
	        // 放在一个 list 里并移除重复的（因为动态的也可能被拖放在桌面上）。
	
	        final List<ShortcutInfo> ret = new ArrayList<>();
	        final HashSet<String> seenKeys = new HashSet<>();
	
	        // 检查存在的快捷方式
	        for (ShortcutInfo shortcut : mShortcutManager.getDynamicShortcuts()) {
	            if (!shortcut.isImmutable()) {
	                // 只拿去可更改的快捷方式
	                ret.add(shortcut);
	                seenKeys.add(shortcut.getId());
	            }
	        }
	
	        // 检查所有的固定在桌面上的快捷方式
	        for (ShortcutInfo shortcut : mShortcutManager.getPinnedShortcuts()) {
	            if (!shortcut.isImmutable() && !seenKeys.contains(shortcut.getId())) {
	                // 只拿去可更改 和 不重复的快捷方式
	                ret.add(shortcut);
	                seenKeys.add(shortcut.getId());
	            }
	        }
	        return ret;
	    }
	
	    /**
	     * 当 activity 开始的时候调用.  查找已经发布的快捷方式并刷新他们，异步操作(but the refresh part isn't implemented yet...).
	     */
	    public void refreshShortcuts(final boolean force) {
	        new AsyncTask<Void, Void, Void>() {
	            @Override
	            protected Void doInBackground(Void... params) {
	                Log.i(TAG, "refreshingShortcuts...");
	
	                final long now = System.currentTimeMillis();
	                final long staleThreshold = force ? now : now - REFRESH_INTERVAL_MS;
	
	                // 检测所有存在的动态快捷方式和放在桌面的快捷方式。
	                // 如果上次刷新的时间与当前时间间隔超过了阖值 （REFRESH_INTERVAL_MS), 再更新他们。
	
	                final List<ShortcutInfo> updateList = new ArrayList<>();
	
	                for (ShortcutInfo shortcut : getShortcuts()) {
	                    if (shortcut.isImmutable()) {
	                        continue;
	                    }
	                    // 遍历所有可更改的快捷方式
	
	                    final PersistableBundle extras = shortcut.getExtras();
	                    if (extras != null && extras.getLong(EXTRA_LAST_REFRESH) >= staleThreshold) {
	                        // Shortcut 是最新的，就不再刷新它。
	                        continue;
	                    }
	                    Log.i(TAG, "Refreshing shortcut: " + shortcut.getId());
	
	                    final ShortcutInfo.Builder b = new ShortcutInfo.Builder(
	                            mContext, shortcut.getId());
	
	                    setSiteInformation(b, shortcut.getIntent().getData());
	                    setExtras(b);
	
	                    updateList.add(b.build());
	                }
	                // Call update.
	                if (updateList.size() > 0) {
	                    try {
	                        callShortcutManager(mShortcutManager.updateShortcuts(updateList));
	                    } catch (Exception e) {
	                        Log.e(TAG, "Caught Exception", e);
	                        showToast(mContext, "Error while calling ShortcutManager: " + e.toString());
	                    }
	                }
	
	                return null;
	            }
	        }.execute();
	    }
	
	    /**
	     * 通过 url 创建快捷方式
	     * @param urlAsString String
	     * @return ShortcutInfo
	     */
	    private ShortcutInfo createShortcutForUrl(String urlAsString) {
	        Log.i(TAG, "createShortcutForUrl: " + urlAsString);
	
	        final ShortcutInfo.Builder b = new ShortcutInfo.Builder(mContext, urlAsString);
	
	        final Uri uri = Uri.parse(urlAsString);
	
	        // 设置这个快捷方式的对应的 Intent.
	        b.setIntent(new Intent(Intent.ACTION_VIEW, uri));
	
	        setSiteInformation(b, uri);
	        setExtras(b);
	
	        return b.build();
	    }
	
	    /**
	     * 设置站点信息 icon 和 title
	     *
	     * @param b   ShortcutInfo.Builder
	     * @param uri Uri
	     * @return ShortcutInfo.Builder
	     */
	    private ShortcutInfo.Builder setSiteInformation(ShortcutInfo.Builder b, Uri uri) {
	        // TODO Get the actual site <title> and use it.
	        // TODO Set the current locale to accept-language to get localized title.
	        b.setShortLabel(uri.getHost());
	        b.setLongLabel(uri.toString());
	
	        Bitmap bmp = fetchFavicon(uri);
	        if (bmp != null) {
	            b.setIcon(Icon.createWithBitmap(bmp));
	        } else {
	            b.setIcon(Icon.createWithResource(mContext, R.drawable.link));
	        }
	
	        return b;
	    }
	
	    /**
	     * 存储快捷方式的刷新时间
	     *
	     * @param b ShortcutInfo.Builder
	     * @return ShortcutInfo.Builder
	     */
	    private ShortcutInfo.Builder setExtras(ShortcutInfo.Builder b) {
	        final PersistableBundle extras = new PersistableBundle();
	        extras.putLong(EXTRA_LAST_REFRESH, System.currentTimeMillis());
	        b.setExtras(extras);
	        return b;
	    }
	
	    private String normalizeUrl(String urlAsString) {
	        if (urlAsString.startsWith("http://") || urlAsString.startsWith("https://")) {
	            return urlAsString;
	        } else {
	            return "http://" + urlAsString;
	        }
	    }
	
	    /**
	     * 添加站点快捷方式
	     * @param urlAsString String
	     */
	    public void addWebSiteShortcut(String urlAsString) {
	        final ShortcutInfo shortcut = createShortcutForUrl(normalizeUrl(urlAsString));
	        try {
	            // 添加动态快捷方式
	            callShortcutManager(mShortcutManager.addDynamicShortcuts(Collections.singletonList(shortcut)));
	        } catch (Exception e) {
	            Log.e(TAG, "Caught Exception", e);
	            showToast(mContext, "Error while calling ShortcutManager: " + e.toString());
	        }
	    }
	
	    public void removeShortcut(ShortcutInfo shortcut) {
	        mShortcutManager.removeDynamicShortcuts(Collections.singletonList(shortcut.getId()));
	    }
	
	    public void disableShortcut(ShortcutInfo shortcut) {
	        mShortcutManager.disableShortcuts(Collections.singletonList(shortcut.getId()));
	    }
	
	    public void enableShortcut(ShortcutInfo shortcut) {
	        mShortcutManager.enableShortcuts(Collections.singletonList(shortcut.getId()));
	    }
	
	    /**
	     * 获取站点的 favicon.ico 图标
	     *
	     * @param uri uri
	     * @return Bitmap
	     */
	    private Bitmap fetchFavicon(Uri uri) {
	        final Uri iconUri = uri.buildUpon().path("favicon.ico").build();
	        Log.i(TAG, "Fetching favicon from: " + iconUri);
	
	        InputStream is = null;
	        BufferedInputStream bis = null;
	        try {
	            URLConnection conn = new URL(iconUri.toString()).openConnection();
	            conn.connect();
	            is = conn.getInputStream();
	            bis = new BufferedInputStream(is, 8192);
	            return BitmapFactory.decodeStream(bis);
	        } catch (IOException e) {
	            Log.w(TAG, "Failed to fetch favicon from " + iconUri, e);
	            return null;
	        }
	    }
	
	    public static void showToast(final Context context, final String message) {
	        new Handler(Looper.getMainLooper()).post(new Runnable() {
	            @Override
	            public void run() {
	                Toast.makeText(context, message, Toast.LENGTH_SHORT).show();
	            }
	        });
	    }
	}
