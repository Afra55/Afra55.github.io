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

###静态内部类
    public class Singleton{
    	private Singleton(){}
    
    	private static class SingletonHolder{
    		public static final Singleton sInstance = new Singleton();
    	}
    
    	public static getInstance(){
    		return SingletonHolder.sInstance;
    	}
    }

###优点

1. 在内存中只有一个实例，减少内存开支，减少系统性能开销；
2. 避免对资源的多重占用；
3. 可以在系统设置全局的访问点，优化和共享资源访问。

###缺点
1. 扩展困难；
2. 如果持有Context，很容易引发内存泄漏，此时最好传递个单例对象的 Context 最好是 Application Context。

----------

##2.Builder 模式
参照 Android 源码 AlertDialog.java 经典 Builder 模式。

###优点
1. 封装良好。
2. 建造者独立，益于扩展。

###缺点
会产生多余的Builder以及Director对象，消耗内存。

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

###优点
原型模式是在内存中二进制流的拷贝，比直接 new 一个对象性能好很多，特别是在循环体内产生大量对象时。

###缺点
直接在内存中拷贝，构造函数是不执行的，在实际开发当中要注意这个问题。

----------

##4.工厂模式

定义一个创建对象的接口，让子类决定实例化哪个类。

###创建抽象类

    /**
	     * Created by yangshuai in the 16:05 of 2016.01.11 .
	     * 抽象类
     */
    public abstract class BaseFacory {
    	public abstract void start();
    }

###创建子类

	/**
	 * Created by yangshuai in the 16:09 of 2016.01.11 .
	 * 具体工厂类
	 */
	public class MyFacory extends BaseFacory {
	    @Override
	    public void start() {
	        Log.d("MyFactory", "start");
	    }
	}

	public class MyFacory2 extends BaseFacory {
	    @Override
	    public void start() {
	        Log.d("MyFactory2", "start");
	    }
	}

###获取工厂实例反射方法（仅参考）

	/**
	     * 获取工厂实例
	     * @param tClass
	     * @param <T>
	     * @return
     */
    public static <T extends BaseFacory> T getInstatnce(Class<T> tClass) {
        BaseFacory baseFacory = null;
        try {
            baseFacory = (BaseFacory) Class.forName(tClass.getName()).newInstance();
        } catch (InstantiationException e) {
            e.printStackTrace();
        } catch (IllegalAccessException e) {
            e.printStackTrace();
        } catch (ClassNotFoundException e) {
            e.printStackTrace();
        }

        return (T) baseFacory;
    }

###使用方法

	BaseFacory factoryMode = FactoryMode.getInstatnce(MyFacory.class);
        if (factoryMode != null) {
            factoryMode.start();
        }

----------
