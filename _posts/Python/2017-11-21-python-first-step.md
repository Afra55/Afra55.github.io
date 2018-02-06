---
layout: post
title:  "Python First Step: 基础知识"
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

## 关键字

and     as      assert
break
class   continue    
def     del
elif    else    except      exec
finally     for     from    
global      
if      import      in      is
lambda      
nonlocal    not
or
pass    print
raise   return
try
while   with
yield

## 内置函数

| 内置和工厂函数 | 描述 | 返回结果 |
| :--------- | :--------- | :--------- |
| cmp(obj1, obj2) | 比较两个对象 | int |
| repr(obj) | 将 obj 转化为字符串，并可以调用 eval(repr(obj)) 函数再将其转化回 obj | str |
| str(obj) | 可打印的字符串表示 | str |
| type(obj) | obj 对象的类型 | type |

## 格式化操作符转换符号 

| 格式化操作符转换符号 | 描述 |
| :--------- | :---------- |
| %c | 字符 |
| %r | 通过 repr() 转化的字符串 |
| %s | 通过 str() 转化的字符串 |
| %d  %i  | 有符号十进制整数 |
| %u | 无符号十进制整数　 |
| %o | （无符号）八进制整数 |
| %x  %X | (无符号)十六进制整数(小写或大写字母) |
| %e  %E | 指数符号（小写e 或大写E） |
| %f  %F | 浮点实数（自动截断小数） |
| %g  %G | 根据值的大小采用%e或%f，但最多保留6位有效数字 |
| %% | 非转义的百分号字符(%) |


## 注释

注释使用 井号来标志 `#`, `#` 后面的内容都会被解释器忽略

""" 注释 """ 三个双引号之间是注释，可跨行，文档字符串

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

### 内置方法

[链接](https://github.com/Afra55/Afra55.github.io/tree/master/blog_picture/python%C2%A0内置函数)

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

字符串也可以使用切片

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

## 用户输入

    message = input('what do you want to do?\n')       # 输入 232323
    print('oh,2323 ' + message)                        # oh, 232323

input() 函数让程序暂停运行，等待用户输入文本，并存储为一个变量，类型是字符串

## while

    number = 1
    while number < 5:
        print(number)
        number += 1

    message = ''
    while message != 'quit':
        message = input('Enter cmd: ')
        print(message)

    while True:
        message = input('Enter cmd: ')
        if message == 'quit':
            print(message)
            break
        else:
            print('wrong key')

使用 break 跳出循环

使用 continue 返回循环开头

    names = ['Afra55', 'Bfra55', 'Cfra55', 'Dfra55', 'Fra55']
    while names:            # 在列表为空时退出循环
        print(names.pop())


## 函数

    def greet_user(username):               # 形参
        print('Hello! ' + username)
    greet_user(input('input your name: '))  # 实参

    def greet_user(username, age):
        print('Hello! ' + username.title() + " you are " + age)
    name = input('Name: ')
    age = input('age: ')
    greet_user(age=age, username=name)      # 关键字实参

关键字实参 不用考虑传参顺序

    def greet_user(username, age='22'):     # age 参数拥有默认值，调用函数时可不传 age
        print('Hello! ' + username.title() + " you are " + age)
    name = input('Name: ')
    greet_user(name)                        # 这个时候最好使用关键字实参

    def get_full_name(first, second):
        return first + ' ' + second
    fullname = get_full_name('Victor', 'Afra55')
    print(fullname)         # Victor Afra55

return 可返回任何类型的值

### 传递列表

    def greet_users(temps):
    i = 0
    while i < len(temps):
        temps[i] = 'I get you ' + temps[i]
        i += 1
    names = ['Afra55', 'Bfra55', 'Cfra55', 'Dfra55', 'Fra55']
    print(names)                    # ['Afra55', 'Bfra55', 'Cfra55', 'Dfra55', 'Fra55']
    greet_users(names)
    print(names)                    # ['I get you Afra55', 'I get you Bfra55', 'I get you Cfra55', 'I get you Dfra55', 'I get you Fra55']

在函数中对传递进来的列表进行的修改,会修改原列表的值，是永久性的

如果不想改变原列表，则传递副本即可，例如：`names[:]`

### 传递未知数量的参数

    def chat_friends(*friends):             # * 让 python 创建了一个 名为 friends 的 空元组，传人的参数都封装到了 friends 中  
        print(friends)
    chat_friends('Afra')                    # ('Afra',)
    chat_friends('Afra', 'Bfra', 'Cfra')    # ('Afra', 'Bfra', 'Cfra')

如果需要传入不同参数，则 位置实参或者关键字实参都要在 `*friends` 之前：`def chat_friends(me, *friends):` 

    def create_people(name, **info):                        # ** 让 python 创建了一个 名为 info 的 空字典，传参类型是 键值对 key=value
        print(name)
        print(info)
    create_people('Afra', sex='man', age='22', space='af')  # Afra
                                                            # {'sex': 'man', 'age': '22', 'space': 'af'}

### 在模块中存储函数

模块，即扩展名为 .py 的文件

import module_name 用于倒入模块, 然后就可以使用该模块下的函数： module_name.function()

from module_name import function_name_0, function_name_1 从模块中倒入特定的（多个）函数, 然后就可以直接使用该方法：function_name_0()

from module_name import function_name as other_name 其中 as 用于给函数指定别名 other_name，以避免命名冲突

import module_name as other_module_name 其中 as 用于给 模块起个别名

from module_name import * 倒入模块中的所有函数，如果有同名函数或变量，当前文件中的函数或变量会覆盖倒入模块的函数或变量，不建议这种操作

### 建议

给形参指定默认值时，或传入关键字实参时，等号两边不要有空格

使用两个空行将函数分隔开

import 应在文件开头

## 类

类名采用驼峰命名法

实例名和模块名使用小写字母加下划线的方式命名

在类中使用一个空行来分隔方法

使用两个空行来分隔类

    class People:            # 首字母大写的名称专指 类
        """类"""
        def __init__(self, name, age):    # 当创建这个类当实例时，会自动运行初始化方法 __init__()
            """初始化方法"""
            self.name = name
            self.age = age
        def sing(self):
            print(self.name + " sing a song!")
        def age_info(self):
            print(self.name + " age is " + self.age)

初始化方法 __init__() init 前后各有两个下划线，这是规定

类中的每个方法的第一个形数都是 self 用于指向实例本身，以便访问类中的方法和属性，self 自动传递，开发者不需要传递它

    people_one = People('Afra', 22)
    people_one.sing()           # Afra sing a song!
    people_one.age_info()       # Afra age is 22
    print(people_one.name)      # Afra
    print(people_one.age)       # 22

初始化方法隐式的包含retrun语句，用于返回实例

对象名.方法

对象名.属性

### 继承

    class Person:
        def __init__(self, name, age, sex):
            self.name = name
            self.age = age
            self.sex = sex
        def print_info(self):
            print(self.name + " " + str(self.age) + " " + self.sex)


    class Man(Person):
        def __init__(self, name, age):
            super().__init__(name, age, '男')


    class Woman(Person):
        def __init__(self, name, age):
            super().__init__(name, age, '女')


    man = Man('Afra', 23)
    man.print_info()            # Afra 23 男

    woman = Woman('Bfra', 23)
    woman.print_info()          # Bfra 23 女

`class 子类名(父类名):` 继承，子类继承父类时，同时也获得了父类的所有方法和属性

super() 用于调用父类的方法或属性

父类与子类必须在同一文件中，且父类位于子类之前

必要的时候，重写父类方法

属性也可以是一个对象

### 导入类

    from common import Person

`from module_name import class_name， class_name_1, class_name_2` 导入类, 多个点时候用逗号分隔

    import common

`import module_name` 导入整个模块，这样可以使用模块中的所用函数和类, 最优选, 以 module_name.function_name() , module_name.class_name 引用方法或类

`from module_name import *` 导入模块中的所有类， 不推荐

## Python 标准库

标准库的内容很丰富，不断的探索，才是乐趣的所在

[https://pymotw.com/3/](https://pymotw.com/3/)

    from collections import OrderedDict
    favorite_languages = OrderedDict()
    favorite_languages['Afra55'] = 'python'
    favorite_languages['Bfra55'] = 'java'
    favorite_languages['Cfra55'] = 'golong'
    favorite_languages['Dfra55'] = 'ruby'
    for name, language in favorite_languages.items():
        print(name.title() + "'s favorite language is " + language.title() + ".")


    # Afra55's favorite language is Python.
    # Bfra55's favorite language is Java.
    # Cfra55's favorite language is Golong.
    # Dfra55's favorite language is Ruby.

OrderedDict 实例的行为几乎与字典相同，不同的是，OrderedDict 记录了 添加键值对的顺序

    from random import randint
    x = randint(1, 6)
    print(x)    # [1, 6] 的随机数字


## 文件

    with open('file_path/file_name.txt') as file_object:    # windows 系统中 ，路径间隔符号是反斜杠 \
        contents = file_object.read()
        print(contents)

open() 函数即，打开文件，返回一个表示文件的对象，传入的参数是要打开的文件的路径

with 关键字的意思是，在不需要访问该文件时，自动将其关闭，该文件仅在 with 代码块内使用

如果不使用 with 则需要使用 close() 来关闭文件

read() 函数用于读取文件的全部内容，并将内容以字符串的形式返回

read() 函数读取到文件末尾时会返回一个空字符串，print 打印出来就是一个空行

    print(r'\n\tfffff')     # \n\tfffff

在字符串前面加 r 代表该字符串内部没有转移字符，都是原始字符

### 逐行读取

    with open(r'file_name.txt') as file_object:
        for line in file_object:
            print(line)

可以使用for 循环来遍历每一行内容，注意每一行的结尾都有一个换行符

    with open(r'pi_digits.txt') as file_object:
        lines = file_object.readlines()     

readlines() 函数从文件中读取每一行，存储在一个列表中，并返回该列表


### 写入文件

    with open(r'file_name.txt', 'w') as file_object:
        file_object.write("i love python!")

如果要写入文件，则需要给open() 函数出入第二个实参打开模式('r','w','r+','a'), 以所需的模式打开 这个文件

读取模式 ('r')

写入模式 ('w'), 会在返回该文件对象的时候，清空文件的内容, 慎用

读取和写入模式 ('r+')

附加模式 ('a')，将内容附加在原文件所有内容之后

如果写入的文件不存在，open() 函数会自动创建这个文件

write() 函数用于写入内容到文件, 只能写入字符串

## 异常

异常，是一个特殊的对象，用于管理程序运行期间发生的错误

如果没有对异常进行处理，程序会停止，并显示错误信息

    try:
        print(str(5/0))
    except ZeroDivisionError:
        print('wrong')

使用 try-except 代码块捕获异常

    try:
        answer = 5 / 1
    except ZeroDivisionError:
        print('wrong')
    else:
        print(answer)

try-except-else 其中 try 代码块成功执行的代码都应该放到 else 代码块中去使用

    try:
        answer = 5 / 0
    except ZeroDivisionError:
        pass
    else:
        print(answer)

关键字 pass 告诉 python 这个地方什么都不用做

    msg = 'I have a word what i can not read, please help me check this word'
    print(msg.count('word'))        # 2

count() 函数用于返回 该字符串包含特定 字符串 的个数

## 模块 json 存储数据

    import json

    filename = 'file/json_file.json'

    names = ['Afra55', 'Bfra55', 'Cfra55', 'Dfra55', 'Fra55']

    with open(filename, 'w') as file_obj:
        json.dump(names, file_obj)  # 存储了一个列表

    with open(filename) as file_obj:
        print(file_obj.read())      # ["Afra55", "Bfra55", "Cfra55", "Dfra55", "Fra55"]

json.dump(存储的数据，用于存储数据的文件对象) 将数据存储到文件中，通常文件扩展名实 .json 

    import json

    filename = 'file/json_file.json'

    with open(filename) as file_obj:
        temp_names = json.load(file_obj)    # 返回了一个列表

    print(temp_names)   # ['Afra55', 'Bfra55', 'Cfra55', 'Dfra55', 'Fra55']

json.load(文件对象) 读取文件并存储到变量中返回

## 测试代码

单元测试用于检查某个函数的某个功能有没有问题

测试用例是一组单元测试

全覆盖测试，包含一整套单元测试，涉及各种可能性

    def get_fullname(first, last):
        fullname = first + ' ' + last
        return fullname.title()

对上面这个方法进行单元测试，使用 公共库 unittest 

    import unittest

    class NamesTestCase(unittest.TestCase):
        def test_first_last_name(self):
            fullname = get_fullname('one', 'two')
            self.assertEqual(fullname, 'one two'.title())


    unittest.main()

测试类必须继承 unittest.TestCase 

当运行时，所有以 test 开头的方法都将自动运行

assert 断言 

assertEqual() 用于检查结果是否与预期相符

unittest.main() 让 python 运行这个文件中的测试

### 常用断言


| 方法        | 含义                                                   |
| ------------- | :----- |
| assertEqual(a, b) | a == b  |
| assertNotEqual(a, b) | a != b |
| assertTrue(a) | a == True |
| assertFalse(a) | a == False |
| assertIn(item, list) | if item in list |
| assertNotIn(item, list) | if item not in list |

### 测试类

    class People:

        def __init__(self, first_name, last_name, age):
            self.first_name = first_name
            self.last_name = last_name
            self.age = age
            self.books = []

        def show_info(self):
            print(self.first_name + ' ' + self.last_name + ' ' + str(self.age))

        def store_book(self, book):
            self.books.append(book)

        def show_books(self):
            i = 1
            for book in self.books:
                print(str(i) + ':' + book)

测试上面的类

    import unittest


    class TestPeople(unittest.TestCase):

        def test_store_book(self):
            people = People('one', 'two', 22)
            people.store_book('Python')
            self.assertIn('Python', people.books)

        def test_store_four_book(self):
            people = People('one', 'two', 22)
            books = ['Python', 'Ruby', 'Java', 'Go']
            for book in books:
                people.store_book(book)
            for book in books:
                self.assertIn(book, people.books)


    unittest.main()

类的测试需要实例化对象, 上面对每个测试方法都创建了一个实例

    import unittest


    class TestPeople(unittest.TestCase):

        def setUp(self):
            self.people = People('one', 'two', 22)
            self.books = ['Python', 'Ruby', 'Java', 'Go']

        def test_store_book(self):
            self.people.store_book('Python')
            self.assertIn('Python', self.people.books)

        def test_store_four_book(self):
            for book in self.books:
                self.people.store_book(book)
            for book in self.books:
                self.assertIn(book, self.people.books)


    unittest.main()

setUp() 方法，创建测试类的属性，这些属性可以在这个类中的任何地方使用

### 测试结果

测试通过 `..`

测试引发错误 `E`

测试断言失败 `F`

### 结语

一些人，先写测试用例，再写函数或类

## 小结

基础部分，掌握。第二步，项目实战。


















