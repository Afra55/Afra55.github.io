---
layout: post
title:  "Python First Step"
date:   2017-11-21 14:07
categories: Python
comments: true
description: Python First Step！
---

* content
{:toc}

# 本文

[http://afra55.github.io/2017/06/21/sorts-according-to-chinese-pinyin/](http://afra55.github.io/2017/06/21/sorts-according-to-chinese-pinyin/)

# 基础知识

## 前言

The Zen of Python, by Tim Peters

Beautiful is better than ugly.

Explicit is better than implicit.

Simple is better than complex.

Complex is better than complicated.

Flat is better than nested.

Sparse is better than dense.

Readability counts.

Special cases aren't special enough to break the rules.

Although practicality beats purity.

Errors should never pass silently.

Unless explicitly silenced.

In the face of ambiguity, refuse the temptation to guess.

There should be one-- and preferably only one --obvious way to do it.

Although that way may not be obvious at first unless you're Dutch.

Now is better than never.

Although never is often better than *right* now.

If the implementation is hard to explain, it's a bad idea.

If the implementation is easy to explain, it may be a good idea.

Namespaces are one honking great idea -- let's do more of those!

## 注释

注释使用 井号来标志 `#`, `#` 后面的内容都会被解释器忽略；

## 变量

命名只能包含 小写字母 + 数字 + 下划线, 不能以数字开头;

## 基本类型

### 字符串

用引号引起来的都是字符串，引号包括 单引号 和 双引号；

单引号和双引号可以互相包含，包含的引号就可以以字符串的形式显示出来;

如果想要双引号包含双引号或者单引号包含单引号则需要进行转义：\", \'；

    name = "victor afra55"
    name.title()   # "Victor Afra55"
    name.upper()   # "VICTOR AFRA55"
    name.lower()   # "victor afra55"

title() 方法，大写每个单词的首字母；

    message = " Victor Afra55 "
    message.strip()     # "Victor Afra55"
    message.lstrip()    # "Victor Afra55 "
    message.rstrip()    # " Victor Afra55"

strip() 方法删除字符串开头和末尾的空白；

    number = 1
    str(number)     # "number"

函数 str()，用于把各种类型转义为字符串

### 浮点数

带小数点的数字都称为浮点数；

python3 中两个整数相除得到的是浮点数，例如：3 / 2 返回的是 浮点数；


