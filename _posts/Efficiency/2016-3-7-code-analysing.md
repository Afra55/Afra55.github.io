---
layout: post
title:  "Android代码性能优化"
date:   2016-3-7 9:10
categories: Efficiency
comments: true
description: Android代码性能优化!
---

* content
{:toc}

## 基本原则

- 不做亢余的工作
- 避免执行过多的内存分配操作

## 1.避免创建不必要的对象

避免创建更多的临时对象。更少的对象会有更少的gc（Garbage Collector：垃圾回收机制）动作，gc会对用户体验有比较直接的影响。

## 2.设置一些方法为Static类型
 
如果不需要访问一个对象的值时，设置这个方法为static类型，这样方法调用将快15%-20%。

## 3.常量声明为Static Final

final声明的常量进入了静态dex文件的域初始化部分,调用原始类型时会直接使用值，字符串也会使用一个相对廉价的“字符串常量”指令，而不是查表。

## 4.避免内部的Getters/Setters

在没有JIT(Just In Time Compiler)时，直接访问变量的速度是调用getter的3倍。有JIT时，直接访问变量的速度是通过getter访问的7倍。
因此，将getter和setting暴露给公用接口是合理的，但在类内部应该仅仅使用域直接访问。

## 5.使用增强的For循环

尽量使用for-each方法：

	for(int a : integers){}

ArrayList，使用如下方法：

	ArrayList<?> localArrayList = mArrayList;
	int len = localArrayList.size();
	for(int i = 0 ;  i < len ; i++){
		localArrayList.get(i);
	}

## 6.避免使用float类型

Android系统中float类型的数据存取速度是int类型的一半，尽量优先采用int类型。
就速度而言，现代硬件上，float 和 double 的速度是一样的。空间而言，double 是两倍float的大小。在空间不是问题的情况下，你应该使用 double 。

## 7.使用系统自带的库函数

## 8.谨慎使用native函数

## 9.内部类访问外部类的方法或者属性尽量使用public类型

VM认为外部类和内部类是不同的类，在内部类中直接访问外部类的私有成员是不合法的，即使java语言允许访问，但是编译器会产生一些仿造函数，例如access函数，通过accessor会比直接访问域要慢。