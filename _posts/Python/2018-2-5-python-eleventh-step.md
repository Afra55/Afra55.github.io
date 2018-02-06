---
layout: post
title:  "Python Eleventh Step: 文本处理"
date:   2018-02-5 20:40
categories: Python
comments: true
description: Python Eleventh Step！
---

* content
{:toc}

## 本文

[http://afra55.github.io/2018/02/05/python-eleventh-step/](http://afra55.github.io/2018/02/05/python-eleventh-step/)

## CSV

逗号分隔值 ， Comma-Separated Value


CSV 文件内容是一些逗号分隔的原始字符串值

一个存储并读取的例子：

    import csv

    if __name__ == '__main__':
        data = (
            (1, 'Afra', 'who is i'),
            (2, 'Bfra', 'who is me'),
            (3, 'Cfra', 'lalala, i am i')
        )
        f = open('afra.csv', 'w')
        writer = csv.writer(f)
        for record in data:
            writer.writerow(record)
        f.close()

        f = open('afra.csv', 'r')
        reader = csv.reader(f)
        for number, title, what in reader:
            print('%s : %r : %s' % (number, title, what))
        f.close()

## JSON

[JSON](http://json.org) 是 JavsScript 的 子集， 专门 用于 指定 结 构化 的 数据

JSON 是 轻量级 的 数据 交换 方式。 JSON 是以 人类 更 易读 的 方式 传输 结构 化 数据

    import json


    if __name__ == '__main__':
        data_dict = dict(zip('abcde', range(5)))    
        print(data_dict)        # {'a': 0, 'b': 1, 'c': 2, 'd': 3, 'e': 4}
        json_data = json.dumps(data_dict)       
        print(type(json_data), json_data)       # <class 'str'> {"a": 0, "b": 1, "c": 2, "d": 3, "e": 4}
        dict_data = json.loads(json_data)
        print(type(dict_data), dict_data)       # <class 'dict'> {'a': 0, 'b': 1, 'c': 2, 'd': 3, 'e': 4}

        json_data = json.dumps(data_dict, indent=4)     # indent 代表缩进，美化输出
        print(json_data) 
        """
        {
            "a": 0,
            "b": 1,
            "c": 2,
            "d": 3,
            "e": 4
        }
        """

| Python | JSON |
| :--------- | :--------- |
| dict | object |
| list tuple | array |
| str | string |
| int | number (int) |
| float | number (real) |
| True | true |
| False | false |
| None | null |

## XML

XML 是标准通用标记语言（Standard Generalized Markup Language，SGML）的限制版，其本身是ISO标准ISO8879）

目前的 xml 解析推荐使用 [Beautiful Soup](http://beautifulsoup.readthedocs.io/zh_CN/latest/)

下面是 python 官库示例

    from xml.etree.ElementTree import Element, SubElement, tostring
    from xml.dom.minidom import parseString


    if __name__ == "__main__":
        data = {
            '1': {
                'title': 'Test 1',
                'full': 2,
                'year': 2018,
            },
            '2': {
                'title': 'Test 2',
                'authors': 'Afra55:Cfra44:Dfra33',
                'year': 2019,
            },
            '3': {
                'title': 'Test 3',
                'year': 2020,
                'sub': 9999,
            },
        }

        books = Element('books')    # 顶层对象
        for isbn, info in data.items():
            book = SubElement(books, 'book')    # 子节点
            info.setdefault('authors', 'Bfra55')    # 如果没有 'authors' 则配置默认值为 'Bfra55'
            info.setdefault('sub', 2323)        # 如果没有 'sub' 则配置默认值为 2323
            for key, val in info.items():
                SubElement(book, key).text = ', '.join(str(val).split(':'))     # 将 ':' 转化为 ', '

        xml = tostring(books)
        print('*** 原始 XML ***')
        print(xml)

        print('\n*** 美化 XML 输出 ***')
        dom = parseString(xml)
        print(dom.toprettyxml('    '))

        print('*** 遍历节点及内容 ***')
        for child in books.iter():
            print(child.tag, '-', child.text)

        print('\n*** 搜素 title 节点 ***')
        for book in books.findall('.//title'):
            print(book.text)

输出：

    *** 原始 XML ***
    b'<books><book><title>Test 1</title><full>2</full><year>2018</year><authors>Bfra55</authors><sub>2323</sub></book><book><title>Test 2</title><authors>Afra55, Cfra44, Dfra33</authors><year>2019</year><sub>2323</sub></book><book><title>Test 3</title><year>2020</year><sub>9999</sub><authors>Bfra55</authors></book></books>'

    *** 美化 XML 输出 ***
    <?xml version="1.0" ?>
    <books>
        <book>
            <title>Test 1</title>
            <full>2</full>
            <year>2018</year>
            <authors>Bfra55</authors>
            <sub>2323</sub>
        </book>
        <book>
            <title>Test 2</title>
            <authors>Afra55, Cfra44, Dfra33</authors>
            <year>2019</year>
            <sub>2323</sub>
        </book>
        <book>
            <title>Test 3</title>
            <year>2020</year>
            <sub>9999</sub>
            <authors>Bfra55</authors>
        </book>
    </books>

    *** 遍历节点及内容 ***
    books - None
    book - None
    title - Test 1
    full - 2
    year - 2018
    authors - Bfra55
    sub - 2323
    book - None
    title - Test 2
    authors - Afra55, Cfra44, Dfra33
    year - 2019
    sub - 2323
    book - None
    title - Test 3
    year - 2020
    sub - 9999
    authors - Bfra55

    *** 搜素 title 节点 ***
    Test 1
    Test 2
    Test 3

    Process finished with exit code 0

## Jython

[http://www.jython.org](http://www.jython.org)

Jython 提供了大部分 Python 功能， 且能够实例化 Java 类并与之交互

Jython 代码会动态地编译成 Java 字节码， 还可以用 Jython 扩展 Java 类。 通过 Jython， 还能使用 Java 来扩展 Python

能方便地在 Python 中编写一个类， 在 Java 环境中就如同原生的 Java 类来使用。 甚至可以把 Jython 脚本静态地编译为 Java 码






































