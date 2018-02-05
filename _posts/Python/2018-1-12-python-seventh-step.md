---
layout: post
title:  "Python Seventh Step: 线程"
date:   2018-01-12 17:45
categories: Python
comments: true
description: Python Seventh Step！
---

* content
{:toc}

## 本文

[http://afra55.github.io/2018/01/12/python-seventh-step/](http://afra55.github.io/2018/01/12/python-seventh-step/)

## 进程和线程

进程。计算机 程序 只是 存储 在 磁盘 上 的 可执行 二进制（ 或 其他 类型） 文件。 只有 把 它们 加载 到 内存 中 并被 操作系统 调用， 才 拥有 其 生命 期。 进程（ 有时 称为 重量级 进程） 则是 一个 执行 中的 程序。 每个 进程 都 拥有 自己的 地址 空间、 内存、 数据 栈 以及 其他 用于 跟踪 执行 的 辅助 数据。 操作 系统管理 其上 所有 进程 的 执行， 并为 这些 进程 合理 地 分配 时间。 进程 也可以 通过 派生（ fork 或 spawn） 新的 进程 来 执行 其他 任务， 不过 因为 每个 新进 程 也都 拥有 自己的 内存 和 数据 栈 等， 所以 只能 采用 进程 间 通信（ IPC） 的 方式 共享 信息

线程（ 有时候 称为 轻量级 进程） 与 进程 类似， 不过 它们 是在 同一个 进程 下 执行 的， 并 共享 相同 的 上下文。 可以 将它 们 认为 是在 一个 主 进程 或“ 主 线程” 中 并行 运行 的 一些“ 迷你 进程”

线程 一般 是以 并发 方式 执行 的， 正是 由于 这种 并行 和数 据 共享 机制， 使得 多任务 间的 协作 成为 可能

在单核CPU系统中，是以线程让步的形式来实现并发，让步是指线程在运行过程中被中断或临时挂起（睡眠）

## Python 的线程

Python 代码 的 执行 是由 Python 虚拟 机（ 又名 解释器 主 循环） 进行 控制 的

Python 在主循环中同时只能有一个控制线程在执行

在任意给定时刻，只有一个程序在运行

对 Python 虚拟 机 的 访问 是由 全局 解释器 锁（ GIL） 控制 的。 这个 锁 就是 用来 保证 同时 只能 有一个 线程 运行 的

    设置 GIL
    切换进入一个线程去运行
    执行一个操作：指定数量的字节码指令 或 线程主动让出控制权（可以通过调用 time.sleep(0) 实现）
    把线程设置为睡眠状态即切出线程
    解锁 GIL
    重复上面步骤

当一个线程完成其函数的执行时就会退出，还可以通过 thread.exit() 退出或者 sys.exit()，或者抛出 SystemExit 异常来退出

不能直接终止一个线程

thread 和 threading 模块用来创建和管理线程

thread 模块提供了基本的线程和锁定支持, 当主线程退出时，其他线程都会被强制结束并不会发出警告或适当清理

threading 模块提供了更高级更全面的线程管理

Queue 模块，用于创建队列数据结构在多线程之间进行数据共享

注意：避免使用 thread 模块，尽量使用 threading 模块

多线程适用于 I/O 密集型应用而不是计算密集型应用

## thread 模块

锁 对象（ lock object， 也叫 原 语 锁、 简单 锁、 互斥 锁、 互斥 和 二进制 信号 量）

| thread 模块函数 | 描述 |
| :--------- | :--------- |
| start_new_thread(function, args, kwargs=None) | 派生一个新的线程，使用 args元组 和 kwargs 来执行函数 function |
| allocate_lock() | 分配 LockType 锁对象 |
| exit() | 线程退出指令 |


| LockType 锁对象方法 | 描述 |
| :--------- | :--------- |
| acquire(blocking=True, timeout=-1) | 取得锁，默认锁定锁对象，可能阻塞 |
| locked() | 判断是否在锁定状态,如果是则返回 True |
| release() | 释放锁 |

示例

    import _thread
    from time import sleep, ctime


    def loop_0():
        flag = '0'
        print(flag, ctime())
        sleep(6)
        print(flag, ctime())


    def loop_1():
        flag = '1'
        print(flag, ctime())
        sleep(3)
        print(flag, ctime())


    def main():
        print('start', ctime())
        _thread.start_new_thread(loop_0, ())
        _thread.start_new_thread(loop_1, ())
        sleep(7)    # 主线程睡眠
        print('all down', ctime())


    if __name__ == '__main__':
        main()

输出

    start Mon Jan 15 14:58:50 2018
    1 Mon Jan 15 14:58:50 2018
    0 Mon Jan 15 14:58:50 2018
    1 Mon Jan 15 14:58:53 2018
    0 Mon Jan 15 14:58:56 2018
    all down Mon Jan 15 14:58:57 2018

    Process finished with exit code 0

若果不阻止主线程执行，则

    start Mon Jan 15 15:02:43 2018
    all down Mon Jan 15 15:02:43 2018
    0 Mon Jan 15 15:02:43 2018
    1 Mon Jan 15 15:02:43 2018

    Process finished with exit code 0

使用锁对象来实现主线程的挂起

    import _thread
    from time import sleep, ctime


    sleep_list = [6, 3]     # 存储睡眠时间的列表


    def loop(index, s_time, lock):
        print(index, 'start', ctime())
        sleep(s_time)
        print(index, 'end', ctime())
        lock.release()  # 释放锁


    def main():
        print('start', ctime())
        locks = []
        index_list = range(len(sleep_list))

        for i in index_list:
            lock = _thread.allocate_lock()  # 获得锁对象
            lock.acquire()  # 取得锁, 并锁定锁
            locks.append(lock)  # 将锁放入列表

        for i in index_list:
            _thread.start_new_thread(loop, (i, sleep_list[i], locks[i]))    # 派生线程，传入元组参数

        for i in index_list:    # 暂停主循环
            while locks[i].locked():    # 当锁还在锁定状态时，进行循环
                pass

        print('all down', ctime())


    if __name__ == '__main__':
        main()

输出

    start Mon Jan 15 15:16:15 2018
    1 start Mon Jan 15 15:16:15 2018
    0 start Mon Jan 15 15:16:15 2018
    1 end Mon Jan 15 15:16:18 2018
    0 end Mon Jan 15 15:16:21 2018
    all down Mon Jan 15 15:16:21 2018

    Process finished with exit code 0

## threading 模块

| 对象 | 描述 |
| :--------- | :--------- |
| Thread | 表示执行线程的对象 |
| Lock | 锁原语对象 |
| RLock | 重入锁，令单一线程可以（再次）获得已持有的锁 |
| Condition | 条件变量对象, 让一个线程等待另一个线程的所需满足条件，例如某个值改变或状态改变 |
| Event | 条件变量的通用版本，任意数量的线程等待某个条件的发生，在该事件发生后，所有等待的线程都被激活 |
| Semaphore | 为线程间共享的有限资源提供一个‘计数器’， 如果没有可用资源时会被阻塞 |
| BoundedSemaphore | Semaphore 的子类，不允许超过初始值　|
| Timer | Thread 子类，在运行前需要等待一段时间 |
| Barrier | ‘障碍’，必须达到指定数量的线程后才可以继续 |

| 函数 | 描述 |
| :--------- | :--------- |
| activeCount/active_count() | 当前活动的 Thread 对象个数 |
| currentThread/current_thread() | 返回当前的 Thread 对象 |
| enumerate() | 返回当前活动的 Thread 对象列表 |
| settrace(func) | 为所有线程设置一个 trace 对象 |
| setprofile(func) | 为所有线程设置一个 profile 对象 |


守护线程 一般 是一 个 等待 客户 端 请求 服务 的 服务器。 如果 没有 客户 端 请求， 守护 线程 就是 空闲 的。 如果 把 一个 线程 设置 为 守护 线程， 就 表示 这个 线程 是 不重 要的， 进程 退出 时不 需要 等待 这个 线程 执行 完成

主线程在所有非守护线程退出后才会退出

注：如果多线程共享改变同一个数据时，应使用一个锁来使这个数据唯一

### Thread

| Thread对象属性 | 描述 |
| :--------- | :--------- |
| name | 线程名 |
| ident | 线程的标识符 |
| daemon | 布尔类型，表示该线程是否时守护线程 |

| Thread对象方法 | 描述 |
| :--------- | :--------- |
| __init__(group=None, target=None, name=None, args=(), kwargs=None, *, daemon=None) | 实例化线程对象 |
| start() | 开始执行该线程 |
| run() | 定义线程功能的方法，通常在子类中被重写 |
| join(timeout=None) | 直到启动的线程终止前一直挂起，除非给定了 timeout 时间，否则一直阻塞 |
| getName() | 返回线程名字 |
| setName(name) | 设定线程名字 |
| isAlive/is_alive() | 布尔值，表示该线程是否存活 |
| isDaemon() | 布尔值，判断该线程是否是守护线程 |
| setDaemon(daemonic) | 设置守护线程标识，必须在 start() 之前调用 |

#### 传递函数的示例

    import threading
    from time import sleep, ctime


    sleep_list = [6, 3]     # 存储睡眠时间的列表


    def loop(index, s_time):
        print(index, 'start', ctime())
        sleep(s_time)
        print(index, 'end', ctime())


    def main():
        print('start', ctime())
        threads = []
        index_list = range(len(sleep_list))

        for i in index_list:
            t = threading.Thread(target=loop, args=(i, sleep_list[i]))
            threads.append(t)

        for i in index_list:
            threads[i].start()

        for i in index_list:
            threads[i].join()   # 挂起主线程，等待其他线程结束, 可以不调用 join() 主动挂起, 让主线程进行其他操作

        print('all down', ctime())


    if __name__ == '__main__':
        main()

输出

    start Mon Jan 15 16:45:55 2018
    0 start Mon Jan 15 16:45:55 2018
    1 start Mon Jan 15 16:45:55 2018
    1 end Mon Jan 15 16:45:58 2018
    0 end Mon Jan 15 16:46:01 2018
    all down Mon Jan 15 16:46:01 2018

    Process finished with exit code 0

注释掉 join（） 后执行输出

    start Mon Jan 15 16:47:14 2018
    0 start Mon Jan 15 16:47:14 2018
    1 start Mon Jan 15 16:47:14 2018
    all down Mon Jan 15 16:47:14 2018
    1 end Mon Jan 15 16:47:17 2018
    0 end Mon Jan 15 16:47:20 2018

    Process finished with exit code 0

#### 传递可调用的类的示例

    import threading
    from time import sleep, ctime


    sleep_list = [6, 3]     # 存储睡眠时间的列表


    class ThreadFunc(object):

        def __init__(self, func, args, name=''):
            self.name = name
            self.func = func
            self.args = args

        def __call__(self, *args, **kwargs):
            """
            创建新线程时，会调用这个特殊方法
            """
            self.func(*self.args)   # 加 * 指元组的值一一对应函数的参数


    def loop(index, s_time):
        print(index, 'start', ctime())
        sleep(s_time)
        print(index, 'end', ctime())


    def main():
        print('start', ctime())
        threads = []
        index_list = range(len(sleep_list))

        for i in index_list:
            t = threading.Thread(target=ThreadFunc(loop, args=(i, sleep_list[i]), name=loop.__name__))
            threads.append(t)

        for i in index_list:
            threads[i].start()

        for i in index_list:
            threads[i].join()   # 挂起主线程，等待其他线程结束, 可以不调用 join() 主动挂起, 让主线程进行其他操作

        print('all down', ctime())


    if __name__ == '__main__':
        main()


#### 派生 Thread 子类，创建子类实例

    import threading
    from time import sleep, ctime


    sleep_list = [6, 3]     # 存储睡眠时间的列表


    class MyThread(threading.Thread):

        def __init__(self, func, args, name=None):
            super().__init__()
            self.name = name
            self.func = func
            self.args = args

        def run(self):
            """
            重写 run() 方法
            """
            self.func(*self.args)


    def loop(index, s_time):
        print(index, 'start', ctime())
        sleep(s_time)
        print(index, 'end', ctime())


    def main():
        print('start', ctime())
        threads = []
        index_list = range(len(sleep_list))

        for i in index_list:
            t = MyThread(loop, args=(i, sleep_list[i]), name=loop.__name__)
            threads.append(t)

        for i in index_list:
            threads[i].start()

        for i in index_list:
            threads[i].join()   # 挂起主线程，等待其他线程结束, 可以不调用 join() 主动挂起, 让主线程进行其他操作

        print('all down', ctime())


    if __name__ == '__main__':
        main()



#### 信号量

信号 量 是最 古老 的 同步 原 语 之一。 它是 一个 计数器， 当 资源 消耗 时 递减， 当 资源 释放 时 递增。

模拟 一个 简化 的 糖果 机。 这个 特制 的 机器 只有 5 个 可 用的 槽 来 保持 库存（ 糖果）。 如果 所 有的 槽 都 满了， 糖果 就不能 再加 到这 个 机器 中了； 相似 地， 如果 每个 槽 都 空了， 想要 购买 的 消费者 就 无法 买到 糖果 了

    from atexit import register
    from random import randrange
    from threading import BoundedSemaphore, Lock, Thread
    from time import sleep, ctime

    lock = Lock()   # 一个锁
    MAX = 5         # 最大值
    candytray = BoundedSemaphore(MAX)   # 信号量，即计数器


    def refill():
        lock.acquire()
        print('填装糖果...', end=' ')
        try:
            candytray.release()     # 增加信号量
        except ValueError:          # 当大于最大值时
            print('已经满了')
        else:
            print('OK')
        lock.release()


    def buy():
        lock.acquire()
        print('购买糖果...', end=' ')
        if candytray.acquire(False):    # 减少信号量, 不阻塞
            print('OK')
        else:
            print('卖完了')
        lock.release()


    def producer(loops):
        for i in range(loops):
            refill()    # 制作糖果
            sleep(randrange(3))


    def consumer(loops):
        for i in range(loops):
            buy()       # 购买糖果
            sleep(randrange(3))


    def _main():
        print('开始时间:', ctime())
        nloops = randrange(2, 6)
        print('糖果机 (最大库存数 %d)!' % MAX)
        Thread(target=consumer, args=(randrange(
            nloops, nloops + MAX + 2),)).start()  # buyer
        Thread(target=producer, args=(nloops,)).start()  # vendor


    @register       # register 注解，用于在主线程结束时调用该注解方法
    def _atexit():
        print('完成时间:', ctime())


    if __name__ == '__main__':
        _main()


输出

    开始时间: Tue Jan 16 15:31:40 2018
    糖果机 (最大库存数 5)!
    购买糖果... OK
    填装糖果... OK
    购买糖果... OK
    填装糖果... OK
    购买糖果... OK
    购买糖果... OK
    填装糖果... OK
    完成时间: Tue Jan 16 15:31:47 2018

    Process finished with exit code 0

## queue 模块

队列

| queue 模块的类 | 描述 |
| :--------- | :--------- |
| Queue(maxsize=0) | 创建一个先入先出队列。如果给定最大值，则队列会在没有空间时阻塞，否则是无限队列 |
| LifoQueue(maxsize=0) | 创建一个后入先出队列。如果给定最大值，则队列会在没有空间时阻塞，否则是无限队列 |
| PriorityQueue(maxsize=0) | 创建一个优先级队列。如果给定最大值，则队列会在没有空间时阻塞，否则是无限队列 |

| queue 异常 | 描述 |
| :--------- | :--------- |
| Empty | 当对空队列调用 get*() 方法时抛出异常 |
| Full | 当对已满的队列使用 put*() 方法时抛出异常 |

| queue 对象的方法 | 描述 |
| :--------- | :--------- |
| qsize() | 返回队列大小（由于反回时，该值可能被其他线程修改，so 这是个近似值） |
| empty() | 返回布尔值，判断队列是否为空 |
| full() | 返回布尔值，判断队列是否已满 |
| put(item, block=True, timeout=None) | 将 item 放入队列。如果 block 是 True 和 timeout 是 None，则队列会在有可用空间之前阻塞， 通过设置 timeout 来设置最多阻塞时间（秒）；如果 block 为 False 则队列在没有空间时 put（） 会抛出 Full 异常 |
| put_nowait(item) | 即 put(item, block=False) |
| get(block=true, timeout=none) | 从队列中取得元素。如果 block 是 True 和 timeout 是 None, 则队列会在有可用元素之前阻塞，通过设置 timeout 来设置最多阻塞时间（秒）；如果 block 为 False 则队列在没有可用元素时 get() 会抛出 Empty 异常 |
| get_nowait() | 即 get(block=False) |
| task_done() | 用于表示队列中的某个元素执行完成, 该方法会被 join() 使用 |
| join() | 在队列中所有元素执行完毕并调用上面的 task_done() 之前，保持阻塞 |

一个消费和生产的例子

    import threading
    from random import randrange
    from time import sleep, ctime
    import queue


    class MyThread(threading.Thread):
        def __init__(self, func, args, name='', verb=False):
            threading.Thread.__init__(self)
            self.name = name
            self.func = func
            self.args = args
            self.verb = verb

        def get_result(self):
            return self.res

        def run(self):
            if self.verb:
                print('starting', self.name, 'at:', ctime())
            self.res = self.func(*self.args)
            if self.verb:
                print(self.name, 'finished at:', ctime())


    def write_q(temp_queue):
        print('放入队列一个...', end='')
        temp_queue.put('xxx', True)     # 放入队列
        print("size now", temp_queue.qsize())


    def read_q(temp_queue):
        val = temp_queue.get(True)  # 从队列取出
        print('从队列取出一个... size now', temp_queue.qsize())


    def writer(temp_queue, loops):
        for i in range(loops):
            write_q(temp_queue)
            sleep(randrange(1, 4))


    def reader(temp_queue, loops):
        for i in range(loops):
            read_q(temp_queue)
            sleep(randrange(2, 6))


    funcs = [writer, reader]
    nfuncs = range(len(funcs))


    def main():
        n_loops = randrange(2, 6)
        q = queue.Queue(32)     # 队列

        threads = []
        for i in nfuncs:
            t = MyThread(funcs[i], (q, n_loops), funcs[i].__name__)
            threads.append(t)

        for i in nfuncs:
            threads[i].start()

        for i in nfuncs:
            threads[i].join()

        print('all DONE')


    if __name__ == '__main__':
        main()

## 相关模块

subprocess 模块：可用于派生进程，可以 单纯 地 执行任务， 或者 通过 标准 文件（ stdin、 stdout、 stderr） 进行 进程 间 通信

multiprocessing 模块：允许 为多 核 或 多 CPU 派生 进程， 其 接口 与 threading 模块 非常 相似。 该 模块 同样 也 包括 在 共享 任务 的 进程 间 传输 数据 的 多种 方式

concurrent.futures 模块：不再 需要 过分 关注 同步 和 线程/ 进程 的 管理 了， 只需 要 指定 一个 给定 了“ worker” 数量 的 线程/ 进程 池， 提交 任务， 然后 整理 结果

mutex 模块：互斥对象

SocketServer 模块：创建管理线程控制的 TCP/UDP 服务器





























