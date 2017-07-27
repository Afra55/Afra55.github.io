---
layout: post
title:  "向下拖拽展示更多之自定义 RecyclerView"
date:   2017-07-27 16:40
categories: Android
comments: true
description: Drag down to show more
---

* content
{:toc}

## 本文

[http://afra55.github.io/2017/05/05/get_android_device_sn/](http://afra55.github.io/2017/05/05/get_android_device_sn/)

## 前情提要

自定义 RecyclerView 向下拖拽展示更多；

![效果展示](https://github.com/Afra55/Afra55.github.io/blob/master/blog_picture/view/下拉展示更多.gif?raw=true)

## 需要自定义的参数（可选）, 用来限制最大高度：

    	<declare-styleable name="DragMinHeightRecyclerView">
            <attr name="maxHeight" format="dimension" />
        </declare-styleable>


## 自定义 RecyclerView (大前提需要设置 minHeight， 通过 minHeight 来判断一行到高度)

这里已经做到了与 adapter 的分离，只要adapter 实现 DragMinHeightAdapterListener 接口即可，详细代码附带注释如下：

    /**
     * Created by yangshuai on 2017/7/26.
     * {link http://afra55.github.io}
     */
    public class DragMinHeightRecyclerView extends RecyclerView {
        /**
         * 分离adapter, 只需要拿到总数据个数和高亮选择的数据位置
         */
        public interface DragMinHeightAdapterListener {

            /**
             * 获取总数据个数
             * @return int
             */
            int getItemCount();

            /**
             * 获取选择的数据位置
             * @return int
             */
            int getSelectPosition();

        }

        /**
         * 限定一个最高高度
         */
        private int maxHeight = ScreenUtil.dip2px(200);

        /**
         * 高度变化的属性动画
         */
        private ValueAnimator mHeightChangeValueAnimator;

        /**
         * 持有 LayoutManager
         */
        private GridLayoutManager mLayoutManager;

        /**
         * 持有 DragMinHeightAdapterListener
         */
        private DragMinHeightAdapterListener mDragMinHeightAdapterListener;


        public DragMinHeightRecyclerView(Context context) {
            super(context);
            init(null, 0);
        }

        public DragMinHeightRecyclerView(Context context, @Nullable AttributeSet attrs) {
            super(context, attrs);
            init(attrs, 0);
        }

        public DragMinHeightRecyclerView(Context context, @Nullable AttributeSet attrs, int defStyle) {
            super(context, attrs, defStyle);
            init(attrs, defStyle);
        }

        private float mLastTouchY;
        private int mCurrentHeight;

        private void init(AttributeSet attrs, int defStyle) {
            addOnItemTouchListener(new OnItemTouchListener() {
                @Override
                public boolean onInterceptTouchEvent(RecyclerView rv, MotionEvent e) {

                    // 拦截 item 的触摸事件，直接拦截 RecyclerView 是不行的
                    return isNeedInterceptMoveTouch(e);

                }

                @Override
                public void onTouchEvent(RecyclerView rv, MotionEvent e) {

                }

                @Override
                public void onRequestDisallowInterceptTouchEvent(boolean disallowIntercept) {

                }
            });

            if (attrs != null) {
                final TypedArray a = getContext().obtainStyledAttributes(
                        attrs, R.styleable.DragMinHeightRecyclerView, defStyle, 0);
                // 拿到 布局文件配置的 最大高度
                maxHeight = a.getDimensionPixelSize(R.styleable.DragMinHeightRecyclerView_maxHeight, maxHeight);
                a.recycle();
            }

        }

        /**
         * 判断是否需要拦截触摸事件
         * @param e MotionEvent
         * @return true 拦截； false 不拦截；
         */
        private boolean isNeedInterceptMoveTouch(MotionEvent e) {
            if (e.getAction() == MotionEvent.ACTION_MOVE) {
                // 只针对触摸移动进行拦截处理
                if (getLayoutParams().height < maxHeight) {
                    // 没有到达所限定的高度时拦截滑动事件
                    return true;
                } else if (mDragMinHeightAdapterListener != null && mLayoutManager != null){
                    float durationY = e.getY() - mLastTouchY;
                    if (durationY < 0 && mLayoutManager.findLastCompletelyVisibleItemPosition() >= mDragMinHeightAdapterListener.getItemCount() - 1) {
                        // 如果达到了限定的最大高度，判断是否展示了最后一个，并向上拖拽，才进行拦截处理；
                        return true;
                    }
                }

            }
            return false;
        }


        @Override
        public boolean onTouchEvent(MotionEvent e) {

            if (mHeightChangeValueAnimator != null && mHeightChangeValueAnimator.isRunning()
                    || getMinimumHeight() >= maxHeight) {
                // 高度变化动画进行中，不处理
                return super.onTouchEvent(e);
            }


            float currentTouchY = e.getY();


            switch (e.getAction()) {
                case MotionEvent.ACTION_DOWN:
                    // 获取按下时的Y位置
                    mLastTouchY = currentTouchY;

                    // 获取按下时 recyclerView 的高度
                    mCurrentHeight = getLayoutParams().height;
                    break;

                case MotionEvent.ACTION_MOVE:
                    // 移动的距离，负数表示向上拖拽，正数表示向下拖拽
                    float durationY = currentTouchY - mLastTouchY;
                    if (!isNeedInterceptMoveTouch(e)
                            || durationY < 0 && getLayoutParams().height <= getMinimumHeight()
                            || durationY > 0 && getLayoutParams().height >= maxHeight) {
                        // 先判断是否进行拦截处理；
                        // 如果向上拖拽并已经到达设置的最小高度限制不拦截；
                        // 如果向下拖拽并已经到达最大高度限制，则不拦截；
                        break;
                    }

                    // 处理拖拽时高度变更；
                    getLayoutParams().height = (int) (mCurrentHeight + durationY);
                    requestLayout();

                    getParent().requestDisallowInterceptTouchEvent(true);

                    return true;
                default:
                    // 释放触摸时，使用动画移动到指定的最大或最小的高度；没有实现抛的功能；
                    int endHeight;
                    if (getLayoutParams().height > getMinimumHeight() +  (maxHeight - getMinimumHeight()) / 2) {
                        endHeight = maxHeight;
                    } else {
                        endHeight = getMinimumHeight();
                    }
                    mHeightChangeValueAnimator = ValueAnimator.ofInt(getLayoutParams().height, endHeight);
                    mHeightChangeValueAnimator.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
                        @Override
                        public void onAnimationUpdate(ValueAnimator animation) {

                            getLayoutParams().height = (int) animation.getAnimatedValue();
                            requestLayout();

                            if (getLayoutParams().height <= getMinimumHeight()) {
                                resetSmoothShowPosition();
                            }
                        }

                    });

                    mHeightChangeValueAnimator.setDuration(100).start();

                    break;
            }

            return super.onTouchEvent(e);
        }

        /**
         * 滑动到选择项的位置
         */
        public void resetSmoothShowPosition() {
            try {
                mLayoutManager.smoothScrollToPosition(this, new RecyclerView.State(), mDragMinHeightAdapterListener.getSelectPosition());
            } catch (Exception e1) {
                e1.printStackTrace();
            }
        }

        /**
         * 立即移动到选择项的位置，无动画
         */
        public void resetShowPosition() {
            try {
                mLayoutManager.scrollToPositionWithOffset(mDragMinHeightAdapterListener.getSelectPosition(), 0);
            } catch (Exception e1) {
                e1.printStackTrace();
            }
        }

        @Override
        public void setLayoutManager(LayoutManager layout) {
            super.setLayoutManager(layout);
            if (layout instanceof GridLayoutManager) {
                mLayoutManager = (GridLayoutManager) layout;
            }
        }

        @Override
        public void setAdapter(Adapter adapter) {
            super.setAdapter(adapter);
            if (adapter instanceof DragMinHeightAdapterListener) {
                mDragMinHeightAdapterListener = (DragMinHeightAdapterListener) adapter;
                adapter.registerAdapterDataObserver(new AdapterDataObserver() {
                    @Override
                    public void onChanged() {
                        super.onChanged();
                        // 监听数据变化，来抓取最大高度
                        if (mLayoutManager != null) {
                            int lines = mDragMinHeightAdapterListener.getItemCount() / mLayoutManager.getSpanCount()
                                    + (mDragMinHeightAdapterListener.getItemCount() % mLayoutManager.getSpanCount() > 0 ? 1 : 0 );

                            int compareHeight = getMinimumHeight() * lines;
                            if (compareHeight < maxHeight) {
                                maxHeight = compareHeight;
                            }
                        }
                    }
                });
            }
        }
    }

## 使用简介

        <DragMinHeightRecyclerView
            android:layout_width="match_parent"
            android:background="@color/blue_light"
            apps:maxHeight="300dp"
            android:minHeight="@dimen/normal_item_height"
            android:layout_height="@dimen/normal_item_height"/>

