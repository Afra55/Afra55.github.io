---
layout: post
title:  "ViewPager源码不完全解读!"
date: 2016-3-8 15:55:05 
categories: SourceCode
comments: true
description: ViewPager源码不完全解读!
---

* content
{:toc}

# ViewPager源码不完全解读

ViewPager 继承自 ViewGroup，实现了水平分页滑动的效果。

首先介绍下常用的方法 dispatchOnPageScrolled， 回掉设置的所有接口的 onPageScrolled
 	
	/**
    	 * 回调接口的 onPageScrolled 方法
    	 *
    	 * @param position
    	 * @param offset
    	 * @param offsetPixels
     */
    private void dispatchOnPageScrolled(int position, float offset, int offsetPixels) {
        if (mOnPageChangeListener != null) {
            mOnPageChangeListener.onPageScrolled(position, offset, offsetPixels);
        }
        if (mOnPageChangeListeners != null) {
            for (int i = 0, z = mOnPageChangeListeners.size(); i < z; i++) {
                OnPageChangeListener listener = mOnPageChangeListeners.get(i);
                if (listener != null) {
                    listener.onPageScrolled(position, offset, offsetPixels);
                }
            }
        }
        if (mInternalPageChangeListener != null) {
            mInternalPageChangeListener.onPageScrolled(position, offset, offsetPixels);
        }
    }

## ViewPager的创建
 
我使用了使用 google nexus 4 - 4.4.4 - API 19 - 768*1280（320dpi）genymotion模拟器进行单步调试,这次测试ViewPager没有设置padding和margin，我设置了七个ImageView视图，在设置adapter后，我立刻调用了 viewpager.setCurrentItem(1).方法调用顺序大致如下：

- initViewPager();
- setAdapter(PagerAdapter adapter);
- setCurrentItem的2参3参4参方法;
- onAttachedToWindow();
- onMeasure(int widthMeasureSpec, int heightMeasureSpec); (onMeasure调用了8次)
- onMeasure(int widthMeasureSpec, int heightMeasureSpec);
- onMeasure(int widthMeasureSpec, int heightMeasureSpec);
- onMeasure(int widthMeasureSpec, int heightMeasureSpec);
- onMeasure(int widthMeasureSpec, int heightMeasureSpec);
- onMeasure(int widthMeasureSpec, int heightMeasureSpec);
- onMeasure(int widthMeasureSpec, int heightMeasureSpec);
- onMeasure(int widthMeasureSpec, int heightMeasureSpec);
- onSizeChanged(int w, int h, int oldw, int oldh);
- onLayout(boolean changed, int l, int t, int r, int b);
- onMeasure(int widthMeasureSpec, int heightMeasureSpec); (onMeasure调用了8次)
- onMeasure(int widthMeasureSpec, int heightMeasureSpec);
- onMeasure(int widthMeasureSpec, int heightMeasureSpec);
- onMeasure(int widthMeasureSpec, int heightMeasureSpec);
- onMeasure(int widthMeasureSpec, int heightMeasureSpec);
- onMeasure(int widthMeasureSpec, int heightMeasureSpec);
- onMeasure(int widthMeasureSpec, int heightMeasureSpec);
- onMeasure(int widthMeasureSpec, int heightMeasureSpec);
- onLayout(boolean changed, int l, int t, int r, int b)
- draw(Canvas canvas)
- onDraw(Canvas canvas)
- draw(Canvas canvas)
- onDraw(Canvas canvas)
- draw(Canvas canvas)
- onDraw(Canvas canvas)

###初始化 initViewPager

	// 使用 google nexus 4 - 4.4.4 - API 19 - 768*1280（320dpi）genymotion模拟器
    void initViewPager() {
        setWillNotDraw(false);
        setDescendantFocusability(FOCUS_AFTER_DESCENDANTS);
        setFocusable(true);
        final Context context = getContext();
        mScroller = new Scroller(context, sInterpolator); // 创建Scroller
        // 标准常量
        final ViewConfiguration configuration = ViewConfiguration.get(context);
        // 屏幕密度
        final float density = context.getResources().getDisplayMetrics().density; // density = 2.0f

        mTouchSlop = ViewConfigurationCompat.getScaledPagingTouchSlop(configuration); // mTouchSlop = 32
        mMinimumVelocity = (int) (MIN_FLING_VELOCITY * density); // mMinimumVelocity = 800
        // 启动一个滑动的最大速率,像素/s
        mMaximumVelocity = configuration.getScaledMaximumFlingVelocity(); // mMaximumVelocity = 16000
        mLeftEdge = new EdgeEffectCompat(context);
        mRightEdge = new EdgeEffectCompat(context);

        mFlingDistance = (int) (MIN_DISTANCE_FOR_FLING * density); // mFlingDistance = 50
        mCloseEnough = (int) (CLOSE_ENOUGH * density);  // mCloseEnough = 4
        mDefaultGutterSize = (int) (DEFAULT_GUTTER_SIZE * density); // mDefaultGutterSize = 32

        ViewCompat.setAccessibilityDelegate(this, new MyAccessibilityDelegate());

        if (ViewCompat.getImportantForAccessibility(this)
                == ViewCompat.IMPORTANT_FOR_ACCESSIBILITY_AUTO) {
            ViewCompat.setImportantForAccessibility(this,
                    ViewCompat.IMPORTANT_FOR_ACCESSIBILITY_YES);
        }
    }

### 调用了 setCurrentItem
在为viewpager设置了adapter后我立刻调用了setCurrentItem（int item）方法，这个方法实现的时候ViewPager还没有进行测量。。。item是1.

	/**
	    * 设置当前选中的页面。
     	* 如果 ViewPager 已经通过档当前的 adapter 设立了第一个布局，切换到指定的页面时，会有个平滑的切换动画。
     	* <p>凡是在代码中调用了该方法，则 ViewPager 的 getScrollX() 方法返回的scrollX 以该item页面为起点</p>
     	*
     	* @param item 选择的页面索引
     */
    public void setCurrentItem(int item) {
        mPopulatePending = false;
        setCurrentItemInternal(item, !mFirstLayout, false); // item = 1, mFirstLayout = true
    }

setCurrentItemInternal 三个参数的方法源码如下，最终调用了四个参的 setCurrentItenInternal方法：
 	
	void setCurrentItemInternal(int item, boolean smoothScroll, boolean always) {
		// 这个时候 item = 1, smoothScroll = false, always = false
        setCurrentItemInternal(item, smoothScroll, always, 0);
    }

mAdapter里面有七个页面,mAdapter.getCount() = 7， 第一次进来只执行了下面的代码：

	void setCurrentItemInternal(int item, boolean smoothScroll, boolean always, int velocity) {
		final int pageLimit = mOffscreenPageLimit; // mOffscreenPageLimit = 1
			
		/* 判断要跳转的页面是不是当前页面 */
        final boolean dispatchSelected = mCurItem != item; // dispatchSelected = true
		if (mFirstLayout) { // mFirstLayout = true
            // We don't have any idea how big we are yet and shouldn't have any pages either.
            // Just set things up and let the pending layout handle things.
            mCurItem = item; // 存储当前页面的索引
            if (dispatchSelected) { // dispatchSelected = true
                dispatchOnPageSelected(item); // 回调所有已经设置的接口的 OnPageSelected
            }
            requestLayout(); // 请求布局，即开始调用 measure 方法
        }
	}

### onAttachedToWindow()，附加到 window

	@Override
    protected void onAttachedToWindow() {
        Log.i(TAG, "onAttachedToWindow");
        super.onAttachedToWindow();
        mFirstLayout = true;
    }

### 然后进行测量调用

	@Override
    protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
        // 对于简单的实现，内部的尺寸总是0。
        // 我们依赖容器来指定我们的布局大小。我们不能真正的知道什么时候我们会添加或者删除任意的 view，
        // 而且发生这种事时，我们不想视图有所改变。
		setMeasuredDimension(getDefaultSize(0, widthMeasureSpec),
                getDefaultSize(0, heightMeasureSpec));

        final int measuredWidth = getMeasuredWidth(); // measuredWidth = 768
		final int maxGutterSize = measuredWidth / 10; // maxGutterSize = 76
		
		// childWidthSize = 768, getPaddingLeft() = getPaddingRight() = 0
        int childWidthSize = measuredWidth - getPaddingLeft() - getPaddingRight();
        // childHeightSize = 1042, getPaddingTop() = getPaddingBottom() = 0
        int childHeightSize = getMeasuredHeight() - getPaddingTop() - getPaddingBottom();

		int size = getChildCount(); // size = 0

		mChildWidthMeasureSpec = MeasureSpec.makeMeasureSpec(childWidthSize, MeasureSpec.EXACTLY);
        mChildHeightMeasureSpec = MeasureSpec.makeMeasureSpec(childHeightSize, MeasureSpec.EXACTLY);

		// 确保我们已经创建了所有我们需要显示的 fragments。
        mInLayout = true;
        populate();
        mInLayout = false;

		// 遍历所有已缓存的页面.
        size = getChildCount(); // size = 3
        for (int i = 0; i < size; ++i) {
            final View child = getChildAt(i);
            if (child.getVisibility() != GONE) {
                if (DEBUG) Log.v(TAG, "Measuring #" + i + " " + child
                        	+ ": " + mChildWidthMeasureSpec);

                final LayoutParams lp = (LayoutParams) child.getLayoutParams();
                if (lp == null || !lp.isDecor) {
                    final int widthSpec = MeasureSpec.makeMeasureSpec(
                            (int) (childWidthSize * lp.widthFactor), MeasureSpec.EXACTLY);
                    child.measure(widthSpec, mChildHeightMeasureSpec);
                }
            }
        }
	}

	void populate(int newCurrentItem) { // newCurrentItem = 1
        ItemInfo oldCurInfo = null;
        int focusDirection = View.FOCUS_FORWARD; // focusDirection = 2
		mAdapter.startUpdate(this); // 显示页面开始改变
		final int pageLimit = mOffscreenPageLimit; // pageLimit = 1

		/* 预加载页面的起始位置 */
        final int startPos = Math.max(0, mCurItem - pageLimit);  // mCurItem = 1, startPos = 0
		/* 当前页面的数量 */
        final int N = mAdapter.getCount(); // N = 7
		/* 预加载页面的结束位置 */
        final int endPos = Math.min(N - 1, mCurItem + pageLimit); // endPos = 2

		// 定位当前显示页面的 item
        int curIndex = -1;
        ItemInfo curItem = null;
		if (curItem == null && N > 0) {
			// 添加新的item
            curItem = addNewItem(mCurItem, curIndex);
        }
		if (curItem != null) {
            float extraWidthLeft = 0.f;
            int itemIndex = curIndex - 1; // curIndex = 0, itemIndex = -1

				/* 获取当前页面左边的 item */
		        ItemInfo ii = itemIndex >= 0 ? mItems.get(itemIndex) : null; // ii = null
        	final int clientWidth = getClientWidth(); // clientWidth = 768
			// leftWidthNeeded = 1.0, curItem.widthFactor = 1.0, getPaddingLeft() = 0
    	    final float leftWidthNeeded = clientWidth <= 0 ? 0 :
        		2.f - curItem.widthFactor + (float) getPaddingLeft() / (float) clientWidth;
			/* 遍历当前页面左边的所有 item,创建并保存预加载范围内的页面，移除范围外的页面 */
        	for (int pos = mCurItem - 1; pos >= 0; pos--) { // pos = 0, mCurItem = 1
				/* 如果页面在预加载页面的范围外，这里是左边，而且保存的item不为null时移除该页面 */
            	if (extraWidthLeft >= leftWidthNeeded && pos < startPos) { // startPos = 0
               		if (ii == null) {
                   		break;
                	}
					if (pos == ii.position && !ii.scrolling) {
                		mItems.remove(itemIndex);
                    	mAdapter.destroyItem(this, pos, ii.object);
                    	if (DEBUG) {
                    	Log.i(TAG, "populate() - destroyItem() with pos: " + pos +
                    			" view: " + ((View) ii.object));
                    	}
                    	itemIndex--;
                    	curIndex--;
                    	ii = itemIndex >= 0 ? mItems.get(itemIndex) : null;
                    	}
            	} else if (ii != null && pos == ii.position) {
            		extraWidthLeft += ii.widthFactor;
                	itemIndex--;
                	ii = itemIndex >= 0 ? mItems.get(itemIndex) : null;
            	} else {
					// 知道了ii为null，该pos位置的页面是当前页的左边的页面，而且在预存范围内，这个时候调用 addnewIteam(0,0);
                	ii = addNewItem(pos, itemIndex + 1);
                	extraWidthLeft += ii.widthFactor; // extraWidthLeft = 1.0
                	curIndex++; // curIndex = 1
                	ii = itemIndex >= 0 ? mItems.get(itemIndex) : null;
            	}		
			}

			float extraWidthRight = curItem.widthFactor; // extraWidthRight = 1.0

			/* 当前页面右面页面的索引 */
        	itemIndex = curIndex + 1; // itemIndex = 2
        	if (extraWidthRight < 2.f) {
        		// itemIndex = 2, mItems.size() = 2, ii = null
            	ii = itemIndex < mItems.size() ? mItems.get(itemIndex) : null;
            	// clientWidth = 768, getPaddingRight() = 0, rightWidthNeeded = 2.f
            	final float rightWidthNeeded = clientWidth <= 0 ? 0 :
            			(float) getPaddingRight() / (float) clientWidth + 2.f;
				/* 遍历当前页面右边的页面,创建并保存预加载范围内的页面，移除范围外的页面 */
            	// N = 7, mCurItem = 1, 初始化 pos = 2,itemIndex = 2,之后每次加1
            	for (int pos = mCurItem + 1; pos < N; pos++) { 
            		// 初始化extraWidthright = 1之后每次加1, rightWidthNeeded = 2, endPos = 2
                	if (extraWidthRight >= rightWidthNeeded && pos > endPos) {
                		if (ii == null) {
                 	   		break; // 从这里跳出
                    	}
                    	if (pos == ii.position && !ii.scrolling) {
                    		mItems.remove(itemIndex);
                        	mAdapter.destroyItem(this, pos, ii.object);
                        	if (DEBUG) {
                        		Log.i(TAG, "populate() - destroyItem() with pos: " + pos +
                         	   		" view: " + ((View) ii.object));
                        	}
                        	ii = itemIndex < mItems.size() ? mItems.get(itemIndex) : null;
                    	}
                	} else if (ii != null && pos == ii.position) {
                		extraWidthRight += ii.widthFactor;
                    	itemIndex++;
                    	ii = itemIndex < mItems.size() ? mItems.get(itemIndex) : null;
                	} else {
                		// 调用 addNewItem(2,2)
                    	ii = addNewItem(pos, itemIndex);
                    	itemIndex++; // itemIndex = 3
                    	extraWidthRight += ii.widthFactor; // extraWidthRight = 1.0
                    	ii = itemIndex < mItems.size() ? mItems.get(itemIndex) : null;
                	}
            	}
        	}

        	/* 重置所有页面的偏移 */
        	calculatePageOffsets(curItem, curIndex, oldCurInfo);
		}
		if (DEBUG) {
            Log.i(TAG, "Current page list:");
            for (int i = 0; i < mItems.size(); i++) {
                Log.i(TAG, "#" + i + ": page " + mItems.get(i).position);
            }
        }
		// 设置主要的view为当前 mCurItem
		mAdapter.setPrimaryItem(this, mCurItem, curItem != null ? curItem.object : null);

        mAdapter.finishUpdate(this); // 显示更新结束
	}

	/**
     	* 在 item的数组里 position位置添加个新的 Item
     	*
     	* @param position
     	* @param index
     	* @return
     */
    ItemInfo addNewItem(int position, int index) { // index = 0, position = 1
        ItemInfo ii = new ItemInfo(); // 创建一个ItemInfo对象
        ii.position = position;
        ii.object = mAdapter.instantiateItem(this, position); // 调用 addView 方法
        ii.widthFactor = mAdapter.getPageWidth(position); // ii.widthFactor = 1, getPageWidth 方法默认返回1
        if (index < 0 || index >= mItems.size()) {
            mItems.add(ii);
        } else {
            mItems.add(index, ii);
        }
		if (index < 0 || index >= mItems.size()) { // mItems.size() = 0, index = 0
            mItems.add(ii); // 添加到页面预存数组里
        } else {
            mItems.add(index, ii);
        }
        
        return ii;
    }


	@Override
    public void addView(View child, int index, ViewGroup.LayoutParams params) { // index = -1
        Log.i(TAG, "addView");
        if (!checkLayoutParams(params)) { // 检查参数是否是 ViewGroup.LayoutParams实例
            params = generateLayoutParams(params);
        }	
		final LayoutParams lp = (LayoutParams) params;
        lp.isDecor |= child instanceof Decor; // 判断是不是挂件视图,lp.isDecor = false
        if (mInLayout) { // mInLayout = true
            if (lp != null && lp.isDecor) {
                throw new IllegalStateException("Cannot add pager decor view during layout");
            }
            lp.needsMeasure = true;
            addViewInLayout(child, index, params); // 如果index为-1，则添加到 mChildrenCount 位置，mChildrenCount = 0
        } else {
            super.addView(child, index, params);
        }
	}

	/**
    	 * 计算所有页面的偏移量
     	*
     	* @param curItem
     	* @param curIndex
     	* @param oldCurInfo
     */
    private void calculatePageOffsets(ItemInfo curItem, int curIndex, ItemInfo oldCurInfo) {
        final int N = mAdapter.getCount(); // N = 7
        final int width = getClientWidth(); // width = 768
        final float marginOffset = width > 0 ? (float) mPageMargin / width : 0; // marginOffset = 0
        // Fix up offsets for later layout.
		
		// Base all offsets off of curItem.
        final int itemCount = mItems.size(); // itemCount = 3
        float offset = curItem.offset; // offset = 0
        int pos = curItem.position - 1; // pos = 0
        mFirstOffset = curItem.position == 0 ? curItem.offset : -Float.MAX_VALUE; // mFirstOffset = -3.4028235E38
        mLastOffset = curItem.position == N - 1 ?
                curItem.offset + curItem.widthFactor - 1 : Float.MAX_VALUE; // mLastOffset = 3.4028235E38
		
		// 遍历上一页，curIndex = 1
        for (int i = curIndex - 1; i >= 0; i--, pos--) {
            final ItemInfo ii = mItems.get(i);
            while (pos > ii.position) {
                offset -= mAdapter.getPageWidth(pos--) + marginOffset;
            }
            offset -= ii.widthFactor + marginOffset;
            ii.offset = offset; // ii.offset = -1
            if (ii.position == 0) mFirstOffset = offset; // mFirstOffset = -1
        }
		offset = curItem.offset + curItem.widthFactor + marginOffset; // offset = 1, 所有item的widthFactor = 1
        pos = curItem.position + 1; // pos = 2
		// 遍历下一页, curIndex = 1, itemCount = 3
        for (int i = curIndex + 1; i < itemCount; i++, pos++) {
            final ItemInfo ii = mItems.get(i);
            while (pos < ii.position) {
                offset += mAdapter.getPageWidth(pos++) + marginOffset;
            }
            if (ii.position == N - 1) {
                mLastOffset = offset + ii.widthFactor - 1;
            }
            ii.offset = offset; //ii.offset = 1
            offset += ii.widthFactor + marginOffset;
        }

        mNeedCalculatePageOffsets = false;
	}

第一次onMeasure是初始化往父布局的 mSortedHorizontalChildren 存储 ViewPager，然后循环存储 adapter里的 childview，直到全部存储完毕，onMeasure循环测量了八次。 

	private View[] mSortedHorizontalChildren;

### 接下来是 onSizeChanged(int w, int h, int oldw, int oldh)

	// h = 360, w = 768, 高是我固定的
	@Override
    protected void onSizeChanged(int w, int h, int oldw, int oldh) {
        // oldh = 0, oldw = 0
        super.onSizeChanged(w, h, oldw, oldh);

        // 确保滚动的位置是设置正确的
        // Make sure scroll position is set correctly.
        if (w != oldw) {
			// recomputeScrollPosition(768, 0, 0, 0);
            recomputeScrollPosition(w, oldw, mPageMargin, mPageMargin);
        }
    }
	
	private void recomputeScrollPosition(int width, int oldWidth, int margin, int oldMargin) {
        if (oldWidth > 0 && !mItems.isEmpty()) {
            ...
            }
        } else {
			// mCurItem = 1, 目前是以 索引为1的页面为起始页，即 offset 是1，索引0的 offset 是 -1
            final ItemInfo ii = infoForPosition(mCurItem);
			// scrollOffset = 0
            final float scrollOffset = ii != null ? Math.min(ii.offset, mLastOffset) : 0;
			// scrollPos = 0
            final int scrollPos = (int) (scrollOffset *
                    (width - getPaddingLeft() - getPaddingRight()));
            if (scrollPos != getScrollX()) { // getScrollY() = 0， scrollPos = 0
                completeScroll(false);
                scrollTo(scrollPos, getScrollY());
            }
        }
    }
	
### onLayout(boolean changed, int l, int t, int r, int b)

t = 0, l = 0, b = 360, r = 768, 我把高固定为 180dp.

	@Override
    protected void onLayout(boolean changed, int l, int t, int r, int b) {
        Log.i(TAG, "onLayout");
        final int count = getChildCount(); // 预存的子 view 的数量， 3
        int width = r - l; // width = 768
        int height = b - t; // height = 360
        int paddingLeft = getPaddingLeft(); // paddingLeft = 0
        int paddingTop = getPaddingTop();  // paddingTop = 0
        int paddingRight = getPaddingRight();  // paddingRight = 0
        int paddingBottom = getPaddingBottom();  // paddingBottom = 0
        final int scrollX = getScrollX(); // scrollx = 0

        int decorCount = 0;

        // First pass - decor views. We need to do this in two passes so that
        // we have the proper offsets for non-decor views later.
        for (int i = 0; i < count; i++) {
            final View child = getChildAt(i);
            if (child.getVisibility() != GONE) {
                final LayoutParams lp = (LayoutParams) child.getLayoutParams();
                int childLeft = 0;
                int childTop = 0;
                if (lp.isDecor) {
                    // 判断是否是挂饰视图，我没设置，掠过
                }
            }
        }

        final int childWidth = width - paddingLeft - paddingRight; // childWidth = 768
        // 页面视图。
        // Page views. Do this once we have the right padding offsets from above.
        for (int i = 0; i < count; i++) {
			// 根据添加childe view的顺序，获取child，第索引为1的页面因为首先被添加，所以先被获取到，然后是左边页面，最后是右边页面
            final View child = getChildAt(i); 
            if (child.getVisibility() != GONE) {
                final LayoutParams lp = (LayoutParams) child.getLayoutParams();
                ItemInfo ii;
                if (!lp.isDecor && (ii = infoForChild(child)) != null) { // 调用infoForChild(child)通过 view 获取 ItemInfo
                    int loff = (int) (childWidth * ii.offset); // ii.offset = 『0，-1,1』 , loff = 『0，-768,768』
                    int childLeft = paddingLeft + loff; // 页面的左边框位置, childLeft = 『0，-768,768』
                    int childTop = paddingTop; // childTop = 0
                    if (lp.needsMeasure) { // lp.needsMeasure = true
                        // This was added during layout and needs measurement.
                        // Do it now that we know what we're working with.
                        lp.needsMeasure = false;
                        final int widthSpec = MeasureSpec.makeMeasureSpec(
                                (int) (childWidth * lp.widthFactor),  // childWidth = 768， lp.widthFactor = 1.0
                                MeasureSpec.EXACTLY);
                        final int heightSpec = MeasureSpec.makeMeasureSpec(
                                (int) (height - paddingTop - paddingBottom),  // height = 360, paddingTop=paddingBottom=0
                                MeasureSpec.EXACTLY);
                        child.measure(widthSpec, heightSpec);
                    }
                    if (DEBUG) Log.v(TAG, "Positioning #" + i + " " + child + " f=" + ii.object
                            	+ ":" + childLeft + "," + childTop + " " + child.getMeasuredWidth()
                            	+ "x" + child.getMeasuredHeight());
                    // childLeft = 『0，-768,768』
					child.layout(childLeft, childTop,
                            childLeft + child.getMeasuredWidth(),
                            childTop + child.getMeasuredHeight());
                }
            }
        }
        mTopPageBounds = paddingTop; // mTopPageBounds = 0
        mBottomPageBounds = height - paddingBottom;  // mBottomPageBounds = 360
        mDecorChildCount = decorCount; // mDecorChildCount = 0

        // 如果是第一次布局，则滑动到当前设置的页面位置
        if (mFirstLayout) {  // mFirstLayout = true
            scrollToItem(mCurItem, false, 0, false);
        }
        mFirstLayout = false;  // 现在，第一次布局就结束了
    }

		/**
		* 通过 view 获取 ItemInfo
		**/
	ItemInfo infoForChild(View child) {
        for (int i = 0; i < mItems.size(); i++) {
            ItemInfo ii = mItems.get(i);
            if (mAdapter.isViewFromObject(child, ii.object)) {
                return ii;
            }
        }
        return null;
    }

	/**
     	* 滑动到 item 页
     	*
     	* @param item
     	* @param smoothScroll
     	* @param velocity
     	* @param dispatchSelected
     */
    private void scrollToItem(int item, boolean smoothScroll, int velocity,
                              boolean dispatchSelected) {
        final ItemInfo curInfo = infoForPosition(item);
        int destX = 0;
        if (curInfo != null) {
            final int width = getClientWidth();  // width = 768
            // 获取 item 的水平 x 偏移值， destX = 0, mFirstOffset = -1, mLastOffset = 3.4028235E38, curInfo.offset = 0
            destX = (int) (width * Math.max(mFirstOffset,
                    Math.min(curInfo.offset, mLastOffset)));
        }
        if (smoothScroll) { // smoothScroll = false
            // 如果平滑的滑动
            smoothScrollTo(destX, 0, velocity);
            if (dispatchSelected) {
                dispatchOnPageSelected(item);
            }
        } else {
            if (dispatchSelected) {  // dispatchSelected = false
                dispatchOnPageSelected(item);
            }
            completeScroll(false);
            scrollTo(destX, 0); // 滚动到（0，0）位置
            pageScrolled(destX);
        }
    }

	private void completeScroll(boolean postEvents) {
        boolean needPopulate = mScrollState == SCROLL_STATE_SETTLING; // needPopulate = false
        if (needPopulate) {
            // ...
            }
        }
        mPopulatePending = false;
		// 遍历预存的所有页面
        for (int i = 0; i < mItems.size(); i++) {
            ItemInfo ii = mItems.get(i);
            if (ii.scrolling) { // ii.scrolling 三个页面都是 false
                needPopulate = true;
                ii.scrolling = false;
            }
        }
        if (needPopulate) { // needPopulate = false
            if (postEvents) {
                ViewCompat.postOnAnimation(this, mEndScrollRunnable);
            } else {
                mEndScrollRunnable.run();
            }
        }
    }

	private boolean pageScrolled(int xpos) {
        
        // 当前滚动位置的页面的信息
        final ItemInfo ii = infoForCurrentScrollPosition();
        final int width = getClientWidth();  // width = 768
        final int widthWithMargin = width + mPageMargin;  // widthWithMargin = 768
        final float marginOffset = (float) mPageMargin / width;
        final int currentPage = ii.position;  // currentPage = 1
		// xpos = 0, width = 768, pageOffset = 0, 当前是第(索引1)页，ii.offset = 0
        final float pageOffset = (((float) xpos / width) - ii.offset) /
                (ii.widthFactor + marginOffset);
        final int offsetPixels = (int) (pageOffset * widthWithMargin);  // offsetPixels = 0

        mCalledSuper = false;
        onPageScrolled(currentPage, pageOffset, offsetPixels); // 调用这个方法后 mCalledSuper = true
        if (!mCalledSuper) {
            throw new IllegalStateException(
                    "onPageScrolled did not call superclass implementation");
        }
        return true;
    }

	/**
     	* @return 当前滚动位置的页面的信息。
     	* This can be synthetic for a missing middle page; the 'object' field can be null.
     */
    private ItemInfo infoForCurrentScrollPosition() {
        final int width = getClientWidth();  // width = 768
        final float scrollOffset = width > 0 ? (float) getScrollX() / width : 0;  // scrollOffset = 0
        final float marginOffset = width > 0 ? (float) mPageMargin / width : 0;  // marginOffset = 0
        int lastPos = -1;
        float lastOffset = 0.f;
        float lastWidth = 0.f;
        boolean first = true;

        ItemInfo lastItem = null;
		// 遍历所有预存的页面
        for (int i = 0; i < mItems.size(); i++) {
            ItemInfo ii = mItems.get(i); // mItems 的页面存储顺序是从左往右的顺序
            float offset;
            if (!first && ii.position != lastPos + 1) {  // 第一次不进来,第二次开始判断这一页是否丢失
                // Create a synthetic item for a missing page.
                ii = mTempItem;
                ii.offset = lastOffset + lastWidth + marginOffset;
                ii.position = lastPos + 1;
                ii.widthFactor = mAdapter.getPageWidth(ii.position);
                i--;
            }
            offset = ii.offset;  // ii.offset = {-1, 0, 1}

			// bound 的意思 『-1』 页[0] 『0』 页[1] 『1』  页[2]  『2』 ， 『n』代表边界
            final float leftBound = offset;  // leftBound = {-1, 0, 1}
            final float rightBound = offset + ii.widthFactor + marginOffset; // rightBound = {0, 1, 2}
            if (first || scrollOffset >= leftBound) {  // scrollOffset = 0
                if (scrollOffset < rightBound || i == mItems.size() - 1) {
                    return ii;
                }
            } else {
                return lastItem;
            }
            first = false;
            lastPos = ii.position;
            lastOffset = offset;
            lastWidth = ii.widthFactor;
            lastItem = ii; // 存储已经检查过的 item
        }

        return lastItem;
    }

	/**
     	* 当页面被选择的时候，这个方法被调用。要么是代码启动平滑滚动或者用户触摸滑动。
     	* 如果你重写这个方法，一定要调用父类的实现方法(e.g. super.onPageScrolled(position, offset, offsetPixels))。
     	*
     	* @param position     position 索引是当前展示页面的第一页索引，当offset为0时，position+1会展示出来。
     	* @param offset       页面位置的偏移，取值[0,1)。
     	* @param offsetPixels 页面偏移的像素大小。
     */
    @CallSuper
    protected void onPageScrolled(int position, float offset, int offsetPixels) {
        // 保证挂件视图一直在屏幕上.
        if (mDecorChildCount > 0) {
            // ...
        }

        // 回调接口的 onPageScrolled 方法
        dispatchOnPageScrolled(position, offset, offsetPixels);

        // 切换动画, 这里我没有设置， 是null
        if (mPageTransformer != null) {
            final int scrollX = getScrollX();
            final int childCount = getChildCount();
            for (int i = 0; i < childCount; i++) {
                final View child = getChildAt(i);
                final LayoutParams lp = (LayoutParams) child.getLayoutParams();

                if (lp.isDecor) continue;

                final float transformPos = (float) (child.getLeft() - scrollX) / getClientWidth();
                mPageTransformer.transformPage(child, transformPos);
            }
        }

        mCalledSuper = true;
    }

当页面位置陈列好后，又进行了 8次测量，调用了8次 onMeasure 方法, 完成测量后，又调用了一次 onLayout 方法。

### draw(Canvas canvas) 和 onDraw(Canvas canvas) 方法被调用

	@Override
    public void draw(Canvas canvas) {
        Log.i(TAG, "draw");

        /*
         	*  super.draw(canvas) 会顺序执行以下几个功能：
	        *      1. 绘制background
         	*      2. If necessary, save the canvas' layers to prepare for fading
         	*      3. 调用 onDraw(Canvas canvas);
         	*      4. Draw children ，调用 dispatchDraw(canvas);
         	*      5. If necessary, draw the fading edges and restore layers
         	*      6. Draw decorations (scrollbars for instance), 调用 onDrawForeground(canvas);
         */
        super.draw(canvas);  // 在这里先调用了 onDraw

        // 主要用于初始化绘制边缘效果
        boolean needsInvalidate = false;

        final int overScrollMode = ViewCompat.getOverScrollMode(this);
        if (overScrollMode == ViewCompat.OVER_SCROLL_ALWAYS ||
                (overScrollMode == ViewCompat.OVER_SCROLL_IF_CONTENT_SCROLLS &&
                        mAdapter != null && mAdapter.getCount() > 1)) {
            if (!mLeftEdge.isFinished()) {
                final int restoreCount = canvas.save();
                final int height = getHeight() - getPaddingTop() - getPaddingBottom();
                final int width = getWidth();

                canvas.rotate(270);
                canvas.translate(-height + getPaddingTop(), mFirstOffset * width);
                mLeftEdge.setSize(height, width);
                needsInvalidate |= mLeftEdge.draw(canvas);
                canvas.restoreToCount(restoreCount);
            }
            if (!mRightEdge.isFinished()) {
                final int restoreCount = canvas.save();
                final int width = getWidth();
                final int height = getHeight() - getPaddingTop() - getPaddingBottom();

                canvas.rotate(90);
                canvas.translate(-getPaddingTop(), -(mLastOffset + 1) * width);
                mRightEdge.setSize(height, width);
                needsInvalidate |= mRightEdge.draw(canvas);
                canvas.restoreToCount(restoreCount);
            }
        } else {
            mLeftEdge.finish();
            mRightEdge.finish();
        }

        if (needsInvalidate) {
            // Keep animating
            ViewCompat.postInvalidateOnAnimation(this);
        }
    }

    @Override
    protected void onDraw(Canvas canvas) {
        Log.i(TAG, "onDraw");
        super.onDraw(canvas);

        // 主要用于绘制页面之间的 margin drawable， 这里我没有设置，所以直接就跳过了
        // Draw the margin drawable between pages if needed.
        if (mPageMargin > 0 && mMarginDrawable != null && mItems.size() > 0 && mAdapter != null) {
            final int scrollX = getScrollX();
            final int width = getWidth();

            final float marginOffset = (float) mPageMargin / width;
            int itemIndex = 0;
            ItemInfo ii = mItems.get(0);
            float offset = ii.offset;
            final int itemCount = mItems.size();
            final int firstPos = ii.position;
            final int lastPos = mItems.get(itemCount - 1).position;
            for (int pos = firstPos; pos < lastPos; pos++) {
                while (pos > ii.position && itemIndex < itemCount) {
                    ii = mItems.get(++itemIndex);
                }

                float drawAt;
                if (pos == ii.position) {
                    drawAt = (ii.offset + ii.widthFactor) * width;
                    offset = ii.offset + ii.widthFactor + marginOffset;
                } else {
                    float widthFactor = mAdapter.getPageWidth(pos);
                    drawAt = (offset + widthFactor) * width;
                    offset += widthFactor + marginOffset;
                }

                if (drawAt + mPageMargin > scrollX) {
                    mMarginDrawable.setBounds((int) drawAt, mTopPageBounds,
                            (int) (drawAt + mPageMargin + 0.5f), mBottomPageBounds);
                    mMarginDrawable.draw(canvas);
                }

                if (drawAt > scrollX + width) {
                    break; // No more visible, no sense in continuing
                }
            }
        }
    }

### 最后调用了 computeScroll() 

 	
	@Override
    public void computeScroll() {
        if (!mScroller.isFinished() && mScroller.computeScrollOffset()) { // mScroller.isFinished() = true
            int oldX = getScrollX();
            int oldY = getScrollY();
            int x = mScroller.getCurrX();
            int y = mScroller.getCurrY();

            if (oldX != x || oldY != y) {
                scrollTo(x, y);
                if (!pageScrolled(x)) {
                    mScroller.abortAnimation();
                    scrollTo(0, y);
                }
            }

            // Keep on drawing until the animation has finished.
            ViewCompat.postInvalidateOnAnimation(this);
            return;
        }

        // 完成滚动，清除状态
        completeScroll(true);
    }

	private void completeScroll(boolean postEvents) {
		// mScrollState = 0,即静止状态，不是滑动结束后固定下来的状态
        boolean needPopulate = mScrollState == SCROLL_STATE_SETTLING; 
        if (needPopulate) {
            // Done with scroll, no longer want to cache view drawing.
            setScrollingCacheEnabled(false);
            mScroller.abortAnimation();
            int oldX = getScrollX();
            int oldY = getScrollY();
            int x = mScroller.getCurrX();
            int y = mScroller.getCurrY();
            if (oldX != x || oldY != y) {
                scrollTo(x, y);
                if (x != oldX) {
                    pageScrolled(x);
                }
            }
        }
        mPopulatePending = false;
        for (int i = 0; i < mItems.size(); i++) {
            ItemInfo ii = mItems.get(i);
            if (ii.scrolling) {
                needPopulate = true;
                ii.scrolling = false;
            }
        }
        if (needPopulate) {
            if (postEvents) {
                ViewCompat.postOnAnimation(this, mEndScrollRunnable);
            } else {
                mEndScrollRunnable.run();
            }
        }
    }


到此为止，ViewPager 已经初始化创建完毕了,解下来就是手势监听的一些理解。

## ViewPager 的手势监听
首先是三个标志位
	/**
     	* 表明这个页面是闲置状态。当前页面在view上是完整的，并且没有动画。
     	* Indicates that the pager is in an idle, settled state. The current page
     	* is fully in view and no animation is in progress.
     */
    public static final int SCROLL_STATE_IDLE = 0;

    /**
     	* 表明当前页面正在被用户拖拽。
     	* Indicates that the pager is currently being dragged by the user.
     */
    public static final int SCROLL_STATE_DRAGGING = 1;

    /**
     	* 表明页面已经固定下来，即滑动结束
     	* Indicates that the pager is in the process of settling to a final position.
     */
    public static final int SCROLL_STATE_SETTLING = 2;

### onInterceptTouchEvent 事件拦截

 	
	@Override
    public boolean onInterceptTouchEvent(MotionEvent ev) {
        Log.i(TAG, "onInterceptTouchEvent");
        /*
         	* 这个方法决定我们是否需要拦截动作行为。
         	* 如果返回true，onMotionEvent方法就会被调用，在那里进行实际的滚蛋你个操作。
         */

        final int action = ev.getAction() & MotionEventCompat.ACTION_MASK;

        // 总是要判断触摸手势是否已经完成。
        // Always take care of the touch gesture being complete.
        if (action == MotionEvent.ACTION_CANCEL || action == MotionEvent.ACTION_UP) {
            // 释放拖拽.
            if (DEBUG) Log.v(TAG, "Intercept done!");
            resetTouch();
            return false;
        }

        // 如果已经决定是否拖拽，则不要做更多的事。
        // Nothing more to do here if we have decided whether or not we
        // are dragging.
        if (action != MotionEvent.ACTION_DOWN) {
            if (mIsBeingDragged) {
                if (DEBUG) Log.v(TAG, "Intercept returning true!");
                return true;
            }
            if (mIsUnableToDrag) {
                if (DEBUG) Log.v(TAG, "Intercept returning false!");
                return false;
            }
        }

        switch (action) {
            case MotionEvent.ACTION_MOVE: {
                /*
                 	* mIsBeingDragged == false, 否则事件已经被拦截。检查是否用户从原始的按下触摸点移动到足够远的地方。
                 */

                /*
                	* Locally do absolute value. mLastMotionY is set to the y value
                	* of the down event.
                */
                final int activePointerId = mActivePointerId;
                if (activePointerId == INVALID_POINTER) {
                    // 如果我们没有一个有效的id， 那么我们按下的触摸事件没有发生在content中。
                    break;
                }

                final int pointerIndex = MotionEventCompat.findPointerIndex(ev, activePointerId);
                final float x = MotionEventCompat.getX(ev, pointerIndex);
                final float dx = x - mLastMotionX; // 手指移动的水平方向的距离
                final float xDiff = Math.abs(dx); // 手指移动的距离的水平方向的绝对值
                final float y = MotionEventCompat.getY(ev, pointerIndex);
                final float yDiff = Math.abs(y - mInitialMotionY); // 手指移动的距离的垂直方向的绝对值
                if (DEBUG) Log.v(TAG, "Moved x to " + x + "," + y + " diff=" + xDiff + "," + yDiff);

                if (dx != 0 && !isGutterDrag(mLastMotionX, dx) &&
                        canScroll(this, false, (int) dx, (int) x, (int) y)) {
                    // Nested view has scrollable area under this point. Let it be handled there.
                    mLastMotionX = x;
                    mLastMotionY = y;
                    mIsUnableToDrag = true;
                    return false;
                }
                if (xDiff > mTouchSlop && xDiff * 0.5f > yDiff) {
                    // 开始拖拽,拦截事件
                    if (DEBUG) Log.v(TAG, "Starting drag!");
                    mIsBeingDragged = true;
                    requestParentDisallowInterceptTouchEvent(true);
                    setScrollState(SCROLL_STATE_DRAGGING);
                    // 存储移动后的x，y点
                    mLastMotionX = dx > 0 ? mInitialMotionX + mTouchSlop :
                            mInitialMotionX - mTouchSlop;
                    mLastMotionY = y;
                    setScrollingCacheEnabled(true);
                } else if (yDiff > mTouchSlop) {
                    // 如果用户是垂直方向上的移动则不进行拦截，不能拦截
                    // The finger has moved enough in the vertical
                    // direction to be counted as a drag...  abort
                    // any attempt to drag horizontally, to work correctly
                    // with children that have scrolling containers.
                    if (DEBUG) Log.v(TAG, "Starting unable to drag!");
                    mIsUnableToDrag = true;
                }
                if (mIsBeingDragged) {
                    // 执行手指触摸时的拖拽
                    if (performDrag(x)) {
                        ViewCompat.postInvalidateOnAnimation(this);
                    }
                }
                break;
            }

            case MotionEvent.ACTION_DOWN: {
                /*
                 	* 记录按下触摸的位置。
                 	* Remember location of down touch.
                	 * ACTION_DOWN 总是指第0个索引的触摸点，即当前触摸的第一个手指的触摸点.
                 */
                mLastMotionX = mInitialMotionX = ev.getX();
                mLastMotionY = mInitialMotionY = ev.getY();
                mActivePointerId = MotionEventCompat.getPointerId(ev, 0);
                mIsUnableToDrag = false;

                mScroller.computeScrollOffset();
                if (mScrollState == SCROLL_STATE_SETTLING &&
                        Math.abs(mScroller.getFinalX() - mScroller.getCurrX()) > mCloseEnough) {
                    // 如果页面用户触摸的页面处于 SCROLL_STATE_SETTLING 状态
                    // mScroller.getFinalX()指页面移动结束的位置。

                    // 让用户“抓住”页面。
                    // Let the user 'catch' the pager as it animates.
                    mScroller.abortAnimation();
                    mPopulatePending = false;
                    populate();
                    mIsBeingDragged = true; // 开始拖拽
                    requestParentDisallowInterceptTouchEvent(true);
                    setScrollState(SCROLL_STATE_DRAGGING); // 设置 滚动 状态为拖拽
                } else {
                    completeScroll(false);
                    mIsBeingDragged = false;
                }

                if (DEBUG) Log.v(TAG, "Down at " + mLastMotionX + "," + mLastMotionY
                       	 	+ " mIsBeingDragged=" + mIsBeingDragged
                        	+ "mIsUnableToDrag=" + mIsUnableToDrag);
                break;
            }

            case MotionEventCompat.ACTION_POINTER_UP:
                onSecondaryPointerUp(ev);
                break;
        }

        if (mVelocityTracker == null) {
            mVelocityTracker = VelocityTracker.obtain();
        }
        mVelocityTracker.addMovement(ev);

        /*
         	* 只有在我门进入拖拽模式的时候才去拦截事件
         */
        return mIsBeingDragged;
    }


### onTouchEvent 触摸事件的处理
	
	@Override
    public boolean onTouchEvent(MotionEvent ev) {
        Log.i(TAG, "onTouchEvent");
        if (mFakeDragging) {
            // 多点触摸拦截事件
            // A fake drag is in progress already, ignore this real one
            // but still eat the touch events.
            // (It is likely that the user is multi-touching the screen.)
            return true;
        }

        if (ev.getAction() == MotionEvent.ACTION_DOWN && ev.getEdgeFlags() != 0) {
            // 不要立即处理边缘触摸
            // Don't handle edge touches immediately -- they may actually belong to one of our
            // descendants.
            return false;
        }

        if (mAdapter == null || mAdapter.getCount() == 0) {
            // Nothing to present or scroll; nothing to touch.
            return false;
        }

        if (mVelocityTracker == null) {
            // 速度检测器
            mVelocityTracker = VelocityTracker.obtain();
        }
        mVelocityTracker.addMovement(ev);

        final int action = ev.getAction();
        boolean needsInvalidate = false;

        switch (action & MotionEventCompat.ACTION_MASK) {
            case MotionEvent.ACTION_DOWN: { // 按下
                mScroller.abortAnimation();
                mPopulatePending = false;
                populate();

                // 记录按下触摸的点
                mLastMotionX = mInitialMotionX = ev.getX();
                mLastMotionY = mInitialMotionY = ev.getY();
                mActivePointerId = MotionEventCompat.getPointerId(ev, 0);
                break;
            }
            case MotionEvent.ACTION_MOVE:
                if (!mIsBeingDragged) {
                    final int pointerIndex = MotionEventCompat.findPointerIndex(ev, mActivePointerId);
                    if (pointerIndex == -1) {
                        // A child has consumed some touch events and put us into an inconsistent state.
                        needsInvalidate = resetTouch();
                        break;
                    }
                    final float x = MotionEventCompat.getX(ev, pointerIndex);
                    final float xDiff = Math.abs(x - mLastMotionX);
                    final float y = MotionEventCompat.getY(ev, pointerIndex);
                    final float yDiff = Math.abs(y - mLastMotionY);
                    if (DEBUG)
                        Log.v(TAG, "Moved x to " + x + "," + y + " diff=" + xDiff + "," + yDiff);
                    if (xDiff > mTouchSlop && xDiff > yDiff) {
                        // 开始拖拽
                        if (DEBUG) Log.v(TAG, "Starting drag!");
                        mIsBeingDragged = true;
                        requestParentDisallowInterceptTouchEvent(true);
                        mLastMotionX = x - mInitialMotionX > 0 ? mInitialMotionX + mTouchSlop :
                                mInitialMotionX - mTouchSlop;
                        mLastMotionY = y;
                        setScrollState(SCROLL_STATE_DRAGGING);
                        setScrollingCacheEnabled(true);

                        // 不允许parent拦截
                        ViewParent parent = getParent();
                        if (parent != null) {
                            parent.requestDisallowInterceptTouchEvent(true);
                        }
                    }
                }
                // Not else! Note that mIsBeingDragged can be set above.
                if (mIsBeingDragged) {
                    // Scroll to follow the motion event
                    final int activePointerIndex = MotionEventCompat.findPointerIndex(
                            ev, mActivePointerId);
                    final float x = MotionEventCompat.getX(ev, activePointerIndex);
                    // 执行手指拖拽
                    needsInvalidate |= performDrag(x);
                }
                break;
            case MotionEvent.ACTION_UP:
                if (mIsBeingDragged) { // 如果是拖拽状态
                    final VelocityTracker velocityTracker = mVelocityTracker;
                    velocityTracker.computeCurrentVelocity(1000, mMaximumVelocity);
                    // 获取滑动速度
                    int initialVelocity = (int) VelocityTrackerCompat.getXVelocity(
                            velocityTracker, mActivePointerId);
                    mPopulatePending = true;
                    final int width = getClientWidth();
                    final int scrollX = getScrollX();
                    // 获取当前页的item信息
                    final ItemInfo ii = infoForCurrentScrollPosition();
                    // 存储当前页面的位置索引
                    final int currentPage = ii.position;
                    final float pageOffset = (((float) scrollX / width) - ii.offset) / ii.widthFactor;
                    final int activePointerIndex =
                            MotionEventCompat.findPointerIndex(ev, mActivePointerId);
                    final float x = MotionEventCompat.getX(ev, activePointerIndex);
                    // 获取手指滑动距离
                    final int totalDelta = (int) (x - mInitialMotionX);
                    // 通过手指滑动距离和速度计算会滑动到哪个页面
                    int nextPage = determineTargetPage(currentPage, pageOffset, initialVelocity,
                            totalDelta);
                    // 滑动到 nextPage 页
                    setCurrentItemInternal(nextPage, true, true, initialVelocity);

                    needsInvalidate = resetTouch();
                }
                break;
            case MotionEvent.ACTION_CANCEL:
                if (mIsBeingDragged) {
                    scrollToItem(mCurItem, true, 0, false);
                    needsInvalidate = resetTouch();
                }
                break;
            case MotionEventCompat.ACTION_POINTER_DOWN: {
                final int index = MotionEventCompat.getActionIndex(ev);
                final float x = MotionEventCompat.getX(ev, index);
                mLastMotionX = x;
                mActivePointerId = MotionEventCompat.getPointerId(ev, index);
                break;
            }
            case MotionEventCompat.ACTION_POINTER_UP:
                onSecondaryPointerUp(ev);
                mLastMotionX = MotionEventCompat.getX(ev,
                        MotionEventCompat.findPointerIndex(ev, mActivePointerId));
                break;
        }
        if (needsInvalidate) {
            ViewCompat.postInvalidateOnAnimation(this);
        }
        return true;
    }

### 执行拖拽方法 performDrag(float x) 

	/**
     	* 执行拖拽
     	*
     	* @param x
     	* @return
     */
    private boolean performDrag(float x) {
        boolean needsInvalidate = false;

        final float deltaX = mLastMotionX - x;
        mLastMotionX = x;

        float oldScrollX = getScrollX();
        float scrollX = oldScrollX + deltaX;
        final int width = getClientWidth();

        float leftBound = width * mFirstOffset;
        float rightBound = width * mLastOffset;
        boolean leftAbsolute = true;
        boolean rightAbsolute = true;

        // 获取预存的第一个item和最后一个item
        final ItemInfo firstItem = mItems.get(0);
        final ItemInfo lastItem = mItems.get(mItems.size() - 1);
        if (firstItem.position != 0) {
            // 如果这个页面不是 adapter 需要展示的第一个页面
            leftAbsolute = false;
            leftBound = firstItem.offset * width;
        }
        if (lastItem.position != mAdapter.getCount() - 1) {
            // 如果这个页面不是 adapter 需要展示的最后一个页面
            rightAbsolute = false;
            rightBound = lastItem.offset * width;
        }

        if (scrollX < leftBound) {
            // 滑动到了第一个预存界面的左边界
            if (leftAbsolute) {
                // 显示边缘效果
                float over = leftBound - scrollX;
                needsInvalidate = mLeftEdge.onPull(Math.abs(over) / width);
            }
            scrollX = leftBound;
        } else if (scrollX > rightBound) {
            // 滑动超过了最后一个预存界面的左边界
            if (rightAbsolute) {
                // 显示边缘效果
                float over = scrollX - rightBound;
                needsInvalidate = mRightEdge.onPull(Math.abs(over) / width);
            }
            scrollX = rightBound;
        }
        // Don't lose the rounded component
        mLastMotionX += scrollX - (int) scrollX;
        scrollTo((int) scrollX, getScrollY());
        pageScrolled((int) scrollX);

        return needsInvalidate;
    }

## 总结
滑动的过程， mItems 会把移进预存范围内的页面初始化添加进来，并把移动到范围外的页面移除掉,mItems 的size 始终保持在
【0， 1 + mOffscreenPageLimit * 2】。
以上是我对 ViewPager 单步调试后的 源码理解，让我对其有了更深入的了解，或许有些地方还有纰漏，请指正。
谢谢！
祝，身体健康。 