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

## Java 内存分配策略

Java 程序运行时的内存分配策略有三种,分别是静态分配,栈式分配,和堆式分配，对应的，三种存储策略使用的内存空间主要分别是静态存储区（也称方法区）、栈区和堆区

- 静态存储区（方法区）：主要存放静态数据、全局 static 数据和常量。这块内存在程序编译时就已经分配好，并且在程序整个运行期间都存在

- 栈区 ：当方法被执行时，方法体内的局部变量（其中包括基础数据类型、对象的引用）都在栈上创建，并在方法执行结束时这些局部变量所持有的内存将会自动被释放。因为栈内存分配运算内置于处理器的指令集中，效率很高，但是分配的内存容量有限

- 堆区 ： 又称动态内存分配，用来存放所有由 new 创建的对象（包括该对象其中的所有成员变量）和数组，在堆中分配的内存，将由 Java 垃圾回收器来自动管理，在不使用时将会由 Java 垃圾回收器来负责回收。在堆中产生了一个数组或者对象后，还可以在栈中定义一个特殊的变量，这个变量的取值等于数组或者对象在堆内存中的首地址，这个特殊的变量就是我们上面说的引用变量。可以通过这个引用变量来访问堆中的对象或者数组

## Java内存泄漏

内存泄漏是指无用对象（不再使用的对象）持续占有内存或无用对象的内存得不到及时释放，从而造成内存空间的浪费称为内存泄漏

- 集合类泄漏，如果这个集合类是全局性的变量 (比如类中的静态属性，全局性的 map 等即有静态引用或 final 一直指向它)，那么没有相应的删除机制，很可能导致集合所占用的内存只增不减
- 单例造成的内存泄漏，单例的静态特性使得其生命周期跟应用的生命周期一样长，如果单例持有了 Activity 的 Context，当这个 Context 所对应的 Activity 退出时，由于该 Context 的引用被单例对象所持有，其生命周期等于整个应用程序的生命周期，so 当前 Activity 退出时它的内存并不会被回收，这就造成泄漏了
- 非静态内部类创建静态实例造成的内存泄漏,非静态内部类默认会持有外部类的引用，而该非静态内部类又创建了一个静态的实例，该实例的生命周期和应用的一样长，这就导致了该静态实例一直会持有该Activity的引用，导致Activity的内存资源不能正常回收
- 匿名内部类,并被异步线程持有,匿名内部类会默认持有当前上下文，就造成了生命周期不同
- Handler 造成的内存泄漏，由于 Handler 属于 TLS(Thread Local Storage) 变量, 生命周期和 Activity 是不一致的。因此这种实现方式一般很难保证跟 View 或者 Activity 的生命周期保持一致，故很容易导致无法正确释放，推荐使用静态内部类 + WeakReference 这种方式。每次使用前注意判空
- static 成员变量，如果成员变量被声明为 static，那我们都知道其生命周期将与整个app进程生命周期一样
- 避免重写 finalize() 方法,finalize 方法被执行的时间不确定，不能依赖与它来释放紧缺的资源,finalize 方法只会被执行一次，即使对象被复活，如果已经执行过了 finalize 方法，再次被 GC 时也不会再执行了,含有Finalize方法的object需要至少经过两轮GC才有可能被释放
- 资源未关闭造成的内存泄漏, 使用了BraodcastReceiver，ContentObserver，File，游标 Cursor，Stream，Bitmap等资源，应该在Activity销毁时及时关闭或者注销，否则这些资源将不会被回收，造成内存泄漏

## AsyncTask

从Android3.0开始，系统要求网络访问必须在子线程中进行，否则网络访问将会失败并抛出NetworkOnMainThreadException这个异常，这样做是为了避免主线程由于耗时操作所阻塞从而出现ANR现象

AsyncTask封装了线程池和Handler。AsyncTask有两个线程池：SerialExecutor和THREAD_POOL_EXECUTOR。前者是用于任务的排队，默认是串行的线程池：后者用于真正的执行任务。AsyncTask还有一个Handler，叫InternalHandler，用于将执行环境从线程池切换到主线程。AsyncTask内部就是通过InternalHandler来发送任务执行的进度以及执行结束等消息

排队执行过程：系统先把参数Params封装为FutureTask对象，它相当于Runnable，接着FutureTask交给SerialExcutor的execute方法，它先把FutureTask插入到任务队列tasks中，如果这个时候没有正在活动的AsyncTask任务，那么就会执行下一个AsyncTask任务，同时当一个AsyncTask任务执行完毕之后，AsyncTask会继续执行其他任务直到所有任务都被执行为止

AsyncTask对应的线程池ThreadPoolExecutor都是进程范围内共享的，都是static的，所以是AsyncTask控制着进程范围内所有的子类实例。由于这个限制的存在，当使用默认线程池时，如果线程数超过线程池的最大容量，线程池就会爆掉(3.0默认串行执行，不会出现这个问题)。针对这种情况。可以尝试自定义线程池，配合AsyncTask使用

## 动态加载dex

Android使用Dalvik虚拟机加载可执行程序，所以不能直接加载基于class的jar，而是需要将class转化为dex字节码。

Android支持动态加载的两种方式是：DexClassLoader和PathClassLoader，DexClassLoader可加载jar/apk/dex，且支持从SD卡加载；PathClassLoader据说只能加载已经安装在Android系统内APK文件

## 插件化

- 开发者将插件代码封装成Jar或者APK
- 宿主下载或者从本地加载Jar或者APK到宿主中
- 将宿主调用插件中的算法或者Android特定的Class（如Activity）

动态加载技术就是使用类加载器加载相应的apk、dex、jar(必须含有dex文件)，再通过反射获得该apk、dex、jar内部的资源（class、图片、color等等）进而供宿主app使用

## 事件分发

![事件分发](https://raw.githubusercontent.com/Afra55/Afra55.github.io/7579eaba4fdf1af8fe4ea768c25edbee6cb85d63/blog_picture/shortcuts/事件分发.jpeg)

## ANR

在Android上，如果你的应用程序有一段时间响应不够灵敏，系统会向用户显示一个对话框，这个对话框称作应用程序无响应（ANR：Application Not Responding）对话框

一般有三种类型:

- KeyDispatchTimeout(5 seconds) :按键或触摸事件在特定时间内无响应
- BroadcastTimeout(10 seconds) :BroadcastReceiver在特定时间内无法处理完成
- ServiceTimeout(20 secends) :小概率事件 Service在特定的时间内无法处理完成

在主线程执行以下操作时，会导致ANR ：

- 高耗时的操作，如图像变换
- 磁盘读写，数据库读写操作
- 大量的创建新对象

UI线程尽量只做跟UI相关的工作, 耗时的操作(比如数据库操作，I/O，连接网络或者别的有可能阻塞UI线程的操作)把它放在单独的线程处理, 尽量用Handler来处理UIThread和别的Thread之间的交互

可以获取 ANR 追踪信息， 从trace.txt文件查看调用stack `adb pull data/anr/traces.txt ./mytraces.txt`

## Force Close

- Error
- OOM（Out Of Memory），内存溢出即 加载对象过大或相应资源过多，来不及释放
- StackOverFlowError
- Runtime,比如说空指针异常

## ART和Dalvik区别

ART: Ahead of Time Dalvik: Just in Time

Art上应用启动快，运行快，但是耗费更多存储空间，安装时间长，总的来说ART的功效就是"空间换时间"

Dalvik是Google公司自己设计用于Android平台的Java虚拟机

Dalvik虚拟机是Google等厂商合作开发的Android移动设备平台的核心组成部分之一，它可以支持已转换为.dex(即Dalvik Executable)格式的Java应用程序的运行，.dex格式是专为Dalvik应用设计的一种压缩格式，适合内存和处理器速度有限的系统。Dalvik经过优化，允许在有限的内存中同时运行多个虚拟机的实例，并且每一个Dalvik应用作为独立的Linux进程执行。独立的进程可以防止在虚拟机崩溃的时候所有程序都被关闭

什么是ART:Android操作系统已经成熟，Google的Android团队开始将注意力转向一些底层组件，其中之一是负责应用程序运行的Dalvik运行时。Google开发者已经花了多年时间开发更快执行效率更高更省电的替代ART运行时。ART代表Android Runtime,其处理应用程序执行的方式完全不同于Dalvik，Dalvik是依靠一个Just-In-Time(JIT)编译器去解释字节码。开发者编译后的应用代码需要通过一个解释器在用户的设备上运行，这一机制并不高效，但让应用能更容易在不同硬件和架构上运行。ART则完全改变了这套做法，在应用安装的时候就预编译字节码到机器语言，这一机制叫Ahead-Of-Time(AOT)编译。在移除解释代码这一过程后，应用程序执行将更有效率，启动更快

ART优点：

- 系统性能的显著提升
- 应用启动更快、运行更快、体验更流畅、触感反馈更及时
- 更长的电池续航能力
- 支持更低的硬件

ART缺点：

- 更大的存储空间占用，可能会增加10%-20%
- 更长的应用安装时间

## SurfaceView

因为 View 的绘制存在缺陷，所以 SurfaceView 来替代 View 绘制

View的绘图存在以下缺陷：

- View缺乏双缓冲机制
- 当程序需要更新View上的图像时，程序必须重绘View上显示的整张图片
- 新线程无法直接更新View组件

SurfaceView的绘图机

- 一般会与SurfaceView结合使用
- 调用SurfaceView的getHolder()方法即可获得SurfaceView关联的SurfaceHolder

    SurfaceView surface = (SurfaceView) findViewById(R.id.surface);
    // 初始化SurfaceHolder对象
    holder = surface.getHolder();
    holder.addCallback(new Callback(){
        @Override
        public void surfaceChanged(SurfaceHolder arg0, int arg1, int arg2,
                int arg3){
        }
        @Override
        public void surfaceCreated(SurfaceHolder holder){
        }
        @Override
        public void surfaceDestroyed(SurfaceHolder holder){
        }
    });
    // 为surface的触摸事件绑定监听器
    surface.setOnTouchListener(new OnTouchListener(){
        @Override
        public boolean onTouch(View source, MotionEvent event){
            
            return false;
        }
    });

SurfaceHolder提供了如下方法来获取Canvas对象

- Canvas canvas = holder.lockCanvas():锁定整个SurfaceView对象，获取该Surface上的Canvas
- Canvas canvas = holder.lockCanvas(Rect dirty):锁定SurfaceView上Rect划分的区域，获取该Surface上的Canvas
- holder.unlockCanvasAndPost(canvas):释放绘图、提交所绘制的图形，需要注意，当调用SurfaceHolder上的unlockCanvasAndPost方法之后，该方法之前所绘制的图形还处于缓冲之中，下一次lockCanvas()方法锁定的区域可能会“遮挡”它

## 图片的三级缓存

- 网络加载，不优先加载，速度慢，浪费流量
- 本地缓存，次优先加载，速度快
- 内存缓存，优先加载，速度最快

## Bitmap

创建Bitmap的时候，Java不提供new Bitmap()的形式去创建，而是通过BitmapFactory中的静态方法去创建,如:`BitmapFactory.decodeStream(is);` 

在Android中，4.4版本及以上默认采用Config.ARGB_8888的参数去创建一个Bitmap，这是Google推荐的配置色彩参数(Bitmap.Config.inPreferredConfig的默认值)，那么每一个像素将会占用4byte，如果一张手机照片的尺寸为1280×720，那么我们可以很容易的计算出这张图片占用的内存大小为 1280x720x4 = 3686400(byte) = 3.5M

    BitmapFactory.Options options = new BitmapFactory.Options();
    //当这个参数为true的时候,意味着你可以在解析时候不申请内存的情况下去获取Bitmap的宽和高
    //这是调整Bitmap Size一个很重要的参数设置
    options.inJustDecodeBounds = true;
    BitmapFactory.decodeStream(is, null, options);
    int realHeight = options.outHeight;
    int realWidth = options.outWidth;
    double wr = (double) realWidth / screenWidth;   // screenWidth 希望图片压缩的目的宽度
    double hr = (double) realHeight / 300;      // 300 希望图片压缩的目的高度
    double ratio = Math.min(wr, hr);
    float n = 1.0f;
    //这里我们为什么要寻找 与ratio最接近的2的倍数呢？
    //原因就在于API中对于inSimpleSize的注释：最终的inSimpleSize应该为2的倍数，我们应该向上取与压缩比最接近的2的倍数。
    while ((n * 2) <= ratio) {
        n *= 2;
    }
    options.inSampleSize = n;
    //当你希望得到Bitmap实例的时候，不要忘了将这个参数设置为false
    options.inJustDecodeBounds = false;
    Bitmap bitmap = BitmapFactory.decodeStream(is,null,options);
    iv.setImageBitmap(bitmap);

一定要记得及时回收Bitmap，否则如上分析，你的native以及dalvik的内存都会被一直占用着，最终导致OOM

     // 先判断是否已经回收
     if(bitmap != null && !bitmap.isRecycled()){
         // 回收并且置为null
         bitmap.recycle();
         bitmap = null;
     }
     System.gc();






































