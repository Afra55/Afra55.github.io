---
layout: post
title:  "An_dro_id 你想的我都没有 (私密)"
date:   2018-1-26 13:00
categories: Android
comments: true
description: Android 渐行渐远
---

* content
{:toc}

## 本文

[http://afra55.github.io/2018/01/26/android-fading-in-the-dark/](http://afra55.github.io/2018/01/26/android-fading-in-the-dark/)

## 六种布局

框架布局 FrameLayout

线性布局 LinearLayout

绝对布局 AbsoluteLayout 

相对布局 RelativeLayout 

表格布局 TableLayout

约束布局 [ConstraintLayout](http://blog.csdn.net/yang786654260/article/details/52613485)

## Activity 生命周期

![acitivty 生命周期](https://raw.githubusercontent.com/Afra55/Afra55.github.io/838e098a14e3a16c6f5d94ff4bbfd8398590f587/blog_picture/shortcuts/activity-life.png)

启动Activity: onCreate()—>onStart()—>onResume()，Activity进入运行状态

Activity退居后台: 当前Activity转到新的Activity界面或按Home键回到主屏： onPause()—>onStop()，进入停滞状态

Activity返回前台: onRestart()—>onStart()—>onResume()，再次回到运行状态

Activity退居后台，且系统内存不足， 系统会杀死这个后台状态的Activity（此时这个Activity引用仍然处在任务栈中，只是这个时候引用指向的对象已经为null），若再次回到这个Activity,则会走onCreate()–>onStart()—>onResume()(将重新走一次Activity的初始化生命周期)

锁屏：onPause()->onStop()

解锁：onStart()->onResume()

## Acivity任务栈

`android:launchMode="standard|singleInstance|singleTask|singleTop`

任务栈是一种后进先出的结构。位于栈顶的Activity处于焦点状态,当按下back按钮的时候,栈内的Activity会一个一个的出栈,并且调用其onDestory()方法。如果栈内没有Activity,那么系统就会回收这个栈,每个APP默认只有一个栈,以APP的包名来命名

standard : 标准模式,每次启动Activity都会创建一个新的Activity实例,并且将其压入任务栈栈顶,而不管这个Activity是否已经存在。Activity的启动三回调(onCreate()->onStart()->onResume())都会执行

singleTop : 栈顶复用模式.这种模式下,如果新Activity已经位于任务栈的栈顶,那么此Activity不会被重新创建,所以它的启动三回调就不会执行,同时Activity的onNewIntent()方法会被回调.如果Activity已经存在但是不在栈顶,那么作用与standard模式一样

singleTask: 栈内复用模式.创建这样的Activity的时候,系统会先确认它所需任务栈已经创建,否则先创建任务栈.然后放入Activity,如果栈中已经有一个Activity实例,那么这个Activity就会被调到栈顶,onNewIntent(),并且singleTask会清理在当前Activity上面的所有Activity.(clear top)

singleInstance : 加强版的singleTask模式,这种模式的Activity只能单独位于一个任务栈内,由于栈内复用的特性,后续请求均不会创建新的Activity,除非这个独特的任务栈被系统销毁了

Activity的堆栈管理以ActivityRecord为单位,所有的ActivityRecord都放在一个List里面.可以认为一个ActivityRecord就是一个Activity栈

## Activity缓存

有a、b两个Activity，当从a进入b之后一段时间，可能系统会把a回收，这时候按back，执行的不是a的onRestart而是onCreate方法，a被重新创建一次，这是a中的临时数据和状态可能就丢失了

可以用Activity中的onSaveInstanceState()回调方法保存临时数据和状态，这个方法一定会在活动被回收之前调用。方法中有一个Bundle参数，putString()、putInt()等方法需要传入两个参数，一个键一个值。数据保存之后会在onCreate中恢复，onCreate也有一个Bundle类型的参数

        @Override
        protected void onCreate(Bundle savedInstanceState) {
            super.onCreate(savedInstanceState);
            setContentView(R.layout.activity_main);

            //这里，当Acivity第一次被创建的时候为空
            //所以我们需要判断一下
            if( savedInstanceState != null ){
                savedInstanceState.getString("anAnt");
            }
        }

        @Override
        protected void onSaveInstanceState(Bundle outState) {
            super.onSaveInstanceState(outState);

            outState.putString("anAnt","Android");

        }

### onSaveInstanceState

`onSaveInstanceState(Bundle outState)` 会在如下几种情况执行:

- 当用户按下HOME键时
- 长按HOME键，选择运行其他的程序时
- 按下电源按键（关闭屏幕显示）时
- 启动一个新的activity时
- 屏幕方向切换时(如果不指定configchange属性)

非用户控制销毁 activity 时，onSaveInstanceState会被系统调用

布局中的每一个View默认实现了onSaveInstanceState()方法，这样的话，这个UI的任何改变都会自动地存储和在activity重新创建的时候自动地恢复。但是这种情况只有在你为这个UI提供了唯一的ID之后才起作用，如果没有提供ID，app将不会存储它的状态

onSaveInstanceState()如果被调用，这个方法会在onStop()前被触发，但系统并不保证是否在onPause()之前或者之后触发

### onRestoreInstanceState

当 activity 被系统销毁了，返回 activity 时 onRestoreInstanceState 才会被调用

onRestoreInstanceState在onstart之后执行

onRestoreInstanceState的bundle参数也会传递到onCreate方法中，可以在onCreate方法中做数据还原

    @Override
    public void onSaveInstanceState(Bundle savedInstanceState) {
            savedInstanceState.putBoolean("MyBoolean", true);
            savedInstanceState.putDouble("myDouble", 1.9);
            savedInstanceState.putInt("MyInt", 1);
            savedInstanceState.putString("MyString", "Welcome back to Android");
            // etc.
            super.onSaveInstanceState(savedInstanceState);
    }

    @Override
    public void onRestoreInstanceState(Bundle savedInstanceState) {
            super.onRestoreInstanceState(savedInstanceState);

            boolean myBoolean = savedInstanceState.getBoolean("MyBoolean");
            double myDouble = savedInstanceState.getDouble("myDouble");
            int myInt = savedInstanceState.getInt("MyInt");
            String myString = savedInstanceState.getString("MyString");
    }   

## Fragment 生命周期

![fragment-life](https://raw.githubusercontent.com/Afra55/Afra55.github.io/9462055dfe7e87ec638771646b4e796e82cb7dab/blog_picture/shortcuts/fragment-life.png)

## Fragment 和 Activity 生命周期的关联

![fragment-acitivity-life](https://raw.githubusercontent.com/Afra55/Afra55.github.io/dfe48902ef96e66079d164542183bce4ecb0ba24/blog_picture/shortcuts/activity-fragment-life.png)


## Service 的两种启动方法

前提，在清单文件注册service：

    <service
            android:name=".packnameName.youServiceName"
            android:enabled="true" />

1. 在Context中通过 `public boolean bindService(Intent service,ServiceConnection conn,int flags)` 方法来进行Service与Context的关联并启动，并且Service的生命周期依附于Context
2. 通过 `public ComponentName startService(Intent service)` 方法去启动一个Service，此时Service的生命周期与启动它的Context无关

## Broadcast Receiver 的注册方法

1. 静态注册：在AndroidManifest.xml文件中进行注册，当App退出后，Receiver仍然可以接收到广播并且进行相应的处理
2. 动态注册：在代码中动态注册，当App退出后，也就没办法再接受广播了

## Service 存活

Service设置成 START_STICKY, 杀死后 会被重启（等待5秒左右），重传Intent，保持与重启前一样

提升优先级别在 AndroidManifest.xml文件中对于intent-filter可以通过`android:priority="1000"`这个属性设置最高优先级，1000是最高值，如果数字越小则优先级越低，同时适用于广播(可能无效)

提升service进程优先级, Android中的进程是托管的，当系统进程空间紧张的时候，会依照优先级自动进行进程的回收, 使用`startForeground()`将service放到前台状态(低内存下依旧会被杀死)

onDestroy方法里重启service

监听系统广播判断Service状态

root之后放到system/app变成系统级应用

放一个像素在前台

## 动画

- tween 补间动画。通过指定View的初末状态和变化时间、方式，对View的内容完成一系列的图形变换来实现动画效果。 Alpha Scale Translate Rotate
- frame 帧动画 AnimationDrawable 控制 animation-list xml布局
- PropertyAnimation 属性动画

## 数据存储形式

1. SQLite：SQLite是一个轻量级的数据库，支持基本的SQL语法，是常被采用的一种数据存储方式。推荐使用 [DBFlow](https://guides.codepath.com/android/DBFlow-Guide)
2. SharedPreference: 一个xml文件，常用于存储较简单的参数设置
3. File： 即常说的文件（I/O）存储方法，常用语存储大数量的数据，但是缺点是更新数据将是一件困难的事情
4. ContentProvider: Android系统中能实现所有应用程序共享的一种数据存储方式

## 判断应用被强杀

在Application中定义一个static常量，赋值为－1，在欢迎界面改为0，如果被强杀，application重新初始化，在父类Activity判断该常量的值

被强杀判断，可以放到activity父类判断，如果被强杀，跳转回主界面，如果没有被强杀，执行Activity的初始化操作，给主界面传递intent参数，主界面会调用onNewIntent方法，在onNewIntent跳转到欢迎页面，重新来一遍流程

## Asset目录与res目录

 res 目录下面有很多文件，例如 drawable,mipmap,raw 等。res 下面除了 raw 文件不会被压缩外，其余文件都会被压缩。同时 res目录下的文件可以通过R 文件访问。Asset 也是用来存储资源，但是 asset 文件内容只能通过路径或者 AssetManager 读取

## 如何自定义控件

1. 自定义属性的声明和获取，分析需要的自定义属性，在res/values/attrs.xml定义声明，在layout文件中进行使用，在View的构造方法中进行获取，测量onMeasure
2. 布局onLayout(ViewGroup)
3. 绘制onDraw
4. onTouchEvent
5. onInterceptTouchEvent(ViewGroup)
6. 状态的恢复与保存

## Context区别

- Activity和Service以及Application的Context是不一样的,Activity继承自ContextThemeWraper.其他的继承自ContextWrapper
- 每一个Activity和Service以及Application的Context都是一个新的ContextImpl对象
- getApplication()用来获取Application实例的，但是这个方法只有在Activity和Service中才能调用的到。那么也许在绝大多数情况下我们都是在Activity或者Service中使用Application的，但是如果在一些其它的场景，比如BroadcastReceiver中也想获得Application的实例，这时就可以借助getApplicationContext()方法，getApplicationContext()比getApplication()方法的作用域会更广一些，任何一个Context的实例，只要调用getApplicationContext()方法都可以拿到我们的Application对象
- Activity在创建的时候会new一个ContextImpl对象并在attach方法中关联它，Application和Service也差不多。ContextWrapper的方法内部都是转调ContextImpl的方法
- 创建对话框传入Application的Context是不可以的
- 尽管Application、Activity、Service都有自己的ContextImpl，并且每个ContextImpl都有自己的mResources成员，但是由于它们的mResources成员都来自于唯一的ResourcesManager实例，所以它们看似不同的mResources其实都指向的是同一块内存
- Context的数量等于Activity的个数 + Service的个数 + 1，这个1为Application

## IntentService

IntentService是Service的子类，是一个异步的，会自动停止的服务，很好解决了传统的Service中处理完耗时操作忘记停止并销毁Service的问题

不需要自己去new Thread， 不需要考虑在什么时候关闭该Service

onStartCommand中回调了onStart，onStart中通过mServiceHandler发送消息到该handler的handleMessage中去。最后handleMessage中回调onHandleIntent(intent)

## 每个应用程序最高可用内存

    int maxMemory = (int) (Runtime.getRuntime().maxMemory() / 1024);  
    Log.d("TAG", "Max memory is " + maxMemory + "KB"); 












