---
layout: post
title:  "设计模式总结"
date:   2015-12-28 9:50:18 
categories: DesignMode
comments: true
description: 设计模式总结!
---

##单例模式

###DCL(Double CheckLock)
    public class Singleton {
    	private static Singleton sInstance = null;
    
    	private Singleton(){}
    	
    	public static Singleton getInstance(){
    		if(mInstance == null){
    			synchronized(Singleton.class){
    				if(mInstance == null){
    					sInstance = new Singleton();
    				}
    			}
    		}
    
    		return sInstance;
    	}
    }

##静态内部类
    public class Singleton{
    	private Singleton(){}
    
    	private static class SingletonHolder{
    		public static final Singleton sInstance = new Singleton();
    	}
    
    	public static getInstance(){
    		return SingletonHolder.sInstance;
    	}
    }

##Builder 模式
参照 Android 源码 AlertDialog.java 经典 Builder 模式。