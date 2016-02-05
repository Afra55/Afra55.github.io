---
layout: post
title:  "获取Android控件的宽高"
date:   2016-1-21 9:10
categories: Android
comments: true
description: 获取Android控件的宽高
---

* content
{:toc}

## 一

	/**
	     * view 初始化完毕，宽高已经确定。<br/>
	     * 当 Activity 的窗口得到和失去焦点的时候，这个方法均会被调用。<br/>
	     * 频繁调用 onResume 和 onPause 这个方法也会被频繁调用。
	     * @param hasFocus
     */
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            int width = view.getMeasuredWidth();
            int height = view.getMeasuredHeight();
        }
    }

## 二

	@Override	
    protected void onStart() {
        super.onStart();

        /* 通过 post 可以将一个 Runnable 投递到消息队列的尾部。等到用的时候 view 也初始化好了。 */
        view.post(new Runnable() {
            @Override
            public void run() {
                int width = view.getMeasuredWidth();
                int height = view.getMeasuredHeight();
            }
        });
	}

## 三

	@Override
    protected void onStart() {
        super.onStart();
        /* 当 view树 的状态发生改变或者 View 树内部的 View 可见性发生改变时， onGlobalLayout 会被回调。*/
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN) {
	        ViewTreeObserver viewTreeObserver = view.getViewTreeObserver();
	        viewTreeObserver.addOnGlobalLayoutListener(new ViewTreeObserver.OnGlobalLayoutListener() {
	            @Override
	            public void onGlobalLayout() {
	                view.getViewTreeObserver().removeOnGlobalLayoutListener(this);
	                int width = view.getMeasuredWidth();
	                int height = view.getMeasuredHeight();
	            }
	        });
        }
	}

## 四

### 具体数值

	/* 比如宽高是100px */
        int widthMeasureSpec = View.MeasureSpec.makeMeasureSpec(100, View.MeasureSpec.EXACTLY);
        int heightMeasureSpec = View.MeasureSpec.makeMeasureSpec(100, View.MeasureSpec.EXACTLY);
        view.measure(widthMeasureSpec, heightMeasureSpec);
        int width = view.getMeasuredWidth();
        int height = view.getMeasuredHeight();

### wrap_content

	/* view 的尺寸是使用20位二进制表示（最大是30个1，即 2的30次方-1 ，也就是 (1 << 30) - 1 */
        int widthMeasureSpec = View.MeasureSpec.makeMeasureSpec((1 << 30) - 1, View.MeasureSpec.AT_MOST);
        int heightMeasureSpec = View.MeasureSpec.makeMeasureSpec((1 << 30) - 1, View.MeasureSpec.AT_MOST);
        view.measure(widthMeasureSpec, heightMeasureSpec);
        int width = view.getMeasuredWidth();
        int height = view.getMeasuredHeight();

### match_parent 不可用