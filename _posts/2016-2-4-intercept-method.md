---
layout: post
title:  "View的滑动冲突处理方法"
date:   2016-2-4 16:09
categories: Android
comments: true
description: View的滑动冲突处理方法
---

#外部拦截法
	private int mLastXIntercept;
    private int mLastYIntercept;

    @Override
    public boolean onInterceptTouchEvent(MotionEvent ev) {
        boolean intercepted = false;
        int x = (int) ev.getX();
        int y = (int) ev.getY();
        switch (ev.getAction()) {
            case MotionEvent.ACTION_DOWN:
                intercepted = false;
                break;
            case MotionEvent.ACTION_MOVE:
                if (interceptEvent(ev)) {
                    intercepted = true;
                } else {
                    intercepted = false;
                }
                break;
            case MotionEvent.ACTION_UP:
                intercepted = false;
                break;
            default:
                break;
        }
        mLastXIntercept = x;
        mLastYIntercept = y;
        return intercepted;
    }

    /* 父容器需要当前的点击事件 */
    private boolean interceptEvent(MotionEvent ev) {
        return true;
    }