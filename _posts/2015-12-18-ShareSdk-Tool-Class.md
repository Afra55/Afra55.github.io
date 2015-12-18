---
layout: post
title:  ShareSdk的一个分享工具类
date:   2015/12/18 11:19:14
category: android
comments: true
description: ShareSdk的一个分享工具类
---

##自定义分享布局

###图示

![图片](http://img.blog.csdn.net/20151218110618891)


###代码


	<?xml version="1.0" encoding="utf-8"?>
	<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
	    android:layout_width="match_parent"
	    android:layout_height="wrap_content"
	    android:paddingTop="10dp"
	    android:paddingLeft="5dp"
	    android:paddingRight="5dp"
	    android:paddingBottom="10dp"
	    android:background="@color/white"
	    android:orientation="vertical">
	
	    <LinearLayout
	        android:layout_width="match_parent"
	        android:layout_height="wrap_content"
	        android:orientation="horizontal">
	
	        <LinearLayout
	            android:id="@+id/share_wechat"
	            android:layout_width="0dp"
	            android:layout_height="wrap_content"
	            android:layout_weight="1"
	            android:gravity="center_horizontal"
	            android:orientation="vertical">
	
	            <ImageView
	                android:layout_width="50dp"
	                android:layout_height="50dp"
	                android:src="@drawable/ssdk_oks_logo_wechat" />
	
	            <TextView
	                android:layout_width="wrap_content"
	                android:layout_height="wrap_content"
	                android:layout_marginTop="2dp"
	                android:text="@string/ssdk_wechat" />
	
	        </LinearLayout>
	
	        <LinearLayout
	            android:id="@+id/share_wechate_moment"
	            android:layout_width="0dp"
	            android:layout_height="wrap_content"
	            android:layout_weight="1"
	            android:gravity="center_horizontal"
	            android:orientation="vertical">
	
	            <ImageView
	                android:layout_width="50dp"
	                android:layout_height="50dp"
	                android:src="@drawable/ssdk_oks_logo_wechatmoments" />
	
	            <TextView
	                android:layout_width="wrap_content"
	                android:layout_height="wrap_content"
	                android:layout_marginTop="2dp"
	                android:text="@string/ssdk_wechatmoments" />
	
	        </LinearLayout>
	
	        <LinearLayout
	            android:id="@+id/share_qq"
	            android:layout_width="0dp"
	            android:layout_height="wrap_content"
	            android:layout_weight="1"
	            android:gravity="center_horizontal"
	            android:orientation="vertical">
	
	            <ImageView
	                android:layout_width="50dp"
	                android:layout_height="50dp"
	                android:src="@drawable/ssdk_oks_logo_qq" />
	
	            <TextView
	                android:layout_width="wrap_content"
	                android:layout_height="wrap_content"
	                android:layout_marginTop="2dp"
	                android:text="@string/ssdk_qq" />
	
	        </LinearLayout>
	
	        <LinearLayout
	            android:id="@+id/share_sina"
	            android:layout_width="0dp"
	            android:layout_height="wrap_content"
	            android:layout_weight="1"
	            android:gravity="center_horizontal"
	            android:orientation="vertical">
	
	            <ImageView
	                android:layout_width="50dp"
	                android:layout_height="50dp"
	                android:src="@drawable/ssdk_oks_logo_sinaweibo" />
	
	            <TextView
	                android:layout_width="wrap_content"
	                android:layout_height="wrap_content"
	                android:layout_marginTop="2dp"
	                android:text="@string/ssdk_sinaweibo" />
	
	        </LinearLayout>
	    </LinearLayout>
	
	    <Button
	        android:id="@+id/share_cancle"
	        android:layout_width="match_parent"
	        android:layout_height="40dp"
	        android:layout_marginTop="10dp"
	        android:background="@drawable/btn_login_selector"
	        android:text="取  消"
	        android:textColor="@android:color/white"
	        android:textSize="18sp" />
	</LinearLayout>




##工具类

###代码

	
	import android.animation.ValueAnimator;
	import android.app.Activity;
	import android.content.Context;
	import android.graphics.drawable.BitmapDrawable;
	import android.view.Gravity;
	import android.view.LayoutInflater;
	import android.view.View;
	import android.view.WindowManager;
	import android.view.animation.LinearInterpolator;
	import android.widget.LinearLayout;
	import android.widget.PopupWindow;
	import android.widget.Toast;
	import com.funguide.funshopping.R;
	import cn.sharesdk.framework.Platform;
	import cn.sharesdk.framework.PlatformActionListener;
	import cn.sharesdk.framework.ShareSDK;
	import cn.sharesdk.sina.weibo.SinaWeibo;
	import cn.sharesdk.tencent.qq.QQ;
	import cn.sharesdk.wechat.favorite.WechatFavorite;
	import cn.sharesdk.wechat.friends.Wechat;
	import cn.sharesdk.wechat.moments.WechatMoments;
	
	/**
	 * Created by yangshuai in the 11:19 of 2015.12.17 .
	 */
	public class ShareUtil {
	
	    public static class Builder {
	        private Context context;
	        private PlatformActionListener platformActionListener;
	        private String text = "AAA啊哈";
	        private String imageUrl = "http://blog.csdn.net/yang786654260";
	        private int shareType = Platform.SHARE_WEBPAGE;
	        private String url = "http://blog.csdn.net/yang786654260";
	        private String title = "AAA啊哈";
	        private String titleUrl = "http://blog.csdn.net/yang786654260";
	
	        public static Builder build(Context context) {
	            ShareSDK.initSDK(context);
	            return new Builder(context);
	        }
	
	        public Builder(Context context) {
	            this.context = context;
	        }
	
	        public Builder setPlatformActionListener(PlatformActionListener platformActionListener) {
	            this.platformActionListener = platformActionListener;
	            return this;
	        }
	
	        /**
	         * 分享文本, 不能超过140个汉字
	         *
	         * @return
	         */
	        public Builder setText(String text) {
	            this.text = text;
	            return this;
	        }
	
	        /**
	         * 网络图片
	         *
	         * @param imageUrl
	         * @return
	         */
	        public Builder setImageUrl(String imageUrl) {
	            this.imageUrl = imageUrl;
	            return this;
	        }
	
	        /**
	         * 微信（好友、朋友圈、收藏）使用的分享类型
	         *
	         * @return
	         */
	        public Builder setShareType(int shareType) {
	            this.shareType = shareType;
	            return this;
	        }
	
	        /**
	         * 网页地址
	         *
	         * @param url
	         * @return
	         */
	        public Builder setUrl(String url) {
	            this.url = url;
	            return this;
	        }
	
	        /**
	         * 标题
	         *
	         * @param title 512Bytes以内
	         * @return
	         */
	        public Builder setTitle(String title) {
	            this.title = title;
	            return this;
	        }
	
	        /**
	         * QQ 分享时的标题链接
	         *
	         * @param titleUrl
	         * @return
	         */
	        public Builder setTitleUrl(String titleUrl) {
	            this.titleUrl = titleUrl;
	            return this;
	        }
	
	        public void showShareMenu() {
	            View view = LayoutInflater.from(context).inflate(R.layout.share_layout, null);
	            final PopupWindow popupWindow = new PopupWindow(view,
	                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT, true);
	            popupWindow.setBackgroundDrawable(new BitmapDrawable());
	            popupWindow.setOutsideTouchable(false);
	            popupWindow.setAnimationStyle(R.style.share_menu_show_anim);
	
	            view.findViewById(R.id.share_cancle).setOnClickListener(new View.OnClickListener() {
	                @Override
	                public void onClick(View v) {
	                    dissmiss(popupWindow);
	                }
	            });
	            view.findViewById(R.id.share_wechat).setOnClickListener(new View.OnClickListener() {
	                @Override
	                public void onClick(View v) {
	                    dissmiss(popupWindow);
	                    shareToWechat(title, text, imageUrl, url);
	                }
	            });
	            view.findViewById(R.id.share_wechate_moment).setOnClickListener(new View.OnClickListener() {
	                @Override
	                public void onClick(View v) {
	                    dissmiss(popupWindow);
	                    shareToWechatMoments(title, text, imageUrl, url);
	                }
	            });
	            view.findViewById(R.id.share_qq).setOnClickListener(new View.OnClickListener() {
	                @Override
	                public void onClick(View v) {
	                    dissmiss(popupWindow);
	                    shareToQQ(title, titleUrl, text, imageUrl);
	                }
	            });
	            view.findViewById(R.id.share_sina).setOnClickListener(new View.OnClickListener() {
	                @Override
	                public void onClick(View v) {
	                    dissmiss(popupWindow);
	                    shareToSina(text, imageUrl);
	                }
	            });
	            popupWindow.showAtLocation(((Activity) context).getWindow().getDecorView(), Gravity.BOTTOM, 0, 0);
	            backgroundAlpha(1, 0.7f);
	            popupWindow.setOnDismissListener(new PopupWindow.OnDismissListener() {
	                @Override
	                public void onDismiss() {
	                    backgroundAlpha(0.7f, 1);
	                }
	            });
	        }
	
	        private void dissmiss(PopupWindow popupWindow) {
	            popupWindow.dismiss();
	            backgroundAlpha(0.7f, 1);
	        }
	
	        private void backgroundAlpha(float bgFromAlpha, float bgToAlpha) {
	            ValueAnimator valueAnimator = ValueAnimator.ofFloat(bgFromAlpha, bgToAlpha);
	            valueAnimator.setDuration(context.getResources().getInteger(android.R.integer.config_longAnimTime));
	            valueAnimator.setInterpolator(new LinearInterpolator());
	            valueAnimator.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
	                @Override
	                public void onAnimationUpdate(ValueAnimator animation) {
	                    setWindowBgAlpht((float) animation.getAnimatedValue());
	                }
	            });
	            valueAnimator.start();
	        }
	
	        private void setWindowBgAlpht(float alpht) {
	            WindowManager.LayoutParams lp = ((Activity) context).getWindow().getAttributes();
	            lp.alpha = alpht; //0.0-1.0
	            ((Activity) context).getWindow().setAttributes(lp);
	        }
	
	        public void shareToSina(String text, String imgUrl) {
	
	            if (text == null || text.equals("")) {
	                Toast.makeText(context, "分享文本不能为空", Toast.LENGTH_SHORT).show();
	                return;
	            }
	            if (imageUrl == null || imageUrl.equals("")) {
	                Toast.makeText(context, "分享图片链接地址不能为空", Toast.LENGTH_SHORT).show();
	                return;
	            }
	
	            this.text = text;
	            this.imageUrl = imgUrl;
	            share(SinaWeibo.NAME);
	        }
	
	        public void shareToWechat(String title, String text, String imageUrl, String url) {
	
	            if (cannotShareToWechat(title, text, imageUrl, url)) return;
	
	            this.title = title;
	            this.text = text;
	            this.imageUrl = imageUrl;
	            this.url = url;
	            share(Wechat.NAME);
	        }
	
	        public void shareToWechatMoments(String title, String text, String imageUrl, String url) {
	
	            if (cannotShareToWechat(title, text, imageUrl, url)) return;
	
	            this.title = title;
	            this.text = text;
	            this.imageUrl = imageUrl;
	            this.url = url;
	            share(WechatMoments.NAME);
	        }
	
	        private boolean cannotShareToWechat(String title, String text, String imageUrl, String url) {
	            if (text == null || text.equals("")) {
	                Toast.makeText(context, "分享文本不能为空", Toast.LENGTH_SHORT).show();
	                return true;
	            }
	            if (imageUrl == null || imageUrl.equals("")) {
	                Toast.makeText(context, "分享图片链接地址不能为空", Toast.LENGTH_SHORT).show();
	                return true;
	            }
	            if (title == null || title.equals("")) {
	                Toast.makeText(context, "分享标题不能为空", Toast.LENGTH_SHORT).show();
	                return true;
	            }
	            if (url == null || url.equals("")) {
	                Toast.makeText(context, "分享链接地址不能为空", Toast.LENGTH_SHORT).show();
	                return true;
	            }
	            return false;
	        }
	
	        public void shareToQQ(String title, String titleUrl, String text, String imageUrl) {
	
	            if (text == null || text.equals("")) {
	                Toast.makeText(context, "分享文本不能为空", Toast.LENGTH_SHORT).show();
	                return;
	            }
	            if (imageUrl == null || imageUrl.equals("")) {
	                Toast.makeText(context, "分享图片链接地址不能为空", Toast.LENGTH_SHORT).show();
	                return;
	            }
	            if (title == null || title.equals("")) {
	                Toast.makeText(context, "分享标题不能为空", Toast.LENGTH_SHORT).show();
	                return;
	            }
	            if (titleUrl == null || titleUrl.equals("")) {
	                Toast.makeText(context, "分享标题链接地址不能为空", Toast.LENGTH_SHORT).show();
	                return;
	            }
	
	            this.title = title;
	            this.titleUrl = titleUrl;
	            this.text = text;
	            this.imageUrl = imageUrl;
	            share(QQ.NAME);
	        }
	
	        public void share(String platformName) {
	            if (text == null || text.equals("")) {
	                Toast.makeText(context, "分享文本不能为空", Toast.LENGTH_SHORT).show();
	                return;
	            }
	
	            Platform.ShareParams sp = new Platform.ShareParams();
	
	            if (platformName.equals(Wechat.NAME)
	                    || platformName.equals(WechatMoments.NAME)
	                    || platformName.equals(WechatFavorite.NAME)) {
	                sp.setShareType(shareType);
	            }
	
	            sp.setText(text);
	            sp.setImageUrl(imageUrl);
	            sp.setUrl(url);
	            sp.setTitle(title);
	            sp.setTitleUrl(titleUrl);
	
	            Platform platform = ShareSDK.getPlatform(platformName);
	            platform.setPlatformActionListener(platformActionListener); // 设置分享事件回调
	            // 执行图文分享
	            platform.share(sp);
	        }
	    }
	}



###使用方法

	
	ShareUtil.Builder.build(this).setPlatformActionListener(
	                new PlatformActionListener() {
	                    @Override
	                    public void onComplete(Platform platform, int i, HashMap<String, Object> hashMap) {
	                        showToast("onComplete + " + i);
	                    }
	
	                    @Override
	                    public void onError(Platform platform, int i, Throwable throwable) {
	                        showToast("onError + " + throwable.toString());
	                    }
	
	                    @Override
	                    public void onCancel(Platform platform, int i) {
	                        showToast("onCancel + " + i);
	                    }
	                }).showShareMenu();