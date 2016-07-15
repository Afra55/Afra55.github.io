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

## 原文

[http://afra55.github.io/2015/12/28/design-mode/](http://afra55.github.io/2015/12/28/design-mode/)

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
    
    	public static Singleton getInstance(){
    		return SingletonHolder.sInstance;
    	}
    }

### 优点

1. 在内存中只有一个实例，减少内存开支，减少系统性能开销；
2. 避免对资源的多重占用；
3. 可以在系统设置全局的访问点，优化和共享资源访问。

### 缺点

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

## 8.命令模式

把执行命令分离，记录执行顺序。

### 创建具体执行类（命令接收者）

	/**
	 * Created by yangshuai in the 20:52 of 2016.06.20 .
	 * 在电脑上操作，有多种命令，比如 复制文件，移动文件，新建文件等。
	 * Compter类用于实现具体方法。接收各种命令来执行方法，即接收者。
	 */
	public class Computer {
	
	    public void doCopy(String from, String to) {
	
	    }
	
	    public void doMove(String from, String to) {
	
	    }
	
	    public void doNewDefaultFile() {
	
	    }
	}

### 创建命令接口

	/**
	 * Created by yangshuai in the 20:48 of 2016.06.20 .
	 * Command 接口，定义通用执行方法，不止一个，可能有多个执行.
	 */
	public interface Command {
	    public void execute();
	    public void execute(String from, String to);
	}

### 创建命令实现类

	/**
	 * Created by yangshuai in the 20:58 of 2016.06.20 .
	 * Copy 的命令实现类。
	 */
	public class DoCopyCommand implements Command {
	
	    private final Computer mComputer;
	
	    public DoCopyCommand(Computer computer) {
	        mComputer = computer;
	    }
	
	    @Override
	    public void execute() {
	        throw new IllegalArgumentException("DoCopyCommand need from and to");
	    }
	
	    @Override
	    public void execute(String from, String to) {
	        mComputer.doCopy(from, to);
	    }
	}

	/**
	 * Created by yangshuai in the 20:58 of 2016.06.20 .
	 * Move 的命令实现类。
	 */
	public class DoMoveCommand implements Command {
	
	    private final Computer mComputer;
	
	    public DoMoveCommand(Computer computer) {
	        mComputer = computer;
	    }
	
	    @Override
	    public void execute() {
	        throw new IllegalArgumentException("DoMoveCommand need from and to");
	    }
	
	    @Override
	    public void execute(String from, String to) {
	        mComputer.doMove(from, to);
	    }
	}

	/**
	 * Created by yangshuai in the 20:58 of 2016.06.20 .
	 * New file 的命令实现类。
	 */
	public class DoNewDefaultCommand implements Command {
	
	    private final Computer mComputer;
	
	    public DoNewDefaultCommand(Computer computer) {
	        mComputer = computer;
	    }
	
	    @Override
	    public void execute() {
	        mComputer.doNewDefaultFile();
	    }
	
	    @Override
	    public void execute(String from, String to) {
	        throw new IllegalArgumentException("DoNewDefaultCommand do not need arguments");
	    }
	}

### 创建请求类

	/**
	 * Created by yangshuai in the 21:06 of 2016.06.20 .
	 * 这些命令都能用鼠标来在电脑上操作实现。
	 * Mouse 用于发起命令，充当请求者模式。并可以记录执行命令，方便取消等操作。
	 */
	public class Mouse {
	    private Command doCopyCommand;
	    private Command doMoveCommand;
	    private Command doNewDefaultCommand;
	
	    private List<Command> doCommands = new ArrayList<>();
	
	    public List<Command> getDoCommands() {
	        return doCommands;
	    }
	
	    public void setDoCopyCommand(Command doCopyCommand) {
	        this.doCopyCommand = doCopyCommand;
	    }
	
	    public void setDoMoveCommand(Command doMoveCommand) {
	        this.doMoveCommand = doMoveCommand;
	    }
	
	    public void setDoNewDefaultCommand(Command doNewDefaultCommand) {
	        this.doNewDefaultCommand = doNewDefaultCommand;
	    }
	
	    public void doCopy(String from, String to) {
	        if (doCopyCommand == null) {
	            return;
	        }
	        doCopyCommand.execute(from, to);
	        doCommands.add(doCopyCommand);
	    }
	
	    public void doMove(String from, String to) {
	        if (doMoveCommand == null) {
	            return;
	        }
	        doMoveCommand.execute(from, to);
	        doCommands.add(doMoveCommand);
	    }
	
	    public void doNewDefaultFile() {
	        if (doNewDefaultCommand == null) {
	            return;
	        }
	        doNewDefaultCommand.execute();
	        doCommands.add(doNewDefaultCommand);
	    }
	}

### 执行

	/**
	 * Created by yangshuai in the 21:19 of 2016.06.20 .
	 * 由人来决定怎么去执行
	 */
	public class People {
	    public static void main(String []args) {
	
	        // 要创建一个电脑，即命令接收者来实现命令
	        Computer computer = new Computer();
	
	        // 创建命令
	        Command doCopyCommand = new DoCopyCommand(computer);
	        Command doMoveCommand = new DoMoveCommand(computer);
	        Command doNewDefaultCommand = new DoNewDefaultCommand(computer);
	
	        // 创建鼠标，用来发起命令请求
	        Mouse mouse = new Mouse();
	
	        // 准备命令
	        mouse.setDoCopyCommand(doCopyCommand);
	        mouse.setDoMoveCommand(doMoveCommand);
	        mouse.setDoNewDefaultCommand(doNewDefaultCommand);
	
	        // 执行命令
	        mouse.doNewDefaultFile();
	        mouse.doMove("from", "to");
	        mouse.doCopy("from", "to");
	    }
	}

### 优点

增加了扩展性，分离了请求者和接收者，弱化耦合。我觉得做大的优点是可以记录命令的执行顺序，进而实现撤销操作。

### 缺点

为什么我不直接 new 一个 computer 类直接调用方法呢?这种写法极大的增加了代码量，创建了大量的类。如果，不需要记录执行命令，我觉得还是别用的好。


----------

## 9. 观察者模式

多个对象来监听一个行为，这个时候用观察者模式比较好。
下面举例，多个吃货接收到食堂发来的食品菜单。

### 创建观察者

	import com.afra55.baseclient.util.Log;
	
	import java.util.Observable;
	import java.util.Observer;
	
	/**
	 * Created by yangshuai in the 20:37 of 2016.06.21 .
	 * 吃货的手机会接收到食堂发来的最新菜单，在 update 方法中接收信息
	 */
	public class Eater implements Observer {
	
	    private String phone;
	
	    public Eater(String phone) {
	        this.phone = phone;
	    }
	
	    @Override
	    public void update(Observable observable, Object data) {
	        Log.d("Eater", "Today's food menu: " + data +" has sent to " + phone);
	    }
	}

### 创建被观察者

	import java.util.Observable;
	
	/**
	 * Created by yangshuai in the 20:47 of 2016.06.21 .
	 * 食堂管理员收到新的菜单信息，发送给所有已经注册过的吃货
	 */
	public class CanteenManager extends Observable {
	
	
	    public void sendNewFoodMenu(String menu) {
	        setChanged();
	        notifyObservers(menu);
	    }
	}

### 关联观察者与被观察者
	
	/**
	 * Created by yangshuai in the 20:49 of 2016.06.21 .
	 */
	public class FoodMaker {
	
	    public static void main(String[] args) {
	
	        // 创建食堂管理员
	        CanteenManager canteenManager = new CanteenManager();
	
	        // 创建吃货
	        Eater eater = new Eater("111111");
	        Eater eater2 = new Eater("222222");
	        Eater eater3 = new Eater("333333");
	
	        // 注册吃货
	        canteenManager.addObserver(eater);
	        canteenManager.addObserver(eater2);
	        canteenManager.addObserver(eater3);
	
	        // 更新食物菜单,每个注册了的吃货都会 在 update 方法里接收到新的信息
	        canteenManager.sendNewFoodMenu("米饭");
	        canteenManager.sendNewFoodMenu("饺子");
	        canteenManager.sendNewFoodMenu("嘛事");
	
	    }
	}

### 优点

被观察者有信息变动观察者都会收到信息，便于功能变更，业务扩展，同时增强了灵活性。

### 缺点

观察者太多会造成性能降低，不便于问题排查。


----------

## 10.备忘录模式

备忘录模式很简单，在某个时刻保存某个对象的状态或者数据，或者对象的状态不想被外界直接获取到而是利用中间代理存储状态并暴露给外界，这个时候备忘录模式是很好的选择。
下面以看书为例，介绍备忘录模式：

### 需要存储对象的类

	/**
	 * Created by yangshuai in the 22:40 of 2016.06.22 .
	 * 书本每次阅读页数都会加1，在不阅读的情况下要记录当前阅读的页数，以便下次接着阅读
	 */
	public class Book {
	
	    private int page;
	
	    /**
	     * 每次阅读页数都会加1
	     */
	    public void read() {
	        page++;
	    }
	
	    /**
	     * 不阅读，合起书本的时候页数会变为0
	     */
	    public void leave() {
	        page = 0;
	    }
	
	    /**
	     * 创建书签，存储当前阅读的页数
	     * @return
	     */
	    public Bookmark createBookmark() {
	        Bookmark bookmark = new Bookmark();
	        bookmark.setPage(page);
	        return bookmark;
	    }
	
	    /**
	     * 继续阅读，翻到书签的那一页
	     * @param bookmark
	     */
	    public void backToRead(Bookmark bookmark) {
	        page = bookmark.getPage();
	    }
	
	}

### 创建备忘录类
	
	/**
	 * Created by yangshuai in the 22:43 of 2016.06.22 .
	 * 书签，备忘录该存储的数据类
	 */
	public class Bookmark {
	
	    private int page = 0;
	
	    public int getPage() {
	        return page;
	    }
	
	    public void setPage(int page) {
	        this.page = page;
	    }
	}

### 创建备忘录管理员

	/**
	 * Created by yangshuai in the 22:51 of 2016.06.22 .
	 * 管理书签，用来存储和获取备忘录,如果外界想获取状态，只能通过中间管理员获取
	 */
	public class People {
	    private Bookmark bookmark;
	
	    public Bookmark getBookmark() {
	        return bookmark;
	    }
	
	    public void setBookmark(Bookmark bookmark) {
	        this.bookmark = bookmark;
	    }
	}

### 使用

	/**
	 * Created by yangshuai in the 22:54 of 2016.06.22 .
	 */
	public class World {
	    public static void main(String[] args) {
	        // 创建一本书
	        Book book = new Book();
	        book.read();
	
	        // 创建一个管理者，管理备忘录
	        People people = new People();
	
	        // 管理者存储书签
	        people.setBookmark(book.createBookmark());
	
	        // 不再阅读书，合起书
	        book.leave();
	
	        // 一段时间后继续阅读未读完的书，接着上次的页数
	        book.backToRead(people.getBookmark());
	        book.read();
	    }
	}

### 优点

1. 为程序提供了对象的状态恢复机制；
2. 对数据进行了封装，使用者不必关心如何实现保存细节，只用存储或者获取数据。

### 缺点

设计模式的通病，类的泛滥，而且存取状态会占用资源。


----------

## 11.迭代器模式

遍历对象的时候使用，在遍历多种容器的对象的时候使用最佳。

下面以遍历男子高校和女子高校的信息举例：

### 创建对象

	/**
	 * Created by yangshuai in the 21:15 of 2016.06.30 .
	 * 元素对象，这里以人的信息举例
	 */
	public class People {
	
	    private String name;
	    private int age;
	
	    public People(String name, int age) {
	        this.name = name;
	        this.age = age;
	    }
	
	    @Override
	    public String toString() {
	        return name + ": " + age;
	    }
	}


### 创建迭代器接口

	
	/**
	 * Created by yangshuai in the 21:12 of 2016.06.30 .
	 * 迭代器接口
	 */
	public interface Iterator {
	
	    /**
	     * 判断是否还有下一个元素
	     * @return
	     */
	    boolean hasNext();
	
	    /**
	     * 返回当前位置的元素，并将位置参数加 1
	     * @return
	     */
	    Object next();
	}

### 创建迭代器

	import java.util.ArrayList;
	import java.util.List;
	
	/**
	 * Created by yangshuai in the 21:14 of 2016.06.30 .
	 * 男子高校人员信息迭代器
	 */
	public class ManIterator implements Iterator {
	
	    private List<People> list = new ArrayList<>();
	    private int index = 0;
	
	    public ManIterator(List<People> list) {
	        list.addAll(list);
	    }
	
	    @Override
	    public boolean hasNext() {
	        return index < list.size() && list.get(index) != null;
	    }
	
	    @Override
	    public Object next() {
	        return list.get(index++);
	    }
	}
	
	import java.util.ArrayList;
	import java.util.List;
	
	/**
	 * Created by yangshuai in the 21:24 of 2016.06.30 .
	 * 女子高校人员信息迭代器
	 */
	public class WomanIterator implements Iterator {
	
	    private List<People> list = new ArrayList<>();
	    private int index = 0;
	
	    public WomanIterator(List<People> list) {
	        this.list.addAll(list);
	    }
	
	    @Override
	    public boolean hasNext() {
	        return index < list.size() && list.get(index) != null;
	    }
	
	    @Override
	    public Object next() {
	        return list.get(index++);
	    }
	}

### 创建容器接口

	/**
	 * Created by yangshuai in the 21:29 of 2016.06.30 .
	 * 定义一个通用接口，用来返回容器，或者也可以进行添加删除人员, 也可以更新人员信息(略)。
	 */
	public interface School {
	
	    void add(People people);
	
	    void Remove(People people);
	
	    /**
	     * 只有在使用的时候在创建容器对象
	     * @return
	     */
	    Iterator iterator();
	}

### 创建容器

	import java.util.ArrayList;
	import java.util.List;
	
	/**
	 * Created by yangshuai in the 21:27 of 2016.06.30 .
	 */
	public class ManSchool implements School {
	
	    private List<People> list;
	
	    public ManSchool() {
	        list = new ArrayList<>();
	    }
	
	    @Override
	    public void add(People people) {
	        list.add(people);
	    }
	
	    @Override
	    public void Remove(People people) {
	        if (list.contains(people)) {
	            list.remove(people);
	        }
	    }
	
	    @Override
	    public Iterator iterator() {
	        return new ManIterator(list);
	    }
	}

	import java.util.ArrayList;
	import java.util.List;
	
	/**
	 * Created by yangshuai in the 21:27 of 2016.06.30 .
	 */
	public class WomanSchool implements School {
	
	    private List<People> list;
	
	    public WomanSchool() {
	        list = new ArrayList<>();
	    }
	
	    @Override
	    public void add(People people) {
	        list.add(people);
	    }
	
	    @Override
	    public void Remove(People people) {
	        if (list.contains(people)) {
	            list.remove(people);
	        }
	    }
	
	    @Override
	    public Iterator iterator() {
	        return new WomanIterator(list);
	    }
	}

### 调用方法
	
	/**
	 * Created by yangshuai in the 21:34 of 2016.06.30 .
	 * 遍历男子高校和女子高校的信息就可以使用一种方法。
	 */
	public class Use {
	    public static void main(String []args) {
	        WomanSchool womanSchool = new WomanSchool();
	        womanSchool.add(new People("a", 11));
	        womanSchool.add(new People("b", 11));
	        womanSchool.add(new People("c", 11));
	        showSchoolPeopleInfo(womanSchool.iterator());
	
	
	        ManSchool manSchool = new ManSchool();
	        manSchool.add(new People("d", 11));
	        manSchool.add(new People("e", 11));
	        manSchool.add(new People("f", 11));
	        showSchoolPeopleInfo(womanSchool.iterator());
	
	
	    }
	
	    public static void showSchoolPeopleInfo(Iterator iterator) {
	        if (iterator.hasNext()) {
	            iterator.next().toString();
	        }
	    }
	}

### 优点

分离遍历算法和容器。

### 缺点

增加了类文件。


----------

## 12.模板方法模式

抽取公有方法到基类中，让其他类都继承这个基类，例如 BaseActiviy，你懂的，这里就不再举例。

### 优点

1. 封装了公用的代码，易于维护更新；
2. 可以自由重写扩展公用方法，保留不变代码。

### 缺点

代码阅读困难。那不怪我喽，你要看不懂。


----------


## 13.访问者模式

一个对象有有多个互不关联的方法，这些方法又被不同的对象调用，这个时候使用访问者模式比较好。

下面以游客逛公园举例，公园有熊猫和跳跳虎，年轻人与熊猫玩给跳跳虎喂食，老年人看看介绍就可以了：

### 创建访问者

访问者要对不同的元素有不同的访问方式，给跳跳虎喂食，与熊猫玩耍,所以要区分开来：

	/**
	 * Created by yangshuai in the 21:09 of 2016.07.04 .
	 * 访问者接口，访问每个动物。
	 */
	public interface Visitor {
	    void visit(Tigger tigger);
	
	    void visit(Panda panda);
	}

### 创建元素接口或抽象类，定义被访问对象

被访问者要实现 accept 接口，用来接收访问者的访问：

	/**
	 * Created by yangshuai in the 21:00 of 2016.07.04 .
	 * 动物基类，有两个属性 名字和种类
	 */
	public abstract class Anim {
	    public String name;
	    public String variety;
	
	    public Anim(String name, String variety) {
	        this.name = name;
	        this.variety = variety;
	    }
	
	    /**
	     * 接受访问者的访问
	     * @param visitor
	     */
	    protected abstract void accept(Visitor visitor);
	}

### 创建具体的被访问者

	/**
	 * Created by yangshuai in the 21:11 of 2016.07.04 .
	 * 熊猫
	 */
	public class Panda extends Anim {
	
	    public Panda(String name) {
	        super(name, "吃竹子的");
	    }
	
	    @Override
	    protected void accept(Visitor visitor) {
	        visitor.visit(this);
	    }
	
	    /**
	     * 熊猫玩耍
	     * @param player
	     * @return
	     */
	    public String playWith(String player) {
	        Log.d(name, "和" + player + "玩的超级开心呐");
	        return "玩的开心";
	    }
	}
	
	/**
	 * Created by yangshuai in the 21:10 of 2016.07.04 .
	 * 跳跳虎
	 */
	public class Tigger extends Anim{
	    public Tigger(String name) {
	        super(name, "吃肉的");
	    }
	
	    @Override
	    protected void accept(Visitor visitor) {
	        visitor.visit(this);
	    }
	
	    /**
	     * 老虎进食
	     * @param food
	     * @return
	     */
	    public String eat(String food) {
	        Log.d(name, "eat :" + food);
	        return "吃的开心";
	    }
	}

### 创建被访问元素的集合

	/**
	 * Created by yangshuai in the 21:25 of 2016.07.04 .
	 * 动物园，有三个熊猫，两个跳跳虎
	 */
	public class Zoo {
	    private List<Anim> list = new LinkedList<>();
	
	    public Zoo() {
	        list.add(new Panda("小花"));
	        list.add(new Panda("小1"));
	        list.add(new Panda("小a"));
	        list.add(new Tigger("小妞"));
	        list.add(new Tigger("小BB"));
	    }
	
	    /**
	     * 开门营业，访问者访问每个动物
	     * @param visitor
	     */
	    public void openDoor(Visitor visitor) {
	        for (Anim anim : list) {
	            anim.accept(visitor);
	        }
	    }
	}


### 创建具体的访问者

	/**
	 * Created by yangshuai in the 21:20 of 2016.07.04 .
	 * 老人只要知道动物的种类就可以了
	 */
	public class OldMan implements Visitor {
	
	    @Override
	    public void visit(Tigger tigger) {
	        Log.d("OldMan", tigger.variety);
	    }
	
	    @Override
	    public void visit(Panda panda) {
	        Log.d("OldMan", panda.variety);
	    }
	}

	/**
	 * Created by yangshuai in the 21:20 of 2016.07.04 .
	 * 年轻人不仅要知道动物的名字还要和动物互动
	 */
	public class YoungMan implements Visitor {
	    @Override
	    public void visit(Tigger tigger) {
	        Log.d("YoungMan", tigger.name + ":" + tigger.eat("food"));
	    }
	
	    @Override
	    public void visit(Panda panda) {
	        Log.d("YoungMan", panda.name + ":" + panda.playWith("Afra"));
	    }
	}

### 使用方法

	/**
	 * Created by yangshuai in the 21:28 of 2016.07.04 .
	 */
	public class IsTimeToPlay {
	    public static void main(String[] args) {
	
	        // 创建动物园
	        Zoo zoo = new Zoo();
	
	        // 创建老年访问者
	        OldMan oldMan = new OldMan();
	        zoo.openDoor(oldMan);
	
	        // 创建青年访问者
	        YoungMan youngMan = new YoungMan();
	        zoo.openDoor(youngMan);
	
	    }
	}

### 优点

上面的情景要是使用 if-else 的话，难以扩展和维护，甚至类型多的情况下会很复杂：

	if 老年人
	   读取动物介绍
	else if 年轻人
	    if 跳跳虎
		     动物喂食
	    if 熊猫
	         动物玩

1. 访问者模式另各个角色分离；
2. 扩展性良好，更灵活；
3. 数据和操作解耦；

### 缺点

1.被访问者修改了后，操作修改变更大；
2.为了对访问的对象有不同的操作，而依赖了具体的类；


----------

## 14.中间人模式

当多个对象的操作互相依赖，互相影响时，中间人模式是个很好的选择。

接下来以拍电影举例，导演喊开始，中间人跑去跟演员说导演喊开始啦，然后演员开始表演，演员突然笑场，要中间人跑去给导演说，演员笑场了，然后导演重新喊开始：

### 定义中间人抽象类，也可以是接口

	
	/**
	 * Created by yangshuai in the 22:07 of 2016.07.05 .
	 * 中间人，跑腿的，每个人的状态更新后都要去通知相关的人。
	 */
	public abstract class Mediator {
	
	    public abstract void updataState(People people);
	}

### 定义互相影响的对象的抽象基类，也可以是接口
	
	/**
	 * Created by yangshuai in the 22:07 of 2016.07.05 .
	 * 人的抽象类，可以是接口
	 */
	public abstract class People {
	    protected Mediator mediator;
	
	    public People(Mediator mediator) {
	        this.mediator = mediator;
	    }
	}

### 创建具体的互相影响的对象
	
	/**
	 * Created by yangshuai in the 22:13 of 2016.07.05 .
	 * 导演，用于喊 开始，然后演员开始演戏
	 */
	public class Director extends People {
	    public Director(Mediator mediator) {
	        super(mediator);
	    }
	
	    public void action() {
	        mediator.updataState(this);
	    }
	}
	
	/**
	 * Created by yangshuai in the 22:15 of 2016.07.05 .
	 * 演员，在导演喊开始后开始演戏，中间笑场了导演要重新喊开始。
	 */
	public class Player extends People {
	    public Player(Mediator mediator) {
	        super(mediator);
	    }
	
	    public void laughAload() {
	        mediator.updataState(this);
	    }
	
	    public void play() {
	        // 开始表演
	    }
	}

### 创建具体的中间人
	
	/**
	 * Created by yangshuai in the 22:17 of 2016.07.05 .
	 * 跑腿的就是中间人，负责通知导演或者演员状态更新。
	 */
	public class Footwork extends Mediator {
	
	    private Player player;
	    private Director director;
	
	    public void setPlayer(Player player) {
	        this.player = player;
	    }
	
	    public void setDirector(Director director) {
	        this.director = director;
	    }
	
	    @Override
	    public void updataState(People people) {
	        if (people instanceof Director) { // 导演喊开始了，这里简化了判断
	            if (player != null) {
	                player.play();
	            }
	        } else if (people instanceof Player) {  // 演员笑场了，这里简化了判断
	            if (director != null) {
	                director.action();
	            }
	        }
	    }
	}

### 使用

	/**
	 * Created by yangshuai in the 22:22 of 2016.07.05 .
	 */
	public class Room {
	    public static void main(String args[]) {
	
	        // 创建中间人，即跑腿的
	        Footwork mediator = new Footwork();
	
	        // 创建导演
	        Director director = new Director(mediator);
	        mediator.setDirector(director);
	
	        // 创建演员
	        Player player = new Player(mediator);
	        mediator.setPlayer(player);
	
	        // 导演喊开始了，然后中间人通知演员开始演戏
	        director.action();
	
	        // 演员笑场了，然后中间人通知导演重新喊开始
	        player.laughAload();
	    }
	}

### 优点

解耦复杂的依赖，清晰逻辑，降低复杂度，提高扩展性。

### 缺点

要是互相依赖的操作量少，中间人模式可能会导致代码的逻辑结构更加复杂化。


----------

## 15.代理模式

当没法去访问一个对象时可以通过代理模式间接访问。代理对象和被代理对象要有相同的接口。

以下以中午带饭为例进行举例：

### 创建代理接口(代理人和被代理人都要实现)

	/**
	 * Created by Afra55 on 2016.07.09 .
	 * 中午吃饭接口, 走路去饭店，购买自己喜欢的食物
	 */
	public interface IEat {
	
	    /**
	     * 走路去饭店
	     */
	    void walk();
	
	    /**
	     * 选择食物
	     */
	    void choose();
	
	    /**
	     * 购买
	     */
	    void buy();
	
	}

### 创建懒人（被代理人）

	/**
	 * Created by Afra55 on 2016.07.09 .
	 * 具体的中午吃饭的人
	 */
	public class Layzer implements IEat {
	
	    @Override
	    public void walk() {
	        System.out.println("走路去飯店");
	    }
	
	    @Override
	    public void choose() {
	        System.out.println("选择食物");
	    }
	
	    @Override
	    public void buy() {
	        System.out.println("掏钱买");
	    }
	}

### 静态代理

#### 创建代理人

	/**
	 * Created by Afra55 on 2016.07.09 .
	 * 懒人懒得出去买饭，交给 Greater 去买，Greater 就是代理人
	 */
	public class Greater implements IEat {
	
	    private final IEat eater;
	
	    public Greater(IEat iEat) {
	        this.eater = iEat;
	    }
	
	    @Override
	    public void walk() {
	        eater.walk();
	    }
	
	    @Override
	    public void choose() {
	        eater.choose();
	    }
	
	    @Override
	    public void buy() {
	        eater.buy();
	    }
	}

#### 使用方法
	
	/**
	 * Created by Afra55 on 2016.07.09 .
	 * 被代理人 通过 代理人 来完成一些列事情
	 */
	public class Main {
	    public static void main(String []args) {
	
	        // 被代理对象
	        IEat layzer = new Layzer();
	
	        // 代理人
	        IEat greater = new Greater(layzer);
	
	        greater.walk();
	        greater.choose();
	        greater.buy();
	    }
	}

### 动态代理

动态代理即通过反射动态生成代理对象，在运行阶段来决定被代理对象而不是编码阶段。在这里使用java提供的动态代理接口 InvocationHandler。

#### 创建动态代理实现类
	
	/**
	 * Created by Afra55 on 2016.07.09 .
	 * 动态代理
	 */
	public class DynamicProxy implements InvocationHandler {
	
	    private final Object object;
	
	    public DynamicProxy(Object o) {
	        this.object = o;
	    }
	
	    @Override
	    public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
	        return method.invoke(object, args);
	    }
	}

#### 使用
	
	/**
	 * Created by Afra55 on 2016.07.09 .
	 * 被代理人 通过 代理人 来完成一些列事情
	 */
	public class Main {
	    public static void main(String []args) {
	
	        // 被代理对象
	        IEat layzer = new Layzer();
	
	        // 获取 classloader
	        ClassLoader classLoader = Layzer.class.getClassLoader();
	
	        // 创建动态代理
	        DynamicProxy dynamicProxy = new DynamicProxy(layzer);
	
	        // 动态创建代理人，完全与被代理对象解耦，不必关心去代理谁，也不必创建代理人类
	        IEat greater = (IEat) Proxy.newProxyInstance(classLoader, new Class[]{IEat.class}, dynamicProxy);
	
	        greater.walk();
	        greater.choose();
	        greater.buy();
	
	    }
	}

### 优点

叼。

### 缺点

叼。


----------

## 16.组合模式

如果一个整体能独立出一部分模块或功能时使用。例如，团队和个人。
下面以社会举例，社会由群众组成，群众由团队组成，团队由个人组成。

### 安全的组合模式

#### 创建抽象基类
	
	/**
	 * Created by Afra55 on 2016.07.12 .
	 * 抽象类，用于表示整个社会
	 */
	public abstract class Society {
	
	    protected String name;
	
	    public Society(String name) {
	        this.name = name;
	    }
	
	    public abstract void doSomething();
	}

#### 创建群众

	import java.util.ArrayList;
	import java.util.List;
	
	/**
	 * Created by Afra55 on 2016.07.12 .
	 * 社会由群体组成，群体是社会的具体实现.
	 * 群体又由各个团队组成.
	 */
	public class Mass extends Society {
	
	    /**
	     * 存储各个团队的容器
	     */
	    private List<Society> societyList = new ArrayList<>();
	
	    public Mass(String name) {
	        super(name);
	    }
	
	    /**
	     * 添加团队
	     * @param society 团队
	     */
	    public void addTeam(Society society) {
	        societyList.add(society);
	    }
	
	    /**
	     * 移除团队
	     * @param society 团队
	     */
	    public void removeTeam(Society society) {
	        if (societyList.contains(society)) {
	            societyList.remove(society);
	        }
	    }
	
	    /**
	     * 获取团队数量
	     * @return 团队的数量
	     */
	    public int getTeamCount() {
	        return societyList.size();
	    }
	
	    /**
	     * 获取团队
	     * @param index 团队索引
	     * @return
	     */
	    public Society getTeam(int index) {
	        if (index < getTeamCount()) {
	            return societyList.get(index);
	        } else {
	            throw new IndexOutOfBoundsException("这个团队不存在");
	        }
	    }
	
	    @Override
	    public void doSomething() {
	        System.out.println(name + "群众是伟大的");
	        for (int i = 0 ; i< getTeamCount(); i++) {
	            getTeam(i).doSomething();
	        }
	    }
	}

#### 创建团队

	/**
	 * Created by Afra55 on 2016.07.12 .
	 * 个人组成了群众，个人又有个人组成
	 */
	public class Team extends Society {
	
	    /**
	     * 存储个人的容器
	     */
	    private List<Society> societyList = new ArrayList<>();
	    
	    public Team(String name) {
	        super(name);
	    }
	
	    /**
	     * 添加个人
	     * @param society 个人
	     */
	    public void addPeople(Society society) {
	        societyList.add(society);
	    }
	
	    /**
	     * 移除个人
	     * @param society 个人
	     */
	    public void removePeople(Society society) {
	        if (societyList.contains(society)) {
	            societyList.remove(society);
	        }
	    }
	
	    /**
	     * 获取个人数量
	     * @return 个人的数量
	     */
	    public int getPeopleCount() {
	        return societyList.size();
	    }
	
	    /**
	     * 获取个人
	     * @param index 个人索引
	     * @return
	     */
	    public Society getPeople(int index) {
	        if (index < getPeopleCount()) {
	            return societyList.get(index);
	        } else {
	            throw new IndexOutOfBoundsException("这个人不存在");
	        }
	    }
	
	    @Override
	    public void doSomething() {
	        System.out.println(name + "团队是伟大的");
	        for (int i = 0 ; i< getPeopleCount(); i++) {
	            getPeople(i).doSomething();
	        }
	    }
	}

#### 创建个人

	/**
	 * Created by Afra55 on 2016.07.12 .
	 * 个人组成了团队，是整个社会的记事
	 */
	public class People extends Society {
	
	    public People(String name) {
	        super(name);
	    }
	
	    @Override
	    public void doSomething() {
	        System.out.println(name + "是伟大的");
	    }
	}

#### 使用

	public class Main {
	    public static void main(String []args) {
	
	        // 创建个人
	        People afra55 = new People("Afra55");
	        People victor = new People("Victor");
	        People aaa = new People("AAA啊哈");
	
	        // 创建 java tema
	        Team javaTeam = new Team("Java");
	        javaTeam.addPeople(afra55);
	
	        // 创建 android team
	        Team androidTeam = new Team("Andrid");
	        androidTeam.addPeople(victor);
	        androidTeam.addPeople(aaa);
	
	        // 创建群众
	        Mass mass = new Mass("西安");
	        mass.addTeam(javaTeam);
	        mass.addTeam(androidTeam);
	
	        mass.doSomething();
	    }
	}

输出：

	西安群众是伟大的
	Java团队是伟大的
	Afra55是伟大的
	Andrid团队是伟大的
	Victor是伟大的
	AAA啊哈是伟大的

### 透明的组合模式

 上述的例子中，不同的成员是有着不同的结构，在透明的组合模式中，他们都有着相同的结构，因而一些操作要放到内部进行判断。对于面向接口的编程，这个方法优先考虑。

#### 创建抽象基类

	/**
	 * Created by Afra55 on 2016.07.12 .
	 * 抽象类，用于表示整个社会
	 */
	public abstract class Society {
	
	    protected String name;
	
	    public Society(String name) {
	        this.name = name;
	    }
	
	    /**
	     * 添加子模块
	     * @param society
	     */
	    public abstract void addSubSociety(Society society);
	
	    /**
	     * 移除子模块
	     * @param society
	     */
	    public abstract void removeSubSociety(Society society);
	
	    /**
	     * 获取子模块个数
	     * @return
	     */
	    public abstract int getSubSocietyCount();
	
	    /**
	     * 获取子模块
	     * @param index 子模块索引
	     * @return
	     */
	    public abstract Society getSubSociety(int index);
	
	    public abstract void doSomething();
	}

#### 创建群众

	/**
	 * Created by Afra55 on 2016.07.12 .
	 * 社会由群体组成，群体是社会的具体实现.
	 * 群体又由各个团队组成.
	 */
	public class Mass extends Society {
	
	    /**
	     * 存储各个团队的容器
	     */
	    private List<Society> societyList = new ArrayList<>();
	
	    public Mass(String name) {
	        super(name);
	    }
	
	    @Override
	    public void addSubSociety(Society society) {
	        societyList.add(society);
	    }
	
	    @Override
	    public void removeSubSociety(Society society) {
	        if (societyList.contains(society)) {
	            societyList.remove(society);
	        }
	    }
	
	    @Override
	    public int getSubSocietyCount() {
	        return societyList.size();
	    }
	
	    @Override
	    public Society getSubSociety(int index) {
	        if (index < getSubSocietyCount()) {
	            return societyList.get(index);
	        } else {
	            throw new IndexOutOfBoundsException("这个团队不存在");
	        }
	    }
	
	
	    @Override
	    public void doSomething() {
	        System.out.println(name + "群众是伟大的");
	        for (int i = 0 ; i< getSubSocietyCount(); i++) {
	            getSubSociety(i).doSomething();
	        }
	    }
	}

#### 创建团队

	/**
	 * Created by Afra55 on 2016.07.12 .
	 * 个人组成了群众，个人又有个人组成
	 */
	public class Team extends Society {
	
	    /**
	     * 存储个人的容器
	     */
	    private List<Society> societyList = new ArrayList<>();
	    
	    public Team(String name) {
	        super(name);
	    }
	
	    @Override
	    public void addSubSociety(Society society) {
	        societyList.add(society);
	    }
	
	    @Override
	    public void removeSubSociety(Society society) {
	        if (societyList.contains(society)) {
	            societyList.remove(society);
	        }
	    }
	
	    @Override
	    public int getSubSocietyCount() {
	        return societyList.size();
	    }
	
	    @Override
	    public Society getSubSociety(int index) {
	        if (index < getSubSocietyCount()) {
	            return societyList.get(index);
	        } else {
	            throw new IndexOutOfBoundsException("这个人不存在");
	        }
	    }
	
	    @Override
	    public void doSomething() {
	        System.out.println(name + "团队是伟大的");
	        for (int i = 0 ; i< getSubSocietyCount(); i++) {
	            getSubSociety(i).doSomething();
	        }
	    }
	}

#### 创建个人

	/**
	 * Created by Afra55 on 2016.07.12 .
	 * 个人组成了团队，是整个社会的记事
	 */
	public class People extends Society {
	
	    public People(String name) {
	        super(name);
	    }
	
	    @Override
	    public void addSubSociety(Society society) {
	        throw new UnsupportedOperationException("个人是个个体，没有子模块");
	    }
	
	    @Override
	    public void removeSubSociety(Society society) {
	        throw new UnsupportedOperationException("个人是个个体，没有子模块");
	    }
	
	    @Override
	    public int getSubSocietyCount() {
	        throw new UnsupportedOperationException("个人是个个体，没有子模块");
	    }
	
	    @Override
	    public Society getSubSociety(int index) {
	        throw new UnsupportedOperationException("个人是个个体，没有子模块");
	    }
	
	    @Override
	    public void doSomething() {
	        System.out.println(name + "是伟大的");
	    }
	}


#### 使用

	public class Main {
	    public static void main(String []args) {
	
	        // 创建个人
	        People afra55 = new People("Afra55");
	        People victor = new People("Victor");
	        People aaa = new People("AAA啊哈");
	
	        // 创建 java tema
	        Team javaTeam = new Team("Java");
	        javaTeam.addSubSociety(afra55);
	
	        // 创建 android team
	        Team androidTeam = new Team("Andrid");
	        androidTeam.addSubSociety(victor);
	        androidTeam.addSubSociety(aaa);
	
	        // 创建群众
	        Mass mass = new Mass("西安");
	        mass.addSubSociety(javaTeam);
	        mass.addSubSociety(androidTeam);
	
	        mass.doSomething();
	    }
	}
	
输出：

	西安群众是伟大的
	Java团队是伟大的
	Afra55是伟大的
	Andrid团队是伟大的
	Victor是伟大的
	AAA啊哈是伟大的

### 优点

不必关心对象是个集合还是个体，新增各种成员都很方便，只要继承基类实现抽象方法即可，不用修改现有的类。
组合模式可以生成复杂的树形结构，对各个节点的操作统一而且简单。

### 缺点

新增的成员局限于基类，想要统一新功能就要修改基类，所有的继承基类的类都会进行修改。如果不修改基类，依赖类型，则会对类型进行判断，增加了代码复杂度。


----------

## 17.适配器模式

当接口不兼容而去兼容接口，或者建立一个可以重复被不同对象使用的类，或者统一输出接口，设配器模式很合适。

下面以蓝牙耳机举例，假设某款蓝牙耳机支持蓝牙4.1的设备不支持4.0的蓝牙设备，现在有个蓝牙4.0的手机连接蓝牙耳机，需要把蓝牙耳机的蓝牙设备版本4.1兼容4.0。

### 创建接口

	 /**
	 * Created by Afra55 on 2016.07.13 .
	 * 蓝牙版本接口
	 */
	public interface IVersion {
	
	    double getVersion();
	}


### 需要适配的类

	/**
	 * Created by Afra55 on 2016.07.13 .
	 * 蓝牙耳机支持的蓝牙版本是4.1，不支持4.0
	 */
	public class BluetoothHeadset implements IVersion {
	    @Override
	    public double getVersion() {
	        return 4.1;
	    }
	}

### 类适配器模式

#### 创建适配器

	/**
	 * Created by Afra55 on 2016.07.13 .
	 * 蓝牙适配器吧蓝牙耳机的蓝牙版本转换为4.0，以便连接手机。
	 */
	public class BluetoothAdapter extends BluetoothHeadset {
	
	    @Override
	    public double getVersion() {
	        return 4.0;
	    }
	}

#### 使用 

	public class Main {
	    public static void main(String []args) {
	        BluetoothAdapter bluetoothAdapter = new BluetoothAdapter();
	        System.out.println(bluetoothAdapter.getVersion());
	    }
	}

### 对象适配器模式

#### 创建适配器

	/**
	 * Created by Afra55 on 2016.07.13 .
	 * 蓝牙适配器吧蓝牙耳机的蓝牙版本转换为4.0，以便连接手机。
	 */
	public class BluetoothAdapter implements IVersion {
	
	    private final BluetoothHeadset bluetoothHeadset;
	
	    public BluetoothAdapter(BluetoothHeadset bluetoothHeadset) {
	       this.bluetoothHeadset = bluetoothHeadset;
	    }
	
	    public double getOriginVersion() {
	        return bluetoothHeadset.getVersion();
	    }
	
	    @Override
	    public double getVersion() {
	        // 在这里进行蓝牙版本转换
	        return 4.0;
	    }
	}

#### 使用


	public class Main {
	    public static void main(String []args) {
	        BluetoothHeadset bluetoothHeadset = new BluetoothHeadset();
	        BluetoothAdapter bluetoothAdapter = new BluetoothAdapter(bluetoothHeadset);
	
	        System.out.println("蓝牙耳机支持的版本： " + bluetoothAdapter.getOriginVersion());
	        System.out.println("蓝牙耳机适配后的版本： " + bluetoothAdapter.getVersion());
	    }
	}

### 优点

良好的复用性和扩展性。

### 缺点

过多的使用适配器，会造成代码的复杂度提升。


----------

## 18.装饰模式

要透明且动态的扩展类的功能时，装饰模式是个好的选择。

比如，给人穿不同的衣服，人的 dress 方法是 准备穿衣，现在要扩展功能，穿各种各样的衣服：

### 创建人的抽象基类，也可以是接口

	/**
	 * Created by Afra55 on 2016.07.14 .
	 * 人的抽象基类，有个穿衣服的抽象方法
	 */
	public abstract class People {
	
	    /**
	     * 穿衣服
	     */
	    public abstract void dressed();
	}

### 人的实现类

	/**
	 * Created by Afra55 on 2016.07.14 .
	 * 人的实现类
	 */
	public class Man extends People {
	
	    private String name;
	
	    public Man(String name) {
	        this.name = name;
	    }
	
	    public String getName() {
	        return name;
	    }
	
	    /**
	     * 只有准备衣服的功能
	     */
	    @Override
	    public void dressed() {
	        System.out.println(getName() +" 准备衣服");
	    }
	}

### 创建衣服的抽象基类，这里偷懒了
	
	/**
	 * Created by Afra55 on 2016.07.14 .
	 * 衣服基类，保持了一个 people 的引用
	 */
	public class Cloth extends People {
	
	    protected People people;
	
	    public Cloth(People people) {
	        this.people = people;
	    }
	
	    @Override
	    public void dressed() {
	        people.dressed();
	    }
	}

### 创建裙子

	/**
	 * Created by Afra55 on 2016.07.14 .
	 * 裙子
	 */
	public class Skirt extends Cloth {
	
	    public Skirt(People people) {
	        super(people);
	    }
	
	    @Override
	    public void dressed() {
	        super.dressed();
	        dressSkirt();
	    }
	
	    private void dressSkirt() {
	        System.out.println("穿连衣裙");
	    }
	}

### 创建西服
	
	/**
	 * Created by Afra55 on 2016.07.14 .
	 * 西服
	 */
	public class Suit extends Cloth {
	
	    public Suit(People people) {
	        super(people);
	    }
	
	    @Override
	    public void dressed() {
	        super.dressed();
	        dressSuit();
	    }
	
	    private void dressSuit() {
	        System.out.println("穿上西服");
	    }
	}

### 使用

	public class Main {
	    public static void main(String []args) {
	
	        // 创建了一个人
	        People you = new Man("Victoor");
	
	        // 创建西服，持有 you 对象
	        Cloth suit = new Suit(you);
	        suit.dressed();
	
	        // 创建连衣裙，持有 you 对象
	        Cloth skirt = new Skirt(you);
	        skirt.dressed();
	
	    }
	}

### 优点

动态扩展对象的功能。

### 缺点



----------

## 19.享元模式

当有大量的重复对象出现，每次调用都会去new 一个新的对象，这个对象并没有什么改变，这个时候使用享元模式较好，可以避免创建多个对象。也可以充当缓冲池使用。

以下以天气查询举例，每天都会有人通过日期查询天气，日期相同返回的结果就相同，当有数以百万计的人查询一个相同的日期时，每次创建新的信息对象会对系统造成很大的负担，像这类重复的对象，可以使用缓冲池来读取缓存里的对象：

### 创建接口

	/**
	 * Created by Afra55 on 2016.07.15 .
	 * 天气接口，只获取天气情况
	 */
	public interface IWeather {
	
	    String getWeatherItem();
	}

### 创建实现类

	/**
	 * Created by Afra55 on 2016.07.15 .
	 * 天气的实现类
	 */
	public class WeatherItem implements IWeather {
	
	    private String date;
	
	    public WeatherItem(String date) {
	        this.date = date;
	    }
	
	    @Override
	    public String getWeatherItem() {
	
	        String result = "未查到信息";
	        // 请忽略偷懒的代码
	        int random = new Random().nextInt(100);
	        switch (date) {
	            case "今天":
	                result = "晴天 "  + random + "摄氏度";
	                break;
	            case "明天":
	                result = "小雨 " + random + "摄氏度";
	                break;
	            case "后天":
	                result = "阴天 " + random + "摄氏度";
	                break;
	        }
	
	        return result;
	    }
	}

### 创建享元工厂

	/**
	 * Created by Afra55 on 2016.07.15 .
	 * 享元模式的体现，减少重复对象的存在，让同类对象多次复用
	 */
	public class WeatherFactory {
	    // 使用 map 容器来存储 天气 对象，以便在下一次查询时只拿缓存中的
	    private static Map<String, IWeather> weatherMap = new ConcurrentHashMap<>();
	
	    public static IWeather getWeatherInfo(String date) {
	
	        if (weatherMap.containsKey(date)) { // 使用缓存的
	            return weatherMap.get(date);
	        } else {
	            IWeather weather = new WeatherItem(date);  // 创建新对象
	            weatherMap.put(date, weather);
	            return weather;
	        }
	    }
	}

### 使用举例
	
	public class Main {
	    public static void main(String []args) {
	
	        for (int i = 0 ;i < 100; i++) {
	            System.out.println(WeatherFactory.getWeatherInfo("今天").getWeatherItem());
	            System.out.println(WeatherFactory.getWeatherInfo("明天").getWeatherItem());
	            System.out.println(WeatherFactory.getWeatherInfo("后天").getWeatherItem());
	        }
	    }
	}

### 优点

减少重复类的创建，降低内存使用。

### 缺点

逻辑复杂，代码复杂，从缓冲区中读取从而增加了读取时间。


----------
