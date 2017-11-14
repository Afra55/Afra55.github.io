---
layout: post
title:  "Log 打印当前代码行以及当前类"
date:   2017-11-14 16:09
categories: Android
comments: true
description: Log 打印当前代码行以及当前类
---

* content
{:toc}

## LogUtils


	/**
	 * Created by Afra55 on 2017/11/14.
	 * Smile is the best name card.
	 */
	public class LogUtils {
		
	    private static String getSimpleClassName(String name) {
	        int lastIndex = name.lastIndexOf(".");
	        return name.substring(lastIndex + 1);
	    }
	    
	    
	    public static void i(String msg) {
	        StackTraceElement[] trace = Thread.currentThread().getStackTrace();
	        
	        int methodCount = 1;
	        int stackOffset = getStackOffset(trace);
	        
	        if (methodCount + stackOffset > trace.length) {
	            methodCount = trace.length - stackOffset - 1;
	        }
	        
	        for (int i = methodCount; i > 0; i--) {
	            int stackIndex = i + stackOffset;
	            if (stackIndex >= trace.length) {
	                continue;
	            }
	            StackTraceElement element = trace[stackIndex];
	            
	            StringBuilder builder = new StringBuilder();
	            builder.append(getSimpleClassName(element.getClassName()))
	                    .append(".")
	                    .append(element.getMethodName())
	                    .append(" ")
	                    .append(" (")
	                    .append(element.getFileName())
	                    .append(":")
	                    .append(element.getLineNumber())
	                    .append(")")
	                    .append(" | ")
	                    .append(msg);
	                    
	            Log.i(getSimpleClassName(element.getClassName()), builder.toString());
	            
	        }
	    }
	    
	    private static int getStackOffset(StackTraceElement[] trace) {
	        for (int i = 2; i < trace.length; i++) {
	            StackTraceElement e = trace[i];
	            String name = e.getClassName();
	            if (!name.equals(LogUtils.class.getName())) {
	                return --i;
	            }
	        }
	        return -1;
	    }
	}


## 举例


	public class MainActivity extends Activity {
		
		
	  private void onJJ() {
	    onBB();
	  }
	  private void onBB() {
	    LogUtils.i("onBB");
	  }
	  @Override
	  protected void onCreate(Bundle savedInstanceState) {
	    super.onCreate(savedInstanceState);
	    setContentView(R.layout.activity_main);
	    
	    LogUtils.i("message");
	    
	    onJJ();
	  }
	}

输出日志：
    
    I/MainActivity: MainActivity.onCreate  (MainActivity.java:32) | message
	I/MainActivity: MainActivity.onBB  (MainActivity.java:25) | onBB