---
layout: post
title:  "Custom Dilog"
date:   2016-12-22 15:07
categories: Android
comments: true
description: Custom Dilog
---

* content
{:toc}

## 本文



## 图示

![NormalDialog](https://raw.githubusercontent.com/Afra55/Afra55.github.io/master/blog_picture/view/NormalDialog.png)

## 前情提要

使用的是设计模式中的 Builder 模式。 
自定义的 布局 必须包含 四个控件：

1. 标题 TextView : android:tag="title"
2. 内容 TextView : android:tag="content"
3. 取消按钮 Button : android:tag="cancel"
4. 确定按钮 Button : android:tag="confirm"

## Code - NormalDialog

	import android.app.Dialog;
	import android.content.Context;
	import android.content.DialogInterface;
	import android.graphics.drawable.ColorDrawable;
	import android.text.TextUtils;
	import android.text.method.ScrollingMovementMethod;
	import android.util.DisplayMetrics;
	import android.view.LayoutInflater;
	import android.view.View;
	import android.view.ViewGroup;
	import android.view.Window;
	import android.view.WindowManager;
	import android.widget.Button;
	import android.widget.TextView;
	
	
	/**
	 * Created by Victor Yang on 2016/12/21 0021.
	 * NormalDialog.
	 */
	
	public class NormalDialog extends Dialog {
	
	    public static Builder getBuilder(Context context) {
	        return new Builder(context);
	    }
	
	    public NormalDialog(Context context) {
	        super(context);
	    }
	
	    public NormalDialog(Context context, int themeResId) {
	        super(context, themeResId);
	    }
	
	    protected NormalDialog(Context context, boolean cancelable, OnCancelListener cancelListener) {
	        super(context, cancelable, cancelListener);
	    }
	
	    public static class Builder {
	
	        private Context mContext;
	        private View mCustomContentView;
	        private String mTitleString;
	        private String mContentString;
	        private String mConfirmBtnString;
	        private String mCancelBtnString;
	        private boolean cancelable = true;
	        private DialogInterface.OnClickListener mConfirmClickListener;
	        private DialogInterface.OnClickListener mCancelClickListener;
	        private int mMaxContentHeight;
	        private int mContentAutoLinkMask;
	        private int mContentLinkTextColor = -1;
	
	        public Builder(Context context) {
	            mContext = context;
	        }
	
	        /**
	         * 设置 自定义 dialog 布局。
	         * 这个布局至少要有四个控件：
	         * 标题 TextView : android:tag="title"
	         * 内容 TextView : android:tag="content"
	         * 取消按钮 Button : android:tag="cancel"
	         * 确定按钮 Button : android:tag="confirm"
	         *
	         * @param view View
	         * @return Builder
	         */
	        public Builder addContentView(View view) {
	            mCustomContentView = view;
	            return this;
	        }
	
	        public Builder setTitle(String title) {
	            mTitleString = title;
	            return this;
	        }
	
	        public Builder setContent(String contentString) {
	            mContentString = contentString;
	            return this;
	        }
	
	        public Builder setConfirmBtnString(String text) {
	            mConfirmBtnString = text;
	            return this;
	        }
	
	        public Builder setCancelBtnString(String text) {
	            mCancelBtnString = text;
	            return this;
	        }
	
	        public Builder setCancelable(boolean flag) {
	            cancelable = flag;
	            return this;
	        }
	
	        public Builder setConfirmClickListener(DialogInterface.OnClickListener clickListener) {
	            mConfirmClickListener = clickListener;
	            return this;
	        }
	
	        public Builder setCancelClickListener(DialogInterface.OnClickListener clickListener) {
	            mCancelClickListener = clickListener;
	            return this;
	        }
	
	        public Builder setMaxContentHeight(int height) {
	            mMaxContentHeight = height;
	            return this;
	        }
	
	        /**
	         * Sets the autolink mask of the text.  See {@link
	         * android.text.util.Linkify#ALL Linkify.ALL} and peers for
	         * possible values.
	         *
	         * @attr ref android.R.styleable#TextView_autoLink
	         */
	        public Builder setContentAutoLinkMask(int mask) {
	            mContentAutoLinkMask = mask;
	            return this;
	        }
	
	        public Builder setContentLinkTextColor(int color) {
	            mContentLinkTextColor = color;
	            return this;
	        }
	
	        public NormalDialog build() {
	            final NormalDialog dialog = new NormalDialog(mContext);
	
	            // 去除标题栏
	            dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
	            dialog.setCancelable(cancelable);
	
	            // 设置 dialog 的背景为透明色，使得自定义布局的背景有效显示
	            ColorDrawable transparentDrawable =
	                    new ColorDrawable(mContext.getResources().getColor(android.R.color.transparent));
	            dialog.getWindow().setBackgroundDrawable(transparentDrawable);
	
	            View contentView = mCustomContentView;
	            if (contentView == null) {
	                LayoutInflater layoutInflater = (LayoutInflater) mContext
	                        .getSystemService(Context.LAYOUT_INFLATER_SERVICE);
	                contentView = layoutInflater.inflate(R.layout.normal_dialog_content, null);
	            }
	
	            dialog.addContentView(contentView,
	                    new ViewGroup.LayoutParams(
	                            ViewGroup.LayoutParams.MATCH_PARENT
	                            , ViewGroup.LayoutParams.MATCH_PARENT));
	
	            final TextView titleTv = (TextView) contentView.findViewWithTag("title");
	            final TextView contentTv = (TextView) contentView.findViewWithTag("content");
	            final Button confirmBtn = (Button) contentView.findViewWithTag("confirm");
	            final Button cancelBtn = (Button) contentView.findViewWithTag("cancel");
	
	            // 这里设置 内容 textView 的最大高度，避免内容过多挤掉其他控件
	            if (mMaxContentHeight == 0) {
	                contentTv.post(new Runnable() {
	                    @Override
	                    public void run() {
	                        DisplayMetrics outMetrics = getScreenHeightPixels(mContext);
	
	                        mMaxContentHeight = outMetrics.heightPixels
	                                - (titleTv.getHeight()
	                                + confirmBtn.getHeight()
	                                + cancelBtn.getHeight()) * 2;
	
	                        contentTv.setMaxHeight(mMaxContentHeight);
	                    }
	                });
	            } else {
	                contentTv.setMaxHeight(mMaxContentHeight);
	            }
	
	            // content textView 可以滚动显示
	            contentTv.setMovementMethod(ScrollingMovementMethod.getInstance());
	
	            if (mContentAutoLinkMask != 0) {
	                contentTv.setAutoLinkMask(mContentAutoLinkMask);
	            }
	
	            if (mContentLinkTextColor != -1) {
	                contentTv.setLinkTextColor(mContentLinkTextColor);
	            }
	
	            if (!TextUtils.isEmpty(mTitleString)) {
	                titleTv.setText(mTitleString);
	                titleTv.setVisibility(View.VISIBLE);
	            }
	
	            if (!TextUtils.isEmpty(mContentString)) {
	                contentTv.setText(mContentString);
	            }
	
	            if (!TextUtils.isEmpty(mConfirmBtnString)) {
	                confirmBtn.setText(mConfirmBtnString);
	            }
	
	            if (!TextUtils.isEmpty(mCancelBtnString)) {
	                cancelBtn.setText(mCancelBtnString);
	            }
	
	            confirmBtn.setOnClickListener(new View.OnClickListener() {
	                @Override
	                public void onClick(View v) {
	                    if (mConfirmClickListener != null) {
	                        mConfirmClickListener.onClick(dialog, DialogInterface.BUTTON_POSITIVE);
	                    }
	                    if (cancelable) {
	                        dialog.cancel();
	                    }
	                }
	            });
	
	            cancelBtn.setOnClickListener(new View.OnClickListener() {
	                @Override
	                public void onClick(View v) {
	                    if (mCancelClickListener != null) {
	                        mCancelClickListener.onClick(dialog, DialogInterface.BUTTON_NEGATIVE);
	                    }
	                    if (cancelable) {
	                        dialog.cancel();
	                    }
	                }
	            });
	
	            return dialog;
	        }
	
	    }
	
	    /**
	     * 公共方法，获取 屏幕信息
	     * @param mContext Context
	     * @return DisplayMetrics
	     */
	    public static DisplayMetrics getScreenHeightPixels(Context mContext) {
	        WindowManager windowManager = (WindowManager) mContext.getSystemService(Context.WINDOW_SERVICE);
	        DisplayMetrics outMetrics = new DisplayMetrics();
	        windowManager.getDefaultDisplay().getMetrics(outMetrics);
	        return outMetrics;
	    }
	}

## Code - default_layout

	<?xml version="1.0" encoding="utf-8"?>
	<android.support.constraint.ConstraintLayout xmlns:android="http://schemas.android.com/apk/res/android"
	    xmlns:app="http://schemas.android.com/apk/res-auto"
	    xmlns:tools="http://schemas.android.com/tools"
	    android:layout_width="wrap_content"
	    android:layout_height="wrap_content"
	    android:background="@drawable/normal_dialog_bg"
	    tools:context="com.nexttrucking.utils.ui.view.widget.NormalDialog">
	
	    <TextView
	        android:id="@+id/normal_dialog_title"
	        android:layout_width="wrap_content"
	        android:layout_height="wrap_content"
	        android:gravity="center"
	        android:tag="title"
	        android:textColor="@color/text_black"
	        android:textSize="18sp"
	        android:layout_marginTop="32dp"
	        app:layout_goneMarginTop="32dp"
	        android:textStyle="bold"
	        app:layout_constraintLeft_toLeftOf="parent"
	        app:layout_constraintRight_toRightOf="parent"
	        app:layout_constraintTop_toTopOf="parent"
	        tools:text="Are you an owner operator?"
	        android:visibility="gone" />
	
	    <TextView
	        android:id="@+id/normal_dialog_content"
	        android:layout_width="wrap_content"
	        android:layout_height="wrap_content"
	        android:padding="26dp"
	        android:gravity="center_horizontal"
	        android:tag="content"
	        android:textColor="@color/text_black"
	        android:textSize="18sp"
	        app:layout_constraintLeft_toLeftOf="parent"
	        app:layout_constraintRight_toRightOf="parent"
	        app:layout_constraintTop_toBottomOf="@+id/normal_dialog_title"
	        tools:text="You own and operate your own trucking business." />
	
	    <Button
	        android:id="@+id/normal_dialog_cancel_btn"
	        android:layout_width="203dp"
	        android:layout_height="50dp"
	        android:layout_marginBottom="40dp"
	        android:background="@drawable/fillet_button_normal_bg"
	        android:tag="cancel"
	        android:text="@string/no"
	        android:textColor="@color/button_text_yellow"
	        android:textSize="18sp"
	        android:textStyle="bold"
	        app:layout_constraintBottom_toBottomOf="parent"
	        app:layout_constraintLeft_toLeftOf="parent"
	        app:layout_constraintRight_toRightOf="parent" />
	
	    <Button
	        android:id="@+id/normal_dialog_confirm_btn"
	        android:layout_width="203dp"
	        android:layout_height="50dp"
	        android:layout_marginBottom="20dp"
	        android:background="@drawable/fillet_button_auto_change_bg"
	        android:tag="confirm"
	        android:text="@string/yes"
	        android:textColor="@color/button_text_white"
	        android:textSize="18sp"
	        android:textStyle="bold"
	        app:layout_constraintBottom_toTopOf="@+id/normal_dialog_cancel_btn"
	        app:layout_constraintLeft_toLeftOf="parent"
	        app:layout_constraintRight_toRightOf="parent"
	        android:layout_marginTop="8dp"
	        app:layout_constraintTop_toBottomOf="@+id/normal_dialog_content"
	        app:layout_constraintVertical_bias="1.0" />
	
	</android.support.constraint.ConstraintLayout>

## 使用简介

	NormalDialog.getBuilder(getContext())
	                .setTitle("Hello")
	                .setContent("http://blog.csdn.net/yang786654260/article/details/44780593")
	                .setContentAutoLinkMask(Linkify.ALL)
	                .build()
	                .show();