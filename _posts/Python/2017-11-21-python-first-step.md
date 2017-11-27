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

[http://afra55.github.io/2017/11/21/python-first-step/](http://afra55.github.io/2017/11/21/python-first-step/)

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

注释使用 井号来标志 `#`, `#` 后面的内容都会被解释器忽略

## 变量

命名只能包含 小写字母 + 数字 + 下划线, 不能以数字开头

## 基本类型

### 字符串

用引号引起来的都是字符串，引号包括 单引号 和 双引号

单引号和双引号可以互相包含，包含的引号就可以以字符串的形式显示出来

如果想要双引号包含双引号或者单引号包含单引号则需要进行转义：\", \'

    name = "victor afra55"
    name.title()   # "Victor Afra55"
    name.upper()   # "VICTOR AFRA55"
    name.lower()   # "victor afra55"

title() 方法，获取当前字符串的大写每个单词的首字母的副本

    message = " Victor Afra55 "
    message.strip()     # "Victor Afra55"
    message.lstrip()    # "Victor Afra55 "
    message.rstrip()    # " Victor Afra55"

strip() 方法删除字符串开头和末尾的空白

    number = 1
    str(number)     # "number"

函数 str()，用于把各种类型转义为字符串

### 浮点数

带小数点的数字都称为浮点数

python3 中两个整数相除得到的是浮点数，例如：3 / 2 返回的是 浮点数

## 列表

由一系列按顺序排列的元素组成，这个元素可以是任何东西

    names = ['afra55', 'bfra55', 'cfra55', 'dfra55']
    names[0]    # afra55
    names[1]    # bfra55
    names[-1]   # dfra55
    names[-2]   # cfra55

在列表末尾添加元素： `names.append('efra55')`

创建空列表： `empty = []`

在列表中插入元素：`names.insert(0, 'Ffra55')`

从列表中删除元素： `del names[0]`

    names = ['afra55', 'bfra55', 'cfra55', 'dfra55']
    poped_name = names.pop()     # dfra55
    print(names)                 # ['afra55', 'bfra55', 'cfra55']


方法 pop() 获取列表末尾的元素，并把它从列表中删除

    names = ['afra55', 'bfra55', 'cfra55', 'dfra55']
    names.remove('afra55')  # ['bfra55', 'cfra55', 'dfra55']

remove() 方法根据值来删除列表中的元素

    names.sort()
    names.sort(reverse=True)

sort() 方法，修改列表元素的排列顺序为顺序，比如数字从小到大或按字母排序

sort(reverse=True) 逆序排列

    numbers = [2, 3, 1, 4, 5]
    sorted(numbers)    # [1, 2, 3, 4, 5]
    sorted(numbers, reverse=True)     # [5, 4, 3, 2, 1]
    numbers            # [2, 3, 1, 4, 5]

sorted() 方法，临时排序列表，不会改变原列表顺序

sorted(reverse=True) 临时逆序

    numbers = [2, 3, 1, 4, 5]
    numbers.reverse()  # [5, 4, 1, 3, 2]

reverse() 方法，颠倒当前列表的排列顺序

    numbers = [2, 3, 1, 4, 5]
    len(numbers)    # 5

len() 方法，获取列表的长度

    names = ['afra55', 'bfra55', 'cfra55', 'dfra55']
    for name in names:
        print(name)

for 循环用于遍历列表





