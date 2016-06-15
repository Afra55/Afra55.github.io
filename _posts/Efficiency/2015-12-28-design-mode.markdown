---
layout: post
title:  "设计模式总结"
date:   2015-12-28 9:50:18 
categories: Efficiency
comments: true
description: 设计模式总结!
---

* content
{:toc}

## 1.单例模式

### DCL(Double CheckLock)

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

### 静态内部类
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

## 2.Builder 模式

参照 Android 源码 AlertDialog.java 经典 Builder 模式。

### 优点

1. 封装良好。
2. 建造者独立，益于扩展。

### 缺点

会产生多余的Builder以及Director对象，消耗内存。

----------

## 3.原型模式

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

### 优点
原型模式是在内存中二进制流的拷贝，比直接 new 一个对象性能好很多，特别是在循环体内产生大量对象时。

### 缺点

直接在内存中拷贝，构造函数是不执行的，在实际开发当中要注意这个问题。

----------

## 4.工厂模式

定义一个创建对象的接口，让子类决定实例化哪个类。

### 创建抽象类

    /**
	     * Created by yangshuai in the 16:05 of 2016.01.11 .
	     * 抽象类
     */
    public abstract class BaseFacory {
    	public abstract void start();
    }

### 创建子类

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

### 获取工厂实例反射方法（仅参考）

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

### 使用方法

	BaseFacory factoryMode = FactoryMode.getInstatnce(MyFacory.class);
        if (factoryMode != null) {
            factoryMode.start();
        }

----------

## 5.策略模式

定义了一些列算法，并分别封装，并且互相可以替换。经常回用来多个if-else或switch-case。

### 定义通用接口

    /**
	     * Created by yangshuai in the 10:56 of 2016.01.29 .
     */
    public interface Strategy {
    	public int strategy();
    }

### 封装算法

	/**
	 * Created by yangshuai in the 11:37 of 2016.01.29 .
	 */
	public class StrategyOne implements Strategy {
	    @Override
	    public int strategy() {
	        Log.d("StrategyOne", "OneStrategy");
	        /* 算法操作 */
	        return 1;
	    }
	}

	/**
	 * Created by yangshuai in the 11:37 of 2016.01.29 .
	 */
	public class StrategyTwo implements Strategy {
	    @Override
	    public int strategy() {
	        Log.d("StrategyTwo", "TwoStrategy");
	        /* 算法操作 */
	        return 2;
	    }
	}

### 使用

	/**
	 * Created by yangshuai in the 11:39 of 2016.01.29 .
	 */
	public class UseStrategy {
	
	    private Strategy strategy = new StrategyOne();
	
	    public Strategy getStrategy() {
	        return strategy;
	    }
	
	    public void setStrategy(Strategy strategy) {
	        this.strategy = strategy;
	    }
	
	    public int strategy() {
	        return strategy.strategy();
	    }
	}

### 优点

1. 结构简单明了，使用简单直观；
2. 耦合度相对较低，扩展方便；
3. 操作封装更彻底，数据更安全。

### 缺点

随着策略的增加，子类会变得繁多。

----------

## 6.状态模式

如果有大量的 分支 语句（if-else， switch-case）或者 要根据状态的改变而改变行为时，状态模式是最佳选择。举例如下：

### 创建状态接口

    /*
    	状态接口，有三种模式，睡眠、行走、进食。
    */
    public interface State{
    	public void sleep();
    	public void walk();
    	public void eatting();
    }

### 创建行为接口

    /*
    	动作接口，分别是唱歌、移动、玩游戏。
    */
    public interface Action{
    	public void sing();
    	public void move();
    	public void playGame();
    }

### 模拟各种状态下的行为执行方式

	// 睡眠模式下的所有行为的模拟
    public class SleepState implements Action{
    
    	@Override
    	public void sing(){
    		System.out.println("You are sleeping, no sing");
    	}
    
    	@Override
    	public void move(){
    		System.out.println("You are sleeping, no move");
    	}
    
    	@Override
    	public void playGame(){
    		System.out.println("You are sleeping, no playGame");
    	}
    }
    
	// 行走模式下的所有行为的模拟
    public class WalkState implements Action{
    
    	@Override
    	public void sing(){
    		System.out.println("You can sing");
    	}
    
    	@Override
    	public void move(){
    		System.out.println("You can move");
    	}
    
    	@Override
    	public void playGame(){
    		System.out.println("You can playGame");
    	}
    }
    
	// 进食模式下的所有行为的模拟
    public class EatingState implements Action{
    
    	@Override
    	public void sing(){
    		System.out.println("You are eatting, no sing");
    	}
    
    	@Override
    	public void move(){
    		System.out.println("You are eatting and you could move");
    	}
    
    	@Override
    	public void playGame(){
    		System.out.println("You are eatting and you could playGame");
    	}
    }
    

### 创建状态控制器

    /*
    	控制器, 用于切换状态和执行行为
    */
    public class StateContorller implements State {
    	private State mState;
    
    	public void setState(State s){
    		mState = s;
    	}
    
    	@Override
    	public void sleep(){
    		setState(new SleepState);
    	}
    
    	@Override
    	public void walk(){
    		setState(new WalkState);
    	}
    
    	@Override
    	public void eatting(){
    		setState(new EatingState);
    	}
    	
    	public void sing(){
    		mState.sing();
    	}
    	public void move(){
    		mState.move();
    	}
    	public void playGame(){
    		mState.playGame();
    	}
    }

### 使用

在不同的状态下，执行的行为不同：

		StateContorller contorller = new StateContorller();
		contorller.eatting();
		contorller.move();

		contorller.sleep();
		contorller.sing();

		contorller.walk();
		contorller.playGame();

### 优点

优化了繁琐的状态判断，提高了可扩展性和可维护性。像上面这个例子，使用if-else对比下就显而易见了。

### 缺点

增加了类和对象的个数。


----------

## 7.责任链模式

当多个对象都可以处理一个请求，而且由请求的某个标志决定哪个对象进行处理时使用。

请求也可以是从服务端获取的数据，根据某个特性来决定处理的对象.

### 请求基类

	/**
	 * Created by yangshuai in the 21:48 of 2016.06.15 .
	 */
	public abstract class BaseDutyRequest {

		// 请求的对象是未知，千变万化的
	    private Object mObject;
	
	    public BaseDutyRequest(Object object) {
	        mObject = object;
	    }
	
	    public Object getRequestObject() {
	        return mObject;
	    }
	
		// 这里由 一个 int 型的值来标志特性
	    public abstract int getDutyLevel();
	
	}

### 执行职责的基类

	/**
	 * Created by yangshuai in the 21:43 of 2016.06.15 .
	 */
	public abstract class BaseDuty {
		// 存储下一个节点，最后一个节点的下个节点是null
	    private BaseDuty nextOne = null;
	
	    public final void setNextOne(BaseDuty baseDuty) {
	        nextOne = baseDuty;
	    }
	
	    public final BaseDuty getNextOne() {
	        return nextOne;
	    }
		
		// 获取请求，根据请求的特性判断由谁来处理
	    public final void setDutyRequest(BaseDutyRequest request) {
	        if (request.getDutyLevel() == getDutyLevel()) {
	            doDuty(request);
	        } else if (getNextOne() != null) {
	            getNextOne().setDutyRequest(request);
	        } else {
	            beyondTheResponsibilityLevel(request);
	        }
	    }
	
		// 执行职责能够处理的特性，与请求的特性进行对比
	    protected abstract int getDutyLevel();
	
		// 处理请求
	    protected abstract void doDuty(BaseDutyRequest request);
	
	    // 在最后一个节点使用,千万不要掉到死循环的bug中
	    protected void beyondTheResponsibilityLevel(BaseDutyRequest request) {
	        // you can do someting or not;
	    }
	}

### 请求举例

	/**
	 * Created by yangshuai in the 22:02 of 2016.06.15 .
	 */
	public class DutyRequestOne extends BaseDutyRequest {
	    public DutyRequestOne(Object object) {
	        super(object);
	    }
	
	    @Override
	    public int getDutyLevel() {
	        return 0;
	    }
	}

	/**
	 * Created by yangshuai in the 22:02 of 2016.06.15 .
	 */
	public class DutyRequestTwo extends BaseDutyRequest {
	
	    public DutyRequestTwo(Object object) {
	        super(object);
	    }
	
	    @Override
	    public int getDutyLevel() {
	        return 0;
	    }
	}

### 执行职责举例

	/**
	 * Created by yangshuai in the 22:00 of 2016.06.15 .
	 */
	public class DutyOne extends BaseDuty {
	    @Override
	    protected int getDutyLevel() {
	        return 0;
	    }
	
	    @Override
	    protected void doDuty(BaseDutyRequest request) {
	        // do what you wan't to do;
	        request.getRequestObject();
	    }
	}

	/**
	 * Created by yangshuai in the 22:01 of 2016.06.15 .
	 */
	public class DutyTwo extends BaseDuty {
	    @Override
	    protected int getDutyLevel() {
	        return 1;
	    }
	
	    @Override
	    protected void doDuty(BaseDutyRequest request) {
	        // do what you wan't to do;
	        request.getRequestObject();
	    }
	}

### 使用方法

	/**
	 * Created by yangshuai in the 22:03 of 2016.06.15 .
	 */
	public class DutyMode {
	    public static void main(String[] args) {
	
	        // 执行对象
	        DutyOne dutyOne = new DutyOne();
	        DutyTwo dutyTwo = new DutyTwo();
	
	        dutyOne.setNextOne(dutyTwo);
	
	        // 请求对象，请求可能是从服务器获取的数据
	        DutyRequestOne dutyRequestOne = new DutyRequestOne("one");
	        DutyRequestTwo dutyRequestTwo = new DutyRequestTwo("two");
	
	        // 每次都从第一个节点进入
	        dutyOne.setDutyRequest(dutyRequestOne);
	        dutyOne.setDutyRequest(dutyRequestTwo);
	    }
	}
### 优点
请求和处理解耦，代码更灵活。

### 缺点

当处理太多，遍历的方式会降低性能。

----------
