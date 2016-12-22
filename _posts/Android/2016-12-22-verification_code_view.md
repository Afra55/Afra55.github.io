---
layout: post
title:  "Android Verification Code View"
date:   2016-12-22 15:07
categories: Android
comments: true
description: Android Verification Code View
---

* content
{:toc}

## 本文

[http://afra55.github.io/2016/12/22/verification_code_view/](http://afra55.github.io/2016/12/22/verification_code_view/)

## 图示

![](https://raw.githubusercontent.com/Afra55/Afra55.github.io/master/blog_picture/view/VerificationCodeView.png)

## 前情提要

思路是用一个横向的 LinearLayout 包 TextView 展示的。

使用手机自带的键盘，监听按键。

## Code

### Attrs - vcode_attrs.xml
	
	<?xml version="1.0" encoding="utf-8"?>
	<resources>
	    <declare-styleable name="VerificationCodeView">
	        <attr name="vcodeTextSize" format="dimension" />
	        <attr name="vcodeTextColor" format="color" />
	        <attr name="vcodeBottomIcon" format="reference" />
	        <attr name="vcodeViewCount" format="integer" />
	        <attr name="vcodeItemSpaceSize" format="dimension" />
	    </declare-styleable>
	</resources>

### resources - vcode_default.xml
	
	<resources>
	    <dimen name="default_text_size" >18sp</dimen>
	    <dimen name="vcode_text_size" >18sp</dimen>
	    <dimen name="vcode_bottom_icon_height">6dp</dimen>
	    <dimen name="vcode_bottom_icon_width">48dp</dimen>
	    <dimen name="vcode_item_space_size">19dp</dimen>

		<color name="vcode_bottom_icon_bg">#f6a500</color>
    	<color name="vcode_bottom_error_icon_bg">#e84849</color>
    	<color name="vcode_text_color">#000000</color>
	</resources>

### drawable - icon_vcode_bottom.xml

	<?xml version="1.0" encoding="utf-8"?>
	<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
	    <corners android:radius="90dp" />
	    <solid android:color="@color/vcode_bottom_icon_bg" />
	    <size
	        android:height="@dimen/vcode_bottom_icon_height"
	        android:width="@dimen/vcode_bottom_icon_width" />
	</shape>

### drawable - icon_vcode_err_bottom.xml
	
	<?xml version="1.0" encoding="utf-8"?>
	<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
	    <corners android:radius="90dp" />
	    <solid android:color="@color/vcode_bottom_error_icon_bg" />
	    <size
	        android:height="@dimen/vcode_bottom_icon_height"
	        android:width="@dimen/vcode_bottom_icon_width" />
	</shape>

### Utils - TextViewUtils.java

	import android.graphics.drawable.Drawable;
	import android.widget.EditText;
	import android.widget.TextView;
	
	/**
	 * Created by Victor Yang on 2016/12/15 0015.
	 * TextViewUtils.
	 */
	
	public class TextViewUtils {
	
	    public static void addTextViewLeftIcon(
	            EditText editText
	            , Drawable drawable
	            , int imgSize) {
	
	        if (editText == null || drawable == null || imgSize <= 0) {
	            return;
	        }
	
	        drawable.setBounds(0, 0
	                , imgSize
	                , imgSize);
	
	        editText.setCompoundDrawables(
	                drawable
	                , null
	                , null
	                , null);
	    }
	
	    public static void addTextViewBottomIcon(
	            TextView textView
	            , Drawable drawable
	            , int imgWidth
	            , int imgHeight) {
	
	        if (textView == null || drawable == null || imgWidth <= 0) {
	            return;
	        }
	
	        drawable.setBounds(0, 0
	                , imgWidth
	                , imgHeight);
	
	        textView.setCompoundDrawables(
	                null
	                , null
	                , null
	                , drawable);
	    }
	}

### Code - VerificationCodeView.java
	
	import android.content.Context;
	import android.content.res.TypedArray;
	import android.graphics.drawable.Drawable;
	import android.text.InputType;
	import android.util.AttributeSet;
	import android.view.Gravity;
	import android.view.KeyEvent;
	import android.view.MotionEvent;
	import android.view.inputmethod.BaseInputConnection;
	import android.view.inputmethod.EditorInfo;
	import android.view.inputmethod.InputConnection;
	import android.view.inputmethod.InputMethodManager;
	import android.widget.LinearLayout;
	import android.widget.TextView;
	
		
	import java.util.ArrayList;
	import java.util.List;
	
	/**
	 * Created by Victor Yang on 2016/12/19 0019.
	 * 验证码 view
	 */
	
	public class VerificationCodeView extends LinearLayout {
	
	    public interface CodeCompleteListener{
	        void complete(boolean complete);
	    }
	
	    // 验证码 text size
	    private float mVCodeTextSize;
	
	    // 验证码 text color
	    private int mVCodeTextColor;
	
	    // 验证码 底部 icon
	    private Drawable mVCodeBottomIcon;
	    private Drawable mVCodeBottomErrorIcon;
	
	    // 验证码 item 之间的空隙
	    private int mVCodeItemCenterSpaceSize;
	
	    // 存储键盘的输入数字
	    private StringBuilder mCodeStringBuilder;
	
	    // 存储 验证码 item
	    private List<TextView> mCodeViewList;
	
	    // 验证码 输入完成 的监听
	    private CodeCompleteListener mCodeCompleteListener;
	
	    public VerificationCodeView(Context context) {
	        this(context, null);
	    }
	
	    public VerificationCodeView(Context context, AttributeSet attrs) {
	        this(context, attrs, 0);
	    }
	
	    public VerificationCodeView(Context context, AttributeSet attrs, int defStyleAttr) {
	        super(context, attrs, defStyleAttr);
	        init(attrs, defStyleAttr);
	    }
	
	    private void init(AttributeSet attrs, int defStyle) {
	        TypedArray typedArray = getContext().obtainStyledAttributes(attrs, R.styleable.VerificationCodeView, defStyle, 0);
	        mVCodeTextSize = typedArray.getDimensionPixelSize(
	                R.styleable.VerificationCodeView_vcodeTextSize
	                , getResources().getDimensionPixelSize(R.dimen.vcode_text_size));
	        mVCodeTextColor = typedArray.getColor(
	                R.styleable.VerificationCodeView_vcodeTextColor,
	                getResources().getColor(R.color.vcode_text_color));
	        mVCodeBottomIcon = typedArray.getDrawable(R.styleable.VerificationCodeView_vcodeBottomIcon);
	        if (mVCodeBottomIcon == null) {
	            mVCodeBottomIcon = getResources().getDrawable(R.drawable.icon_vcode_bottom);
	        }
	        mVCodeBottomErrorIcon = typedArray.getDrawable(R.styleable.VerificationCodeView_vcodeBottomIcon);
	        if (mVCodeBottomErrorIcon == null) {
	            mVCodeBottomErrorIcon = getResources().getDrawable(R.drawable.icon_vcode_error_bottom);
	        }
	        int mVCodeViewCount = typedArray.getInt(R.styleable.VerificationCodeView_vcodeViewCount, 4);
	        mVCodeItemCenterSpaceSize = typedArray.getDimensionPixelSize(
	                R.styleable.VerificationCodeView_vcodeItemSpaceSize,
	                getResources().getDimensionPixelSize(R.dimen.vcode_item_space_size));
	        typedArray.recycle();
	
	        setOrientation(HORIZONTAL);
	        setGravity(Gravity.CENTER);
	
	        // 获取触摸时焦点
	        setFocusableInTouchMode(true);
	
	        if (mCodeStringBuilder == null) mCodeStringBuilder = new StringBuilder();
	        mCodeViewList = new ArrayList<>();
	
	        // 初始化验证码 item
	        for (int i = 0; i < mVCodeViewCount; i++) {
	            TextView underLineCodeView = getUnderLineCodeView();
	            mCodeViewList.add(underLineCodeView);
	            addView(underLineCodeView);
	        }
	    }
	
	    public void setCodeCompleteListener(CodeCompleteListener listener) {
	        mCodeCompleteListener = listener;
	    }
	
	    private TextView getUnderLineCodeView() {
	        TextView textView = new TextView(getContext());
	        textView.setTextSize(mVCodeTextSize);
	        textView.setTextColor(mVCodeTextColor);
	        textView.setGravity(Gravity.CENTER);
	        int padding = mVCodeItemCenterSpaceSize / 2;
	        textView.setPadding(
	                padding
	                , 0
	                , padding
	                , 0);
	        int bottomIconWidth = (int) getResources().getDimension(R.dimen.vcode_bottom_icon_width);
	        int bottomIconHeight = (int) getResources().getDimension(R.dimen.vcode_bottom_icon_height);
	        TextViewUtils.addTextViewBottomIcon(textView, mVCodeBottomIcon, bottomIconWidth, bottomIconHeight);
	        return textView;
	    }
	
	    @Override
	    public boolean onTouchEvent(MotionEvent event) {
	        requestFocusFromTouch();
	        requestFocus();
	
	        // 触摸控件时显示 键盘
	        if (event.getAction() == MotionEvent.ACTION_DOWN) {
	            InputMethodManager imm = (InputMethodManager) getContext()
	                    .getSystemService(Context.INPUT_METHOD_SERVICE);
	            imm.showSoftInput(this, InputMethodManager.SHOW_FORCED);
	        }
	        return true;
	    }
	
	    @Override
	    public InputConnection onCreateInputConnection(EditorInfo outAttrs) {
	        // 声明一个数字数字键盘
	        BaseInputConnection fic = new BaseInputConnection(this, false);
	        outAttrs.actionLabel = null;
	        outAttrs.inputType = InputType.TYPE_CLASS_NUMBER;
	        outAttrs.imeOptions = EditorInfo.IME_ACTION_NONE;
	        return fic;
	    }
	
	    @Override
	    public boolean onKeyDown(int keyCode, KeyEvent event) {
	        if (mCodeStringBuilder == null) mCodeStringBuilder = new StringBuilder();
	        // keyCode = 67 是回退,keyCode = 【7，16】 是数字 【0，9】
	        if (keyCode == 67 && mCodeStringBuilder.length() > 0) {
	            mCodeStringBuilder.deleteCharAt(mCodeStringBuilder.length() - 1);
	            resetCodeShowView();
	        } else if (keyCode >= 7
	                && keyCode <= 16
	                && mCodeStringBuilder.length() < mCodeViewList.size()) {
	            mCodeStringBuilder.append(keyCode - 7);
	            resetCodeShowView();
	        }
	        if (mCodeStringBuilder.length() >= mCodeViewList.size() || keyCode == 66) {
	            InputMethodManager imm = (InputMethodManager) getContext().getSystemService(Context.INPUT_METHOD_SERVICE);
	            imm.hideSoftInputFromWindow(getWindowToken(), 0);
	        }
	        return super.onKeyDown(keyCode, event);
	    }
	
	    private void resetCodeShowView() {
	        if (mCodeStringBuilder == null || mCodeViewList == null || mCodeViewList.size() <= 0) {
	            return;
	        }
	
	        for (int i = 0 ; i< mCodeViewList.size(); i++) {
	            mCodeViewList.get(i).setText("");
	            if (i < mCodeStringBuilder.length()) {
	                mCodeViewList.get(i).setText(String.valueOf(mCodeStringBuilder.charAt(i)));
	            }
	        }
	
	        if (mCodeCompleteListener != null) {
	            if (mCodeStringBuilder.length() == mCodeViewList.size()) {
	                mCodeCompleteListener.complete(true);
	            } else {
	                mCodeCompleteListener.complete(false);
	            }
	        }
	    }
	
	    public void setCodeItemLineDrawable(Drawable drawable) {
	        for (TextView textView : mCodeViewList) {
	            int bottomIconWidth = (int) getResources().getDimension(R.dimen.vcode_bottom_icon_width);
	            int bottomIconHeight = (int) getResources().getDimension(R.dimen.vcode_bottom_icon_height);
	            TextViewUtils.addTextViewBottomIcon(textView, drawable, bottomIconWidth, bottomIconHeight);
	        }
	    }
	
	    public void resetCodeItemLineDrawable() {
	        setCodeItemLineDrawable(mVCodeBottomIcon);
	    }
	
	    public void setCodeItemErrorLineDrawable() {
	        for (TextView textView : mCodeViewList) {
	            int bottomIconWidth = (int) getResources().getDimension(R.dimen.vcode_bottom_icon_width);
	            int bottomIconHeight = (int) getResources().getDimension(R.dimen.vcode_bottom_icon_height);
	            TextViewUtils.addTextViewBottomIcon(textView, mVCodeBottomErrorIcon, bottomIconWidth, bottomIconHeight);
	        }
	    }
	
	    public String getTextString() {
	        return mCodeStringBuilder == null ? "" : mCodeStringBuilder.toString();
	    }
	}
