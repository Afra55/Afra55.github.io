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

## PEP 8

[https://python.org/dev/peps/pep-0008/](https://python.org/dev/peps/pep-0008/)

## 注释

注释使用 井号来标志 `#`, `#` 后面的内容都会被解释器忽略

## 变量

命名只能包含 小写字母 + 数字 + 下划线, 不能以数字开头

## 计算

`**` 代表乘方运算 比如 `2 ** 3` 指 2 的 3次方， 结果是 8

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

### for

    names = ['afra55', 'bfra55', 'cfra55', 'dfra55']
    for name in names:
        print(name)

for 循环用于遍历列表

    for value in range(1, 5):
        print(value)    # 1 2 3 4 

range() 方法用于生成一系列数字： range(1, 5) 代表 1～4

    numbers = list(range(1, 5))
    print(numbers)      # [1, 2, 3, 4]

list() 方法将 range() 的结果转化为列表

    numbers = list(range(2, 11, 3))
    print(numbers)  # [2, 5, 8]

range(2, 11, 3) 指 从 2 开始获取值，然后每获取一次加一次 3，直到超出 数值 11

    numbers = list(range(1, 11))
    print(numbers)          # [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    print(min(numbers))     # 1
    print(max(numbers))     # 10
    print(sum(numbers))     # 55

min() 方法获取数字列表最小的数值

max() 方法获取数字列表最大的数值

sum() 方法获取数字列表的所有数值只和

### 列表解析

    numbers = [value ** 2 for value in range(1, 11)]
    print(numbers)  # [1, 4, 9, 16, 25, 36, 49, 64, 81, 100]

`[value ** 2 for value in range(1, 11)]` 这种语法称之为列表解析，用于高效创建列表，以方括号扩起来，表达式是 `value ** 2` 获取平方值，后面的 for 循环用于提供 value 值给表达式

### 切片

对切片的修改不会印象原列表，这里的切片即代表了一个副本，这与 golang 有差别

    names = ['Afra55', 'Bfra55', 'Cfra55', 'Dfra55', 'Fra55']
    print(names[1:3])   # ['Bfra55', 'Cfra55']
    print(names[:4])    # ['Afra55', 'Bfra55', 'Cfra55', 'Dfra55']
    print(names[2:])    # ['Cfra55', 'Dfra55', 'Fra55']
    print(names[-3:])   # ['Cfra55', 'Dfra55', 'Fra55']
    print(names[:-3])   # ['Afra55', 'Bfra55']

`names[1:3]` 指 names 列表中的部分，即包含索引为 1～2 的元素副本

`names[:4]` 指 names 列表中的部分，从列表开头到索引是 3 的元素副本

`names[2:]` 指 names 列表的部分，从索引为 2 到末尾的元素副本

`names[-3:]` 指 names 列表的部分，从倒数第3个到末尾的元素副本

`names[:-3]` 指 names 列表的部分，从列表开头到倒数第4个的元素副本

`names[:]` 指 整个列表的副本

## 元组

不能修改的值即为不可变的，不可变的列表即为元组，以圆括号 `()` 来标志 例如：names = ('Afra55', 'Bfra55')


## if

    names = ('Afra55', 'Bfra55', 'Cfra55', 'Dfra55', 'Fra55')
    for name in names:
        if name == 'Bfra55':
            print('I find you : ' + name)
        elif name == 'Dfra55':
            print('Hi boy : ' + name)
        else:
            print(name)
    # Afra55
    # I find you : Bfra55
    # Cfra55
    # Hi boy : Dfra55
    # Fra55


    age = 22
    print(30 > age > 20)            # True
    print(age < 30 and age > 20)    # True
    print(age < 30 or age > 20)     # True

与 and

或 or

    names = ('Afra55', 'Bfra55', 'Cfra55', 'Dfra55', 'Fra55')
    print('Afra55' in names)    # True
    print('B' in names)         # False
    print('Bfra55' not in names) # False

in 检查值是否包含在列表中

not in 检查值是否不包含在列表中

### 布尔表达式

True

False

    name = []
    if name:    # 判断列表是否是空列表
        print('非空列表')
    else:
        print('空列表')

## 字典

    afra = {
        'first': 'victor', 
        'second': 24
        }
    print(afra['first'])        # 'victor'
    print(afra['second'])       # 24

字典是一系列键值对，任何类型都可以存储为值，字典用 花括号 {} 包裹，键值之间用冒号分割，键值对之间用逗号分隔

    afra55 = {
        'name': 'victor', 
        'age': 25
        }
    print(afra55)               # {'name': 'victor', 'age': 25}
    afra55['weight'] = 144
    afra55['height'] = 177
    print(afra55)               # {'name': 'victor', 'age': 25, 'weight': 144, 'height': 177}
    del afra55['age']
    print(afra55)               # {'name': 'victor', 'weight': 144, 'height': 177}

`afra55['height'] = 177` 这样的写法即新增键值对

`del afra55['age']` 指 删除 字典 afra55 中键为 'age' 的键值对

### 遍历字典

    people_one = {
        'first_name': 'victor',
        'last_name': 'afra55',
        'age': 25,
        'city': "xi'an"
        }
    for key, value in people_one.items():
        print('Key: ' + key + ', value: ' + str(value))

    # Key: first_name, value: victor
    # Key: last_name, value: afra55
    # Key: age, value: 25
    # Key: city, value: xi'an

`for 键，值 in 字典.items():` 遍历字典

    for key in people_one.keys():
        print(key)

`for 键 in 字典.keys():` 遍历字典中的所有键, 相当于 `for 键 in 字典:`

    if 'ff' in people_one.keys():
        print(people_one['ff'])
    elif 'age' in people_one.keys():
        print(people_one['age'])        # 25

如果需要排序，可以使用 sorted() 方法获取字典 key 特定排序的 副本： `for key in sorted(people_one.keys()):`

    for value in people_one.values():
        print(value)

`for 值 in 字典.values():` 遍历字典中所有的值

可以使用 集合 set 来获取字典中的唯一值，去除重复项：`for 值 in set(字典.values()):`

字典值和列表值可以互相包含



