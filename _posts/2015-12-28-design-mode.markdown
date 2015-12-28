---
layout: post
title:  "设计模式总结"
date:   2015-12-28 9:50:18 
categories: DesignMode
comments: true
description: 设计模式总结!
---

##1.单例模式

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

----------

##2.Builder 模式
参照 Android 源码 AlertDialog.java 经典 Builder 模式。

----------

##3.原型模式
即克隆原始的文件获得副本，对副本进行修改并不会影响原始文件。
*需要注意的是：使用 Cloneable 实现拷贝时，并不会执行构造函数。*

	public class WordDocument implements Cloneable {
	
	    private String mText;
	    private ArrayList<String> mImages = new ArrayList<>();
	
	    public ArrayList<String> getmImages() {
	        return mImages;
	    }
	
	    public WordDocument(){
	        Log.d("WordDocument", "WordDocument 构造函数");
	    }
	
	    @Override
	    protected Object clone() throws CloneNotSupportedException {
	        try {
	            WordDocument document = (WordDocument) super.clone();
	            document.mText = this.mText;
	
	            /* 类似于这样的指向地址的引用，也要采用拷贝形式 */
	            document.mImages = (ArrayList<String>) this.mImages.clone();
	            return document;
	        } catch (Exception e) {
	            e.printStackTrace();
	        }
	
	        return null;
	    }
	
	    public void addImages(String mImages) {
	        this.mImages.add(mImages);
	    }
	
	    public String getmText() {
	        return mText;
	    }
	
	    public void setmText(String mText) {
	        this.mText = mText;
	    }
	}

使用方法：

	public void use(){
        WordDocument originDoc = new WordDocument();
        originDoc.setmText("doc");
        originDoc.addImages("1");
        originDoc.addImages("2");
        originDoc.addImages("3");

        /* 进行克隆，并进行修改，原始对象并不会被改变 */
        try {
            WordDocument copyDoc = (WordDocument) originDoc.clone();
            copyDoc.setmText("doc copy");
            copyDoc.addImages("1");
            copyDoc.addImages("2");
            copyDoc.addImages("3");
            copyDoc.addImages("4");
        } catch (CloneNotSupportedException e) {
            e.printStackTrace();
        }

    }

----------
