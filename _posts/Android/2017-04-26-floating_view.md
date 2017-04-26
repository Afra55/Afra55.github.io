---
layout: post
title:  "Android Floating View"
date:   2017-04-26 19:07
categories: Android
comments: true
description: Android Floating View
---

* content
{:toc}

## 本文

[http://afra55.github.io/2017/04/26/floating_view/](http://afra55.github.io/2017/04/26/floating_view/)

## 图示

![demo动画](https://github.com/Afra55/Afra55.github.io/blob/master/blog_picture/shortcuts/FloatViewDemo.gif?raw=true)

## 前情提要

如上图所示，是一个悬浮窗，有移动动画，有大图隐藏小图显示的动画。
使用的是 WindowManager.addView 方法添加悬浮框。
建议有多个动画， 则 add 多个 view，不要放到一个里面。
此文也是在前人的基础上改编优化而来。
本文不会提供资源文件和demo。
只有代码及注释。

## Code

有两个布局：一个 是显示大图的布局， 一个是现实小图及底部文字的布局。

### 大布局 layout_float_big_img

	<?xml version="1.0" encoding="utf-8"?>
	<android.support.v7.widget.AppCompatImageView xmlns:android="http://schemas.android.com/apk/res/android"
	    android:id="@+id/float_image"
	    android:layout_width="150dp"
	    android:layout_height="150dp"
	    android:adjustViewBounds="true"
	    android:tag="icon_right_float_kid"
	    android:src="@drawable/icon_right_float_kid" />

### 小布局 layout_float_flower

	<?xml version="1.0" encoding="utf-8"?>
	<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"
	    android:layout_width="wrap_content"
	    android:layout_height="wrap_content"
	    android:orientation="vertical">

	    <LinearLayout
	        android:layout_width="wrap_content"
	        android:layout_height="wrap_content"
	        android:orientation="vertical">

	        <FrameLayout
	            android:id="@+id/float_image_container"
	            android:layout_width="wrap_content"
	            android:layout_gravity="center_horizontal"
	            android:layout_height="wrap_content">

	            <!--<include layout="@layout/layout_float_big_img" />-->

	            <android.support.v7.widget.AppCompatImageView
	                android:id="@+id/float_small_image"
	                android:layout_width="50dp"
	                android:layout_height="50dp"
	                android:translationY="50dp"
	                android:layout_gravity="center_horizontal|bottom"
	                android:adjustViewBounds="true"
	                android:src="@drawable/icon_right_float_kid" />

	        </FrameLayout>

	        <FrameLayout
	            android:id="@+id/float_text_container"
	            android:layout_width="match_parent"
	            android:layout_height="wrap_content">

	            <TextView
	                android:id="@+id/float_text"
	                android:layout_width="wrap_content"
	                android:layout_height="wrap_content"
	                android:layout_gravity="center_horizontal"
	                android:padding="5dp"
	                android:text="@string/sticker"
	                android:textColor="#FEA8B9"
	                android:background="@drawable/bg_float_tip" />

	        </FrameLayout>

	        <TextView
	            android:layout_width="wrap_content"
	            android:layout_height="1dp"
	            android:layout_gravity="center_horizontal"
	            android:padding="5dp"
	            android:text="@string/sticker"/>

	    </LinearLayout>

	</FrameLayout>

### 提供一个服务来启动 悬浮窗, 启动服务就可以显示悬浮窗


	import android.app.Service;
	import android.content.Context;
	import android.content.Intent;
	import android.content.res.Configuration;
	import android.os.IBinder;
	import android.view.WindowManager;

	import java.util.Timer;
	import java.util.TimerTask;

	public class FloatViewManagerService extends Service {

	    public static void start(Context context) {
	        Intent intent = new Intent(context, FloatViewManagerService.class);
	        context.startService(intent);
	    }

	    public static void stop(Context context) {
	        Intent intent = new Intent(context, FloatViewManagerService.class);
	        context.stopService(intent);
	    }

	    private int lastOrientation;

	    public FloatViewManagerService() {
	    }

	    /**
	     * 定时器，定时进行检测当前应该创建还是移除悬浮窗。
	     */
	    private Timer timer;

	    @Override
	    public IBinder onBind(Intent intent) {
	        return null;
	    }

	    @Override
	    public int onStartCommand(Intent intent, int flags, int startId) {

	        WindowManager windowManager = (WindowManager) AppApplication.getInstance().getSystemService(Context.WINDOW_SERVICE);
	        lastOrientation = windowManager.getDefaultDisplay().getRotation();

	        // 开启定时器，每隔0.5秒刷新一次
	        if (timer == null) {
	            timer = new Timer();
	            timer.scheduleAtFixedRate(new RefreshTask(), 0, 3000);
	        }
	        return super.onStartCommand(intent, flags, startId);
	    }

	    @Override
	    public void onDestroy() {
	        super.onDestroy();
	        // Service被终止的同时也停止定时器继续运行
	        FloatViewController.getInstance().hide();
	        timer.cancel();
	        timer = null;
	    }

	    private class RefreshTask extends TimerTask {

	        @Override
	        public void run() {
	            // 处理显示或者移除悬浮框
	            if (!FloatViewController.getInstance().isPauseToRemove() && FloatViewController.getInstance().isRemoved()) {
	                FloatViewController.getInstance().show();
	            }
	        }
	    }

	    @Override
	    public void onConfigurationChanged(Configuration newConfig) {
	        super.onConfigurationChanged(newConfig);
	        if (lastOrientation != newConfig.orientation) {
	            if (!FloatViewController.getInstance().isPauseToRemove()) {
	                FloatViewController.getInstance().show();
	            }
	            lastOrientation = newConfig.orientation;
	        }
	    }
	}


### （重点）浮动窗口的控制类


	import android.animation.Animator;
	import android.animation.ObjectAnimator;
	import android.animation.ValueAnimator;
	import android.annotation.SuppressLint;
	import android.content.Context;
	import android.content.Intent;
	import android.graphics.PixelFormat;
	import android.graphics.Point;
	import android.net.Uri;
	import android.os.Build;
	import android.os.Handler;
	import android.os.Looper;
	import android.os.Message;
	import android.provider.Settings;
	import android.util.DisplayMetrics;
	import android.util.Property;
	import android.util.TypedValue;
	import android.view.Gravity;
	import android.view.MotionEvent;
	import android.view.View;
	import android.view.ViewGroup;
	import android.view.WindowManager;
	import android.view.animation.AccelerateDecelerateInterpolator;
	import android.widget.ImageView;
	import android.widget.TextView;
	import android.widget.Toast;


	/**
	 * Created by yangshuai on 2017/4/17.
	 * 悬浮按钮控制类
	 */
	public class FloatViewController implements View.OnTouchListener {

	    private static final String TAG = FloatViewController.class.getSimpleName();

	    private static class SingletonHolder {
	        @SuppressLint("StaticFieldLeak")
	        private static FloatViewController instance = new FloatViewController();
	    }

	    private Context getContext() {
	        return AppApplication.getInstance();
	    }

	    public static FloatViewController getInstance() {
	        return SingletonHolder.instance;
	    }


	    private FloatViewController() {
	        mWindowManager = (WindowManager) getContext().getSystemService(Context.WINDOW_SERVICE);

	        isRemoved = true;

	        getScreenSize();

	        initView();
	    }

	    /**
	     * Flag 移动到边缘
	     */
	    private static final int FLAG_MOVE_TO_EDGE = 10010;

	    /**
	     * Flag 在边缘隐藏大图，显示小图标
	     */
	    private static final int FLAG_HIDE_TO_EDGE = 10011;

	    /**
	     * Flag 在边缘显示大图标，隐藏小图标
	     */
	    private static final int FLAG_SHOW_TO_EDGE = 10012;

	    /**
	     * TAG 用于标志 大图显示的 靠近底部的图片
	     */
	    private static final String TAG_BOTTOM_ICON = "icon_float_bottom_kid";

	    /**
	     * TAG 用于标志 大图显示的 靠近左右的图片
	     */
	    private static final String TAG_RIGHT_ICON = "icon_right_float_kid";

	    /**
	     * 需要同步布局中的大小
	     * 贴边显示时的 最小宽度
	     */
	    private static final int DEFAULT_HIDE_VIEW_SIZE = dp2px(50);

	    /**
	     * 需要同步布局中的大小
	     * 正常显示大图时的大小
	     */
	    private static int DEFAULT_SHOW_SIZE = dp2px(150);

	    /**
	     * 需要同步布局中的大小
	     * 显示贴边隐藏大图 动画 的延时
	     */
	    private final int SHOW_HIDE_VIEW_DELAYED_TIME = 5000;

	    /**
	     * 是否被移除
	     */
	    private boolean isRemoved = false;

	    private WindowManager mWindowManager;

	    /**
	     * 大图和小图的 参数
	     */
	    private WindowManager.LayoutParams mSmallLayoutParams, mBigLayoutParams;

	    /**
	     * 屏幕宽高
	     */
	    private int mScreenWidth, mScreenHeight;

	    /**
	     * 布局对照
	     *
	     * @see #initView()
	     */
	    private ViewGroup mSmallLayoutContainer;
	    private ViewGroup mFloatTextViewContainer;
	    private ViewGroup mFloatSmallImageContainer;
	    private ImageView mFloatBigImageView;
	    private ImageView mFloatSmallImageView;
	    private TextView mFloatTextView;

	    /**
	     * 透明度
	     */
	    private float mCurrentIconAlpha = 1f;

	    /**
	     * 是否显示 大图
	     */
	    private boolean isShowBigLayout;

	    /**
	     * 是否正在移动到边缘
	     */
	    private boolean isMovingToEdge;


	    private float mTouchStartX;
	    private float mTouchStartY;

	    /**
	     * 是否正在拖拽
	     */
	    private boolean isDragMoving;

	    private static final int mScaledTouchSlop = 5;

	    /**
	     * 是否可拖拽
	     */
	    private static final boolean canDrag = true;

	    /**
	     * 移动动画
	     */
	    private ValueAnimator smallImgMoveToEdgeAnim;
	    private ValueAnimator bigImgMoveToEdgeAnim;
	    private ObjectAnimator translateToEdgeHide;
	    private ObjectAnimator showSmallFloatImageAnim;
	    private ObjectAnimator hideOffsetLeftOrRightAnim;
	    private ObjectAnimator showOffsetLeftOrRightAnim;

	    /**
	     * 是否暂时移除 悬浮框
	     */
	    private boolean isPauseToRemove = false;

	    private void initView() {

	        if (mSmallLayoutContainer == null) {
	            mSmallLayoutContainer = (ViewGroup) View.inflate(getContext(), R.layout.layout_float_flower, null);
	        }
	        if (mFloatBigImageView == null) {
	            mFloatBigImageView = (ImageView) View.inflate(getContext(), R.layout.layout_float_big_img, null);
	        }

	        if (mSmallLayoutContainer != null && mFloatTextView == null) {
	            mFloatTextView = ((TextView) mSmallLayoutContainer.findViewById(R.id.float_text));
	        }

	        if (mSmallLayoutContainer != null && mFloatTextViewContainer == null) {
	            mFloatTextViewContainer = (ViewGroup) mSmallLayoutContainer.findViewById(R.id.float_text_container);
	        }

	        if (mSmallLayoutContainer != null && mFloatSmallImageContainer == null) {
	            mFloatSmallImageContainer = (ViewGroup) mSmallLayoutContainer.findViewById(R.id.float_image_container);
	        }

	        if (mSmallLayoutContainer != null && mFloatSmallImageView == null) {
	            mFloatSmallImageView = (ImageView) mSmallLayoutContainer.findViewById(R.id.float_small_image);
	        }

	        // event listeners
	        addFloatViewTouchListener();
	    }

	    /**
	     * 是否有动画运行种
	     *
	     * @return true 有 ； false 没有。
	     */
	    private boolean isAnimRunning() {
	        return (translateToEdgeHide != null && translateToEdgeHide.isRunning())
	                || (smallImgMoveToEdgeAnim != null && smallImgMoveToEdgeAnim.isRunning())
	                || (bigImgMoveToEdgeAnim != null && bigImgMoveToEdgeAnim.isRunning())
	                || (hideOffsetLeftOrRightAnim != null && hideOffsetLeftOrRightAnim.isRunning())
	                || (showOffsetLeftOrRightAnim != null && showOffsetLeftOrRightAnim.isRunning())
	                ;
	    }


	    /**
	     * handler 用于处理各种 布局更换
	     */
	    private Handler mMainHandler = new Handler(Looper.getMainLooper()) {
	        @Override
	        public void handleMessage(Message msg) {
	            synchronized (FloatViewController.this) {
	                switch (msg.what) {
	                    case FLAG_MOVE_TO_EDGE:
	                        // 移动到边缘
	                        int desX = (int) msg.obj;
	                        moveSmallImageToEdge(desX);
	                        moveBigImageToEdge(desX);
	                        break;
	                    case FLAG_HIDE_TO_EDGE:
	                        // 隐藏大布局，显示小布局
	                        if (isAnimRunning()) break;

	                        // 判断是在左边缘还是在右边缘
	                        int translateToHideLength = (Math.abs(mBigLayoutParams.x) < Math.abs(mBigLayoutParams.x - mScreenWidth))
	                                ? -mFloatBigImageView.getWidth() : mFloatBigImageView.getWidth();

	                        Property<View, Float> hideProperty = View.TRANSLATION_X;
	                        if (isAlignBottom()) {
	                            // 如果在底部，就是 y 轴的移动动画
	                            hideProperty = View.TRANSLATION_Y;
	                            translateToHideLength *= -1;
	                        }
	                        startTranslateHideShowAnim(
	                                translateToHideLength
	                                , true, hideProperty);

	                        break;

	                    case FLAG_SHOW_TO_EDGE:

	                        if (isAnimRunning()) break;

	                        Property<View, Float> showProperty = View.TRANSLATION_X;

	                        if (isAlignBottom()) {
	                            showProperty = View.TRANSLATION_Y;
	                        }

	                        startTranslateHideShowAnim(
	                                0
	                                , false, showProperty);


	                        break;
	                }
	            }
	        }
	    };

	    /**
	     * 移动小布局到边缘
	     *
	     * @param desX desX
	     */
	    private void moveSmallImageToEdge(int desX) {
	        if (smallImgMoveToEdgeAnim != null && smallImgMoveToEdgeAnim.isRunning()) {
	            smallImgMoveToEdgeAnim.cancel();
	        }
	        smallImgMoveToEdgeAnim = ValueAnimator.ofInt(mSmallLayoutParams.x, desX);
	        smallImgMoveToEdgeAnim.setDuration(300);
	        smallImgMoveToEdgeAnim.setInterpolator(new AccelerateDecelerateInterpolator());
	        smallImgMoveToEdgeAnim.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
	            @Override
	            public void onAnimationUpdate(ValueAnimator animation) {
	                mSmallLayoutParams.x = (int) animation.getAnimatedValue();
	                try {
	                    mWindowManager.updateViewLayout(mSmallLayoutContainer, mSmallLayoutParams);
	                } catch (Exception e) {
	                    e.printStackTrace();
	                }
	            }
	        });
	        smallImgMoveToEdgeAnim.start();
	    }

	    /**
	     * 移动大布局到边缘, 其实可以复用
	     *
	     * @param desX des
	     * @see #moveSmallImageToEdge(int)
	     */
	    private void moveBigImageToEdge(int desX) {
	        if (bigImgMoveToEdgeAnim != null && bigImgMoveToEdgeAnim.isRunning()) {
	            bigImgMoveToEdgeAnim.cancel();
	        }
	        bigImgMoveToEdgeAnim = ValueAnimator.ofInt(mBigLayoutParams.x, desX);
	        bigImgMoveToEdgeAnim.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
	            @Override
	            public void onAnimationUpdate(ValueAnimator animation) {
	                mBigLayoutParams.x = (int) animation.getAnimatedValue();
	                try {
	                    mWindowManager.updateViewLayout(mFloatBigImageView, mBigLayoutParams);
	                } catch (Exception e) {
	                    e.printStackTrace();
	                }
	                if (animation.getAnimatedFraction() >= 1) {
	                    isMovingToEdge = false;
	                    mMainHandler.removeMessages(FLAG_HIDE_TO_EDGE);
	                    mMainHandler.sendEmptyMessageDelayed(FLAG_HIDE_TO_EDGE, SHOW_HIDE_VIEW_DELAYED_TIME);

	                    startEdgeOffsetAnim();
	                }
	            }
	        });
	        bigImgMoveToEdgeAnim.setDuration(300);
	        bigImgMoveToEdgeAnim.setInterpolator(new AccelerateDecelerateInterpolator());
	        bigImgMoveToEdgeAnim.start();
	    }

	    /**
	     * 在做边缘或者右边缘的时候，还要右 50 dp 的移动
	     */
	    private void startEdgeOffsetAnim() {
	        hideOffsetLeftOrRightAnim = ObjectAnimator.ofFloat(
	                mFloatBigImageView
	                , View.X
	                , (Math.abs(mSmallLayoutParams.x) < Math.abs(mSmallLayoutParams.x - mScreenWidth))
	                        ? -dp2px(50) : dp2px(50));
	        hideOffsetLeftOrRightAnim.addListener(new Animator.AnimatorListener() {
	            @Override
	            public void onAnimationStart(Animator animation) {

	            }

	            @Override
	            public void onAnimationEnd(Animator animation) {
	                mMainHandler.removeMessages(FLAG_HIDE_TO_EDGE);
	                mMainHandler.sendEmptyMessageDelayed(FLAG_HIDE_TO_EDGE, SHOW_HIDE_VIEW_DELAYED_TIME);
	            }

	            @Override
	            public void onAnimationCancel(Animator animation) {

	            }

	            @Override
	            public void onAnimationRepeat(Animator animation) {

	            }
	        });
	        hideOffsetLeftOrRightAnim.start();
	    }


	    /**
	     * 显示或隐藏大图标动画
	     *
	     * @param translateToHideLength 移动长度
	     * @param isShowHideView        是否显示小图标
	     * @param property              移动的属性
	     */
	    private void startTranslateHideShowAnim(int translateToHideLength, final boolean isShowHideView, final Property<View, Float> property) {
	        translateToEdgeHide = ObjectAnimator.ofFloat(mFloatBigImageView, property, translateToHideLength);
	        long delayTime = 100;
	        translateToEdgeHide.setDuration(delayTime);
	        if (isShowHideView) {
	            mFloatTextView.setText(getContext().getString(R.string.sticker));
	        } else {
	            mFloatTextView.setText("收起");
	        }
	        long showSmallImgDelayed = delayTime / 3;
	        if (!isShowHideView) {
	            showSmallImgDelayed = 0;
	        }

	        // 在隐藏 大图的同时，显示小图
	        mMainHandler.postDelayed(new Runnable() {
	            @Override
	            public void run() {
	                if (showSmallFloatImageAnim != null && showSmallFloatImageAnim.isRunning()) {
	                    return;
	                }

	                showSmallFloatImageAnim(isShowHideView);
	            }
	        }, showSmallImgDelayed);

	        translateToEdgeHide.addListener(new Animator.AnimatorListener() {
	            @Override
	            public void onAnimationStart(Animator animation) {
	                mFloatBigImageView.setVisibility(View.VISIBLE);
	            }

	            @Override
	            public void onAnimationEnd(Animator animation) {

	                if (!isShowHideView) {
	                    if (property == View.TRANSLATION_X) {
	                        startEdgeOffsetAnim();
	                    } else if (property == View.TRANSLATION_Y) {
	                        mMainHandler.removeMessages(FLAG_HIDE_TO_EDGE);
	                        mMainHandler.sendEmptyMessageDelayed(FLAG_HIDE_TO_EDGE, SHOW_HIDE_VIEW_DELAYED_TIME);
	                    }
	                } else {
	                    mFloatBigImageView.setVisibility(View.GONE);
	                }

	            }

	            @Override
	            public void onAnimationCancel(Animator animation) {

	            }

	            @Override
	            public void onAnimationRepeat(Animator animation) {

	            }
	        });
	        translateToEdgeHide.start();
	    }

	    /**
	     * 显示小图动画
	     *
	     * @param isShowHideView 是否显示小图
	     */
	    private void showSmallFloatImageAnim(final boolean isShowHideView) {

	        mFloatBigImageView.requestLayout();

	        showSmallFloatImageAnim = ObjectAnimator.ofFloat(mFloatSmallImageView, View.TRANSLATION_Y
	                , isShowHideView ? 0 : dp2px(50));
	        showSmallFloatImageAnim.setDuration(100);
	        showSmallFloatImageAnim.addListener(new Animator.AnimatorListener() {
	            @Override
	            public void onAnimationStart(Animator animation) {

	            }

	            @Override
	            public void onAnimationEnd(Animator animation) {
	                isShowBigLayout = !isShowHideView;
	            }

	            @Override
	            public void onAnimationCancel(Animator animation) {

	            }

	            @Override
	            public void onAnimationRepeat(Animator animation) {

	            }
	        });
	        showSmallFloatImageAnim
	                .start();
	    }


	    @SuppressLint("ObsoleteSdkInt")
	    private void getScreenSize() {
	        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.HONEYCOMB_MR2) {
	            Point point = new Point();
	            mWindowManager.getDefaultDisplay().getSize(point);
	            mScreenWidth = point.x;
	            mScreenHeight = point.y;
	        } else {
	            mScreenWidth = mWindowManager.getDefaultDisplay().getWidth();
	            mScreenHeight = mWindowManager.getDefaultDisplay().getHeight();
	        }
	        mCurrentIconAlpha = 70 / 100f;
	    }

	    @Override
	    public boolean onTouch(View v, MotionEvent event) {

	        if (isAnimRunning()) {
	            return false;
	        }

	        if (isMovingToEdge) {
	            return true;
	        }

	        removeHandler();

	        float x = event.getRawX();
	        float y = event.getRawY();
	        switch (event.getAction()) {
	            case MotionEvent.ACTION_DOWN:

	                mTouchStartX = x;
	                mTouchStartY = y;
	                isDragMoving = false;
	                break;
	            case MotionEvent.ACTION_MOVE:

	                if (showOffsetLeftOrRightAnim != null && showOffsetLeftOrRightAnim.isRunning()) {
	                    return false;
	                }

	                if (mFloatBigImageView.getTranslationY() != 0) {
	                    mFloatBigImageView.setTranslationY(0);
	                    return false;
	                }

	                if (mFloatBigImageView.getTranslationX() != 0) {

	                    showOffsetLeftOrRightAnim = ObjectAnimator.ofFloat(mFloatBigImageView, "translationX", 0);
	                    showOffsetLeftOrRightAnim.setDuration(10);
	                    showOffsetLeftOrRightAnim.start();

	                    return false;
	                }

	                if (canDrag) {
	                    if (isDragMoving || Math.abs(x - mTouchStartX) > mScaledTouchSlop || Math.abs(y - mTouchStartY) > mScaledTouchSlop) {
	                        isDragMoving = true;
	                    }

	                    updateViewPosition(x, y);
	                }
	                break;
	            case MotionEvent.ACTION_UP:
	                if (!isDragMoving
	                        && Math.abs(x - mTouchStartX) < mScaledTouchSlop
	                        && Math.abs(y - mTouchStartY) < mScaledTouchSlop
	                        ) {
	                    
	                    if (!isShowBigLayout) {
	                        mMainHandler.sendEmptyMessage(FLAG_SHOW_TO_EDGE);
	                        return false;
	                    }
	                    // 处理点击事件
	                    //...........
	                }

	                if (canDrag) {
	                    updateViewPosition(x, y - mSmallLayoutContainer.getHeight());
	                }

	                mTouchStartX = mTouchStartY = 0;

	                moveToEdge();

	            case MotionEvent.ACTION_OUTSIDE:
	            case MotionEvent.ACTION_CANCEL:
	                moveToEdge();
	                break;
	        }
	        return true;
	    }

	    /**
	     * 移动到边缘
	     */
	    private void moveToEdge() {
	        mMainHandler.post(new Runnable() {
	            @SuppressLint("ObsoleteSdkInt")
	            @Override
	            public void run() {

	                if (isAlignBottom()) {
	                    mMainHandler.removeMessages(FLAG_HIDE_TO_EDGE);
	                    mMainHandler.sendEmptyMessageDelayed(FLAG_HIDE_TO_EDGE, SHOW_HIDE_VIEW_DELAYED_TIME);
	                    return;
	                }

	                isMovingToEdge = true;
	                initScreenData();
	                int desBigX = 0;
	                if (mBigLayoutParams.x > mScreenWidth / 2) {
	                    desBigX = mScreenWidth;
	                }
	                mMainHandler.sendMessage(mMainHandler.obtainMessage(FLAG_MOVE_TO_EDGE, desBigX));
	            }
	        });
	    }

	    /**
	     * 判断是否在底部
	     *
	     * @return true 是
	     */
	    private boolean isAlignBottom() {
	        if (mBigLayoutParams.y + mFloatBigImageView.getHeight() >= mScreenHeight) {
	            return true;
	        }
	        return false;
	    }

	    /**
	     * 更新 视图的 位置
	     *
	     * @param x x
	     * @param y y
	     */
	    private synchronized void updateViewPosition(float x, float y) {

	        mSmallLayoutParams.x = (int) (x - mSmallLayoutContainer.getWidth() / 2);
	        mBigLayoutParams.x = (int) (x - mFloatBigImageView.getWidth() / 2);

	        if (mFloatBigImageView.getVisibility() == View.GONE) {
	            mSmallLayoutParams.y = (int) (y - mFloatSmallImageView.getHeight() / 2);
	            mBigLayoutParams.y = (int) (y - mFloatBigImageView.getHeight() + mFloatSmallImageView.getHeight() / 2);
	        } else {
	            mSmallLayoutParams.y = (int) (y + mFloatBigImageView.getHeight() / 2 - mFloatSmallImageView.getHeight());
	            mBigLayoutParams.y = (int) (y - mFloatBigImageView.getHeight() / 2);
	        }


	        if (mSmallLayoutParams.x < 0) {
	            mSmallLayoutParams.x = 0;
	        }
	        if (mSmallLayoutParams.y < 0) {
	            mSmallLayoutParams.y = 0;
	        }

	        if (mBigLayoutParams.x < 0) {
	            mBigLayoutParams.x = 0;
	        }
	        if (mBigLayoutParams.y < 0) {
	            mBigLayoutParams.y = 0;
	        }

	        LogUtils.i(TAG, mBigLayoutParams.y + " | " + mScreenHeight);

	        Object floatImageViewTag = mFloatBigImageView.getTag();
	        if (mBigLayoutParams.y >= mScreenHeight - DEFAULT_SHOW_SIZE) {
	            if (floatImageViewTag == null || !floatImageViewTag.equals(TAG_BOTTOM_ICON)) {
	                mFloatBigImageView.setImageResource(R.drawable.icon_float_bottom_kid);
	                mFloatBigImageView.setTag(TAG_BOTTOM_ICON);
	            }
	        } else {
	            if (floatImageViewTag == null || !floatImageViewTag.equals(TAG_RIGHT_ICON)) {
	                mFloatBigImageView.setImageResource(R.drawable.icon_right_float_kid);
	                mFloatBigImageView.setTag(TAG_RIGHT_ICON);
	            }
	        }


	        try {
	            mWindowManager.updateViewLayout(mSmallLayoutContainer, mSmallLayoutParams);
	            mWindowManager.updateViewLayout(mFloatBigImageView, mBigLayoutParams);
	        } catch (Throwable e) {
	            e.printStackTrace();
	        }
	    }

	    private void addFloatViewTouchListener() {
	        if (mFloatBigImageView != null) {
	            mFloatBigImageView.setOnTouchListener(this);
	        }

	        if (mFloatSmallImageView != null) {
	            mFloatSmallImageView.setOnTouchListener(this);
	        }

	        if (mFloatSmallImageContainer != null) {
	            mFloatSmallImageContainer.setOnTouchListener(this);
	        }

	        if (mFloatTextViewContainer != null) {
	            mFloatTextViewContainer.setOnClickListener(new View.OnClickListener() {
	                @Override
	                public void onClick(View v) {
	                    if (isShowBigLayout) {
	                        mMainHandler.sendEmptyMessage(FLAG_HIDE_TO_EDGE);
	                    } else {
	                        mMainHandler.sendEmptyMessage(FLAG_SHOW_TO_EDGE);
	//                        showFloatDefaultView();
	                    }
	                }
	            });
	        }
	    }

	    private void removeFloatViewTouchListener() {
	        if (mFloatBigImageView != null) {
	            mFloatBigImageView.setOnTouchListener(null);
	        }

	        if (mFloatTextViewContainer != null) {
	            mFloatTextViewContainer.setOnClickListener(null);
	        }

	        if (mFloatSmallImageContainer != null) {
	            mFloatSmallImageContainer.setOnClickListener(null);
	        }

	        if (translateToEdgeHide != null && translateToEdgeHide.isRunning()) {
	            translateToEdgeHide.cancel();
	        }

	        if (smallImgMoveToEdgeAnim != null && smallImgMoveToEdgeAnim.isRunning()) {
	            smallImgMoveToEdgeAnim.cancel();
	        }

	        removeHandler();
	    }

	    private void removeHandler() {
	        mMainHandler.removeMessages(FLAG_MOVE_TO_EDGE);
	        mMainHandler.removeMessages(FLAG_HIDE_TO_EDGE);
	        mMainHandler.removeMessages(FLAG_SHOW_TO_EDGE);
	    }

	    public synchronized void show() {
	        if (isRemoved) {
	            showFloatDefaultView();
	            isRemoved = false;
	        } else {
	            addFloatViewTouchListener();
	        }
	        mMainHandler.post(new Runnable() {
	            @Override
	            public void run() {
	                synchronized (FloatViewController.this) {
	                    if (mSmallLayoutContainer != null) {
	                        mSmallLayoutContainer.setVisibility(View.VISIBLE);
	                        moveToEdge();
	                    }
	                }
	            }
	        });

	    }

	    private void showFloatDefaultView() {
	        if (mSmallLayoutParams == null || mBigLayoutParams == null) {
	            reuseSavedWindowMangerPosition();
	        }
	        showFloatIcon();
	        mMainHandler.post(new Runnable() {
	            @Override
	            public void run() {
	                synchronized (FloatViewController.this) {
	                    int size;
	                    size = ViewGroup.LayoutParams.WRAP_CONTENT;
	                    reuseSavedWindowMangerPositionForSmall(size, size);
	                    removeAllView();
	                    try {
	                        mSmallLayoutContainer.setAlpha(mCurrentIconAlpha);
	                        mSmallLayoutContainer.setScaleX(1);
	                        mSmallLayoutContainer.setScaleY(1);

	                        mSmallLayoutContainer.setVisibility(View.VISIBLE);
	                        mWindowManager.addView(mFloatBigImageView, mBigLayoutParams);
	                        mWindowManager.addView(mSmallLayoutContainer, mSmallLayoutParams);

	                        isShowBigLayout = true;
	                    } catch (Throwable e) {
	                        e.printStackTrace();
	                        Toast.makeText(getContext(), "悬浮按钮开启失败，请手动开启！", Toast.LENGTH_LONG).show();
	                        try {
	                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(getContext())) {
	                                // 悬浮开启判断
	                                Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
	                                        Uri.parse("package:" + getContext().getPackageName()));
	                                getContext().startActivity(intent);
	                                isRemoved = true;
	                            }
	                        } catch (Exception e1) {
	                            e1.printStackTrace();
	                        }
	                    }

	                    addFloatViewTouchListener();

	                    moveToEdge();
	                }
	            }
	        });
	    }

	    public void hide() {
	        isRemoved = true;
	        removeAllView();
	    }

	    private void removeAllView() {
	        if (mWindowManager == null)
	            mWindowManager = (WindowManager) getContext().getSystemService(Context.WINDOW_SERVICE);
	        try {
	            mWindowManager.removeView(mSmallLayoutContainer);
	            mWindowManager.removeView(mFloatBigImageView);
	        } catch (Exception e) {
	            e.printStackTrace();
	        }
	        if (mSmallLayoutContainer != null) {
	            mSmallLayoutContainer.setVisibility(View.INVISIBLE);
	        }

	        removeFloatViewTouchListener();

	    }

	    /**
	     * 是否从屏幕上移除
	     *
	     * @return boolean
	     */
	    public boolean isRemoved() {
	        return isRemoved;
	    }

	    private void showFloatIcon() {
	        mMainHandler.post(new Runnable() {
	            @Override
	            public void run() {
	                mMainHandler.removeMessages(FLAG_HIDE_TO_EDGE);
	                mFloatBigImageView.setImageResource(R.drawable.icon_right_float_kid);

	                mFloatBigImageView.requestLayout();
	                mFloatTextView.setText("收起");
	                mFloatBigImageView.setContentDescription("浮动视图");

	                mFloatSmallImageView.setTranslationY(dp2px(50));
	                mFloatBigImageView.setTranslationX(0);
	                mFloatBigImageView.setTranslationY(0);
	                reuseSavedWindowMangerPosition();

	                try {
	                    mWindowManager.updateViewLayout(mFloatBigImageView, mBigLayoutParams);
	                    mWindowManager.updateViewLayout(mSmallLayoutContainer, mSmallLayoutParams);
	                } catch (Throwable e) {
	                    e.printStackTrace();
	                }
	                mMainHandler.sendEmptyMessageDelayed(FLAG_HIDE_TO_EDGE, SHOW_HIDE_VIEW_DELAYED_TIME);
	            }
	        });

	    }

	    private void reuseSavedWindowMangerPosition() {
	        reuseSavedWindowMangerPositionForBig(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
	        reuseSavedWindowMangerPositionForSmall(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
	    }

	    @SuppressLint("ObsoleteSdkInt")
	    private void reuseSavedWindowMangerPositionForSmall(int width_vale, int height_value) {
	        //获取windowManager
	        if (mSmallLayoutParams == null) {
	            DisplayMetrics displayMetrics = new DisplayMetrics();
	            mWindowManager.getDefaultDisplay().getMetrics(displayMetrics);

	            int flags = getFloatWindowFlags();
	            int type = getFloatWindowType();
	            initScreenData();
	            int x = mScreenWidth;
	            int y = mScreenHeight / 3 * 2 + DEFAULT_SHOW_SIZE / 2 - DEFAULT_HIDE_VIEW_SIZE;

	            mSmallLayoutParams = new WindowManager.LayoutParams(width_vale, height_value, type, flags, PixelFormat.TRANSLUCENT);
	            mSmallLayoutParams.gravity = Gravity.TOP | Gravity.START;
	            mSmallLayoutParams.x = x;
	            mSmallLayoutParams.y = y;
	        } else {
	            mSmallLayoutParams.width = width_vale;
	            mSmallLayoutParams.height = height_value;
	        }

	    }

	    private int getFloatWindowType() {
	        int type;
	        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && Settings.canDrawOverlays(getContext())) {
	            type = WindowManager.LayoutParams.TYPE_PHONE;
	        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT && Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
	            type = WindowManager.LayoutParams.TYPE_TOAST;
	        } else {
	            type = WindowManager.LayoutParams.TYPE_PHONE;
	        }
	        return type;
	    }

	    @SuppressLint("ObsoleteSdkInt")
	    private void reuseSavedWindowMangerPositionForBig(int width_vale, int height_value) {
	        //获取windowManager
	        if (mBigLayoutParams == null) {

	            int flags = getFloatWindowFlags();
	            int type = getFloatWindowType();

	            initScreenData();
	            int x = mScreenWidth;
	            int y = mScreenHeight / 3 * 2 - DEFAULT_SHOW_SIZE / 2;

	            mBigLayoutParams = new WindowManager.LayoutParams(width_vale, height_value, type, flags, PixelFormat.TRANSLUCENT);
	            mBigLayoutParams.gravity = Gravity.TOP | Gravity.START;
	            mBigLayoutParams.x = x;
	            mBigLayoutParams.y = y;
	        } else {
	            mBigLayoutParams.width = width_vale;
	            mBigLayoutParams.height = height_value;
	        }

	    }

	    private void initScreenData() {
	        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.HONEYCOMB_MR2) {
	            Point point = new Point();
	            mWindowManager.getDefaultDisplay().getSize(point);
	            mScreenWidth = point.x;
	            mScreenHeight = point.y;
	        } else {
	            mScreenWidth = mWindowManager.getDefaultDisplay().getWidth();
	            mScreenHeight = mWindowManager.getDefaultDisplay().getHeight();
	        }
	    }

	    private int getFloatWindowFlags() {
	        return WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL | WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH;
	    }

	    private static int dp2px(float dp) {
	        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, dp, AppApplication.getInstance().getResources().getDisplayMetrics());
	    }


	    public boolean isPauseToRemove() {
	        return isPauseToRemove;
	    }

	    // 暂时隐藏不显示
	    public void setPauseToRemove(boolean pauseToRemove) {
	        isPauseToRemove = pauseToRemove;
	        if (!pauseToRemove) {
	            show();
	        } else {
	            hide();
	        }
	    }
	}

## 轮子已经制造，该怎么去转动呢？
