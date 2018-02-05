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










































